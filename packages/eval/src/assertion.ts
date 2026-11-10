/**
 * The *written* reader: assertions authored once per question, executed per candidate by arithmetic.
 *
 * R71 priced the free half of CHESS's selection step and found it inert — `column-mention` 0.514 and
 * `literal-match` 0.509, with `literal-match` constant across the draws on 342 of 350 questions. The
 * diagnosis was not that the signals were weak but that they were **not per-question facts**: a
 * property every draw of a question shares cannot order that question's draws. What CHESS buys with
 * its writer is exactly that property — the assertions are written *for this question against these
 * results*, so they differ from question to question even when the question's words do not.
 *
 * This module is the half that can be tested without a model: the grammar the writer is held to, the
 * arithmetic that scores a candidate against it, and the reading that puts both on the same
 * question-clustered axis as every other selector in this project. The writer itself is one call per
 * question and lives in the lane; everything it produces is checked here, in code, so the model is
 * never trusted to grade its own work.
 *
 * The grammar is three kinds and nothing else, because every kind has to be *executable*:
 *
 * - `column:<name>` — the result must carry a column with this name.
 * - `value:<literal>` — the query must write this literal.
 * - `rows:<n>` — the result must have exactly this many rows.
 *
 * There is deliberately no `rows:>5` and no `column:some|other`. A comparison operator is a second
 * grammar, and a disjunction is a third; a writer that can say anything can say something no
 * arithmetic can refute, and a selector that cannot be refuted is not a measurement.
 */

import { aucReading, type AucReading, type PoolCandidate, type PoolQuestion } from './pool.js';

/** The three assertion kinds a writer may emit, in the order the scorer reports them. */
export const ASSERTION_KINDS = ['column', 'value', 'rows'] as const;

export type AssertionKind = (typeof ASSERTION_KINDS)[number];

/** The signals this module reads: the three kinds separately, and the selection rule that combines them. */
export const ASSERTION_SIGNALS = [
  'assertion-column',
  'assertion-value',
  'assertion-rows',
  'assertion-hits',
] as const;

export type AssertionSignalName = (typeof ASSERTION_SIGNALS)[number];

export type Assertions = {
  readonly columns: readonly string[];
  readonly values: readonly string[];
  readonly rows: readonly number[];
};

/**
 * How many assertions of one kind a question may hold.
 *
 * Three, and the cap is a decision rather than a parser limit. The scorer counts satisfied
 * assertions, so a writer that emits twenty statements about one question would outvote a writer that
 * emits three — and the twenty would not be more informative, they would be a model restating the
 * schema. The registration asks for three per question; this makes the request binding.
 */
export const MAX_ASSERTIONS_PER_KIND = 3;

/** The empty assertion set, which is what a question with no writer produces. */
export const NO_ASSERTIONS: Assertions = { columns: [], values: [], rows: [] };

/** Whether a set says anything at all: a question whose writer produced nothing is not in the population. */
export function assertAnything(assertions: Assertions): boolean {
  return assertions.columns.length + assertions.values.length + assertions.rows.length > 0;
}

/**
 * Trim the decoration a model puts around a bare token: list markers, backticks, and one layer of
 * quotes on either side.
 *
 * Nothing more inventive than that. A parser that strips SQL identifiers down to their stem would
 * match assertions the writer did not make, and every match it invented would be counted as
 * agreement.
 */
function bare(value: string): string {
  let text = value.trim();
  text = text.replace(/^[-*+]\s+/, '');
  text = text.replace(/^`+|`+$/g, '');
  text = text.trim();
  if (text.length >= 2) {
    const first = text[0];
    const last = text[text.length - 1];
    if ((first === "'" && last === "'") || (first === '"' && last === '"')) {
      text = text.slice(1, -1).trim();
    }
  }
  return text;
}

/**
 * Parse a writer's reply into executable assertions.
 *
 * Tolerant in one direction only: a line that is not one of the three kinds is dropped, because a
 * model asked for three lines of grammar will sometimes open with a sentence of prose and refusing the
 * whole reply over a preamble would make the arm a measurement of obedience. It is not tolerant of a
 * malformed *value*: `rows:several` is dropped rather than read as zero, since a row count of zero is
 * an assertion the writer never made and one that every one-row candidate would fail.
 */
export function parseAssertions(raw: string): Assertions {
  const columns: string[] = [];
  const values: string[] = [];
  const rows: number[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const match = /^\s*(?:[-*+]\s+)?(column|value|rows)\s*:\s*(.+?)\s*$/i.exec(line);
    if (match === null) continue;
    const kind = (match[1] as string).toLowerCase() as AssertionKind;
    const text = bare(match[2] as string);
    if (text === '') continue;
    if (kind === 'column') {
      if (columns.length < MAX_ASSERTIONS_PER_KIND && !columns.includes(text)) columns.push(text);
      continue;
    }
    if (kind === 'value') {
      if (values.length < MAX_ASSERTIONS_PER_KIND && !values.includes(text)) values.push(text);
      continue;
    }
    if (!/^-?\d+$/.test(text)) continue;
    const count = Number(text);
    if (rows.length < MAX_ASSERTIONS_PER_KIND && !rows.includes(count)) rows.push(count);
  }
  return { columns, values, rows };
}

/** Lowercase alphanumeric tokens, the only normalisation a column name and an assertion share. */
function tokensOf(text: string): readonly string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token !== '');
}

/**
 * Whether a candidate's result carries a column the assertion names.
 *
 * Token containment in both directions on the plural, which is the compromise the content signals
 * already made and for the same reason: `player` and `players` are one column to a reader, and a
 * substring rule would make `id` match `player_id` on every candidate in the corpus and score them
 * all equally.
 */
function columnSatisfied(assertion: string, columns: readonly string[]): boolean {
  const wanted = tokensOf(assertion);
  if (wanted.length === 0) return false;
  const have = new Set(columns.flatMap((column) => tokensOf(column)));
  // Four forms, and they are one rule: the plural of an English noun. `county`/`counties` needed the
  // third form the first version of this function did not have, and a test written against the
  // corpus's own column names is what found it. Nothing stems further than this — a rule that
  // stripped identifiers to a root would match assertions the writer did not make.
  return wanted.every(
    (token) =>
      have.has(token) ||
      have.has(`${token}s`) ||
      have.has(token.replace(/s$/, '')) ||
      have.has(token.replace(/y$/, 'ies')),
  );
}

/** Whether the query writes the literal, case-insensitively, and only when it recorded a query. */
function valueSatisfied(assertion: string, sql: string | undefined): boolean {
  if (typeof sql !== 'string' || sql === '') return false;
  return sql.toLowerCase().includes(assertion.toLowerCase());
}

/** Whether the result's row count is the asserted one. A candidate that returned nothing asserts nothing. */
function rowsSatisfied(assertion: number, rows: number | null | undefined): boolean {
  return typeof rows === 'number' && rows === assertion;
}

/**
 * How many of one kind's assertions a candidate satisfies.
 *
 * Separate from the combined score because the three kinds are not interchangeable and the
 * registration's whole point is to find out which one carries the signal. A combined number alone
 * would report that the writer helps or does not, and would be unable to say which sentence did it.
 */
export function assertionHitsOf(
  candidate: PoolCandidate,
  assertions: Assertions,
  kind: AssertionKind,
): number {
  const columns = candidate.columns ?? [];
  const sql = candidate.sql;
  // `rowCount` and not `rows`: the signature is `{rows: …}` nowhere, and the optional-chain version
  // of this line would have read `undefined` for every candidate in the corpus and scored the row
  // assertion as unsatisfiable everywhere — an arm that reports "the writer does not help" because
  // its arithmetic never ran.
  const rows = candidate.signature?.rowCount ?? null;
  if (kind === 'column') {
    return assertions.columns.filter((assertion) => columnSatisfied(assertion, columns)).length;
  }
  if (kind === 'value') {
    return assertions.values.filter((assertion) => valueSatisfied(assertion, sql)).length;
  }
  return assertions.rows.filter((assertion) => rowsSatisfied(assertion, rows)).length;
}

/**
 * The selector's score: every assertion the candidate satisfies, of every kind.
 *
 * No weighting. A column assertion and a row assertion are worth the same because the writer was
 * asked for both and this project has no evidence that one predicts the answer better; inventing a
 * weight would be reporting a number that nothing measured. If one kind turns out to be the useful
 * one, it will show in its own reading and the next registration can weight by it.
 */
export function assertionScoreOf(candidate: PoolCandidate, assertions: Assertions): number {
  let hits = 0;
  for (const kind of ASSERTION_KINDS) hits += assertionHitsOf(candidate, assertions, kind);
  return hits;
}

/** One signal's score for one candidate, by name: the three kinds, or their sum. */
export function assertionSignalOf(
  candidate: PoolCandidate,
  assertions: Assertions,
  signal: AssertionSignalName,
): number {
  if (signal === 'assertion-column') return assertionHitsOf(candidate, assertions, 'column');
  if (signal === 'assertion-value') return assertionHitsOf(candidate, assertions, 'value');
  if (signal === 'assertion-rows') return assertionHitsOf(candidate, assertions, 'rows');
  return assertionScoreOf(candidate, assertions);
}

/** A question whose writer produced something: the population an assertion reading is defined on. */
export type AssertedQuestion = PoolQuestion & { readonly assertions?: Assertions };

function asserted(questions: readonly AssertedQuestion[]): readonly (AssertedQuestion & {
  readonly assertions: Assertions;
})[] {
  return questions.filter(
    (question): question is AssertedQuestion & { readonly assertions: Assertions } =>
      question.assertions !== undefined && assertAnything(question.assertions),
  );
}

/**
 * Every assertion signal, read on the same axis as every other selector in this project.
 *
 * The population is the questions a writer actually wrote for, and it is narrowed in a way a caller
 * can see: a run that wrote assertions for half its questions would otherwise report an AUC over a
 * biased half and read as a reading of the whole. When nothing was written the result is empty, which
 * is the honest answer and distinguishable from "the signals were at chance".
 *
 * The tie rule is the pool's own: strictly greater, so a tie keeps the earlier draw. An assertion set
 * that every candidate satisfies equally ranks nothing, and a selector that ranks nothing must return
 * the first draw rather than the last — otherwise an inert writer would report "take the last draw"
 * as its accuracy.
 */
export function assertionReadings(
  questions: readonly AssertedQuestion[],
  options: { readonly resamples?: number; readonly seed?: number } = {},
): readonly AucReading<AssertionSignalName>[] {
  const complete = asserted(questions);
  if (complete.length === 0) return [];
  return ASSERTION_SIGNALS.map((signal) =>
    aucReading(
      complete,
      signal,
      (candidate, question) => assertionSignalOf(candidate, question.assertions, signal),
      options,
    ),
  );
}

/** Questions a writer produced assertions for: the population `assertionReadings` reads. */
export function assertionPopulation(questions: readonly AssertedQuestion[]): number {
  return asserted(questions).length;
}
