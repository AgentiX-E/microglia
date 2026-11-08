/**
 * The consolidation floor as a swept instrument rather than a constant.
 *
 * R60 raised the trace ceiling from 3 to 6 and the yield moved exactly as predicted — median claims
 * per correction 2 → 3, claims per correction 2.21 → 3.08, max 4 — and corroboration did not move
 * at all: support 2 stayed at one item and support 3 stayed at none, at 37 claims against R59's 31.
 * That is not a yield problem any more. More claims from the same failure episodes cannot produce a
 * second witness, so the question moved to the pass that is supposed to recognise witnesses.
 *
 * The pass had two defects, both provable without another dispatch.
 *
 * The condition veto was a hard floor of three shared condition terms, argued as separating a
 * paraphrased trigger from an unrelated one. Measured over the 37 items R60 produced — 666 pairs —
 * the shared condition count has median 1 among pairs whose statements match and median 1 among
 * pairs whose statements are unrelated, with 75% and 82% of each band sharing at least one term.
 * The ratio is the same, median 0.11 in both. Applied *after* the statement gate it never sees an
 * unrelated pair, so its only measurable effect on this store was to keep 1 of the 4 pairs above
 * 0.60 containment — including a pair at 0.88 containment and 0.70 Jaccard, which is the most
 * similar pair the store held.
 *
 * The grouping was single linkage, so A resembling B and B resembling C became one group of three
 * whose extreme members could share one term in five, reported as a corroboration.
 *
 * Both are now reported here rather than argued: this module runs the pass over a grid and records
 * what each setting would have produced, with the operating point marked. A readback can then ask
 * what the floor cost instead of assuming it cost nothing.
 */
import {
  consolidateKnowledge,
  type ConsolidatedGroup,
  type ConsolidationOptions,
  type KnowledgeItem,
} from "@agentix-e/microglia-core/distill";

/** Statement floors to sweep. The top of the range is where only near-verbatim repeats merge. */
export const SWEEP_THRESHOLDS = [
  0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8,
] as const;

/**
 * Condition floors to sweep, with `0` first.
 *
 * Zero is "no veto" and it is the operating setting. The other three reproduce the scale the veto
 * used to be on, so the artefact carries the ablation of the module it replaced rather than a
 * description of it.
 */
export const SWEEP_CONDITIONS = [0, 1, 2, 3] as const;

/** What one grid point would have produced. */
export type SweepPoint = {
  readonly threshold: number;
  readonly conditionMinShared: number;
  readonly groups: number;
  readonly merged: number;
  readonly maxSupport: number;
  /** Items by distinct tasks after the pass, which is the distribution a threshold is read off. */
  readonly support: Readonly<Record<number, number>>;
  /** Groups whose union covers a task no single member held. */
  readonly crossTaskGroups: number;
  readonly largestGroup: number;
  /** The weakest pair across every group: complete linkage guarantees it clears the floor. */
  readonly weakestPair: number;
};

export type ConsolidationSweep = {
  /** Every point, ordered by threshold then condition floor. */
  readonly points: readonly SweepPoint[];
  /** The point the run actually used, so a reader need not match floats to find it. */
  readonly operating: SweepPoint;
  /** The groups the operating pass formed, as it reported them. */
  readonly groups: readonly ConsolidatedGroup[];
};

function pointOf(
  threshold: number,
  conditionMinShared: number,
  report: ReturnType<typeof consolidateKnowledge>["report"],
): SweepPoint {
  return {
    threshold,
    conditionMinShared,
    groups: report.groups,
    merged: report.merged,
    maxSupport: report.maxSupportAfter,
    support: report.supportAfter,
    crossTaskGroups: report.crossTaskGroups,
    largestGroup: report.largestGroup,
    weakestPair: report.weakestPair,
  };
}

/**
 * Run the pass over the grid and keep the operating point's groups.
 *
 * The operating point is run first and its result is the one reported as `operating`, never a
 * recomputation of the same setting: a sweep that recomputed it could disagree with the pass the
 * store was actually written from, and then the artefact would carry two answers to one question.
 */
export function sweepConsolidation(
  items: readonly KnowledgeItem[],
  options: Omit<ConsolidationOptions, "threshold" | "conditionMinShared"> & {
    readonly threshold: number;
    readonly conditionMinShared: number;
  },
  thresholds: readonly number[] = SWEEP_THRESHOLDS,
  conditions: readonly number[] = SWEEP_CONDITIONS,
): ConsolidationSweep {
  const operatingRun = consolidateKnowledge(items, {
    ...options,
    threshold: options.threshold,
    conditionMinShared: options.conditionMinShared,
  });
  const operating = pointOf(
    options.threshold,
    options.conditionMinShared,
    operatingRun.report,
  );
  const points: SweepPoint[] = [operating];
  for (const threshold of thresholds) {
    for (const conditionMinShared of conditions) {
      const same =
        threshold === options.threshold &&
        conditionMinShared === options.conditionMinShared;
      if (same) continue;
      const run = consolidateKnowledge(items, {
        ...options,
        threshold,
        conditionMinShared,
      });
      points.push(pointOf(threshold, conditionMinShared, run.report));
    }
  }
  points.sort(
    (left, right) =>
      left.threshold - right.threshold ||
      left.conditionMinShared - right.conditionMinShared,
  );
  return { points, operating, groups: operatingRun.report.groupDetail };
}

/**
 * The sweep on one line per threshold, at the operating condition floor.
 *
 * Printed before the evaluation rather than only recorded, because a floor that collapses the store
 * into one group is worth knowing about before an hour is spent evaluating what it serves. The
 * column that decides anything is the last: at how low a floor the store first holds three tasks
 * saying one thing.
 */
export function sweepSummary(sweep: ConsolidationSweep): readonly string[] {
  const condition = sweep.operating.conditionMinShared;
  return sweep.points
    .filter((point) => point.conditionMinShared === condition)
    .map(
      (point) =>
        `threshold ${point.threshold.toFixed(2)}: groups=${String(point.groups)} merged=${String(point.merged)} ` +
        `maxSupport=${String(point.maxSupport)} crossTask=${String(point.crossTaskGroups)} ` +
        `largest=${String(point.largestGroup)} weakest=${point.weakestPair.toFixed(2)}`,
    );
}
