/**
 * How many claims one correction yields, which is the number that decides whether a store can recur.
 *
 * ## Why this is a record and not a remark
 *
 * R58's store held 15 claims from 7 corrections — 2.14 per correction — and the competitive record
 * it is compared against keeps roughly five guidelines per learning task. That is the gap that
 * matters, and until now it was computed by hand from two numbers in different blocks of the
 * artefact. A yield that is not recorded per correction cannot be attributed: a distiller that writes
 * two claims from a trace with one failed assertion and two from a trace with six is not yielding the
 * same thing, and the aggregate `claims / corrections` cannot tell them apart.
 *
 * ## What it counts
 *
 * One row per correction: the failed rubric assertions it carried, and the stored items that cite it.
 * Claims are counted from the store rather than from the interpreter's report, because a candidate
 * the host refused is not yield — it is a claim that never reached a pack, and the funnel already
 * counts those.
 *
 * The median is reported beside the mean because the distribution is the interesting part: a
 * distiller that writes three claims for one correction and none for nine has the same mean as one
 * that writes one for each of three.
 */
export type CorrectionYield = {
  /** The task the correction belongs to, qualified as τ² names it. */
  readonly taskId: string;
  /** Failed rubric assertions the correction carried, which is what the prompt had to work with. */
  readonly assertions: number;
  /** Stored items citing this correction. */
  readonly claims: number;
};

export type YieldCensus = {
  readonly corrections: number;
  readonly assertions: number;
  readonly claims: number;
  /** The largest number of claims one correction produced. */
  readonly maxClaims: number;
  /** Middle of the per-correction claim counts, exactly as the store's own distribution. */
  readonly medianClaims: number;
  readonly perCorrection: readonly CorrectionYield[];
};

/** Middle value of a sorted list; the lower of the two middles for an even count. */
function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)] as number;
}

/**
 * One row per captured correction, with the stored items that cite it.
 *
 * The join is on `EvidenceRef.runId` and not on the task id, because a correction is captured under
 * one run and an item's evidence names that run: two corrections of one task are two events, and a
 * join on the task would attribute both items to both of them and double the yield. An item that
 * names its run twice counts once — the count is items, not citations.
 *
 * Retired items count. A claim written and then folded into a paraphrase by consolidation was
 * written, and a yield that dropped it would report the pass as a loss of claims rather than a
 * change in their shape.
 */
export function claimsPerCorrection(
  captured: readonly { readonly taskId: string; readonly runId: string; readonly assertions: number }[],
  items: readonly { readonly evidence: readonly { readonly runId: string }[] }[],
): readonly CorrectionYield[] {
  return captured.map((row) => {
    let claims = 0;
    for (const item of items) if (item.evidence.some((entry) => entry.runId === row.runId)) claims += 1;
    return { taskId: row.taskId, assertions: row.assertions, claims };
  });
}

/**
 * The census over one learning half.
 *
 * `rows` is passed in rather than derived here, so the counting of "items citing this correction" is
 * the driver's job: it is the only layer that knows which run id a correction was captured under, and
 * a helper that guessed it from a task id would count a correction twice when two corrections share
 * one task.
 */
export function yieldCensus(rows: readonly CorrectionYield[]): YieldCensus {
  const claims = rows.reduce((sum, row) => sum + row.claims, 0);
  const assertions = rows.reduce((sum, row) => sum + row.assertions, 0);
  return {
    corrections: rows.length,
    assertions,
    claims,
    maxClaims: rows.reduce((most, row) => Math.max(most, row.claims), 0),
    medianClaims: median(rows.map((row) => row.claims)),
    perCorrection: [...rows],
  };
}
