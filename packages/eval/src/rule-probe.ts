/**
 * Can the extracted experience reproduce the correction it was extracted from?
 *
 * Every memory arm this project has measured is negative or null, and the question that has
 * never been answered is whether the *extraction* is the defect. Ten iterations varied what
 * is stored, how much of it, where it is injected and how it is retrieved; none of them asked
 * the store to demonstrate anything. A distilled rule is a claim that a particular correction
 * generalises, and a claim like that can be tested against its own case: hand the model the
 * failure, the failed attempt and the rules that were derived from it, and see whether the
 * correction comes back.
 *
 * The test needs a control, because a retry alone already repairs some failures — measured at
 * +0.57 to +1.14pp with zero losses across three runs. Without the blank call, a `supplied`
 * count would credit the rules with what a second attempt does by itself. So each source
 * question costs two calls, and the four verdicts are the two-by-two:
 *
 * |                  | retry alone right | retry alone wrong |
 * |------------------|-------------------|-------------------|
 * | with rules right | `redundant`       | `supplied`        |
 * | with rules wrong | `broke`           | `useless`         |
 *
 * Only `supplied` shows the rules doing work, and `broke` is the sharpest available evidence
 * that a rule is wrong rather than merely unhelpful: the question needed no help, and the help
 * is what made it wrong. `redundant` and `useless` are both failures of the extraction for
 * different reasons — the first says the experience was unnecessary, the second that it was
 * insufficient — and they are counted apart because they call for opposite repairs.
 *
 * Two properties make this a measurement rather than a preference. It reads `learn` rows only,
 * so it cannot see the questions it is used to filter the store for, and it is judged by
 * execution against the gold result rather than by a model's opinion of a rule.
 */

export type ProbeVerdict =
  /** The rules turned a failure into the correction. The only verdict that shows work. */
  | 'supplied'
  /** The correction was reachable from the failure alone, so the rules added nothing. */
  | 'redundant'
  /** Without the rules the retry was right, and with them it was wrong. */
  | 'broke'
  /** Neither attempt reached the correction: the experience did not reproduce its own case. */
  | 'useless';

export type ProbeTrial = {
  /** The question the rules were distilled from, which is the case they must reproduce. */
  readonly taskId: string;
  /** The rules that correction produced. */
  readonly itemIds: readonly string[];
  /** `undefined` when either call never returned, which is not a verdict about the rules. */
  readonly verdict: ProbeVerdict | undefined;
};

/**
 * The verdict for one source question, from its two attempts.
 *
 * A call that never returned carries no information about the rules, so it produces no
 * verdict rather than a negative one: counting a provider hiccup as evidence would let a
 * transient error become a finding, and this project's whole claim is that its findings are
 * not that.
 */
export function verdictOf(
  blankCorrect: boolean | undefined,
  withRulesCorrect: boolean | undefined,
): ProbeVerdict | undefined {
  if (blankCorrect === undefined || withRulesCorrect === undefined) return undefined;
  if (withRulesCorrect) return blankCorrect ? 'redundant' : 'supplied';
  return blankCorrect ? 'broke' : 'useless';
}

export type ProbeSummary = {
  /** Source questions the probe planned, one per corrected case. */
  readonly sourceQuestions: number;
  /** Source questions it reached a verdict for. */
  readonly measured: number;
  /** Source questions whose calls did not both return. */
  readonly unmeasured: number;
  readonly supplied: number;
  readonly redundant: number;
  readonly broke: number;
  readonly useless: number;
  /** Rules carried by the trials, which is what `sourceQuestions` does not say. */
  readonly rules: number;
  /**
   * Share of measured questions that the retry alone already repaired.
   *
   * The retry channel's own ceiling on this population, and the number that stops a
   * `supplied` count from being read as the rules' contribution.
   */
  readonly blankFixRate: number;
};

/** Counts over the trials, with every rate defined so an empty probe cannot produce NaN. */
export function probeSummary(trials: readonly ProbeTrial[]): ProbeSummary {
  const count = (verdict: ProbeVerdict): number =>
    trials.filter((trial) => trial.verdict === verdict).length;
  const measured = trials.filter((trial) => trial.verdict !== undefined).length;
  const fixed = count('redundant') + count('broke');
  return {
    sourceQuestions: trials.length,
    measured,
    unmeasured: trials.length - measured,
    supplied: count('supplied'),
    redundant: count('redundant'),
    broke: count('broke'),
    useless: count('useless'),
    rules: trials.reduce((sum, trial) => sum + trial.itemIds.length, 0),
    blankFixRate: measured === 0 ? 0 : fixed / measured,
  };
}

/** A stored claim, reduced to what admission needs: its id and where it came from. */
export type ProbedItem = {
  readonly id: string;
  readonly evidence: readonly { readonly taskId?: string }[];
};

export type Admission = {
  readonly kept: readonly string[];
  /** Rules whose source question the probe never reached a verdict for. */
  readonly noVerifiedSource: number;
  /** Rules that broke at least one of their own cases: excluded whatever else they did. */
  readonly brokeItsSource: number;
  /** Rules the probe did see, and whose cases were all reachable without them. */
  readonly unsupported: number;
};

/**
 * Which rules survive a reproducibility gate, and why the rest did not.
 *
 * Every item falls in exactly one bucket, because the four counts are what distinguish a
 * finding ("the store is mostly unnecessary") from a hole ("the probe never reached these").
 * A rule is kept only when at least one source question reproduced its correction with it and
 * none was broken by it: a claim with one demonstration and one counter-demonstration is not
 * one this project can defend, whatever the average of the two says.
 */
export function admissionOf(
  items: readonly ProbedItem[],
  trials: readonly ProbeTrial[],
): Admission {
  const verdictByTask = new Map<string, ProbeVerdict>();
  for (const trial of trials) {
    if (trial.verdict === undefined) continue;
    verdictByTask.set(trial.taskId, trial.verdict);
  }
  const kept: string[] = [];
  let noVerifiedSource = 0;
  let brokeItsSource = 0;
  let unsupported = 0;
  for (const item of items) {
    const verdicts: ProbeVerdict[] = [];
    for (const ref of item.evidence) {
      if (ref.taskId === undefined) continue;
      const verdict = verdictByTask.get(ref.taskId);
      if (verdict !== undefined) verdicts.push(verdict);
    }
    if (verdicts.length === 0) noVerifiedSource += 1;
    else if (verdicts.includes('broke')) brokeItsSource += 1;
    else if (verdicts.includes('supplied')) kept.push(item.id);
    else unsupported += 1;
  }
  return { kept, noVerifiedSource, brokeItsSource, unsupported };
}

/** The surviving ids, in the order the store listed them. */
export function keptItemIds(items: readonly ProbedItem[], trials: readonly ProbeTrial[]): readonly string[] {
  return admissionOf(items, trials).kept;
}

export type PackCell = {
  /** The question's position in the fold, which is how the lane names it. */
  readonly position: number;
  /** The database, because the swap must stay inside one workspace. */
  readonly db: string;
  /** Items the question's own pack carried. */
  readonly items: number;
};

/**
 * Where a question's pack comes from when its own is taken away.
 *
 * The control that separates "a rule about this question" from "a rule about this database".
 * `wrong-scope` measures the foreign-database case and is inert (−0.29pp), so the model
 * ignores claims whose vocabulary is not in front of it; what no arm has measured is the case
 * where the vocabulary matches and the content does not. If this arm costs what `full` costs,
 * the harm is not the retrieved case at all but the presence of same-workspace advice, and
 * every retrieval-quality explanation in this project's record is wrong.
 *
 * Same size first, so the arm is not also a dosage test — pack size is the one quantity that
 * has moved with accuracy in every previous comparison. Lowest position as the tie-break,
 * because a pick that depends on iteration order would differ between two runs of the same
 * fold.
 */
export function shuffledSource(
  library: readonly PackCell[],
  target: PackCell,
): number | undefined {
  const candidates = library.filter(
    (cell) => cell.db === target.db && cell.position !== target.position,
  );
  if (candidates.length === 0) return undefined;
  const ranked = [...candidates].sort((left, right) => {
    const sizeGap = Math.abs(left.items - target.items) - Math.abs(right.items - target.items);
    return sizeGap === 0 ? left.position - right.position : sizeGap;
  });
  return (ranked[0] as PackCell).position;
}
