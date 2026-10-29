/**
 * The candidate pool, described before anything is done with it.
 *
 * Eleven iterations of this project measured selectors and eleven came back at or below zero. Every
 * one of those runs reported the ceiling beside the selector, and the ceiling was read each time as
 * "so the selector is bad". It is also a statement about the pool, and the pool was never described:
 * five draws from one prompt may be five different answers, or one answer with five spellings, and a
 * selector has nothing to do in the second case no matter how good it is.
 *
 * The competitive reading makes the size of that question concrete. CHASE-SQL's candidate pool — 21
 * candidates from three different generation procedures — carries +13.95pp of headroom over one
 * draw, and its selection agent captures 29.9% of it. Ours carries +3.52pp over five draws from a
 * single prompt, and our selectors capture a negative share. A selector cannot capture headroom the
 * generator never produced, so the first thing to measure is how much headroom was produced.
 *
 * Two quantities answer it, and neither was in any artefact before this module:
 *
 *  - **collapse** — how many *distinct execution results* the draws produced. Two queries that
 *    execute to the same rows are one candidate to a selector, whatever else differs.
 *  - **decomposition of the ceiling** — of the questions where some draw was right, how many had
 *    the first draw right (no choice was needed) and how many had exactly one draw right (the
 *    choice is the whole value).
 *
 * The third thing this module does is price each execution signal on its own, at candidate level.
 * `exec-signature.ts` computes six of them and refuses to combine them; this module measures each
 * one's ability to order a pool, so a composite is built only out of signals that already separate
 * answers from non-answers. The measurement costs no model calls — it is a function of a pool that
 * a sampling run already produced — which is why it can be run before anything is allowed to act.
 *
 * Statistics, fixed here rather than negotiated later:
 *
 *  - **AUC is candidate-level, the interval is question-clustered.** Candidates inside one question
 *    are not independent draws: they share the question, the schema and usually the misreading. A
 *    flat bootstrap over candidates would report an interval roughly 5x too narrow on this design
 *    (five candidates per question), which is exactly the error that makes a signal look real.
 *  - **Ties are half-credit.** An abstaining signal must read 0.5, not 0. Counting abstentions as
 *    failures would rank a silent signal above a wrong one.
 *  - **The baseline is `draw-order`.** Every signal is read beside "take the first draw", because
 *    the only claim a selector can make is that it beats not choosing.
 */

import { mulberry32 } from '@agentix-e/microglia-core';
import {
  FAILED_SIGNATURE,
  SIGNALS,
  scoreOf,
  type ExecSignature,
  type QuestionShape,
  type SignalName,
} from './exec-signature.js';

/**
 * One candidate as the pool recorded it.
 *
 * `signature` is `null` only when the draw produced no query at all, which is a different failure
 * from a query that did not run: a refused question and a broken question need different fixes, and
 * merging them into one "failed" bucket would hide how often the model simply did not answer.
 */
export type PoolCandidate = {
  readonly draw: number;
  readonly correct: boolean;
  /** Index of the distinct result this candidate produced within its question, or -1 for none. */
  readonly resultKey: number;
  readonly signature: ExecSignature | null;
};

export type PoolQuestion = {
  readonly id: string;
  readonly shape: QuestionShape;
  readonly candidates: readonly PoolCandidate[];
};

export type PoolSummary = {
  readonly questions: number;
  readonly candidates: number;
  readonly signed: number;
  /** Candidates with no query at all. */
  readonly unsigned: number;
  /** Share of candidates that carry a shape; zero when nothing was recorded. */
  readonly signatureShare: number;
  /** Mean number of distinct execution results per question. */
  readonly distinctMean: number;
  readonly distinctMedian: number;
  /** Questions per distinct-result count: the collapse distribution. */
  readonly distinctHistogram: Record<string, number>;
  /** Questions where at least one candidate was correct. */
  readonly oracle: number;
  /** Questions where the first draw was correct. */
  readonly first: number;
  /** Questions the ceiling is worth: oracle right, first draw wrong. */
  readonly ceilingOnly: number;
  /** Questions with at least two correct candidates, where the ceiling needs no diversity. */
  readonly sharedCorrect: number;
  /** Questions with exactly one correct candidate. */
  readonly uniqueCorrect: number;
  readonly noneRight: number;
};

/** How many times the question set is resampled for one interval. */
const RESAMPLES = 2_000;

/**
 * Distinct execution results a question produced, counted from the result keys.
 *
 * A candidate that produced nothing contributes nothing here, deliberately. This is the collapse
 * statistic — "how many different answers did five draws contain" — and a draw that errored is not
 * an answer. Folding failures in would let a pool of one answer and four errors report a collapse of
 * two, which is the opposite of what the number is for.
 */
function distinctOf(question: PoolQuestion): number {
  const seen = new Set<number>();
  for (const candidate of question.candidates) {
    if (candidate.resultKey >= 0) seen.add(candidate.resultKey);
  }
  return seen.size;
}

/**
 * Distinct outcomes a question produced, where "did not run" is an outcome.
 *
 * Eligibility for a selection reading is a different question from collapse. A question where one
 * draw returned rows and another returned nothing is a question with a choice in it — every signal
 * agrees on which to keep, and that agreement is worth measuring — even though it collapsed to a
 * single *answer*.
 */
export function outcomesOf(question: PoolQuestion): number {
  const seen = new Set<number>();
  let failed = false;
  for (const candidate of question.candidates) {
    if (candidate.resultKey >= 0) seen.add(candidate.resultKey);
    else failed = true;
  }
  return seen.size + (failed ? 1 : 0);
}

function firstCandidate(question: PoolQuestion): PoolCandidate | undefined {
  return question.candidates.reduce<PoolCandidate | undefined>(
    (earliest, candidate) => (earliest === undefined || candidate.draw < earliest.draw ? candidate : earliest),
    undefined,
  );
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] as number;
  return ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

/**
 * Counts over the pool, with every total defined so an empty pool has no NaN.
 *
 * `uniqueCorrect + sharedCorrect + noneRight === questions` reconciles, and it is the decomposition
 * that matters: a ceiling made of questions where four of five draws were right is a ceiling of
 * agreement, which the `majority` selector already reads for free.
 */
export function poolSummary(questions: readonly PoolQuestion[]): PoolSummary {
  const counts = questions.map((question) => distinctOf(question));
  const histogram: Record<string, number> = {};
  for (const count of counts) {
    const key = String(count);
    histogram[key] = (histogram[key] ?? 0) + 1;
  }
  let candidates = 0;
  let signed = 0;
  let unsigned = 0;
  let oracle = 0;
  let first = 0;
  let ceilingOnly = 0;
  let sharedCorrect = 0;
  let uniqueCorrect = 0;
  let noneRight = 0;
  for (const question of questions) {
    candidates += question.candidates.length;
    for (const candidate of question.candidates) {
      if (candidate.signature === null) unsigned += 1;
      else signed += 1;
    }
    const right = question.candidates.filter((candidate) => candidate.correct).length;
    const firstRight = firstCandidate(question)?.correct === true;
    if (right > 0) oracle += 1;
    else noneRight += 1;
    if (firstRight) first += 1;
    if (right > 0 && !firstRight) ceilingOnly += 1;
    if (right >= 2) sharedCorrect += 1;
    if (right === 1) uniqueCorrect += 1;
  }
  return {
    questions: questions.length,
    candidates,
    signed,
    unsigned,
    signatureShare: candidates === 0 ? 0 : signed / candidates,
    distinctMean: counts.length === 0 ? 0 : counts.reduce((sum, count) => sum + count, 0) / counts.length,
    distinctMedian: median(counts),
    distinctHistogram: histogram,
    oracle,
    first,
    ceilingOnly,
    sharedCorrect,
    uniqueCorrect,
    noneRight,
  };
}

export type SignalChoice = SignalName | 'draw-order';

export type PoolSignalReading = {
  readonly signal: SignalChoice;
  /** Questions where at least two distinct results were produced, so a choice existed. */
  readonly eligible: number;
  /** Of those, the ones where the candidate this signal ranks first is correct. */
  readonly topPick: number;
  readonly accuracy: number;
  /** Candidate-level AUC against correctness, over every question in the pool. */
  readonly auc: number;
  readonly aucLow: number;
  readonly aucHigh: number;
  /**
   * Standard deviation of the resampled AUCs, which is the standard error the gate reads.
   *
   * Reported rather than held privately because the interval and the gate are not the same rule:
   * the interval is a percentile pair, the gate is `AUC − 0.5 > 2 SE`, and a reader who cannot see
   * the SE cannot check the second one.
   */
  readonly aucSe: number;
  /** Correct candidates the AUC was computed over, and incorrect ones. */
  readonly positive: number;
  readonly negative: number;
  /** Correct/incorrect candidate pairs the AUC was computed from. */
  readonly pairs: number;
};

/**
 * Mann-Whitney AUC over two score lists, with ties counted as half.
 *
 * Implemented by rank rather than by pair enumeration because a question with 21 candidates has 441
 * pairs and the resampling loop would do that two thousand times per signal; the midrank formula is
 * one pass and gives the same number.
 *
 * Both lists are required to be non-empty. The one caller checks, and a guard here would be a branch
 * no test could take — the pool is mostly questions where every candidate is right or none is, and
 * skipping those is `aucWithin`'s job rather than this function's.
 */
function aucOf(positive: readonly number[], negative: readonly number[]): number {
  type Entry = { readonly score: number; readonly positive: boolean };
  const merged: Entry[] = [
    ...positive.map((score): Entry => ({ score, positive: true })),
    ...negative.map((score): Entry => ({ score, positive: false })),
  ].sort((a, b) => a.score - b.score);
  let rankSum = 0;
  let index = 0;
  while (index < merged.length) {
    const first = merged[index] as Entry;
    let end = index;
    while (end + 1 < merged.length && (merged[end + 1] as Entry).score === first.score) {
      end += 1;
    }
    // Midrank for a tied block: every member gets the average of the ranks it spans, which is what
    // makes a signal that abstains everywhere come out at exactly one half rather than at zero.
    const average = (index + end + 2) / 2;
    for (let at = index; at <= end; at += 1) {
      if ((merged[at] as Entry).positive) rankSum += average;
    }
    index = end + 1;
  }
  const n1 = positive.length;
  const n2 = negative.length;
  return (rankSum - (n1 * (n1 + 1)) / 2) / (n1 * n2);
}

/**
 * The AUC over the pairs a selector is actually asked to order: the ones inside a question.
 *
 * Ranking a correct candidate from one question against an incorrect one from another is not a
 * decision any selector in this project makes, and pooling the two lists anyway does not merely add
 * noise — it adds a large block of near-ties, because two candidates scored by the same signal on
 * different questions usually score the same, and every one of those ties counts as half. The pooled
 * figure is therefore pulled toward 0.5 by an amount that depends on how many questions each list
 * happens to contain, which is the definition of a quantity that cannot be compared across pools.
 *
 * It also disagreed with the record: `pairs` was already the within-question count, so the artefact
 * carried a denominator its own numerator never used. `pairs` and this function now count the same
 * things, and a signal's reading means "of the orderings this selector is asked to make, this share
 * came out right".
 */
function aucWithin(
  positive: readonly (readonly number[])[],
  negative: readonly (readonly number[])[],
): number {
  let wins = 0;
  let pairs = 0;
  for (let at = 0; at < positive.length; at += 1) {
    const up = positive[at] as number[];
    const down = negative[at] as number[];
    const here = up.length * down.length;
    // A question where every candidate is right, or none is, offers no ordering to rank and no
    // pairs to count. It is the common case: 141 of 350 questions had no correct draw at all.
    if (here === 0) continue;
    // Per question, by rank: the midrank formula is exact for the same reason it is above, and the
    // grouped call keeps every comparison inside one question's candidate list.
    wins += aucOf(up, down) * here;
    pairs += here;
  }
  return pairs === 0 ? 0.5 : wins / pairs;
}

function scoreFor(candidate: PoolCandidate, shape: QuestionShape, signal: SignalChoice): number {
  if (signal === 'draw-order') return -candidate.draw;
  return scoreOf(candidate.signature ?? FAILED_SIGNATURE, shape, signal);
}

function pickOf(question: PoolQuestion, signal: SignalChoice): PoolCandidate | undefined {
  let best: PoolCandidate | undefined;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const candidate of question.candidates) {
    const score = scoreFor(candidate, question.shape, signal);
    // Strictly greater, so a tie keeps the earlier draw. A signal with no opinion must not reorder
    // the pool: if ties went to the last candidate, every inert signal would be measuring "take the
    // last draw" and reporting it as its own accuracy.
    if (best === undefined || score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

/**
 * One signal's reading, with an interval that resamples questions rather than candidates.
 *
 * The clustering is the point. Five candidates from one question share the question, the schema and
 * usually the misreading, so treating them as five independent observations understates the
 * interval by roughly the square root of the pool size. A signal whose AUC clears 0.5 by two flat
 * standard errors frequently does not clear it once the cluster is respected, and this module
 * exists to make that distinction visible before a signal is allowed to rank anything.
 */
export function signalReading(
  questions: readonly PoolQuestion[],
  signal: SignalChoice,
  options: { readonly resamples?: number; readonly seed?: number } = {},
): PoolSignalReading {
  const eligible = questions.filter((question) => outcomesOf(question) >= 2);
  const topPick = eligible.filter((question) => pickOf(question, signal)?.correct === true).length;
  const positive: number[][] = [];
  const negative: number[][] = [];
  let pairs = 0;
  for (const question of questions) {
    const up: number[] = [];
    const down: number[] = [];
    for (const candidate of question.candidates) {
      const score = scoreFor(candidate, question.shape, signal);
      if (candidate.correct) up.push(score);
      else down.push(score);
    }
    positive.push(up);
    negative.push(down);
    pairs += up.length * down.length;
  }
  const point = aucWithin(positive, negative);
  const resamples = options.resamples ?? RESAMPLES;
  const random = mulberry32(options.seed ?? 7);
  const drawn: number[] = [];
  if (questions.length > 1) {
    for (let round = 0; round < resamples; round += 1) {
      // The resampled questions keep their candidate lists: a cluster bootstrap resamples clusters,
      // and flattening them would put the cross-question pairs back in through the interval even
      // after the point estimate stopped using them.
      const ups: number[][] = [];
      const downs: number[][] = [];
      for (let at = 0; at < questions.length; at += 1) {
        const which = Math.floor(random() * questions.length);
        ups.push(positive[which] as number[]);
        downs.push(negative[which] as number[]);
      }
      drawn.push(aucWithin(ups, downs));
    }
  }
  drawn.sort((a, b) => a - b);
  const low = drawn.length === 0 ? point : (drawn[Math.floor(0.025 * (drawn.length - 1))] as number);
  const high = drawn.length === 0 ? point : (drawn[Math.ceil(0.975 * (drawn.length - 1))] as number);
  // The gate in R7.2a is stated in standard errors, not in percentiles, so the standard error is a
  // reported number rather than something a reader has to reconstruct from a symmetric-looking
  // interval. It is the population deviation of the resampled AUCs; when the resampling never ran
  // (one question, or one side empty) it is zero and the gate applies its own floor.
  const aucSe = deviationOf(drawn);
  return {
    signal,
    eligible: eligible.length,
    topPick,
    accuracy: eligible.length === 0 ? 0 : topPick / eligible.length,
    auc: point,
    aucLow: low,
    aucHigh: high,
    aucSe,
    positive: positive.reduce((sum, group) => sum + group.length, 0),
    negative: negative.reduce((sum, group) => sum + group.length, 0),
    pairs,
  };
}

/** Population standard deviation of the resampled values, zero when there are none. */
function deviationOf(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const squared = values.reduce((sum, value) => sum + (value - mean) ** 2, 0);
  return Math.sqrt(squared / values.length);
}

/** Every signal beside the baseline, in a fixed order so a table cannot quietly omit one. */
export function signalReadings(
  questions: readonly PoolQuestion[],
  options: { readonly resamples?: number; readonly seed?: number } = {},
): readonly PoolSignalReading[] {
  return [
    signalReading(questions, 'draw-order', options),
    ...SIGNALS.map((signal) => signalReading(questions, signal, options)),
  ];
}
