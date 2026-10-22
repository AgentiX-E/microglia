/**
 * Is the gap a lane reports actually reachable?
 *
 * `recoveryRatio` divides by headroom, and headroom is only meaningful where the
 * knowledge needed to close it is *learnable from the training split*. A corpus
 * whose held-out domain never appears in training has cases no correction can
 * reach: a loop that scores 0.55 against an oracle of 1.00 there has not failed,
 * it has hit a wall the corpus built.
 *
 * So a pair-contrast lane states this number before it states a recovery: the
 * share of evaluated cases whose scope key was seen during teaching. Everything
 * else is a fixed cost, and reporting it separately is the difference between
 * "the mechanism recovered 60% of what was available" and "the mechanism
 * recovered 60% of a number that included cases it could not reach".
 */
export type Scoped = { readonly domain: string; readonly intent: string };

/** The key a rule can transfer across: same domain and same intent. */
export function scopePair(case_: Scoped): string {
  return `${case_.domain}\u0000${case_.intent}`;
}

/**
 * Share of `evaluated` whose key appears at least once in `training`.
 *
 * A key absent from training is not a measurement of the loop; it is a
 * measurement of the split. Returning 0 for an empty evaluation set keeps the
 * caller from dividing by it later.
 */
export function reachableShare(training: readonly Scoped[], evaluated: readonly Scoped[]): number {
  if (evaluated.length === 0) return 0;
  const seen = new Set(training.map(scopePair));
  return evaluated.filter((entry) => seen.has(scopePair(entry))).length / evaluated.length;
}

/**
 * The recovery a lane is allowed to claim: the arm's ratio, but only over the
 * cases that were reachable. Two numbers, never one — a single blended figure
 * hides exactly the wall this function exists to expose.
 */
export function reachableRecovery(options: {
  readonly training: readonly Scoped[];
  readonly evaluated: readonly Scoped[];
  readonly arm: number;
  readonly baseline: number;
  readonly oracle: number;
}): { readonly reachable: number; readonly ratio: number } {
  const reachable = reachableShare(options.training, options.evaluated);
  const headroom = options.oracle - options.baseline;
  if (headroom <= 0 || reachable === 0) return { reachable, ratio: 0 };
  const gained = options.arm - options.baseline;
  if (gained <= 0) return { reachable, ratio: 0 };
  return { reachable, ratio: Math.min(1, gained / headroom) };
}
