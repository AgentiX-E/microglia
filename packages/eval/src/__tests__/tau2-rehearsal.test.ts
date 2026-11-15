import { describe, expect, it } from 'vitest';
import {
  rehearsalLine,
  rehearsalOf,
  rehearsalRecordOf,
  rehearsalRefused,
  resolveRehearsal,
} from '../tau2-rehearsal.js';

const rows = (...pairs: readonly (readonly [string, number | null])[]) =>
  pairs.map(([task, reward]) => ({ task, reward }));

/** A record for the lines below: the phase ran, served what it served, and paired what it paired. */
const record = (
  reading: ReturnType<typeof rehearsalOf>,
  over: { readonly tasks?: number; readonly requests?: number; readonly served?: number } = {},
) => ({
  tasks: over.tasks ?? 74,
  requests: over.requests ?? 120,
  served: over.served ?? 118,
  reading,
});

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
    // And the sentence says which absence it is: the phase ran, so the counts are measured and the pairing is
    // what came back empty.
    const line = rehearsalLine(record(undefined));
    expect(line).toContain('74 task(s) replayed');
    expect(line).toContain('118 of 120 request(s) served');
    expect(line).toContain('no task carried a reward on both sides');
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
    expect(rehearsalLine(record(quiet))).not.toContain('harm share');
    // It is present as soon as there is a change to divide by, which is what makes its absence informative.
    const changed = rehearsalOf({
      learnRewards: { 'retail/t1': 0, 'retail/t2': 1 },
      rehearsalRewards: rows(['retail/t1', 1], ['retail/t2', 0]),
    });
    expect(rehearsalLine(record(changed))).toContain('harm share 50.00%');
    const nothingFailed = rehearsalOf({
      learnRewards: { 'retail/t1': 1 },
      rehearsalRewards: rows(['retail/t1', 1]),
    });
    expect(nothingFailed?.repairRate).toBeNull();
    // Nothing failed without memory, so there is no repair population: the sentence prints the empty
    // denominator rather than a rate over it.
    expect(rehearsalLine(record(nothingFailed))).toContain(
      '0 repaired / 0 inert of the 0 that failed without memory (none)',
    );
  });

  it('names the denominator it divides by, because these are not held-out tasks', () => {
    const rehearsal = rehearsalOf({
      learnRewards: { 'retail/t1': 0, 'retail/t2': 0, 'retail/t3': 0, 'retail/t4': 0 },
      rehearsalRewards: rows(['retail/t1', 1], ['retail/t2', 0], ['retail/t3', 0], ['retail/t4', 0]),
    });
    const line = rehearsalLine(record(rehearsal));
    expect(line).toContain('4 of 74 task(s) replayed');
    expect(line).toContain('1 repaired / 3 inert of the 4 that failed without memory (25.00%)');
  });

  it('carries the phase\'s own counts beside the reading, so a replay that served nothing reads as one', () => {
    // The three explanations for "the store repaired nothing" are: the pack was empty, the items were inert,
    // and the items were wrong. The four cells can only see the last two, so the served tally travels beside
    // them — a replay of 74 tasks over 0 served requests is a retrieval finding, not a distillation one.
    const silent = rehearsalRecordOf({
      tasks: 74,
      requests: 74,
      served: 0,
      learnRewards: { 'retail/t1': 0 },
      rehearsalRewards: rows(['retail/t1', 0]),
    });
    expect(silent).toMatchObject({ tasks: 74, requests: 74, served: 0 });
    expect(silent.reading).toMatchObject({ repaired: 0, inert: 1 });
    expect(rehearsalLine(silent)).toContain('0 of 74 request(s) served');
  });

  it('pairs the way the driver reads both sides, so a task with four trials is one cell', () => {
    // Both sides are reduced with `bestRewards` upstream, and this asserts the pairing itself counts cases
    // rather than episodes: two rows for one task would otherwise be two cells and a doubled denominator.
    const reading = rehearsalOf({
      learnRewards: { 'retail/t1': 0 },
      rehearsalRewards: rows(['retail/t1', 1]),
    });
    expect(reading?.paired).toBe(1);
    expect(rehearsalLine(record(reading))).toContain('1 of 74 task(s) replayed');
  });

  it('records a phase that was refused before its first call as a refusal, not as an absent block', () => {
    // The window can close between the graded facade and the replay. The arm is already paid for, so the
    // refusal is a reading: absent block would say the registration never bought the phase, and `0 of 0 served`
    // would say the store served nothing, which is the one thing this record must not say about a phase that
    // made no request.
    const refused = rehearsalRefused({ tasks: 74, reason: 'peak-window' });
    expect(refused).toEqual({ tasks: 74, requests: 0, served: 0, reading: undefined, refused: 'peak-window' });
    const line = rehearsalLine(refused);
    expect(line).toContain('not run — the phase refused to open in a peak-rate window');
    expect(line).not.toContain('request(s) served');
  });

  it('refuses a switch it cannot read rather than reading it as off', () => {
    // `1`/`0` are the driver's spelling; `true`/`yes` are the header's. A value outside both sets is a
    // dispatch whose premise nobody stated, and falling back to off would publish the control as the arm.
    expect(resolveRehearsal('')).toBe(false);
    expect(resolveRehearsal(undefined)).toBe(false);
    expect(resolveRehearsal('0')).toBe(false);
    expect(resolveRehearsal(' 0 ')).toBe(false);
    expect(resolveRehearsal('1')).toBe(true);
    expect(() => resolveRehearsal('yes')).toThrow(/TAU_REHEARSAL/);
    expect(() => resolveRehearsal('true')).toThrow(/must be unset, '0' or '1'/);
  });
});
