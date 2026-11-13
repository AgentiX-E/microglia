/**
 * Would the store have recurrence if corrections of one shape were one record?
 *
 * R92's store carries `supportTasks: 1` fifteen times, and §34.122 showed why: the dedupe key is the
 * normalized **statement**, one correction produces one statement, and two failures of the same *shape*
 * differ in every token that matters to a statement key — the order id, the item ids, the gift-card id —
 * so they are two items with one task behind each. ALTK's `sup3` keeps what three distinct tasks agreed
 * on, and no arm in this record can produce an item three tasks agreed on.
 *
 * This module does not merge anything. It **prices** the merge, because the merge is a treatment and a
 * treatment needs a registration, a prediction and a cost. What is free is the answer to "how many rules
 * would there be, and what support would they carry", computed from a learn half the lane has already
 * paid for:
 *
 *   - on the shape the lane writes today (one record per failed task), the answer is "fifteen rules,
 *     support 1, `atLeastThree: 0`" — which is the whole gap to the competitor, stated as arithmetic
 *     rather than as an opinion;
 *   - if the same corrections are grouped by the **tool sequence** they call, the answer is the number
 *     of distinct routines the learn half actually contains, and the distribution of how many tasks
 *     taught each one.
 *
 * The second number is the one that decides whether a merge arm is worth a dispatch. A merge that turns
 * fifteen records into fourteen has merged nothing; a merge that turns fifteen into six with support
 * 2–4 has produced the object `sup3` is made of.
 *
 * ## What a shape is, and what it deliberately is not
 *
 * A shape is the **ordered list of tool names** a task's reference trajectory calls —
 * `get_order_details > exchange_delivered_order_items` — and not the arguments. The arguments are the
 * instance; the sequence is the routine, which is the unit AWM calls a workflow and the unit ExpeL's
 * `UPVOTE` merges. Grouping on arguments would reproduce today's store exactly.
 *
 * A task that states no calls (a rubric-only task, seven of the shipped 114) carries no routine and is
 * given a key of its own rather than a shared empty string: two rubrics are two requirements, and
 * grouping them by "neither names a call" would merge a policy about gift cards with one about
 * addresses.
 */
import type { Correction } from './tau2.js';

/** One routine, and the corrections that taught it. */
export type ShapeGroup = {
  /** `a > b > c`, or `task:<id>` for a correction that states no calls. */
  readonly shape: string;
  readonly corrections: number;
  readonly tasks: readonly string[];
};

/** What merging by shape would produce, computed from the corrections a learn half yielded. */
export type MergeCensus = {
  /** Corrections the learn half produced — the store's size if nothing merges. */
  readonly corrections: number;
  /** Distinct shapes. Equal to `corrections` when nothing would merge. */
  readonly shapes: number;
  /** Corrections belonging to a shape that at least two corrections share. */
  readonly mergeable: number;
  /** Records a shape-keyed store would hold: one per shape. */
  readonly wouldStore: number;
  /** The support distribution a merged store would carry, over shapes. */
  readonly support: {
    readonly max: number;
    /** Shapes taught by ≥2 tasks — ALTK's `sup2`. */
    readonly atLeastTwo: number;
    /** Shapes taught by ≥3 tasks — the cell ALTK's `sup3` keeps. */
    readonly atLeastThree: number;
  };
  /** Shapes with ≥2 members, largest first, then by shape; bounded by the caller's cap. */
  readonly groups: readonly ShapeGroup[];
  /** Groups that did not fit the cap, so a bounded list is never read as the whole population. */
  readonly omitted: number;
};

/** How many merged groups the artefact carries, which is a sample and says so. */
export const MERGE_GROUP_CAP = 32;

/**
 * The routine a correction calls, in order.
 *
 * Names only: two failures of one routine differ in exactly the arguments a shape has to ignore. A
 * correction that states no calls is keyed by its task so it can never merge with another.
 */
export function actionShapeOf(correction: Pick<Correction, 'actions' | 'taskId'>): string {
  if (correction.actions.length === 0) return `task:${correction.taskId}`;
  return correction.actions.map((action) => action.name).join(' > ');
}

/**
 * Group corrections by the routine they call, and report what a shape-keyed store would hold.
 *
 * Order-preserving and deterministic: groups are ranked by size, then by shape, so two arms that
 * produced the same corrections produce the same census — and an artefact written by a dispatch whose
 * learn half iterates differently still compares.
 */
export function mergeCensusOf(
  corrections: readonly Correction[],
  cap: number = MERGE_GROUP_CAP,
): MergeCensus {
  const byShape = new Map<string, { corrections: number; tasks: string[] }>();
  for (const correction of corrections) {
    const shape = actionShapeOf(correction);
    const bucket = byShape.get(shape);
    if (bucket === undefined) {
      byShape.set(shape, { corrections: 1, tasks: [correction.taskId] });
      continue;
    }
    bucket.corrections += 1;
    // A task contributes one correction, so the task list is the support; the guard against a repeat
    // is here rather than assumed, because `distinctTasks` counts distinct tasks and so must this.
    if (!bucket.tasks.includes(correction.taskId)) bucket.tasks.push(correction.taskId);
  }

  let mergeable = 0;
  let atLeastTwo = 0;
  let atLeastThree = 0;
  let max = 0;
  for (const bucket of byShape.values()) {
    const support = bucket.tasks.length;
    if (bucket.corrections > 1) mergeable += bucket.corrections;
    if (support >= 2) atLeastTwo += 1;
    if (support >= 3) atLeastThree += 1;
    if (support > max) max = support;
  }

  const groups = [...byShape.entries()]
    .filter(([, bucket]) => bucket.corrections > 1)
    .map(([shape, bucket]) => ({
      shape,
      corrections: bucket.corrections,
      tasks: [...bucket.tasks],
    }))
    // Largest first, then by shape. Two arms that produced the same corrections produce the same
    // census, so an artefact compares without a second sort — and `||` rather than a nested ternary
    // because shapes are distinct, which makes the comparator's second arm the only tie-break there is.
    .sort(
      (left, right) =>
        right.corrections - left.corrections || (left.shape < right.shape ? -1 : 1),
    );

  const bound = Math.max(0, Math.trunc(cap));
  return {
    corrections: corrections.length,
    shapes: byShape.size,
    mergeable,
    wouldStore: byShape.size,
    support: { max, atLeastTwo, atLeastThree },
    groups: groups.slice(0, bound),
    omitted: groups.length - groups.slice(0, bound).length,
  };
}
