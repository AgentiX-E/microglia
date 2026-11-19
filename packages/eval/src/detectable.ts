/**
 * The one formula this record uses to say what a sample could have detected.
 *
 * It lives in its own module because three readers need it and they cannot all reach the same
 * place. `protocol.ts` computes a lane's minimum detectable difference, `power.ts` puts every
 * published delta beside it, and `prereg.ts` refuses a registration that claims an effect its own
 * sample could not resolve — and `prereg.ts` runs *before anything is built*, which its import
 * closure is tested on. Reaching the formula through `protocol.ts` would have pulled the core
 * package into a file that has to load without it, and the test that failed on that was right.
 *
 * A second copy of the arithmetic would have been worse than the dependency: two formulas for one
 * quantity is two answers to a question the record already answers, and the disagreement would
 * surface as a gate that passes a claim its own power audit rejects.
 */

/** `z` for α = 0.05 two-sided with 80% power. */
export const POWER_Z = 2.802;

/**
 * Smallest difference a paired design can detect at the stated power.
 *
 * Inverts the McNemar sample-size formula `n ≈ z²·(p01+p10)/(p01−p10)²`: given n and the expected
 * share of discordant pairs, the detectable difference is `sqrt(z²·d/n)`. A design that cannot
 * detect the effect it claims to look for is not a test of that claim.
 *
 * `Infinity` rather than zero for a sample with no pairs or no discordance: neither can detect
 * anything, and a zero would read as "detects everything".
 */
export function detectableDelta(n: number, discordance: number, z = POWER_Z): number {
  if (n <= 0) return Number.POSITIVE_INFINITY;
  if (!(discordance > 0)) return Number.POSITIVE_INFINITY;
  const d = Math.min(1, discordance);
  return Math.sqrt((z * z * d) / n);
}

/**
 * The inverse: the paired sample a stated effect needs before it can be resolved.
 *
 * `effect` is a share of pairs, not percentage points — the same unit `detectableDelta` returns and the same
 * unit the protocol carries, so `tasksForDelta(0.05, 0.275)` is the price of the 5pp bar (§`bin/conditional`).
 *
 * `detectableDelta` answers "what is the smallest effect this sample could see". This answers the question a
 * design should be asked *before* it is bought — "how many pairs does the effect I am hunting need" — and it is
 * the same formula solved for `n` instead of for the effect:
 *
 * ```
 * n = z²·d / effect²
 * ```
 *
 * It exists because a bar can be stated in points and never priced in pairs. This lane's revert rule is
 * `−5pp with a served pack`; at retail's observed discordance (0.275) `tasksForDelta(0.05, 0.275)` is
 * **864 paired trials**, and the largest fold it has ever run is 194. A bar whose price is never computed
 * is a rule that fires on readings the design cannot certify, and the direction of the miscalculation is the
 * expensive one: it reverts on noise.
 *
 * Rounded **up** to a whole pair, because a design is sized in tasks and a fractional task is a sample nobody
 * can draw. `Infinity` for a non-positive effect or no discordance, which are the same non-answers
 * `detectableDelta` returns: no sample resolves zero, and a sample whose arms never disagree resolves nothing.
 */
export function tasksForDelta(effect: number, discordance: number, z = POWER_Z): number {
  if (!(effect > 0)) return Number.POSITIVE_INFINITY;
  if (!(discordance > 0)) return Number.POSITIVE_INFINITY;
  const d = Math.min(1, discordance);
  return Math.ceil((z * z * d) / (effect * effect));
}
