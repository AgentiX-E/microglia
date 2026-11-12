import { describe, expect, it } from 'vitest';
import { compareToPublished, holdRate, l4Verdict, meanPassAtK, passAtK } from '../passk.js';

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

describe('holdRate — does a pass at trial t predict a pass at t+1', () => {
  it('is undefined when no task carried an order, never zero', () => {
    // Zero would say the knowledge never held; the run cannot answer at all. The two are different
    // facts and the second one is the honest one for every artefact written before `outcomes` existed.
    const held = holdRate([
      { successes: 4, trials: 4, k: 4 },
      { successes: 3, trials: 4, k: 4 },
    ]);
    expect(held).toEqual({ ordered: 0, withoutOrder: 2, pairs: 0, held: 0, rate: undefined });
  });

  it('counts consecutive pairs inside a task, and pools rather than averaging', () => {
    // Task A is T,T,T,F: three pairs, two held. Task B is F,T,T,F: the first trial failed, so it opens
    // no pair; t1->t2 holds and t2->t3 does not. Pooled: 3 of 5 = 0.600. Averaging the two per-task
    // rates would give (0.667 + 0.500)/2 = 0.583, and the pooled number is the one the published metric
    // reports because a task with three pairs is more evidence than a task with two.
    const held = holdRate([
      { successes: 3, trials: 4, k: 4, outcomes: [true, true, true, false] },
      { successes: 2, trials: 4, k: 4, outcomes: [false, true, true, false] },
    ]);
    expect(held.pairs).toBe(5);
    expect(held.held).toBe(3);
    expect(held.rate).toBeCloseTo(0.6, 12);
  });

  it('counts a task that only ever failed as no evidence rather than as a miss', () => {
    // Recovery is a different measurement. Folding a never-passing task in as "not held" would make this
    // number a re-reading of pass^1 under another name.
    const held = holdRate([{ successes: 0, trials: 4, k: 4, outcomes: [false, false, false, false] }]);
    expect(held).toEqual({ ordered: 1, withoutOrder: 0, pairs: 0, held: 0, rate: undefined });
  });

  it('separates the two shapes a count cannot tell apart', () => {
    // Both are 2 of 4 successes. One alternates; the other passes twice and then fails twice. A count
    // records one artefact for both, which is the whole reason the order had to be written down.
    const alternating = holdRate([{ successes: 2, trials: 4, k: 4, outcomes: [true, false, true, false] }]);
    const frontloaded = holdRate([{ successes: 2, trials: 4, k: 4, outcomes: [true, true, false, false] }]);
    expect(frontloaded.rate).toBeCloseTo(0.5, 12);
    expect(alternating.rate).toBe(0);
    expect(frontloaded.pairs).toBe(2);
    expect(alternating.pairs).toBe(2);
  });
});
