/**
 * Whether a verdict survives the correction of the gold it was graded against.
 *
 * Jin, Choi, Zhu and Kang (*Pervasive Annotation Errors Break Text-to-SQL Benchmarks and
 * Leaderboards*, PVLDB 19(5), 2026) put the annotation error rate of **BIRD Mini-Dev at 52.8%**, and
 * re-scoring sixteen published agents against corrected gold moved their relative accuracy by −7% to
 * +31% and their ranks by up to nine places. This repository pinned Mini-Dev at `v1-2024-06-20`, and
 * **151 of the 350 questions in its transfer slice have a different gold query** in the corrected
 * release — 43.1%.
 *
 * Every small effect in this lane has been measured on that slice. R73's whole finding was "four
 * questions moved". A grading instrument with a forty-three-percent disagreement rate cannot settle a
 * four-question claim, and the honest response is not to re-run the experiments but to re-score the
 * artefacts that already exist: `per_case` carries `predictedSql`, `baselineSql` and `dbId`, so both
 * arms can be re-executed against corrected gold with **zero model calls**.
 *
 * This module does the accounting. It knows nothing about SQL and nothing about where correctness
 * comes from — it takes two booleans per arm per question, one under each grading, and reports what a
 * reader needs before believing anything else in the file:
 *  - how many questions changed verdict under the correction, which bounds every claim the run made;
 *  - each arm's accuracy under both gradings, because a correction can lift both arms and leave the
 *    *difference* untouched — which is the only number a memory experiment is about;
 *  - the paired delta under both gradings, so a verdict can be called **stable** (same sign, still
 *    excluding zero), **fragile** (same sign, no longer excluding zero), **reversed** (sign flip) or
 *    **absent** (neither grading separates the arms);
 *  - and that same accounting over the two halves of the population the correction actually produced,
 *    because a delta over the whole of it is a mixture. See `RelabelCase.questionRevised`.
 */

/** One question's two verdicts, for one arm. */
export type GradedPair = {
  /** What the artefact recorded against the gold it was run on. */
  readonly original: boolean;
  /** What the corrected gold says about the same answer. */
  readonly corrected: boolean;
};

/** One question, both arms. */
export type RelabelCase = {
  readonly id: string;
  /** The arm under test — the one whose benefit or harm is the experiment. */
  readonly treatment: GradedPair;
  /** The arm it is compared with. */
  readonly baseline: GradedPair;
  /**
   * Whether the corrected release changed the **question**, not only the label.
   *
   * This is not a detail. The two files disagree about 67 of the 350 questions in the transfer slice,
   * and on 44 of them the question *and* the gold both moved: the corrected file does not answer the
   * question the run was asked, it answers a different one. Grading an answer to question A against
   * the label of question B is not a relabelling, and mixing those rows into a relabelling table
   * attributes a corpus revision to a label correction. Absent means "the file did not say", which is
   * counted as unrevised: a reading written before this field existed has to keep the population it
   * had, and treating unknown as revised would silently empty the clean group.
   */
  readonly questionRevised?: boolean;
};

export type GradedArm = {
  readonly correct: number;
  /** Correct as a proportion of the population, in percentage points. */
  readonly percent: number;
};

export type RelabelArm = { readonly original: GradedArm; readonly corrected: GradedArm };

/** The same accounting, over a subset of the population. */
export type RelabelSubgroup = {
  readonly n: number;
  readonly treatment: RelabelArm;
  readonly baseline: RelabelArm;
  /** Treatment minus baseline, in percentage points, under each grading. */
  readonly delta: { readonly original: number; readonly corrected: number };
};

export type RelabelReading = {
  readonly n: number;
  readonly treatment: { readonly original: GradedArm; readonly corrected: GradedArm };
  readonly baseline: { readonly original: GradedArm; readonly corrected: GradedArm };
  /** Treatment minus baseline, in percentage points, under each grading. */
  readonly delta: { readonly original: number; readonly corrected: number };
  /** Questions whose treatment verdict the correction changed, in each direction. */
  readonly flips: { readonly up: number; readonly down: number };
  /**
   * Questions on which the *pair* changed shape: the verdict about "does memory help here" is not the
   * same under the two gradings.
   *
   * Distinct from `flips`, which counts one arm moving. A question where both arms were wrong and
   * both are now right has two flips and no change to the pair, and a table that reported only the
   * first number would make the correction look more disruptive than it is — or less.
   */
  readonly pairChanged: number;
  /**
   * The population the correction actually relabelled: the question is the one the run was asked, and
   * only its gold moved.
   *
   * This is the number to read. `delta` above is the whole population and it is a mixture of a label
   * correction and a corpus revision.
   */
  readonly unrevised: RelabelSubgroup;
  /** Questions whose text the corrected release also rewrote: a different question, not a new label. */
  readonly revised: RelabelSubgroup;
};

const percent = (count: number, n: number): number => (n === 0 ? 0 : (count / n) * 100);

/** What a delta means once the gold it was measured against has been corrected. */
export type RelabelVerdict = 'stable' | 'fragile' | 'reversed' | 'absent' | 'undecidable';

/**
 * Classify a delta that was significant before the correction.
 *
 * The intervals are the caller's, because the resampling lives in `stats.ts` and this module must not
 * grow a second implementation of it. Passing `null` for either interval is "not computed", which is
 * reported as `undecidable` rather than guessed at — a classifier that treats a missing interval as
 * "includes zero" would silently relabel every run whose interval was skipped.
 */
export function relabelVerdict(
  delta: { readonly original: number; readonly corrected: number },
  interval: {
    readonly original: { readonly low: number; readonly high: number } | null;
    readonly corrected: { readonly low: number; readonly high: number } | null;
  },
): RelabelVerdict {
  if (interval.original === null || interval.corrected === null) return 'undecidable';
  const before = interval.original;
  const after = interval.corrected;
  const excludedBefore = before.low > 0 || before.high < 0;
  const excludedAfter = after.low > 0 || after.high < 0;
  const signBefore = Math.sign(delta.original);
  const signAfter = Math.sign(delta.corrected);
  // A delta of zero has no sign to preserve. Calling it stable would report a null as a replicate,
  // and the interval that accompanies it is not evidence to the contrary: an interval excluding zero
  // around a zero delta is a contradiction in the caller, not a result.
  if (signBefore === 0) return 'absent';
  // **Nothing was established, so nothing can be retracted.** This check has to come before the
  // sign-flip test, and it did not in the first version: a delta of +0.86pp with p = 0.70 that becomes
  // −0.57pp with p = 0.86 was classified `reversed`, which reads as the retraction of a published
  // verdict. There was no published verdict — the original interval straddled zero — and the word
  // would have made a null look like a finding that had been withdrawn. What a flip between two nulls
  // demonstrates is that the *sign* is not recoverable at this population, and that is `absent`.
  // The flip itself is not lost: it is in `flips` and in the two delta lines.
  if (!excludedBefore) return 'absent';
  if (signAfter === 0) return 'fragile';
  if (signAfter !== signBefore) return 'reversed';
  return excludedAfter ? 'stable' : 'fragile';
}

/** The same accounting on a subset, so a mixture can be read as its two parts. */
export function relabelSubgroup(cases: readonly RelabelCase[]): RelabelSubgroup {
  const n = cases.length;
  let treatmentOriginal = 0;
  let treatmentCorrected = 0;
  let baselineOriginal = 0;
  let baselineCorrected = 0;
  for (const item of cases) {
    if (item.treatment.original) treatmentOriginal += 1;
    if (item.treatment.corrected) treatmentCorrected += 1;
    if (item.baseline.original) baselineOriginal += 1;
    if (item.baseline.corrected) baselineCorrected += 1;
  }
  return {
    n,
    treatment: {
      original: { correct: treatmentOriginal, percent: percent(treatmentOriginal, n) },
      corrected: { correct: treatmentCorrected, percent: percent(treatmentCorrected, n) },
    },
    baseline: {
      original: { correct: baselineOriginal, percent: percent(baselineOriginal, n) },
      corrected: { correct: baselineCorrected, percent: percent(baselineCorrected, n) },
    },
    delta: {
      original: percent(treatmentOriginal, n) - percent(baselineOriginal, n),
      corrected: percent(treatmentCorrected, n) - percent(baselineCorrected, n),
    },
  };
}

export function relabelReading(cases: readonly RelabelCase[]): RelabelReading {
  const n = cases.length;
  let up = 0;
  let down = 0;
  let pairChanged = 0;

  for (const item of cases) {
    if (!item.treatment.original && item.treatment.corrected) up += 1;
    if (item.treatment.original && !item.treatment.corrected) down += 1;
    // The pair's shape is what the experiment reports: treatment right and baseline wrong is a gain,
    // and it is the same gain whether both verdicts were reached under the old gold or the new one.
    const before = item.treatment.original === item.baseline.original;
    const after = item.treatment.corrected === item.baseline.corrected;
    const gainedBefore = item.treatment.original && !item.baseline.original;
    const gainedAfter = item.treatment.corrected && !item.baseline.corrected;
    if (before !== after || gainedBefore !== gainedAfter) pairChanged += 1;
  }

  const whole = relabelSubgroup(cases);
  return {
    n,
    treatment: whole.treatment,
    baseline: whole.baseline,
    delta: whole.delta,
    flips: { up, down },
    pairChanged,
    unrevised: relabelSubgroup(cases.filter((item) => item.questionRevised !== true)),
    revised: relabelSubgroup(cases.filter((item) => item.questionRevised === true)),
  };
}
