/**
 * When a rule has earned retirement.
 *
 * Xiong et al. (arXiv 2505.16067) report that an agent follows a retrieved record closely
 * enough to reproduce its error, and that deleting records by observed utility beats
 * deleting them by age: selective addition plus history-based deletion recovers about ten
 * points over naive growth, and on EHRAgent indiscriminate saving scored 13.05% where
 * strict selection scored 38.5%. The deletion half needs a rule for *when*, and that rule
 * is this module.
 *
 * The counterweight is that a wrong answer is not proof the rule caused it. The model may
 * have been wrong on its own; a rule present at a failure is a suspect, not a convict. So
 * the test is a share rather than a count: a rule is retired when it was present at more
 * failures than successes, over enough trials that the share means something. Both halves
 * of that sentence matter — without the trial floor, one unlucky question retires anything,
 * and without the share, a rule that is usually right is retired for being present at the
 * failures that would have happened anyway.
 *
 * This is deliberately separable from the lane so it can be tested: a threshold nobody can
 * exercise is a preference, and the previous version ("retire after one failure") was
 * exactly that — it retired every rule the stand-in endpoint touched.
 */

export type ValidationCredit = {
  /** Questions in which this rule reached a prompt during the validation pass. */
  readonly trials: number;
  /** Of those, the ones whose answer was wrong. */
  readonly failures: number;
};

export type RetirementPolicy = {
  /**
   * Injections a rule needs before a failure share is allowed to retire it.
   *
   * Two, because one is noise: this corpus injects about 1.8 rules per question, and a
   * floor of one makes the arm a coin toss on which single question happened to be hard.
   */
  readonly minTrials: number;
  /**
   * Share of trials that must have failed, as a fraction in [0, 1].
   *
   * The default retires a rule that failed at least as often as it succeeded, which reads
   * as "no better than a coin toss" rather than "not perfect". A stricter value retires
   * less and makes the arm closer to `full`; a looser one retires more and makes it closer
   * to `none`. Both are settings, because which of those is right is the experiment.
   */
  readonly failureRate: number;
};

export const DEFAULT_RETIREMENT: RetirementPolicy = { minTrials: 2, failureRate: 0.5 };

/** A policy from untrusted configuration, refusing rather than clamping silently. */
export function parseRetirementPolicy(raw: {
  readonly minTrials?: string | undefined;
  readonly failureRate?: string | undefined;
}): RetirementPolicy {
  const minTrials = raw.minTrials === undefined || raw.minTrials === '' ? DEFAULT_RETIREMENT.minTrials : Number(raw.minTrials);
  const failureRate =
    raw.failureRate === undefined || raw.failureRate === ''
      ? DEFAULT_RETIREMENT.failureRate
      : Number(raw.failureRate);
  if (!Number.isFinite(minTrials) || minTrials < 1 || Math.trunc(minTrials) !== minTrials) {
    throw new Error(`the trial floor must be a whole number of at least 1, got '${String(raw.minTrials)}'`);
  }
  if (!Number.isFinite(failureRate) || failureRate <= 0 || failureRate > 1) {
    throw new Error(`the failure share must be in (0, 1], got '${String(raw.failureRate)}'`);
  }
  return { minTrials, failureRate };
}

/**
 * The rules this policy retires.
 *
 * Sorted, so two runs over the same credit produce the same deletion in the same order and
 * the store's digest is a function of the data rather than of map iteration.
 */
export function retireeFrom(
  credit: ReadonlyMap<string, ValidationCredit>,
  policy: RetirementPolicy = DEFAULT_RETIREMENT,
): readonly string[] {
  const out: string[] = [];
  for (const [id, entry] of credit) {
    if (entry.trials < policy.minTrials) continue;
    if (entry.failures / entry.trials < policy.failureRate) continue;
    out.push(id);
  }
  return out.sort();
}

/**
 * How many rules sit at each observed failure share, as `failures/trials`.
 *
 * Carried in the artefact because the policy's effect is otherwise invisible: a run that
 * retires nothing and a run whose rules were never injected twice produce the same
 * accuracy and the same empty deletion list, and only the histogram tells them apart.
 */
export function creditHistogram(credit: ReadonlyMap<string, ValidationCredit>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const entry of credit.values()) {
    const key = `${entry.failures}/${entry.trials}`;
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

/**
 * Credit measured against the counterfactual, which is the one the absolute share cannot
 * supply.
 *
 * The absolute score asks "was this rule present when the answer was wrong", and iteration
 * 76 showed that question is answered by the question: the failure counts fit a single
 * binomial at the lane's own error rate (pooled χ² 10.71 on 9 degrees of freedom, p = 0.296),
 * so retiring the worst third was retiring a random third — 268 rules removed, −0.57pp
 * measured, p = 0.81.
 *
 * This score asks the question the deletion was supposed to be based on: *did this answer
 * change because the rule was there?* Each validation question is answered twice, once with
 * the pack and once without, and a rule is credited only where the two outcomes differ.
 * Questions the model gets right either way, or wrong either way, teach nothing about the
 * rule and are excluded — which is exactly what removes the difficulty confound, because
 * difficulty is the part that is identical in both halves of a pair.
 *
 * The price is a second call per validation question, so it is a setting rather than the
 * default: a lane that doubles its spend by default is a lane nobody re-runs.
 */
export type DecisiveCredit = {
  /** Questions this rule was present for where the answer was wrong without it. */
  readonly helped: number;
  /** Questions this rule was present for where the answer was right without it. */
  readonly harmed: number;
};

export type DecisivePolicy = {
  /** Comparisons in which the outcome changed before a share may retire a rule. */
  readonly minDecisive: number;
  /** Share of those comparisons that must have gone the wrong way, in (0, 1]. */
  readonly harmShare: number;
};

/**
 * Two thirds, not a half.
 *
 * A rule with one harmful comparison and one helpful one has a record of exactly nothing,
 * and retiring it on the tie would repeat the mistake this score exists to correct: the
 * absolute policy retired on a share of one half and the result was a random pruning. Two
 * thirds means "at least twice as many harms as helps", which a 2–0 or a 2–1 record meets
 * and a 1–1 record does not.
 */
export const DEFAULT_DECISIVE: DecisivePolicy = { minDecisive: 2, harmShare: 2 / 3 };

export function parseDecisivePolicy(raw: {
  readonly minDecisive?: string | undefined;
  readonly harmShare?: string | undefined;
}): DecisivePolicy {
  const minDecisive =
    raw.minDecisive === undefined || raw.minDecisive === '' ? DEFAULT_DECISIVE.minDecisive : Number(raw.minDecisive);
  const harmShare =
    raw.harmShare === undefined || raw.harmShare === '' ? DEFAULT_DECISIVE.harmShare : Number(raw.harmShare);
  if (!Number.isFinite(minDecisive) || minDecisive < 1 || Math.trunc(minDecisive) !== minDecisive) {
    throw new Error(`the decisive floor must be a whole number of at least 1, got '${String(raw.minDecisive)}'`);
  }
  if (!Number.isFinite(harmShare) || harmShare <= 0 || harmShare > 1) {
    throw new Error(`the harm share must be in (0, 1], got '${String(raw.harmShare)}'`);
  }
  return { minDecisive, harmShare };
}

/**
 * The rules this policy retires, from counterfactual credit.
 *
 * `minDecisive: 1` is permitted and means "retire on the first question where it made
 * things worse", which is a real setting for a system that would rather be sparse than
 * right — it is not the default because one pair is one coin flip.
 */
export function retireeFromDecisive(
  credit: ReadonlyMap<string, DecisiveCredit>,
  policy: DecisivePolicy = DEFAULT_DECISIVE,
): readonly string[] {
  const out: string[] = [];
  for (const [id, entry] of credit) {
    const decisive = entry.helped + entry.harmed;
    if (decisive < policy.minDecisive) continue;
    if (entry.harmed / decisive < policy.harmShare) continue;
    out.push(id);
  }
  return out.sort();
}

/**
 * The rules a *clearance* policy removes, which is not the same question as retirement.
 *
 * Retirement asks "has this rule earned removal", and answers only when the record is bad
 * enough to survive a two-thirds threshold — a rule with one harm and no help is not retired,
 * because one pair is one coin flip. Clearance asks the opposite question and can afford to be
 * permissive in the other direction: **the set of rules that have a record of net harm is
 * dropped, and everything else is kept.** A rule with no decisive comparison is kept, which is
 * what makes the arm a clearance of the store rather than a rebuild of it: the pack shrinks by
 * the items that were *measured* to hurt, and by nothing else.
 *
 * The difference matters for what the arm can conclude. A retirement arm that removes two
 * thirds of the store and lands on `none` is confounded with dose — the record already knows
 * that an empty pack is `none`. A clearance arm that removes a minority and still moves is not.
 *
 * `harmed > helped` rather than `harmed >= helped`: a tie is a record of exactly nothing, and
 * dropping on a tie would be a prior ("unmeasured is bad") smuggled into a utility argument.
 * The prior is available as `minDecisive: 1` and is not what this function means.
 */
export type ClearancePolicy = {
  /** Decisive comparisons a rule needs before its record is allowed to remove it. */
  readonly minDecisive: number;
};

export const DEFAULT_CLEARANCE: ClearancePolicy = { minDecisive: 1 };

export function clearanceFromDecisive(
  credit: ReadonlyMap<string, DecisiveCredit>,
  policy: ClearancePolicy = DEFAULT_CLEARANCE,
): readonly string[] {
  const out: string[] = [];
  for (const [id, entry] of credit) {
    const decisive = entry.helped + entry.harmed;
    if (decisive < policy.minDecisive) continue;
    if (entry.harmed <= entry.helped) continue;
    out.push(id);
  }
  return out.sort();
}

/** Rules by observed harm share, as `harmed/decisive`, for the same reason as its absolute twin. */
export function decisiveHistogram(credit: ReadonlyMap<string, DecisiveCredit>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const entry of credit.values()) {
    if (entry.helped + entry.harmed === 0) continue;
    const key = `${entry.harmed}/${entry.helped + entry.harmed}`;
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

/**
 * What one comparison says about the rule that was in the pack.
 *
 * Kept as a function rather than inline because it is the only place the counterfactual's
 * logic lives, and it has four cases that all produce the same arithmetic if written
 * carelessly: a call that failed, two calls that agreed, and the two directions of
 * disagreement. `uninformative` is not the absence of a verdict — it is the verdict
 * "this question teaches nothing about this rule", which is why it is counted separately
 * from a harm.
 */
export type OutcomeCredit = 'helped' | 'harmed' | 'uninformative';

export function outcomeCredit(withRule: boolean | undefined, withoutRule: boolean | undefined): OutcomeCredit {
  if (withRule === undefined || withoutRule === undefined) return 'uninformative';
  if (withRule === withoutRule) return 'uninformative';
  return withRule ? 'helped' : 'harmed';
}
