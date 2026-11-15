import { describe, expect, it } from 'vitest';
import { rehearsalLine, rehearsalOf } from '../tau2-rehearsal.js';

const rows = (...pairs: readonly (readonly [string, number | null])[]) =>
  pairs.map(([task, reward]) => ({ task, reward }));

describe('the store on the cases it was built from', () => {
  it('separates the four cells, and rates the two populations that matter', () => {
    const rehearsal = rehearsalOf({
      // One trial each, no memory: five failed and two passed — the shape a learn half produces.
      learnRewards: new Map([
        ['retail/t1', 0],
        ['retail/t2', 0],
        ['retail/t3', 0],
        ['retail/t4', 0],
        ['retail/t5', 0],
        ['retail/t6', 1],
        ['retail/t7', 1],
      ]),
      rehearsalRewards: rows(
        ['retail/t1', 1], // repaired
        ['retail/t2', 1], // repaired
        ['retail/t3', 1], // repaired
        ['retail/t4', 0], // inert
        ['retail/t5', 0], // inert
        ['retail/t6', 0], // broke
        ['retail/t7', 1], // kept
      ),
    });
    expect(rehearsal).toEqual({
      paired: 7,
      repaired: 3,
      broke: 1,
      kept: 1,
      inert: 2,
      // 3 of the 5 that failed without memory: the store repaired its own case three times in five.
      repairRate: 0.6,
      // 1 of the 4 outcomes it changed.
      harmShare: 0.25,
    });
  });

  it('drops what only one side ran, rather than reading it as a failure', () => {
    // The rehearsal runs the learn half's task list, so a mismatch means the two phases disagree about the
    // split — a finding about the plan, not about the memory. Counting the missing side as a failure would turn
    // a plan defect into a store result.
    const rehearsal = rehearsalOf({
      learnRewards: { 'retail/t1': 0, 'retail/t2': 0 },
      rehearsalRewards: rows(['retail/t1', 1], ['retail/t9', 0], ['retail/t2', null]),
    });
    expect(rehearsal).toMatchObject({ paired: 1, repaired: 1, inert: 0, broke: 0, kept: 0 });
  });

  it('answers nothing when nothing paired, because zero would read as "repaired nothing"', () => {
    expect(rehearsalOf({ learnRewards: {}, rehearsalRewards: rows(['retail/t1', 1]) })).toBeUndefined();
    expect(rehearsalOf({ learnRewards: { 'retail/t1': 1 }, rehearsalRewards: rows(['retail/t1', null]) })).toBeUndefined();
    // And the sentence says which absence it is.
    expect(rehearsalLine(undefined, 74)).toContain('not measured — no task carried a reward on both sides');
  });

  it('prints no rate it cannot compute, rather than a zero', () => {
    // A store that broke nothing and repaired nothing has no harm share: `0.00%` would read as a store whose
    // changes were all for the better, which is a different sentence from one that changed nothing.
    const quiet = rehearsalOf({
      learnRewards: { 'retail/t1': 1, 'retail/t2': 0 },
      rehearsalRewards: rows(['retail/t1', 1], ['retail/t2', 0]),
    });
    expect(quiet).toMatchObject({ kept: 1, inert: 1, repairRate: 0, harmShare: null });
    // The clause is omitted rather than printed as `none`: a store that changed no outcome has no harm share,
    // and `0.00%` would read as "every change was for the better".
    expect(rehearsalLine(quiet, 2)).not.toContain('harm share');
    // It is present as soon as there is a change to divide by, which is what makes its absence informative.
    const changed = rehearsalOf({
      learnRewards: { 'retail/t1': 0, 'retail/t2': 1 },
      rehearsalRewards: rows(['retail/t1', 1], ['retail/t2', 0]),
    });
    expect(rehearsalLine(changed, 2)).toContain('harm share 50.00%');
    const nothingFailed = rehearsalOf({
      learnRewards: { 'retail/t1': 1 },
      rehearsalRewards: rows(['retail/t1', 1]),
    });
    expect(nothingFailed?.repairRate).toBeNull();
    // Nothing failed without memory, so there is no repair population: the sentence prints the empty
    // denominator rather than a rate over it.
    expect(rehearsalLine(nothingFailed, 1)).toContain('0 repaired / 0 inert of the 0 that failed without memory (none)');
  });

  it('names the denominator it divides by, because these are not held-out tasks', () => {
    const rehearsal = rehearsalOf({
      learnRewards: { 'retail/t1': 0, 'retail/t2': 0, 'retail/t3': 0, 'retail/t4': 0 },
      rehearsalRewards: rows(['retail/t1', 1], ['retail/t2', 0], ['retail/t3', 0], ['retail/t4', 0]),
    });
    const line = rehearsalLine(rehearsal, 74);
    expect(line).toContain('4 of 74 task(s) replayed');
    expect(line).toContain('1 repaired / 3 inert of the 4 that failed without memory (25.00%)');
  });
});
