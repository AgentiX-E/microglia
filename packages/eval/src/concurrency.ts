/**
 * A bounded pool for work that spends most of its time waiting.
 *
 * The S2 lane is a few thousand HTTP calls to one model endpoint. Issued one
 * after another they take hours, and a single stalled response pushes the whole
 * run over its step timeout — which is what happened to the first full-split
 * dispatch (160 minutes, four folds done). The calls are independent: each is a
 * prompt built from one question and one frozen pack, so nothing about the
 * measurement depends on the order they complete in.
 *
 * Two properties make this a substitute for a `for await` loop rather than a
 * change to the experiment:
 *
 *  1. **Results keep their input position.** `results[i]` is the answer to
 *     `items[i]` however the calls interleave, so the caller downstream sees the
 *     same sequence it would have seen serially.
 *  2. **The first failure stops the issuing, not the run.** In-flight calls are
 *     awaited, no new ones are issued, and the original error is rethrown. A
 *     pool that rejected immediately and left calls running would produce
 *     unhandled rejections and, worse, keep spending the call budget of a run
 *     that has already failed.
 *
 * The pool deliberately does not retry, log, or classify: those belong to the
 * caller, which knows what a failure means for its measurement.
 */
export async function mapPool<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError(`mapPool needs a positive integer limit, received ${String(limit)}`);
  }
  const results = new Array<R>(items.length);
  let next = 0;
  let failure: { readonly error: unknown } | undefined;

  // Each runner pulls the next unclaimed index. `next += 1` is synchronous, so
  // two runners can never claim the same index, however the awaits interleave.
  const run = async (): Promise<void> => {
    for (;;) {
      if (failure !== undefined) return;
      const index = next;
      next += 1;
      if (index >= items.length) return;
      const item = items[index] as T;
      try {
        results[index] = await worker(item, index);
      } catch (error) {
        // First failure wins: a later one is usually a consequence (the same
        // endpoint failing) and would hide the cause.
        failure ??= { error };
        return;
      }
    }
  };

  const runners = Array.from({ length: Math.min(limit, items.length) }, run);
  await Promise.all(runners);
  if (failure !== undefined) throw failure.error;
  return results;
}

/**
 * The delay before retry `attempt` (1-based), with jitter.
 *
 * Exponential backoff without jitter synchronises every retry in a pool: six
 * workers that fail together retry together, so a 429 arrives as six more 429s.
 * The jitter is a fraction of the window rather than random across it, which
 * keeps the delay bounded (a 429 should not be answered with a minute of sleep)
 * while still spreading the retries out.
 */
export function backoffMs(attempt: number, base = 500, jitter = Math.random): number {
  const window = base * 2 ** Math.max(0, attempt - 1);
  return Math.round(window + jitter() * window * 0.5);
}

/**
 * Consecutive-failure circuit breaker.
 *
 * A retry loop answers "this call failed". It cannot answer "the provider is
 * down", and a lane that presses on through a provider outage spends its whole
 * budget producing a run whose numbers describe the outage. The observed case:
 * five questions took forty-eight minutes in fold 2 of the timed-out dispatch,
 * each one exhausting four retries. Tripping here turns that into a named
 * failure after eight calls instead of a wrong number after a thousand.
 *
 * Successes reset the count, because intermittent failures are the normal case.
 */
export class CircuitBreaker {
  private consecutive = 0;
  private readonly threshold: number;

  public constructor(threshold: number) {
    if (!Number.isInteger(threshold) || threshold < 1) {
      throw new RangeError(`CircuitBreaker needs a positive threshold, received ${String(threshold)}`);
    }
    this.threshold = threshold;
  }

  /** Record an outcome; returns false when the breaker just tripped. */
  public record(ok: boolean): boolean {
    if (ok) {
      this.consecutive = 0;
      return true;
    }
    this.consecutive += 1;
    return this.consecutive < this.threshold;
  }

  /** How many failures in a row the breaker has seen. */
  public get streak(): number {
    return this.consecutive;
  }
}
