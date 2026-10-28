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
 * Two shapes, because two exist. BIRD's SQLite dumps quote every name, and the quoted identifiers in
 * order are exactly the declaration. A dump without quotes needs the clauses parsed instead: the
 * table is whatever follows `CREATE TABLE`, and a column is the first word of a comma-separated
 * clause that does not begin with a constraint keyword.
 *
 * The first version read `name TYPE` pairs across the whole statement, which turned
 * `CREATE TABLE atoms (atom_id INTEGER)` into a table called `atom_id` — the table name is followed
 * by another identifier, not by a type, so the pair rule never fired for it.
 */
function identifiersOf(statement: string): string[] {
  const quoted = [...statement.matchAll(/"([^"]+)"/g)].map((match) => match[1] as string);
  if (quoted.length > 0) return quoted;
  const open = statement.indexOf('(');
  const close = statement.lastIndexOf(')');
  const head = open === -1 ? statement : statement.slice(0, open);
  const match = /\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z_][A-Za-z_0-9]*)/i.exec(head);
  const table = match?.[1];
  if (table === undefined) return [];
  if (open === -1 || close <= open) return [table];
  const columns: string[] = [];
  for (const clause of splitTopLevel(statement.slice(open + 1, close))) {
    const first = /^\s*([A-Za-z_][A-Za-z_0-9]*)/.exec(clause)?.[1];
    if (first === undefined || CONSTRAINT_WORDS.has(first.toLowerCase())) continue;
    columns.push(first);
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
    return { ddl, kept: blocks.map((block) => block.table), dropped: 0, total: blocks.length, reason: 'single-table' };
  }
  const tokens = questionTokens(`${question} ${evidence}`);
  const kept = new Set<string>();
  for (const block of blocks) {
    const anchor = [block.table, ...block.columns].some((name) => tokens.has(name.toLowerCase()));
    if (anchor) kept.add(block.table);
  }
  if (kept.size === 0) {
    return { ddl, kept: blocks.map((block) => block.table), dropped: 0, total: blocks.length, reason: 'nothing-matched' };
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
      for (const neighbour of byColumn.get(column.toLowerCase()) ?? []) kept.add(neighbour);
    }
  }
  // Prune only when pruning removes a third of the database. Dropping one table of six costs a
  // possible join and saves a line of prompt, which is not a trade worth making inside a
  // measurement: the arm exists to test schema linking, not the absence of it.
  if (kept.size === blocks.length || kept.size > Math.ceil((blocks.length * 2) / 3)) {
    return { ddl, kept: [...kept], dropped: 0, total: blocks.length, reason: 'all-matched' };
  }
  return {
    ddl: blocks
      .filter((block) => kept.has(block.table))
      .map((block) => block.sql)
      .join('\n'),
    kept: [...kept],
    dropped: blocks.length - kept.size,
    total: blocks.length,
    reason: 'linked',
  };
}
