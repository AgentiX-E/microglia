/**
 * A model asked whether a query answers a question, with no gold query in sight.
 *
 * The design constraint is the whole design. Execution accuracy is cheap and wrong in a
 * measurable way: on ROSE-VEC's 322 adjudicated predictions it calls 129 correct queries
 * wrong under this repository's multiset reading and 87 under set semantics, because it
 * compares rows rather than meaning. A judge is worth its cost only if it answers the
 * question the metric cannot — so it must not be handed the gold query, or it would
 * answer by comparison, which is the metric again with a markup.
 *
 * What it is handed: the question, the external knowledge the benchmark supplies, the
 * columns the query returned, and a sample of the rows. That is what a reviewer reading
 * a query result would see. It is explicitly *not* handed the schema, because a 40-table
 * DDL is mostly tokens spent on tables the question does not mention, and the prediction's
 * own column names already say which ones it used.
 *
 * `UNKNOWN` is a first-class answer. A judge forced to choose between correct and
 * incorrect on a query that returned nothing will guess, and a guess counted as a verdict
 * is how a criterion acquires a kappa it did not earn. An unknown verdict is dropped from
 * the agreement and reported as its own count.
 */
import type { JudgedPair } from './agreement.js';

/** Bumped whenever the wording changes, because a kappa without a prompt version is a rumour. */
export const JUDGE_PROMPT_VERSION = 'judge-prompt/1';

export type JudgeInput = {
  readonly question: string;
  /** BIRD's external knowledge, when the benchmark supplies it. */
  readonly evidence: string | undefined;
  readonly sql: string;
  /** Column names the query returned, in select-list order. */
  readonly columns: readonly string[];
  /** A few rows as canonical JSON strings, or empty when the query returned none. */
  readonly sample: readonly string[];
  /** Why the query could not run, when it could not. */
  readonly executionError: string | undefined;
};

export type JudgeVerdict = {
  /** `undefined` when the reply did not state a verdict this module can trust. */
  readonly correct: boolean | undefined;
  readonly rationale: string;
  /** Which of the three outcomes the reply stated, for counting. */
  readonly stated: 'correct' | 'incorrect' | 'unknown' | 'unparsed';
};

const MAX_SAMPLE_ROWS = 5;
const MAX_SAMPLE_CHARS = 600;

/**
 * The instruction, and the reason each clause is in it.
 *
 * "Judge the question, not the query's style" is there because the failure this replaces
 * is a style judgement: a query that returns the right numbers with a different alias
 * fails execution accuracy, and a judge told to check agreement with a reference would
 * fail it too. "Say unknown when the result is empty and the question implies rows" is
 * there because an empty result is ambiguous between a correct filter and a wrong join,
 * and the only honest reading is that the evidence cannot decide.
 */
export function buildJudgePrompt(input: JudgeInput): string {
  const evidence = input.evidence === undefined || input.evidence.trim() === '' ? '(none)' : input.evidence.trim();
  const columns = input.columns.length === 0 ? '(no columns: the query did not run)' : input.columns.join(', ');
  const rows =
    input.executionError !== undefined
      ? `(the query failed: ${input.executionError})`
      : input.sample.length === 0
        ? '(the query returned no rows)'
        : truncate(input.sample.slice(0, MAX_SAMPLE_ROWS).join('\n'), MAX_SAMPLE_CHARS);
  return [
    'You are reviewing one SQL query written in answer to a question about a database.',
    'Decide whether the query answers the question. Judge the question, not the style of',
    'the query: a different alias, a different join order, or a different but equivalent',
    'formulation is still correct. Do not assume there is a reference query, and do not',
    'ask for one; decide from the question, the knowledge supplied, and the result shown.',
    '',
    'Answer in exactly two lines:',
    'VERDICT: CORRECT | INCORRECT | UNKNOWN',
    'REASON: one sentence',
    '',
    'Use UNKNOWN when the result shown cannot decide the question — for example the query',
    'returned no rows and the question does not imply an empty answer, or the query failed',
    'in a way that hides what it would have returned.',
    '',
    `QUESTION: ${input.question.trim()}`,
    `KNOWLEDGE: ${evidence}`,
    'SQL:',
    input.sql.trim(),
    `RETURNED COLUMNS: ${columns}`,
    'RETURNED ROWS:',
    rows,
  ].join('\n');
}

function truncate(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}...`;
}

const VERDICT = /^\s*VERDICT\s*:\s*(CORRECT|INCORRECT|UNKNOWN)\s*$/im;
const REASON = /^\s*REASON\s*:\s*(.+)$/im;

/**
 * Read the reply, and refuse to invent one.
 *
 * A reply with no parseable verdict is `unparsed`, not incorrect. Counting it as
 * incorrect would make a model that rambles score like a model that reasons, and would
 * hide the failure mode behind the number the lane reports.
 */
export function parseJudgeReply(text: string): JudgeVerdict {
  const stated = VERDICT.exec(text)?.[1]?.toUpperCase();
  const rationale = REASON.exec(text)?.[1]?.trim() ?? '';
  if (stated === 'CORRECT') return { correct: true, rationale, stated: 'correct' };
  if (stated === 'INCORRECT') return { correct: false, rationale, stated: 'incorrect' };
  if (stated === 'UNKNOWN') return { correct: undefined, rationale, stated: 'unknown' };
  return { correct: undefined, rationale: rationale === '' ? text.trim().slice(0, 200) : rationale, stated: 'unparsed' };
}

/**
 * The rows the judge saw, from the rows the query returned.
 *
 * Reuses the canonical encoding so the sample is the same text the execution criterion
 * compares — if the two disagreed about what a row looks like, a difference between the
 * judge and the metric could be an artefact of formatting rather than of judgement.
 */
export function sampleRows(canonical: readonly string[], limit = MAX_SAMPLE_ROWS): readonly string[] {
  return canonical.slice(0, limit);
}

/**
 * Pair the judge's verdicts with the committee's labels.
 *
 * Unstated verdicts are counted, not silently dropped: a criterion that answers two
 * thirds of the items and agrees perfectly on those is not a criterion that agrees
 * perfectly, and the share it answered belongs beside its kappa.
 */
export function judgePairs(
  rows: readonly { readonly questionId: string; readonly label: boolean }[],
  verdicts: ReadonlyMap<string, JudgeVerdict>,
): { readonly pairs: readonly JudgedPair[]; readonly unstated: readonly string[]; readonly unparsed: readonly string[] } {
  const pairs: JudgedPair[] = [];
  const unstated: string[] = [];
  const unparsed: string[] = [];
  for (const row of rows) {
    const verdict = verdicts.get(row.questionId);
    if (verdict === undefined || verdict.correct === undefined) {
      unstated.push(row.questionId);
      if (verdict?.stated === 'unparsed') unparsed.push(row.questionId);
      continue;
    }
    pairs.push({ reference: row.label, measured: verdict.correct });
  }
  return { pairs, unstated, unparsed };
}

/**
 * The adversarial half of the cascade, which is the half the first run proved is needed.
 *
 * A Prover shown only the question and the result approved 82% of 322 items against a
 * committee that approved 67%: it reads plausibility, and a wrong query with the right
 * shape reads plausibly. The Refuter is given what the Prover was deliberately denied —
 * the gold query — and told to treat it as *evidence that may be wrong*, not as the
 * answer. Its job is to find the decisive difference, or to say that the gold is the
 * thing that is wrong. That framing is what separates this from execution accuracy: the
 * reference can lose the argument.
 *
 * It runs only on the items the Prover approved, for two reasons: a rejected query needs
 * no second opinion, and the cost is then proportional to how permissive the Prover is.
 */
export const REFUTER_PROMPT_VERSION = 'refuter-prompt/1';

export type RefuterInput = {
  readonly question: string;
  readonly evidence: string | undefined;
  readonly sql: string;
  readonly columns: readonly string[];
  readonly sample: readonly string[];
  readonly goldSql: string;
  readonly goldColumns: readonly string[];
  readonly goldSample: readonly string[];
};

export type RefuterDiagnosis = 'none' | 'gold-error' | 'ambiguous' | 'coincidental';

export type RefuterVerdict = {
  /** `true` when the Prover's approval is overturned. `undefined` when the reply was unclear. */
  readonly overturned: boolean | undefined;
  readonly diagnosis: RefuterDiagnosis;
  readonly rationale: string;
  readonly stated: 'uphold' | 'overturn' | 'unparsed';
};

export function buildRefuterPrompt(input: RefuterInput): string {
  const evidence = input.evidence === undefined || input.evidence.trim() === '' ? '(none)' : input.evidence.trim();
  const predictedRows =
    input.sample.length === 0 ? '(no rows)' : truncate(input.sample.slice(0, MAX_SAMPLE_ROWS).join('\n'), MAX_SAMPLE_CHARS);
  const goldRows =
    input.goldSample.length === 0
      ? '(no rows)'
      : truncate(input.goldSample.slice(0, MAX_SAMPLE_ROWS).join('\n'), MAX_SAMPLE_CHARS);
  return [
    'A first reviewer judged the SQL below CORRECT. Your job is to try to overturn that.',
    '',
    'You are given a reference query. It is EVIDENCE, NOT A STANDARD ANSWER: it was written',
    'by a person and it can itself be wrong, incomplete, or one of several valid readings of',
    'an ambiguous question. Do not overturn the query merely because it differs from the',
    'reference. Overturn it only when you can name a difference that changes the answer to',
    'the question as asked.',
    '',
    'Answer in exactly three lines:',
    'VERDICT: UPHOLD | OVERTURN',
    'DIAGNOSIS: NONE | GOLD_ERROR | AMBIGUOUS | COINCIDENTAL',
    'REASON: one sentence',
    '',
    'Use DIAGNOSIS: GOLD_ERROR when the reference is the wrong one. Use AMBIGUOUS when both',
    'readings answer the question and the question does not settle which was meant. Use',
    'COINCIDENTAL when the two queries differ in logic but happen to return the same rows',
    'here, so the agreement does not show the query is right. Use NONE when you uphold.',
    '',
    `QUESTION: ${input.question.trim()}`,
    `KNOWLEDGE: ${evidence}`,
    'QUERY UNDER REVIEW:',
    input.sql.trim(),
    `ITS COLUMNS: ${input.columns.length === 0 ? '(none)' : input.columns.join(', ')}`,
    'ITS ROWS:',
    predictedRows,
    'REFERENCE QUERY (evidence, possibly wrong):',
    input.goldSql.trim(),
    `ITS COLUMNS: ${input.goldColumns.length === 0 ? '(none)' : input.goldColumns.join(', ')}`,
    'ITS ROWS:',
    goldRows,
  ].join('\n');
}

const REFUTER_VERDICT = /^\s*VERDICT\s*:\s*(UPHOLD|OVERTURN)\s*$/im;
const DIAGNOSIS = /^\s*DIAGNOSIS\s*:\s*(NONE|GOLD_ERROR|AMBIGUOUS|COINCIDENTAL)\s*$/im;

/**
 * Read the refuter's reply.
 *
 * A reply without a verdict is `unparsed` and its `overturned` is `undefined`, which the
 * cascade keeps as an approval: an unclear objection is not an objection, and letting a
 * parsing failure change a verdict would make the prompt's wording a scoring parameter.
 */
export function parseRefuterReply(text: string): RefuterVerdict {
  const stated = REFUTER_VERDICT.exec(text)?.[1]?.toUpperCase();
  const diagnosis = (DIAGNOSIS.exec(text)?.[1]?.toUpperCase() ?? 'NONE').toLowerCase().replace('_', '-') as RefuterDiagnosis;
  const rationale = REASON.exec(text)?.[1]?.trim() ?? text.trim().slice(0, 200);
  if (stated === 'UPHOLD') return { overturned: false, diagnosis, rationale, stated: 'uphold' };
  if (stated === 'OVERTURN') return { overturned: true, diagnosis, rationale, stated: 'overturn' };
  return { overturned: undefined, diagnosis, rationale, stated: 'unparsed' };
}

/**
 * The ROSE cascade, as arithmetic.
 *
 * A query is credited only if the Prover approved it *and* the Refuter failed to overturn
 * that approval. A Prover rejection is final — the refuter is not asked about a query the
 * first reviewer already refused — and an unclear refutation leaves the approval standing.
 */
export function cascadeVerdict(prover: JudgeVerdict, refuter: RefuterVerdict | undefined): boolean | undefined {
  if (prover.correct === undefined) return undefined;
  if (!prover.correct) return false;
  if (refuter === undefined) return true;
  if (refuter.overturned === undefined) return true;
  return !refuter.overturned;
}

/**
 * The evidenced cascade, defined once so both lanes that use it mean the same thing.
 *
 * A `GOLD_ERROR` overturn is accepted only when execution can tell the two queries apart.
 * The rule is not "trust the refuter" and not "trust the reference": it is that a claim
 * about the reference being wrong needs something in the pair for it to be wrong *about*,
 * and equal rows are not that thing. Equal rows do not prove equivalence — 3 of 132
 * row-identical items in ROSE-VEC were still rejected by the committee — but they are
 * consistent with it, so they cannot carry an accusation either.
 *
 * Expressed as a veto inside a criterion rather than as a post-filter, because a filter
 * applied to finished verdicts can be forgotten by the next caller.
 */
export function evidencedVerdict(
  prover: JudgeVerdict,
  refuter: RefuterVerdict | undefined,
  rowsDiffer: boolean,
): boolean | undefined {
  // The veto is applied to the refuter's reply, not to the cascade's output: written the
  // other way round it never fires, because by then the approval has already been refused
  // and there is nothing left to restore. The test that caught this asserted the one case
  // where the two orderings differ.
  if (refuter?.overturned === true && refuter.diagnosis === 'gold-error' && !rowsDiffer) {
    return cascadeVerdict(prover, { ...refuter, overturned: false });
  }
  return cascadeVerdict(prover, refuter);
}
