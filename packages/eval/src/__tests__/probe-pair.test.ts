import { describe, expect, it } from 'vitest';
import { compareSubstrates, poolSubstrates, reproducedBy, SUBSTRATE_FLOOR } from '../probe-pair.js';
import type { ProbeTrial, ProbeVerdict } from '../rule-probe.js';

const trial = (taskId: string, verdict: ProbeVerdict | undefined): ProbeTrial => ({
  taskId,
  itemIds: [`item-${taskId}`],
  verdict,
});

describe('reproducedBy', () => {
  it('counts both verdicts in which the correction came back with the store', () => {
    expect(reproducedBy('supplied')).toBe(true);
    expect(reproducedBy('redundant')).toBe(true);
  });

  it('counts both verdicts in which it did not', () => {
    expect(reproducedBy('useless')).toBe(false);
    expect(reproducedBy('broke')).toBe(false);
  });

  it('keeps a hole a hole', () => {
    expect(reproducedBy(undefined)).toBeUndefined();
  });
});

describe('compareSubstrates', () => {
  it('pairs on the questions both stores covered, and never on the union', () => {
    const left = [trial('a', 'supplied'), trial('b', 'useless'), trial('c', 'supplied')];
    const right = [trial('a', 'supplied'), trial('b', 'supplied'), trial('d', 'supplied')];
    const compared = compareSubstrates(left, right, { left: 'lesson', right: 'repair' });
    expect(compared.shared).toBe(2);
    expect(compared.leftExclusive).toBe(1);
    expect(compared.rightExclusive).toBe(1);
    expect(compared.paired).toBe(2);
    // `b` is the only discordant pair, and it favours the right-hand store.
    expect(compared.both).toBe(1);
    expect(compared.onlyLeft).toBe(0);
    expect(compared.onlyRight).toBe(1);
    expect(compared.neither).toBe(0);
    expect(compared.leftRate).toBeCloseTo(0.5, 12);
    expect(compared.rightRate).toBeCloseTo(1, 12);
    expect(compared.deltaPp).toBeCloseTo(50, 12);
  });

  it('reconciles the cells against the paired set and the set against the union', () => {
    const left = [
      trial('a', 'supplied'),
      trial('b', 'useless'),
      trial('c', 'supplied'),
      trial('d', undefined),
      trial('e', 'broke'),
    ];
    const right = [
      trial('a', 'useless'),
      trial('b', 'supplied'),
      trial('c', undefined),
      trial('d', 'supplied'),
      trial('f', 'supplied'),
    ];
    const compared = compareSubstrates(left, right, { left: 'lesson', right: 'repair' });
    // `e` is exclusive to the left store and `f` to the right, so the pair-eligible set is four.
    expect(compared.shared).toBe(4);
    expect(compared.leftExclusive).toBe(1);
    expect(compared.rightExclusive).toBe(1);
    expect(compared.holes).toBe(2);
    expect(compared.both + compared.onlyLeft + compared.onlyRight + compared.neither).toBe(
      compared.paired,
    );
    expect(compared.paired + compared.holes).toBe(compared.shared);
    expect(compared.shared + compared.leftExclusive + compared.rightExclusive).toBe(6);
  });

  it('puts a question whose calls never returned in the holes, not in a cell', () => {
    const compared = compareSubstrates(
      [trial('a', undefined), trial('b', 'supplied')],
      [trial('a', 'supplied'), trial('b', 'supplied')],
      { left: 'lesson', right: 'repair' },
    );
    expect(compared.holes).toBe(1);
    expect(compared.paired).toBe(1);
    expect(compared.onlyLeft).toBe(0);
    expect(compared.onlyRight).toBe(0);
    expect(compared.both).toBe(1);
  });

  it('refuses to call a difference a finding when the paired set is a handful', () => {
    const left = [trial('a', 'useless'), trial('b', 'useless'), trial('c', 'useless')];
    const right = [trial('a', 'supplied'), trial('b', 'supplied'), trial('c', 'supplied')];
    const compared = compareSubstrates(left, right, { left: 'lesson', right: 'repair' });
    expect(compared.onlyRight).toBe(3);
    // Three discordant pairs, all one way, is p = 0.25: a direction, not a rate.
    expect(compared.p).toBeGreaterThan(0.05);
    expect(compared.verdict).toBe('floor');
  });

  it('calls the right-hand store better only when the discordant pairs clear the floor', () => {
    const ids = Array.from({ length: SUBSTRATE_FLOOR }, (_, index) => `q${String(index)}`);
    const left = ids.map((id) => trial(id, 'useless'));
    const right = ids.map((id, index) => trial(id, index < 40 ? 'supplied' : 'useless'));
    const compared = compareSubstrates(left, right, { left: 'lesson', right: 'repair' });
    expect(compared.paired).toBe(SUBSTRATE_FLOOR);
    expect(compared.onlyRight).toBe(40);
    expect(compared.p).toBeLessThan(0.001);
    expect(compared.verdict).toBe('right');
  });

  it('reads a tie as a tie rather than as a direction', () => {
    const ids = Array.from({ length: 120 }, (_, index) => `q${String(index)}`);
    const left = ids.map((id, index) => trial(id, index < 30 ? 'supplied' : 'useless'));
    const right = ids.map((id, index) => trial(id, index >= 30 && index < 60 ? 'supplied' : 'useless'));
    const compared = compareSubstrates(left, right, { left: 'lesson', right: 'repair' });
    expect(compared.onlyLeft).toBe(30);
    expect(compared.onlyRight).toBe(30);
    expect(compared.p).toBeCloseTo(1, 6);
    expect(compared.verdict).toBe('tie');
  });

  it('names the left-hand store when the sweep goes the other way', () => {
    const ids = Array.from({ length: SUBSTRATE_FLOOR }, (_, index) => `q${String(index)}`);
    const left = ids.map((id, index) => trial(id, index < 45 ? 'supplied' : 'useless'));
    const right = ids.map((id) => trial(id, 'useless'));
    const compared = compareSubstrates(left, right, { left: 'rule', right: 'repair' });
    expect(compared.verdict).toBe('left');
    expect(compared.deltaPp).toBeCloseTo(-45, 12);
  });

  it('reports an empty comparison without dividing by zero', () => {
    const compared = compareSubstrates([], [], { left: 'lesson', right: 'repair' });
    expect(compared.shared).toBe(0);
    expect(compared.paired).toBe(0);
    expect(compared.leftRate).toBe(0);
    expect(compared.rightRate).toBe(0);
    expect(compared.deltaPp).toBe(0);
    expect(compared.p).toBe(1);
    expect(compared.verdict).toBe('unpaired');
  });

  it('keeps the left rate over the paired set, not over the whole store', () => {
    // One question the right-hand store never covered and where the left side succeeded. Counting
    // it would inflate the left rate on a set the right side is not scored on.
    const compared = compareSubstrates(
      [trial('a', 'supplied'), trial('b', 'useless')],
      [trial('a', 'supplied')],
      { left: 'lesson', right: 'repair' },
    );
    expect(compared.leftExclusive).toBe(1);
    expect(compared.leftRate).toBe(1);
    expect(compared.paired).toBe(1);
  });

  it('is reproducible for a given seed', () => {
    const ids = Array.from({ length: 140 }, (_, index) => `q${String(index)}`);
    const left = ids.map((id, index) => trial(id, index % 3 === 0 ? 'supplied' : 'useless'));
    const right = ids.map((id, index) => trial(id, index % 2 === 0 ? 'supplied' : 'useless'));
    const first = compareSubstrates(left, right, { left: 'lesson', right: 'repair' });
    const second = compareSubstrates(left, right, { left: 'lesson', right: 'repair' });
    expect(second.deltaCI).toEqual(first.deltaCI);
    expect(second.p).toBe(first.p);
  });
});

describe('poolSubstrates', () => {
  const fold = (suppliedLeft: number, suppliedRight: number, n: number) => {
    const left: ProbeTrial[] = [];
    const right: ProbeTrial[] = [];
    for (let index = 0; index < n; index += 1) {
      const id = `q${String(index)}`;
      left.push(trial(id, index < suppliedLeft ? 'supplied' : 'useless'));
      right.push(trial(id, index < suppliedRight ? 'supplied' : 'useless'));
    }
    return compareSubstrates(left, right, { left: 'rule', right: 'repair' });
  };

  it('adds the folds and recomputes the rates from the summed cells', () => {
    // A mean of two rates would give a 10-question fold the same weight as a 200-question one.
    const pooled = poolSubstrates([fold(10, 10, 10), fold(0, 0, 200)]);
    expect(pooled).not.toBeNull();
    const result = pooled as NonNullable<typeof pooled>;
    expect(result.folds).toBe(2);
    expect(result.paired).toBe(210);
    expect(result.both).toBe(10);
    expect(result.leftRate).toBeCloseTo(10 / 210, 12);
    expect(result.left).toBe('rule');
    expect(result.right).toBe('repair');
  });

  it('tests the summed discordant pairs, which is what makes a small effect resolvable', () => {
    // Neither fold alone clears the floor; together they do, and the direction is the same in both.
    const pooled = poolSubstrates([fold(20, 26, 70), fold(20, 26, 70)]);
    const result = pooled as NonNullable<typeof pooled>;
    expect(result.paired).toBe(140);
    expect(result.onlyLeft).toBe(0);
    expect(result.onlyRight).toBe(12);
    expect(result.p).toBeLessThan(0.01);
    expect(result.verdict).toBe('right');
  });

  it('keeps a below-floor total a direction', () => {
    const result = poolSubstrates([fold(2, 4, 6)]) as NonNullable<ReturnType<typeof poolSubstrates>>;
    expect(result.verdict).toBe('floor');
  });

  it('reads no disagreement at all as a tie', () => {
    const result = poolSubstrates([fold(30, 30, 120), fold(30, 30, 120)]) as NonNullable<
      ReturnType<typeof poolSubstrates>
    >;
    expect(result.onlyLeft).toBe(0);
    expect(result.onlyRight).toBe(0);
    expect(result.p).toBe(1);
    expect(result.verdict).toBe('tie');
  });

  it('names the left-hand store when it wins the pooled sweep', () => {
    const result = poolSubstrates([fold(26, 20, 70), fold(26, 20, 70)]) as NonNullable<
      ReturnType<typeof poolSubstrates>
    >;
    expect(result.onlyLeft).toBe(12);
    expect(result.onlyRight).toBe(0);
    expect(result.verdict).toBe('left');
  });

  it('calls a two-way disagreement with no winner a tie', () => {
    // Both directions present and neither dominant: the sign test cannot separate them, which is
    // the case the pooled verdict has to read as `tie` rather than as whichever side is larger.
    // 140 questions so the paired set clears the floor: below it the verdict is `floor` whatever
    // the discordant pairs say, which is the guard the next test covers.
    const ids = Array.from({ length: 140 }, (_, index) => `q${String(index)}`);
    const left = ids.map((id, index) =>
      trial(id, index < 24 || (index >= 28 && index < 32) ? 'supplied' : 'useless'),
    );
    const right = ids.map((id, index) => trial(id, index < 28 ? 'supplied' : 'useless'));
    const result = poolSubstrates([
      compareSubstrates(left, right, { left: 'rule', right: 'repair' }),
    ]) as NonNullable<ReturnType<typeof poolSubstrates>>;
    expect(result.onlyLeft).toBe(4);
    expect(result.onlyRight).toBe(4);
    expect(result.p).toBeGreaterThan(0.05);
    expect(result.verdict).toBe('tie');
  });

  it('keeps both pooled rates at zero when every shared question is a hole', () => {
    // No cell means no denominator, and a rate computed over one anyway would be the only number
    // in this module that could not be traced back to a trial.
    const pooled = poolSubstrates([
      compareSubstrates([trial('a', undefined)], [trial('a', 'supplied')], {
        left: 'rule',
        right: 'repair',
      }),
    ]) as NonNullable<ReturnType<typeof poolSubstrates>>;
    expect(pooled.paired).toBe(0);
    expect(pooled.holes).toBe(1);
    expect(pooled.leftRate).toBe(0);
    expect(pooled.rightRate).toBe(0);
    expect(pooled.verdict).toBe('floor');
  });

  it('has no pooled reading when there is nothing to pool', () => {
    expect(poolSubstrates([])).toBeNull();
  });

  it('carries the exclusive and hole counts through the sum', () => {
    const left = [trial('a', 'supplied'), trial('b', 'useless'), trial('c', undefined)];
    const right = [trial('a', 'useless'), trial('b', 'useless'), trial('c', 'supplied'), trial('d', 'supplied')];
    const pooled = poolSubstrates([
      compareSubstrates(left, right, { left: 'rule', right: 'repair' }),
    ]) as NonNullable<ReturnType<typeof poolSubstrates>>;
    expect(pooled.leftExclusive).toBe(0);
    expect(pooled.rightExclusive).toBe(1);
    expect(pooled.holes).toBe(1);
    expect(pooled.shared).toBe(3);
    expect(pooled.both + pooled.onlyLeft + pooled.onlyRight + pooled.neither).toBe(pooled.paired);
  });
});
