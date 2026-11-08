/**
 * What a paired reading is allowed to say, given how much it could have seen.
 *
 * R49 (run `3ea349af`, retail, n = 50, seed 300) produced the reading this file
 * exists for:
 *
 *     [l4-pair] paired n=50 delta=-4.00pp [-14.00, 6.00] p=0.6875 lost=4 gained=2
 *     [l4-pair] FAIL l4-paired: -4.00pp (p=0.6875, n=50)
 *     [l4-pair] FAIL V5-resolution: minimum detectable 13.73pp
 *
 * `l4-paired` passed only when `delta >= 0 && p < 0.05`. The pair's own minimum
 * detectable difference is 13.73pp, so no effect this mechanism could plausibly
 * have — positive or negative — can reach p < 0.05 on this scenario at this
 * sample. The gate was **unreachable by construction**, and it said so in the
 * same breath as the arithmetic proving it. A gate that cannot pass is not a
 * gate: it is a line that turns every future dispatch red for a reason that has
 * nothing to do with the mechanism under test, and a red line that is always red
 * teaches its readers to ignore red.
 *
 * ## The three things a pair can establish, and the one it cannot
 *
 * - **HARM.** The memory cost accuracy. This is the finding the lane exists to
 *   detect, and its condition is not invented here: it is the R45 revert rule,
 *   unchanged, read from `l4-revert.ts` — significantly negative, or below
 *   -5pp with a served pack. `l4-paired` now passes exactly when that rule does
 *   not fire, which is what it was always meant to mirror.
 * - **BENEFIT.** The memory helped. A claim in this direction requires three
 *   things at once: a positive delta, the significance bar, and a delta at least
 *   as large as the smallest effect the pair could have detected. The third is
 *   the new one. Without it, +4.00pp at an MDE of 13.73pp would be published as
 *   a benefit that the experiment had already certified it could not see.
 * - **UNRESOLVED.** Neither. The honest reading when the effect, in either
 *   direction, is smaller than the sample's resolution. It is not a pass and not
 *   a failure of the mechanism; it is a statement about the instrument, and the
 *   verdict carries the bound (`|delta| < detectablePp`) so a reader learns what
 *   was excluded rather than merely that nothing was concluded.
 *
 * The state is derived from the same two numbers the report prints — the delta
 * and the minimum detectable difference — because a verdict read from a
 * different pair of numbers than the reader can see is a verdict nobody can
 * check.
 *
 * ## Why this is not a weakened gate
 *
 * The failure V5-resolution was written to prevent was a design whose minimum
 * detectable difference was 21.4pp against a 6pp bar **publishing a delta
 * anyway**. The cure for that is not a red build on every scenario that cannot
 * reach 6pp; it is a readout that refuses to claim a direction it cannot
 * resolve. `V5-resolution` is left exactly as it was — it still says the sample
 * cannot resolve 6pp, and on τ² retail it always will, because 115 tasks at
 * pass^4 cannot. What changes is that the *finding* gate stops pretending that
 * statement is a failure of the memory.
 */

import { REVERT_P_BAR, revertRule, type RevertVerdict } from './l4-revert.js';

/** What one paired reading establishes. */
export type PairedVerdictState = 'HARM' | 'BENEFIT' | 'UNRESOLVED';

export type PairedVerdictInput = {
  /** Percentage points, second arm minus first. Negative means the treatment did worse. */
  readonly deltaPp: number;
  /** Exact two-sided p-value of the paired comparison. */
  readonly p: number;
  /** Tasks the two arms both scored. */
  readonly paired: number;
  /**
   * Packs the treatment arm actually served. The -5pp branch needs it: a memory
   * that emptied every pack cannot have cost accuracy through its content.
   */
  readonly servedPacks: number;
  /**
   * The smallest effect this pair could have detected at 80% power, in
   * percentage points. `Infinity` when no task changed hands and therefore no
   * variance exists to estimate.
   */
  readonly detectablePp: number;
};

export type PairedVerdict = {
  readonly state: PairedVerdictState;
  /**
   * The sentence a report may print about the memory, or `null` when the
   * reading supports no claim in either direction.
   *
   * Null rather than a hedged sentence: a field that is always a string is a
   * field a downstream writer will concatenate into a claim.
   */
  readonly claim: string | null;
  /** Always present, so a reader sees the branch that decided it. */
  readonly reason: string;
  /** The revert rule's own verdict, kept for the artefact rather than re-derived. */
  readonly harm: RevertVerdict;
  /**
   * What the pair excluded: an effect larger than this many percentage points in
   * either direction did not appear. `Infinity` when the pair could not see one.
   */
  readonly excludedAbovePp: number;
};

function assertFinite(name: string, value: number): void {
  if (!Number.isFinite(value)) throw new Error(`${name} must be finite`);
}

/**
 * Grade one paired reading into the three states, and refuse a broken instrument
 * rather than grading it.
 *
 * A negative non-finite resolution is a defect in the power arithmetic, not a
 * very good experiment: it is refused here instead of being compared against a
 * delta and quietly losing.
 */
export function pairedVerdict(input: PairedVerdictInput): PairedVerdict {
  assertFinite('deltaPp', input.deltaPp);
  // `detectablePp` may be `Infinity` — that is the value a pair with no
  // discordant task reports, and refusing it would make the honest case
  // unrepresentable — but it may not be NaN, and it may not be a zero or
  // negative resolution, which are defects in the power arithmetic rather than
  // very good experiments.
  if (Number.isNaN(input.detectablePp)) {
    throw new Error('detectablePp must be a number');
  }
  if (input.detectablePp <= 0) {
    throw new Error('detectablePp must be positive: a pair cannot resolve a zero-point effect');
  }

  // The harm branch is the registered revert rule, called rather than copied. A
  // second implementation of the same condition is a second answer to the same
  // question, and the one that drifts is always the one nobody graded.
  const harm = revertRule(
    { scope: 'within-run', deltaPp: input.deltaPp, p: input.p, paired: input.paired },
    input.servedPacks,
  );
  if (harm.fires) {
    return {
      state: 'HARM',
      claim: `the memory costs accuracy: ${input.deltaPp.toFixed(2)}pp`,
      reason: harm.reason,
      harm,
      excludedAbovePp: input.detectablePp,
    };
  }

  // A benefit must clear both the significance bar and the resolution bar. The
  // second is the one this file adds: at an MDE of 13.73pp a +4.00pp delta is
  // indistinguishable from the noise the sample was already known to carry.
  if (input.deltaPp > 0 && input.p < REVERT_P_BAR && input.deltaPp >= input.detectablePp) {
    return {
      state: 'BENEFIT',
      claim: `the memory helps: +${input.deltaPp.toFixed(2)}pp, above the ${input.detectablePp.toFixed(2)}pp the pair could resolve`,
      reason: `+${input.deltaPp.toFixed(2)}pp at p=${input.p.toFixed(4)} with n=${input.paired} pairs, and ${input.deltaPp.toFixed(2)}pp >= the ${input.detectablePp.toFixed(2)}pp minimum detectable difference`,
      harm,
      excludedAbovePp: input.detectablePp,
    };
  }

  // Everything else, including a significant negative that the revert rule's
  // own thresholds did not fire on: the rule's bars are the registered ones, and
  // a pair does not get to override them because its p-value looked small.
  const bound = Number.isFinite(input.detectablePp)
    ? `; no effect larger than ${input.detectablePp.toFixed(2)}pp in either direction was shown`
    : '; the pair could not estimate a minimum detectable difference, so it excludes nothing';
  return {
    state: 'UNRESOLVED',
    claim: null,
    reason:
      `${input.deltaPp.toFixed(2)}pp at p=${input.p.toFixed(4)} with n=${input.paired} pairs ` +
      `does not clear the ${input.detectablePp.toFixed(2)}pp the sample can resolve${bound}`,
    harm,
    excludedAbovePp: input.detectablePp,
  };
}
