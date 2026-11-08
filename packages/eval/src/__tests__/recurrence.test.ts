/**
 * The gate that decides whether a trace arm's support reading can be read.
 *
 * R58's question ("did any claim recur?") is a number, and a number needs a population. The
 * census is that population, and the two ways it can be wrong are the two ways this artefact has
 * been wrong before: the pass did not run and nothing said so, or the distribution was computed over
 * a different set of items than the counts beside it.
 */
import { describe, expect, it } from 'vitest';
import { recurrenceGate } from '../recurrence.js';
import type { ConsolidationCensus, DistillUnitRecord } from '../tau2-instrument.js';

const census = (overrides: Partial<ConsolidationCensus> = {}): ConsolidationCensus => ({
  considered: 7,
  groups: 2,
  merged: 3,
  retained: 4,
  threshold: 0.6,
  conditionMinShared: 3,
  refusedCondition: 0,
  refusedPayload: 0,
  refusedDuplicateEvidence: 0,
  supportBefore: { 1: 7 },
  supportAfter: { 1: 2, 2: 1, 3: 1 },
  maxSupportBefore: 1,
  maxSupportAfter: 3,
  ...overrides,
});

const record = (overrides: Partial<DistillUnitRecord> = {}): DistillUnitRecord => ({
  unit: 'trace',
  traces: 32,
  traced: 30,
  claims: 71,
  consolidation: census(),
  ...overrides,
});

describe('recurrenceGate', () => {
  it('passes an arm whose distributions describe the store it reports', () => {
    const gate = recurrenceGate(record());
    expect(gate.pass).toBe(true);
    expect(gate.actual).toContain('max support 1→3');
    // The floors travel with the reading: a store consolidated at 0.6 and one consolidated at 0.7
    // are two experiments, and a gate that reported the support without them would let the second
    // be read as the first.
    expect(gate.actual).toContain('floors 0.6/3');
  });

  it('fails a trace arm whose pass did not run, because there is no after-state to read', () => {
    const gate = recurrenceGate(record({ consolidation: undefined }));
    expect(gate.pass).toBe(false);
    expect(gate.actual).toContain('no consolidation census');
    expect(gate.criterion).toContain('both support distributions');
  });

  it('fails a census whose before-distribution does not sum to the items it counted', () => {
    const gate = recurrenceGate(record({ consolidation: census({ supportBefore: { 1: 6 } }) }));
    expect(gate.pass).toBe(false);
    expect(gate.actual).toContain('6/7');
  });

  it('fails a census whose after-distribution does not sum to the survivors', () => {
    const gate = recurrenceGate(record({ consolidation: census({ supportAfter: { 1: 2, 2: 1 } }) }));
    expect(gate.pass).toBe(false);
    expect(gate.actual).toContain('3/4');
  });

  it('passes an arm that merged nothing, because no recurrence and no pass are different findings', () => {
    const gate = recurrenceGate(
      record({
        consolidation: census({
          groups: 0,
          merged: 0,
          retained: 7,
          supportAfter: { 1: 7 },
          maxSupportAfter: 1,
        }),
      }),
    );
    expect(gate.pass).toBe(true);
    expect(gate.actual).toContain('0 group(s)');
  });
});
