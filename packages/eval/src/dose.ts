/**
 * How many notes a question gets, and which questions get any.
 *
 * Twenty-three iterations varied the pack along substrate, dose, framing, ordering, scoping,
 * clearance, corroboration, grounding and competitor presence, and every one came back inside
 * the instrument's floor. The one number in the artefact that is not null is the *shape* of the
 * dose: on the dev split, the 343 questions whose pack held a single item moved **+2.62pp** and
 * the 1,191 whose pack held two moved **−1.51pp**. That is a 4.13pp difference between two
 * groups of questions, and it is not yet a causal statement — the groups are different questions,
 * and the store offered a second item on the ones it had more to say about. Turning it into a
 * causal one is a truncation applied to every question, which is what `full-one` is for.
 *
 * This module holds the arithmetic that both arms need, and it holds it *outside* the lane for
 * the reason `validation.ts` is outside the lane: a threshold nobody can exercise is a
 * preference. Two decisions live here.
 *
 * **One.** Which single item a one-slot pack carries. The lane has always ordered by relevance
 * and diversified with MMR, so the first item is the most similar one; truncation is therefore
 * "admit the most relevant note and no other", not "admit the best note". The distinction is
 * the whole of R25's second question, and it is measured by comparing the truncation against a
 * slot filled by a rule that reads the question.
 *
 * **Two.** Whether a question should see a note at all. That is the per-question admission the
 * pre-registration asks about, and the reason it has never been testable before is arithmetic:
 * per-item counterfactual credit is empty for 77% of a store built from 280 corrections, and
 * restricting it to a lexical neighbourhood of the held-out question makes it emptier. The
 * statistic used here is the one that is dense — the note's own coverage of the question — and
 * the threshold is fitted on the fold's *learning* rows, where the counterfactual was paid for,
 * never on the questions being scored.
 */

import type { OutcomeCredit } from './validation.js';

/**
 * One learning row, reduced to the two numbers a floor needs.
 *
 * `coverage` is measured for the item the row would actually receive — the top item of its own
 * recalled pack — because a floor is a decision about *that* note, and a floor computed over an
 * average of the pack would be a statistic about a question that no question is.
 */
export type AdmissionSample = {
  /** Share of the question's content terms its top note mentions, in [0, 1]. */
  readonly coverage: number;
  /** What that note did to the answer, or `uninformative` when the pair could not say. */
  readonly credit: OutcomeCredit;
};

export type AdmissionPolicy = {
  /**
   * Smallest share of questions the floor may keep.
   *
   * Without it the fit is unbounded in the wrong direction: net helped-minus-harmed is maximised
   * by keeping the one question that was rescued, which is a policy that admits nothing and
   * reports a perfect record. A half is the smallest share at which "admission" is still a
   * decision about a population rather than a decision about a handful of cases, and it is a
   * setting rather than a constant so the pre-registration can say what it used.
   */
  readonly minKept: number;
  /**
   * Decisive learning rows before any floor is read.
   *
   * With fewer, the fit is choosing between thresholds on noise: the dev split's learning pass
   * produces about a hundred decisive rows out of 1,400, so a floor of eight is well inside the
   * supply, and a fold that produced fewer than eight is a fold whose admission cannot be fitted
   * at all — which the fit says rather than pretending.
   */
  readonly minDecisive: number;
};

export const DEFAULT_ADMISSION: AdmissionPolicy = { minKept: 0.5, minDecisive: 8 };

/**
 * A policy from untrusted configuration, refusing rather than clamping.
 *
 * `validation.ts` refuses for the same reason: a share of `1.4` silently clamped to `1` is a
 * policy nobody wrote, and the run would report a floor fitted under a constraint the operator
 * did not ask for. The first version of this module clamped the kept share to one *inside* the
 * arithmetic instead — `Math.max(1, minKept)` — which read as "at least one question" and meant
 * "at least all of them", so every fit returned the lowest floor and the arm would have measured
 * `full-one` under a second name. Three of this module's own tests failed on it, which is the
 * only reason it was found before a dispatch.
 */
export function parseAdmissionPolicy(raw: {
  readonly minKept?: string | undefined;
  readonly minDecisive?: string | undefined;
}): AdmissionPolicy {
  const minKept =
    raw.minKept === undefined || raw.minKept === ''
      ? DEFAULT_ADMISSION.minKept
      : Number(raw.minKept);
  const minDecisive =
    raw.minDecisive === undefined || raw.minDecisive === ''
      ? DEFAULT_ADMISSION.minDecisive
      : Number(raw.minDecisive);
  if (!Number.isFinite(minKept) || minKept <= 0 || minKept > 1) {
    throw new RangeError(`the kept share must be in (0, 1], got '${String(raw.minKept)}'`);
  }
  if (!Number.isFinite(minDecisive) || minDecisive < 1 || Math.trunc(minDecisive) !== minDecisive) {
    throw new RangeError(
      `the decisive floor must be a whole number of at least 1, got '${String(raw.minDecisive)}'`,
    );
  }
  return { minKept, minDecisive };
}

export type AdmissionFit = {
  /**
   * Coverage at or above which a question sees its note; 0 keeps every question.
   *
   * Always either 0 or a coverage that occurs in the learning rows, so the reported figure is a
   * threshold that was actually applied to something. A floor interpolated between observations
   * would be a number whose effect on the population is a second computation nobody recorded.
   */
  readonly floor: number;
  /** Learning rows at or above the floor; the population share the arm is a treatment for. */
  readonly kept: number;
  readonly total: number;
  /** Decisive rows at or above the floor, which is what the net is computed over. */
  readonly helped: number;
  readonly harmed: number;
  /**
   * Why the fit came back where it did.
   *
   * `no-evidence` is not a failure — it is the answer "this fold's learning rows could not tell
   * a helpful note from a harmful one", and an arm carrying it is `full-one` under a second
   * name. The gate reads this field rather than the floor, because a floor of 0 produced by
   * evidence and a floor of 0 produced by its absence are the same number and different facts.
   */
  readonly reason: 'fitted' | 'no-evidence' | 'nothing-kept';
};

/**
 * The floor that maximises net decisive outcomes on the learning rows.
 *
 * Candidates are the observed coverages themselves, evaluated in ascending order, so ties resolve
 * towards showing the note: two floors with the same net are the same evidence, and the lower one
 * asks the model to read less of what it already has rather than more.
 *
 * `kept` is counted over every sample, decisive or not, because the floor is applied to held-out
 * questions where the credit is unknown by construction; `helped` and `harmed` are counted over
 * the decisive ones, because those are the only rows that can say anything about a threshold.
 */
export function admissionFloor(
  samples: readonly AdmissionSample[],
  policy: AdmissionPolicy = DEFAULT_ADMISSION,
): AdmissionFit {
  const total = samples.length;
  const decisive = samples.filter((sample) => sample.credit !== 'uninformative');
  if (total === 0 || decisive.length < Math.max(1, policy.minDecisive)) {
    return { floor: 0, kept: total, total, helped: 0, harmed: 0, reason: 'no-evidence' };
  }

  const minimum = Math.max(1, Math.ceil(policy.minKept * total));
  const candidates = [...new Set(decisive.map((sample) => sample.coverage))].sort((a, b) => a - b);

  let best: { floor: number; kept: number; helped: number; harmed: number } | undefined;
  for (const floor of candidates) {
    const kept = samples.filter((sample) => sample.coverage >= floor).length;
    if (kept < minimum) continue;
    let helped = 0;
    let harmed = 0;
    for (const sample of samples) {
      if (sample.coverage < floor) continue;
      if (sample.credit === 'helped') helped += 1;
      if (sample.credit === 'harmed') harmed += 1;
    }
    const net = helped - harmed;
    const bestNet = best === undefined ? Number.NEGATIVE_INFINITY : best.helped - best.harmed;
    // Strictly greater: equal nets keep the earlier, lower floor.
    if (net > bestNet) best = { floor, kept, helped, harmed };
  }

  if (best === undefined) {
    return { floor: 0, kept: total, total, helped: 0, harmed: 0, reason: 'nothing-kept' };
  }
  return { ...best, total, reason: 'fitted' };
}

/**
 * The pack a question is shown under a floor.
 *
 * One item, or none. The truncation is deliberate rather than incidental: the arm exists to
 * measure a *one-slot* budget, and a floor applied to a two-item pack would confound admission
 * with dose — the very variable R16 could not separate from size.
 */
export type OneSlotPolicy = {
  readonly floor: number;
};

export function admitsAt(coverage: number, policy: OneSlotPolicy): boolean {
  return coverage >= policy.floor;
}
