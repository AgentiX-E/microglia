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

/**
 * The L2b question, as arithmetic: does observing the failure add anything?
 *
 * Two arms answer the same cases. `single` learns from the correction alone —
 * the failure is never recorded. `pair` records attempt one as a failure and the
 * correction on attempt two, so the store sees *which* rule was in the pack when
 * the answer went wrong, not only what the right answer was.
 *
 * The verdict is deliberately not "pair > single". It reports both recoveries,
 * their difference, and the reachable share they were computed over, because an
 * improvement smaller than the design's own resolution is not an improvement —
 * and a paired delta on an unreachable wall is a statement about the split.
 */
export type PairVerdict = {
  readonly reachable: number;
  readonly singleRecovery: number;
  readonly pairRecovery: number;
  /** `pairRecovery - singleRecovery`, the quantity a pair-contrast claim rests on. */
  readonly delta: number;
  readonly pairHelps: boolean;
};

export function pairVerdict(options: {
  readonly training: readonly Scoped[];
  readonly evaluated: readonly Scoped[];
  readonly single: number;
  readonly pair: number;
  readonly baseline: number;
  readonly oracle: number;
  /** Smallest difference worth calling an improvement, in accuracy points. */
  readonly bar: number;
}): PairVerdict {
  const single = reachableRecovery({ ...options, arm: options.single });
  const pair = reachableRecovery({ ...options, arm: options.pair });
  const delta = pair.ratio - single.ratio;
  return {
    reachable: single.reachable,
    singleRecovery: single.ratio,
    pairRecovery: pair.ratio,
    delta,
    pairHelps: delta >= options.bar && pair.reachable > 0,
  };
}
