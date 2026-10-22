/**
 * The webhook sender: sign, post, retry, and never claim a delivery it did not get.
 *
 * Three properties are load-bearing and each has a failure mode worth stating:
 *
 *   - **Signed over the posted bytes.** The receiver verifies a MAC over the raw
 *     body, so the body is serialised once and that exact string is both signed
 *     and sent. Re-serialising would produce a body that fails its own signature
 *     whenever key order or spacing drifted.
 *   - **At-least-once, ordered per task type.** Sequence numbers are assigned per
 *     `taskType` and events are sent one at a time, so a retry cannot overtake its
 *     predecessor. Duplicates are allowed and expected: `id` is derived from the
 *     event's content and sequence, so a redelivery carries the same id and a
 *     receiver can drop it.
 *   - **A failure is recorded, not thrown.** One unreachable endpoint must not
 *     stop the queue for every other rule; the event id lands in `failed` and the
 *     host resyncs, which is what the contract's `GET /v1/knowledge?since=` is for.
 */
import { hmacSha256Hex, sha256Hex } from './sha256.js';
import type { DeliveryEvent, DraftEvent } from './events.js';

export type DeliveryTarget = {
  /** The receiver's endpoint, e.g. `https://host.example/microglia/events`. */
  readonly url: string;
  /** Shared secret; the receiver holds the same value. */
  readonly secret: string;
};

export type HttpResponseLike = {
  readonly ok: boolean;
  readonly status: number;
};

export type FetchLike = (
  url: string,
  init: {
    readonly method: 'POST';
    readonly headers: Record<string, string>;
    readonly body: string;
  },
) => Promise<HttpResponseLike>;

export type DeliveryAttempt = {
  readonly eventId: string;
  readonly seq: number;
  readonly attempt: number;
  readonly status: number;
  readonly ok: boolean;
  readonly latencyMs: number;
};

export type DeliveryResult = {
  readonly attempts: readonly DeliveryAttempt[];
  /** Event ids that exhausted their retries. A host resyncs from these. */
  readonly failed: readonly string[];
};

export type DispatcherOptions = {
  readonly target: DeliveryTarget;
  readonly fetch: FetchLike;
  readonly clock: () => number;
  readonly sleep: (ms: number) => Promise<void>;
  /** Total attempts per event, including the first. Defaults to 3. */
  readonly attempts?: number;
  /** First backoff in milliseconds; doubles per retry. Defaults to 200. */
  readonly backoffMs?: number;
};

/** The signature header name, in one place, because both sides must agree. */
export const SIGNATURE_HEADER = 'X-Microglia-Signature';

/**
 * A retry is for a fault the receiver did not choose: a network error, a 5xx, a
 * rate limit. A 4xx is the receiver refusing this body, and repeating it is how a
 * sender turns one bad event into an outage.
 */
function retryable(status: number): boolean {
  return status === 0 || status === 429 || status >= 500;
}

export class WebhookDispatcher {
  private readonly options: DispatcherOptions;
  private readonly sequences = new Map<string, number>();

  public constructor(options: DispatcherOptions) {
    this.options = options;
  }

  /** The next sequence number for a task type, without consuming it. */
  public nextSeq(taskType: string): number {
    return (this.sequences.get(taskType) ?? 0) + 1;
  }

  /**
   * Deliver a batch, in order.
   *
   * Sequence numbers are assigned here rather than by the caller: two callers
   * computing their own would produce two events claiming the same slot, and the
   * receiver would have no way to order them.
   */
  public async publish(drafts: readonly DraftEvent[]): Promise<DeliveryResult> {
    const attempts: DeliveryAttempt[] = [];
    const failed: string[] = [];
    for (const draft of drafts) {
      const seq = this.nextSeq(draft.taskType);
      this.sequences.set(draft.taskType, seq);
      const event: DeliveryEvent = { ...draft, seq, id: eventId(draft, seq) };
      const outcome = await this.deliver(event);
      attempts.push(...outcome.attempts);
      if (!outcome.ok) failed.push(event.id);
    }
    return { attempts, failed };
  }

  private async deliver(event: DeliveryEvent): Promise<{ attempts: DeliveryAttempt[]; ok: boolean }> {
    const body = JSON.stringify(event);
    const headers = {
      'Content-Type': 'application/json',
      [SIGNATURE_HEADER]: hmacSha256Hex(this.options.target.secret, body),
      'X-Microglia-Event': event.id,
    };
    // `attempts: 0` is a caller who disabled delivery: every event is reported
    // failed rather than dropped, which is the one answer a queue must never give
    // silently.
    const total = this.options.attempts ?? 3;
    const backoff = this.options.backoffMs ?? 200;
    const attempts: DeliveryAttempt[] = [];
    let wait = backoff;

    for (let attempt = 1; attempt <= total; attempt += 1) {
      const started = this.options.clock();
      let status = 0;
      try {
        const response = await this.options.fetch(this.options.target.url, {
          method: 'POST',
          headers,
          body,
        });
        status = response.status;
        if (response.ok) {
          attempts.push({
            eventId: event.id,
            seq: event.seq,
            attempt,
            status,
            ok: true,
            latencyMs: this.options.clock() - started,
          });
          return { attempts, ok: true };
        }
      } catch {
        // A transport failure is status 0: unreachable, not refused.
        status = 0;
      }
      attempts.push({
        eventId: event.id,
        seq: event.seq,
        attempt,
        status,
        ok: false,
        latencyMs: this.options.clock() - started,
      });
      if (!retryable(status) || attempt === total) return { attempts, ok: false };
      await this.options.sleep(wait);
      wait *= 2;
    }
    return { attempts, ok: false };
  }
}

/**
 * A stable id for one event.
 *
 * Content-derived rather than random, because the delivery contract is
 * at-least-once: a redelivery after a timeout must carry the same id, or the
 * receiver's de-duplication has nothing to match on. The sequence is part of the
 * input, so two different admissions of one rule stay distinct.
 */
export function eventId(draft: DraftEvent, seq: number): string {
  return `evt_${sha256Hex([draft.type, draft.namespace, draft.taskType, draft.item.id, String(seq), String(draft.at)].join('\u0000')).slice(0, 24)}`;
}
