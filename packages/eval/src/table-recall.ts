/**
 * How far down the schema a reader has to go before seeing every table the gold query reads.
 *
 * The additive linker (`annotateSchema`) never removes a table: it moves the ones the question
 * names to the front and says how many it moved. That makes it safe — it cannot reproduce the
 * `linked` arm's −9.58pp, whose mechanism was 202 questions losing the table they needed — and it
 * also makes it possible that it does nothing, because a prompt whose tables are the same fifteen
 * blocks in a different order may be a prompt a model reads exactly as before.
 *
 * The decision this module exists to make is therefore **not** "does the arm help": that costs
 * money. It is "does the ordering signal move the tables that matter to the front", which costs
 * nothing but the benchmark's own gold queries and was never computed before the arm was built.
 * The rule it enforces is the one `error_budget` states for mechanisms: a ceiling is computed
 * before the mechanism is paid for.
 *
 * Two signals are compared, and the comparison is paired on the same question:
 *
 *  - `anchors` — the tables the question or its evidence names lexically. This is what the arm
 *    shipped in `linked-additive`, and it is the incumbent.
 *  - `recalled` — the union of the gold table sets of the *training* questions most similar to this
 *    one. A training question's gold tables are supervision the benchmark gives away, and a table
 *    that two similar questions both read is evidence the question text does not carry on its own
 *    (the join table nobody names is the canonical case).
 *  - `both` — recalled first, then anchors, then the rest.
 *
 * The endpoint is `clean`: every gold table precedes every non-gold table. That is the strongest
 * thing an ordering-only signal can achieve, and it is a boolean, so the comparison between two
 * signals is an exact McNemar test on the questions where they disagree — the same instrument the
 * arm comparisons use, applied to a quantity that costs no tokens.
 */
import { similarityOf, tokensOf } from './admission.js';
import { comparePaired, type PairedResult } from './stats.js';

/** The three orderings under comparison. `both` is the union, not a fourth mechanism. */
export type TableSignal = 'anchors' | 'recalled' | 'both';

export const TABLE_SIGNALS: readonly TableSignal[] = ['anchors', 'recalled', 'both'];

/** One question, as the measurement needs it: the schema it sees and the tables its answer reads. */
export type TableQuestion = {
  /** Every table in the DDL, in declaration order. */
  readonly tables: readonly string[];
  /** The tables the gold query reads, in any order. Filtered to the ones the DDL holds. */
  readonly gold: readonly string[];
  /** The tables the question or its evidence names. */
  readonly anchors: readonly string[];
  /** The union of the gold tables of the nearest training questions. */
  readonly recalled: readonly string[];
};

/** What one signal achieved on one question. */
export type TableOrdering = {
  readonly signal: TableSignal;
  /** Tables in the DDL. */
  readonly tables: number;
  /** Gold tables the DDL holds. Zero means the question is not scoreable. */
  readonly gold: number;
  /** 1-based position of the last gold table in the ordering; 0 when there is no gold table. */
  readonly depth: number;
  /** Every gold table precedes every non-gold one, which is the best an ordering can do. */
  readonly clean: boolean;
  /** Tables the signal moved to the front. */
  readonly named: number;
  /** Of those, how many the gold query actually reads. */
  readonly hits: number;
};

/**
 * The key two names are compared on.
 *
 * SQLite resolves identifiers case-insensitively, and BIRD's dumps rely on it: `postHistory` is
 * declared and `posthistory` is queried, in 298 of the dev split's 1,534 questions. A case-sensitive
 * measurement read every one of those as "the gold table is not in the schema", which is not an
 * ordering failure and would have made the ceiling look 19 points worse than it is.
 */
function keyOf(name: string): string {
  return name.toLowerCase();
}

/** The tables a signal puts in front, in the order it puts them there. */
export function namedBy(signal: TableSignal, question: TableQuestion): readonly string[] {
  const present = new Set(question.tables.map(keyOf));
  const allowed = (table: string): boolean => present.has(keyOf(table));
  const anchors = question.anchors.filter(allowed);
  const recalled = question.recalled.filter(allowed);
  if (signal === 'anchors') return unique(anchors);
  if (signal === 'recalled') return unique(recalled);
  // Recall first: a table two similar questions read is evidence the question text did not carry,
  // while an anchor is a token match that the incumbent already tries.
  return unique([...recalled, ...anchors]);
}

/**
 * The full ordering: the signal's tables in the signal's own priority, then the rest as declared.
 *
 * The named group is ordered by the signal, not by declaration. That is a deliberate departure
 * from `annotateSchema`, which keeps declaration order inside the named group: under declaration
 * order a recall signal can only *add* tables ahead of the first non-gold one and never demote an
 * anchor, so a better signal is structurally unable to do better and a null from it would be a
 * null about the ordering rather than about the evidence. The change this implies for the arm is
 * one line and costs nothing, which is why measuring the good version is the useful measurement.
 */
export function orderOf(signal: TableSignal, question: TableQuestion): readonly string[] {
  // Mapped onto the schema's own spelling first: a signal that names `posthistory` while the schema
  // declares `postHistory` would otherwise contribute both, and the duplicate makes a clean ordering
  // read as an unclean one.
  const spelled = new Map(question.tables.map((table) => [keyOf(table), table]));
  const named: string[] = [];
  for (const candidate of namedBy(signal, question)) {
    const table = spelled.get(keyOf(candidate));
    if (table !== undefined && !named.includes(table)) named.push(table);
  }
  const taken = new Set(named.map(keyOf));
  return [...named, ...question.tables.filter((table) => !taken.has(keyOf(table)))];
}

/** What one signal achieved on one question. */
export function readOrdering(signal: TableSignal, question: TableQuestion): TableOrdering {
  const order = orderOf(signal, question);
  const present = new Set(question.tables.map(keyOf));
  const gold = new Set(question.gold.filter((table) => present.has(keyOf(table))).map(keyOf));
  const named = namedBy(signal, question);
  let depth = 0;
  let lastGold = 0;
  for (const [index, table] of order.entries()) {
    if (!gold.has(keyOf(table))) continue;
    depth += 1;
    lastGold = index + 1;
  }
  return {
    signal,
    tables: question.tables.length,
    gold: gold.size,
    depth: lastGold,
    // `depth === gold` means every position up to the last gold one is gold, because the two counts
    // are the same only when no non-gold table sits between them.
    clean: gold.size > 0 && lastGold === gold.size,
    named: named.length,
    hits: named.filter((table) => gold.has(keyOf(table))).length,
  };
}

/**
 * De-duplicated the way SQLite resolves names, not the way string equality does.
 *
 * Two spellings of one table are one table. Keeping both counted it twice in `hits`, which made the
 * `both` signal report a recall above 100% — a figure that is impossible by construction and was
 * therefore the fastest possible signal that the instrument was wrong.
 */
function unique(values: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const key = keyOf(value);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

/** One signal's summary over the questions it could score. */
export type SignalSummary = {
  readonly n: number;
  /** Questions whose ordering is clean, and the share of them. */
  readonly clean: number;
  readonly cleanShare: number;
  /** Mean `depth / tables`: how much of the schema must be read to have seen every gold table. */
  readonly meanDepthShare: number;
  /** Of the tables the signal moved to the front, the share the gold query reads. */
  readonly precision: number;
  /** Of the gold tables, the share the signal moved to the front. */
  readonly recall: number;
};

export type TableRecall = {
  /** Questions scored: at least two tables in the DDL and at least one gold table inside it. */
  readonly n: number;
  /** Questions excluded, by why: no gold table in the DDL, or a single-table schema. */
  readonly unscoreable: number;
  readonly degenerate: number;
  readonly signals: Readonly<Record<TableSignal, SignalSummary>>;
  /** `both` against the arm's incumbent, paired on the same questions. */
  readonly bothVersusAnchors: PairedResult;
  /** Whether the recalled signal alone is enough, which decides if the anchor pass is worth keeping. */
  readonly recalledVersusAnchors: PairedResult;
};

/**
 * One summary over however many readings a caller has.
 *
 * Exported because the dispatched lane summarises with it too: the arm's `clean` share then comes
 * from the same arithmetic as the free ceiling it was chosen on, and a run whose number disagreed
 * with the measurement would be a defect in the dispatch rather than an argument about statistics.
 */
export function summariseOrderings(readings: readonly TableOrdering[]): SignalSummary {
  const n = readings.length;
  if (n === 0) {
    return { n: 0, clean: 0, cleanShare: 0, meanDepthShare: 0, precision: 0, recall: 0 };
  }
  // No guard on `tables` or `gold` here: `tableRecallOf` only scores questions with at least two
  // tables and at least one gold table inside the schema, so a zero would be a broken invariant
  // rather than a population this function has to describe. A branch that cannot be taken is a
  // branch the coverage report has to be told about, and telling it is the wrong fix.
  const clean = readings.filter((reading) => reading.clean).length;
  const depthShare = readings.reduce((sum, reading) => sum + reading.depth / reading.tables, 0);
  const named = readings.reduce((sum, reading) => sum + reading.named, 0);
  const hits = readings.reduce((sum, reading) => sum + reading.hits, 0);
  const gold = readings.reduce((sum, reading) => sum + reading.gold, 0);
  return {
    n,
    clean,
    cleanShare: clean / n,
    meanDepthShare: depthShare / n,
    // The one guard that stays: a signal that names nothing has no precision to report, and zero is
    // the honest figure rather than the 0/0 a division would produce.
    precision: named === 0 ? 0 : hits / named,
    recall: hits / gold,
  };
}

/**
 * The whole measurement.
 *
 * A question is scoreable when the DDL holds at least two tables and at least one of the gold
 * query's tables. The first exclusion is not pedantry: a one-table schema is clean under every
 * signal, so counting those questions would let a signal that does nothing look like a signal that
 * works. They are counted separately rather than dropped, because a benchmark where most questions
 * are single-table is a benchmark that cannot answer this question at all.
 */
export function tableRecallOf(questions: readonly TableQuestion[]): TableRecall {
  const goldInSchema = (question: TableQuestion): boolean => {
    const present = new Set(question.tables.map(keyOf));
    return question.gold.some((table) => present.has(keyOf(table)));
  };
  const unscoreable = questions.filter((question) => !goldInSchema(question)).length;
  const degenerate = questions.filter(
    (question) => question.tables.length <= 1 && goldInSchema(question),
  ).length;
  const scored = questions.filter(
    (question) => question.tables.length > 1 && goldInSchema(question),
  );
  const bySignal = Object.fromEntries(
    TABLE_SIGNALS.map((signal) => [signal, scored.map((question) => readOrdering(signal, question))]),
  ) as Record<TableSignal, TableOrdering[]>;
  const cleanOf = (signal: TableSignal): readonly boolean[] =>
    bySignal[signal].map((reading) => reading.clean);
  return {
    n: scored.length,
    unscoreable,
    degenerate,
    signals: {
      anchors: summariseOrderings(bySignal.anchors),
      recalled: summariseOrderings(bySignal.recalled),
      both: summariseOrderings(bySignal.both),
    },
    bothVersusAnchors: comparePaired(cleanOf('anchors'), cleanOf('both')),
    recalledVersusAnchors: comparePaired(cleanOf('anchors'), cleanOf('recalled')),
  };
}

/**
 * One training row, as the retrieval index needs it.
 *
 * `gold` is the table set of the row's own gold query. That is supervision the benchmark gives away
 * for free and that the pipeline has never used for anything: a memory arm cannot read a test
 * question's gold tables, but every *other* fold's are its training data, which is what makes this
 * signal lawful under the cross-fitting the lane already runs.
 */
export type GoldRow = {
  readonly db: string;
  readonly question: string;
  readonly gold: readonly string[];
};

/** The neighbours one question may draw from, in the order the caller supplied them. */
export type GoldNeighbours = readonly {
  readonly question: string;
  readonly gold: readonly string[];
}[];

/**
 * The training rows grouped by the database they were asked against.
 *
 * Grouped and not pooled, because a table name means nothing outside its own schema: `schools`
 * exists in `california_schools` and not in `formula_1`, and a global index would offer it to a
 * question where it cannot be joined. The absence of an entry is a meaningful state too — a
 * database with a single question in the split has no neighbours, and the arm falls back to the
 * lexical anchors rather than ending the fold.
 */
export function goldIndex(rows: readonly GoldRow[]): ReadonlyMap<string, GoldNeighbours> {
  const index = new Map<string, { question: string; gold: readonly string[] }[]>();
  for (const row of rows) {
    const entry = { question: row.question, gold: row.gold };
    const bucket = index.get(row.db);
    if (bucket === undefined) index.set(row.db, [entry]);
    else bucket.push(entry);
  }
  return index;
}

/**
 * The gold tables the nearest training questions of this database read.
 *
 * The one-line composition the lane calls, kept here rather than there so that the measurement and
 * the arm read the same index: a lane that built its own would be a second definition of "the
 * neighbours", and the free ceiling would stop describing the thing that gets dispatched.
 */
export function recalledFor(
  index: ReadonlyMap<string, GoldNeighbours>,
  db: string,
  question: string,
  k: number,
): readonly string[] {
  const pool = index.get(db);
  if (pool === undefined) return [];
  return recalledTables(question, pool, k);
}

/**
 * The tables the nearest training questions read.
 *
 * Sampling rather than neighbour-only would answer a different question: this is the signal a
 * retrieval system actually produces, so it is the nearest ones. `k` neighbours and not one,
 * because a single neighbour is a coin flip on which of two similar questions was drawn, and the
 * union across five is the cheapest way to buy the stability that matters here — the signal is a
 * set of tables, and a table that three of five neighbours read is a table worth showing first.
 *
 * Ties are broken by the pool's own order, which is the caller's, so two runs over the same pool
 * produce the same answers.
 */
export function recalledTables(
  question: string,
  pool: readonly { readonly question: string; readonly gold: readonly string[] }[],
  k: number,
): readonly string[] {
  if (k <= 0) return [];
  const tokens = tokensOf(question);
  const scored = pool
    .map((entry, index) => ({ entry, index, score: similarityOf(tokens, tokensOf(entry.question)) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, k);
  const tables: string[] = [];
  for (const { entry } of scored) {
    for (const table of entry.gold) if (!tables.includes(table)) tables.push(table);
  }
  return tables;
}
