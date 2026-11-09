/**
 * Why an answer came back empty.
 *
 * The retry arms' population was measured at 26 of 350 questions on `minidev` and 98 of 1,534 on
 * `dev`, and almost all of it is one bucket: the statement ran and returned nothing. So the
 * question "is a retry worth building" is really the question "what does an empty result mean", and
 * that is decidable for free — the gold query is in the benchmark and the attempt is in the
 * artefact.
 *
 * Three readings are possible and they call for three different mechanisms:
 *
 * - **the tables are right.** The model found the data and got the values, the filter or the
 *   aggregation wrong. Nothing about schema linking helps here; this is what a value-aware memory
 *   is for, and it is also the one bucket a second attempt can plausibly repair by re-reading the
 *   question.
 * - **the tables are wrong.** The attempt reads something the gold does not, or misses something it
 *   needs. A retry that only re-reads the question will not find a table the question never named;
 *   this is the bucket retrieval is for, and R63 has already measured that bucket as not moving.
 * - **a gold literal is absent.** The attempt filtered on a value the database does not spell that
 *   way — the classic empty result — and the repair is a value lookup rather than a schema change.
 *
 * That split is what turns "retry the failures" into a hypothesis with a mechanism behind it.
 * Without it, a retry arm that repairs ten questions says nothing about which of the three it
 * repaired, and the next iteration is a guess.
 */
import { sqlShapeOf } from '@agentix-e/microglia-sql';

/**
 * Where an empty attempt's tables stand relative to the gold query's.
 *
 * Three cases and no fourth: two different table sets always differ in one of two ways, so a
 * catch-all would be a branch that cannot be reached and therefore cannot be tested. `missing`
 * wins over `extra` when both hold, because a table the gold needs and the attempt never read is
 * the fact a repair has to act on.
 */
export type EmptyCause = 'same-tables' | 'missing-table' | 'extra-table';

export type EmptyAttempt = {
  readonly cause: EmptyCause;
  /** Values the gold query writes and the attempt does not: a value the attempt spelled differently. */
  readonly goldValuesAbsent: number;
  /** Values the attempt invents and the gold does not use. */
  readonly attemptValuesExtra: number;
  /** Whether the gold ranks or limits rows the attempt did not, which is a phrasing miss. */
  readonly goldRanksOnly: boolean;
};

/**
 * One empty attempt against the query that would have answered the question.
 *
 * Table comparison is set equality, because a join order is not a mistake. `missing-table` and
 * `extra-table` are kept apart rather than collapsed into "wrong", because a retry that adds a
 * table and a retry that stops reading one are different edits and only one of them is a
 * relaxation.
 */
export function classifyEmptyAttempt(attempt: string, gold: string): EmptyAttempt {
  const a = sqlShapeOf(attempt);
  const g = sqlShapeOf(gold);
  const attempts = new Set(a.tables);
  const golds = new Set(g.tables);
  const same = attempts.size === golds.size && [...attempts].every((table) => golds.has(table));
  const missing = [...golds].some((table) => !attempts.has(table));
  // Values, not string literals: BIRD writes years and ids as bare numbers, and a classifier that
  // read only quoted strings would call `year = 2015` against `year = 2014` a match.
  const valuesOf = (shape: { readonly literals: readonly string[]; readonly numbers: readonly string[] }): Set<string> =>
    new Set([...shape.literals, ...shape.numbers]);
  const attemptLiterals = valuesOf(a);
  const goldLiterals = valuesOf(g);
  const ranks = (shape: readonly string[]): boolean =>
    shape.includes('order') || shape.includes('limit');
  return {
    cause: same ? 'same-tables' : missing ? 'missing-table' : 'extra-table',
    goldValuesAbsent: [...goldLiterals].filter((literal) => !attemptLiterals.has(literal)).length,
    attemptValuesExtra: [...attemptLiterals].filter((literal) => !goldLiterals.has(literal)).length,
    goldRanksOnly: ranks(g.clauses) && !ranks(a.clauses),
  };
}

export type EmptySummary = {
  readonly examined: number;
  readonly byCause: Readonly<Record<EmptyCause, number>>;
  /** Empty attempts that read exactly the gold tables: the bucket a value-aware memory can repair. */
  readonly sameTables: number;
  readonly shareSameTables: number;
  /** Same-tables attempts that are also missing a gold literal: the value-spelling bucket. */
  readonly sameTablesMissingValue: number;
  readonly shareMissingValue: number;
  readonly goldRanksOnly: number;
};

/**
 * The population, described rather than counted.
 *
 * `shareMissingValue` divides by `examined` rather than by `sameTables`, because the number that
 * matters for a decision is how much of the retry population a value-aware repair could reach — and
 * a share of a subset would match the prose this module exists to replace.
 */
export function summariseEmptyAttempts(attempts: readonly EmptyAttempt[]): EmptySummary {
  const byCause: Record<EmptyCause, number> = { 'same-tables': 0, 'missing-table': 0, 'extra-table': 0 };
  let sameTables = 0;
  let sameTablesMissingValue = 0;
  let goldRanksOnly = 0;
  for (const attempt of attempts) {
    byCause[attempt.cause] += 1;
    if (attempt.goldRanksOnly) goldRanksOnly += 1;
    if (attempt.cause !== 'same-tables') continue;
    sameTables += 1;
    if (attempt.goldValuesAbsent > 0) sameTablesMissingValue += 1;
  }
  const examined = attempts.length;
  // A share of nothing is zero rather than `NaN`: an empty population is a fact about a dispatch,
  // and a field that poisons every downstream average is not.
  const share = (count: number): number => (examined === 0 ? 0 : Number((count / examined).toFixed(4)));
  return {
    examined,
    byCause,
    sameTables,
    shareSameTables: share(sameTables),
    sameTablesMissingValue,
    shareMissingValue: share(sameTablesMissingValue),
    goldRanksOnly,
  };
}
