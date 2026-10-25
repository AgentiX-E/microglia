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
