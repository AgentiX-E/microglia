import { describe, expect, it } from 'vitest';
import {
  classifyQuotaFailure,
  quotaReplyFrom,
  quotaRetryAdvice,
  type QuotaDisposition,
  type QuotaFamily,
} from '../quota-disposition.js';

/**
 * A 429 is a family, not a verdict. BigModel's own rate-limit page (retrieved 27 Nov 2026)
 * separates a retryable rate limit (concurrency / RPM, the latter with Retry-After) from a
 * spend window, a subscription cap, a key quota, and — crucially — a balance failure, which
 * is HTTP 403 `INSUFFICIENT_BALANCE`, not 429 at all. The old embed probe retried every
 * non-2xx four times with a linear backoff, so a terminal balance error burned ten seconds
 * and reported no family. These assertions pin the classification before any caller uses it.
 */

const verdict = (status: number, code?: string, message?: string, retryAfterMs?: number) =>
  classifyQuotaFailure({ status, code, message, retryAfterMs });

describe('quotaReplyFrom', () => {
  it('reads an error object with code and message', () => {
    expect(quotaReplyFrom(429, 2000, JSON.stringify({ error: { code: 'rate_limit_exceeded', message: 'slow down' } }))).toEqual({
      status: 429,
      code: 'rate_limit_exceeded',
      message: 'slow down',
      retryAfterMs: 2000,
    });
  });

  it('reads a top-level code and a message', () => {
    expect(quotaReplyFrom(429, undefined, JSON.stringify({ code: 'API_KEY_QUOTA_EXHAUSTED' })).code).toBe(
      'API_KEY_QUOTA_EXHAUSTED',
    );
    expect(quotaReplyFrom(400, undefined, JSON.stringify({ message: 'bad body' })).message).toBe('bad body');
  });

  it('reads a type alias inside an error object', () => {
    expect(quotaReplyFrom(429, undefined, JSON.stringify({ error: { type: 'rate_limit_error' } })).code).toBe('rate_limit_error');
  });

  it('reads a numeric GLM coding-plan code and a msg field', () => {
    const reply = quotaReplyFrom(429, undefined, JSON.stringify({ code: 1113, msg: 'Insufficient balance' }));
    expect(reply.code).toBe('1113');
    expect(reply.message).toBe('Insufficient balance');
  });

  it('does not invent a code or message from a non-JSON body', () => {
    const reply = quotaReplyFrom(503, undefined, '<html>gateway</html>');
    expect(reply.code).toBeUndefined();
    expect(reply.message).toBeUndefined();
    expect(reply.retryAfterMs).toBeUndefined();
  });

  it('accepts an absent body', () => {
    expect(quotaReplyFrom(429, 3000, undefined)).toEqual({ status: 429, code: undefined, message: undefined, retryAfterMs: 3000 });
  });
});

describe('classifyQuotaFailure — balance and caps are not a 429 to retry', () => {
  it('names a 403 INSUFFICIENT_BALANCE a terminal top-up, whatever the body says', () => {
    const v = verdict(403, 'INSUFFICIENT_BALANCE', 'Insufficient balance or no resource package. Please recharge.');
    expect(v).toMatchObject({ family: 'balance.insufficient', disposition: 'stop', hint: 'top-up' } satisfies Partial<ReturnType<typeof classifyQuotaFailure>>);
  });

  it('names a 402 spend_cap_reached a wait-until reset, not a retry', () => {
    const v = verdict(402, 'spend_cap_reached', 'weekly spend cap reached', 3600_000);
    expect(v).toMatchObject({ family: 'window.cap', disposition: 'wait-until', hint: 'wait-for-spend-cap-reset' });
  });

  it('stops at a 429 key quota (a NO_RETRY code)', () => {
    expect(verdict(429, 'API_KEY_QUOTA_EXHAUSTED')).toMatchObject({ family: 'key.quota', disposition: 'stop', hint: 'raise-key-quota' });
  });

  it('waits at a 429 subscription limit (a NO_RETRY code)', () => {
    expect(verdict(429, 'USAGE_LIMIT_EXCEEDED')).toMatchObject({ family: 'window.subscription', disposition: 'wait-until', hint: 'wait-for-subscription-reset' });
  });

  it('stops at a 429 whose code is a balance code', () => {
    expect(verdict(429, 'INSUFFICIENT_BALANCE')).toMatchObject({ family: 'balance.insufficient', disposition: 'stop' });
  });
});

describe('classifyQuotaFailure — GLM coding-plan numeric codes', () => {
  it('backoff-retries 1302 and 1305', () => {
    for (const code of ['1302', '1305']) {
      expect(verdict(429, code)).toMatchObject({ family: 'coding.backoff', disposition: 'retry', hint: 'backoff-retry' });
    }
  });

  it('waits for next_flush_time on 1308, 1310 and 1316-1321', () => {
    for (const code of ['1308', '1310', '1316', '1317', '1318', '1319', '1320', '1321']) {
      expect(verdict(429, code)).toMatchObject({ family: 'coding.reset', disposition: 'wait-until', hint: 'wait-for-next-flush' });
    }
  });

  it('stops on the balance codes 1113, 1311, 1309', () => {
    for (const code of ['1113', '1311', '1309']) {
      expect(verdict(429, code)).toMatchObject({ family: 'balance.insufficient', disposition: 'stop', hint: 'top-up' });
    }
  });

  it('stops on the key/product codes 1313, 1314, 1315', () => {
    for (const code of ['1313', '1314', '1315']) {
      expect(verdict(429, code)).toMatchObject({ family: 'coding.config', disposition: 'stop', hint: 'fix-key-or-plan' });
    }
  });
});

describe('classifyQuotaFailure — retryable rate limits', () => {
  it('classifies a concurrency rate_limit_error as reduce-parallelism', () => {
    expect(verdict(429, 'rate_limit_error', 'Concurrency limit exceeded for user, please retry later')).toMatchObject({
      family: 'rate.concurrency',
      disposition: 'retry',
      hint: 'reduce-parallelism-and-backoff',
    });
    expect(verdict(429, 'rate_limit_error', 'Too many pending requests, please retry later').family).toBe('rate.concurrency');
  });

  it('honours Retry-After on an RPM rate_limit_exceeded', () => {
    expect(verdict(429, 'rate_limit_exceeded', 'rate limit exceeded', 2000)).toMatchObject({
      family: 'rate.rpm',
      disposition: 'retry',
      hint: 'honor-retry-after',
    });
  });

  it('treats an upstream rate_limit_error without a concurrency message as backoff', () => {
    expect(verdict(429, 'rate_limit_error')).toMatchObject({ family: 'rate.upstream', disposition: 'retry', hint: 'backoff-retry' });
  });

  it('treats an unclassified 429 as a retryable rate limit, not a balance', () => {
    expect(verdict(429)).toMatchObject({ family: 'rate.unclassified', disposition: 'retry', hint: 'backoff-retry' });
  });

  it('recognises a spend window from its message even under a generic code', () => {
    for (const message of [
      'This API key has reached its 5-hour spend limit',
      'daily spend limit reached',
      '7-day spend limit reached',
      'usage limit reached, next_flush_time is 2026-11-28T00:00:00Z',
      '\u5f53\u524dKey\u5df2\u89e6\u53d1\u9650\u989d',
    ]) {
      expect(verdict(429, 'rate_limit_exceeded', message)).toMatchObject({
        family: 'window.spend',
        disposition: 'wait-until',
        hint: 'wait-for-window-reset',
      });
    }
  });

  it('matches message and code case-insensitively', () => {
    expect(verdict(429, 'Rate_Limit_Error', 'CONCURRENCY LIMIT EXCEEDED').family).toBe('rate.concurrency');
    expect(verdict(403, 'insufficient_balance').family).toBe('balance.insufficient');
  });
});

describe('classifyQuotaFailure — server and client refusals', () => {
  it('backoff-retries 5xx', () => {
    expect(verdict(500)).toMatchObject({ family: 'server', disposition: 'retry', hint: 'backoff-retry' });
    expect(verdict(503)).toMatchObject({ family: 'server', disposition: 'retry' });
  });

  it('backoff-retries the three 4xx codes that ask for the same request', () => {
    for (const status of [408, 409, 425]) {
      expect(verdict(status)).toMatchObject({ family: 'transient.4xx', disposition: 'retry', hint: 'backoff-retry' });
    }
  });

  it('stops at a plain client refusal', () => {
    for (const status of [400, 401, 404]) {
      expect(verdict(status)).toMatchObject({ family: 'refusal', disposition: 'stop', hint: 'fix-request-or-key' });
    }
  });

  it('gives every disposition exactly one of the three actions', () => {
    const all: readonly QuotaDisposition[] = ['retry', 'wait-until', 'stop'];
    const families: readonly QuotaFamily[] = [
      'balance.insufficient', 'window.cap', 'key.quota', 'window.subscription',
      'coding.backoff', 'coding.reset', 'coding.config',
      'rate.concurrency', 'rate.rpm', 'rate.upstream', 'rate.unclassified', 'window.spend',
      'server', 'transient.4xx', 'refusal',
    ];
    const seen = new Set<string>();
    for (const family of families) {
      const source: Record<QuotaFamily, () => ReturnType<typeof classifyQuotaFailure>> = {
        'balance.insufficient': () => verdict(403),
        'window.cap': () => verdict(402),
        'key.quota': () => verdict(429, 'API_KEY_QUOTA_EXHAUSTED'),
        'window.subscription': () => verdict(429, 'USAGE_LIMIT_EXCEEDED'),
        'coding.backoff': () => verdict(429, '1302'),
        'coding.reset': () => verdict(429, '1308'),
        'coding.config': () => verdict(429, '1313'),
        'rate.concurrency': () => verdict(429, 'rate_limit_error', 'Concurrency limit exceeded'),
        'rate.rpm': () => verdict(429, 'rate_limit_exceeded', 'x', 1000),
        'rate.upstream': () => verdict(429, 'rate_limit_error'),
        'rate.unclassified': () => verdict(429),
        'window.spend': () => verdict(429, 'rate_limit_exceeded', '5-hour spend limit'),
        server: () => verdict(500),
        'transient.4xx': () => verdict(408),
        refusal: () => verdict(400),
      };
      const v = source[family]();
      expect(v.family).toBe(family);
      expect(all).toContain(v.disposition);
      seen.add(v.disposition);
    }
    expect([...seen].sort()).toEqual(['retry', 'stop', 'wait-until']);
  });
});

describe('quotaRetryAdvice — the decision a driver acts on', () => {
  const linear = (attempt: number) => 1000 * (attempt + 1);

  it('retries a rate limit with the provider wait when present', () => {
    const advice = quotaRetryAdvice({ status: 429, code: 'rate_limit_exceeded', retryAfterMs: 3000 }, 0, linear);
    expect(advice).toMatchObject({ retry: true, waitMs: 3000, family: 'rate.rpm' });
  });

  it('retries a rate limit with the driver backoff when no header was sent', () => {
    const advice = quotaRetryAdvice({ status: 429, code: 'rate_limit_error', message: 'Concurrency limit exceeded' }, 2, linear);
    expect(advice).toMatchObject({ retry: true, waitMs: 3000, family: 'rate.concurrency' });
  });

  it('stops immediately on a balance failure, with no wait', () => {
    const advice = quotaRetryAdvice({ status: 403, code: 'INSUFFICIENT_BALANCE' }, 0, linear);
    expect(advice.retry).toBe(false);
    if (!advice.retry) {
      expect(advice.family).toBe('balance.insufficient');
      expect(advice.hint).toBe('top-up');
      expect(advice.reason).toMatch(/stop/i);
    }
  });

  it('stops on a NO_RETRY key quota, whatever the attempt', () => {
    const advice = quotaRetryAdvice({ status: 429, code: 'API_KEY_QUOTA_EXHAUSTED' }, 3, linear);
    expect(advice.retry).toBe(false);
    if (!advice.retry) expect(advice.hint).toBe('raise-key-quota');
  });

  it('reports a spend window as a wait, not a retry, with the reset hint', () => {
    const advice = quotaRetryAdvice({ status: 429, code: 'rate_limit_exceeded', message: '5-hour spend limit' }, 0, linear);
    expect(advice.retry).toBe(false);
    if (!advice.retry) {
      expect(advice.hint).toBe('wait-for-window-reset');
      expect(advice.reason).toMatch(/wait/i);
    }
  });

  it('never calls the backoff for a terminal decision', () => {
    let calls = 0;
    const counting = (attempt: number) => {
      calls += 1;
      return linear(attempt);
    };
    quotaRetryAdvice({ status: 403, code: 'INSUFFICIENT_BALANCE' }, 0, counting);
    expect(calls).toBe(0);
    quotaRetryAdvice({ status: 500 }, 0, counting);
    expect(calls).toBe(1);
  });
});
