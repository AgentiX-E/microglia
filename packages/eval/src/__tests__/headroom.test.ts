import { describe, expect, it } from 'vitest';
import { foldHeadroom, headroomLine } from '../headroom.js';

/**
 * The headroom rule is an upper bound, so its cases are the four folds this lane has already run — the
 * numbers are read out of their artefacts and pinned here, because a bound that drifts silently is how a
 * design mistake survives a round.
 */

describe('what a fold could have shown', () => {
  it('says the committed official fold could never have certified anything', () => {
    // 36 of 40 passed without a memory, so the best a store can do is +10.00pp against a 18.53pp resolution.
    const headroom = foldHeadroom({ paired: 40, controlPass4: 0.9, detectablePp: 18.53 });
    expect(headroom.controlPasses).toBe(36);
    expect(headroom.failures).toBe(4);
    expect(headroom.ceilingPp).toBe(10);
    expect(headroom.verdict).toBe('silent');
    expect(headroomLine(headroom)).toContain('the fold, not the store, is the constraint');
  });

  it('says the same of R152 and R152c, which are forty tasks with six failures', () => {
    for (const detectablePp of [15.66, 23.23]) {
      const headroom = foldHeadroom({ paired: 40, controlPass4: 0.85, detectablePp });
      expect(headroom.failures).toBe(6);
      expect(headroom.ceilingPp).toBe(15);
      expect(headroom.verdict).toBe('silent');
    }
  });

  it('says the 74-task swapped fold misses by less, and still misses', () => {
    const headroom = foldHeadroom({ paired: 74, controlPass4: 0.8514, detectablePp: 17.76 });
    expect(headroom.controlPasses).toBe(63);
    expect(headroom.ceilingPp).toBeCloseTo(14.86, 2);
    expect(headroom.verdict).toBe('silent');
  });

  it('finds the pooled 114-pair fold the first design that could express a large effect', () => {
    // The one fold in the record whose ceiling clears its resolution — and only by 0.8pp, which is why the
    // next reading is pooled rather than a fifth 40-task draw.
    const headroom = foldHeadroom({ paired: 114, controlPass4: 0.86, detectablePp: 13.24 });
    expect(headroom.ceilingPp).toBeCloseTo(14, 0);
    expect(headroom.verdict).toBe('expressible');
    expect(headroomLine(headroom)).toContain('a perfect store would have cleared it');
  });

  it('refuses to answer when the fold never estimated a resolution', () => {
    const headroom = foldHeadroom({ paired: 40, controlPass4: 0.85, detectablePp: undefined });
    expect(headroom.verdict).toBe('unknown');
    expect(headroomLine(headroom)).toContain('unmeasured rather than answered');
  });

  it('refuses a fold with no tasks, and a pass rate that is not a share', () => {
    // Both are defects in the caller rather than very good folds, and a default would turn either into a
    // ceiling of 100pp that reads like excellent headroom.
    expect(() => foldHeadroom({ paired: 0, controlPass4: 0.9, detectablePp: 10 })).toThrow(/positive integer/);
    expect(() => foldHeadroom({ paired: 40.5, controlPass4: 0.9, detectablePp: 10 })).toThrow(/positive integer/);
    expect(() => foldHeadroom({ paired: 40, controlPass4: 1.2, detectablePp: 10 })).toThrow(/share between 0 and 1/);
    expect(() => foldHeadroom({ paired: 40, controlPass4: Number.NaN, detectablePp: 10 })).toThrow(
      /share between 0 and 1/,
    );
  });

  it('reports a fold whose control passed nothing as unbounded headroom', () => {
    const headroom = foldHeadroom({ paired: 30, controlPass4: 0, detectablePp: 12 });
    expect(headroom.ceilingPp).toBe(100);
    expect(headroom.verdict).toBe('expressible');
  });
});
