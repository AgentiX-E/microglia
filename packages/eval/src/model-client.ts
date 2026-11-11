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
import { EMPTY_BANDED, addToBand, totalUsage, type BandedUsage } from './cost.js';

export type ChatReply = {
  readonly text: string;
  /** `total_tokens` as the provider reported it. Kept because it is what the provider bills against. */
  readonly tokens: number;
  /**
   * The prompt the provider read, and how much of it came from its prefix cache.
   *
   * These are separate fields rather than a subtraction at the call site because the cache rate is
   * fifty times cheaper than the miss rate: a run whose prompt is 90% cached and a run whose prompt
   * is not at all can carry the same `total_tokens` and bills that differ by a factor of fifty. The
   * lane read `total_tokens` alone for two months, which is precisely why that difference was never
   * visible.
   */
  readonly promptTokens: number;
  readonly cachedTokens: number;
  /** Tokens the model produced. On a thinking model this includes the thinking, which is billed here. */
  readonly completionTokens: number;
  /**
   * The part of `completionTokens` the provider attributed to reasoning.
   *
   * Recorded rather than acted on: it is the only evidence that a lane is paying for thinking, and
   * the rate card prices an output token four times an uncached input token. Absent when the provider
   * does not report it, which is not the same as zero.
   */
  readonly reasoningTokens?: number;
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
  /**
   * Whether to ask the model to think, when the caller wants to say.
   *
   * Three states rather than a boolean, because "do not send the field" is a real choice and it is
   * the current one: every number in this repository was produced with whatever the endpoint does by
   * default, and a client that quietly switched that off would have moved the baseline under every
   * one of them. `'off'` sends the provider's disable switch explicitly, which is the only way a run
   * can be cheaper on purpose rather than by accident — the provider's default for the current model
   * is to think, and thinking is billed at the output rate.
   */
  readonly thinking?: 'off' | 'on';
  /**
   * The clock, injected so a bill is a function of the run rather than of when the suite ran.
   *
   * The band a call is billed in is read at reply time. A test that does not fix the clock would
   * assert different bills inside and outside the provider's peak windows — which is precisely the
   * defect this whole file was written to stop, arriving through the test suite instead of the lane.
   */
  readonly now?: () => Date;
};

export type LlmStats = {
  /** HTTP attempts, which is what the budget is spent in. */
  readonly calls: number;
  /** Logical calls, which is the denominator of a reliability rate. */
  readonly prompts: number;
  readonly failures: number;
  readonly retries: number;
  readonly tokens: number;
  /** The bill's three inputs, accumulated over the run. */
  readonly promptTokens: number;
  readonly cachedTokens: number;
  readonly completionTokens: number;
  /** Reasoning tokens the provider attributed, or zero when it attributed none. */
  readonly reasoningTokens: number;
  /**
   * Attempts the client abandoned because the reply did not arrive in time.
   *
   * Separate from `retries`: a retry after a 429 is the provider asking for patience, and a retry
   * after a timeout is the client having asked for more than it was willing to wait for. The
   * second was, for two dispatches, the whole of a fold's cost.
   */
  readonly timeouts: number;
};

/**
 * Where a call goes when the lane was pointed nowhere.
 *
 * Exported because the catalogue probe derives its sibling from this exact string: `/models` beside
 * `/chat/completions`. A second copy of the default would let a dispatch check one host and call
 * another, which is the shape of every defect this file has already been repaired for.
 */
export const DEFAULT_CHAT_ENDPOINT = 'https://api.deepseek.com/chat/completions';

/**
 * The model ids the endpoint serves under a `provider/` alias.
 *
 * One list, and only one entry, because it is a translation rather than a guess. The τ² lane is a
 * litellm caller in its Python half and a REST caller in this one, so its model is named
 * `deepseek/deepseek-chat` — litellm's spelling of the provider and the id. This client posts to
 * `api.deepseek.com/chat/completions`, whose `model` field is `deepseek-chat`. Sending the router's
 * spelling was rejected with a 400 on every call, and the lane read that as "the model said nothing
 * about this correction": 32 prompts, 32 empty answers, a store with no knowledge in it.
 *
 * The list stays narrow on purpose. A prefix this file does not know is left alone, because
 * `deepseek-ai/DeepSeek-V3` and `openai/gpt-4o` are names of other things rather than aliases of
 * this one, and mangling them would report a provider mismatch for a configuration that made a
 * different choice.
 */
const PROVIDER_ALIASES = new Set(['deepseek']);

/**
 * What this endpoint should be told the model is called.
 *
 * Returns the id to send and, when a prefix was removed, the prefix, so a caller can record both
 * names: the artefact says what was configured, and the request says what was asked.
 */
export function restModelOf(configured: string): { readonly sent: string; readonly stripped?: string } {
  const trimmed = configured.trim();
  if (trimmed === '') {
    throw new MicrogliaError('MG_E_CONFIG', 'A model id is required for the model endpoint');
  }
  const slash = trimmed.indexOf('/');
  if (slash <= 0) return { sent: trimmed };
  const alias = trimmed.slice(0, slash);
  if (!PROVIDER_ALIASES.has(alias.toLowerCase())) return { sent: trimmed };
  const rest = trimmed.slice(slash + 1).trim();
  // `deepseek/` with nothing behind it is not a model id; keeping the raw text lets the endpoint
  // answer, which is a better error than one this file invents.
  return rest === '' ? { sent: trimmed } : { sent: rest, stripped: alias };
}

/**
 * What one status code means for the next attempt, which is the only thing this file does with one.
 *
 *  - `transient` — the provider is asking for the same request later: `5xx`, and the four `4xx`
 *    codes that say "not now" rather than "not this": `408` timeout, `409` conflict, `425` too
 *    early, `429` slow down.
 *  - `unpaid` — the account behind the key has no balance (`402`). Sending the same request again
 *    cannot help, and neither can sending a different one.
 *  - `refusal` — everything else, which is every remaining `4xx`. A `4xx` is a property of what was
 *    sent: a model id the endpoint does not serve, a key without the scope and a malformed body all
 *    fail identically next time.
 *
 * The three cases are exhaustive on purpose. They used to be two plus a `MG_E_STORE_IO`
 * fall-through for statuses that were neither transient nor refused, and nothing could reach that
 * line — the two ranges between them cover every status an HTTP response can carry. An arm that
 * cannot be taken is not a defensive default; it is a line the coverage report would have to be
 * told to ignore, or a hole a reader has to re-derive before trusting the other two.
 */
type StatusVerdict = 'transient' | 'unpaid' | 'refusal';

function verdictOf(status: number): StatusVerdict {
  if (status >= 500 || status === 408 || status === 409 || status === 425 || status === 429) {
    return 'transient';
  }
  return status === 402 ? 'unpaid' : 'refusal';
}

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
  /** What the endpoint is told, which is not always what the caller configured. */
  public readonly model: string;
  /** The configured name, kept so an artefact can say both. */
  public readonly configuredModel: string;

  private readonly breaker: CircuitBreaker;
  /**
   * The ceiling in force, which is not always the one the options named.
   *
   * A run that measures its own folds can discover that the operator's forecast was low, and the
   * choice at that moment is between stopping with the folds it paid for and spending the rest under
   * a bound it can now see. The bound is still a bound — `authoriseCalls` refuses to lower it — but
   * the *estimate* stops being able to kill the run, which is the only way a forecast can be wrong
   * without destroying work.
   */
  private cap: number;
  private calls = 0;
  private prompts = 0;
  private failures = 0;
  private retries = 0;
  private timeouts = 0;
  private tokensUsed = 0;
  /**
   * The run's tokens, by the band each call was answered in.
   *
   * Per band rather than in total, because a run that spans 04:00 or 10:00 UTC was billed at two
   * rates and a single total cannot be priced. The lane that books the whole run at the band in
   * force when it ended publishes a number the clock chose.
   */
  private bandedUsage: BandedUsage = EMPTY_BANDED;
  private reasoningTokensUsed = 0;

  public constructor(private readonly options: LlmClientOptions) {
    if (options.apiKey === '') {
      // The message names the option, not a vendor: this client speaks the OpenAI chat
      // shape, and the key that funds it is the caller's choice. Naming DeepSeek here
      // would make a second provider look unsupported when only its name was missing.
      throw new MicrogliaError('MG_E_CONFIG', 'An API key is required for the model endpoint');
    }
    const resolved = restModelOf(options.model);
    this.model = resolved.sent;
    this.configuredModel = options.model;
    this.breaker = new CircuitBreaker(options.breakerThreshold ?? 8);
    this.cap = options.maxCalls;
  }

  /** The ceiling in force now, which a run may have raised after measuring its own folds. */
  public get callCap(): number {
    return this.cap;
  }

  /**
   * Raise the ceiling to `cap`, returning the ceiling in force afterwards.
   *
   * Only upward. A call that could lower the ceiling would be a way to fail a run that was running
   * inside its budget, and "authorise" is not a verb that includes "revoke". A lower argument is
   * ignored rather than refused: the caller is a forecast that has just measured a *smaller* fold
   * than the one it replaced, which is good news and not an error.
   */
  public authoriseCalls(cap: number): number {
    if (Number.isFinite(cap) && cap > this.cap) this.cap = Math.trunc(cap);
    return this.cap;
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
    const endpoint = this.options.endpoint ?? DEFAULT_CHAT_ENDPOINT;
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
      if (this.calls >= this.cap) {
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
            model: this.model,
            messages: [{ role: 'user', content: prompt }],
            temperature,
            max_tokens: maxTokens,
            ...(this.options.thinking === undefined
              ? {}
              : { thinking: { type: this.options.thinking === 'off' ? 'disabled' : 'enabled' } }),
          }),
          signal: AbortSignal.timeout(timeout),
        });
      } catch (error) {
        last = `network: ${String(error)}`;
        timedOut = isTimeoutError(error);
        if (timedOut) this.timeouts += 1;
        continue;
      }
      const verdict = verdictOf(response.status);
      if (verdict === 'transient') {
        last = `status ${response.status}`;
        waitMs = retryAfterMs(response.headers.get('retry-after'));
        continue;
      }
      if (!response.ok) {
        const body = (await response.text()).slice(0, 400);
        // A prompt that was sent and refused is a failed prompt, whoever refused it. The counter
        // used to move only when four attempts had been spent, so an endpoint that rejected every
        // request outright — a model id it does not serve, a key without the scope — reported
        // `prompts: 32, failures: 0`, and the reliability gate certified the outage.
        this.failures += 1;
        // 402 is neither transient nor a defect: the account has no balance.
        if (verdict === 'unpaid') {
          throw new MicrogliaError('MG_E_CONFIG', 'the provider refused the call for lack of credit (402)', {
            hint: 'Top up the account behind the API key, then dispatch again.',
            body,
          });
        }
        // A refusal the provider will repeat. `4xx` is the client's request, not the provider's
        // weather, so it is run-level rather than per-prompt: `stoppedRun` stops the run here
        // instead of letting thirty-two refusals reach a reader as a store that had nothing to say.
        throw new MicrogliaError(
          'MG_E_CONFIG',
          `the provider refused the request (${response.status}); it will refuse it again`,
          { body, model: this.model, hint: 'Check the model id and the key the endpoint serves.' },
        );
      }
      const body = (await response.json()) as {
        choices?: { message?: { content?: string } }[];
        usage?: {
          total_tokens?: number;
          prompt_tokens?: number;
          completion_tokens?: number;
          /** The provider's spelling of the cache split; both keys are read because both are sent. */
          prompt_cache_hit_tokens?: number;
          prompt_cache_miss_tokens?: number;
          completion_tokens_details?: { reasoning_tokens?: number };
        };
      };
      const usage = body.usage ?? {};
      const tokens = usage.total_tokens ?? 0;
      const promptTokens = usage.prompt_tokens ?? 0;
      const completionTokens = usage.completion_tokens ?? 0;
      // A provider that reports a hit count without a total is not a provider whose arithmetic can be
      // trusted, so the hit count is what is believed and the miss count is what is derived.
      const cachedTokens = Math.min(promptTokens, Math.max(0, usage.prompt_cache_hit_tokens ?? 0));
      const reasoningTokens = Math.max(0, usage.completion_tokens_details?.reasoning_tokens ?? 0);
      this.tokensUsed += tokens;
      this.bandedUsage = addToBand(this.bandedUsage, (this.options.now ?? (() => new Date()))(), {
        promptTokens,
        cachedTokens,
        completionTokens,
      });
      this.reasoningTokensUsed += reasoningTokens;
      this.breaker.record(true);
      return {
        text: body.choices?.[0]?.message?.content ?? '',
        tokens,
        promptTokens,
        cachedTokens,
        completionTokens,
        ...(usage.completion_tokens_details?.reasoning_tokens === undefined
          ? {}
          : { reasoningTokens }),
        attempts,
      };
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
    const total = totalUsage(this.bandedUsage);
    return {
      calls: this.calls,
      prompts: this.prompts,
      failures: this.failures,
      retries: this.retries,
      tokens: this.tokensUsed,
      promptTokens: total.promptTokens,
      cachedTokens: total.cachedTokens,
      completionTokens: total.completionTokens,
      reasoningTokens: this.reasoningTokensUsed,
      timeouts: this.timeouts,
    };
  }

  /**
   * The run's tokens by band, in the shape `billOf` prices.
   *
   * Separate from `stats` because a bill is not a statistic: `stats` is read by gates that ask "did
   * every prompt get an answer", and this is read by the one line that says what the answers cost.
   */
  public get usage(): BandedUsage {
    return this.bandedUsage;
  }
}
