/**
 * Does ordering the schema by retrieved gold tables beat ordering it by the question's own words?
 *
 * The one P0 item on the roadmap whose ceiling can be computed for free, and the reason to compute
 * it first: `linked-additive` is built and undispensed, `linked` measured −9.58pp, and the
 * measurement that decides whether either is worth another dispatch costs no model calls at all —
 * it needs the gold queries, which the benchmark ships, and the schema, which is on disk.
 *
 * What it measures is the ordering, not the answer. A signal wins when every table the gold query
 * reads appears before every table it does not, because that is the strongest thing an ordering-only
 * mechanism can achieve; the paired comparison between two signals is an exact McNemar on the
 * questions where they disagree, which is the same instrument the arm comparisons use.
 *
 * The `recalled` signal is lawful: it reads the gold table sets of *training* questions — the other
 * folds of the same cross-fitting the lane runs — and never the gold of the question it is ordering
 * for. `SOTA_RECALL_K` is the neighbour count (five by default): one neighbour is a coin flip on
 * which of two similar questions was drawn, and the union across five is the cheapest way to buy the
 * stability a table set needs.
 *
 * Zero model calls. Run: `pnpm eval:table-recall`
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  anchorTables,
  assignFolds,
  goldIndex,
  orderSchema,
  recalledFor,
  tableRecallOf,
  TABLE_SIGNALS,
  type TableQuestion,
} from '@agentix-e/microglia-eval';
import { schemaBlocks, schemaSql, sqlShapeOf } from '@agentix-e/microglia-sql';
import { writeJson } from './lib.js';

/** Where an extracted `bird-dev.json` archive lives, and where its databases were unpacked. */
const ROOT = process.env['BIRD_DEV_DIR'] ?? join('eval', 'data', 'dev_20240627');
const QUESTIONS = process.env['BIRD_DEV_QUESTIONS'] ?? join(ROOT, 'dev.json');
const K = Number(process.env['SOTA_RECALL_K'] ?? 5);
const FOLDS = Number(process.env['SOTA_FOLDS'] ?? 5);

type Row = {
  readonly question_id: number;
  readonly db_id: string;
  readonly question: string;
  readonly evidence: string;
  readonly SQL: string;
};

function databaseIn(dbId: string): string {
  const path = join(ROOT, 'dev_databases', dbId, `${dbId}.sqlite`);
  if (!existsSync(path)) {
    throw new Error(`BIRD database missing: ${path} (set BIRD_DEV_DIR to the extracted dev archive)`);
  }
  return path;
}

if (!existsSync(QUESTIONS)) {
  throw new Error(`BIRD questions missing: ${QUESTIONS} (set BIRD_DEV_DIR to the extracted dev archive)`);
}

const rows = JSON.parse(readFileSync(QUESTIONS, 'utf8')) as Row[];
const idOf = (row: Row): string => `${row.db_id}#${row.question_id}`;
const foldOf = assignFolds(rows.map(idOf), FOLDS);

// One DDL per database rather than per question: the schema is a property of the database, and
// reading it 1,534 times is the kind of quiet quadratic that makes a free measurement slow enough
// that nobody runs it again.
const ddlOf = new Map<string, string>();
const tablesOf = new Map<string, readonly string[]>();
for (const dbId of new Set(rows.map((row) => row.db_id))) {
  const ddl = schemaSql(databaseIn(dbId));
  ddlOf.set(dbId, ddl);
  tablesOf.set(dbId, schemaBlocks(ddl).map((block) => block.table));
}

/**
 * Every gold query's table set, parsed once.
 *
 * The five folds each read four fifths of the split, so parsing per (fold, row) would run the parser
 * six thousand times for fifteen hundred distinct statements.
 */
const goldOf = new Map<string, readonly string[]>();
const goldTables = (row: Row): readonly string[] => {
  const hit = goldOf.get(idOf(row));
  if (hit !== undefined) return hit;
  const tables = sqlShapeOf(row.SQL).tables;
  goldOf.set(idOf(row), tables);
  return tables;
};

const asked: TableQuestion[] = [];
let singleTable = 0;
let fired = 0;
let movedTotal = 0;
let retrieved = 0;
for (let fold = 0; fold < FOLDS; fold += 1) {
  // The index is built from the row's own fold complement, exactly as `runFold` builds it, and the
  // signal is composed from the same three functions the arm calls. A measurement that composed them
  // differently from the arm would be a description of a mechanism nobody dispatches.
  const index = goldIndex(
    rows
      .filter((row) => foldOf.get(idOf(row)) !== fold)
      .map((row) => ({ db: row.db_id, question: row.question, gold: goldTables(row) })),
  );
  // Filled at the row's own position rather than pushed, so the paired vector stays in the order the
  // split was read. A bootstrap over a permuted vector returns a different interval for the same
  // data — 10.63 vs 10.30 on the lower bound here — and a measurement whose interval moves when
  // nothing moved is a measurement nobody can compare against itself.
  for (const [at, row] of rows.entries()) {
    if (foldOf.get(idOf(row)) !== fold) continue;
    const ddl = ddlOf.get(row.db_id) ?? '';
    const tables = tablesOf.get(row.db_id) ?? [];
    // A one-table schema has one possible ordering, so counting it would let a signal that does
    // nothing look like a signal that works.
    if (tables.length <= 1) singleTable += 1;
    const anchors = anchorTables(ddl, row.question, row.evidence).anchors;
    const recalled = recalledFor(index, row.db_id, row.question, K);
    const ordered = orderSchema(ddl, [...recalled, ...anchors], 'retrieved');
    // Whether the arm's prompt differs from the unannotated one, which is the quantity the channel
    // floor gates on at dispatch. Measured here so a dispatch's `recall-order at least 1%` has a
    // predicted value rather than an alarm.
    if (ordered.reason === 'ordered') {
      fired += 1;
      movedTotal += ordered.moved.length;
    }
    // Questions where retrieval contributed a table at all. This is the share the dispatch's
    // `ordering.retrieved_share` is compared against, so it has to be a measured prior rather than a
    // threshold chosen after the run.
    if (recalled.length > 0) retrieved += 1;
    asked[at] = { tables, gold: goldTables(row), anchors, recalled };
  }
}

const reading = tableRecallOf(asked);

const asTable = (): string => {
  const lines = [
    `[table-recall] n=${reading.n} (single-table ${singleTable}, unscoreable ${reading.unscoreable}) k=${K} ` +
      `fired=${fired}/${rows.length} (${((fired / rows.length) * 100).toFixed(2)}%) ` +
      `moved=${(movedTotal / Math.max(1, fired)).toFixed(2)}/question ` +
      `retrieved=${retrieved}/${rows.length} (${((retrieved / rows.length) * 100).toFixed(2)}%)`,
    '| signal | clean | share | mean depth | precision | recall |',
    '| --- | --- | --- | --- | --- | --- |',
  ];
  for (const signal of TABLE_SIGNALS) {
    const summary = reading.signals[signal];
    lines.push(
      `| ${signal} | ${summary.clean} | ${(summary.cleanShare * 100).toFixed(2)}% | `
        + `${(summary.meanDepthShare * 100).toFixed(2)}% | `
        + `${(summary.precision * 100).toFixed(2)}% | ${(summary.recall * 100).toFixed(2)}% |`,
    );
  }
  return `${lines.join('\n')}\n`;
};

process.stdout.write(asTable());
for (const [label, result] of [
  ['both vs anchors', reading.bothVersusAnchors],
  ['recalled vs anchors', reading.recalledVersusAnchors],
] as const) {
  process.stdout.write(
    `[table-recall] ${label}: +${result.gained}/-${result.lost} `
      + `delta=${(result.delta * 100).toFixed(2)}pp `
      + `ci=[${(result.deltaCI.low * 100).toFixed(2)}, ${(result.deltaCI.high * 100).toFixed(2)}] `
      + `p=${result.p.toFixed(4)}\n`,
  );
}

await writeJson('poc-table-recall', {
  id: 'poc-table-recall',
  split: 'dev',
  questions: rows.length,
  single_table: singleTable,
  recall_k: K,
  folds: FOLDS,
  prompts_changed: fired,
  prompts_changed_share: Number((fired / rows.length).toFixed(4)),
  mean_tables_moved: Number((movedTotal / Math.max(1, fired)).toFixed(2)),
  retrieved: retrieved,
  retrieved_share: Number((retrieved / rows.length).toFixed(4)),
  n: reading.n,
  unscoreable: reading.unscoreable,
  degenerate: reading.degenerate,
  signals: reading.signals,
  both_versus_anchors: reading.bothVersusAnchors,
  recalled_versus_anchors: reading.recalledVersusAnchors,
  model_calls: 0,
  note: 'An ordering signal is not an accuracy delta: a clean ordering is the ceiling an ordering-only mechanism can reach, and whether a model reads a reordered schema at all is a question only a dispatch answers.',
});
