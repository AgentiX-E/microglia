import { describe, expect, it } from 'vitest';
import { armBillLine, armBillMetrics, armBillOf, artefactBillOf } from '../arm-bill.js';

/**
 * Three states, not two.
 *
 * The τ² lane wrote `calls: 0` as a literal on every arm while its driver had been counting provider
 * calls for a dozen rounds, and the two files that read one run disagreed about it. The tests below
 * pin the distinction that removes the ambiguity: a census (measured calls and tokens), a count
 * (measured calls, unmeasured tokens), and silence (nothing measured at all) — which must never be
 * spelled the same way as a measured zero.
 */
describe('reading an arm\u2019s bill', () => {
  it('carries every column a census measured', () => {
    const bill = armBillOf({
      calls: 2_667,
      prompt_tokens: 1_203_441,
      completion_tokens: 18_002,
      cached_tokens: 1_150_000,
      uncached_tokens: 53_441,
    });
    expect(bill).toEqual({
      calls: 2_667,
      source: 'census',
      promptTokens: 1_203_441,
      completionTokens: 18_002,
      uncachedTokens: 53_441,
    });
  });

  it('treats a census that measured zero as measured, not as silence', () => {
    const bill = armBillOf({ calls: 0 });
    expect(bill.source).toBe('census');
    expect(bill.calls).toBe(0);
  });

  it('falls back to the recorded count when the census reported none', () => {
    const bill = armBillOf({ calls: null, prompt_tokens: 10 }, 42);
    expect(bill).toEqual({ calls: 42, source: 'count' });
  });

  it('reads a recorded zero as silence, because that is the literal this module exists to stop', () => {
    expect(armBillOf(undefined, 0).source).toBe('absent');
    expect(armBillOf(undefined, 0).calls).toBe(0);
  });

  it('refuses a negative or non-finite count rather than averaging it in', () => {
    expect(armBillOf(undefined, -3).source).toBe('absent');
    expect(armBillOf(undefined, Number.NaN).source).toBe('absent');
    expect(armBillOf({ calls: -1 }, 7)).toEqual({ calls: 7, source: 'count' });
  });

  it('reports silence when neither channel said anything', () => {
    expect(armBillOf()).toEqual({ calls: 0, source: 'absent' });
  });

  it('drops a token field the census did not measure, instead of writing a zero for it', () => {
    const bill = armBillOf({ calls: 3, prompt_tokens: null, completion_tokens: 9 });
    expect(bill.promptTokens).toBeUndefined();
    expect(bill.completionTokens).toBe(9);
    expect(bill.uncachedTokens).toBeUndefined();
  });
});

describe('reading a written artefact\u2019s bill', () => {
  it('prefers the root census over the projection the same object was copied into', () => {
    const bill = artefactBillOf({
      calls: 999,
      usage: { calls: 12 },
      tau2: { usage: { calls: 12, prompt_tokens: 400 } },
    });
    expect(bill.calls).toBe(12);
    expect(bill.source).toBe('census');
    // The root block wins, so its own columns are the ones read — not a merge of two shapes.
    expect(bill.promptTokens).toBeUndefined();
  });

  it('reads the projection on an artefact written before the root field existed', () => {
    const bill = artefactBillOf({ tau2: { usage: { calls: 7, uncached_tokens: 70 } } });
    expect(bill).toEqual({ calls: 7, source: 'census', uncachedTokens: 70 });
  });

  it('reads the count on an artefact that carries no census at all', () => {
    expect(artefactBillOf({ calls: 5 }).source).toBe('count');
  });
});

describe('the flags an artefact writes', () => {
  it('writes `0/0` for a census and its columns', () => {
    expect(armBillMetrics({ calls: 4, source: 'census', promptTokens: 40, uncachedTokens: 4 })).toEqual({
      usage_absent: 0,
      usage_counted: 0,
      prompt_tokens: 40,
      uncached_tokens: 4,
    });
    expect(
      armBillMetrics({ calls: 4, source: 'census', promptTokens: 40, completionTokens: 9, uncachedTokens: 4 }),
    ).toMatchObject({ completion_tokens: 9 });
  });

  it('writes `0/1` for a count, with no token column to imply one was measured', () => {
    expect(armBillMetrics({ calls: 4, source: 'count' })).toEqual({ usage_absent: 0, usage_counted: 1 });
  });

  it('writes `1/0` for silence', () => {
    expect(armBillMetrics({ calls: 0, source: 'absent' })).toEqual({ usage_absent: 1, usage_counted: 0 });
  });
});

describe('the sentence beside the flags', () => {
  it('spells out a full census', () => {
    expect(
      armBillLine({ calls: 2_667, source: 'census', promptTokens: 1_203_441, uncachedTokens: 53_441, completionTokens: 18_002 }),
    ).toBe(
      'Bill (census): 2667 provider call(s), 1203441 prompt token(s) of which 53441 uncached, 18002 completion token(s).',
    );
  });

  it('says a census printed no totals instead of printing zero tokens', () => {
    expect(armBillLine({ calls: 3, source: 'census' })).toBe(
      'Bill (census): 3 provider call(s), the phase printed no token totals.',
    );
  });

  it('omits the clauses the census did not fill', () => {
    expect(armBillLine({ calls: 3, source: 'census', promptTokens: 30 })).toBe(
      'Bill (census): 3 provider call(s), 30 prompt token(s).',
    );
    expect(armBillLine({ calls: 3, source: 'census', promptTokens: 30, completionTokens: 9 })).toBe(
      'Bill (census): 3 provider call(s), 30 prompt token(s), 9 completion token(s).',
    );
  });

  it('names a count as a count, because its tokens were never measured', () => {
    expect(armBillLine({ calls: 12, source: 'count' }, 'First arm\u2019s bill')).toBe(
      'First arm\u2019s bill (count only): 12 provider call(s) recorded; the artefact carries no token census, so its tokens are unmeasured rather than zero.',
    );
  });

  it('says silence is silence rather than a zero', () => {
    const line = armBillLine({ calls: 0, source: 'absent' });
    expect(line).toContain('unmeasured');
    expect(line).toContain('"nobody counted"');
  });
});
