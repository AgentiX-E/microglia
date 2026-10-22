import { describe, expect, it } from 'vitest';
import { compareToPublished, meanPassAtK, passAtK } from '../passk.js';

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
