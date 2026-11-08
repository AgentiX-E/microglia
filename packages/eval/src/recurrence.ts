/**
 * R58 — the one check a recurrence arm's own artefact has to pass before its numbers can be read.
 *
 * The gate is about the *instrument*, not the outcome. Whether an item reached support 3 is the
 * experiment's question and belongs in a readback; whether the artefact's two distributions describe
 * the store it also reports is a question the artefact can answer about itself, and a run that fails
 * it has no support reading at all — the numbers would be a distribution over a population that is
 * not the one the run stored.
 *
 * Its second job is to catch the failure that has no symptom: a trace arm whose consolidation pass
 * never ran. That run has the treatment's name, the control's store, and one fewer field.
 */
import type { ConsolidationCensus } from '@agentix-e/microglia-core/distill';
import type { DistillUnitRecord } from './tau2-instrument.js';

export type RecurrenceGate = {
  readonly pass: boolean;
  readonly actual: string;
  readonly criterion: string;
};

const sum = (distribution: Readonly<Record<number, number>>): number =>
  Object.values(distribution).reduce((total, count) => total + count, 0);

/**
 * Whether a trace arm's artefact can support a recurrence reading at all.
 *
 * Three ways it cannot, and each names itself:
 *  - the pass did not run, so there is no `supportAfter`;
 *  - a distribution does not sum to the population it describes, so the two numbers came from two
 *    different stores;
 *  - the pass reports a `retained` that is not the count of survivors it also reports.
 */
export function recurrenceGate(record: DistillUnitRecord): RecurrenceGate {
  const criterion = 'a trace arm reports both support distributions, and they describe the store it reports';
  const census: ConsolidationCensus | undefined = record.consolidation;
  if (census === undefined) {
    return {
      pass: false,
      actual: `${record.unit} arm, ${String(record.traces)} trace(s), no consolidation census`,
      criterion,
    };
  }
  const before = sum(census.supportBefore);
  const after = sum(census.supportAfter);
  const reconciled = before === census.considered && after === census.retained;
  return {
    pass: reconciled,
    actual:
      `${String(census.considered)}→${String(census.retained)} item(s), ` +
      `${String(census.groups)} group(s), max support ${String(census.maxSupportBefore)}→${String(
        census.maxSupportAfter,
      )}, distributions ${String(before)}/${String(census.considered)} and ` +
      `${String(after)}/${String(census.retained)}`,
    criterion,
  };
}
