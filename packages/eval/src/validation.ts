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
