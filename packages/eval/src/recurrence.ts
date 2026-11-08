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
 *
 * Its third is the cross-check the two blocks make possible, and it only exists because the artefact
 * carries the store as well as the census: **a pass that reports a group must leave an item backed by
 * two tasks.** A group of items that all came from one task merges into an item still backed by one,
 * and a census read from a different store than the one reported would show the same thing. Either
 * way the census would be describing a corroboration that the store it ships does not contain, which
 * is the R48 defect one field over.
 */
import type { ConsolidationCensus } from "@agentix-e/microglia-core/distill";
import type { StoreItemSample } from "./store-items.js";
import type { DistillUnitRecord } from "./tau2-instrument.js";

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
export function recurrenceGate(
  record: DistillUnitRecord,
  store?: StoreItemSample,
): RecurrenceGate {
  const criterion =
    "a trace arm reports both support distributions, and they describe the store it reports — " +
    "including the item the pass says it corroborated";
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
  // The cross-check needs the whole store. A sample that omitted items could hold the corroborated
  // one outside the window, and failing a gate for that would be failing it for the sample's limit
  // rather than for the run's arithmetic — so an incomplete sample reports the reading as ungraded
  // instead of as a violation.
  const corroborated =
    store === undefined || store.omitted > 0
      ? undefined
      : store.items.filter((item) => item.supportTasks >= 2).length;
  // The census and the store have to agree about the maximum, and this is the reading that makes
  // them: `maxSupportAfter` is computed by the pass over survivors it wrote back, so a store that
  // reports a different maximum was sampled at a different moment or from a different store. The
  // previous check only asked whether *any* item was corroborated, which a store whose baseline was
  // already 2 satisfies without the pass having done anything.
  const storeMax =
    store === undefined || store.omitted > 0
      ? undefined
      : store.items.reduce(
          (most, item) => Math.max(most, item.supportTasks),
          0,
        );
  const consistent =
    storeMax === undefined || storeMax === census.maxSupportAfter;
  return {
    pass: reconciled && consistent,
    actual:
      `${String(census.considered)}→${String(census.retained)} item(s), ` +
      `${String(census.groups)} group(s) of which ${String(census.crossTaskGroups)} bought a task, ` +
      `max support ${String(census.maxSupportBefore)}→${String(census.maxSupportAfter)}, ` +
      `weakest pair ${census.weakestPair.toFixed(2)}, distributions ` +
      `${String(before)}/${String(census.considered)} and ` +
      `${String(after)}/${String(census.retained)}, floors ` +
      (census.conditionMinShared === 0
        ? `${String(census.threshold)} with no condition veto`
        : `${String(census.threshold)}/${String(census.conditionMinShared)} shared term(s)`) +
      (corroborated === undefined
        ? ", store not sampled whole"
        : `, ${String(corroborated)} item(s) backed by two or more tasks`),
    criterion,
  };
}
