/**
 * Pruning the schema to the part the question is about.
 *
 * Every system above 70% execution accuracy on BIRD links the schema before it generates: MCS-SQL
 * measures +2.1 points from schema linking alone with the same model, and CHASE-SQL reports schema
 * linking as the primary cause of failure in nearly half of its unsuccessful cases. The pipeline in
 * this repository has always sent the whole database, which on BIRD means up to thirteen CREATE
 * statements and a few hundred columns for a question that needs two tables.
 *
 * The linker here is lexical and deterministic, not a model. Two reasons: it costs no calls, and a
 * model-based linker confounds its own contribution with the model's variance, which is the exact
 * error this project spent ten iterations learning to avoid.
 *
 * The rule is deliberately conservative. A pruner that removes the table the answer needs cannot be
 * rescued by the model — it will write a query over what it can see — so every ambiguity resolves
 * towards keeping, and a question that names nothing keeps the whole schema.
 */

export type SchemaBlock = {
  readonly table: string;
  readonly sql: string;
  readonly columns: readonly string[];
};

export type LinkedSchema = {
  readonly ddl: string;
  readonly kept: readonly string[];
  readonly dropped: number;
  readonly total: number;
  /**
   * The tables the pruner removed, in the order the DDL declared them.
   *
   * A count is enough to say whether the pruner fired; it is not enough to ask the question the
   * registration asks — *did the pack name a table or column the schema had pruned?* That question
   * needs the names, and a run that stored only `dropped` cannot be re-read to answer it, which is
   * why the field exists before the question does.
   */
  readonly prunedTables: readonly string[];
  /** Every column those tables declared: the names the prompt no longer offered the model. */
  readonly prunedColumns: readonly string[];
  /**
   * Why the result is what it is.
   *
   * `nothing-matched` and `all-matched` both return the full schema, and they mean opposite things:
   * the first is a linker that found no anchor and therefore declined to prune, the second is a
   * question that genuinely involves every table. A run that reports only the pruned token count
   * cannot tell them apart, and one of them is a defect to fix while the other is an answer.
   */
  readonly reason: 'linked' | 'nothing-matched' | 'all-matched' | 'single-table';
};

/** The clause keywords that introduce a constraint rather than a column. */
const CONSTRAINT_WORDS = new Set(['primary', 'foreign', 'unique', 'check', 'constraint']);

/** Comma-separated clauses at depth zero, so `CHECK (a, b)` stays one clause. */
function splitTopLevel(body: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let at = 0; at < body.length; at += 1) {
    const character = body[at];
    if (character === '(') depth += 1;
    else if (character === ')') depth -= 1;
    else if (character === ',' && depth === 0) {
      out.push(body.slice(start, at));
      start = at + 1;
    }
  }
  out.push(body.slice(start));
  return out;
}

/**
 * The identifiers a CREATE statement declares: the table, then its columns.
 *
 * One parse, three quoting conventions. The first version took the quoted identifiers in order when
 * there were any and fell back to clause parsing when there were none, which assumed that a dump
 * quotes every name or none of them: it read `"` as the only quote, so a backticked statement
 * matched neither branch and produced nothing. Now the table is whatever follows `CREATE TABLE`
 * under any of the three conventions, and a column is the first identifier of a comma-separated
 * clause that does not begin with a constraint keyword.
 *
 * The first version of the clause parser read `name TYPE` pairs across the whole statement, which
 * turned `CREATE TABLE atoms (atom_id INTEGER)` into a table called `atom_id` — the table name is
 * followed by another identifier, not by a type, so the pair rule never fired for it.
 */
/**
 * A declared name, however the dump happens to quote it.
 *
 * SQLite stores the statement as it was written, and the three dumps in this benchmark's own dev
 * split disagree: double quotes, backticks, and nothing at all. The pattern had only the first and
 * the third, so a backticked schema parsed to zero blocks — and zero blocks is not an error here, it
 * is `single-table`, which made `annotateSchema` return the DDL unchanged. The arm was inert on
 * those databases for three rounds and nothing said so, because an instrument that cannot fire
 * reports its own absence as a null result.
 */
const IDENTIFIER = '(?:"([^"]+)"|`([^`]+)`|\\[([^\\]]+)\\]|([A-Za-z_][A-Za-z_0-9]*))';

function nameOf(match: RegExpExecArray): string | undefined {
  return match[1] ?? match[2] ?? match[3] ?? match[4];
}

function identifiersOf(statement: string): string[] {
  const open = statement.indexOf('(');
  const close = statement.lastIndexOf(')');
  const head = open === -1 ? statement : statement.slice(0, open);
  const tableMatch = new RegExp(
    String.raw`\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?` + IDENTIFIER,
    'i',
  ).exec(head);
  const table = tableMatch === null ? undefined : nameOf(tableMatch);
  if (table === undefined) return [];
  if (open === -1 || close <= open) return [table];
  const columns: string[] = [];
  for (const clause of splitTopLevel(statement.slice(open + 1, close))) {
    const first = new RegExp(String.raw`^\s*` + IDENTIFIER).exec(clause);
    if (first === null) continue;
    const name = nameOf(first);
    if (name === undefined || CONSTRAINT_WORDS.has(name.toLowerCase())) continue;
    // The foreign key's target table was previously read as a column of this one, because the
    // quoted shortcut returned every quoted name in the statement in order. It kept tables rather
    // than dropping them, so it never broke an answer; it did put another table's name in this
    // table's anchor set, where a question could match it and keep the wrong block.
    if (!columns.includes(name)) columns.push(name);
  }
  return [table, ...columns];
}

/**
 * One CREATE statement per table, with its declared names.
 *
 * Split on the keyword rather than parsed: the input is `sqlite_master.sql`, which is the text the
 * database itself stores, and a real parser here would be a second implementation of SQLite's
 * grammar kept in sync by hand.
 */
export function schemaBlocks(ddl: string): readonly SchemaBlock[] {
  const parts = ddl.split(/(?=CREATE\s+TABLE)/i).filter((part) => part.trim() !== '');
  const blocks: SchemaBlock[] = [];
  for (const part of parts) {
    const names = identifiersOf(part);
    const table = names[0];
    if (table === undefined) continue;
    blocks.push({ table, sql: part.trim(), columns: names.slice(1) });
  }
  return blocks;
}

/** The words a question offers as anchors, lowercased and de-pluralised. */
export function questionTokens(text: string): ReadonlySet<string> {
  const out = new Set<string>();
  for (const token of text.toLowerCase().match(/[a-z_][a-z_0-9]*/g) ?? []) {
    out.add(token);
    // English plurals are how BIRD phrases questions against tables named in the singular and vice
    // versa: "how many races" against `race`, "list the schools" against `schools`. Only the common
    // forms, because a stemmer here would invent matches — and a false anchor keeps a table, which
    // is safe, while a false negative drops one, which is not.
    if (token.length > 3 && token.endsWith('es')) out.add(token.slice(0, -2));
    if (token.length > 3 && token.endsWith('s')) out.add(token.slice(0, -1));
  }
  return out;
}

/**
 * Whether a column name is the kind a join is written on.
 *
 * Used only to decide which neighbouring tables a pruned schema has to keep to remain joinable.
 * A column called `raceId` is a key; `forename` is not, and keeping every table that shares it would
 * prune nothing.
 */
function keyLike(column: string): boolean {
  return /(?:id|key)$/i.test(column) || /_id$/i.test(column);
}

/**
 * The schema restricted to what the question and the evidence name, plus what those tables join to.
 *
 * A table is kept when its name appears as a word in the question or the evidence, or when one of
 * its columns does. Then every table sharing a key-like column with a kept table is added: a pruned
 * schema that cannot express the join the question needs is worse than no pruning at all, because
 * the model will write a query over what it can see rather than ask for the rest.
 *
 * Two guards, both resolving towards keeping:
 *
 *  - no anchor at all returns the full schema, because an empty pruner is a wrong answer;
 *  - a closure that covers most of the database returns the full schema too, because dropping two of
 *    five tables saves little and risks a join.
 */
export function linkSchema(ddl: string, question: string, evidence: string): LinkedSchema {
  const blocks = schemaBlocks(ddl);
  if (blocks.length <= 1) {
    return {
      ddl,
      kept: blocks.map((block) => block.table),
      dropped: 0,
      total: blocks.length,
      prunedTables: [],
      prunedColumns: [],
      reason: 'single-table',
    };
  }
  const tokens = questionTokens(`${question} ${evidence}`);
  const kept = new Set<string>();
  for (const block of blocks) {
    const anchor = [block.table, ...block.columns].some((name) => tokens.has(name.toLowerCase()));
    if (anchor) kept.add(block.table);
  }
  if (kept.size === 0) {
    return {
      ddl,
      kept: blocks.map((block) => block.table),
      dropped: 0,
      total: blocks.length,
      prunedTables: [],
      prunedColumns: [],
      reason: 'nothing-matched',
    };
  }
  const byColumn = new Map<string, string[]>();
  for (const block of blocks) {
    for (const column of block.columns) {
      if (!keyLike(column)) continue;
      const key = column.toLowerCase();
      const owners = byColumn.get(key);
      if (owners === undefined) byColumn.set(key, [block.table]);
      else owners.push(block.table);
    }
  }
  // One hop from the *anchors*, not from whatever the first hop added. Expanding transitively walks
  // a relational database to its whole connected component — measured on a six-table fixture,
  // `drivers` reached all six through `raceId` — and a pruner that keeps everything is a no-op with
  // a longer name.
  const anchors = new Set(kept);
  for (const block of blocks) {
    if (!anchors.has(block.table)) continue;
    for (const column of block.columns) {
      if (!keyLike(column)) continue;
      // `?? []` stood here and no input could reach it: `byColumn` is filled from every block's own
      // columns two loops up, so an anchor's key-like column always has an entry. An unreachable
      // fallback is not safety — it is a branch that reads as a guard, is never taken, and shows up in
      // the coverage report as the file's only uncovered line, which is how a reader learns to stop
      // reading that report. The invariant is asserted by construction instead, and a violation now
      // throws here rather than silently pruning less than it says it does.
      const owners = byColumn.get(column.toLowerCase()) as string[];
      for (const neighbour of owners) kept.add(neighbour);
    }
  }
  // Prune only when pruning removes a third of the database. Dropping one table of six costs a
  // possible join and saves a line of prompt, which is not a trade worth making inside a
  // measurement: the arm exists to test schema linking, not the absence of it.
  if (kept.size === blocks.length || kept.size > Math.ceil((blocks.length * 2) / 3)) {
    return {
      ddl,
      kept: [...kept],
      dropped: 0,
      total: blocks.length,
      prunedTables: [],
      prunedColumns: [],
      reason: 'all-matched',
    };
  }
  const removed = blocks.filter((block) => !kept.has(block.table));
  return {
    ddl: blocks
      .filter((block) => kept.has(block.table))
      .map((block) => block.sql)
      .join('\n'),
    kept: [...kept],
    dropped: blocks.length - kept.size,
    total: blocks.length,
    prunedTables: removed.map((block) => block.table),
    prunedColumns: removed.flatMap((block) => block.columns),
    reason: 'linked',
  };
}

/**
 * The additive form: every table kept, the ones the question names moved to the front.
 *
 * `linkSchema` above prunes, and the measurement says pruning does not survive contact with the
 * benchmark. The `linked` arm read **−9.58pp at p = 6.4e-21** over 1,534 questions — 202 broken
 * against 55 repaired — and the same artefact explains it: errors where the gold query reads a table
 * the prediction does not went from 107 to 291, and 44 predictions lost their `FROM` entirely. A
 * pruner decides before the SQL exists; when it is wrong the model cannot ask for what it cannot see,
 * and there is no threshold at which that stops being true, because the failure is structural rather
 * than a matter of degree.
 *
 * So this variant cannot lose a table. It reorders and it labels, and both are recoverable by a
 * reader that ignores them. The only claim it makes is the one the literature makes about *why*
 * models are bad at schema selection: a model is more reliable at writing SQL than at picking tables,
 * so anything that draws attention without removing options is free beta and no risk. If the arm
 * measures zero, the conclusion is that ordering is not the lever and the next variant must verify
 * against the SQL instead — which is a result, and a cheap one.
 */
export type AnnotatedSchema = {
  readonly ddl: string;
  /** The tables the question or its evidence names, in declaration order. */
  readonly anchors: readonly string[];
  readonly total: number;
  readonly reason: 'annotated' | 'no-anchor' | 'single-table';
};

export function annotateSchema(ddl: string, question: string, evidence: string): AnnotatedSchema {
  const blocks = schemaBlocks(ddl);
  if (blocks.length <= 1) {
    return { ddl, anchors: blocks.map((block) => block.table), total: blocks.length, reason: 'single-table' };
  }
  const tokens = questionTokens(`${question} ${evidence}`);
  const anchors = blocks
    .filter((block) => [block.table, ...block.columns].some((name) => tokens.has(name.toLowerCase())))
    .map((block) => block.table);
  if (anchors.length === 0) {
    // Nothing names a table, so there is nothing to say. Returning the schema unchanged rather than
    // with an empty header keeps the two states distinguishable in the artefact: a run whose header
    // is absent had no anchor, and one whose header is present had anchors even if they were wrong.
    return { ddl, anchors: [], total: blocks.length, reason: 'no-anchor' };
  }
  const named = new Set(anchors);
  const ordered = [
    ...blocks.filter((block) => named.has(block.table)),
    ...blocks.filter((block) => !named.has(block.table)),
  ];
  const header =
    `-- ${anchors.length} of ${blocks.length} tables are named by this question and are listed first.\n` +
    `-- Every table is present; none was removed.\n`;
  return {
    ddl: header + ordered.map((block) => block.sql).join('\n'),
    anchors,
    total: blocks.length,
    reason: 'annotated',
  };
}
