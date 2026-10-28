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
  /** Per-attempt timeout. */
  readonly timeoutMs?: number;
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
};

const DEFAULT_ENDPOINT = 'https://api.deepseek.com/chat/completions';

export class LlmClient {
  private readonly breaker: CircuitBreaker;
  private calls = 0;
  private prompts = 0;
  private failures = 0;
  private retries = 0;
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
    const timeout = this.options.timeoutMs ?? 60_000;

    let last = '';
    let attempts = 0;
    this.prompts += 1;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      if (attempt > 0) {
        this.retries += 1;
        await sleep(backoffMs(attempt, 500, random));
      }
      if (this.calls >= this.options.maxCalls) {
        throw new MicrogliaError('MG_E_BUDGET_EXCEEDED', 'call budget reached');
      }
      this.calls += 1;
      attempts += 1;

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
        continue;
      }
      if (response.status === 429 || response.status >= 500) {
        last = `status ${response.status}`;
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
    };
  }
}
