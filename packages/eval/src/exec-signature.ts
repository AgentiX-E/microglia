/**
 * What a candidate's execution looks like, and what the question asked it to look like.
 *
 * Three separate systems converged on the same idea and none of them shipped it as a prompt:
 * XiYan-SQL groups candidates by their execution result before ranking them (and its selection
 * model is worth −2.74 EX when removed); R³-SQL does the same grouping and adds a resampling
 * judge; GradeSQL trains an outcome reward model on execution labels and beats execution-based
 * Best-of-N by up to +4.33 on BIRD. This project tried the fourth thing — asking a model to
 * compare two result sets — and measured −1.14pp. The difference is not the idea of using
 * execution, it is that a model comparing result sets has no ground to stand on, while a shape
 * comparison does.
 *
 * This module is the ground floor of that comparison, and it is deliberately **not a scorer yet**.
 * Each signal is computed alone, returns zero when it has nothing to say, and is measured
 * separately before any of them is allowed to rank anything. The previous eleven iterations all
 * shipped a composite and measured the composite; when it came out negative, nothing in the result
 * said which part was wrong. A signal that cannot be evaluated alone cannot be blamed alone.
 *
 * Every signal here satisfies three constraints, because a feature that violates any of them turns
 * the measurement into a reading of the feature's own assumptions:
 *
 *  - **It never reads the answer.** No gold SQL, no gold result, no field the scorer uses. A
 *    verifier that peeks is a leak with extra steps, and BIRD's dev split is small enough that a
 *    leak would show up as a spectacular number.
 *  - **It is deterministic.** Same rows in, same score out, no model call, no sampling. The
 *    reranking in R2 was stochastic and its three dispatches disagreed by 1.4pp.
 *  - **It abstains.** Zero means "this signal has no opinion here", not "neutral evidence". The
 *    two are different, and conflating them is how a coin flip acquires a confidence interval.
 */

/** The shape of one candidate's execution. */
export type ExecOutcome = {
  /** Rows the candidate returned, in the column order it returned them. */
  readonly rows: readonly (readonly unknown[])[];
  readonly columns: readonly string[];
  /** True when the statement did not run, or ran and errored. */
  readonly failed: boolean;
};

export type ExecSignature = {
  readonly failed: boolean;
  readonly empty: boolean;
  readonly rowCount: number;
  readonly columnCount: number;
  /** Share of cells that are null; zero when there are no cells. */
  readonly nullShare: number;
  /** Share of rows that repeat an earlier row; zero when there are no rows. */
  readonly duplicateShare: number;
  /** True when every non-null cell is a number, and there is at least one. */
  readonly numericOnly: boolean;
  /** One row, one column: the shape a count, a sum or an average has. */
  readonly scalar: boolean;
};

/** What the question asked for, in the only terms a signature can be compared against. */
export type QuestionShape = {
  readonly wantsMany: boolean;
  readonly wantsCount: boolean;
  readonly wantsAverage: boolean;
  /** The question asks for what is absent, which an empty result satisfies. */
  readonly wantsMissing: boolean;
  /** The question asks for distinct values, which makes a repeated row legitimate. */
  readonly wantsDistinct: boolean;
};

export const SIGNALS = [
  'empty',
  'row-shape',
  'column-shape',
  'null-share',
  'duplicate-share',
  'value-type',
] as const;

export type SignalName = (typeof SIGNALS)[number];

/**
 * The signature of a statement that did not run.
 *
 * Exported because three modules need the same answer to "what shape does a failure have": the
 * signature of the result, the tie-break in the pool's signal readings, and the composite's vote.
 * Three copies of this literal is three chances for one of them to drift into reporting a shape for
 * something that has none.
 */
export const FAILED_SIGNATURE: ExecSignature = Object.freeze({
  failed: true,
  empty: true,
  rowCount: 0,
  columnCount: 0,
  nullShare: 0,
  duplicateShare: 0,
  numericOnly: false,
  scalar: false,
});

export function execSignatureOf(outcome: ExecOutcome): ExecSignature {
  if (outcome.failed) {
    // A statement that did not run has no shape. Reporting the shape of an empty result for it
    // would let a syntax error be scored as "wrong but plausible" rather than as "not an answer".
    return FAILED_SIGNATURE;
  }
  const rowCount = outcome.rows.length;
  const columnCount = outcome.columns.length;
  const cells = rowCount * columnCount;
  let nulls = 0;
  let nonNull = 0;
  let numeric = 0;
  for (const row of outcome.rows) {
    for (const cell of row) {
      if (cell === null) {
        nulls += 1;
        continue;
      }
      nonNull += 1;
      if (typeof cell === 'number' || typeof cell === 'bigint') numeric += 1;
    }
  }
  const seen = new Set<string>();
  let repeats = 0;
  for (const row of outcome.rows) {
    // `JSON.stringify` throws on a bigint and folds `1` and `'1'` into the same key, so the row
    // key is built from the cell's type as well as its text. Two rows that differ only in type are
    // two different answers in this schema, and a duplicate count that merges them would report a
    // grain error on a correct query.
    const key = row.map((cell) => rowKeyOf(cell)).join('\u0001');
    if (seen.has(key)) repeats += 1;
    else seen.add(key);
  }
  return {
    failed: false,
    empty: rowCount === 0,
    rowCount,
    columnCount,
    // Shares of nothing are zero, not NaN: a NaN would propagate into a total and rank every empty
    // result above every non-empty one.
    nullShare: cells === 0 ? 0 : nulls / cells,
    duplicateShare: rowCount === 0 ? 0 : repeats / rowCount,
    numericOnly: nonNull > 0 && numeric === nonNull,
    scalar: rowCount === 1 && columnCount === 1,
  };
}

function rowKeyOf(cell: unknown): string {
  if (cell === null) return '\u0000null';
  if (typeof cell === 'bigint') return `bigint:${cell.toString()}`;
  return `${typeof cell}:${String(cell)}`;
}

const PLURAL = /\b(each|every|list|all|per|top\s+\d+|bottom\s+\d+)\b/i;
const COUNT = /\b(how many|number of|count)\b/i;
const AVERAGE = /\b(average|mean|ratio|percentage|percent|proportion|share)\b/i;
const MISSING = /\b(no|not|none|never|without|missing|absent)\b/i;
const DISTINCT = /\b(distinct|unique)\b/i;

/**
 * The question's shape, read from the question and its evidence.
 *
 * BIRD's evidence carries half the intent in the questions that ship one: "the ratio is measured
 * against the total number of accounts" decides the answer's shape without the question saying
 * so. Reading both is not a courtesy to the corpus, it is what keeps the signals from firing on a
 * question whose shape only the evidence states.
 *
 * Matching is by whole word. `discount` and `account` both contain `count`, and a count signal
 * that fires on them would down-rank every correct answer about either.
 */
export function shapeOf(question: string, evidence: string): QuestionShape {
  const text = `${question} ${evidence}`;
  return {
    wantsMany: PLURAL.test(text),
    wantsCount: COUNT.test(text),
    wantsAverage: AVERAGE.test(text),
    wantsMissing: MISSING.test(text),
    wantsDistinct: DISTINCT.test(text),
  };
}

/**
 * One signal's opinion about one candidate, in a unit only comparable within the signal.
 *
 * The scale is ordinal and the magnitudes are placeholders: they encode "this is a stronger
 * objection than that", not a probability. Turning them into a ranking before measuring them
 * separately would be the same mistake as the last eleven iterations, with better documentation.
 */
export function scoreOf(
  signature: ExecSignature,
  shape: QuestionShape,
  signal: SignalName | string,
): number {
  if (signature.failed) {
    // The floor on every signal, so a candidate that did not run cannot win a tie against one that
    // did. Sign convention: negative is a penalty, and the penalties add.
    return -1;
  }
  if (signature.empty) {
    if (signal === 'null-share' || signal === 'duplicate-share') {
      // No cells, no nulls, no rows, no repeats. These two signals abstain rather than testify.
      return 0;
    }
    return shape.wantsMissing ? 0 : -2;
  }
  switch (signal) {
    case 'empty':
      // Non-empty, so the emptiness signal has nothing to say either way.
      return 0;
    case 'row-shape':
      // A list question answered with one cell, or a count answered with a table. The second is
      // weaker evidence than the first: "how many" is sometimes answered with a breakdown.
      if (shape.wantsMany && signature.scalar) return -1.5;
      if (shape.wantsCount && !signature.scalar) return -0.5;
      return 0;
    case 'column-shape':
      if (shape.wantsCount && signature.columnCount > 1) return -1;
      return 0;
    case 'null-share':
      return signature.nullShare >= 0.5 ? -signature.nullShare : 0;
    case 'duplicate-share':
      // A repeated row is a grain error unless the question asked for distinct values, in which
      // case the repetition is in the data rather than in the query.
      if (shape.wantsDistinct) return 0;
      return signature.duplicateShare > 0 ? -signature.duplicateShare : 0;
    case 'value-type':
      // An average, a ratio and a percentage are numbers. Text where one of those was asked for is
      // a different query, whatever it executes to.
      if (shape.wantsAverage && !signature.numericOnly) return -1;
      return 0;
    default:
      // An arm that names a signal this module does not have is a zero, not a crash in the middle
      // of a paid run.
      return 0;
  }
}
