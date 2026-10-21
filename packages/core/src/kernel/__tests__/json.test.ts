import { describe, expect, it } from 'vitest';
import {
  applyOps,
  canonicalize,
  diffJson,
  editDistance,
  hashJson,
} from '../index.js';

describe('canonical JSON', () => {
  it('normalises key order and numeric spelling', () => {
    expect(canonicalize({ b: 1, a: [true, null] })).toBe('{"a":[true,null],"b":1}');
    expect(canonicalize(-0)).toBe('0');
    expect(hashJson({ a: 1, b: 2 })).toBe(hashJson({ b: 2, a: 1 }));
  });

  it('rejects non-finite numbers rather than emitting invalid JSON', () => {
    expect(() => canonicalize(Number.NaN)).toThrow(TypeError);
    expect(() => canonicalize(Infinity)).toThrow(TypeError);
  });

  it('distinguishes types that stringify similarly', () => {
    expect(hashJson('1')).not.toBe(hashJson(1));
    expect(hashJson(true)).not.toBe(hashJson('true'));
  });
});

describe('structural diff', () => {
  const before = { mark: 'bar', encoding: { x: 'month', y: 'revenue' }, title: 'Sales' };
  const after = { mark: 'line', encoding: { x: 'month', y: 'net_revenue' } };

  it('reports a leaf change per differing field', () => {
    const ops = diffJson(before, after);
    expect(ops.map((op) => op.op)).toEqual(['set', 'set', 'remove']);
    expect(ops[0]?.path).toEqual(['encoding', 'y']);
  });

  it('round-trips through applyOps', () => {
    const ops = diffJson(before, after);
    expect(applyOps(before, ops)).toEqual(after);
  });

  it('handles array growth and shrink at the tail', () => {
    const ops = diffJson([1, 2], [1, 2, 3]);
    expect(ops).toEqual([{ op: 'insert', path: [2], after: 3 }]);
    expect(applyOps([1, 2], ops)).toEqual([1, 2, 3]);
    const removed = diffJson([1, 2, 3], [1]);
    expect(removed).toHaveLength(2);
    expect(applyOps([1, 2, 3], removed)).toEqual([1]);
  });

  it('reports zero distance for identical values and bounded distance otherwise', () => {
    expect(editDistance(before, before)).toBe(0);
    const distance = editDistance(before, after);
    expect(distance).toBeGreaterThan(0);
    expect(distance).toBeLessThanOrEqual(1);
  });

  it('distinguishes a moved array element from no change', () => {
    const ops = diffJson(['x', 'y'], ['y', 'x']);
    expect(ops.length).toBeGreaterThan(0);
  });
});

describe('diff path coverage', () => {
  it('inserts into an object and removes from a nested array', () => {
    const inserted = diffJson({ a: 1 }, { a: 1, b: { c: 2 } });
    expect(inserted).toEqual([{ op: 'insert', path: ['b'], after: { c: 2 } }]);
    expect(applyOps({ a: 1 }, inserted)).toEqual({ a: 1, b: { c: 2 } });

    const nested = diffJson({ a: [1, 2, 3] }, { a: [1] });
    expect(applyOps({ a: [1, 2, 3] }, nested)).toEqual({ a: [1] });
  });

  it('grows a nested array and replaces a non-container parent', () => {
    const grown = diffJson({ a: [1] }, { a: [1, 2] });
    expect(applyOps({ a: [1] }, grown)).toEqual({ a: [1, 2] });

    expect(() =>
      applyOps({ a: 1 }, [{ op: 'insert', path: ['a', 'b'], after: 2 }]),
    ).toThrow(TypeError);
  });

  it('ignores an array op addressed with a string key', () => {
    const value = applyOps([1, 2], [{ op: 'set', path: ['x' as never], before: 1, after: 9 }]);
    expect(value).toEqual([1, 2]);
  });

  it('replaces the root with a removed value', () => {
    expect(applyOps({ a: 1 }, [{ op: 'remove', path: [], before: { a: 1 } }])).toBeNull();
  });
});
