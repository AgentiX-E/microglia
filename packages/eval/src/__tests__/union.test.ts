import { describe, expect, it } from 'vitest';
import { unionCeiling } from '../union.js';

const at = (entries: Record<string, boolean>) => entries;

describe('unionCeiling', () => {
  it('reports what a perfect chooser over the generators could have scored', () => {
    // R7.1's criterion 1, as a number: the ceiling is the share of questions where *some* generator
    // was right, minus the share the control already had.
    const result = unionCeiling(
      [
        { id: 'a', correct: at({ direct: false, plan: true, decompose: false }) },
        { id: 'b', correct: at({ direct: false, plan: false, decompose: true }) },
        { id: 'c', correct: at({ direct: true, plan: false, decompose: false }) },
        { id: 'd', correct: at({ direct: false, plan: false, decompose: false }) },
      ],
      'direct',
      ['direct', 'plan', 'decompose'],
    );
    expect(result.questions).toBe(4);
    expect(result.perArm).toEqual({ direct: 1, plan: 1, decompose: 1 });
    expect(result.union).toBe(3);
    expect(result.control).toBe(1);
    expect(result.ceilingPp).toBe(50);
  });

  it('counts a question the control already answered as no ceiling', () => {
    // A selector cannot gain where the first attempt was already right, however many other
    // generators also answered it.
    const result = unionCeiling(
      [{ id: 'a', correct: at({ direct: true, plan: true, decompose: true }) }],
      'direct',
      ['direct', 'plan', 'decompose'],
    );
    expect(result.union).toBe(1);
    expect(result.control).toBe(1);
    expect(result.ceilingPp).toBe(0);
  });

  it('reports how often the generators disagreed, because agreement is a ceiling with no choice in it', () => {
    const result = unionCeiling(
      [
        { id: 'a', correct: at({ direct: true, plan: true, decompose: true }) },
        { id: 'b', correct: at({ direct: false, plan: true, decompose: false }) },
        { id: 'c', correct: at({ direct: false, plan: false, decompose: true }) },
        { id: 'd', correct: at({ direct: true, plan: false, decompose: false }) },
      ],
      'direct',
      ['direct', 'plan', 'decompose'],
    );
    expect(result.disagreementShare).toBe(0.75);
  });

  it('names the generator that alone reaches the union, so a dominated pool is not called diverse', () => {
    // R7.1's criterion 4: if one generator answers everything the pool answers, the other two are
    // paying for calls and adding nothing.
    const result = unionCeiling(
      [
        { id: 'a', correct: at({ direct: false, plan: true, decompose: false }) },
        { id: 'b', correct: at({ direct: false, plan: true, decompose: false }) },
        { id: 'c', correct: at({ direct: true, plan: true, decompose: false }) },
      ],
      'direct',
      ['direct', 'plan', 'decompose'],
    );
    expect(result.union).toBe(3);
    expect(result.dominant).toBe('plan');
  });

  it('names no generator when the ceiling needs more than one of them', () => {
    const result = unionCeiling(
      [
        { id: 'a', correct: at({ direct: false, plan: true, decompose: false }) },
        { id: 'b', correct: at({ direct: false, plan: false, decompose: true }) },
      ],
      'direct',
      ['direct', 'plan', 'decompose'],
    );
    expect(result.dominant).toBeNull();
  });

  it('treats a missing arm on a case as not answered rather than as a crash', () => {
    // The artefact records only the arms that ran, and a case scored before an arm was added has no
    // entry for it. Reading absence as `undefined` would make the sum NaN and the ceiling invisible.
    const result = unionCeiling(
      [{ id: 'a', correct: at({ direct: true }) }],
      'direct',
      ['direct', 'plan'],
    );
    expect(result.perArm).toEqual({ direct: 1, plan: 0 });
    expect(result.union).toBe(1);
  });

  it('reports zeros rather than NaN when there were no cases', () => {
    const result = unionCeiling([], 'direct', ['direct', 'plan']);
    expect(result.questions).toBe(0);
    expect(result.ceilingPp).toBe(0);
    expect(result.disagreementShare).toBe(0);
    expect(Number.isNaN(result.disagreementShare)).toBe(false);
  });

  it('ignores the control when it is also named among the arms, rather than counting it twice', () => {
    const result = unionCeiling(
      [{ id: 'a', correct: at({ direct: true, plan: false }) }],
      'direct',
      ['direct', 'plan'],
    );
    expect(result.arms).toEqual(['direct', 'plan']);
    expect(result.union).toBe(1);
  });
});

describe('unionCeiling distinctness', () => {
  it('counts how many different answers the armed pool produced, not how many arms ran', () => {
    // R7.1's criterion 3 in the terms that decide it. Four arms that write four different statements
    // and execute to two different results are a pool of two: a selector has two objects to rank,
    // and the other two arms are extra calls.
    const result = unionCeiling(
      [
        {
          id: 'a',
          correct: at({ direct: false, plan: true, decompose: false }),
          keys: at({ direct: 'r1', plan: 'r2', decompose: 'r1' }),
        },
        {
          id: 'b',
          correct: at({ direct: false, plan: true, decompose: true }),
          keys: at({ direct: 'r1', plan: 'r1', decompose: 'r1' }),
        },
      ],
      'direct',
      ['direct', 'plan', 'decompose'],
    );
    expect(result.distinct.mean).toBeCloseTo(1.5, 6);
    expect(result.distinct.median).toBe(1.5);
    expect(result.distinct.histogram).toEqual({ '1': 1, '2': 1 });
  });

  it('calls a pool where most questions collapse to one answer narrow', () => {
    // Two answers from six draws is the same collapse R7.0 measured on sampling draws, read on the
    // generator pool with the same bar: the rule does not change because the arms changed.
    const collapsed = Array.from({ length: 6 }, (_, index) => ({
      id: `q${index}`,
      correct: at({ direct: false, plan: false, decompose: false, extra: false }),
      keys: at({ direct: 'r1', plan: 'r1', decompose: 'r1', extra: 'r1' }),
    }));
    const result = unionCeiling(collapsed, 'direct', ['direct', 'plan', 'decompose', 'extra']);
    expect(result.distinct.median).toBe(1);
    expect(result.distinct.share).toBeCloseTo(0.25, 6);
    expect(result.distinct.verdict).toBe('narrow');
  });

  it('calls a pool wide when the arms mostly produce different answers', () => {
    const varied = Array.from({ length: 6 }, (_, index) => ({
      id: `q${index}`,
      correct: at({ direct: false, plan: true, decompose: false, extra: false }),
      keys: at({ direct: 'r1', plan: 'r2', decompose: 'r3', extra: 'r4' }),
    }));
    const result = unionCeiling(varied, 'direct', ['direct', 'plan', 'decompose', 'extra']);
    expect(result.distinct.median).toBe(4);
    expect(result.distinct.verdict).toBe('wide');
  });

  it('refuses to call it either way in between, the same refusal the sampling pool gets', () => {
    // Half the questions collapse to one answer and half to two: a median of 1.5 from four arms is
    // 0.375 of the pool, above the collapse bar and below the diversity bar.
    const middle = Array.from({ length: 8 }, (_, index) => ({
      id: `q${index}`,
      correct: at({ direct: false, plan: true, decompose: false, extra: false }),
      keys:
        index < 4
          ? at({ direct: 'r1', plan: 'r1', decompose: 'r1', extra: 'r1' })
          : at({ direct: 'r1', plan: 'r2', decompose: 'r2', extra: 'r2' }),
    }));
    const result = unionCeiling(middle, 'direct', ['direct', 'plan', 'decompose', 'extra']);
    expect(result.distinct.median).toBe(1.5);
    expect(result.distinct.verdict).toBe('between');
  });

  it('does not count an arm that failed as a distinct answer', () => {
    // A statement that did not run produced no answer. Counting its absence as one would let a pool
    // of one answer and three errors look like a pool of four.
    const result = unionCeiling(
      [
        {
          id: 'a',
          correct: at({ direct: false, plan: true }),
          keys: at({ direct: null, plan: 'r1' }),
        },
      ],
      'direct',
      ['direct', 'plan'],
    );
    expect(result.distinct.median).toBe(1);
  });

  it('reports no distinctness at all when no case carries result keys', () => {
    // An artefact written before this field existed must not report a pool of zero answers as a
    // collapsed pool: the distinction between "not measured" and "measured as narrow" is the whole
    // reason the field is optional.
    const result = unionCeiling(
      [{ id: 'a', correct: at({ direct: true, plan: false }) }],
      'direct',
      ['direct', 'plan'],
    );
    expect(result.distinct.measured).toBe(false);
    expect(result.distinct.mean).toBe(0);
    expect(result.distinct.verdict).toBe('between');
  });

  it('reports a share of zero rather than NaN when no arm was named', () => {
    // A union over nothing is a caller's mistake, and the reading has to survive it: a NaN share
    // would propagate into a verdict comparison and read as neither wide nor narrow.
    const result = unionCeiling([{ id: 'a', correct: {} }], 'direct', []);
    expect(result.distinct.arms).toBe(0);
    expect(result.distinct.share).toBe(0);
    expect(Number.isNaN(result.distinct.mean)).toBe(false);
  });

  it('counts only the arms that reported a key when the pool is partial', () => {
    const result = unionCeiling(
      [
        {
          id: 'a',
          correct: at({ direct: true, plan: false }),
          keys: at({ direct: 'r1', plan: 'r2' }),
        },
        { id: 'b', correct: at({ direct: true, plan: false }) },
      ],
      'direct',
      ['direct', 'plan'],
    );
    expect(result.distinct.measured).toBe(true);
    expect(result.distinct.arms).toBe(2);
    expect(result.distinct.mean).toBeCloseTo(1, 6);
  });
});
