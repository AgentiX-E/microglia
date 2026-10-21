/**
 * Chart specification and the edit taxonomy for a data-to-chart host.
 *
 * The pack exists to answer one question the generic core cannot: *what did the
 * user change, semantically?* A raw JSON diff on `{mark:"bar"}` → `{mark:"line"}`
 * is a string change; here it is `chart_type_wrong`, which is the unit a
 * correction can be learned and scoped at.
 */
import type { Json, JsonObject, KnowledgeScope } from '@agentix-e/microglia-core';

export type ChartMark = 'bar' | 'line' | 'pie' | 'scatter' | 'heatmap' | 'boxplot';

export const CHART_MARKS: readonly ChartMark[] = [
  'bar',
  'line',
  'pie',
  'scatter',
  'heatmap',
  'boxplot',
];

export type ChartIntent =
  | 'trend'
  | 'comparison'
  | 'composition'
  | 'distribution'
  | 'correlation'
  | 'matrix'
  | 'ranking';

export type Aggregate = 'sum' | 'avg' | 'count' | 'none';

export type ChartSpec = {
  readonly mark: ChartMark;
  readonly x: string;
  readonly y: string;
  readonly aggregate: Aggregate;
  readonly series?: string;
};

export type FieldRole = 'temporal' | 'category' | 'measure';

export type FieldDef = {
  readonly name: string;
  readonly role: FieldRole;
};

export type DomainSchema = {
  readonly name: string;
  readonly fields: readonly FieldDef[];
};

/**
 * A deliberately small schema registry. It is enough to make scope and
 * cardinality real, and small enough that every correction can be traced to a
 * field role rather than to an opaque embedding.
 */
export const DOMAINS: readonly DomainSchema[] = [
  {
    name: 'sales',
    fields: [
      { name: 'order_date', role: 'temporal' },
      { name: 'product', role: 'category' },
      { name: 'region', role: 'category' },
      { name: 'channel', role: 'category' },
      { name: 'revenue', role: 'measure' },
      { name: 'units', role: 'measure' },
    ],
  },
  {
    name: 'hr',
    fields: [
      { name: 'hire_date', role: 'temporal' },
      { name: 'department', role: 'category' },
      { name: 'level', role: 'category' },
      { name: 'headcount', role: 'measure' },
      { name: 'attrition', role: 'measure' },
    ],
  },
  {
    name: 'finance',
    fields: [
      { name: 'month', role: 'temporal' },
      { name: 'cost_center', role: 'category' },
      { name: 'account', role: 'category' },
      { name: 'spend', role: 'measure' },
      { name: 'budget', role: 'measure' },
    ],
  },
  {
    name: 'ops',
    fields: [
      { name: 'event_ts', role: 'temporal' },
      { name: 'warehouse', role: 'category' },
      { name: 'carrier', role: 'category' },
      { name: 'shipments', role: 'measure' },
      { name: 'delay_minutes', role: 'measure' },
    ],
  },
];

export function domainByName(name: string): DomainSchema | undefined {
  return DOMAINS.find((domain) => domain.name === name);
}

export function fieldsWithRole(domain: DomainSchema, role: FieldRole): readonly FieldDef[] {
  return domain.fields.filter((field) => field.role === role);
}

/** Everything the distiller needs to know about the query that produced a chart. */
export type QueryFeatures = {
  readonly domain: string;
  readonly intent: ChartIntent;
  readonly field: string;
  /** Distinct categories the query groups by, when the intent groups at all. */
  readonly categoryCount?: number;
  /** Time grain, when the intent is temporal. */
  readonly grain?: 'day' | 'month' | 'quarter';
};

const MARKS = new Set<string>(CHART_MARKS);

export function isChartSpec(value: Json): value is ChartSpec & Json {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as { [key: string]: Json };
  if (typeof record['mark'] !== 'string' || !MARKS.has(record['mark'])) return false;
  if (typeof record['x'] !== 'string' || typeof record['y'] !== 'string') return false;
  if (typeof record['aggregate'] !== 'string') return false;
  return true;
}

export function assertChartSpec(value: Json): ChartSpec {
  if (!isChartSpec(value)) {
    throw new TypeError('Value is not a chart specification');
  }
  return {
    mark: value.mark,
    x: value.x,
    y: value.y,
    aggregate: value.aggregate,
    ...(value.series === undefined ? {} : { series: value.series }),
  };
}

/**
 * Canonical form: key order is fixed so that two equivalent specs hash equal.
 *
 * `structuredClone` of the input is not used on purpose; the output is a new
 * literal with the five fields in a declared order, which is what makes the
 * hash stable across engines.
 */
export function canonicalChart(spec: ChartSpec): JsonObject {
  const out: JsonObject = {
    mark: spec.mark,
    x: spec.x,
    y: spec.y,
    aggregate: spec.aggregate,
  };
  if (spec.series !== undefined) out['series'] = spec.series;
  return out;
}

/** Field-level validity, used by the host before a chart is ever shown. */
export type ChartViolation =
  | 'pie_requires_aggregate'
  | 'line_requires_temporal_x'
  | 'scatter_requires_numeric_xy'
  | 'heatmap_requires_two_dimensions'
  | 'unknown_field'
  | 'y_must_be_measure';

export function validateChartSpec(spec: ChartSpec, domain: DomainSchema): readonly ChartViolation[] {
  const violations: ChartViolation[] = [];
  const byName = new Map(domain.fields.map((field) => [field.name, field.role]));
  const xRole = byName.get(spec.x);
  const yRole = byName.get(spec.y);

  if (xRole === undefined || yRole === undefined) violations.push('unknown_field');
  if (yRole !== undefined && yRole !== 'measure' && spec.mark !== 'heatmap') {
    violations.push('y_must_be_measure');
  }
  if (spec.mark === 'pie' && spec.aggregate === 'none') violations.push('pie_requires_aggregate');
  if (spec.mark === 'line' && xRole !== 'temporal') violations.push('line_requires_temporal_x');
  if (spec.mark === 'scatter' && (xRole !== 'measure' || yRole !== 'measure')) {
    violations.push('scatter_requires_numeric_xy');
  }
  if (spec.mark === 'heatmap' && spec.series === undefined) {
    violations.push('heatmap_requires_two_dimensions');
  }
  return violations;
}

export type EditCode =
  | 'chart_type_wrong'
  | 'encoding_wrong'
  | 'aggregation_wrong'
  | 'series_wrong';

export type ChartEdit = {
  readonly code: EditCode;
  readonly before: ChartSpec;
  readonly after: ChartSpec;
};

/**
 * Classify a structured edit. Precedence matters: a type change that also moves
 * an encoding is still primarily a type correction, because that is the lesson
 * a user would state out loud.
 */
export function classifyChartEdit(before: ChartSpec, after: ChartSpec): ChartEdit | null {
  if (before.mark !== after.mark) return { code: 'chart_type_wrong', before, after };
  if (before.x !== after.x || before.y !== after.y) return { code: 'encoding_wrong', before, after };
  if (before.aggregate !== after.aggregate) {
    return { code: 'aggregation_wrong', before, after };
  }
  if (before.series !== after.series) return { code: 'series_wrong', before, after };
  return null;
}

/**
 * Semantic distance for an edit, in [0, 1].
 *
 * A chart-type change touches one field of four, so the generic leaf distance
 * reports 0.125 — "a small edit". It is not: it changes what the reader sees.
 * The pack therefore supplies the weight, and the generic layer uses it in
 * place of its own count. Returning `undefined` means "not a chart edit; use the
 * structural distance".
 */
export function chartEditDistance(before: Json, after: Json): number | undefined {
  if (!isChartSpec(before) || !isChartSpec(after)) return undefined;
  const edit = classifyChartEdit(assertChartSpec(before), assertChartSpec(after));
  if (!edit) return 0;
  switch (edit.code) {
    case 'chart_type_wrong':
      return 1;
    case 'encoding_wrong':
      return 0.6;
    case 'aggregation_wrong':
      return 0.4;
    case 'series_wrong':
      return 0.3;
  }
}

/**
 * The structured predicate a correction teaches.
 *
 * A statement alone is not enough: a host LLM may read the prose, but a
 * deterministic host needs the condition. Both are produced from the same edit
 * so they cannot drift.
 */
export type ChartConstraint = {
  readonly when: {
    readonly intent?: ChartIntent;
    readonly domain?: string;
    readonly field?: string;
    readonly minCategories?: number;
    readonly maxCategories?: number;
  };
  readonly then: { readonly mark: ChartMark };
};

export type ChartLesson = {
  readonly code: EditCode;
  readonly scope: KnowledgeScope;
  readonly statement: string;
  readonly payload: ChartConstraint;
};

/**
 * Turn an edit into a scoped lesson.
 *
 * Scope policy, stated once: the scope starts at the *domain and intent* of the
 * run, and the payload carries the cardinality predicate when the intent has
 * one. The measured field is deliberately **not** part of the lesson: a chart
 * type follows from the analytical intent, not from which measure was selected,
 * and binding the rule to `revenue` would mean re-learning it for `units`.
 *
 * Narrowing is the distiller's job: it can drop the domain when the same lesson
 * recurs elsewhere. Widening here would make one user's correction global on
 * its first observation, which is how a preference becomes a policy.
 */
export function describeChartEdit(edit: ChartEdit, features: QueryFeatures): ChartLesson | null {
  if (edit.code !== 'chart_type_wrong') return null;

  const when: {
    intent?: ChartIntent;
    domain?: string;
    field?: string;
    minCategories?: number;
    maxCategories?: number;
  } = { intent: features.intent };
  if (features.intent === 'composition' && features.categoryCount !== undefined) {
    // "Too many slices" is the only cardinality predicate the taxonomy needs.
    if (features.categoryCount > 5) when.minCategories = 6;
    else when.maxCategories = 5;
  }

  const payload: ChartConstraint = { when, then: { mark: edit.after.mark } };

  const condition = describeCondition(features, when);
  const statement = `${condition} use a ${edit.after.mark} chart rather than a ${edit.before.mark} chart.`;

  return {
    code: edit.code,
    scope: {
      task: 'chart.recommend',
      domain: features.domain,
      intent: features.intent,
    },
    statement,
    payload,
  };
}

/**
 * The prose deliberately omits the domain.
 *
 * Scope carries the domain, and a statement that names it cannot be reused when
 * the same lesson recurs elsewhere. Keeping the sentence domain-free is what
 * lets `generalize` widen a rule without rewriting a user-facing claim.
 */
function describeCondition(features: QueryFeatures, when: ChartConstraint['when']): string {
  const parts: string[] = [`For a ${features.intent} question over ${features.field}`];
  if (when.minCategories !== undefined) {
    parts.push(`with more than ${when.minCategories - 1} categories`);
  } else if (when.maxCategories !== undefined) {
    parts.push(`with at most ${when.maxCategories} categories`);
  }
  return `${parts.join(' ')}.`;
}

/** Render the payload as a compact, auditable clause for humans reading a pack. */
export function renderConstraint(payload: ChartConstraint): string {
  const when = payload.when;
  const parts: string[] = [];
  if (when.intent) parts.push(`intent=${when.intent}`);
  if (when.domain) parts.push(`domain=${when.domain}`);
  if (when.field) parts.push(`field=${when.field}`);
  if (when.minCategories !== undefined) parts.push(`categories>=${when.minCategories}`);
  if (when.maxCategories !== undefined) parts.push(`categories<=${when.maxCategories}`);
  return `${parts.join(' AND ')} -> mark=${payload.then.mark}`;
}

/** Narrow a payload's condition to the dimensions that are actually stated. */
export function constraintMatches(payload: ChartConstraint, features: QueryFeatures): boolean {
  const when = payload.when;
  if (when.intent !== undefined && when.intent !== features.intent) return false;
  if (when.domain !== undefined && when.domain !== features.domain) return false;
  if (when.field !== undefined && when.field !== features.field) return false;
  if (when.minCategories !== undefined && (features.categoryCount ?? 0) < when.minCategories) {
    return false;
  }
  if (when.maxCategories !== undefined && (features.categoryCount ?? 0) > when.maxCategories) {
    return false;
  }
  return true;
}
