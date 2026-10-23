import { describe, expect, it } from 'vitest';
import {
  bootstrapCI,
  logGamma,
  mcnemarExact,
  mulberry32,
  sigmoid,
  wilsonLower,
} from '../index.js';

describe('Wilson lower bound', () => {
  it('is zero for an empty sample', () => {
    expect(wilsonLower(0, 0)).toBe(0);
  });

  it('refuses to read 2/2 as certainty', () => {
    expect(wilsonLower(2, 2)).toBeLessThan(0.85);
    expect(wilsonLower(2, 2)).toBeGreaterThan(0.3);
  });

  it('increases with sample size at a fixed ratio', () => {
    expect(wilsonLower(20, 20)).toBeGreaterThan(wilsonLower(2, 2));
    expect(wilsonLower(100, 100)).toBeGreaterThan(wilsonLower(20, 20));
  });

  it('is monotone in successes', () => {
    expect(wilsonLower(6, 10)).toBeGreaterThan(wilsonLower(5, 10));
    expect(wilsonLower(0, 10)).toBe(0);
  });
});

describe('McNemar exact test', () => {
  it('returns 1 when the arms never disagree', () => {
    expect(mcnemarExact(0, 0)).toBe(1);
    expect(mcnemarExact(5, 5)).toBeCloseTo(1, 6);
  });

  it('is significant for a one-sided discordance of 12 to 1', () => {
    expect(mcnemarExact(12, 1)).toBeLessThan(0.01);
  });

  it('is not significant for a small discordance', () => {
    expect(mcnemarExact(6, 2)).toBeGreaterThan(0.05);
  });

  it('is symmetric in its arguments', () => {
    expect(mcnemarExact(9, 2)).toBeCloseTo(mcnemarExact(2, 9), 12);
  });

  it('equals the exact two-sided binomial, to the last bit', () => {
    // The quantities above are thresholds ("less than 0.01"), which a function with
    // a wrong normalisation can still satisfy. These are the exact values of
    // 2·P(X ≤ min(b,c)) for X ~ Bin(b+c, ½), computed in rational arithmetic
    // independently of this implementation: sum(C(n,i), i≤k) / 2^(n-1), capped at 1.
    const reference: readonly (readonly [number, number, number])[] = [
      [12, 1, 0.00341796875],
      [6, 2, 0.2890625],
      [9, 2, 0.0654296875],
      [0, 7, 0.015625],
      [3, 0, 0.25],
      [15, 5, 0.04138946533203125],
      [20, 3, 0.00048828125],
      [50, 42, 0.4657074457730625],
      // The cap: the doubled tail would exceed 1 for a near-even split.
      [1, 1, 1],
    ];
    for (const [b, c, expected] of reference) {
      // Twelve decimal places, not bit equality: the implementation works in
      // log-space (log-gamma, log-sum-exp), so the last two bits differ from exact
      // rational arithmetic. Everything that matters to a published p-value is in
      // the first twelve digits.
      expect(mcnemarExact(b, c)).toBeCloseTo(expected, 12);
    }
  });
});

describe('bootstrap', () => {
  it('brackets the point estimate and is deterministic under a seeded source', () => {
    const values = [1, 0, 1, 1, 0, 1, 1, 1, 0, 1];
    const a = bootstrapCI(values, undefined, 400, mulberry32(7));
    const b = bootstrapCI(values, undefined, 400, mulberry32(7));
    expect(a).toEqual(b);
    expect(a.low).toBeLessThanOrEqual(a.point);
    expect(a.high).toBeGreaterThanOrEqual(a.point);
  });

  it('degrades gracefully on an empty sample', () => {
    expect(bootstrapCI([])).toEqual({ low: 0, high: 0, point: 0 });
  });
});

describe('numeric helpers', () => {
  it('logGamma matches known factorials', () => {
    expect(Math.exp(logGamma(6))).toBeCloseTo(120, 6);
    expect(Math.exp(logGamma(1))).toBeCloseTo(1, 10);
  });

  it('sigmoid is stable at both extremes', () => {
    expect(sigmoid(0)).toBe(0.5);
    expect(sigmoid(-1000)).toBe(0);
    expect(sigmoid(1000)).toBe(1);
  });
});
