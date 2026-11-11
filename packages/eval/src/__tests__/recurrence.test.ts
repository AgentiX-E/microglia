/**
 * The gate that decides whether a trace arm's support reading can be read.
 *
 * R58's question ("did any claim recur?") is a number, and a number needs a population. The
 * census is that population, and the two ways it can be wrong are the two ways this artefact has
 * been wrong before: the pass did not run and nothing said so, or the distribution was computed over
 * a different set of items than the counts beside it.
 */
import { describe, expect, it } from "vitest";
import { recurrenceCensus, recurrenceGate } from "../recurrence.js";
import type { StoreItemRecord, StoreItemSample } from "../store-items.js";
import type {
  ConsolidationCensus,
  DistillUnitRecord,
} from "../tau2-instrument.js";

const stored = (id: string, supportTasks: number): StoreItemRecord => ({
  id,
  kind: "procedure",
  status: "active",
  statement: "confirm the customer identity before changing a booking",
  trust: 0.9,
  scope: { domain: "retail" },
  supportTasks,
  evidence: supportTasks,
});

const sample = (
  items: readonly StoreItemRecord[],
  omitted = 0,
): StoreItemSample => ({
  items,
  limit: 64,
  maxChars: 240,
  omitted,
  truncated: 0,
});

const census = (
  overrides: Partial<ConsolidationCensus> = {},
): ConsolidationCensus => ({
  considered: 7,
  groups: 2,
  merged: 3,
  retained: 4,
  threshold: 0.6,
  conditionMinShared: 0,
  refusedCondition: 0,
  refusedPayload: 0,
  refusedDuplicateEvidence: 0,
  refusedLinkage: 0,
  supportBefore: { 1: 7 },
  supportAfter: { 1: 2, 2: 1, 3: 1 },
  maxSupportBefore: 1,
  maxSupportAfter: 3,
  groupDetail: [
    {
      ids: ["k1", "k2", "k3"],
      supportTasks: 3,
      weakestPair: 0.66,
      conditionShared: 1,
      crossTask: true,
    },
    {
      ids: ["k4", "k5"],
      supportTasks: 2,
      weakestPair: 0.61,
      conditionShared: 4,
      crossTask: true,
    },
  ],
  weakestPair: 0.61,
  largestGroup: 3,
  crossTaskGroups: 2,
  ...overrides,
});

const record = (
  overrides: Partial<DistillUnitRecord> = {},
): DistillUnitRecord => ({
  unit: "trace",
  traces: 32,
  traced: 30,
  claims: 71,
  consolidation: census(),
  ...overrides,
});

describe("recurrenceGate", () => {
  it("passes an arm whose distributions describe the store it reports", () => {
    const gate = recurrenceGate(record());
    expect(gate.pass).toBe(true);
    expect(gate.actual).toContain("max support 1→3");
    // The floors travel with the reading: a store consolidated at 0.6 and one consolidated at 0.7
    // are two experiments, and a gate that reported the support without them would let the second
    // be read as the first.
    // No condition veto is a setting, not a missing number: the floor is 0.6 and nothing else, and
    // the phrase has to say so rather than print "0.6/0" as if a floor of zero shared terms were a
    // floor. A store consolidated at 0.6 with a veto and one without are two experiments.
    expect(gate.actual).toContain("0.6 with no condition veto");
  });

  it("prints a condition veto as a floor, so an ablation is not read as the operating setting", () => {
    // The registration's ablation re-runs the pass with the old gate at 3. Its census has to be
    // distinguishable from the operating one in the text a readback greps, or the two arms read the
    // same and the ablation measures nothing.
    const gate = recurrenceGate(
      record({ consolidation: census({ conditionMinShared: 3 }) }),
    );
    expect(gate.pass).toBe(true);
    expect(gate.actual).toContain("floors 0.6/3 shared term(s)");
  });

  it("fails a trace arm whose pass did not run, because there is no after-state to read", () => {
    const gate = recurrenceGate(record({ consolidation: undefined }));
    expect(gate.pass).toBe(false);
    expect(gate.actual).toContain("no consolidation census");
    expect(gate.criterion).toContain("both support distributions");
  });

  it("fails a census whose before-distribution does not sum to the items it counted", () => {
    const gate = recurrenceGate(
      record({ consolidation: census({ supportBefore: { 1: 6 } }) }),
    );
    expect(gate.pass).toBe(false);
    expect(gate.actual).toContain("6/7");
  });

  it("fails a census whose after-distribution does not sum to the survivors", () => {
    const gate = recurrenceGate(
      record({ consolidation: census({ supportAfter: { 1: 2, 2: 1 } }) }),
    );
    expect(gate.pass).toBe(false);
    expect(gate.actual).toContain("3/4");
  });

  it("passes an arm that merged nothing, because no recurrence and no pass are different findings", () => {
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
    expect(gate.actual).toContain("0 group(s)");
  });
});

describe("recurrenceGate — the store the census describes", () => {
  it("passes when the maximum the census reports is the maximum the store holds", () => {
    // The check used to ask whether *any* item was backed by two tasks. A store whose baseline was
    // already 2 satisfied that without the pass having done anything, so it could not tell a merge
    // from a store that arrived merged. The maximum is the reading both blocks are written from.
    const gate = recurrenceGate(
      record(),
      sample([stored("k1", 3), stored("k2", 1)]),
    );
    expect(gate.pass).toBe(true);
    expect(gate.actual).toContain("1 item(s) backed by two or more tasks");
  });

  it("fails a store holding a maximum the census never reported", () => {
    // The other direction of the same comparison. A store at 4 against a census that says 3 is a
    // census describing a different store than the artefact ships, and the corroboration it reports
    // is not larger than the one it has — it is a different measurement.
    const gate = recurrenceGate(
      record(),
      sample([stored("k1", 4), stored("k2", 1)]),
    );
    expect(gate.pass).toBe(false);
  });

  it("fails a census that reports a group the store it ships does not contain", () => {
    // Two claims from one task merge into an item still backed by one task, and a census read from a
    // different store than the one reported reads the same way. Both are a corroboration the artefact
    // claims and does not hold, and this is the only place the two blocks can be compared.
    const gate = recurrenceGate(
      record(),
      sample([stored("k1", 1), stored("k2", 1)]),
    );
    expect(gate.pass).toBe(false);
    expect(gate.actual).toContain("0 item(s) backed by two or more tasks");
  });

  it("passes a store where nothing merged and no item is backed by two tasks", () => {
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
      sample([stored("k1", 1), stored("k2", 1)]),
    );
    expect(gate.pass).toBe(true);
  });

  it("does not grade the cross-check on a sample that omitted items", () => {
    // The corroborated item could be outside the window. Failing here would be failing the sample's
    // limit, not the run's arithmetic, so the reading is reported as ungraded instead.
    const gate = recurrenceGate(record(), sample([stored("k1", 1)], 12));
    expect(gate.pass).toBe(true);
    expect(gate.actual).toContain("store not sampled whole");
  });

  it("keeps the distribution reconciliation first, so an incomplete sample cannot hide it", () => {
    const gate = recurrenceGate(
      record({
        consolidation: census({ retained: 4, supportAfter: { 1: 3 } }),
      }),
      sample([stored("k1", 2)], 12),
    );
    expect(gate.pass).toBe(false);
  });
});

/**
 * R55.0 — the distribution itself, not the gate over it.
 *
 * The gate above decides whether a support reading may be read at all. This is the reading: how many
 * items the store holds at each support count, and whether the sample that reports it is the store.
 * The domain's SOTA holder admits claims only at support across three distinct tasks and carries ~5
 * items per learning task; this lane carries 0.50. Until the histogram exists, "the store is too thin"
 * is an inference from an item count rather than a measurement of what the store contains.
 */
describe('recurrenceCensus', () => {
  it('reports one bucket per support value and sums to the sample', () => {
    const reading = recurrenceCensus(sample([stored('a', 1), stored('b', 1), stored('c', 3)]));
    expect(reading.histogram).toEqual({ 1: 2, 3: 1 });
    expect(reading.sampled).toBe(3);
    expect(reading.max).toBe(3);
    expect(reading.atLeastTwo).toBe(1);
    expect(reading.atLeastThree).toBe(1);
  });

  it('reports a store that does not recur as a maximum of one', () => {
    // This is the reading R55.0 exists to make: every item backed by exactly one task is a store in
    // which no claim has been corroborated, whatever its item count says.
    const reading = recurrenceCensus(sample([stored('a', 1), stored('b', 1)]));
    expect(reading.max).toBe(1);
    expect(reading.atLeastTwo).toBe(0);
    expect(reading.atLeastThree).toBe(0);
  });

  it('refuses to call a truncated sample the store', () => {
    // The sample's own limit is not the store's size, and a census that reported `atLeastThree: 0`
    // over 64 of 400 items would be answering a question about the first 64 items under the store's
    // name. `whole` is the field a readback has to check before quoting a zero.
    const reading = recurrenceCensus(sample([stored('a', 1)], 336));
    expect(reading.whole).toBe(false);
    expect(reading.omitted).toBe(336);
    expect(reading.sampled).toBe(1);
  });

  it('reports an empty store as empty rather than as whole', () => {
    const reading = recurrenceCensus(sample([]));
    expect(reading.histogram).toEqual({});
    expect(reading.max).toBe(0);
    expect(reading.sampled).toBe(0);
    expect(reading.whole).toBe(true);
  });
});
