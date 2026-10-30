/**
 * One chat client, shared by every lane that calls a model.
 *
 * It lived inside the S2 lane's CLI until two lanes needed it. That mattered for
 * three reasons beyond reuse: the retry policy, the call budget, and the breaker
 * are the parts of a benchmark that decide whether a number is about the mechanism
 * or about the network, and in a CLI they sat outside coverage entirely.
 *
 * The contract is deliberately narrow — a prompt in, text out — because every
 * caller here treats the model as an oracle rather than as a system. Failures are
 * classified rather than retried blindly:
 *
 *  - `MG_E_CONFIG` for 402: the account has no credit. Not transient, not a bug.
 *  - `MG_E_BUDGET_EXCEEDED` when the call budget is spent. A run that keeps going
 *    past its budget is a run whose cost nobody approved.
 *  - `MG_E_PROVIDER_FAILED` when several prompts in a row exhaust their retries:
 *    the endpoint is down, and continuing produces a number that describes an
 *    outage.
 *  - `MG_E_STORE_IO` for a single prompt that failed after its retries. The caller
 *    decides whether that is data (one question unanswered) or fatal.
 */
import { MicrogliaError } from '@agentix-e/microglia-core';
import { CircuitBreaker, backoffMs } from './concurrency.js';

export type ChatReply = {
  readonly text: string;
  readonly tokens: number;
  /** HTTP attempts this reply cost, retries included. */
  readonly attempts: number;
};

export type LlmClientOptions = {
  readonly apiKey: string;
  readonly model: string;
  /** HTTP attempts allowed across the whole run. */
  readonly maxCalls: number;
  /** Consecutive exhausted prompts that end the run. */
  readonly breakerThreshold?: number;
  readonly endpoint?: string;
  /** Per-attempt timeout, when the caller wants to override the size-derived one. */
  readonly timeoutMs?: number;
  /**
   * Epoch milliseconds after which no further call is started. Absent means no limit.
   *
   * A wall-clock limit belongs to the run rather than to a request, so it cannot be expressed as a
   * timeout: the same sixty seconds is generous for one prompt and a truncation for the next. The
   * client checks it before every attempt, which is the last place a stopped run can still be
   * graceful.
   */
  readonly deadline?: number;
  /** Injected in tests; the default is the global `fetch`. */
  readonly fetchImpl?: typeof fetch;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly random?: () => number;
};

export type LlmStats = {
  /** HTTP attempts, which is what the budget is spent in. */
  readonly calls: number;
  /** Logical calls, which is the denominator of a reliability rate. */
  readonly prompts: number;
  readonly failures: number;
  readonly retries: number;
  readonly tokens: number;
  /**
   * Attempts the client abandoned because the reply did not arrive in time.
   *
   * Separate from `retries`: a retry after a 429 is the provider asking for patience, and a retry
   * after a timeout is the client having asked for more than it was willing to wait for. The
   * second was, for two dispatches, the whole of a fold's cost.
   */
  readonly timeouts: number;
};

const DEFAULT_ENDPOINT = 'https://api.deepseek.com/chat/completions';

/** Whether an aborted call was abandoned by its own timeout, which is a different fact from a reset. */
function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
}

/**
 * How long one attempt may take, given what the reply was allowed to contain.
 *
 * A constant here is wrong in a way that is invisible until a run is long: the client asks for
 * `max_tokens` and then waits a fixed sixty seconds, so a request allowed to produce 2,000 tokens
 * — more than a minute of generation at the provider's own rate — is killed while it is succeeding,
 * retried, killed again, and finally recorded as a prompt the model could not answer. That is what
 * happened to the dev split's distillation half: 24 corrections, four attempts each, 43 minutes for
 * a fold whose evaluation took two.
 *
 * The budget grows with the allowance and is capped, because the cap is what keeps a wedged request
 * from consuming the run: 200 tokens get 53s, 700 get 123s, 2,000 get 300s.
 */
export function attemptTimeoutMs(maxTokens: number): number {
  return Math.min(300_000, 25_000 + Math.max(0, maxTokens) * 140);
}

/**
 * What the provider's own backoff advice says, in milliseconds.
 *
 * `Retry-After` is seconds or an HTTP date; the seconds form is what providers send. Capped at a
 * minute: a header asking for longer is telling us the run is over, and sleeping through it spends
 * the deadline on nothing.
 */
export function retryAfterMs(header: string | null): number | undefined {
  if (header === null || header.trim() === '') return undefined;
  const seconds = Number(header.trim());
  if (!Number.isFinite(seconds) || seconds < 0) return undefined;
  return Math.min(60_000, seconds * 1000);
}

export class LlmClient {
  private readonly breaker: CircuitBreaker;
  private calls = 0;
  private prompts = 0;
  private failures = 0;
  private retries = 0;
  private timeouts = 0;
  private tokensUsed = 0;

  public constructor(private readonly options: LlmClientOptions) {
    if (options.apiKey === '') {
      // The message names the option, not a vendor: this client speaks the OpenAI chat
      // shape, and the key that funds it is the caller's choice. Naming DeepSeek here
      // would make a second provider look unsupported when only its name was missing.
      throw new MicrogliaError('MG_E_CONFIG', 'An API key is required for the model endpoint');
    }
    this.breaker = new CircuitBreaker(options.breakerThreshold ?? 8);
  }

  /**
   * One completion.
   *
   * `temperature` exists because a single draw cannot be compared with itself: every memory
   * measurement in this project has been a one-sample comparison, and the noise floor measured with
   * an identical prompt (`none-replica`) is the same size as the effects being reported. Sampling
   * several draws is the only way to say whether a difference is the treatment or the draw.
   *
   * The default stays 0. Every published number was produced at 0, and a silent change would move
   * the baseline under the comparison.
   */
  public async chat(prompt: string, maxTokens = 700, temperature = 0): Promise<ChatReply> {
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const sleep = this.options.sleep ?? (async (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
    const random = this.options.random ?? Math.random;
    const endpoint = this.options.endpoint ?? DEFAULT_ENDPOINT;
    const timeout = this.options.timeoutMs ?? attemptTimeoutMs(maxTokens);
    const deadline = this.options.deadline;

    let last = '';
    let attempts = 0;
    /** What the provider itself asked us to wait, when it said anything. */
    let waitMs: number | undefined;
    /** The last attempt was abandoned by the clock rather than answered with a status. */
    let timedOut = false;
    this.prompts += 1;
    const assertLive = (): void => {
      if (deadline === undefined || Date.now() < deadline) return;
      throw new MicrogliaError(
        'MG_E_DEADLINE',
        `the run's deadline passed after ${attempts} attempt(s) of this prompt`,
        { attempts, last, hint: 'Re-dispatch with a larger SOTA_DEADLINE_MIN, or a smaller run.' },
      );
    };
    for (;;) {
      assertLive();
      // Two attempts after a timeout, four after a status. A prompt that did not arrive in its
      // allowance is not made faster by asking again — the same request gets the same slowness —
      // while a 429 or a 502 is the provider saying "not now", which is worth three more tries.
      if (attempts >= (timedOut ? 2 : 4)) break;
      if (attempts > 0) {
        this.retries += 1;
        await sleep(waitMs ?? backoffMs(attempts, 500, random));
        // Checked again after the wait: the backoff is where a deadline passes, and a run that
        // slept through its own limit would start one more attempt it has no time to finish.
        assertLive();
      }
      if (this.calls >= this.options.maxCalls) {
        throw new MicrogliaError('MG_E_BUDGET_EXCEEDED', 'call budget reached');
      }
      this.calls += 1;
      attempts += 1;
      waitMs = undefined;
      timedOut = false;

      let response: Response;
      try {
        response = await fetchImpl(endpoint, {
          method: 'POST',
          headers: { authorization: `Bearer ${this.options.apiKey}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            model: this.options.model,
            messages: [{ role: 'user', content: prompt }],
            temperature,
            max_tokens: maxTokens,
          }),
          signal: AbortSignal.timeout(timeout),
        });
      } catch (error) {
        last = `network: ${String(error)}`;
        timedOut = isTimeoutError(error);
        if (timedOut) this.timeouts += 1;
        continue;
      }
      if (response.status === 429 || response.status >= 500) {
        last = `status ${response.status}`;
        waitMs = retryAfterMs(response.headers.get('retry-after'));
        continue;
      }
      if (!response.ok) {
        const body = (await response.text()).slice(0, 400);
        // 402 is neither transient nor a defect: the account has no balance.
        if (response.status === 402) {
          throw new MicrogliaError('MG_E_CONFIG', 'the provider refused the call for lack of credit (402)', {
            hint: 'Top up the account behind the API key, then dispatch again.',
            body,
          });
        }
        throw new MicrogliaError('MG_E_STORE_IO', `the provider returned ${response.status}`, { body });
      }
      const body = (await response.json()) as {
        choices?: { message?: { content?: string } }[];
        usage?: { total_tokens?: number };
      };
      const tokens = body.usage?.total_tokens ?? 0;
      this.tokensUsed += tokens;
      this.breaker.record(true);
      return { text: body.choices?.[0]?.message?.content ?? '', tokens, attempts };
    }

    this.failures += 1;
    if (!this.breaker.record(false)) {
      throw new MicrogliaError(
        'MG_E_PROVIDER_FAILED',
        `${this.breaker.streak} prompts in a row failed after four attempts each; the endpoint is not answering`,
        { last, hint: 'Re-dispatch when the provider recovers; a run through an outage measures the outage.' },
      );
    }
    throw new MicrogliaError('MG_E_STORE_IO', 'the provider call failed after retries', { last, attempts });
  }

  public get stats(): LlmStats {
    return {
      calls: this.calls,
      prompts: this.prompts,
      failures: this.failures,
      retries: this.retries,
      tokens: this.tokensUsed,
      timeouts: this.timeouts,
    };
  }
}
