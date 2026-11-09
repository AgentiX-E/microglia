/**
 * How many questions would a retry arm have acted on, measured from an artefact and a database.
 *
 * Two published readings in this repository describe a retry effect — `retry-blank` at +0.57pp
 * (2 gained, 0 lost) and `full-onretry` at +1.43pp (5 gained, 0 lost) — and neither has an artefact
 * behind it: `grep -rl retry-blank eval/results/` finds nothing, so the population those gains were
 * divided by is a number in prose. A conditional treatment whose condition was never counted is not
 * a measured mechanism, it is a remembered one.
 *
 * The population is decidable without the answer key and without a model: a first attempt earns a
 * second one when it contained no query, failed, or returned no rows. Two of those three facts are
 * already in every artefact — the baseline SQL, and whether it parsed — and the third needs the
 * database. So this costs zero calls and no dispatch, which is exactly why it is computed before
 * R64 spends anything on measuring the effect itself.
 *
 * The decision is not re-implemented here: it is `retryTriggerFor`, the same function the lane uses
 * to build its retry prompts, so a population counted here and a population acted on there cannot
 * disagree by construction.
 *
 * It reports the population's *composition* as well as its size, because the size alone does not
 * decide anything. The execution that classifies a question as empty is the same execution that
 * knows what the attempt selected, so `classifyEmptyAttempt` runs here at no extra cost: an empty
 * result whose tables match the gold query's is a value or aggregation miss that a second attempt
 * can plausibly repair, and one whose tables do not is a table-selection miss that R63 has already
 * measured as not moving. Two artefacts, one execution.
 *
 * Zero model calls. Run: `pnpm eval:retry-population`
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BoundedSql,
  classifyEmptyAttempt,
  summariseEmptyAttempts,
  summariseRetryPopulation,
  retryTriggerFor,
  type EmptyAttempt,
  type RetryPopulationRow,
} from '@agentix-e/microglia-eval';
import { writeJson } from './lib.js';

const ARTEFACT = process.env['RETRY_ARTEFACT'] ?? join('eval', 'results', 'poc-sota-bird.json');
const ROOT = process.env['BIRD_DIR'] ?? join('eval', 'data', 'dev_20240627');
const FLOOR = Number(process.env['RETRY_FLOOR'] ?? 140);

type Case = {
  readonly id: string;
  readonly dbId: string;
  readonly baselineSql: string;
  /** The query that would have answered the question, which is what an empty attempt is read against. */
  readonly goldSql: string;
  /** The no-memory arm's own verdict, which is what decides whether a repair is available at all. */
  readonly withoutMemoryCorrect: boolean;
};

const artefact = JSON.parse(readFileSync(ARTEFACT, 'utf8')) as {
  readonly id: string;
  readonly config?: { readonly split?: string };
  readonly per_case?: readonly Case[];
};
const cases = artefact.per_case ?? [];
if (cases.length === 0) {
  throw new Error(`${ARTEFACT} carries no per_case records; nothing to count`);
}

function databaseIn(dbId: string): string {
  const path = join(ROOT, 'dev_databases', dbId, `${dbId}.sqlite`);
  if (!existsSync(path)) {
    throw new Error(`BIRD database missing: ${path} (set BIRD_DIR to the extracted archive root)`);
  }
  return path;
}

const statements = new BoundedSql({
  deadlineMs: Number(process.env['SOTA_SQL_DEADLINE_MS'] ?? 20_000),
  rowCap: Number(process.env['SOTA_SQL_ROW_CAP'] ?? 10_000),
});

/**
 * One execution per distinct statement rather than per question.
 *
 * Benchmarks repeat themselves — the same `SELECT ... WHERE ...` is written for questions that
 * differ in their filter value — and this is the kind of cache that turns a 1,534-statement audit
 * into a smaller one for six lines of code. Keys include the database, because a statement is only
 * a statement against the schema it was written for.
 */
const unique = new Map<string, Case>();
for (const item of cases) {
  if (item.baselineSql === '') continue;
  const key = `${item.dbId}\u0000${item.baselineSql}`;
  if (!unique.has(key)) unique.set(key, item);
}

/**
 * The statements are independent, so they are asked in flight rather than one after another.
 *
 * The first version of this bin awaited each statement before starting the next and spent ten
 * minutes on 1,534 queries, which is a measurement nobody re-runs: the guard already holds a pool of
 * workers, and using one of them at a time pays its latency 1,534 times.
 */
const reasonOf = new Map<string, RetryPopulationRow['reason']>();
/** The statements that came back empty, which is the population `classifyEmptyAttempt` describes. */
const emptyKeys = new Set<string>();
const entries = [...unique.entries()];
const CONCURRENCY = Number(process.env['RETRY_CONCURRENCY'] ?? 8);
for (let at = 0; at < entries.length; at += CONCURRENCY) {
  await Promise.all(
    entries.slice(at, at + CONCURRENCY).map(async ([key, item]) => {
      const outcome = await statements.run(databaseIn(item.dbId), item.baselineSql);
      if (outcome.ok && outcome.rows.length === 0) emptyKeys.add(key);
      const queryOutcome = outcome.ok
        ? {
            ok: true,
            tuples: outcome.rows.map((row: Record<string, unknown>) => Object.values(row)),
            canonical: [],
            columns: [],
            error: undefined,
          }
        : { ok: false, tuples: [], canonical: [], columns: [], error: outcome.error ?? 'an error' };
      reasonOf.set(key, retryTriggerFor(item.baselineSql, queryOutcome)?.reason);
    }),
  );
  process.stdout.write(`[retry] executed ${Math.min(at + CONCURRENCY, entries.length)}/${entries.length}\n`);
}
await statements.close();

const rows: RetryPopulationRow[] = cases.map((item) => ({
  // A baseline with no text is the unparseable case, and executing the empty string would report a
  // driver error for something the model never wrote.
  reason: item.baselineSql === '' ? retryTriggerFor(undefined, undefined)?.reason : reasonOf.get(`${item.dbId}\u0000${item.baselineSql}`),
  // The population is about questions that could be retried at all, so a question whose first
  // attempt was *right* is still in the denominator — `wrongAmongRetried` is what separates them,
  // and dropping them here would inflate a repair rate by dividing by the repairable subset.
  correct: item.withoutMemoryCorrect,
}));

const population = summariseRetryPopulation(rows, FLOOR);
process.stdout.write(
  `[retry] ${artefact.id} split=${artefact.config?.split ?? 'unknown'} ` +
    `retried=${population.retried}/${population.asked} (${(population.share * 100).toFixed(2)}%) ` +
    `no-query=${population.byReason['no-query']} error=${population.byReason.error} ` +
    `empty=${population.byReason.empty} repairable=${population.wrongAmongRetried} ` +
    `floor=${population.floor} meets=${population.meetsFloor}\n`,
);

// The composition, from the same execution: every case whose attempt returned nothing, read
// against the query that would have answered it.
const emptyAttempts: EmptyAttempt[] = [];
for (const item of cases) {
  if (item.baselineSql === '') continue;
  if (!emptyKeys.has(`${item.dbId}\u0000${item.baselineSql}`)) continue;
  emptyAttempts.push(classifyEmptyAttempt(item.baselineSql, item.goldSql));
}
const composition = summariseEmptyAttempts(emptyAttempts);
process.stdout.write(
  `[retry] empty-results: examined=${composition.examined} ` +
    `same-tables=${composition.sameTables} (${(composition.shareSameTables * 100).toFixed(2)}%) ` +
    `value-miss=${composition.sameTablesMissingValue} (${(composition.shareMissingValue * 100).toFixed(2)}%) ` +
    `ranking-miss=${composition.goldRanksOnly} ` +
    `missing-table=${composition.byCause['missing-table']} extra-table=${composition.byCause['extra-table']}\n`,
);
await writeJson('poc-empty-result', {
  id: 'poc-empty-result',
  source_artifact: artefact.id,
  source_split: artefact.config?.split ?? null,
  database_root: ROOT,
  composition,
});

await writeJson('poc-retry-population', {
  id: 'poc-retry-population',
  source_artifact: artefact.id,
  source_split: artefact.config?.split ?? null,
  database_root: ROOT,
  population,
});
