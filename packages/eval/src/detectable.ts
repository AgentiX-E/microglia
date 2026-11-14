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
