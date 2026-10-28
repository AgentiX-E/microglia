/**
 * Picking one query out of several.
 *
 * Every system above 70% on the text-to-SQL leaderboards generates more than one candidate and
 * then chooses: CHASE-SQL samples and uses a selection model, XiYan-SQL samples and votes, and the
 * self-consistency literature reports the gain as coming from the *agreement*, not from the extra
 * draws. This project has only ever used one draw, so the whole selection axis has been absent from
 * every measurement it made — a memory arm and a no-memory arm were both single-sample, and the
 * difference between them could not be separated from the difference between two draws.
 *
 * The selector here is the cheapest one that the literature reports working, and deliberately not a
 * model: candidates whose results agree are grouped, and the largest group wins. That makes it
 * measurable against two controls that share the same draws, so the three effects can be separated:
 *
 *   `pick-first`  − `none`        what a non-zero temperature costs or buys on its own
 *   `pick-random` − `pick-first`  what having alternatives buys before anyone chooses
 *   `majority`    − `pick-random` what the selector itself buys
 *
 * A model-based selector would confound the third line with the second, because it needs the
 * candidates to exist before it can be wrong.
 */

/**
 * One candidate, as much as selection needs to know about it.
 *
 * `signature` is the identity of the result, not of the query: two different queries that return
 * the same rows agree about the answer, and that agreement is the signal. It is `undefined` when the
 * query did not run, which is not the same as agreeing on the empty set — a query that fails has
 * said nothing about the answer, and counting two failures as a vote is how a selector learns to
 * prefer broken SQL.
 */
export type Candidate = {
  readonly signature: string | undefined;
  readonly rows: number;
};

export type SelectionReason =
  /** A group of at least two candidates agreed. */
  | 'majority'
  /** Every candidate was distinct, so nothing was learned and the first draw was taken. */
  | 'no-agreement'
  /** Nothing ran, so the first draw was taken. */
  | 'nothing-ran'
  /** No candidates at all: the caller asked for a selection it did not supply. */
  | 'empty';

export type Selection = {
  /** Index into the input. */
  readonly chosen: number;
  /** Members of the winning group; 1 when the reason is not `majority`. */
  readonly votes: number;
  /** Distinct result identities among the candidates that ran. */
  readonly groups: number;
  readonly reason: SelectionReason;
  /**
   * Whether the winning group is the empty result.
   *
   * Carried because a wrong join commonly returns nothing, so an implementation that groups empty
   * results together can amplify exactly the failure it was meant to average out. A run that
   * selects an empty group often is a run whose selector needs a non-empty bias, and that is a
   * number, not an opinion.
   */
  readonly emptyResult: boolean;
};

/**
 * The result identity of a query outcome.
 *
 * Rows are compared as a multiset: the same rows in a different order are the same answer, and a
 * duplicated row is a different answer from one copy of it. Column names are not part of the
 * identity — the question asks for a value, and two candidates that compute it under different
 * aliases have agreed.
 */
export function signatureOf(outcome: {
  readonly ok: boolean;
  readonly tuples: readonly (readonly unknown[])[];
}): string | undefined {
  if (!outcome.ok) return undefined;
  const rows = outcome.tuples.map((row) => JSON.stringify(row)).sort();
  return rows.join('\u0001');
}

/**
 * The largest agreeing group, ties broken by the earliest candidate.
 *
 * Ties go to the earliest rather than to a random member so that the same candidates always produce
 * the same choice: a selector whose output moves between two identical runs cannot be measured
 * against a control, and this lane has already spent one iteration on a noise floor it could not
 * attribute.
 */
export function selectByConsistency(candidates: readonly Candidate[]): Selection {
  if (candidates.length === 0) {
    return { chosen: 0, votes: 0, groups: 0, reason: 'empty', emptyResult: false };
  }
  const groups = new Map<string, number[]>();
  for (const [index, candidate] of candidates.entries()) {
    if (candidate.signature === undefined) continue;
    const members = groups.get(candidate.signature);
    if (members === undefined) groups.set(candidate.signature, [index]);
    else members.push(index);
  }
  if (groups.size === 0) {
    return { chosen: 0, votes: 1, groups: 0, reason: 'nothing-ran', emptyResult: false };
  }
  let best: number[] = [];
  let bestKey = '';
  for (const [key, members] of groups) {
    if (members.length > best.length) {
      best = members;
      bestKey = key;
    }
  }
  if (best.length < 2) {
    // The first draw that *ran*, not the first draw. A candidate that failed is not a worse
    // answer, it is an absent one, and falling back to index 0 would let one broken sample hide a
    // working one behind it — the arm would report a loss the selector never made.
    // `groups.size > 0` here, so some candidate ran and the index is found: no fallback branch,
    // because an unreachable branch is a claim that cannot be tested.
    const firstThatRan = candidates.findIndex((candidate) => candidate.signature !== undefined);
    return {
      chosen: firstThatRan,
      votes: 1,
      groups: groups.size,
      reason: 'no-agreement',
      emptyResult: false,
    };
  }
  const chosen = best[0] as number;
  return {
    chosen,
    votes: best.length,
    groups: groups.size,
    reason: 'majority',
    emptyResult: bestKey === '',
  };
}

/**
 * A uniformly random candidate, from the caller's seed.
 *
 * The control the selector has to beat. Having several candidates can help for reasons that have
 * nothing to do with judging them — a finite sample of a distribution contains a better draw than
 * its first element more often than not — and only this arm separates the two.
 */
export function selectRandom(candidates: readonly Candidate[], random: () => number): Selection {
  if (candidates.length === 0) {
    return { chosen: 0, votes: 0, groups: 0, reason: 'empty', emptyResult: false };
  }
  const chosen = Math.min(candidates.length - 1, Math.floor(random() * candidates.length));
  return { chosen, votes: 1, groups: 0, reason: 'no-agreement', emptyResult: false };
}

/**
 * The first draw, which is what a single-sample pipeline already had.
 *
 * Named rather than implied so that the artefact can say which arm differs from `none` only in its
 * temperature.
 */
export function selectFirst(candidates: readonly Candidate[]): Selection {
  return {
    chosen: 0,
    votes: candidates.length === 0 ? 0 : 1,
    groups: 0,
    reason: candidates.length === 0 ? 'empty' : 'no-agreement',
    emptyResult: false,
  };
}

/** How the selectors behaved across a run, which is what makes a gain attributable. */
export type SelectionStats = {
  readonly questions: number;
  /** Questions where a group of two or more agreed. */
  readonly agreed: number;
  /** Questions whose winning group was the empty result. */
  readonly choseEmpty: number;
  /** Mean size of the winning group, over every question. */
  readonly meanVotes: number;
  /** Questions where no candidate ran. */
  readonly nothingRan: number;
};

export function selectionStats(selections: readonly Selection[]): SelectionStats {
  if (selections.length === 0) {
    return { questions: 0, agreed: 0, choseEmpty: 0, meanVotes: 0, nothingRan: 0 };
  }
  const agreed = selections.filter((item) => item.reason === 'majority').length;
  const choseEmpty = selections.filter((item) => item.emptyResult).length;
  const nothingRan = selections.filter((item) => item.reason === 'nothing-ran').length;
  const votes = selections.reduce((sum, item) => sum + item.votes, 0);
  return {
    questions: selections.length,
    agreed,
    choseEmpty,
    meanVotes: votes / selections.length,
    nothingRan,
  };
}
