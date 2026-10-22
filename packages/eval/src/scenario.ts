/**
 * The offline study workload.
 *
 * ## What this is, and what it is not
 *
 * This is a **controlled mechanism study**, not a benchmark result. It isolates
 * one variable — whether corrected outputs become knowledge that transfers to
 * unseen questions — by holding the generator fixed and using a deterministic
 * recommender with known systematic defects. That control is what makes the
 * effect measurable at all; it is also why the numbers must never be quoted as
 * a claim about chart-model quality.
 *
 * The held-out set uses a **different measure and a different category field**
 * than the feedback set, within the same schemas. A rule that memorised
 * `revenue` cannot pass it; a rule that learned "trend → line" can.
 *
 * ## The defect families
 *
 * The baseline recommender has six documented defects, each a plausible
 * confusion rather than random noise:
 *
 *   D1 trend           -> bar        (should be line)
 *   D2 composition >5  -> pie        (should be bar)
 *   D3 distribution    -> bar        (should be boxplot)
 *   D4 correlation     -> bar        (should be scatter)
 *   D5 matrix          -> bar        (should be heatmap)
 *   D6 comparison/fin  -> pie        (should be bar; domain-specific)
 *
 * A seventh intent (`ranking`) is already correct and acts as a control: a
 * correct result must not be "corrected" into something else.
 */
import {
  DOMAINS,
  chartInterpreter,
  constraintMatches,
  fieldsWithRole,
  type ChartConstraint,
  type ChartIntent,
  type ChartMark,
  type ChartSpec,
  type DomainSchema,
  type FieldDef,
} from './workload/index.js';
import { MicrogliaError, type Json, type KnowledgePack } from '@agentix-e/microglia-core';

export { DOMAINS } from './workload/index.js';

export const INTENTS: readonly ChartIntent[] = [
  'trend',
  'comparison',
  'composition',
  'distribution',
  'correlation',
  'matrix',
  'ranking',
];

export type Query = {
  readonly id: string;
  readonly text: string;
  readonly domain: string;
  readonly intent: ChartIntent;
  readonly field: string;
  readonly measureB: string;
  readonly category: string;
  readonly temporal: string;
  readonly categoryCount: number;
  readonly grain: 'day' | 'month' | 'quarter';
};

export type CorpusItem = {
  readonly id: string;
  readonly query: Query;
  readonly gold: ChartSpec;
  readonly baseline: ChartSpec;
};

/** The reference policy. It is a rule, not a model: that is the point. */
export function goldMark(intent: ChartIntent, categoryCount: number): ChartMark {
  switch (intent) {
    case 'trend':
      return 'line';
    case 'comparison':
    case 'ranking':
      return 'bar';
    case 'composition':
      return categoryCount > 5 ? 'bar' : 'pie';
    case 'distribution':
      return 'boxplot';
    case 'correlation':
      return 'scatter';
    case 'matrix':
      return 'heatmap';
  }
}

/** The baseline's six defects, stated in one place so the report can narrate them. */
export function baselineMark(intent: ChartIntent, domain: string): ChartMark {
  switch (intent) {
    case 'trend':
      return 'bar'; // D1
    case 'comparison':
      // In finance the baseline reads "compare" as "share of total" and emits a
      // pie. Wrong, but a legal chart: the study measures choice, not validity.
      return domain === 'finance' ? 'pie' : 'bar'; // D6
    case 'composition':
      return 'pie'; // D2, wrong above five categories
    case 'distribution':
      return 'bar'; // D3
    case 'correlation':
      // `bar` rather than `line`: the baseline must emit a *valid* chart that is
      // wrong, otherwise the study would be measuring schema rejection instead
      // of a chart-choice error.
      return 'bar'; // D4
    case 'matrix':
      return 'bar'; // D5
    case 'ranking':
      return 'bar';
  }
}

export function specFor(query: Query, mark: ChartMark): ChartSpec {
  const aggregate =
    query.intent === 'distribution' || query.intent === 'correlation' ? 'none' : 'sum';
  if (query.intent === 'correlation') {
    return { mark, x: query.field, y: query.measureB, aggregate };
  }
  if (query.intent === 'distribution' || query.intent === 'ranking') {
    return { mark, x: query.category, y: query.field, aggregate };
  }
  if (query.intent === 'matrix') {
    return { mark, x: query.category, y: query.field, aggregate, series: query.temporal };
  }
  if (query.intent === 'comparison' || query.intent === 'composition') {
    return { mark, x: query.category, y: query.field, aggregate };
  }
  return { mark, x: query.temporal, y: query.field, aggregate };
}

const GRAINS = ['day', 'month', 'quarter'] as const;
const COUNTS = [3, 4, 5, 6, 8, 10] as const;

/**
 * A domain reduced to the columns the study needs, already validated.
 *
 * The corpus generator used to index `fieldsWithRole(...)` and skip a malformed
 * domain with `continue`, which silently shortened the corpus. A short corpus is
 * indistinguishable from a smaller `count`, so a broken schema registration
 * would have looked like a cheaper experiment rather than a bug. Resolving the
 * registry up front turns that into a startup failure with the domain's name in
 * it, and lets the loop below index tuples instead of optionals.
 */
export type DomainSlot = {
  readonly name: string;
  readonly temporal: FieldDef;
  /** Train uses index 0, holdout index 1: distinct columns, same schema. */
  readonly categories: readonly [FieldDef, FieldDef];
  readonly measures: readonly [FieldDef, FieldDef];
};

function requirePair(domain: DomainSchema, role: 'category' | 'measure'): readonly [FieldDef, FieldDef] {
  const [first, second] = fieldsWithRole(domain, role);
  if (first === undefined || second === undefined) {
    throw new MicrogliaError(
      'MG_E_SCHEMA_INVALID',
      `Domain '${domain.name}' needs at least two '${role}' fields`,
      { domain: domain.name, role, found: fieldsWithRole(domain, role).length },
    );
  }
  return [first, second];
}

function requireTemporal(domain: DomainSchema): FieldDef {
  const field = fieldsWithRole(domain, 'temporal')[0];
  if (field === undefined) {
    throw new MicrogliaError('MG_E_SCHEMA_INVALID', `Domain '${domain.name}' needs a 'temporal' field`, {
      domain: domain.name,
    });
  }
  return field;
}

export function resolveDomain(domain: DomainSchema): DomainSlot {
  return {
    name: domain.name,
    temporal: requireTemporal(domain),
    categories: requirePair(domain, 'category'),
    measures: requirePair(domain, 'measure'),
  };
}

export function resolveRegistry(registry: readonly DomainSchema[]): readonly DomainSlot[] {
  if (registry.length === 0) {
    throw new MicrogliaError('MG_E_SCHEMA_INVALID', 'The domain registry is empty');
  }
  return registry.map(resolveDomain);
}

/**
 * Build a deterministic corpus.
 *
 * `phase` selects which measure and category field the question uses. Train and
 * holdout therefore share schemas and intents but not the concrete columns,
 * which is the cheapest honest test of transfer.
 */
export function buildCorpus(
  seed: number,
  count: number,
  phase: 'train' | 'holdout',
  registry: readonly DomainSchema[] = DOMAINS,
): readonly CorpusItem[] {
  void seed; // The index is the schedule; the seed names the corpus for the report.
  const slots = resolveRegistry(registry);
  const items: CorpusItem[] = [];

  // Cyclic product of domains, written as a nested loop so every index is known
  // to be in range: no `??` fallback, and no skipped iteration that would make a
  // broken registry look like a smaller corpus.
  schedule: for (let base = 0; base < count; base += slots.length) {
    for (const [offset, slot] of slots.entries()) {
      const i = base + offset;
      if (i >= count) break schedule;
      const intent = INTENTS[i % INTENTS.length] as ChartIntent;
      const holdout = phase === 'holdout';
      const measure = slot.measures[holdout ? 1 : 0];
      const measureB = slot.measures[holdout ? 0 : 1];
      const category = slot.categories[holdout ? 1 : 0];
      const categoryCount = intent === 'composition' ? (COUNTS[i % COUNTS.length] as number) : 4;
      const grain = GRAINS[i % GRAINS.length] as Query['grain'];

      const query: Query = {
        id: `${holdout ? 'ho' : 'tr'}_${String(i).padStart(4, '0')}`,
        text: questionText(intent, slot.name, measure.name, category.name, measureB.name, grain),
        domain: slot.name,
        intent,
        field: measure.name,
        measureB: measureB.name,
        category: category.name,
        temporal: slot.temporal.name,
        categoryCount,
        grain,
      };
      items.push({
        id: query.id,
        query,
        gold: specFor(query, goldMark(intent, categoryCount)),
        baseline: specFor(query, baselineMark(intent, slot.name)),
      });
    }
  }
  return items;
}

/**
 * The question a case asks, in prose.
 *
 * Exported because a corpus that is not built by `buildCorpus` still has to ask
 * the reader the same way: two spellings of "compare X across Y" would rank
 * differently against the same store, and a lane that invents its own wording is
 * measuring retrieval drift rather than knowledge.
 */
export function questionText(
  intent: ChartIntent,
  domain: string,
  measure: string,
  category: string,
  measureB: string,
  grain: string,
): string {
  switch (intent) {
    case 'trend':
      return `How has ${measure} changed by ${grain} in ${domain}?`;
    case 'comparison':
      return `Compare ${measure} across ${category} in ${domain}.`;
    case 'composition':
      return `What share of ${measure} comes from each ${category} in ${domain}?`;
    case 'distribution':
      return `Show the distribution of ${measure} in ${domain}.`;
    case 'correlation':
      return `Is ${measure} related to ${measureB} in ${domain}?`;
    case 'matrix':
      return `Show ${measure} by ${category} and ${grain} in ${domain}.`;
    case 'ranking':
      return `Which ${category} has the highest ${measure} in ${domain}?`;
  }
}

/**
 * The run input a chart host records at generation time.
 *
 * The interpreter scopes a lesson by these fields, so a lane that records a run
 * without them produces an edit no interpreter can classify — the quiet way a
 * lane can end up measuring nothing.
 */
export function queryFeatures(query: Query): Record<string, Json> {
  return {
    question: query.text,
    domain: query.domain,
    intent: query.intent,
    field: query.field,
    categoryCount: query.categoryCount,
    grain: query.grain,
  };
}

/**
 * The reader: a deterministic surrogate for a prompt-conditioned generator.
 *
 * It applies the most specific matching constraint, then the most confident.
 * That ordering is the whole reason scope generalisation helps: a domain rule
 * outranks a global one, and a global rule still reaches every domain.
 */
export function applyKnowledge(pack: KnowledgePack, item: CorpusItem): ChartSpec {
  const matching = pack.items
    .filter((entry) => entry.status === 'active')
    .map((entry) => ({ entry, payload: entry.payload as ChartConstraint | undefined }))
    .filter(
      (candidate): candidate is { entry: (typeof pack.items)[number]; payload: ChartConstraint } =>
        candidate.payload !== undefined && constraintMatches(candidate.payload, item.query),
    );

  if (matching.length === 0) return item.baseline;

  // `reduce` rather than `sort`: the winner is a maximum of a total order, and a
  // maximum needs no array-wide sort or an index that the type system must then
  // be told exists.
  const winner = matching.reduce((best, candidate) =>
    outranks(candidate, best) ? candidate : best,
  );
  return { ...item.baseline, mark: winner.payload.then.mark };
}

/**
 * The reader's preference order, in one place.
 *
 * More specific scope wins first (a domain rule beats a global one); at equal
 * specificity the more confident rule wins; at equal confidence the smaller id
 * wins so that two runs over the same store return the same pack.
 */
function outranks(
  a: { entry: KnowledgePack['items'][number] },
  b: { entry: KnowledgePack['items'][number] },
): boolean {
  const specificityA = scopeSize(a.entry);
  const specificityB = scopeSize(b.entry);
  if (specificityA !== specificityB) return specificityA > specificityB;
  if (a.entry.confidence !== b.entry.confidence) return a.entry.confidence > b.entry.confidence;
  return a.entry.id < b.entry.id;
}

function scopeSize(entry: KnowledgePack['items'][number]): number {
  const scope = entry.scope;
  let size = 1;
  if (scope.domain !== undefined) size += 1;
  if (scope.intent !== undefined) size += 1;
  if (scope.field !== undefined) size += 1;
  return size;
}

/** Exported so the study can reuse the exact interpreter the pack ships. */
export { chartInterpreter };
