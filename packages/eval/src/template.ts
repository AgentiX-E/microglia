/**
 * R10: a rule as a structure with slots, because a sentence has no referent away from home.
 *
 * R9.4 put eighty rules on three hundred and eighty questions from databases they were not learned
 * in and read the result as a null: the cross-database delta was −2.27pp on the rules that had
 * worked at home, and the rates said why — the rule repaired 6.7% of the cases it could have helped
 * and broke 10.4% of the ones it could have harmed, while on its **own** questions the same material
 * broke 42.6%. A rule that is obeyed and wrong leaves a different fingerprint from a rule that is
 * ignored, and the foreign arm had the second one: "`price` is stored as text, cast before
 * comparing" has no `price` to be about in a database that calls it `unit_price`.
 *
 * Two published systems say the sentence is the defect and the memory need not be.
 *
 *  - **ODIS** (arXiv 2310.06302) separates the SQL distribution from the question distribution when
 *    it transports demonstrations, and gains on both cross-domain benchmarks it tries.
 *  - **SQL-Exchange** (arXiv 2508.07087, PVLDB 2026) maps a query into a target schema by keeping
 *    the query's **structure** and substituting only its domain-specific elements.
 *
 * So this module keeps a rule's structure and substitutes its domain-specific elements. The
 * structure is what survives the database boundary; the elements are the slots. A rule is distilled
 * as a sentence, read here as a template:
 *
 * ```
 * CAST({price} AS REAL) when {price} is TEXT and compared to a number
 * ```
 *
 * and before it is shown on a question from another database its slots are bound against **that**
 * database's schema. A template whose slots cannot be bound is withheld rather than shown unbound —
 * an unbound template is the sentence this module exists to replace.
 *
 * **Why the derivation is here and not in the distiller.** The distiller writes prose, and its
 * output is stored, audited and reproduced by every arm in this project. Changing what it emits
 * would change every artefact at once and make arm B incomparable to arm A on anything but the
 * template. Reading the statement structurally at *use* time makes arm B differ from arm A in one
 * field of one rendered line, which is the only form in which the comparison is a comparison.
 *
 * **Nothing here decides whether a bound template helps.** That is what the R10 dispatch measures.
 * This module's job is to be deterministic, to be cheap, and to be able to fail: a binder that
 * always binds is a binder nobody has checked against the schemas it will meet.
 */

/** A schema name, by the two kinds a rule can refer to. Lower-cased, as `schemaIndex` returns them. */
export type SchemaNames = {
  readonly tables: ReadonlySet<string>;
  readonly columns: ReadonlySet<string>;
};

/** An identifier in a rule's statement that its own database happens to have. */
export type SlotKind = 'column' | 'table';

export type TemplateSlot = {
  readonly name: string;
  readonly kind: SlotKind;
};

/** A rule's statement with its schema identifiers lifted out of it. */
export type RuleTemplate = {
  /** The statement, with every schema identifier replaced by `{name}`. */
  readonly text: string;
  /** Slots in order of first appearance, deduplicated. */
  readonly slots: readonly TemplateSlot[];
};

/** An identifier a statement can name. Three characters, for the reason `identifierTokens` gives. */
const IDENTIFIER = /[a-z_][a-z0-9_]{2,}/gi;

/**
 * Which kind of schema object a name is, or `undefined` when this database does not have it.
 *
 * Columns are asked about first. A database can have a table and a column of the same name, and
 * when it does, the statement is talking about the column: rules say "`rank` is sparse" about a
 * column, and a reader that bound that to the table would be substituting the wrong object.
 */
function kindOf(name: string, schema: SchemaNames): SlotKind | undefined {
  if (schema.columns.has(name)) return 'column';
  if (schema.tables.has(name)) return 'table';
  return undefined;
}

/**
 * Read a statement as a template against the schema it was written in.
 *
 * The home schema is the filter, not the statement: a rule can say "the second highest" or "a date
 * column", and there is no honest way to turn that into a slot. What this function can do is find
 * the identifiers that are **checkably** about the rule's own database, and those are the ones a
 * binding can carry across.
 */
export function templateOf(statement: string, schema: SchemaNames): RuleTemplate {
  const slots: TemplateSlot[] = [];
  const seen = new Set<string>();
  const text = statement.replace(IDENTIFIER, (match) => {
    const name = match.toLowerCase();
    const kind = kindOf(name, schema);
    if (kind === undefined) return match;
    const key = `${kind}\u0000${name}`;
    if (!seen.has(key)) {
      seen.add(key);
      slots.push({ name, kind });
    }
    return `{${name}}`;
  });
  return { text, slots };
}

/** What one slot was bound to, and how close the substitution was. */
export type BoundSlot = {
  readonly slot: TemplateSlot;
  readonly target: string;
  /** 1 for the same name, less as the names diverge. Carried so a reader can audit the binding. */
  readonly score: number;
};

export type Binding =
  | {
      readonly ok: true;
      readonly statement: string;
      readonly bindings: readonly BoundSlot[];
    }
  | {
      /** The template was withheld, and this is the slot that could not be bound. */
      readonly ok: false;
      readonly slot: TemplateSlot;
    };

/** The parts of a snake_case name, which is the unit a substitution is made of. */
function partsOf(name: string): ReadonlySet<string> {
  return new Set(name.split('_').filter((part) => part !== ''));
}

/**
 * How well one candidate stands in for a slot.
 *
 * Exact identity is 1; otherwise the score is the Jaccard overlap of the two names' parts. That
 * makes `price` → `unit_price` half a match and `price` → `price_per_unit` the same half, which is
 * the intended behaviour: both are the domain element the source rule named, restated in the target
 * schema's vocabulary. A candidate that shares no part at all scores zero and is never bound.
 *
 * There is no stemming and no edit distance. Both would raise the binding rate, and the rate is not
 * the quantity this stage optimises: a binder that invents a referent for `price` in a database
 * whose closest column is `prize` has produced a rule about prize money, and the arm would then
 * measure that.
 */
export function nameScore(slot: string, candidate: string): number {
  if (slot === candidate) return 1;
  const slotParts = partsOf(slot);
  const candidateParts = partsOf(candidate);
  let shared = 0;
  for (const part of slotParts) if (candidateParts.has(part)) shared += 1;
  return shared / (slotParts.size + candidateParts.size - shared);
}

/** Below this, two names share too little to be the same element under another name. */
const MIN_SCORE = 0.5;

/**
 * The candidate a slot binds to, or `undefined` when the target has nothing close enough.
 *
 * Ties are broken deterministically — shorter name first, then lexicographic — rather than treated
 * as failures. `price` matches both `unit_price` and `price_per_unit` at 0.5 on some schemas, and a
 * binder that refused every such case would withhold most of the family and measure itself instead
 * of the hypothesis; R10 says so in advance, and 60% withheld is its own kill condition. The
 * tie-break is the shorter name because it adds least to what the rule already said.
 */
function pickForSlot(
  slot: TemplateSlot,
  target: SchemaNames,
  taken: ReadonlySet<string>,
): { readonly target: string; readonly score: number } | undefined {
  const pool = slot.kind === 'column' ? target.columns : target.tables;
  let best: { target: string; score: number } | undefined;
  for (const candidate of pool) {
    // A target column already bound by another slot is not bound again: two slots of one template
    // are two different objects in the source database, and mapping both onto one is a rewrite the
    // rule never claimed.
    if (taken.has(`${slot.kind}\u0000${candidate}`)) continue;
    const score = nameScore(slot.name, candidate);
    if (score < MIN_SCORE) continue;
    if (
      best === undefined ||
      score > best.score ||
      (score === best.score &&
        (candidate.length < best.target.length ||
          (candidate.length === best.target.length && candidate < best.target)))
    ) {
      best = { target: candidate, score };
    }
  }
  return best;
}

/**
 * Bind a template against the database it is about to be shown in.
 *
 * All or nothing, on purpose. A template with one bound slot and one left as `{price}` reads to a
 * model as a rule about a column called `{price}`, which is the failure mode the whole construction
 * exists to remove; withholding the rule costs one injection and is visible in the artefact, while
 * showing it unbound would be an unmeasured defect inside a measurement.
 */
export function bindTemplate(template: RuleTemplate, target: SchemaNames): Binding {
  const bindings: BoundSlot[] = [];
  const taken = new Set<string>();
  for (const slot of template.slots) {
    const picked = pickForSlot(slot, target, taken);
    if (picked === undefined) return { ok: false, slot };
    taken.add(`${slot.kind}\u0000${picked.target}`);
    bindings.push({ slot, target: picked.target, score: picked.score });
  }
  let statement = template.text;
  for (const binding of bindings) {
    statement = statement.split(`{${binding.slot.name}}`).join(binding.target);
  }
  return { ok: true, statement, bindings };
}

/** What one rule's binding produced: shown, withheld, or carried as prose because it named nothing. */
export type TemplateOutcome =
  | { readonly status: 'bound'; readonly statement: string; readonly bindings: readonly BoundSlot[] }
  | { readonly status: 'slotless'; readonly statement: string }
  | { readonly status: 'withheld'; readonly slot: TemplateSlot };

/**
 * The one call a lane makes: a statement, the schema it was written in, the schema it is shown in.
 *
 * `slotless` is its own status rather than a `bound` with no bindings, because the two mean
 * different things to a reader. A rule with slots that all bound travelled structurally; a rule
 * with no schema identifiers at all did not travel, it was simply carried, and counting the second
 * as bound would inflate the form's coverage with rules that have no form.
 */
export function transferStatement(
  statement: string,
  home: SchemaNames,
  target: SchemaNames,
): TemplateOutcome {
  const template = templateOf(statement, home);
  if (template.slots.length === 0) return { status: 'slotless', statement };
  const binding = bindTemplate(template, target);
  return binding.ok
    ? { status: 'bound', statement: binding.statement, bindings: binding.bindings }
    : { status: 'withheld', slot: binding.slot };
}

/** How a family of rules travelled, which is what R10's third prediction is about. */
export type TemplateCoverage = {
  /** Attempts that reached the target schema with every slot bound. */
  readonly bound: number;
  /** Attempts with no schema identifier to bind: carried as prose. */
  readonly slotless: number;
  /** Attempts withheld because at least one slot had no referent in the target schema. */
  readonly withheld: number;
  /** Distinct rules behind those attempts, so a rule withheld in five databases counts once. */
  readonly rules: number;
  /** `withheld / (bound + slotless + withheld)`, or 0 when no attempt was made. */
  readonly withheldShare: number;
  /** Every distinct slot name that stopped an attempt, with the count. A reader can check the binder. */
  readonly blockers: readonly { readonly name: string; readonly kind: SlotKind; readonly attempts: number }[];
};

/**
 * One binding attempt: a rule, the database it was shown in, and what came out.
 *
 * The unit is the **attempt** and not the rule, because a template binds against a schema: one rule
 * can bind in `formula_1` and be withheld in `california_schools`, and a count of rules would have
 * to choose one of those to be wrong about. R10 states its third prediction over the family, which
 * this share answers; `rules` is carried beside it so the same reading can be made over rules when
 * one rule covers many targets.
 */
export type TemplateAttempt = {
  /** `<rule id>\u0000<database id>`: identity of the attempt, so a lane may report one per trial. */
  readonly key: string;
  readonly outcome: TemplateOutcome;
};

/**
 * Count what happened, over the attempts the binder made.
 *
 * The blockers are named rather than only counted: "20% were withheld" says the construction is
 * partial, "`rental_rates` stopped nine attempts" says which part, and the second is the sentence a
 * reader can check against a schema without re-running anything.
 *
 * Duplicate keys are collapsed rather than refused: the lane plans one attempt per rule per
 * database and then spends one call per question, so the same attempt arrives once per trial, and a
 * count that treated those as independent would report a binding rate that is a property of the
 * panel size.
 */
export function templateCoverage(attempts: readonly TemplateAttempt[]): TemplateCoverage {
  let bound = 0;
  let slotless = 0;
  let withheld = 0;
  const seen = new Set<string>();
  const ruleIds = new Set<string>();
  const blockers = new Map<string, { name: string; kind: SlotKind; attempts: number }>();
  for (const attempt of attempts) {
    if (seen.has(attempt.key)) continue;
    seen.add(attempt.key);
    ruleIds.add(attempt.key.split('\u0000')[0] as string);
    if (attempt.outcome.status === 'bound') bound += 1;
    else if (attempt.outcome.status === 'slotless') slotless += 1;
    else {
      withheld += 1;
      const key = `${attempt.outcome.slot.kind}\u0000${attempt.outcome.slot.name}`;
      const previous = blockers.get(key);
      blockers.set(key, {
        name: attempt.outcome.slot.name,
        kind: attempt.outcome.slot.kind,
        attempts: (previous?.attempts ?? 0) + 1,
      });
    }
  }
  const total = bound + slotless + withheld;
  return {
    bound,
    slotless,
    withheld,
    rules: ruleIds.size,
    withheldShare: total === 0 ? 0 : withheld / total,
    blockers: [...blockers.values()].sort(
      (left, right) => right.attempts - left.attempts || left.name.localeCompare(right.name),
    ),
  };
}

/** How a rule is shown on a foreign question: as the sentence it was distilled as, or bound. */
export type InjectionForm = 'prose' | 'bound';

/**
 * The stage's switch, parsed where it is read rather than at each use.
 *
 * An unknown value is a `RangeError` and not a fallback, for the reason the split parser gives: a
 * dispatch that meant to run arm B and ran arm A instead would produce a null result and be read as
 * a finding about templates. The default is the incumbent form, so a dispatch that says nothing
 * repeats R9.4 instead of silently becoming the new arm.
 */
export function injectionFormOf(raw: string | undefined): InjectionForm {
  if (raw === undefined || raw === '') return 'prose';
  if (raw === 'prose' || raw === 'bound') return raw;
  throw new RangeError(`Unknown injection form ${raw}; expected prose or bound`);
}
