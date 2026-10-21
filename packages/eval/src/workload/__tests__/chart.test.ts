import { describe, expect, it } from 'vitest';
import {
  CHART_MARKS,
  assertChartSpec,
  canonicalChart,
  classifyChartEdit,
  constraintMatches,
  describeChartEdit,
  domainByName,
  fieldsWithRole,
  isChartSpec,
  renderConstraint,
  validateChartSpec,
  type ChartSpec,
  type QueryFeatures,
} from '../index.js';

const base: ChartSpec = { mark: 'bar', x: 'order_date', y: 'revenue', aggregate: 'sum' };

describe('chart specification', () => {
  it('accepts a well-formed spec and rejects malformed ones', () => {
    expect(isChartSpec(canonicalChart(base))).toBe(true);
    expect(isChartSpec({ mark: 'donut', x: 'a', y: 'b', aggregate: 'sum' } as never)).toBe(false);
    expect(isChartSpec({ mark: 'bar', x: 'a' } as never)).toBe(false);
    expect(() => assertChartSpec({ mark: 'bar' } as never)).toThrow(TypeError);
  });

  it('canonicalises optional series without emitting undefined', () => {
    expect(canonicalChart(base)).toEqual({
      mark: 'bar',
      x: 'order_date',
      y: 'revenue',
      aggregate: 'sum',
    });
    expect(canonicalChart({ ...base, series: 'region' })).toHaveProperty('series', 'region');
  });

  it('exposes exactly the marks the pack classifies', () => {
    expect(CHART_MARKS).toHaveLength(6);
  });

  it('resolves the reference schemas by role', () => {
    const sales = domainByName('sales');
    expect(sales?.name).toBe('sales');
    expect(fieldsWithRole(sales!, 'temporal').map((f) => f.name)).toEqual(['order_date']);
    expect(domainByName('nope')).toBeUndefined();
  });
});

describe('chart validation', () => {
  const sales = domainByName('sales')!;

  it('accepts a legal bar chart over a category', () => {
    expect(
      validateChartSpec({ mark: 'bar', x: 'region', y: 'revenue', aggregate: 'sum' }, sales),
    ).toEqual([]);
  });

  it('rejects a line chart over a category axis', () => {
    expect(
      validateChartSpec({ mark: 'line', x: 'region', y: 'revenue', aggregate: 'sum' }, sales),
    ).toContain('line_requires_temporal_x');
  });

  it('rejects an unaggregated pie and a scatter over a category', () => {
    expect(
      validateChartSpec({ mark: 'pie', x: 'region', y: 'revenue', aggregate: 'none' }, sales),
    ).toContain('pie_requires_aggregate');
    expect(
      validateChartSpec({ mark: 'scatter', x: 'region', y: 'revenue', aggregate: 'none' }, sales),
    ).toContain('scatter_requires_numeric_xy');
  });

  it('rejects unknown fields and a non-measure y', () => {
    expect(
      validateChartSpec({ mark: 'bar', x: 'nope', y: 'revenue', aggregate: 'sum' }, sales),
    ).toContain('unknown_field');
    expect(
      validateChartSpec({ mark: 'bar', x: 'region', y: 'channel', aggregate: 'sum' }, sales),
    ).toContain('y_must_be_measure');
  });

  it('requires a second dimension for a heatmap', () => {
    expect(
      validateChartSpec({ mark: 'heatmap', x: 'region', y: 'revenue', aggregate: 'sum' }, sales),
    ).toContain('heatmap_requires_two_dimensions');
    expect(
      validateChartSpec(
        { mark: 'heatmap', x: 'region', y: 'revenue', aggregate: 'sum', series: 'channel' },
        sales,
      ),
    ).toEqual([]);
  });
});

describe('edit classification', () => {
  it('treats a mark change as a chart-type correction even when encodings moved', () => {
    const edit = classifyChartEdit(base, {
      ...base,
      mark: 'line',
      x: 'month',
    });
    expect(edit?.code).toBe('chart_type_wrong');
  });

  it('classifies encoding, aggregation, and series changes', () => {
    expect(classifyChartEdit(base, { ...base, x: 'month' })?.code).toBe('encoding_wrong');
    expect(classifyChartEdit(base, { ...base, aggregate: 'avg' })?.code).toBe('aggregation_wrong');
    expect(classifyChartEdit(base, { ...base, series: 'region' })?.code).toBe('series_wrong');
  });

  it('returns null for a no-op edit', () => {
    expect(classifyChartEdit(base, { ...base })).toBeNull();
  });
});

describe('lesson description', () => {
  const features: QueryFeatures = {
    domain: 'sales',
    intent: 'trend',
    field: 'revenue',
    grain: 'month',
  };
  const edit = classifyChartEdit(base, { ...base, mark: 'line' })!;

  it('scopes the lesson to the run context and states the condition in prose', () => {
    const lesson = describeChartEdit(edit, features);
    expect(lesson?.scope).toEqual({ task: 'chart.recommend', domain: 'sales', intent: 'trend' });
    expect(lesson?.statement).toContain('line');
    expect(lesson?.statement).toContain('trend');
    expect(lesson?.payload).toEqual({ when: { intent: 'trend' }, then: { mark: 'line' } });
  });

  it('adds a cardinality predicate only for composition', () => {
    const compositionEdit = classifyChartEdit(
      { ...base, mark: 'pie' },
      { ...base, mark: 'bar' },
    )!;
    const many = describeChartEdit(compositionEdit, {
      domain: 'sales',
      intent: 'composition',
      field: 'revenue',
      categoryCount: 9,
    });
    expect(many?.payload.when.minCategories).toBe(6);

    const few = describeChartEdit(compositionEdit, {
      domain: 'sales',
      intent: 'composition',
      field: 'revenue',
      categoryCount: 4,
    });
    expect(few?.payload.when.maxCategories).toBe(5);
  });

  it('ignores edits that are not chart-type corrections', () => {
    const encoding = classifyChartEdit(base, { ...base, x: 'month' })!;
    expect(describeChartEdit(encoding, features)).toBeNull();
  });

  it('matches a constraint only when every stated predicate holds', () => {
    const lesson = describeChartEdit(edit, features)!;
    expect(constraintMatches(lesson.payload, features)).toBe(true);
    expect(constraintMatches(lesson.payload, { ...features, intent: 'comparison' })).toBe(false);
  });

  it('renders a readable clause for a human auditing a pack', () => {
    const lesson = describeChartEdit(edit, features)!;
    expect(renderConstraint(lesson.payload)).toBe('intent=trend -> mark=line');
  });
});
