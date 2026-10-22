import { describe, expect, it } from 'vitest';
import { recoveryRatio } from '../recovery.js';

describe('recovery ratio', () => {
  it('is the share of the gap the arm closed', () => {
    expect(recoveryRatio({ arm: 0.75, baseline: 0.5, oracle: 1 })).toBeCloseTo(0.5, 6);
    expect(recoveryRatio({ arm: 1, baseline: 0.32, oracle: 1 })).toBeCloseTo(1, 6);
  });

  it('answers the degenerate cases instead of throwing', () => {
    // Nothing to close: the corpus is already solved, so the arm cannot be blamed.
    expect(recoveryRatio({ arm: 0.9, baseline: 1, oracle: 1 })).toBe(1);
    // Worse than no memory: a negative share is not a ratio anyone can act on.
    expect(recoveryRatio({ arm: 0.4, baseline: 0.5, oracle: 1 })).toBe(0);
    // Better than the oracle: the oracle is wrong, and a ratio above one would
    // claim the reachable ceiling was exceeded.
    expect(recoveryRatio({ arm: 1, baseline: 0.5, oracle: 0.9 })).toBe(1);
  });

  it('reports 0 when the arm is exactly at the baseline', () => {
    expect(recoveryRatio({ arm: 0.5, baseline: 0.5, oracle: 1 })).toBe(0);
  });
});
