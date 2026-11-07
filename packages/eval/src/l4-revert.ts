/**
 * The R45 revert rule, lifted out of prose and offline scripts into a typed,
 * testable production invariant.
 *
 * Registered in prereg/R45-admission.md and re-stated unchanged in R46, R47
 * and R48:
 *
 *   If `l4-paired` is significantly negative, OR falls below -5pp with a
 *   served pack, the memory costs accuracy: revert on the reading, not on the
 *   explanation. A plausible story about why a bad pack hurt is not evidence
 *   that the next pack will help.
 *
 * Two readings are easy to confuse, and the confusion is not harmless:
 *
 *   - `l4-paired` (scope `within-run`) is the gate in l4-pair.ts that pairs
 *     the memory arm against the memory-free reference arm INSIDE ONE
 *     DISPATCH. This is the only reading the registered revert rule consumes.
 *   - a cross-run delta (scope `cross-run`) pairs two memory arms from two
 *     dispatches and measures a treatment's contribution. It is NOT a gate
 *     input, and it is NOT what the revert rule grades.
 *
 * An earlier offline R48 verifier bound the rule to the cross-run delta and
 * reported `revert=false` for a reading that fires the rule. AUDIT 34.35
 * records that defect. The discriminated `scope` field makes the wrong binding
 * a compile-time error and a runtime refusal, not a silent misreading.
 *
 * Nothing here reads accuracy to choose, justify or revise a floor. The rule
 * only decides whether a measured arm must be reverted.
 */

/** The significance bar of the `l4-paired` gate. */
export const REVERT_P_BAR = 0.05;

/** A delta strictly below this many percentage points reverts when a pack was served. */
export const REVERT_DELTA_BAR_PP = -5;

/**
 * A paired reading tagged with the population it compares. The tag is part of
 * the type: a caller cannot hand a cross-run contribution to a rule that reads
 * the within-run gate.
 */
export type PairedReading = {
  readonly scope: 'within-run' | 'cross-run';
  /** Percentage-point delta of the second arm minus the first. */
  readonly deltaPp: number;
  /** Exact two-sided p-value of the paired comparison. */
  readonly p: number;
  /** Number of paired tasks behind the reading. */
  readonly paired: number;
};

export type RevertBranch =
  | 'significantly-negative'
  | 'below-bar-with-served-pack'
  | 'clear';

export type RevertVerdict = {
  readonly fires: boolean;
  readonly branch: RevertBranch;
  /** Human-readable justification, citing the branch that fired. */
  readonly reason: string;
};

/**
 * Grade the registered revert rule against one WITHIN-RUN `l4-paired` reading
 * and the number of packs the memory arm actually served.
 *
 * The two branches are independent by design: significance is not required on
 * the below-bar branch, and a served pack is not required on the significant
 * branch. Refuse a cross-run reading, a non-finite or out-of-range value, or a
 * negative served count rather than grading a broken instrument.
 */
export function revertRule(reading: PairedReading, servedPacks: number): RevertVerdict {
  if (reading.scope !== 'within-run') {
    throw new Error('revertRule reads the within-run l4-paired gate; a cross-run delta is not a gate input');
  }
  if (!Number.isFinite(reading.deltaPp)) {
    throw new Error('l4-paired deltaPp must be finite');
  }
  if (!Number.isFinite(reading.p) || reading.p < 0 || reading.p > 1) {
    throw new Error('l4-paired p is out of range: it must lie in [0, 1]');
  }
  if (!Number.isInteger(reading.paired) || reading.paired <= 0) {
    throw new Error('l4-paired must rest on a positive paired count');
  }
  if (!Number.isFinite(servedPacks) || servedPacks < 0) {
    throw new Error('served pack count must be a finite non-negative number');
  }

  if (reading.deltaPp < 0 && reading.p < REVERT_P_BAR) {
    return {
      fires: true,
      branch: 'significantly-negative',
      reason: `l4-paired is significantly negative (${reading.deltaPp.toFixed(2)}pp at p=${reading.p.toFixed(4)}); revert on the reading, not on the explanation`,
    };
  }
  if (servedPacks > 0 && reading.deltaPp < REVERT_DELTA_BAR_PP) {
    return {
      fires: true,
      branch: 'below-bar-with-served-pack',
      reason: `l4-paired ${reading.deltaPp.toFixed(2)}pp is below the ${REVERT_DELTA_BAR_PP}pp bar with ${servedPacks} served packs; significance is not required on this branch; revert on the reading`,
    };
  }
  return {
    fires: false,
    branch: 'clear',
    reason: `l4-paired ${reading.deltaPp.toFixed(2)}pp (p=${reading.p.toFixed(4)}) with ${servedPacks} served packs clears both revert branches`,
  };
}
