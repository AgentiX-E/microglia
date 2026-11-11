import { describe, expect, it } from 'vitest';
import { sharedCases, widthShare, type WidthCase } from '../width.js';

const row = (id: string, first: boolean, selected: boolean, oracle: boolean): WidthCase => ({
  id,
  first,
  selected,
  oracle,
});

describe('widthShare', () => {
  it('measures the selector against the ceiling rather than against zero', () => {
    // Ten questions. The first draw is right on five, the selector on six, the oracle on eight. The pool
    // is worth 30pp and the selector captured 10 of them, so its share is a third — not 60%, which is the
    // accuracy a reader would otherwise compare against a bar that means something else.
    const cases = [
      // Five the first draw already gets.
      ...Array.from({ length: 5 }, (_, at) => row(`b${String(at)}`, true, true, true)),
      // One the selector finds and the first draw misses.
      ...Array.from({ length: 1 }, (_, at) => row(`s${String(at)}`, false, true, true)),
      // Two in the pool that no cheap selector reaches — the part of the ceiling left on the table.
      ...Array.from({ length: 2 }, (_, at) => row(`u${String(at)}`, false, false, true)),
      // Two nobody gets.
      ...Array.from({ length: 2 }, (_, at) => row(`n${String(at)}`, false, false, false)),
    ];
    const reading = widthShare(cases, { samples: 500 });
    expect(reading.n).toBe(10);
    expect(reading.first).toBeCloseTo(0.5, 10);
    expect(reading.selected).toBeCloseTo(0.6, 10);
    expect(reading.oracle).toBeCloseTo(0.8, 10);
    expect(reading.ceilingPp).toBeCloseTo(30, 10);
    expect(reading.capturedPp).toBeCloseTo(10, 10);
    expect(reading.share).toBeCloseTo(1 / 3, 10);
  });

  it('has no share when the pool has no ceiling', () => {
    // Every draw agrees with the first, so there is nothing for a selector to capture. Zero would read as
    // "a selector that added nothing" and one as "it captured everything"; `null` reads as "the question
    // does not apply", which is the true one.
    const cases = [row('a', true, true, true), row('b', false, false, false)];
    const reading = widthShare(cases, { samples: 100 });
    expect(reading.oracle).toBe(reading.first);
    expect(reading.share).toBeNull();
    expect(reading.interval).toBeNull();
    expect(reading.usableResamples).toBe(0);
  });

  it('is deterministic, so two readings of one artefact agree', () => {
    const cases = Array.from({ length: 40 }, (_, at) =>
      row(`q${String(at)}`, at % 2 === 0, at % 3 !== 0, at % 5 !== 0),
    );
    const once = widthShare(cases, { samples: 400, seed: 7 });
    const twice = widthShare(cases, { samples: 400, seed: 7 });
    expect(once.interval).toEqual(twice.interval);
    expect(once.usableResamples).toBe(twice.usableResamples);
  });

  it('brackets the point estimate on a pool with a real ceiling', () => {
    const cases = Array.from({ length: 200 }, (_, at) => {
      const first = at % 4 === 0;
      const oracle = at % 2 === 0;
      const selected = at % 3 === 0;
      return row(`q${String(at)}`, first, selected, oracle);
    });
    const reading = widthShare(cases, { samples: 2_000 });
    expect(reading.share).not.toBeNull();
    expect(reading.interval).not.toBeNull();
    const interval = reading.interval as { low: number; high: number };
    const share = reading.share as number;
    expect(interval.low).toBeLessThan(share);
    expect(interval.high).toBeGreaterThan(share);
    // Most resamples have a positive ceiling at this size, and the count says how many did.
    // Every resample of a pool with a 40pp ceiling has a denominator, so the interval rests on all of
    // them.
    expect(reading.usableResamples).toBe(2_000);
  });

  it('counts the resamples that had a ceiling to divide by', () => {
    // Two questions, one of them the whole ceiling: a resample that draws the first question twice has a
    // denominator of zero and no share at all, so the interval rests on the resamples that drew the other
    // one. The count is reported because it is information about the pool, not about the selector.
    const cases = [row('a', false, true, true), row('b', true, true, true)];
    const reading = widthShare(cases, { samples: 200 });
    expect(reading.share).toBeCloseTo(1, 10);
    expect(reading.interval).not.toBeNull();
    expect(reading.usableResamples).toBeLessThan(200);
    expect(reading.usableResamples).toBeGreaterThan(100);
  });

  it('reports nothing for an empty population', () => {
    const reading = widthShare([], { samples: 10 });
    expect(reading.n).toBe(0);
    expect(reading.share).toBeNull();
    expect(reading.interval).toBeNull();
    expect(reading.first).toBe(0);
    expect(reading.oracle).toBe(0);
  });

  it('defaults to ten thousand resamples and a fixed seed', () => {
    // The default is the one every reading of a real artefact uses, and it is the branch a suite that
    // always passes `samples` would leave untested.
    const cases = [row('a', false, true, true), row('b', true, true, true), row('c', false, false, true)];
    const reading = widthShare(cases);
    expect(reading.usableResamples).toBeGreaterThan(0);
    expect(reading.interval).not.toBeNull();
  });

  it('draws at least one resample even when asked for none', () => {
    // `samples: 0` is a caller mistake rather than a request for an empty interval; clamping keeps the
    // function total instead of returning a shape nothing else in the package produces.
    const reading = widthShare([row('a', false, true, true), row('b', false, false, false)], {
      samples: 0,
    });
    expect(reading.usableResamples).toBeLessThanOrEqual(1);
  });
});

describe('sharedCases', () => {
  it('keeps the primary artefact’s questions and its order', () => {
    const primary = [row('a', true, true, true), row('b', false, true, true)];
    const other = [row('b', false, false, false), row('c', true, true, true)];
    expect(sharedCases(primary, other).map((entry) => entry.id)).toEqual(['b']);
  });

  it('is empty when two artefacts scored different questions', () => {
    // The case R68's Amendment 1 is guarding: a share computed across two populations would compare a
    // selector on one set of questions against a ceiling on another.
    expect(sharedCases([row('a', true, true, true)], [row('z', true, true, true)])).toEqual([]);
  });
});
