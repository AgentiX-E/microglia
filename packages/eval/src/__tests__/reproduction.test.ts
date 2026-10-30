import { describe, expect, it } from 'vitest';
import {
  PUBLISHED_CELLS,
  cellGate,
  compareCell,
  publishedCell,
  requireCell,
  samplingSdPp,
  wilsonInterval,
  type CellComparison,
} from '../reproduction.js';

describe('the catalogue', () => {
  it('carries the cell the documentation compares against, with its split', () => {
    const cell = requireCell('xiyan-deepseek-ddl');
    expect(cell.accuracy).toBe(53.52);
    expect(cell.split).toEqual({ name: 'BIRD dev', n: 1534 });
    expect(cell.representation).toBe('ddl');
  });

  it('answers undefined for an unknown id', () => {
    expect(publishedCell('nobody')).toBeUndefined();
  });

  it('refuses an unknown id by naming the catalogue', () => {
    expect(() => requireCell('nobody')).toThrow(/Unknown published cell/);
    try {
      requireCell('nobody');
    } catch (error) {
      expect((error as { details: Record<string, unknown> }).details['known']).toContain('xiyan-deepseek-ddl');
    }
  });

  it('gives every cell a distinct id and a positive sample', () => {
    const ids = new Set(PUBLISHED_CELLS.map((cell) => cell.id));
    expect(ids.size).toBe(PUBLISHED_CELLS.length);
    for (const cell of PUBLISHED_CELLS) expect(cell.split.n).toBeGreaterThan(0);
  });
});

describe('wilsonInterval', () => {
  it('brackets the estimate and stays inside the unit interval', () => {
    const interval = wilsonInterval({ accuracy: 0.5, n: 2 });
    expect(interval.low).toBeCloseTo(0.0945, 3);
    expect(interval.high).toBeCloseTo(0.9055, 3);
  });

  it('does not collapse at the boundary the way Wald does', () => {
    const zero = wilsonInterval({ accuracy: 0, n: 10 });
    expect(zero.low).toBe(0);
    expect(zero.high).toBeGreaterThan(0.2);
    const one = wilsonInterval({ accuracy: 1, n: 10 });
    expect(one.high).toBeCloseTo(1, 10);
    expect(one.low).toBeLessThan(0.8);
  });

  it('narrows as the sample grows', () => {
    const small = wilsonInterval({ accuracy: 0.53, n: 100 });
    const large = wilsonInterval({ accuracy: 0.53, n: 1534 });
    expect(large.high - large.low).toBeLessThan(small.high - small.low);
  });

  it('refuses an accuracy outside the unit interval and a non-positive sample', () => {
    expect(() => wilsonInterval({ accuracy: 1.2, n: 10 })).toThrow(/fraction in \[0, 1\]/);
    expect(() => wilsonInterval({ accuracy: 0.5, n: 0 })).toThrow(/positive integer/);
    expect(() => wilsonInterval({ accuracy: 0.5, n: 2.5 })).toThrow(/positive integer/);
  });
});

describe('samplingSdPp', () => {
  it('is the binomial standard error in percentage points', () => {
    expect(samplingSdPp(0.5, 100)).toBeCloseTo(5, 10);
    expect(samplingSdPp(0.5352, 1534)).toBeCloseTo(1.273, 2);
  });

  it('refuses values it cannot take a square root of', () => {
    expect(() => samplingSdPp(2, 10)).toThrow(/fraction in \[0, 1\]/);
    expect(() => samplingSdPp(0.5, -1)).toThrow(/positive integer/);
  });
});

describe('compareCell', () => {
  const miniDev = { name: 'BIRD Mini-Dev (sqlite)', n: 350 };

  it('calls a cross-split agreement indicative, never reproduced', () => {
    const comparison = compareCell({
      cell: 'xiyan-deepseek-ddl',
      estimate: { accuracy: 0.5371, n: 350 },
      split: miniDev,
    });
    expect(comparison.verdict).toBe('indicative');
    expect(comparison.sameSplit).toBe(false);
    expect(comparison.diffPp).toBeCloseTo(0.19, 2);
    expect(comparison.ourLowPp).toBeCloseTo(48.47, 1);
    expect(comparison.ourHighPp).toBeCloseTo(58.87, 1);
    expect(comparison.publishedLowPp).toBeCloseTo(51.02, 1);
    expect(comparison.publishedHighPp).toBeCloseTo(56.02, 1);
    expect(comparison.tolerancePp).toBeCloseTo(7.72, 1);
  });

  it('calls a same-split agreement reproduced', () => {
    const comparison = compareCell({
      cell: 'xiyan-deepseek-ddl',
      estimate: { accuracy: 0.5352, n: 1534 },
      split: { name: 'BIRD dev', n: 1534 },
    });
    expect(comparison.verdict).toBe('reproduced');
    expect(comparison.sameSplit).toBe(true);
    expect(comparison.diffPp).toBe(0);
  });

  it('calls a difference outside both bands outside, on the same split or not', () => {
    const far = compareCell({
      cell: 'xiyan-deepseek-ddl',
      estimate: { accuracy: 0.3, n: 350 },
      split: miniDev,
    });
    expect(far.verdict).toBe('outside');
    const sameSplitFar = compareCell({
      cell: 'xiyan-deepseek-ddl',
      estimate: { accuracy: 0.3, n: 1534 },
      split: { name: 'BIRD dev', n: 1534 },
    });
    expect(sameSplitFar.verdict).toBe('outside');
  });

  it('accepts a difference inside the published band even when our own interval is tight', () => {
    const comparison = compareCell({
      cell: 'xiyan-deepseek-ddl',
      estimate: { accuracy: 0.5595, n: 1534 },
      split: { name: 'BIRD dev', n: 1534 },
    });
    expect(comparison.verdict).toBe('reproduced');
    expect(comparison.diffPp).toBeCloseTo(2.43, 2);
  });

  it('refuses an unknown cell', () => {
    expect(() =>
      compareCell({ cell: 'nobody', estimate: { accuracy: 0.5, n: 10 }, split: miniDev }),
    ).toThrow(/Unknown published cell/);
  });
});

describe('cellGate', () => {
  const miniDev = { name: 'BIRD Mini-Dev (sqlite)', n: 350 };
  const estimate = { accuracy: 0.5371, n: 350 };
  const recorded = compareCell({ cell: 'xiyan-deepseek-ddl', estimate, split: miniDev });

  it('passes when nothing was recorded', () => {
    expect(cellGate(undefined, estimate, miniDev)).toEqual({
      code: 'V31',
      name: 'cell-comparison',
      ok: true,
      detail: 'no cell comparison was recorded',
    });
  });

  it('passes when the record equals the computation', () => {
    const gate = cellGate(recorded, estimate, miniDev);
    expect(gate.ok).toBe(true);
    expect(gate.detail).toContain('indicative at 0.19pp');
  });

  it('fails when the verdict was upgraded by hand', () => {
    const upgraded: CellComparison = { ...recorded, verdict: 'reproduced' };
    const gate = cellGate(upgraded, estimate, miniDev);
    expect(gate.ok).toBe(false);
    expect(gate.detail).toContain('disagrees with the arithmetic');
    expect(gate.detail).toContain('verdict');
  });

  it('fails when the difference was edited', () => {
    const edited: CellComparison = { ...recorded, diffPp: 0.09 };
    const gate = cellGate(edited, estimate, miniDev);
    expect(gate.ok).toBe(false);
    expect(gate.detail).toContain('diffPp');
  });

  it('fails when the split flag was edited', () => {
    const edited: CellComparison = { ...recorded, sameSplit: true };
    const gate = cellGate(edited, estimate, miniDev);
    expect(gate.ok).toBe(false);
    expect(gate.detail).toContain('sameSplit');
  });
});
