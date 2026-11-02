/**
 * What the pack did to the query, read off the query itself.
 *
 * Twenty-eight iterations have measured the memory effect as a number — +0.33pp on dev, +1.17pp
 * on the channel that carries it best — and none of them has been able to say *what the pack
 * changed*. Every covariate the record has tried was a similarity: query–rule overlap (R28),
 * character n-gram overlap, the channel a rule was admitted through (R26). All of them came back
 * flat, and a flat similarity covariate has two readings that the record could not tell apart —
 * either the mechanism does nothing, or similarity is not the axis it acts on.
 *
 * This module reads the axis the literature names instead. STRATA (arXiv 2610.19386) and
 * Anti-Persistence (arXiv 2610.27406) both describe the failure as *what the rule makes the query
 * do*, not how near the rule sits to the question. The measurable version of that statement lives
 * in a place the record already stores and has never read: every committed case carries the SQL
 * the model wrote **with** the pack and the SQL it wrote **without** it, generated from the same
 * question, the same schema and the same model. The difference between those two strings is the
 * pack's footprint, and it is available for 1,534 questions at zero cost.
 *
 * Three properties keep this a measurement rather than a story:
 *
 *  - **It reads no answer.** No gold SQL, no gold result, no field the scorer uses. The classifier
 *    sees the two candidate queries, the question and the evidence — the same inputs the model
 *    saw — and nothing else. A covariate that peeked would separate help from harm by construction.
 *  - **It is deterministic and offline.** No model call, no database, no clock. The same two
 *    strings always produce the same delta, which is what lets the workflow recompute the artefact
 *    byte for byte instead of trusting the copy on disk.
 *  - **It states its own gaps.** The registered third category — *a table the rule named that the
 *    schema had pruned* — cannot be evaluated from the committed record, which stores the schema
 *    candidate as a count (`kept`, `total`) and not as names. That gap is reported by
 *    `readQueryDiff` rather than papered over with a proxy, because a proxy here would be a
 *    second question answered in place of the first.
 *
 * Nothing in this file is a scorer. A delta is a description of an edit, and describing an edit is
 * not the same as deciding whether it was good; the outcome columns stay in the artefact and are
 * joined by the reading layer, never by the classifier.
 */

/**
 * Words that are structure rather than names.
 *
 * The list is deliberately generous: a word misread as an identifier shows up as an "imported
 * name" that no rule ever mentioned, which would inflate the covariate in the direction of the
 * hypothesis. A word misread as a keyword instead disappears from `columns`, which costs nothing
 * because the same word is compared in both queries.
 *
 * `cast`, `integer`, `real` and `text` are here because SQLite spells the type in the query and a
 * type name is not a schema element — `CAST(x AS INTEGER)` would otherwise report `integer` as a
 * column the pack introduced.
 */
export const SQL_KEYWORDS: ReadonlySet<string> = new Set([
  'add', 'all', 'alter', 'and', 'any', 'as', 'asc', 'attach', 'autoincrement', 'between', 'by',
  'case', 'cast', 'collate', 'column', 'commit', 'constraint', 'create', 'cross', 'current',
  'current_date', 'current_time', 'current_timestamp', 'database', 'default', 'delete', 'desc',
  'detach', 'distinct', 'do', 'drop', 'each', 'else', 'end', 'escape', 'except', 'exclude',
  'exists', 'explain', 'fail', 'filter', 'first', 'following', 'for', 'foreign', 'from', 'full',
  'generated', 'glob', 'group', 'groups', 'having', 'if', 'ignore', 'immediate', 'in', 'index',
  'indexed', 'inner', 'insert', 'instead', 'intersect', 'into', 'is', 'isnull', 'join', 'key',
  'last', 'left', 'like', 'limit', 'match', 'natural', 'no', 'not', 'nothing', 'notnull', 'null',
  'nulls', 'offset', 'on', 'or', 'order', 'others', 'outer', 'over', 'partition', 'plan',
  'pragma', 'preceding', 'primary', 'query', 'raise', 'range', 'recursive', 'references',
  'regexp', 'reindex', 'release', 'rename', 'replace', 'restrict', 'returning', 'right', 'rollback',
  'row', 'rows', 'savepoint', 'select', 'set', 'table', 'temp', 'temporary', 'then', 'ties', 'to',
  'transaction', 'trigger', 'true', 'false', 'unbounded', 'union', 'unique', 'update', 'using',
  'vacuum', 'values', 'view', 'virtual', 'when', 'where', 'window', 'with', 'without',
  // Type names, which appear inside `CAST` and in no schema position that matters here.
  'integer', 'real', 'text', 'blob', 'numeric', 'varchar', 'char', 'date', 'datetime', 'boolean',
]);

/** One lexical unit, with the parenthesis depth it was read at. */
export type SqlToken = {
  readonly kind: 'word' | 'string' | 'number' | 'punct';
  /** Lower-cased for words and strings, verbatim for numbers and punctuation. */
  readonly text: string;
  /** 0 at the top level. Parentheses themselves carry the depth outside the group they open. */
  readonly depth: number;
};

/**
 * Split a statement into tokens.
 *
 * Written rather than imported because every regex approach to SQL tokenising eventually matches
 * inside a string literal, and `WHERE name = 'from'` is a question BIRD actually asks. Comments
 * are dropped here rather than stripped beforehand so that `--` inside a literal stays a literal.
 *
 * Unterminated constructs are consumed to the end of the string instead of throwing: a model's
 * reply is not always well-formed, and a classifier that refused to describe a broken query would
 * silently drop exactly the cases where the pack did the most damage.
 */
export function tokenizeSql(sql: string): readonly SqlToken[] {
  const tokens: SqlToken[] = [];
  let depth = 0;
  let at = 0;
  while (at < sql.length) {
    const ch = sql[at] as string;
    if (ch === '-' && sql[at + 1] === '-') {
      const end = sql.indexOf('\n', at);
      at = end === -1 ? sql.length : end + 1;
      continue;
    }
    if (ch === '/' && sql[at + 1] === '*') {
      const end = sql.indexOf('*/', at + 2);
      at = end === -1 ? sql.length : end + 2;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      let text = '';
      let cursor = at + 1;
      while (cursor < sql.length) {
        const inner = sql[cursor] as string;
        if (inner === quote) {
          // A doubled quote is an escaped quote in SQL, in both string and identifier position.
          if (sql[cursor + 1] === quote) {
            text += quote;
            cursor += 2;
            continue;
          }
          cursor += 1;
          break;
        }
        text += inner;
        cursor += 1;
      }
      // A quoted identifier is a name; a quoted string is a value. They are told apart by quote
      // style, which is the only signal the statement carries.
      const kind = quote === "'" ? 'string' : 'word';
      tokens.push({ kind, text: text.toLowerCase(), depth });
      at = cursor;
      continue;
    }
    if (ch === '(') {
      tokens.push({ kind: 'punct', text: ch, depth });
      depth += 1;
      at += 1;
      continue;
    }
    if (ch === ')') {
      depth = Math.max(0, depth - 1);
      tokens.push({ kind: 'punct', text: ch, depth });
      at += 1;
      continue;
    }
    if (/[0-9]/.test(ch)) {
      let cursor = at;
      while (cursor < sql.length && /[0-9.]/.test(sql[cursor] as string)) cursor += 1;
      tokens.push({ kind: 'number', text: sql.slice(at, cursor), depth });
      at = cursor;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let cursor = at;
      while (cursor < sql.length && /[A-Za-z0-9_$]/.test(sql[cursor] as string)) cursor += 1;
      tokens.push({ kind: 'word', text: sql.slice(at, cursor).toLowerCase(), depth });
      at = cursor;
      continue;
    }
    if (!/\s/.test(ch)) tokens.push({ kind: 'punct', text: ch, depth });
    at += 1;
  }
  return tokens;
}

/** The parts of a query a diff can be stated over. */
export type SqlShape = {
  /** Tokens joined by single spaces, comments gone: the form `relation` is decided on. */
  readonly normalized: string;
  /**
   * Every token sorted, as a multiset key. Equal keys mean the same tokens in another order.
   *
   * Numbers and literals are in it, because a query that changes `WHERE x = 1` to `WHERE x = 2` has
   * changed a value and not merely its wording. A key built from words alone called 14 of this
   * corpus's cases a reordering that had in fact changed a constant, which moved them out of
   * `edited` and into a bucket whose delta is zero by construction.
   */
  readonly bag: string;
  /** Tables named in `FROM` and `JOIN` position, sorted and deduplicated. */
  readonly tables: readonly string[];
  /** Names that are neither keyword, table, alias, output label, CTE nor function call. */
  readonly columns: readonly string[];
  /** String literals, lower-cased, deduplicated. */
  readonly literals: readonly string[];
  /** Numbers outside string literals, deduplicated. */
  readonly numbers: readonly string[];
  /** Which clause words appear anywhere in the statement. */
  readonly clauses: readonly string[];
  /** Aggregate function names called, deduplicated. */
  readonly aggregates: readonly string[];
  /** Top-level select-list width, or 0 when the statement has no top-level `SELECT`. */
  readonly arity: number;
  /** Count of the word `and`, at any depth. The cheapest proxy for how many conditions join. */
  readonly conjunctions: number;
  /** Count of `( SELECT`, which is the statement's nesting. */
  readonly subqueries: number;
};

/** Clause words whose appearance or disappearance is a change of structure, not of wording. */
const CLAUSE_WORDS: readonly string[] = [
  'distinct', 'join', 'group', 'having', 'order', 'limit', 'union', 'except', 'intersect',
  'case', 'exists', 'like', 'between', 'in', 'with', 'over', 'filter',
];

/** Aggregate names. `min`/`max` are here because a scalar subquery and an aggregate read alike. */
const AGGREGATES: readonly string[] = ['count', 'sum', 'avg', 'min', 'max', 'group_concat', 'total'];

/**
 * Describe a statement in the terms a diff needs.
 *
 * `SELECT` list width is measured at the **first** top-level `SELECT`, which matters for a `UNION`:
 * BIRD requires every branch to return the same number of columns, so the first branch's width is
 * the statement's width, and reading the last would report a different number for the same shape.
 */
export function sqlShapeOf(sql: string): SqlShape {
  const tokens = tokenizeSql(sql);
  const normalized = tokens.map((token) => token.text).join(' ');
  const words = tokens.filter((token) => token.kind === 'word');
  const wordText = words.map((token) => token.text);

  const cteNames = new Set<string>();
  for (const [at, token] of tokens.entries()) {
    if (token.kind !== 'word' || token.text !== 'with') continue;
    let cursor = at + 1;
    if (tokens[cursor]?.kind === 'word' && tokens[cursor]?.text === 'recursive') cursor += 1;
    // `WITH a AS (…), b AS (…)` — a name, an `AS`, a balanced group, then either a comma or the
    // main statement. Reading only up to the first `(` loses every CTE after the first, and those
    // are exactly the names that would otherwise be counted as columns.
    for (;;) {
      const name = tokens[cursor];
      if (name === undefined || name.kind !== 'word' || SQL_KEYWORDS.has(name.text)) break;
      cteNames.add(name.text);
      cursor += 1;
      if (tokens[cursor]?.kind === 'word' && tokens[cursor]?.text === 'as') cursor += 1;
      if (!(tokens[cursor]?.kind === 'punct' && tokens[cursor]?.text === '(')) break;
      let depth = 0;
      for (; cursor < tokens.length; cursor += 1) {
        const body = tokens[cursor] as SqlToken;
        if (body.kind !== 'punct') continue;
        if (body.text === '(') depth += 1;
        if (body.text === ')') {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      cursor += 1;
      if (tokens[cursor]?.kind === 'punct' && tokens[cursor]?.text === ',') cursor += 1;
      else break;
    }
  }

  const outputLabels = new Set<string>();
  for (const [at, token] of tokens.entries()) {
    if (token.kind === 'word' && token.text === 'as') {
      const next = tokens[at + 1];
      if (next !== undefined && next.kind === 'word') outputLabels.add(next.text);
    }
  }

  const tables = new Set<string>();
  const tableAliases = new Set<string>();
  for (const [at, token] of tokens.entries()) {
    if (token.kind !== 'word' || (token.text !== 'from' && token.text !== 'join')) continue;
    let cursor = at + 1;
    // A `FROM` clause is a comma-separated list, and each element may carry an alias with or
    // without `AS`. Reading one name loses every table after a comma, and those names then appear
    // in `columns` — a table counted as a column is a name the diff attributes to the wrong side.
    for (;;) {
      const name = tokens[cursor];
      if (name === undefined) break;
      if (name.kind === 'punct' && name.text === '(') {
        // `FROM (SELECT …) AS s`: a derived table names nothing here — the inner tables are picked
        // up when the scan reaches them — but its alias is a name, and a name nobody registered
        // becomes a column and then an "imported identifier" that no rule ever mentioned.
        let depth = 0;
        for (; cursor < tokens.length; cursor += 1) {
          const body = tokens[cursor] as SqlToken;
          if (body.kind !== 'punct') continue;
          if (body.text === '(') depth += 1;
          if (body.text === ')') {
            depth -= 1;
            if (depth === 0) break;
          }
        }
        cursor += 1;
      } else if (name.kind === 'word' && !SQL_KEYWORDS.has(name.text)) {
        tables.add(name.text);
        cursor += 1;
      } else {
        break;
      }
      if (tokens[cursor]?.kind === 'word' && tokens[cursor]?.text === 'as') cursor += 1;
      const alias = tokens[cursor];
      if (alias !== undefined && alias.kind === 'word' && !SQL_KEYWORDS.has(alias.text)) {
        tableAliases.add(alias.text);
        cursor += 1;
      }
      if (tokens[cursor]?.kind === 'punct' && tokens[cursor]?.text === ',') {
        cursor += 1;
        continue;
      }
      break;
    }
  }

  const functionNames = new Set<string>();
  for (const [at, token] of tokens.entries()) {
    if (token.kind !== 'word') continue;
    const next = tokens[at + 1];
    if (next !== undefined && next.kind === 'punct' && next.text === '(') functionNames.add(token.text);
  }

  const columns = new Set<string>();
  for (const word of wordText) {
    if (SQL_KEYWORDS.has(word)) continue;
    if (tables.has(word) || tableAliases.has(word)) continue;
    if (outputLabels.has(word) || cteNames.has(word)) continue;
    if (functionNames.has(word)) continue;
    columns.add(word);
  }

  const literals = new Set<string>();
  const numbers = new Set<string>();
  for (const token of tokens) {
    if (token.kind === 'string') literals.add(token.text);
    if (token.kind === 'number') numbers.add(token.text);
  }

  const present = new Set(wordText);
  const clauses = CLAUSE_WORDS.filter((word) => present.has(word)).sort();
  const aggregates = AGGREGATES.filter((word) => functionNames.has(word)).sort();

  return {
    normalized,
    bag: tokens.map((token) => token.text).sort().join(' '),
    tables: [...tables].sort(),
    columns: [...columns].sort(),
    literals: [...literals].sort(),
    numbers: [...numbers].sort(),
    clauses,
    aggregates,
    arity: arityOf(tokens),
    conjunctions: wordText.filter((word) => word === 'and').length,
    subqueries: subqueryOf(tokens),
  };
}

/** Top-level select-list width: commas at depth 0 between the first `SELECT` and its `FROM`. */
function arityOf(tokens: readonly SqlToken[]): number {
  let start = -1;
  for (const [at, token] of tokens.entries()) {
    if (token.kind === 'word' && token.text === 'select' && token.depth === 0) {
      start = at;
      break;
    }
  }
  if (start === -1) return 0;
  const depth = (tokens[start] as SqlToken).depth;
  let commas = 0;
  let sawTerm = false;
  for (let at = start + 1; at < tokens.length; at += 1) {
    const token = tokens[at] as SqlToken;
    if (token.depth !== depth) continue;
    if (token.kind === 'word' && (token.text === 'from' || token.text === 'union' || token.text === 'except')) break;
    if (token.kind === 'punct' && token.text === ',') commas += 1;
    else sawTerm = true;
  }
  return sawTerm ? commas + 1 : 0;
}

/** `( SELECT` occurrences, which is the statement's nesting rather than its word count. */
function subqueryOf(tokens: readonly SqlToken[]): number {
  let count = 0;
  for (const [at, token] of tokens.entries()) {
    if (token.kind !== 'punct' || token.text !== '(') continue;
    const next = tokens[at + 1];
    if (next !== undefined && next.kind === 'word' && next.text === 'select') count += 1;
  }
  return count;
}

/**
 * How a name in the emitted query is checked against the question.
 *
 * Two modes, both reported, because the choice between them decides part of the answer and a
 * single mode would present that choice as a fact.
 *
 *  - `strict` — the name must appear as a whole word in the question or the evidence. This is the
 *    definition the registration states, and it is the one the headline uses.
 *  - `morphological` — the name also counts as grounded when a question word of at least three
 *    letters is a prefix of it, or it is contained in a question word. `raceId` against "qualifying
 *    race No.903" is grounded under this rule and not under the strict one, and BIRD's gold query
 *    for that question does filter on `raceId` — so the strict rule has known false positives.
 *
 * Reporting both is the robustness check. A separation that survives both definitions is not an
 * artefact of the tokeniser; one that survives only the strict rule is.
 */
export type GroundingMode = 'strict' | 'morphological';

/** The words a name can be grounded in: the question and the evidence, tokenised once. */
export function contextTokens(question: string, evidence: string | null | undefined): readonly string[] {
  const text = `${question} ${evidence ?? ''}`.toLowerCase();
  return [...new Set(text.match(/[a-z_][a-z0-9_$]*/g) ?? [])];
}

/** Whether a schema-shaped name is mentioned by the question or the evidence. */
export function isGrounded(
  name: string,
  context: readonly string[],
  mode: GroundingMode = 'strict',
): boolean {
  if (context.includes(name)) return true;
  if (mode === 'strict') {
    // A quoted identifier may hold spaces — BIRD has `"Low Grade"` and `"Charter Funding Type"` —
    // and the context tokeniser splits on them. Such a name is grounded when every one of its
    // words is, which is the same test applied one level down.
    const parts = name.split(/\s+/).filter((part) => part.length > 0);
    return parts.length > 1 && parts.every((part) => context.includes(part));
  }
  const flat = name.replace(/_/g, '');
  if (flat.length === 0) return false;
  for (const word of context) {
    if (word.length < 3) continue;
    if (flat.startsWith(word)) return true;
    if (word.includes(flat)) return true;
  }
  return false;
}

/** How one query differs from another, in the vocabulary the registration names. */
export type QueryDelta = {
  /**
   * `unchanged` — the same tokens in the same order; `reworded` — the same words in a different
   * order or with different punctuation; `edited` — different words.
   */
  readonly relation: 'unchanged' | 'reworded' | 'edited';
  readonly tablesAdded: readonly string[];
  readonly tablesRemoved: readonly string[];
  readonly columnsAdded: readonly string[];
  readonly columnsRemoved: readonly string[];
  readonly literalsAdded: readonly string[];
  readonly literalsRemoved: readonly string[];
  readonly clausesAdded: readonly string[];
  readonly clausesRemoved: readonly string[];
  readonly aggregatesAdded: readonly string[];
  readonly aggregatesRemoved: readonly string[];
  readonly arityDelta: number;
  readonly conjunctionDelta: number;
  readonly subqueryDelta: number;
  /**
   * Names the memory query introduces that neither the baseline query nor the question contains.
   *
   * This is the covariate the registration asks for: *an identifier imported from a rule that the
   * question and evidence do not contain*. Table and column position both count, because a rule
   * that names a table the question never mentioned puts it there as surely as a rule that names a
   * column does.
   */
  readonly ungrounded: readonly string[];
  /** The same set under the looser rule, reported so the choice of rule is visible. */
  readonly ungroundedLoose: readonly string[];
  /** Names introduced that the question *does* contain, which is the comparison half of the test. */
  readonly grounded: readonly string[];
};

/** Everything that is in `next` and not in `before`, sorted. */
function onlyIn(next: readonly string[], before: readonly string[]): readonly string[] {
  const seen = new Set(before);
  return next.filter((value) => !seen.has(value));
}

/**
 * Diff two candidate queries for one question.
 *
 * The direction is `baseline → predicted`: what the pack added is in `*Added`, what it removed is
 * in `*Removed`. Both sides are shapes of the same two fields the record already stores, so this
 * function has no state and no inputs beyond the four strings.
 */
export function diffQueries(
  baselineSql: string,
  predictedSql: string,
  question: string,
  evidence: string | null | undefined,
): QueryDelta {
  const before = sqlShapeOf(baselineSql);
  const after = sqlShapeOf(predictedSql);
  const context = contextTokens(question, evidence);

  const relation: QueryDelta['relation'] =
    before.normalized === after.normalized ? 'unchanged' : before.bag === after.bag ? 'reworded' : 'edited';

  const tablesAdded = onlyIn(after.tables, before.tables);
  const columnsAdded = onlyIn(after.columns, before.columns);
  const introduced = [...new Set([...tablesAdded, ...columnsAdded])].sort();

  return {
    relation,
    tablesAdded,
    tablesRemoved: onlyIn(before.tables, after.tables),
    columnsAdded,
    columnsRemoved: onlyIn(before.columns, after.columns),
    literalsAdded: onlyIn(after.literals, before.literals),
    literalsRemoved: onlyIn(before.literals, after.literals),
    clausesAdded: onlyIn(after.clauses, before.clauses),
    clausesRemoved: onlyIn(before.clauses, after.clauses),
    aggregatesAdded: onlyIn(after.aggregates, before.aggregates),
    aggregatesRemoved: onlyIn(before.aggregates, after.aggregates),
    arityDelta: after.arity - before.arity,
    conjunctionDelta: after.conjunctions - before.conjunctions,
    subqueryDelta: after.subqueries - before.subqueries,
    ungrounded: introduced.filter((name) => !isGrounded(name, context, 'strict')),
    ungroundedLoose: introduced.filter((name) => !isGrounded(name, context, 'morphological')),
    grounded: introduced.filter((name) => isGrounded(name, context, 'strict')),
  };
}

/**
 * The one-word description of an edit, for the descriptive table.
 *
 * Precedence is fixed and stated rather than emergent: an imported name outranks a direction,
 * because a query can both narrow and import and the imported name is the part a filter could act
 * on. `narrowed` means the memory query constrains more than the baseline — more conjunctions, more
 * tables, more aggregates, or a shorter select list; `widened` is its mirror; `reshaped` is both at
 * once, which is what a rewrite rather than an adjustment looks like.
 */
export type DeltaKind = 'unchanged' | 'reworded' | 'imported-name' | 'narrowed' | 'widened' | 'reshaped' | 'rewritten';

/**
 * Clause words whose appearance narrows the result and whose disappearance widens it.
 *
 * `case`, `like`, `in`, `between`, `exists` and `over` are deliberately absent: each of them changes
 * *how* a column is computed without making the answer set smaller or larger, and counting them
 * would label a rewrite as a direction. `group`, `having`, `distinct`, `limit` and `join` all
 * reduce the rows a query returns, which is what "narrowed" means here.
 */
const NARROWING_CLAUSES: ReadonlySet<string> = new Set(['distinct', 'group', 'having', 'limit', 'join']);

/** The label for one delta. See `DeltaKind` for the precedence. */
export function kindOf(delta: QueryDelta): DeltaKind {
  if (delta.relation === 'unchanged') return 'unchanged';
  if (delta.relation === 'reworded') return 'reworded';
  if (delta.ungrounded.length > 0) return 'imported-name';
  const narrowed =
    delta.conjunctionDelta > 0 ||
    delta.tablesAdded.length > 0 ||
    delta.aggregatesAdded.length > 0 ||
    delta.arityDelta < 0 ||
    delta.subqueryDelta > 0 ||
    delta.clausesAdded.some((clause) => NARROWING_CLAUSES.has(clause));
  const widened =
    delta.conjunctionDelta < 0 ||
    delta.tablesRemoved.length > 0 ||
    delta.aggregatesRemoved.length > 0 ||
    delta.arityDelta > 0 ||
    delta.subqueryDelta < 0 ||
    delta.clausesRemoved.some((clause) => NARROWING_CLAUSES.has(clause));
  if (narrowed && widened) return 'reshaped';
  if (narrowed) return 'narrowed';
  if (widened) return 'widened';
  return 'rewritten';
}

/**
 * Whether a read-time gate would keep the memory query or fall back to writing without the pack.
 *
 * The registration licenses exactly one filter, and this is its predicate: *discard a query that
 * names something neither the question nor the evidence mentions*. It is available at read time —
 * the generated statement is in hand before it is executed — and it costs nothing to evaluate.
 *
 * Stated as a predicate rather than installed as behaviour on purpose. The estimate its effect
 * would carry is in-sample, computed on the same 1,534 questions that produced the hypothesis, and
 * a filter shipped on that basis would be R28's mistake repeated with a better story. R30 stage 2
 * buys the sample that can confirm it; until then the gate is a measurement.
 */
export function gateKeepsMemoryQuery(delta: QueryDelta, mode: GroundingMode = 'strict'): boolean {
  return (mode === 'strict' ? delta.ungrounded : delta.ungroundedLoose).length === 0;
}
