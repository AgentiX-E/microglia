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
 *
 * That is why it was run second, and the order is now a result: agreement was measured at +0.00pp
 * on 350 questions while the best of the same three draws was +5.43pp [3.14, 8.00], so the ceiling
 * was there and agreement retrieved none of it. `selectByModel` is the next rung, measured against
 * `selectByConsistency` on identical draws — the extra call it costs is the only thing that differs.
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
  /** A model read the candidates and named one. */
  | 'model'
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

/**
 * The prompt that asks a model to read the candidates and pick one.
 *
 * This is the selector MCS-SQL measures (+2.1pp over value samples at twenty draws) and that
 * CHASE-SQL's selection agent measures (+4.2pp over self-consistency). It is here because the
 * consistency selector was run first and caught none of the ceiling: a five-point gap between what
 * the draws contained and what agreement retrieved is not a gap that agreement can close, since
 * agreement is blind to which candidate is right when all of them are distinct.
 *
 * The task prompt is passed through verbatim rather than re-described, so the selector sees exactly
 * the schema and evidence the generator saw. Anything else would make a win ambiguous: it could be
 * the choice, or it could be a second, better-worded statement of the same question.
 */
export function choicePrompt(task: string, queries: readonly string[]): string {
  const blocks = queries.map((query, index) => `[${index + 1}]\n${query}`);
  return (
    `${task}\n\n` +
    `${queries.length} candidate ${queries.length === 1 ? 'query was' : 'queries were'} written ` +
    `for the task above. Exactly one of them is the most likely to answer the question correctly.\n\n` +
    `${blocks.join('\n\n')}\n\n` +
    'Reply with the number of the most likely correct query inside <choice></choice> and nothing else.'
  );
}

/**
 * What a candidate returned, as text a selector can read.
 *
 * Five rows and a truncation marker, because the question this answers is "does this query return
 * the kind of thing the question asked for", and five rows answer it while five hundred cost tokens
 * without adding a distinction. Strings are cut at sixty characters for the same reason.
 *
 * A failed query is not `0 rows`. They are the two most confusable outcomes in this lane — a wrong
 * join returns nothing and a broken query returns nothing — and a selection prompt that renders
 * both as an empty result teaches the reader that empty is common. `NULL` is spelled out for the
 * same reason: `null` and the four-letter string are different values and look the same otherwise.
 */
export function renderRows(ok: boolean, tuples: readonly (readonly unknown[])[]): string {
  if (!ok) return 'the query did not run';
  if (tuples.length === 0) return '0 rows';
  const cell = (value: unknown): string => {
    if (value === null) return 'NULL';
    const text = String(value);
    return text.length > 60 ? `${text.slice(0, 60)}…` : text;
  };
  const shown = tuples.slice(0, 5).map((row) => `(${row.map(cell).join(', ')})`);
  const rest = tuples.length - shown.length;
  const head = `${tuples.length} row${tuples.length === 1 ? '' : 's'}: `;
  return rest > 0 ? `${head}${shown.join(' ')} … ${rest} more` : `${head}${shown.join(' ')}`;
}

/** One candidate, as the result-reading selector sees it. */
export type CandidateWithResult = {
  readonly sql: string;
  /** Output of `renderRows`. */
  readonly result: string;
};

/**
 * The same question as `choicePrompt`, with the one thing the previous selector could not see.
 *
 * Iteration 93 measured a multiple-choice selector over SQL text at chance — 18 of 82 questions
 * where a choice existed, against 18 for taking the first draw and 35 for the best of the three. The
 * candidates were indistinguishable *as text*, which is what the arm could not check: two queries
 * that differ in one join condition read as two plausible queries.
 *
 * What a deployed system does at that point is run them. Every draw is executed anyway — that is
 * how agreement is computed — so showing the rows costs nothing that has not already been paid and
 * adds the only evidence that separates a candidate returning three surnames from one returning
 * two thousand rows.
 *
 * It is not the answer key: the rows are the candidate's own output, and a wrong query returns
 * wrong rows the selector has to judge. What it is not, either, is free at inference time: N
 * candidates means N executions, which this lane already performs.
 */
export function choicePromptWithResults(
  task: string,
  candidates: readonly CandidateWithResult[],
): string {
  const blocks = candidates.map(
    (candidate, index) => `[${index + 1}]\n${candidate.sql}\n-> ${candidate.result}`,
  );
  return (
    `${task}\n\n` +
    `${candidates.length} candidate ${candidates.length === 1 ? 'query was' : 'queries were'} ` +
    `written for the task above. Each is shown with what the database returns when it runs. ` +
    `Exactly one is the most likely to answer the question correctly.\n\n` +
    `${blocks.join('\n\n')}\n\n` +
    'Reply with the number of the most likely correct query inside <choice></choice> and nothing else.'
  );
}

/**
 * The candidate a reply names, or `undefined` when it names none.
 *
 * The tag is read first because a model that explains itself writes numbers in the explanation:
 * "among these 3 candidates, [1] joins the wrong table" contains a 1, a 3 and a 1, and only one of
 * them is the choice. A bare number is accepted as a fallback because a terse reply is a valid one,
 * and out-of-range numbers are refused rather than clamped — clamping turns "I chose 4 of 3" into a
 * silent vote for the last candidate, which is a measurement artefact dressed as a selection.
 */
export function parseChoice(text: string, count: number): number | undefined {
  if (count <= 0) return undefined;
  const tagged = /<choice>\s*(\d+)\s*<\/choice>/i.exec(text);
  const raw = tagged === null ? /\b(\d+)\b/.exec(text) : tagged;
  if (raw === null) return undefined;
  const number = Number(raw[1]);
  if (!Number.isInteger(number) || number < 1 || number > count) return undefined;
  return number - 1;
}

/**
 * The selection a model made, with the fallback the arm needs to stay scoreable.
 *
 * `chosen === undefined` means the reply did not name a candidate. The arm then takes the first
 * draw, which is what `sample-N-first` already scores, so the questions the selector failed on land
 * on the control's answer rather than leaving the arm with a different, easier population. The
 * count of these is reported separately: a model selector that answers nothing is a `first` arm
 * with an invoice.
 */
export function selectByModel(count: number, chosen: number | undefined): Selection {
  if (count <= 0) {
    return { chosen: 0, votes: 0, groups: 0, reason: 'empty', emptyResult: false };
  }
  if (chosen === undefined || chosen < 0 || chosen >= count) {
    return { chosen: 0, votes: 1, groups: 0, reason: 'no-agreement', emptyResult: false };
  }
  return { chosen, votes: 1, groups: 0, reason: 'model', emptyResult: false };
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
