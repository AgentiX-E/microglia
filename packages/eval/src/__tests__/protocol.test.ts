import { describe, expect, it } from 'vitest';
import {
  assignFolds,
  detectableDelta,
  discordanceOf,
  interleaveByKey,
} from '../protocol.js';

describe('fold assignment', () => {
  it('assigns every id exactly once and balances the folds', () => {
    const ids = Array.from({ length: 23 }, (_, i) => `q${String(i).padStart(3, '0')}`);
    const assignment = assignFolds(ids, 5);
    expect(assignment.size).toBe(23);
    const sizes = new Map<number, number>();
    for (const id of ids) {
      const fold = assignment.get(id);
      expect(fold).toBeDefined();
      sizes.set(fold as number, (sizes.get(fold as number) ?? 0) + 1);
    }
    const counts = [...sizes.values()];
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
    expect(sizes.size).toBe(5);
  });

  it('does not depend on the order the ids arrive in', () => {
    const ids = ['b', 'a', 'd', 'c', 'f', 'e'];
    const forward = assignFolds(ids, 3);
    const backward = assignFolds([...ids].reverse(), 3);
    for (const id of ids) expect(backward.get(id)).toBe(forward.get(id));
  });

  it('rejects a split that cannot be a holdout design', () => {
    expect(() => assignFolds(['a', 'b'], 1)).toThrow(/at least 2/);
    expect(() => assignFolds(['a', 'b'], 2.5)).toThrow(/at least 2/);
    expect(() => assignFolds(['a', 'b'], 3)).toThrow(/cannot exceed/);
    expect(() => assignFolds(['a', 'a'], 2)).toThrow(/unique ids/);
  });

  it('accepts an empty corpus without inventing folds', () => {
    expect(assignFolds([], 4).size).toBe(0);
  });
});

describe('interleaving', () => {
  type Row = { db: string; id: number };
  const rows: Row[] = [
    { db: 'a', id: 1 },
    { db: 'a', id: 2 },
    { db: 'a', id: 3 },
    { db: 'b', id: 4 },
    { db: 'b', id: 5 },
    { db: 'c', id: 6 },
  ];

  it('makes every prefix cover all keys as early as possible', () => {
    const order = interleaveByKey(rows, (row) => row.db);
    expect(order.map((row) => row.db)).toEqual(['a', 'b', 'c', 'a', 'b', 'a']);
    expect(order.map((row) => row.id).sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('keeps a prefix within one of every key', () => {
    const order = interleaveByKey(rows, (row) => row.db);
    for (let take = 1; take <= rows.length; take += 1) {
      const seen = new Set(order.slice(0, take).map((row) => row.db));
      const expected = Math.min(3, take);
      expect(seen.size).toBe(expected);
    }
  });

  it('leaves a single-key corpus in place and tolerates an empty one', () => {
    const same = rows.map((row) => ({ ...row, db: 'one' }));
    expect(interleaveByKey(same, (row) => row.db)).toEqual(same);
    expect(interleaveByKey([], (row: Row) => row.db)).toEqual([]);
  });
});

describe('detectable difference', () => {
  it('matches the McNemar inversion at a stated power', () => {
    // z = 2.802 (alpha 0.05 two-sided, power 0.8), d = 0.15, n = 600.
    expect(detectableDelta(600, 0.15)).toBeCloseTo(0.0443, 4);
  });

  it('shrinks as the sample grows and grows with discordance', () => {
    expect(detectableDelta(400, 0.15)).toBeGreaterThan(detectableDelta(800, 0.15));
    expect(detectableDelta(400, 0.3)).toBeGreaterThan(detectableDelta(400, 0.15));
  });

  it('refuses to claim a detectable difference it cannot compute', () => {
    expect(detectableDelta(0, 0.15)).toBe(Number.POSITIVE_INFINITY);
    expect(detectableDelta(100, 0)).toBe(Number.POSITIVE_INFINITY);
    expect(detectableDelta(100, 2)).toBeCloseTo(detectableDelta(100, 1), 12);
  });
});

describe('discordance', () => {
  it('counts the pairs on which the two arms disagree', () => {
    expect(discordanceOf([true, true, false, false], [true, false, true, false])).toBe(0.5);
    expect(discordanceOf([true], [true])).toBe(0);
    expect(discordanceOf([], [])).toBe(0);
    expect(discordanceOf([true, false], [true])).toBe(0);
  });
});
