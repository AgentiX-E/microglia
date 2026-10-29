/**
 * Whether any execution signal is allowed to rank anything, and what happens if none is.
 *
 * `exec-signature.ts` computes six signals and refuses to combine them. `pool.ts` prices each one
 * alone. This module is the gate between those two facts and a composite: a signal enters only if
 * its own evidence clears a bar that was fixed before the measurement was taken, and the composite
 * is scored on the recorded pool before it is allowed to touch a live dispatch.
 *
 * The bar is `AUC - 0.5 > 2 SE`, Holm-corrected across the six. Three things about that choice:
 *
 *  - **Two standard errors is a floor, not a finding.** Six signals at two standard errors produce
 *    one false positive at twenty percent under the null, so the correction is not optional and the
 *    uncorrected reading is not reported as if it were the test.
 *  - **The standard error is question-clustered, and floored.** `pool.ts` resamples questions, so a
 *    pool where every candidate pair is concordant returns a variance of exactly zero — five
 *    candidates from one question are not five independent observations. The floor is the standard
 *    error a perfect coin would have at the size of the smaller group, which is the largest the AUC
 *    of that many pairs could have. Without it, twelve unanimous candidates would report an infinite
 *    z and the gate would pass a signal measured on nothing.
 *  - **An inverted signal is dropped, not flipped.** AUC below one half means the direction this
 *    project assumed is wrong on this model. Inverting it here would fit the direction to the same
 *    pool the direction is being tested on, which is the mistake every previous composite made with
 *    its weights.
 *
 * The composite itself is one vote per surviving signal, not a weighted sum. The magnitudes in
 * `scoreOf` are placeholders - they encode "this objection is stronger than that one", not a
 * probability - so adding them would be adding incomparable units and calling the total a score.
 * A vote is the only arithmetic those numbers support, and ties fall back to the earlier draw so
 * that a composite of abstaining signals reproduces the baseline instead of quietly inventing a
 * different selector.
 */

import { FAILED_SIGNATURE, scoreOf, type QuestionShape, type SignalName } from './exec-signature.js';
import type { Selection } from './selector.js';
import {
  outcomesOf,
  signalReadings,
  type PoolCandidate,
  type PoolQuestion,
  type PoolSignalReading,
} from './pool.js';

/** Family-wise error rate the correction is run at. */
export const ALPHA = 0.05;

/** Standard errors the point estimate has to clear before the correction is even consulted. */
export const Z_BAR = 2;

export type SignalVerdict = {
  readonly signal: SignalName;
  readonly auc: number;
  /** The standard error actually used: the bootstrap's, or the floor when that one collapsed. */
  readonly se: number;
  /** `(auc - 0.5) / se`, zero when there is no standard error to divide by. */
  readonly z: number;
  /** One-sided normal tail above `z`, so a signal pointing the wrong way scores above one half. */
  readonly p: number;
  /** Holm-adjusted p across the tests in this family. */
  readonly holm: number;
  readonly survives: boolean;
};

export type CompositeVerdict = 'usable' | 'inert';

export type CompositeReading = {
  readonly verdicts: readonly SignalVerdict[];
  /** Signals allowed into the composite, in the pool's signal order. */
  readonly kept: readonly SignalName[];
  /** Signals named and removed, so the artefact records what was tried and dropped. */
  readonly inert: readonly SignalName[];
  /** Questions with more than one outcome, where a choice existed at all. */
  readonly eligible: number;
  readonly compositeTopPick: number;
  readonly compositeAccuracy: number;
  readonly baselineTopPick: number;
  readonly baselineAccuracy: number;
  /** Percentage points the composite gains over taking the first draw. */
  readonly deltaPp: number;
  /** Questions the composite fixes that the first draw got wrong, and the reverse. */
  readonly gained: number;
  readonly lost: number;
  readonly verdict: CompositeVerdict;
};

/**
 * Upper tail of the standard normal, by Abramowitz and Stegun 26.2.17.
 *
 * Absolute error below 1.5e-7, which is three orders of magnitude finer than any p-value this module
 * reports and avoids pulling a statistics package into a measurement that has to run inside CI.
 */
export function normalUpper(z: number): number {
  if (Number.isNaN(z)) return 1;
  // Strictly negative, so zero is answered by the series rather than by its own mirror image.
  if (z < 0) return 1 - normalUpper(-z);
  if (!Number.isFinite(z)) return 0;
  const t = 1 / (1 + 0.2316419 * z);
  const series =
    t *
    (0.31938153 +
      t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return (Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI)) * series;
}

/**
 * Holm's step-down adjustment.
 *
 * Chosen over Benjamini-Hochberg because the claim being made is "this signal ranks candidates",
 * and acting on one false signal puts a verifier into a paid run. Holm controls the probability of
 * any false inclusion at `alpha`, which is the error the decision can actually incur.
 */
export function holmAdjust(pvalues: readonly number[]): readonly number[] {
  const order = pvalues
    .map((p, at) => ({ p, at }))
    .sort((left, right) => left.p - right.p);
  const adjusted: number[] = new Array<number>(pvalues.length).fill(1);
  const tests = order.length;
  let running = 0;
  for (let rank = 0; rank < tests; rank += 1) {
    const entry = order[rank] as { readonly p: number; readonly at: number };
    // Monotone by construction: a larger raw p can never end up with a smaller adjusted one, and
    // that ordering is what makes "survives" a set rather than a coin flip between neighbours.
    running = Math.max(running, Math.min(1, entry.p * (tests - rank)));
    adjusted[entry.at] = running;
  }
  return adjusted;
}

/**
 * The standard error the gate divides by.
 *
 * The floor is `sqrt(0.25 / min(positive, negative))`: the variance of a proportion at its maximum,
 * over the size of the smaller group. A degenerate bootstrap reports zero, and zero is not evidence
 * of certainty — it is evidence that the resampling could not see inside a question.
 */
export function seOf(reading: PoolSignalReading): number {
  const smaller = Math.min(reading.positive, reading.negative);
  if (smaller === 0) return 0;
  return Math.max(reading.aucSe, Math.sqrt(0.25 / smaller));
}

/**
 * Every signal's verdict, with the baseline removed.
 *
 * `draw-order` is filtered because it is the thing the others are measured against: including it in
 * the family would let "take the first draw" be corrected against, and there is no hypothesis in it.
 */
export function gateOf(readings: readonly PoolSignalReading[]): readonly SignalVerdict[] {
  const measured = readings.filter(
    (reading): reading is PoolSignalReading & { signal: SignalName } =>
      reading.signal !== 'draw-order',
  );
  // Standardised once, then corrected. Computing z twice — once for the p-value and once for the
  // verdict — is how the two get to disagree after somebody edits one of them.
  const standardised = measured.map((reading) => {
    const se = seOf(reading);
    // No standard error means nothing on one side of the comparison; a z of zero says "no evidence"
    // rather than dividing by it and reporting an infinity.
    const z = se === 0 ? 0 : (reading.auc - 0.5) / se;
    return { reading, se, z, p: normalUpper(z) };
  });
  const adjusted = holmAdjust(standardised.map((entry) => entry.p));
  return standardised.map((entry, at) => ({
    signal: entry.reading.signal,
    auc: entry.reading.auc,
    se: entry.se,
    z: entry.z,
    p: entry.p,
    holm: adjusted[at] as number,
    // Strictly above both bars. A z of exactly two is the boundary the bar was written on, and
    // rounding it in would be reading the criterion as "at least" after seeing the number.
    survives: entry.z > Z_BAR && (adjusted[at] as number) < ALPHA,
  }));
}

/**
 * The candidate each surviving signal set votes for, per question.
 *
 * This function does not read `correct`. The five votes of a candidate are the signs of its scores,
 * the sum breaks no ties because a tie is decided by draw order, so the pick is a function of
 * signatures and the question's shape alone. `signal-gate.test.ts` proves it by making the label
 * unreadable and asserting the picks come out unchanged.
 */
export function compositePicks(
  questions: readonly PoolQuestion[],
  signals: readonly SignalName[],
): readonly (number | undefined)[] {
  return questions.map((question) => {
    const best = bestIndex(question, signals);
    return best === undefined ? undefined : (question.candidates[best] as PoolCandidate).draw;
  });
}

/**
 * The index of the candidate the signals prefer, with ties going to the earliest draw.
 *
 * One implementation, because two would be two definitions of "the composite" and the arm scored in
 * a run has to be the same object that was priced in the simulation. `compositePicks` reports the
 * answer and `selectByShape` reports the decision that produced it; neither owns the rule.
 *
 * `undefined` only for a question with no candidates, which the gate's population excludes but a
 * caller can still construct.
 */
function bestIndex(question: PoolQuestion, signals: readonly SignalName[]): number | undefined {
  let best: number | undefined;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const [index, candidate] of question.candidates.entries()) {
    const score = votesOf(candidate, question.shape, signals);
    // Strictly greater, so an abstaining composite keeps the earlier draw and reproduces the
    // baseline exactly. Ties going the other way would make the delta a measurement of the
    // tie-break rather than of the signals.
    if (score > bestScore) {
      best = index;
      bestScore = score;
    }
  }
  return best;
}

/**
 * How much a candidate has going for it, as a sum of the signals' opinions.
 *
 * The scale is a count of objections, not of endorsements: `scoreOf` never returns a positive number
 * because no signal in this module is allowed to prefer a shape, only to reject one. Every number
 * this function returns is therefore ≤ 0, and "the best candidate" is the one with the fewest
 * objections. That asymmetry is deliberate and it is where the composite's ceiling comes from — it
 * can refuse a wrong answer it can recognise, and it cannot find a right one it cannot.
 */
function votesOf(
  candidate: PoolCandidate,
  shape: QuestionShape,
  signals: readonly SignalName[],
): number {
  const signature = candidate.signature ?? FAILED_SIGNATURE;
  let votes = 0;
  for (const signal of signals) votes += Math.sign(scoreOf(signature, shape, signal));
  return votes;
}

/**
 * The composite, measured on the recorded pool before anything is activated.
 *
 * Both accuracies are taken over the same population — the questions where a choice existed — because
 * a composite measured on the questions it can reorder against a baseline measured on all of them is
 * not a comparison. `gained` and `lost` are reported beside the delta for the same reason the
 * transfer measurement reports its 2x2 table: a net of zero made of one fix and one break is a
 * different object from a net of zero made of none of either.
 */
export function readComposite(
  questions: readonly PoolQuestion[],
  readings: readonly PoolSignalReading[],
): CompositeReading {
  const verdicts = gateOf(readings);
  const kept = verdicts.filter((verdict) => verdict.survives).map((verdict) => verdict.signal);
  const inert = verdicts.filter((verdict) => !verdict.survives).map((verdict) => verdict.signal);
  const eligible = questions.filter((question) => outcomesOf(question) >= 2);
  // The baseline is the same function with no signals: every candidate scores zero, the tie-break
  // hands back the earliest draw, and "the composite with nothing in it" is the control by
  // construction rather than by a second implementation of the same rule.
  const compositePicked = compositePicks(eligible, kept);
  const baselinePicked = compositePicks(eligible, []);
  let compositeTopPick = 0;
  let baselineTopPick = 0;
  let gained = 0;
  let lost = 0;
  for (let at = 0; at < eligible.length; at += 1) {
    const question = eligible[at] as PoolQuestion;
    const compositeRight = isRight(question, compositePicked[at]);
    const baselineRight = isRight(question, baselinePicked[at]);
    if (compositeRight) compositeTopPick += 1;
    if (baselineRight) baselineTopPick += 1;
    if (compositeRight && !baselineRight) gained += 1;
    if (!compositeRight && baselineRight) lost += 1;
  }
  const compositeAccuracy = eligible.length === 0 ? 0 : compositeTopPick / eligible.length;
  const baselineAccuracy = eligible.length === 0 ? 0 : baselineTopPick / eligible.length;
  return {
    verdicts,
    kept,
    inert,
    eligible: eligible.length,
    compositeTopPick,
    compositeAccuracy,
    baselineTopPick,
    baselineAccuracy,
    deltaPp: (compositeAccuracy - baselineAccuracy) * 100,
    gained,
    lost,
    verdict: kept.length === 0 ? 'inert' : 'usable',
  };
}

/**
 * Whether the candidate at this draw was correct.
 *
 * A draw of `undefined` cannot happen for a question that offered a choice — the gate only reads
 * questions with two outcomes, and those have candidates — so the comparison is written to answer
 * false on it rather than to branch on a case the population excludes.
 */
function isRight(question: PoolQuestion, draw: number | undefined): boolean {
  return question.candidates.some((candidate) => candidate.draw === draw && candidate.correct);
}

/** The gate applied to a pool, which is how the artefact reads it: no calls, one function. */
export function compositeGate(
  questions: readonly PoolQuestion[],
  options: { readonly resamples?: number; readonly seed?: number } = {},
): CompositeReading {
  return readComposite(questions, signalReadings(questions, options));
}

/**
 * The signals a public pick is allowed to vote with.
 *
 * Fixed here, and fixed *after* the gate that licensed them, which is the only order that keeps the
 * arm honest: the set comes from run `40862283263`, where five of six signals cleared
 * `AUC - 0.5 > 2 SE` after Holm and `null-share` did not (z = 1.23). A selector that re-derived its
 * feature set inside each fold would be choosing its features on the data it is then scored on, and
 * the delta would be a measurement of the fit.
 *
 * The order is the order the readings were taken in, so a log line reads the same way twice.
 */
export const SHAPE_VOTERS: readonly SignalName[] = [
  'empty',
  'row-shape',
  'column-shape',
  'duplicate-share',
  'value-type',
];

/**
 * The shape composite as a strategy: pick the candidate the licensed signals object to least.
 *
 * This is what R7.2a measured as a simulation, made executable so it can be scored as an arm inside a
 * cross-fitted run — with the same multiset judge as every other arm, on the same draws, against
 * `sample-5-first` as the honest baseline rather than against `none`. The choice itself is delegated
 * to the same `bestIndex` that `compositePicks` uses, so the arm a run scores cannot drift from the
 * object the simulation priced.
 *
 * `votes` is the number of candidates the winner outscored, not the size of a group, because this
 * selector has no group: two candidates can be scored apart and still return the same rows. It reads
 * as "how many alternatives were overruled", and it is zero exactly when the composite had nothing to
 * say — which is also exactly when `reason` is `'no-agreement'` and the answer is the baseline's.
 *
 * A consequence worth stating rather than hiding: because no signal returns a positive score, a
 * question that asks for what is *absent* only stops the composite objecting to an empty result. It
 * cannot prefer one. `selectByShape` therefore falls back to the first draw when the field is level,
 * and the omission is a candidate for the next signal rather than a gap to paper over here.
 */
export function selectByShape(question: PoolQuestion): Selection {
  const groups = new Set(
    question.candidates
      .filter((candidate) => candidate.resultKey >= 0)
      .map((candidate) => candidate.resultKey),
  ).size;
  const chosen = bestIndex(question, SHAPE_VOTERS);
  if (chosen === undefined) {
    return { chosen: 0, votes: 0, groups: 0, reason: 'empty', emptyResult: false };
  }
  const winner = question.candidates[chosen] as PoolCandidate;
  const winnerScore = votesOf(winner, question.shape, SHAPE_VOTERS);
  const overruled = question.candidates.filter(
    (candidate) => votesOf(candidate, question.shape, SHAPE_VOTERS) < winnerScore,
  ).length;
  return {
    chosen,
    votes: overruled,
    groups,
    // Nothing ran is not a preference for the first failure, and `selectionStats` counts it apart.
    reason:
      groups === 0 ? 'nothing-ran' : overruled > 0 ? 'shape' : 'no-agreement',
    emptyResult: winner.signature !== null && winner.signature.empty,
  };
}
