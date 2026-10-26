import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RETIREMENT,
  creditHistogram,
  parseRetirementPolicy,
  retireeFrom,
  type ValidationCredit,
} from '../validation.js';

const creditOf = (entries: Record<string, ValidationCredit>): Map<string, ValidationCredit> =>
  new Map(Object.entries(entries));

describe('retireeFrom', () => {
  it('retires a rule that failed every time it was injected', () => {
    expect(retireeFrom(creditOf({ a: { trials: 2, failures: 2 } }))).toEqual(['a']);
  });

  it('keeps a rule that succeeded more often than it failed', () => {
    // 1 of 3 is a rule present at a mistake, not a rule that causes one.
    expect(retireeFrom(creditOf({ a: { trials: 3, failures: 1 } }))).toEqual([]);
  });

  it('retires at exactly the policy share, so the boundary is the stated one', () => {
    const policy = { minTrials: 2, failureRate: 0.5 };
    expect(retireeFrom(creditOf({ a: { trials: 2, failures: 1 } }), policy)).toEqual(['a']);
    expect(retireeFrom(creditOf({ a: { trials: 2, failures: 1 } }), { minTrials: 2, failureRate: 0.6 })).toEqual([]);
  });

  it('refuses to act on a single trial however it went', () => {
    // The regression this exists for: the first version retired on one failure, and a
    // stand-in endpoint that always answered wrongly retired every rule it touched.
    expect(retireeFrom(creditOf({ a: { trials: 1, failures: 1 } }))).toEqual([]);
    expect(retireeFrom(creditOf({ a: { trials: 1, failures: 1 } }), { minTrials: 1, failureRate: 0.5 })).toEqual([
      'a',
    ]);
  });

  it('sorts, so the same credit always produces the same deletion', () => {
    const credit = creditOf({
      c: { trials: 2, failures: 2 },
      a: { trials: 2, failures: 2 },
      b: { trials: 4, failures: 4 },
    });
    expect(retireeFrom(credit)).toEqual(['a', 'b', 'c']);
  });

  it('retires nothing when nothing was ever injected', () => {
    expect(retireeFrom(new Map())).toEqual([]);
  });

  it('applies the default policy when none is given', () => {
    const credit = creditOf({ a: { trials: 2, failures: 2 }, b: { trials: 5, failures: 1 } });
    expect(retireeFrom(credit)).toEqual(['a']);
    expect(retireeFrom(credit, DEFAULT_RETIREMENT)).toEqual(['a']);
  });
});

describe('parseRetirementPolicy', () => {
  it('defaults both knobs when they are absent', () => {
    expect(parseRetirementPolicy({})).toEqual(DEFAULT_RETIREMENT);
  });

  it('treats an empty string as absent, because a workflow passes one for unset inputs', () => {
    expect(parseRetirementPolicy({ minTrials: '', failureRate: '' })).toEqual(DEFAULT_RETIREMENT);
  });

  it('reads both knobs', () => {
    expect(parseRetirementPolicy({ minTrials: '4', failureRate: '0.75' })).toEqual({ minTrials: 4, failureRate: 0.75 });
  });

  it('refuses a trial floor that is not a whole number', () => {
    expect(() => parseRetirementPolicy({ minTrials: '2.5' })).toThrow(/whole number/);
    expect(() => parseRetirementPolicy({ minTrials: '0' })).toThrow(/whole number/);
    expect(() => parseRetirementPolicy({ minTrials: 'many' })).toThrow(/whole number/);
  });

  it('refuses a share outside the interval, including a zero that would retire everything', () => {
    expect(() => parseRetirementPolicy({ failureRate: '0' })).toThrow(/share/);
    expect(() => parseRetirementPolicy({ failureRate: '1.5' })).toThrow(/share/);
    expect(() => parseRetirementPolicy({ failureRate: 'half' })).toThrow(/share/);
  });

  it('accepts a share of exactly one, which retires only the never-successful', () => {
    expect(parseRetirementPolicy({ failureRate: '1' })).toEqual({ minTrials: 2, failureRate: 1 });
  });
});

describe('creditHistogram', () => {
  it('counts rules by observed share, so a threshold that retired nothing is explainable', () => {
    const credit = creditOf({
      a: { trials: 2, failures: 0 },
      b: { trials: 2, failures: 1 },
      c: { trials: 2, failures: 1 },
      d: { trials: 3, failures: 1 },
    });
    expect(creditHistogram(credit)).toEqual({ '0/2': 1, '1/2': 2, '1/3': 1 });
  });

  it('is empty when no rule was injected', () => {
    expect(creditHistogram(new Map())).toEqual({});
  });
});
