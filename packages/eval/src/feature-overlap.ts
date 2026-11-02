/**
 * Are two features the same question asked twice?
 *
 * A corpus of 1,534 questions will always let a second covariate be found. The one that matters is
 * whether it is a second *cause*: if every question that adds a table is also a question that
 * imports an ungrounded name, then "the pack changed the table set" and "the pack imported a name"
 * are one finding wearing two labels, and reporting both would double-count it. If instead the two
 * sets are largely disjoint and each is negative on its own, they are two ways the pack damages a
 * query — which is a different and more useful statement than either alone.
 *
 * The arithmetic is a contingency table plus one contrast the table cannot show: **the right-hand
 * feature measured on the questions the left-hand one does not cover**. A right feature that is
 * only negative because it overlaps a negative left feature reads as zero once the overlap is
 * removed, and that is the reading that decides whether to keep it.
 *
 * Registered in `ROADMAP.md` §R32 prediction 2, which fixes the bar before the numbers are read:
 * `both / left < 0.5`, i.e. fewer than half of the left feature's questions also carry the right.
 */
import { cellOf, type CellReading, type DiffCase } from './query-diff.js';
import type { QueryDelta } from '@agentix-e/microglia-sql';

/** The four cells, and the one reading that decides the question. */
export type FeatureOverlap = {
  readonly leftCode: string;
  readonly rightCode: string;
  readonly both: number;
  readonly leftOnly: number;
  readonly rightOnly: number;
  readonly neither: number;
  /** `both / (both + leftOnly)` — the share of the left feature that the right one also covers. */
  readonly overlapShare: number;
  /** `both / (both + leftOnly + rightOnly)` — how much of either feature the other one explains. */
  readonly jaccard: number;
  readonly left: CellReading;
  readonly right: CellReading;
  /** Everything either feature covers, against everything neither does. */
  readonly either: CellReading;
  /** The right feature on the questions the left one does not cover. Zero here would end it. */
  readonly rightOutsideLeft: CellReading;
  /** The left feature on the questions the right one does not cover. */
  readonly leftOutsideRight: CellReading;
  readonly criterion: string;
  readonly criterionMet: boolean;
};

const SHARE_BAR = 0.5;

/**
 * One contingency table, three cells of it scored.
 *
 * `featureOf` is reused rather than reimplemented for the two marginal readings, so a feature
 * scored through this function and through the query diff cannot disagree about the same set.
 */
export function featureOverlapOf(
  leftCode: string,
  rightCode: string,
  cases: readonly DiffCase[],
  left: (delta: QueryDelta) => boolean,
  right: (delta: QueryDelta) => boolean,
  resamples = 10_000,
): FeatureOverlap {
  const both: DiffCase[] = [];
  const leftOnly: DiffCase[] = [];
  const rightOnly: DiffCase[] = [];
  const neither: DiffCase[] = [];
  for (const entry of cases) {
    const hasLeft = left(entry.delta);
    const hasRight = right(entry.delta);
    if (hasLeft && hasRight) both.push(entry);
    else if (hasLeft) leftOnly.push(entry);
    else if (hasRight) rightOnly.push(entry);
    else neither.push(entry);
  }
  const covered = both.length + leftOnly.length;
  const either = both.length + leftOnly.length + rightOnly.length;
  return {
    leftCode,
    rightCode,
    both: both.length,
    leftOnly: leftOnly.length,
    rightOnly: rightOnly.length,
    neither: neither.length,
    // Both denominators are non-zero whenever the caller has a left feature at all, and a caller
    // with none gets a share of 0 rather than a division by zero: the honest reading of "no question
    // carries the left feature" is that the overlap question does not arise, and 0 says that.
    overlapShare: covered === 0 ? 0 : both.length / covered,
    jaccard: either === 0 ? 0 : both.length / either,
    left: cellOf([...both, ...leftOnly], resamples),
    right: cellOf([...both, ...rightOnly], resamples),
    either: cellOf([...both, ...leftOnly, ...rightOnly], resamples),
    rightOutsideLeft: cellOf(rightOnly, resamples),
    leftOutsideRight: cellOf(leftOnly, resamples),
    criterion: `fewer than ${(SHARE_BAR * 100).toFixed(0)}% of the left feature's questions also carry the right (both / left)`,
    criterionMet: covered > 0 && both.length / covered < SHARE_BAR,
  };
}
