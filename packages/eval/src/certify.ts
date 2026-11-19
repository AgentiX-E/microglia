/**
 * What a rate can certify, and what a change in one costs in pairs.
 *
 * ## Two questions a break rate is asked, and only one of them was priced
 *
 * R155 divided the delta into `delta = f·r − (1−f)·b` and produced the first target this lane has ever
 * had for the harm side: `b* = r·f/(1−f) = 10.78%` on this corpus, against a pooled `b = 16.17%`. The
 * next change is supposed to be graded by driving `b` under `b*` while holding `r`. Two numbers stand
 * between that plan and a decision, and neither existed:
 *
 *  - **the price of detecting the change.** "b fell from 16.2% to 10.8%" is a comparison of two break
 *    rates on the same fold, so it is a paired comparison and its price is `tasksForDelta`. That
 *    function needs a discordance, and the discordance this change produces is unknown before the run:
 *    at one end every remaining break was already a break (the new break set is nested in the old), at
 *    the other the two break sets are as unrelated as the corpus's own draws. The two ends differ by a
 *    factor of five, so the price is reported as a **range with its assumption named** rather than as
 *    a single number.
 *  - **the price of certifying the level.** "b < 10.8%" is an absolute claim and needs an interval whose
 *    upper end is under the bar — a different question, with a different denominator (the control's
 *    passes) and a different arithmetic (Wilson, not McNemar). It is the one that decides whether a
 *    fold of a given size can make the claim *at all*, whatever the store does.
 *
 * ## The property that makes the second question worth asking first
 *
 * A rate equal to its own bar can never be certified as below it: the Wilson interval always has
 * positive width, so its upper end sits above the estimate for every finite sample. **No amount of
 * data certifies `b = 10.78%` as `b < 10.78%`.** The target therefore has to be reached *below* the
 * break-even by at least the fold's own half-width, and that half-width is a property of the fold, not
 * of the store. This module computes the highest bar a given pass count certifies at a given rate, so
 * a fold can be priced against the target before it is bought instead of after it comes back
 * `UNRESOLVED` — the failure mode four of this lane's six reads have had.
 *
 * ## Why the search and not a closed form
 *
 * `wilsonInterval` is the one interval this repository has, and solving it for `n` would be a second
 * copy of the same arithmetic with its own rounding. The search calls the existing function and
 * returns the smallest whole pass count that clears the bar, which is the only form a design can be
 * sized in.
 */

import { wilsonInterval } from './reproduction.js';
import { tasksForDelta } from './detectable.js';

function checkShare(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${field} must be a share in [0, 1], got ${String(value)}`);
  }
}

function checkTarget(value: number, field: string): void {
  checkShare(value, field);
  if (value === 0) throw new Error(`${field} must be positive: no rate is certified below zero`);
}

/**
 * The upper end of the 95% Wilson interval for `rate` measured over `n` passes.
 *
 * A claim of the form "the break rate is below `target`" holds at this sample exactly when this number
 * is at most `target`, which is the only reading `passesToCertify` inverts.
 */
export function upperBoundOf(rate: number, n: number): number {
  checkShare(rate, 'rate');
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`n must be a positive whole number of passes, got ${String(n)}`);
  }
  return wilsonInterval({ accuracy: rate, n }).high;
}

/**
 * The smallest number of passes at which a break rate of `planned` is certified below `target`.
 *
 * `null` when `planned >= target`, which is a fact about the arithmetic rather than a search that
 * failed: the interval's upper end is always above the estimate, so a store sitting at or above its
 * own bar cannot be certified as under it at any sample size. That is the finding this function exists
 * to make available before a dispatch — the target has to be *reached*, not merely measured again.
 */
export function passesToCertify(target: number, planned: number): number | null {
  checkTarget(target, 'target');
  checkShare(planned, 'planned');
  if (planned >= target) return null;

  // Bracket by doubling, then bisect on whole pass counts. `upperBoundOf` is decreasing in `n` for a fixed
  // rate — checked over a 50 × 600 grid by the suite rather than assumed here — so the doubling terminates at
  // a count whose interval clears the bar, and `planned < target` (the guard above) is what guarantees there
  // is one. No iteration cap: a cap would be a branch no input reaches, on top of an arithmetic that already
  // proves the loop ends.
  let high = 1;
  while (upperBoundOf(planned, high) > target) high *= 2;
  let low = Math.max(1, Math.floor(high / 2));
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (upperBoundOf(planned, middle) <= target) high = middle;
    else low = middle + 1;
  }
  // No runtime assertion here on purpose. The search is only correct while `upperBoundOf` decreases in
  // `n`, and a guard for the opposite case would be a branch no input reaches — this record has deleted
  // five of those rather than exempting them. The property is checked where it can fail: the test suite
  // walks `upperBoundOf` over a 50 × 600 grid and asserts it never rises.
  return low;
}

export type ChangePriceInput = {
  /** The break rate the store has now, as a share of the control's passes. */
  readonly from: number;
  /** The break rate the change is meant to reach. */
  readonly to: number;
  /** The share of trials the control passes — the denominator both rates are over. */
  readonly passShare: number;
  /** The share of trials the two arms already disagree on, which bounds the unrelated case. */
  readonly discordance: number;
};

export type ChangePrice = {
  /** `(from − to) · passShare`: what the change does to the delta, in shares of all trials. */
  readonly effect: number;
  /** Pairs needed if every remaining break was already a break — the floor of the range. */
  readonly nested: number;
  /** Pairs needed if the two break sets are as unrelated as the corpus's own draws — the ceiling. */
  readonly independent: number;
  /** The discordance the ceiling was computed at, so a reader can see which assumption it is. */
  readonly discordance: number;
};

/**
 * The pairs a reduction in the break rate costs, at the two ends of what is knowable in advance.
 *
 * The nested case is exact algebra rather than an assumption about the world: when the new break set is
 * a subset of the old one, the discordant pairs are exactly the breaks that went away, so the effect
 * and the discordance are the same number and `tasksForDelta` collapses to `z²/effect`. The unrelated
 * case takes the corpus's own discordance, which is what a fresh pair of draws would look like if the
 * change reordered the breaks rather than removing them.
 *
 * Both ends are `Infinity` for a change of zero — no sample resolves a difference that is not there —
 * which is the convention `tasksForDelta` already uses.
 */
export function changePriceOf(input: ChangePriceInput): ChangePrice {
  checkShare(input.from, 'from');
  checkShare(input.to, 'to');
  checkShare(input.passShare, 'passShare');
  checkShare(input.discordance, 'discordance');
  if (input.to > input.from) {
    throw new Error(
      `a reduction cannot raise the rate: from ${String(input.from)} to ${String(input.to)}`,
    );
  }
  const effect = (input.from - input.to) * input.passShare;
  const discordance = Math.max(effect, input.discordance);
  return {
    effect,
    nested: tasksForDelta(effect, effect),
    independent: tasksForDelta(effect, discordance),
    discordance,
  };
}

export type CertificationInput = {
  /** The bar the claim is against, as a share. */
  readonly target: number;
  /** The rate the fold is expected to measure, as a share. */
  readonly planned: number;
  /** The passes the fold carries — the control's passes, which is the denominator of a break rate. */
  readonly passes: number;
};

export type Certification = {
  readonly target: number;
  readonly planned: number;
  readonly passes: number;
  /** The highest bar this pass count certifies at this rate. */
  readonly upper: number;
  /** Whether `target` is at or above `upper`, which is the condition the claim needs. */
  readonly certified: boolean;
  /** The passes the target would need at this rate, or null when no sample size reaches it. */
  readonly needed: number | null;
};

export function certificationOf(input: CertificationInput): Certification {
  checkTarget(input.target, 'target');
  checkShare(input.planned, 'planned');
  if (!Number.isInteger(input.passes) || input.passes < 1) {
    throw new Error(`passes must be a positive whole number, got ${String(input.passes)}`);
  }
  const upper = upperBoundOf(input.planned, input.passes);
  return {
    target: input.target,
    planned: input.planned,
    passes: input.passes,
    upper,
    certified: upper <= input.target,
    needed: passesToCertify(input.target, input.planned),
  };
}

/**
 * The reading as one line.
 *
 * Three clauses because the numbers answer three different questions: what the fold's own pass count
 * certifies, whether that reaches the bar, and what reaching it would cost. A line that printed only
 * the first would leave a reader to do the comparison the module exists to do.
 */
export function certificationLine(reading: Certification): string {
  const pct = (share: number): string => `${(share * 100).toFixed(2)}%`;
  const bar =
    `at ${String(reading.passes)} pass(es) a ${pct(reading.planned)} break rate is certified only below ` +
    `${pct(reading.upper)}`;
  const verdict = reading.certified
    ? `, which reaches the ${pct(reading.target)} bar`
    : `, which does not reach the ${pct(reading.target)} bar`;
  const price =
    reading.needed === null
      ? `; no sample certifies a rate at or above its own bar, so ${pct(reading.target)} cannot be certified by measuring it again`
      : `; certifying it at ${pct(reading.planned)} takes ${String(reading.needed)} pass(es)`;
  return `certify: ${bar}${verdict}${price}`;
}
