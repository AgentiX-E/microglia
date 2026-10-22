import { describe, expect, it } from 'vitest';
import { reachableRecovery, reachableShare, scopePair } from '../pairs.js';

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
