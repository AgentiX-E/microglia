/**
 * What the pool says about the next step, decided before the next step is built.
 *
 * R7.0 records the candidates; this turns them into the two answers that order the rest of the stage
 * and, just as importantly, into the *refusal* to answer when neither is supported.
 *
 * The first answer is whether the pool has anything in it. A selector chooses among candidates, and a
 * pool that collapses five draws into one execution result offers no choice at all: the headroom is
 * zero and every selection arm measured against such a pool is measuring its own noise. The bar is
 * the one pre-registered in `ROADMAP.md` R7.1 — a median of three distinct results from six draws is
 * diverse, two from six is collapsed — expressed as a share of the draws taken so the same rule
 * applies to a three-draw run.
 *
 * The second answer is which execution signals are allowed to rank anything. `exec-signature.ts`
 * computes six and refuses to combine them, and this module keeps that refusal: a signal is
 * shortlisted only when its question-clustered **lower bound** clears one half. A point estimate of
 * 0.56 with an interval of [0.47, 0.65] is a coin flip with a decimal point, and eleven iterations of
 * this project have shipped composites whose parts could not be evaluated alone.
 *
 * The third thing this module does is refuse. Between the two bars the verdict is `between`, which
 * is not a softened `narrow` — it is the statement that the measurement does not decide the question,
 * and that the next dispatch is R7.1 rather than a selector.
 */

import type { PoolQuestion } from './pool.js';
import { poolSummary, signalReadings, type PoolSignalReading, type PoolSummary } from './pool.js';

/** A median this share of the draws or more is a pool with a choice in it. */
export const WIDE_SHARE = 0.5;

/** A median at or below this share of the draws is one answer with several spellings. */
export const NARROW_SHARE = 1 / 3;

export type PoolVerdict = 'wide' | 'narrow' | 'between';

/**
 * The verdict for a collapse share, where one definition serves both pools.
 *
 * The incumbent pool is five draws from one prompt and the generator pool is three procedures; the
 * bar is a share of whatever produced the candidates, so the same rule reads both. Two copies of
 * these two numbers would let one pool be called wide and the other narrow on identical evidence.
 */
export function verdictOf(share: number): PoolVerdict {
  return share >= WIDE_SHARE ? 'wide' : share <= NARROW_SHARE ? 'narrow' : 'between';
}

export type PoolReportQuestion = PoolQuestion;

export type PoolReport = {
  readonly summary: PoolSummary;
  readonly signals: readonly PoolSignalReading[];
  /** Whether the pool can support a selection claim at all. */
  readonly verdict: PoolVerdict;
  /** Distinct results per draw, which is what the verdict is read from. */
  readonly distinctShare: number;
  /**
   * Percentage points a perfect selector could have earned over taking the first draw.
   *
   * Reported beside the verdict because the two together separate the two failure modes: a low
   * `ceilingPp` means the draws never produced a right answer, and a high one alongside a `narrow`
   * verdict means they produced several and they are all the same.
   */
  readonly ceilingPp: number;
  /** Signals whose interval excludes one half, in the order they were read. */
  readonly shortlist: readonly string[];
};

/**
 * The report over a recorded pool.
 *
 * `draws` is passed rather than read from the candidates because a question that produced no query at
 * all has no candidate to count, and inferring the run's sample size from the survivors would make a
 * run with dropped calls look like a deliberate three-draw design.
 */
export function poolReport(
  questions: readonly PoolReportQuestion[],
  draws: number,
  options: { readonly resamples?: number; readonly seed?: number } = {},
): PoolReport {
  const summary = poolSummary(questions);
  const signals = signalReadings(questions, options);
  const denominator = draws > 0 ? draws : 1;
  const distinctShare = summary.distinctMedian / denominator;
  const verdict = verdictOf(distinctShare);
  const ceilingPp =
    summary.questions === 0 ? 0 : (summary.ceilingOnly / summary.questions) * 100;
  return {
    summary,
    signals,
    verdict,
    distinctShare,
    ceilingPp,
    // Strictly above one half on the lower bound. The baseline is not shortlisted even if it clears,
    // because it is the thing every signal is measured against.
    shortlist: signals
      .filter((reading) => reading.signal !== 'draw-order' && reading.aucLow > 0.5)
      .map((reading) => reading.signal),
  };
}
