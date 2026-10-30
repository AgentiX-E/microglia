/**
 * R11: bind the slot to the question, not to the spelling.
 *
 * R10 asked whether a rule travels when its *structure* does. It read every rule as a template whose
 * slots are the identifiers its own schema has, and bound those slots by comparing names against the
 * target database. Sixty-seven per cent of the family was withheld, and the blockers named the
 * reason: `posts`, `cards`, `drivers`, `lap`, `patient` — every one of them a **domain element**, the
 * word that makes a rule a rule about one database. A name comparison cannot replace a domain
 * element, because in the target database that element is called something else, or nothing.
 *
 * What the comparison never had was the one thing the lane already computes: for every question the
 * model is about to see, `linkSchema` decides which tables the question is *about*.
 *
 * ```
 * rule (home: codebase_community)   A post with an accepted answer has a non-NULL AcceptedAnswerId
 * slot                              table {posts}
 * target question                   "... how many badges were earned by the user who posted most ..."
 * target links                      users, badges
 * binding                           table slot -> users        (the table the question names)
 * shown                             A user with an accepted answer has a non-NULL AcceptedAnswerId
 * ```
 *
 * That is the construction, and it is a *hypothesis*, not an improvement: the rule now has a
 * referent, and the referent is a role the question fills. Whether a rule about `posts` says anything
 * true about `users` is exactly what the R11 dispatch measures, and this module's job is only to be
 * deterministic, to be cheap, and to be able to refuse.
 *
 * **Where the line is drawn.** A table slot is a *role*: the question names the table it is about,
 * and the rule's address is not its content. A column slot is *content*: "a column that holds a
 * display name where an id is expected" is knowledge about that column, and moving it to a column
 * that is not the same kind of thing produces a confident falsehood. So a column binds only where the
 * linked table has a column with name overlap **and** type agreement, and the rule is withheld
 * otherwise — the same all-or-nothing rule R10 fixes, applied to a narrower namespace.
 *
 * **Why types.** `price` is TEXT in one database and REAL in another, and a rule about casting it
 * says nothing about the second. The family comes from `PRAGMA table_info`, which is the database's
 * own answer, rather than from re-reading `CREATE TABLE` with a second grammar.
 */
import type { TableShape } from './sql-exec.js';
import { linkSchema, questionTokens } from './schema-link.js';
import {
  MIN_NAME_SCORE,
  nameScore,
  templateOf,
  templateCoverage,
  type BoundSlot,
  type CensusRule,
  type RuleTemplate,
  type SchemaNames,
  type TemplateCoverage,
  type TemplateOutcome,
  type WithheldReason,
} from './template.js';

/**
 * What a declared type is, for the purpose of deciding whether two columns hold the same kind of
 * thing.
 *
 * SQLite's own affinity rules, reduced to the five families a rule can care about. `other` matches
 * anything: an untyped declaration is an absence of information, and treating it as a disagreement
 * would withhold rules for a property of the dump rather than of the schema.
 */
export type TypeFamily = 'text' | 'integer' | 'real' | 'temporal' | 'blob' | 'other';

export function typeFamily(declared: string): TypeFamily {
  const text = declared.trim().toUpperCase();
  if (text === '') return 'other';
  if (text.includes('INT')) return 'integer';
  if (text.includes('CHAR') || text.includes('CLOB') || text.includes('TEXT') || text.includes('STRING')) return 'text';
  if (text.includes('BLOB')) return 'blob';
  if (text.includes('DATE') || text.includes('TIME')) return 'temporal';
  if (text.includes('REAL') || text.includes('FLOA') || text.includes('DOUB') || text.includes('DEC') || text.includes('NUM')) {
    return 'real';
  }
  return 'other';
}

/** Whether a candidate column holds the same kind of thing as the slot's own column. */
function sameFamily(left: TypeFamily, right: TypeFamily): boolean {
  return left === right || left === 'other' || right === 'other';
}

/**
 * The schema a rule is about to be shown in: the tables the question links, and which of those the
 * question itself names.
 *
 * `tables` is `linkSchema`'s answer, because a slot must be able to name a table the model will see.
 * `anchors` is the subset the question mentions — `linkSchema` adds key-neighbour tables so a pruned
 * prompt can still express the join, and those neighbours are consequences of the question rather
 * than things it names. Binding a rule's table slot to a join neighbour would be binding it to a
 * table the question never mentioned, which is the mistake this stage exists to avoid.
 */
export type LinkTarget = {
  readonly tables: readonly TableShape[];
  readonly anchors: ReadonlySet<string>;
};

/** Case-insensitive membership, which is the only thing the two sides agree on by construction. */
function lower(values: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const value of values) out.add(value.toLowerCase());
  return out;
}

/**
 * The target for one question.
 *
 * The anchors are recomputed here rather than read off `linkSchema`, because `linkSchema` returns
 * the kept set and not the reason each table is in it. The predicate is the same one — a table is an
 * anchor when its name or one of its columns appears in the question or the evidence — which is what
 * keeps the two answers consistent as the linker evolves.
 */
export function linkTargetOf(
  shapes: readonly TableShape[],
  ddl: string,
  question: string,
  evidence: string,
): LinkTarget {
  const kept = lower(linkSchema(ddl, question, evidence).kept);
  const tokens = questionTokens(`${question} ${evidence}`);
  const tables = shapes.filter((shape) => kept.has(shape.table));
  const anchors = new Set<string>();
  for (const shape of tables) {
    const named =
      tokens.has(shape.table) || shape.columns.some((column) => tokens.has(column.name));
    if (named) anchors.add(shape.table);
  }
  return { tables, anchors };
}

/** The namespace a rule was written in, as the template reader wants it. */
export function namesOf(shapes: readonly TableShape[]): SchemaNames {
  const tables = new Set<string>();
  const columns = new Set<string>();
  for (const shape of shapes) {
    tables.add(shape.table);
    for (const column of shape.columns) columns.add(column.name);
  }
  return { tables, columns };
}

/** A resolved referent, with how it was found. */
type Picked = {
  readonly target: string;
  readonly score: number;
  readonly via: 'name' | 'link';
};

/** What a slot's resolution produced: a referent, or the reason there is none. */
type Resolution<T extends Picked> =
  | { readonly ok: true; readonly picked: T }
  | { readonly ok: false; readonly reason: WithheldReason };

/**
 * The table a table slot names, in the order the evidence is strong enough to use.
 *
 * 1. **A name match among the linked tables.** The target spells the object the way the rule does;
 *    nothing needs to be invented, and it does not matter whether the question mentioned it.
 * 2. **The question's one anchor.** The question is about one table, so that table is what the rule
 *    is about; the score is 0 because nothing in the spelling said so, and `via` says why.
 * 3. **The shortest of several anchors.** A question that joins two tables leaves the role
 *    undetermined, and the shortest name is the tie-break the pre-registration fixes — the same one
 *    `pickForSlot` uses, for the same reason: a deterministic choice that is visible in the artefact
 *    is better than a withheld rule, and a tie in length withholds rather than choosing by alphabet.
 */
function pickTable(slot: string, target: LinkTarget, taken: ReadonlySet<string>): Resolution<Picked> {
  const free = target.tables.filter((shape) => !taken.has(shape.table));
  let best: Picked | undefined;
  for (const shape of free) {
    const score = nameScore(slot, shape.table);
    if (score < MIN_NAME_SCORE) continue;
    if (
      best === undefined ||
      score > best.score ||
      (score === best.score &&
        (shape.table.length < best.target.length ||
          (shape.table.length === best.target.length && shape.table < best.target)))
    ) {
      best = { target: shape.table, score, via: 'name' };
    }
  }
  if (best !== undefined) return { ok: true, picked: best };
  const anchored = free.filter((shape) => target.anchors.has(shape.table));
  if (anchored.length === 0) return { ok: false, reason: 'no-table' };
  if (anchored.length === 1) {
    return { ok: true, picked: { target: (anchored[0] as TableShape).table, score: 0, via: 'link' } };
  }
  return shortestOf(anchored);
}

/** The shortest name among several, or nothing when two are equally short: a tie is not a referent. */
function shortestOf(shapes: readonly TableShape[]): Resolution<Picked> {
  const shortest = Math.min(...shapes.map((shape) => shape.table.length));
  const tied = shapes.filter((shape) => shape.table.length === shortest);
  if (tied.length !== 1) return { ok: false, reason: 'table-tie' };
  return { ok: true, picked: { target: (tied[0] as TableShape).table, score: 0, via: 'link' } };
}

/**
 * The column a column slot names, inside the table the rule was bound to.
 *
 * The scope is the bound table when the template has one, and the whole linked schema when it does
 * not: a rule that names a column and no table is a statement about this database's vocabulary, and
 * the question's links are the vocabulary it will meet. A candidate must agree in *kind* — name
 * overlap alone would bind `price` (TEXT) to a `price` (REAL) column that means something else —
 * and a slot with no candidate withholds the rule rather than degrading it.
 */
function pickColumn(
  slot: string,
  home: readonly TableShape[],
  target: LinkTarget,
  scope: string | undefined,
  taken: ReadonlySet<string>,
): Resolution<Picked & { readonly table: string }> {
  const homeFamilies = new Map<string, TypeFamily>();
  for (const shape of home) {
    for (const column of shape.columns) {
      if (!homeFamilies.has(column.name)) homeFamilies.set(column.name, typeFamily(column.type));
    }
  }
  const wanted = homeFamilies.get(slot) ?? 'other';
  const pool = scope === undefined ? target.tables : target.tables.filter((shape) => shape.table === scope);
  let best: (Picked & { readonly table: string }) | undefined;
  let named = false;
  for (const shape of pool) {
    for (const column of shape.columns) {
      if (taken.has(`${shape.table}\u0000${column.name}`)) continue;
      const score = nameScore(slot, column.name);
      if (score < MIN_NAME_SCORE) continue;
      named = true;
      if (!sameFamily(wanted, typeFamily(column.type))) continue;
      if (
        best === undefined ||
        score > best.score ||
        (score === best.score &&
          (column.name.length < best.target.length ||
            (column.name.length === best.target.length && column.name < best.target)))
      ) {
        best = { table: shape.table, target: column.name, score, via: 'name' };
      }
    }
  }
  if (best === undefined) return { ok: false, reason: named ? 'column-kind' : 'no-column' };
  return { ok: true, picked: best };
}

/**
 * Bind a template against the schema the target question links.
 *
 * Two passes, because a column's namespace is a table: every table slot resolves first, then every
 * column slot resolves inside the table the template's first table slot reached. `bindings` is
 * therefore ordered tables before columns, which is the order they were resolved in — the rendered
 * statement does not depend on it, since each slot name is replaced wherever it occurs.
 */
export function bindLinked(
  template: RuleTemplate,
  home: readonly TableShape[],
  target: LinkTarget,
): TemplateOutcome {
  if (template.slots.length === 0) return { status: 'slotless', statement: template.text };
  const bindings: BoundSlot[] = [];
  const takenTables = new Set<string>();
  const takenColumns = new Set<string>();
  const replaced = new Map<string, string>();
  let scope: string | undefined;
  for (const slot of template.slots) {
    if (slot.kind !== 'table') continue;
    const resolution = pickTable(slot.name, target, takenTables);
    if (!resolution.ok) return { status: 'withheld', slot, reason: resolution.reason };
    const picked = resolution.picked;
    takenTables.add(picked.target);
    if (scope === undefined) scope = picked.target;
    replaced.set(slot.name, picked.target);
    bindings.push({ slot, target: picked.target, score: picked.score, via: picked.via });
  }
  for (const slot of template.slots) {
    if (slot.kind !== 'column') continue;
    const resolution = pickColumn(slot.name, home, target, scope, takenColumns);
    if (!resolution.ok) return { status: 'withheld', slot, reason: resolution.reason };
    const picked = resolution.picked;
    takenColumns.add(`${picked.table}\u0000${picked.target}`);
    replaced.set(slot.name, picked.target);
    bindings.push({ slot, target: picked.target, score: picked.score, via: picked.via });
  }
  let statement = template.text;
  for (const [name, replacement] of replaced) statement = statement.split(`{${name}}`).join(replacement);
  return { status: 'bound', statement, bindings };
}

/** The one call a lane makes: a statement, the schema it was written in, the one it is shown in. */
export function transferLinked(
  statement: string,
  home: readonly TableShape[],
  target: LinkTarget,
): TemplateOutcome {
  return bindLinked(templateOf(statement, namesOf(home)), home, target);
}

/** One question the binder may be shown, with the identity a rate is counted against. */
export type LinkedQuestion = {
  readonly id: string;
  readonly dbId: string;
  readonly question: string;
  readonly evidence: string;
};

/**
 * What the binder would do with a store and a set of questions, before a call is bought.
 *
 * Two shares, because they answer different questions. `withheldShare` counts **attempts** — one
 * attempt is one injection that will not happen — and it is the number the kill condition names:
 * the arm withholds per (rule, question) panel cell, so that is the unit that decides whether the
 * measurement is about the binder. `rulesWithheldShare` counts **rules**, which is how R10's 66.8%
 * was stated and therefore the number the two stages have to be compared on.
 */
export type LinkedCensus = {
  readonly rules: number;
  readonly duplicates: number;
  readonly homeless: number;
  readonly unplaced: number;
  /** Distinct questions from a database other than the rule's, over the whole family. */
  readonly questions: number;
  readonly coverage: TemplateCoverage;
  readonly rulesBound: number;
  readonly rulesSlotless: number;
  readonly rulesWithheld: number;
  /** Withheld attempts over all attempts: the pre-registered kill condition. */
  readonly withheldShare: number;
  /** Withheld rules over attempted rules: the reading R10 reported, so the two are comparable. */
  readonly rulesWithheldShare: number;
};

/**
 * Run the binder over every rule and every foreign question it could be shown on.
 *
 * Pure and offline: the schemas and the links are the only inputs, so a census that would cost 2,600
 * model calls costs nothing and can be run before the arm is paid for. A rule whose home database is
 * not among the questions is counted as `unplaced` rather than as a binder failure, and a rule with
 * no home database is `homeless` for the reason R10's census gives.
 */
export function linkedCensus(
  rules: readonly CensusRule[],
  questions: readonly LinkedQuestion[],
  home: (dbId: string) => readonly TableShape[],
  linkOf: (question: LinkedQuestion) => LinkTarget,
): LinkedCensus {
  const seen = new Set<string>();
  const unique: CensusRule[] = [];
  for (const rule of rules) {
    if (seen.has(rule.id)) continue;
    seen.add(rule.id);
    unique.push(rule);
  }
  const attempts: { key: string; outcome: TemplateOutcome }[] = [];
  const byId = new Map<string, LinkedQuestion>();
  for (const question of questions) if (!byId.has(question.id)) byId.set(question.id, question);
  const all = [...byId.values()];
  const foreign = new Map<string, readonly LinkedQuestion[]>();
  const outside = (dbId: string): readonly LinkedQuestion[] => {
    const hit = foreign.get(dbId);
    if (hit !== undefined) return hit;
    const list = all.filter((question) => question.dbId !== dbId);
    foreign.set(dbId, list);
    return list;
  };
  let homeless = 0;
  let unplaced = 0;
  let rulesBound = 0;
  let rulesSlotless = 0;
  let rulesWithheld = 0;
  for (const rule of unique) {
    if (rule.domain === null) {
      homeless += 1;
      continue;
    }
    const homeShapes = home(rule.domain);
    const targets = outside(rule.domain);
    if (homeShapes.length === 0 || targets.length === 0) {
      unplaced += 1;
      continue;
    }
    let boundAny = false;
    let slotlessAny = false;
    for (const question of targets) {
      const outcome = transferLinked(rule.statement, homeShapes, linkOf(question));
      attempts.push({ key: `${rule.id}\u0000${question.id}`, outcome });
      if (outcome.status === 'bound') boundAny = true;
      else if (outcome.status === 'slotless') slotlessAny = true;
    }
    if (boundAny) rulesBound += 1;
    else if (slotlessAny) rulesSlotless += 1;
    else rulesWithheld += 1;
  }
  const attempted = rulesBound + rulesSlotless + rulesWithheld;
  const coverage = templateCoverage(attempts);
  return {
    rules: unique.length,
    duplicates: rules.length - unique.length,
    homeless,
    unplaced,
    questions: byId.size,
    coverage,
    rulesBound,
    rulesSlotless,
    rulesWithheld,
    withheldShare: coverage.withheldShare,
    rulesWithheldShare: attempted === 0 ? 0 : rulesWithheld / attempted,
  };
}
