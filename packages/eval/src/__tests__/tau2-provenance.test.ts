/**
 * R62 — the provenance census, and the four readings it must not collapse into one.
 *
 * Every case here is a store that a percentage would describe identically and a count does not:
 *
 *   - three claims from repairs and three from passes vs one claim taught by a repair *and* a pass;
 *   - an item citing a run this round never opened vs an item citing nothing at all;
 *   - an item citing one unknown record beside one known one — attributable, but not entirely.
 *
 * The order of the tests inside the census is what the mixed case exists to pin: a census that checked
 * "saw a repair" before "saw both" would file every collision as a repair and the round's central
 * finding would be invisible in its own instrument.
 */
import { describe, expect, it } from 'vitest';
import { provenanceCensus, type ProvenanceItem, type ProvenanceRecord } from '../tau2-provenance.js';

const record = (
  runId: string,
  provenance: 'edited' | 'passed',
  taskId = `task-${runId}`,
): ProvenanceRecord => ({ runId, taskId, provenance });

const item = (...runIds: string[]): ProvenanceItem => ({
  evidence: runIds.map((runId) => ({ runId })),
});

describe('provenanceCensus', () => {
  it('counts the records of each population and the tasks behind them', () => {
    const census = provenanceCensus(
      [record('r1', 'edited', 't1'), record('r2', 'edited', 't2'), record('r3', 'passed', 't3')],
      [],
    );
    expect(census.edited).toBe(2);
    expect(census.passed).toBe(1);
    expect(census.tasksEdited).toBe(2);
    expect(census.tasksPassed).toBe(1);
  });

  it('counts tasks rather than records when one task teaches twice', () => {
    // A task cannot teach twice in this lane, but the census is a pure function and a caller that
    // opened two handles for one task would otherwise inflate the denominator support is counted on.
    const census = provenanceCensus([record('r1', 'passed', 't1'), record('r2', 'passed', 't1')], []);
    expect(census.passed).toBe(2);
    expect(census.tasksPassed).toBe(1);
  });

  it('tells three single-population claims apart from one mixed claim', () => {
    const records = [record('r1', 'edited'), record('r2', 'passed')];
    const single = provenanceCensus(records, [item('r1'), item('r1'), item('r2')]);
    expect(single.itemsEditedOnly).toBe(2);
    expect(single.itemsPassedOnly).toBe(1);
    expect(single.itemsMixed).toBe(0);

    const mixed = provenanceCensus(records, [item('r1', 'r2')]);
    expect(mixed.itemsMixed).toBe(1);
    expect(mixed.itemsEditedOnly).toBe(0);
    expect(mixed.itemsPassedOnly).toBe(0);
  });

  it('calls an item citing an unknown run unattributed, and one citing nothing at all too', () => {
    const census = provenanceCensus([record('r1', 'edited')], [item('nobody'), item()]);
    expect(census.itemsUnattributed).toBe(2);
    expect(census.itemsEditedOnly).toBe(0);
    // One reference named a run nobody opened; the empty item named none, so the two counts differ.
    expect(census.evidenceUnattributed).toBe(1);
  });

  it('counts an unknown reference beside a known one without misfiling the item', () => {
    const census = provenanceCensus([record('r1', 'passed')], [item('r1', 'nobody')]);
    expect(census.itemsPassedOnly).toBe(1);
    expect(census.itemsUnattributed).toBe(0);
    // The item is attributable *and* one of its supports is not, which is why the two counts exist.
    expect(census.evidenceUnattributed).toBe(1);
  });

  it('reports zeros rather than NaN on an empty store', () => {
    expect(provenanceCensus([], [])).toEqual({
      edited: 0,
      passed: 0,
      tasksEdited: 0,
      tasksPassed: 0,
      itemsEditedOnly: 0,
      itemsPassedOnly: 0,
      itemsMixed: 0,
      itemsUnattributed: 0,
      evidenceUnattributed: 0,
    });
  });

  it('files an item by its later-recorded population when the same run is written twice', () => {
    // Not a case the driver can produce — a run id is minted once — but the map is keyed on it, and a
    // silent last-write-wins is the behaviour a reader has to be able to predict.
    const census = provenanceCensus([record('r1', 'edited'), record('r1', 'passed')], [item('r1')]);
    expect(census.passed).toBe(1);
    expect(census.itemsPassedOnly).toBe(1);
  });
});
