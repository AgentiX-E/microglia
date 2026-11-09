/**
 * R62 — which population a stored claim came from.
 *
 * ## Why the join is through evidence and not through a new field
 *
 * A teaching record is one task's trajectory; a stored claim is what the distiller made of it, and one
 * claim can cite several records. The only route from the second back to the first, in a store that
 * already exists, is `EvidenceRef.runId` — the driver knows a record's run id at the moment it opens
 * the handle, so the mapping is exact and needs no schema change.
 *
 * Writing a `provenance` field onto every item instead would have been a second source of truth: the
 * distiller writes items and the driver writes records, so a field on the item would be the driver's
 * opinion about a decision the distiller made. The join is a fact about the data; a field would be a
 * claim about it.
 *
 * ## The four states, and why the mixed one matters
 *
 * An item whose records are all repairs, all passes, or a mixture are three different findings, and a
 * fourth — an item citing no run this round opened — is a defect rather than a category, so it is
 * counted separately and never folded into the other three. That is the whole reason this returns four
 * counts rather than a percentage: `itemsPassedOnly / items` reads the same for a store of pure passes
 * and for a store where every claim was taught by a repair *and* a pass, and the second is the
 * collision the round exists to find.
 */

/** One teaching record, as far as this census needs to see it. */
export type ProvenanceRecord = {
  readonly runId: string;
  readonly taskId: string;
  readonly provenance: 'edited' | 'passed';
};

/** One stored claim, as far as this census needs to see it. */
export type ProvenanceItem = {
  readonly evidence: readonly { readonly runId: string }[];
};

export type ProvenanceCensus = {
  /** Teaching records made from a repair, and from a pass. */
  readonly edited: number;
  readonly passed: number;
  /** Distinct tasks behind each population, which is the denominator support is counted on. */
  readonly tasksEdited: number;
  readonly tasksPassed: number;
  /** Claims every one of whose records is a repair / a pass / a mixture of the two. */
  readonly itemsEditedOnly: number;
  readonly itemsPassedOnly: number;
  readonly itemsMixed: number;
  /**
   * Claims citing no run this round opened.
   *
   * An item whose evidence is unknown was written by something other than this dispatch's teaching
   * loop. It is not a category to explain away: a store holding one is a store whose provenance split
   * cannot be trusted for the rest either, which is why the readback treats it as an instrument failure
   * rather than as a share of the store.
   */
  readonly itemsUnattributed: number;
  /**
   * Evidence references that named no known record, whether or not the item also cited one.
   *
   * Separate from `itemsUnattributed` because the two answer different questions: that one says "this
   * claim came from nowhere", this one says "some of this claim's support cannot be attributed", and a
   * count over items alone would round the second up or down depending on what else the item cited.
   */
  readonly evidenceUnattributed: number;
};

export function provenanceCensus(
  records: readonly ProvenanceRecord[],
  items: readonly ProvenanceItem[],
): ProvenanceCensus {
  const byRun = new Map<string, 'edited' | 'passed'>();
  const tasks: Record<'edited' | 'passed', Set<string>> = {
    edited: new Set(),
    passed: new Set(),
  };
  for (const record of records) {
    byRun.set(record.runId, record.provenance);
    tasks[record.provenance].add(record.taskId);
  }
  let itemsEditedOnly = 0;
  let itemsPassedOnly = 0;
  let itemsMixed = 0;
  let itemsUnattributed = 0;
  let evidenceUnattributed = 0;
  for (const item of items) {
    let sawEdited = false;
    let sawPassed = false;
    for (const ref of item.evidence) {
      const provenance = byRun.get(ref.runId);
      if (provenance === undefined) {
        evidenceUnattributed += 1;
        continue;
      }
      if (provenance === 'edited') sawEdited = true;
      else sawPassed = true;
    }
    // Ordered so the mixture is asked for first: an item citing both populations is the one case the
    // round is looking for, and any ordering that checked `sawEdited` first would file it as a repair.
    if (sawEdited && sawPassed) itemsMixed += 1;
    else if (sawEdited) itemsEditedOnly += 1;
    else if (sawPassed) itemsPassedOnly += 1;
    else itemsUnattributed += 1;
  }
  return {
    edited: records.filter((record) => record.provenance === 'edited').length,
    passed: records.filter((record) => record.provenance === 'passed').length,
    tasksEdited: tasks.edited.size,
    tasksPassed: tasks.passed.size,
    itemsEditedOnly,
    itemsPassedOnly,
    itemsMixed,
    itemsUnattributed,
    evidenceUnattributed,
  };
}
