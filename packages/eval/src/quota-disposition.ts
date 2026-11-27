/**
 * A 429 is a family of failures, not a verdict. This module turns one HTTP reply into an
 * error family and one of three dispositions, so a caller can tell a retryable rate limit
 * from a balance failure that no amount of retrying will fix.
 *
 * The taxonomy is taken from BigModel's own rate-limit documentation (retrieved 27 Nov 2026,
 * https://bigmodel.io/zh-cn/docs/rate-limits). The decisive facts:
 *
 *  - HTTP 403 `INSUFFICIENT_BALANCE` is the out-of-credit case. It is NOT a 429. The old
 *    embed probe treated every non-2xx alike and retried it four times.
 *  - HTTP 402 `spend_cap_reached` is a self-imposed account cap with a Retry-After pointing
 *    at the reset. Waiting for the reset is not the same as retrying the same request now.
 *  - 429 `rate_limit_error` (concurrency) and 429 `rate_limit_exceeded` (RPM, with
 *    Retry-After) are the retryable rate limits.
 *  - 429 `API_KEY_QUOTA_EXHAUSTED`, `USAGE_LIMIT_EXCEEDED`, and the 5h/1d/7d spend-window
 *    messages are quota/cap failures. BigModel's reference client puts the first two in its
 *    NO_RETRY set; retrying them inside one run only spends the deadline.
 *  - GLM Coding Plan returns numeric codes in a 429 body: 1302/1305 back off, 1308/1310/
 *    1316-1321 wait for next_flush_time, 1113/1311/1309 need a top-up, 1313/1314/1315 need
 *    a different key or product.
 *
 * Pure by design: no clock, no fetch, no provider. The driver supplies the parsed reply and
 * the wait advice; this file only decides what the reply means. That is what lets an
 * independent reader re-derive the same reading from committed bytes.
 */

/** The machine-readable kind of failure. A disposition is derived from this, never stored beside it. */
export type QuotaFamily =
  | 'balance.insufficient'
  | 'window.cap'
  | 'key.quota'
  | 'window.subscription'
  | 'coding.backoff'
  | 'coding.reset'
  | 'coding.config'
  | 'rate.concurrency'
  | 'rate.rpm'
  | 'rate.upstream'
  | 'rate.unclassified'
  | 'window.spend'
  | 'server'
  | 'transient.4xx'
  | 'refusal';

/** What the caller does next. Exactly one of three, exhaustive by construction. */
export type QuotaDisposition = 'retry' | 'wait-until' | 'stop';

/** A caller-facing action hint, stable across families so an operator can group on it. */
export type QuotaHint =
  | 'top-up'
  | 'wait-for-spend-cap-reset'
  | 'raise-key-quota'
  | 'wait-for-subscription-reset'
  | 'backoff-retry'
  | 'wait-for-next-flush'
  | 'fix-key-or-plan'
  | 'reduce-parallelism-and-backoff'
  | 'honor-retry-after'
  | 'wait-for-window-reset'
  | 'fix-request-or-key';

export type QuotaReply = {
  readonly status: number;
  readonly code?: string;
  readonly message?: string;
  /** Parsed Retry-After in milliseconds, when the provider sent one. */
  readonly retryAfterMs?: number;
};

export type QuotaVerdict = {
  readonly family: QuotaFamily;
  readonly disposition: QuotaDisposition;
  readonly hint: QuotaHint;
  /** The provider's code, preserved for the artefact; absent when the body had none. */
  readonly code?: string;
};

/** The error code a provider may put at the top level or inside an `error` object. */
function firstString(...values: readonly unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
  }
  return undefined;
}

/**
 * Parse a provider error body into the narrow fields the classifier reads.
 *
 * Both shapes occur in the wild: BigModel's `{ error: { code, message } }` and the GLM
 * Coding Plan's `{ code: 1113, msg: "..." }`. A body that is not JSON yields no code and no
 * message — a gateway's HTML error page is not evidence of a quota family. The status and
 * Retry-After are supplied by the driver because they are headers, not body fields.
 */
export function quotaReplyFrom(
  status: number,
  retryAfterMs: number | undefined,
  body: string | undefined,
): QuotaReply {
  let parsed: Record<string, unknown> = {};
  if (body !== undefined && body.trim() !== '') {
    try {
      const value: unknown = JSON.parse(body);
      if (typeof value === 'object' && value !== null) parsed = value as Record<string, unknown>;
    } catch {
      parsed = {};
    }
  }
  const error = parsed['error'];
  const nested = typeof error === 'object' && error !== null ? (error as Record<string, unknown>) : {};
  const code = firstString(nested['code'], nested['type'], parsed['code']);
  const message = firstString(nested['message'], nested['msg'], parsed['message'], parsed['msg']);
  return {
    status,
    ...(code === undefined ? {} : { code }),
    ...(message === undefined ? {} : { message }),
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
  };
}

/**
 * The decision a driver acts on, derived from a verdict plus the driver's own backoff.
 *
 * Keeping this as a pure function means the place that burns the deadline (the retry loop)
 * and the place that names the failure share one rule. A terminal reply is refused before
 * the backoff is ever asked for, so a top-up, a window reset or a key change cannot be
 * mistaken for "not now, sleep 1s and try again".
 */
export type RetryAdvice =
  | {
      readonly retry: true;
      readonly waitMs: number;
      readonly family: QuotaFamily;
      readonly hint: QuotaHint;
    }
  | {
      readonly retry: false;
      readonly family: QuotaFamily;
      readonly hint: QuotaHint;
      readonly reason: string;
    };

/**
 * Decide whether to retry and how long to wait.
 *
 * `backoff` is supplied by the driver (attempt index in, milliseconds out) because the retry
 * schedule belongs to the caller. A provider's Retry-After always wins over the backoff.
 */
export function quotaRetryAdvice(
  reply: QuotaReply,
  attempt: number,
  backoff: (attempt: number) => number,
): RetryAdvice {
  const verdict = classifyQuotaFailure(reply);
  if (verdict.disposition === 'retry') {
    return {
      retry: true,
      waitMs: reply.retryAfterMs ?? backoff(attempt),
      family: verdict.family,
      hint: verdict.hint,
    };
  }
  const reason =
    verdict.disposition === 'wait-until'
      ? `wait for reset: ${verdict.hint} (family ${verdict.family})`
      : `stop, retry cannot help: ${verdict.hint} (family ${verdict.family})`;
  return { retry: false, family: verdict.family, hint: verdict.hint, reason };
}

const lower = (value: string | undefined): string => (value ?? '').toLowerCase();

/** Numeric GLM Coding Plan codes that ask for a plain exponential backoff. */
const CODING_BACKOFF = new Set(['1302', '1305']);
/** Numeric GLM Coding Plan codes whose reset time is reported as next_flush_time. */
const CODING_RESET = new Set(['1308', '1310', '1316', '1317', '1318', '1319', '1320', '1321']);
/** Numeric GLM Coding Plan codes that need a top-up. */
const CODING_BALANCE = new Set(['1113', '1311', '1309']);
/** Numeric GLM Coding Plan codes that need a different key or product. */
const CODING_CONFIG = new Set(['1313', '1314', '1315']);
/** Substrings a spend-window reply carries in its message. */
const WINDOW_MARKERS = [
  'spend limit',
  '5-hour',
  'daily spend',
  '7-day',
  'next_flush_time',
  'usage limit reached',
  // The provider's Chinese-language window message. Written as escapes so the source stays
  // ASCII: the repo audit forbids CJK text in code, but the runtime marker must match the reply.
  '\u9650\u989d',
] as const;

function verdict(family: QuotaFamily, disposition: QuotaDisposition, hint: QuotaHint, code?: string): QuotaVerdict {
  return { family, disposition, hint, ...(code === undefined ? {} : { code }) };
}

/**
 * Classify one reply. The order is the order of specificity: a terminal balance or cap
 * outranks a rate limit because a 429 can carry a spend-limit message, and the caller must
 * not retry a request that only a top-up or a window reset can unblock.
 */
export function classifyQuotaFailure(reply: QuotaReply): QuotaVerdict {
  const status = reply.status;
  const code = lower(reply.code);
  const message = lower(reply.message);
  const original = reply.code;
  const withCode = (family: QuotaFamily, disposition: QuotaDisposition, hint: QuotaHint): QuotaVerdict =>
    verdict(family, disposition, hint, original);

  // Out of credit is a 403, not a 429. No retry and no wait can repair it here.
  if (status === 403) return withCode('balance.insufficient', 'stop', 'top-up');

  // A self-imposed account spend cap has a Retry-After pointing at the reset, not at the
  // next attempt. Waiting is a decision the caller makes once, outside the retry loop.
  if (status === 402) return withCode('window.cap', 'wait-until', 'wait-for-spend-cap-reset');

  // Provider-side faults are the one family where repeating the same request is the repair.
  if (status >= 500) return withCode('server', 'retry', 'backoff-retry');

  if (status === 429) {
    // NO_RETRY codes and balance codes first, before any rate-limit interpretation.
    if (code === 'api_key_quota_exhausted') return withCode('key.quota', 'stop', 'raise-key-quota');
    if (code === 'usage_limit_exceeded') return withCode('window.subscription', 'wait-until', 'wait-for-subscription-reset');
    if (code === 'insufficient_balance') return withCode('balance.insufficient', 'stop', 'top-up');

    if (code !== undefined && CODING_BALANCE.has(code)) return withCode('balance.insufficient', 'stop', 'top-up');
    if (code !== undefined && CODING_CONFIG.has(code)) return withCode('coding.config', 'stop', 'fix-key-or-plan');
    if (code !== undefined && CODING_RESET.has(code)) return withCode('coding.reset', 'wait-until', 'wait-for-next-flush');
    if (code !== undefined && CODING_BACKOFF.has(code)) return withCode('coding.backoff', 'retry', 'backoff-retry');

    // A spend window can arrive under a generic rate_limit_exceeded code; the message is
    // the only discriminator. The reference client's own filter uses the same idea.
    if (WINDOW_MARKERS.some((marker) => message.includes(marker))) {
      return withCode('window.spend', 'wait-until', 'wait-for-window-reset');
    }

    if (code === 'rate_limit_error') {
      if (message.includes('concurrency limit exceeded') || message.includes('too many pending requests')) {
        return withCode('rate.concurrency', 'retry', 'reduce-parallelism-and-backoff');
      }
      return withCode('rate.upstream', 'retry', 'backoff-retry');
    }
    if (code === 'rate_limit_exceeded' && reply.retryAfterMs !== undefined) {
      return withCode('rate.rpm', 'retry', 'honor-retry-after');
    }
    // An unclassified 429 is still a rate limit by the provider's own guidance: back off
    // and retry. It is never silently read as "out of credit".
    return withCode('rate.unclassified', 'retry', 'backoff-retry');
  }

  // The three 4xx codes that mean "not now" rather than "not this".
  if (status === 408 || status === 409 || status === 425) {
    return withCode('transient.4xx', 'retry', 'backoff-retry');
  }

  return withCode('refusal', 'stop', 'fix-request-or-key');
}
