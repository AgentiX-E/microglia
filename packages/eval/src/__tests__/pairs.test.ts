import { describe, expect, it } from 'vitest';
import { pairVerdict, reachableRecovery, reachableShare, scopePair } from '../pairs.js';

const train = [
  { domain: 'sales', intent: 'trend' },
  { domain: 'hr', intent: 'trend' },
];

describe('reachable headroom', () => {
  it('keys on domain and intent, so a rule can travel only where both were seen', () => {
    expect(scopePair({ domain: 'sales', intent: 'trend' })).toBe('sales\u0000trend');
    expect(
      reachableShare(train, [
        { domain: 'sales', intent: 'trend' },
        { domain: 'ops', intent: 'trend' },
      ]),
    ).toBe(0.5);
  });

  it('reports 0 for an empty evaluation set rather than NaN', () => {
    expect(reachableShare(train, [])).toBe(0);
  });

  it('refuses a ratio when nothing was reachable', () => {
    const blocked = reachableRecovery({
      training: train,
      evaluated: [{ domain: 'ops', intent: 'comparison' }],
      arm: 0.55,
      baseline: 0.32,
      oracle: 1,
    });
    expect(blocked).toEqual({ reachable: 0, ratio: 0 });
  });

  it('keeps the reachable share beside the ratio, never blended into it', () => {
    const mixed = reachableRecovery({
      training: train,
      evaluated: [
        { domain: 'sales', intent: 'trend' },
        { domain: 'ops', intent: 'trend' },
      ],
      arm: 0.66,
      baseline: 0.32,
      oracle: 1,
    });
    expect(mixed.reachable).toBe(0.5);
    expect(mixed.ratio).toBeCloseTo(0.5, 6);
    // No headroom and no gain are both answered, not thrown.
    expect(reachableRecovery({ training: train, evaluated: train, arm: 1, baseline: 1, oracle: 1 }).ratio).toBe(0);
    expect(reachableRecovery({ training: train, evaluated: train, arm: 0.1, baseline: 0.3, oracle: 1 }).ratio).toBe(0);
  });
});

describe('the pair contrast verdict', () => {
  const base = {
    training: train,
    evaluated: train,
    baseline: 0.32,
    oracle: 1,
    bar: 0.05,
  };

  it('reports both recoveries and the difference they rest on', () => {
    const verdict = pairVerdict({ ...base, single: 0.66, pair: 0.83 });
    expect(verdict.singleRecovery).toBeCloseTo(0.5, 6);
    expect(verdict.pairRecovery).toBeCloseTo(0.75, 6);
    expect(verdict.delta).toBeCloseTo(0.25, 6);
    expect(verdict.pairHelps).toBe(true);
  });

  it('refuses to call a difference below the bar an improvement', () => {
    const verdict = pairVerdict({ ...base, single: 0.66, pair: 0.665 });
    expect(verdict.pairHelps).toBe(false);
  });

  it('refuses a verdict on a corpus with no reachable headroom', () => {
    const verdict = pairVerdict({
      ...base,
      training: [],
      evaluated: train,
      single: 0.9,
      pair: 0.95,
    });
    expect(verdict.reachable).toBe(0);
    expect(verdict.pairHelps).toBe(false);
  });
});
