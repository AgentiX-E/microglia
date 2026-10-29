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
