import { describe, expect, it } from 'vitest';
import {
  dispatchRowOf,
  poolDispatches,
  dispatchPoolLine,
  type DispatchRow,
} from '../dispatch-pool.js';

/** One arm's reading from one dispatch, in the shape the artefact already carries. */
const row = (
  dispatch: string,
  passAtK: number,
  tasks: number,
  over: { readonly k?: number; readonly episodeRate?: number } = {},
): DispatchRow => ({
  dispatch,
  k: over.k ?? 4,
  tasks,
  passAtK,
  episodeRate: over.episodeRate,
});

describe('one arm, several dispatches', () => {
  it('pools three dispatches of one arm into one estimate with an interval', () => {
    // The three readings this record actually has for the routine-key arm: 0.7750, 0.7500 and 0.6250 over
    // 40 tasks. A mean of the three is not a reading — the interval around it is what says whether the arm
    // can be ordered against anything.
    const reading = poolDispatches([
      row('R123a', 0.775, 40),
      row('R124', 0.75, 40),
      row('R131', 0.625, 40),
    ]);
    expect(reading?.dispatches).toBe(3);
    // Not the arithmetic mean of 0.775 / 0.750 / 0.625 (0.7167): each dispatch is weighted by its own
    // variance, and a rate nearer 0.5 carries more of it. The pooled value is the one a reader must quote.
    expect(reading?.pooled).toBeCloseTo(0.723, 3);
    // The between-dispatch spread is large relative to the within-variance, so the random-effects interval is
    // much wider than `mean ± 1.96 * se` would be — that difference is the whole point of the module.
    expect(reading?.tau2).toBeGreaterThan(0);
    expect(reading?.halfWidthPp).toBeGreaterThan(15);
    expect(reading?.label).toBe('random-effects');
  });

  it('collapses to a fixed-effect reading when the dispatches agree', () => {
    // Two dispatches two points apart on 160 episodes each: the between-variance estimate is negative and is
    // truncated at zero, which is what makes this a fixed-effect pool rather than a random one.
    const reading = poolDispatches([row('a', 0.84, 160), row('b', 0.85, 160)]);
    expect(reading?.tau2).toBe(0);
    expect(reading?.label).toBe('fixed-effect');
    expect(reading?.pooled).toBeCloseTo(0.8451, 3);
    // 1.96 and not t(1): the honest reading of two runs that agree is the episodes' own precision, which is
    // ±5.6pp over 320 of them. The t quantile for a homogeneous pair would print ±36pp, which is not
    // conservative, it is the wrong variance for this estimate.
    expect(reading?.halfWidthPp).toBeLessThan(7);
    expect(reading?.quantile).toBe(1.96);
  });

  it('uses the t quantile for the dispatch count, not the normal one', () => {
    // Three dispatches leave two degrees of freedom. The normal quantile would print a 15pp gap as resolved;
    // the t(2) quantile is 4.3x wider and says it is not, which is the honest reading at k=3.
    const reading = poolDispatches([row('a', 0.5, 40), row('b', 0.6, 40), row('c', 0.7, 40)]);
    expect(reading?.df).toBe(2);
    expect(reading?.quantile).toBeGreaterThan(4);
  });

  it('reports the share of the spread that is between dispatches rather than inside them', () => {
    // I² is the number a reader needs before quoting a pooled value: above ~50% the pooled mean is a summary
    // of disagreeing runs rather than an estimate of one quantity, and the record has to say which it is.
    const wide = poolDispatches([row('a', 0.5, 40), row('b', 0.75, 40), row('c', 0.9, 40)]);
    const tight = poolDispatches([row('a', 0.84, 160), row('b', 0.85, 160), row('c', 0.845, 160)]);
    expect(wide?.iSquared).toBeGreaterThan(0.5);
    expect(tight?.iSquared).toBe(0);
  });

  it('refuses one dispatch, because one number is not a pool', () => {
    expect(poolDispatches([row('a', 0.7, 40)])).toBeUndefined();
    expect(poolDispatches([])).toBeUndefined();
    expect(dispatchPoolLine(undefined)).toContain('not measured');
  });

  it('refuses a pool whose arms measured different k, because a pass^2 is not a pass^4', () => {
    // R132 published `pass4: 0.825` at `k: 2`. Pooling it with a k=4 arm would average two different
    // statistics under one name — the defect the record has already paid for once in a field's name.
    expect(() =>
      poolDispatches([row('a', 0.7, 40), row('b', 0.8, 40, { k: 2 })]),
    ).toThrow(/k/);
  });

  it('refuses a pool that would silently drop a dispatch it cannot read', () => {
    expect(() => poolDispatches([row('a', 0.7, 40), row('b', Number.NaN, 40)])).toThrow(/not a rate/);
    expect(() => poolDispatches([row('a', 0.7, 40), row('b', 0.8, 0)])).toThrow(/task/);
    expect(() => poolDispatches([row('a', 1.4, 40), row('b', 0.8, 40)])).toThrow(/not a rate/);
  });

  it('prints the pooled value, the interval, the dispatch count and the heterogeneity', () => {
    const line = dispatchPoolLine(poolDispatches([row('R123a', 0.775, 40), row('R124', 0.75, 40), row('R131', 0.625, 40)]));
    expect(line).toContain('3 dispatch(es)');
    expect(line).toContain('random-effects');
    expect(line).toContain('pass^4');
    // The sentence has to carry the reason the number is not a ranking, not leave it to the reader.
    expect(line).toContain('between-dispatch');
  });

  it('falls back to the normal quantile when a record has more dispatches than the table', () => {
    // The table stops at 30 degrees of freedom. A record with 32 dispatches of one arm is not what this module was
    // written for, but it is not a refusal either — past the table the t and the normal quantile differ by 0.4%.
    // Alternating rather than jittered: the pool has to be `random-effects` for `quantileFor` to be called at
    // all, and a fixture that agreed within its own error would exercise the fixed-effect branch and pass for
    // the wrong reason.
    const many = Array.from({ length: 32 }, (_, i) => row(`d${String(i)}`, i % 2 === 0 ? 0.5 : 0.9, 40));
    const reading = poolDispatches(many);
    expect(reading?.label).toBe('random-effects');
    expect(reading?.quantile).toBe(1.96);
  });

  it('says which intervals can order two arms and which cannot', () => {
    // The sentence has to do the reader's arithmetic: an interval of ±19pp does not order anything, and a record
    // that prints the number without that clause is how the retracted ranking happened.
    const narrow = dispatchPoolLine(poolDispatches([row('a', 0.84, 160), row('b', 0.85, 160)]));
    expect(narrow).toContain('can order two arms');
    expect(narrow).toContain('z=1.960');
    const wide = dispatchPoolLine(poolDispatches([row('a', 0.5, 40), row('b', 0.75, 40), row('c', 0.9, 40)]));
    expect(wide).toContain('does not order two arms');
    expect(wide).toContain('% of the spread is between-dispatch');
    expect(wide).toContain('t(2)=4.303');
  });

  it('reads a row out of an arm document, and refuses one that does not say what it ran', () => {
    const document = {
      id: 'poc-l4',
      metrics: { pass4: 0.625, tasks: 40, k: 4, episode_rate: 0.8375 },
    };
    expect(dispatchRowOf('R131', document)).toEqual({
      dispatch: 'R131',
      k: 4,
      tasks: 40,
      passAtK: 0.625,
      episodeRate: 0.8375,
    });
    // A document with no `k` predates the field, and a k guessed from a name is how a pass^2 would enter a
    // pool of pass^4s. The row is refused rather than defaulted.
    expect(dispatchRowOf('old', { metrics: { pass4: 0.5, tasks: 40 } })).toBeUndefined();
    expect(dispatchRowOf('none', {})).toBeUndefined();
    // The other three ways a document fails to be a row: no object, no metrics block, and metrics that is not one.
    expect(dispatchRowOf('null', null)).toBeUndefined();
    expect(dispatchRowOf('str', 'poc-l4')).toBeUndefined();
    expect(dispatchRowOf('empty', { metrics: null })).toBeUndefined();
    // And a document with no episode rate is a row without one, not a row with a zero.
    expect(dispatchRowOf('noep', { metrics: { pass4: 0.5, tasks: 40, k: 4 } })).toEqual({
      dispatch: 'noep',
      k: 4,
      tasks: 40,
      passAtK: 0.5,
    });
  });
});
