/**
 * Two stores over the same corrections, asked the same question.
 *
 * R12 and R13 measured one substrate: a distilled *sentence* about a correction. It reproduced its
 * own case 12–20% of the time and repaired 7.3% of the foreign questions that needed help while
 * breaking half of those that did not. The reading that followed was a claim about the substrate —
 * "a sentence about a correction loses the query pair that made the correction mechanical" — and a
 * claim like that is worth exactly nothing until it is put beside the alternative.
 *
 * The alternative already exists in this codebase: the `repair` distiller renders the pair (the
 * question, the attempt, the correction, and the observed failure) into a three-sentence account.
 * Running the same probe over a store built that way turns the claim into a measurement, and the
 * measurement is paired: both stores are asked about the *same* source questions, the control call
 * is shared between them, so the two sides differ in one thing.
 *
 * Pairing is not a convenience. Two independent rates would need roughly four times the sample to
 * resolve a difference of the size the question is about, and the corpus does not have four times
 * the sample. On the same questions the test is McNemar's exact test over discordant pairs, which
 * is the same instrument every arm comparison in this project already uses.
 *
 * What is *not* paired is coverage. The two stores do not hold a rule for exactly the same set of
 * corrections, and a comparison that silently intersected them would report a rate over a subset
 * chosen by the store rather than by the design — the same error the transfer statistic spent three
 * iterations recovering from. The exclusive questions are therefore counted and reported, and the
 * cells plus the holes have to reconcile against the shared set for any gate to read the result.
 */

import type { Interval } from '@agentix-e/microglia-core';
import { mcnemarExact } from '@agentix-e/microglia-core';

import type { ProbeTrial, ProbeVerdict } from './rule-probe.js';
import { comparePaired } from './stats.js';

/**
 * Whether the correction came back with this store in the prompt.
 *
 * `supplied` and `redundant` both mean it did: the difference between them is what the *retry*
 * would have done on its own, which is a property of the case rather than of the store. `broke`
 * and `useless` both mean it did not. A hole is neither, and stays a hole.
 *
 * A `Record` over the verdict union, so a verdict added later is a compile error here rather than
 * silently absent from the count — the failure mode that once let a whole content form vanish from
 * a store while the run reported nothing unusual.
 */
const REPRODUCED: Record<ProbeVerdict, boolean> = {
  supplied: true,
  redundant: true,
  broke: false,
  useless: false,
};

export function reproducedBy(verdict: ProbeVerdict | undefined): boolean | undefined {
  return verdict === undefined ? undefined : REPRODUCED[verdict];
}

/**
 * Paired source questions below this count make a difference a direction rather than a measurement.
 *
 * The same floor the transfer statistic uses, for the same reason: an exact test over eleven
 * discordant pairs cannot reject anything, and a report that called its sign a finding would be
 * reporting the sign of noise.
 */
export const SUBSTRATE_FLOOR = 100;

/** What a comparison of two stores supports. */
export type SubstrateVerdict =
  /** The stores share no source question, so there is nothing to pair. */
  | 'unpaired'
  /** Fewer paired questions than the floor: the sign is a direction, not a rate. */
  | 'floor'
  /** The discordant pairs do not separate the two stores. */
  | 'tie'
  /** The left-hand store reproduced more of its own corrections. */
  | 'left'
  /** The right-hand store reproduced more of its own corrections. */
  | 'right';

export type SubstrateComparison = {
  /** Labels, because the artefact is read without the code that produced it. */
  readonly left: string;
  readonly right: string;
  /** Source questions both stores held at least one rule for: the only set that can be paired. */
  readonly shared: number;
  /** Source questions only the left store covered, and only the right. Not in the cells. */
  readonly leftExclusive: number;
  readonly rightExclusive: number;
  /** Shared questions where either side's call never returned. Not cells either. */
  readonly holes: number;
  readonly both: number;
  readonly onlyLeft: number;
  readonly onlyRight: number;
  readonly neither: number;
  /** Questions that produced a cell: `both + onlyLeft + onlyRight + neither`. */
  readonly paired: number;
  readonly leftRate: number;
  readonly rightRate: number;
  readonly deltaPp: number;
  /** Two-sided exact McNemar over the discordant pairs. */
  readonly p: number;
  readonly deltaCI: Interval;
  readonly verdict: SubstrateVerdict;
};

export type CompareOptions = {
  readonly left: string;
  readonly right: string;
  /** Bootstrap seed, fixed so a re-read of the same trials gives the same interval. */
  readonly seed?: number;
  readonly resamples?: number;
  readonly floor?: number;
};

/**
 * Pair two probes on their shared source questions.
 *
 * The trials are one per source question — the lane builds its plans from a map keyed by the
 * question — so a repeated id would be a defect upstream rather than something to aggregate here.
 * Iteration order is the left store's, which is the corpus order of the fold; a bootstrap interval
 * depends on it, and a comparison whose interval moved with map insertion order would be a
 * comparison two runs could disagree about without measuring anything differently.
 */
export function compareSubstrates(
  leftTrials: readonly ProbeTrial[],
  rightTrials: readonly ProbeTrial[],
  options: CompareOptions,
): SubstrateComparison {
  const left = new Map(leftTrials.map((trial) => [trial.taskId, reproducedBy(trial.verdict)]));
  const right = new Map(rightTrials.map((trial) => [trial.taskId, reproducedBy(trial.verdict)]));
  const floor = options.floor ?? SUBSTRATE_FLOOR;

  let leftExclusive = 0;
  let rightExclusive = 0;
  const sharedIds: string[] = [];
  for (const id of left.keys()) {
    if (right.has(id)) sharedIds.push(id);
    else leftExclusive += 1;
  }
  for (const id of right.keys()) if (!left.has(id)) rightExclusive += 1;

  let holes = 0;
  let both = 0;
  let onlyLeft = 0;
  let onlyRight = 0;
  let neither = 0;
  const baseline: boolean[] = [];
  const treatment: boolean[] = [];
  for (const id of sharedIds) {
    const a = left.get(id);
    const b = right.get(id);
    if (a === undefined || b === undefined) {
      holes += 1;
      continue;
    }
    if (a && b) both += 1;
    else if (a) onlyLeft += 1;
    else if (b) onlyRight += 1;
    else neither += 1;
    baseline.push(a);
    treatment.push(b);
  }
  const paired = both + onlyLeft + onlyRight + neither;
  const leftRate = paired === 0 ? 0 : (both + onlyLeft) / paired;
  const rightRate = paired === 0 ? 0 : (both + onlyRight) / paired;
  const compared =
    paired === 0
      ? undefined
      : comparePaired(
          baseline,
          treatment,
          options.seed ?? 12345,
          options.resamples ?? 2000,
        );
  // A sweep is the strongest reading the test can give, so "no disagreement at all" is the tie
  // condition — not `min(onlyLeft, onlyRight) === 0`, which is the opposite case and was the first
  // version of this line.
  const agree = onlyLeft === 0 && onlyRight === 0;
  const significant = compared !== undefined && compared.p < 0.05;
  return {
    left: options.left,
    right: options.right,
    shared: sharedIds.length,
    leftExclusive,
    rightExclusive,
    holes,
    both,
    onlyLeft,
    onlyRight,
    neither,
    paired,
    leftRate,
    rightRate,
    deltaPp: (rightRate - leftRate) * 100,
    p: compared === undefined ? 1 : compared.p,
    deltaCI: compared === undefined ? { low: 0, high: 0, point: 0 } : compared.deltaCI,
    verdict:
      sharedIds.length === 0
        ? 'unpaired'
        : paired < floor
          ? 'floor'
          : !significant || agree
            ? 'tie'
            : onlyLeft > onlyRight
              ? 'left'
              : 'right',
  };
}

/** The counts a pooled comparison keeps, without the per-fold interval. */
export type PooledSubstrate = {
  /** Folds that contributed a comparison. */
  readonly folds: number;
  /** The label both stores were compared under, carried so the artefact reads without the lane. */
  readonly left: string;
  readonly right: string;
  readonly shared: number;
  readonly leftExclusive: number;
  readonly rightExclusive: number;
  readonly holes: number;
  readonly both: number;
  readonly onlyLeft: number;
  readonly onlyRight: number;
  readonly neither: number;
  readonly paired: number;
  readonly leftRate: number;
  readonly rightRate: number;
  readonly deltaPp: number;
  /**
   * The discordant pairs summed over folds and tested as one sign test.
   *
   * A summary, not a stratified test: it assumes the folds agree on the direction, which is why the
   * per-fold rows are reported beside it rather than replaced by it. Four folds pointing one way and
   * one pointing the other would give this a small p, and the table is what says so.
   */
  readonly p: number;
  readonly verdict: SubstrateVerdict;
};

/**
 * Add the folds' comparisons up.
 *
 * Folds are disjoint sets of questions and each is learned from the others, so their trials are
 * independent of one another and their counts add. The rates are recomputed from the summed cells
 * rather than averaged over folds: a fold with 30 paired questions and one with 300 do not carry the
 * same weight, and a mean of means would give them the same.
 */
export function poolSubstrates(comparisons: readonly SubstrateComparison[]): PooledSubstrate | null {
  if (comparisons.length === 0) return null;
  const first = comparisons[0] as SubstrateComparison;
  let shared = 0;
  let leftExclusive = 0;
  let rightExclusive = 0;
  let holes = 0;
  let both = 0;
  let onlyLeft = 0;
  let onlyRight = 0;
  let neither = 0;
  for (const compared of comparisons) {
    shared += compared.shared;
    leftExclusive += compared.leftExclusive;
    rightExclusive += compared.rightExclusive;
    holes += compared.holes;
    both += compared.both;
    onlyLeft += compared.onlyLeft;
    onlyRight += compared.onlyRight;
    neither += compared.neither;
  }
  const paired = both + onlyLeft + onlyRight + neither;
  const leftRate = paired === 0 ? 0 : (both + onlyLeft) / paired;
  const rightRate = paired === 0 ? 0 : (both + onlyRight) / paired;
  const p = mcnemarExact(onlyLeft, onlyRight);
  return {
    folds: comparisons.length,
    left: first.left,
    right: first.right,
    shared,
    leftExclusive,
    rightExclusive,
    holes,
    both,
    onlyLeft,
    onlyRight,
    neither,
    paired,
    leftRate,
    rightRate,
    deltaPp: (rightRate - leftRate) * 100,
    p,
    verdict:
      paired < SUBSTRATE_FLOOR
        ? 'floor'
        : onlyLeft === 0 && onlyRight === 0
          ? 'tie'
          : p >= 0.05
            ? 'tie'
            : onlyLeft > onlyRight
              ? 'left'
              : 'right',
  };
}
