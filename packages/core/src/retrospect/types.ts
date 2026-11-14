/**
 * Consolidating corrections into guidelines — the adjudication half.
 *
 * Three published results bound this design, and each of them refuses a different
 * obvious implementation:
 *
 *  1. **ALTK-Evolve** (IBM, 2026-10) merges guidelines by cosine similarity and records
 *     `support` = the number of sources merged into one, conserved across consolidation.
 *     Its airline arm is the argument for the operation: 14 guidelines at support >= 3
 *     reach 45.0 Pass^4 where 101 lossless ones reach 40.0. Fewer, wider units beat more,
 *     narrower ones *when the merge conserves what it absorbed*.
 *
 *  2. **ACE** (Zhang et al., 2025) names the failure mode of the naive version —
 *     `brevity bias` and `context collapse`. An LLM asked to rewrite a growing context
 *     into a tidy summary drops the specific facts first; measured over cycles, a working
 *     context shrank 18,282 → 122 tokens with a 9.6-point accuracy drop. So "summarise
 *     these corrections into guidelines" is not the operation. Merging without rewriting
 *     is, which is why nothing here paraphrases a source's text: the guideline is a new
 *     object whose *coverage* of the old ones is checked rather than asserted.
 *
 *  3. **This project's own R99** read a 73-record store at 62.5% against 15 records at
 *     70.0%, and the provenance explained it: 58 of the 73 were pass records carrying the
 *     `order_id` of the run that produced them. More memory lost because more of it was
 *     about one instance. A guideline is exactly the object that drops the instance — so
 *     the consolidation must be allowed to read repairs, and must be able to *prove* it
 *     did not launder an instance id into a rule.
 *
 * The consequence is that this module contains no model call and no scoring. It answers
 * one question per candidate — *does this guideline actually cover the corrections it
 * claims, and what else would it now apply to* — and it answers it deterministically so
 * that the answer is reproducible in a review console, in a test, and in a re-run.
 */
/**
 * One correction as the consolidator sees it.
 *
 * `outcome` is carried rather than inferred because it decides what the source is *for*:
 * a repair may become a guideline, a pass may only contradict one. R99's store was 79%
 * pass records and the rule below is that finding written as a type.
 */
export type RetrospectSource = {
  readonly id: string;
  readonly statement: string;
  /** The condition the correction was recorded under. Absent means the distiller named none. */
  readonly when?: string;
  readonly task: string;
  /** Distinct-task identity, which is the unit ALTK calls `support`. */
  readonly taskId: string;
  readonly outcome: 'repair' | 'pass';
  readonly confidence: number;
  readonly at: number;
};

/**
 * A proposed guideline, before anything has been checked about it.
 *
 * `covers` is the proposer's *claim*, and the whole point of the witness step is that the
 * claim is not evidence. A proposer that overstates coverage produces a guideline whose
 * support is fiction; AWM's workflows and ExpeL's insights are both published without a
 * coverage check, and neither reports what a wrong claim would have cost.
 */
export type GuidelineProposal = {
  readonly id: string;
  readonly statement: string;
  readonly when: string;
  readonly covers: readonly string[];
  readonly rationale?: string;
};

export type WitnessVerdict =
  /** Every content word of the guideline's trigger appears in the source's: the rule is wider. */
  | 'entailed'
  /** The guideline names nothing at all, so it applies everywhere. Covered, and flagged. */
  | 'unconditional'
  /** Half or more of the trigger's content words appear: plausibly the same situation. */
  | 'partial'
  /** Below half: the source is not an instance of this guideline. */
  | 'unwitnessed';

export type WitnessFinding = {
  readonly sourceId: string;
  readonly verdict: WitnessVerdict;
  /** Share of the guideline's trigger words the source's trigger accounts for. */
  readonly overlap: number;
};

/** A source the guideline would also apply to that the proposer did not claim. */
export type CollateralFinding = {
  readonly sourceId: string;
  readonly verdict: WitnessVerdict;
  readonly outcome: 'repair' | 'pass';
};

export type WitnessReport = {
  readonly guidelineId: string;
  readonly findings: readonly WitnessFinding[];
  readonly covered: number;
  readonly unwitnessed: number;
  /** Sources outside `covers` whose trigger the guideline now also matches. */
  readonly collateral: readonly CollateralFinding[];
  /** Distinct tasks behind the covered sources — the conserved `support`. */
  readonly distinctTasks: number;
  /**
   * Covered sources whose negation polarity differs from the guideline's.
   *
   * The one merge error that inverts a rule's meaning rather than widening it: "always
   * confirm before writing" and "never confirm before writing" share every content word.
   */
  readonly polarityConflicts: readonly string[];
  /** True when the guideline would apply to at least one source it was not derived from. */
  readonly unconditional: boolean;
};

export type Admissibility =
  /** Ready for a reviewer: coverage is witnessed and bounded. */
  | 'reviewable'
  /** Fewer distinct sources than the policy requires: a re-typing, not a compression. */
  | 'restatement'
  /** Some claimed source is not covered: the claim is unsupported. */
  | 'unwitnessed'
  /** Wider than the policy allows: the rule would fire on evidence it never saw. */
  | 'over-general'
  /** A covered source says the opposite. */
  | 'polarity'
  /** The trigger is absent or names nothing, which is a rule that applies everywhere. */
  | 'unconditional';
