import { describe, expect, it } from 'vitest';
import { compareToPublished, l4Verdict, meanPassAtK, passAtK } from '../passk.js';

describe('pass^k', () => {
  it('is the unbiased estimator, not the plugged-in power', () => {
    // 3 of 4 successes: C(3,4)=0 -> a single failure in four trials means the
    // agent cannot be relied on four times in a row. (3/4)^4 would say 0.32.
    expect(passAtK({ successes: 3, trials: 4, k: 4 })).toBe(0);
    expect(passAtK({ successes: 4, trials: 4, k: 4 })).toBe(1);
    // 2 of 4 at k=2: C(2,2)/C(4,2) = 1/6 — one of the six pairs is both.
    expect(passAtK({ successes: 2, trials: 4, k: 2 })).toBeCloseTo(1 / 6, 6);
    // 3 of 4 at k=2: C(3,2)/C(4,2) = 3/6.
    expect(passAtK({ successes: 3, trials: 4, k: 2 })).toBeCloseTo(0.5, 6);
  });

  it('averages over tasks, one vote each', () => {
    expect(meanPassAtK([])).toBe(0);
    expect(
      meanPassAtK([
        { successes: 4, trials: 4, k: 4 },
        { successes: 0, trials: 4, k: 4 },
      ]),
    ).toBeCloseTo(0.5, 6);
  });

  it('rejects inputs that would silently produce a wrong denominator', () => {
    expect(() => passAtK({ successes: 1, trials: 4, k: 0 })).toThrow(/k must be/);
    expect(() => passAtK({ successes: 5, trials: 4, k: 2 })).toThrow(/cannot exceed/);
    expect(() => passAtK({ successes: -1, trials: 4, k: 2 })).toThrow(/non-negative/);
    expect(() => passAtK({ successes: 1, trials: -4, k: 2 })).toThrow(/non-negative/);
    expect(passAtK({ successes: 1, trials: 2, k: 4 })).toBe(0);
  });

  it('compares against a published number only through the stated bar', () => {
    const compared = compareToPublished(0.675, 0.575, 0.05);
    expect(compared.delta).toBeCloseTo(0.1, 6);
    expect(compared.meets).toBe(true);
    expect(compareToPublished(0.6, 0.575, 0.05).meets).toBe(false);
  });
});

describe('the L4 gate', () => {
  const full = Array.from({ length: 60 }, () => ({ successes: 4, trials: 4, k: 4 }));

  it('keeps the effect and the coverage as two clauses', () => {
    const good = l4Verdict({ tasks: full, published: 0.575, bar: 0.05 });
    expect(good.pass4).toBe(1);
    expect(good.meetsBar).toBe(true);
    expect(good.coversSplit).toBe(true);

    // A short split can look like a win: the two clauses must disagree here.
    const short = l4Verdict({ tasks: full.slice(0, 12), published: 0.575, bar: 0.05 });
    expect(short.meetsBar).toBe(true);
    expect(short.coversSplit).toBe(false);
  });

  it('fails the bar honestly when the effect is small', () => {
    const flat = Array.from({ length: 60 }, () => ({ successes: 2, trials: 4, k: 4 }));
    const verdict = l4Verdict({ tasks: flat, published: 0.575, bar: 0.05 });
    expect(verdict.pass4).toBe(0);
    expect(verdict.meetsBar).toBe(false);
    expect(verdict.coversSplit).toBe(true);
  });
});
