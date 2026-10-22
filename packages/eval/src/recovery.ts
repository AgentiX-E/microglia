/**
 * How much of the reachable gap an arm actually closes.
 *
 * Every lane in this repository reports a delta against a no-memory baseline,
 * which answers "does it help" and not "how much of the possible help did it
 * deliver". The second question needs an oracle: the accuracy of the policy that
 * knows the answer, measured on the same cases.
 *
 * The ratio is only meaningful where the gap is **reachable**. On a corpus whose
 * conventions are learnable from corrections, an arm that recovers everything
 * scores 1.00 by construction, and that number describes the corpus, not the
 * mechanism — which is why L2b needs a workload with knowledge the loop cannot
 * reach. A ratio computed against an unreachable ceiling overstates the arm.
 */
export type RecoveryInput = {
  /** Accuracy of the arm, in [0, 1]. */
  readonly arm: number;
  /** Accuracy of the no-memory baseline on the same cases. */
  readonly baseline: number;
  /** Accuracy of the policy oracle on the same cases. */
  readonly oracle: number;
};

/**
 * `(arm - baseline) / (oracle - baseline)`, clamped to [0, 1].
 *
 * Three degenerate cases, each answered rather than thrown: no gap to close
 * returns 1 (the arm cannot be blamed for a corpus that is already solved); an
 * arm below its baseline returns 0 rather than a negative share; an arm that
 * beats the oracle returns 1, because a ratio above one claims the oracle was
 * wrong, which is a bug in the oracle.
 */
export function recoveryRatio(input: RecoveryInput): number {
  const headroom = input.oracle - input.baseline;
  if (headroom <= 0) return 1;
  const gained = input.arm - input.baseline;
  if (gained <= 0) return 0;
  return Math.min(1, gained / headroom);
}
