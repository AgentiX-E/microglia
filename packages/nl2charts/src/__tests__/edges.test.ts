import { describe, expect, it } from 'vitest';
import {
  isChartSpec,
  validateChartSpec,
  classifyChartEdit,
  describeChartEdit,
  constraintMatches,
  renderConstraint,
  chartEditDistance,
  domainByName,
  type ChartSpec,
  type ChartConstraint,
} from '../index.js';
import { featuresOf, chartInterpreter } from '../interpret.js';
import type { FeedbackEvent, RunRecord } from '@agentix-e/microglia-core';

const base: ChartSpec = { mark: 'line', x: 'order_date', y: 'revenue', aggregate: 'sum' };
const sales = domainByName('sales')!;

describe('specification guards', () => {
  it('rejects non-objects, arrays, and values with missing or invalid fields', () => {
    expect(isChartSpec(null)).toBe(false);
    expect(isChartSpec([])).toBe(false);
    expect(isChartSpec('line')).toBe(false);
    expect(isChartSpec({ mark: 'line', x: 'a', y: 'b' })).toBe(false);
    expect(isChartSpec({ mark: 'line', x: 'a', y: 'b', aggregate: 1 })).toBe(false);
  });

  it('accepts an explicit series field', () => {
    expect(isChartSpec({ ...base, series: 'region' })).toBe(true);
  });
});

describe('validation branches', () => {
  it('accepts a heatmap with a series', () => {
    expect(
      validateChartSpec(
        { mark: 'heatmap', x: 'region', y: 'revenue', aggregate: 'sum', series: 'channel' },
        sales,
      ),
    ).toEqual([]);
  });

  it('reports an unknown x field and a valid pie', () => {
    expect(
      validateChartSpec({ mark: 'bar', x: 'nope', y: 'revenue', aggregate: 'sum' }, sales),
    ).toContain('unknown_field');
    expect(
      validateChartSpec({ mark: 'pie', x: 'region', y: 'revenue', aggregate: 'sum' }, sales),
    ).toEqual([]);
  });

  it('allows a measure on x for a boxplot', () => {
    expect(
      validateChartSpec({ mark: 'boxplot', x: 'revenue', y: 'units', aggregate: 'none' }, sales),
    ).toEqual([]);
  });
});

describe('lesson description branches', () => {
  const edit = classifyChartEdit(base, { ...base, mark: 'bar' })!;

  it('omits the cardinality predicate for a non-composition intent', () => {
    const lesson = describeChartEdit(edit, {
      domain: 'sales',
      intent: 'trend',
      field: 'revenue',
      categoryCount: 8,
    });
    expect(lesson?.payload.when.minCategories).toBeUndefined();
  });

  it('renders the at-most branch for a small composition', () => {
    const lesson = describeChartEdit(edit, {
      domain: 'sales',
      intent: 'composition',
      field: 'revenue',
      categoryCount: 3,
    });
    expect(renderConstraint(lesson!.payload)).toContain('categories<=5');
    expect(lesson?.statement).toContain('at most 5 categories');
  });

  it('renders the at-least branch for a large composition', () => {
    const lesson = describeChartEdit(edit, {
      domain: 'sales',
      intent: 'composition',
      field: 'revenue',
      categoryCount: 9,
    });
    expect(renderConstraint(lesson!.payload)).toContain('categories>=6');
  });

  it('rejects a constraint whose cardinality floor is not met', () => {
    const payload: ChartConstraint = {
      when: { intent: 'composition', minCategories: 6 },
      then: { mark: 'bar' },
    };
    expect(
      constraintMatches(payload, { domain: 'sales', intent: 'composition', field: 'x', categoryCount: 4 }),
    ).toBe(false);
  });

  it('measures a mark change as a full edit and an encoding change as partial', () => {
    expect(chartEditDistance(base, { ...base, mark: 'bar' })).toBe(1);
    expect(chartEditDistance(base, { ...base, x: 'month' })).toBe(0.6);
    expect(chartEditDistance(base, { ...base, aggregate: 'avg' })).toBe(0.4);
    expect(chartEditDistance(base, { ...base, series: 'region' })).toBe(0.3);
    expect(chartEditDistance(base, { ...base })).toBe(0);
    expect(chartEditDistance({ mark: 'nope' } as never, base)).toBeUndefined();
  });
});

describe('features and interpreter', () => {
  function run(input: Record<string, unknown>): RunRecord {
    return {
      schema: 'microglia.run/1',
      id: 'r',
      at: 1,
      namespace: 'acme',
      sessionId: 's',
      task: 'chart.recommend',
      input: input as RunRecord['input'],
      output: { mark: 'bar', x: 'order_date', y: 'revenue', aggregate: 'sum' },
      provenance: { knowledgeIds: [] },
      feedbackIds: [],
    };
  }

  it('returns undefined when a feature is missing or invalid', () => {
    expect(featuresOf(run({ intent: 'trend', field: 'revenue' }))).toBeUndefined();
    expect(featuresOf(run({ domain: 'sales', field: 'revenue' }))).toBeUndefined();
    expect(featuresOf(run({ domain: 'sales', intent: 'trend' }))).toBeUndefined();
    expect(featuresOf(run({ domain: 'sales', intent: 'unknown', field: 'revenue' }))).toBeUndefined();
  });

  it('accepts an optional numeric count and a known grain only', () => {
    const withCount = featuresOf(
      run({ domain: 'sales', intent: 'composition', field: 'revenue', categoryCount: 7, grain: 'week' }),
    );
    expect(withCount?.categoryCount).toBe(7);
    expect(withCount?.grain).toBeUndefined();

    const withGrain = featuresOf(
      run({ domain: 'sales', intent: 'trend', field: 'revenue', grain: 'month', categoryCount: 'x' }),
    );
    expect(withGrain?.grain).toBe('month');
    expect(withGrain?.categoryCount).toBeUndefined();
  });

  function event(overrides: Partial<FeedbackEvent> = {}): FeedbackEvent {
    return {
      schema: 'microglia.feedback/1',
      id: 'fb',
      at: 1,
      namespace: 'acme',
      sessionId: 's',
      runId: 'r',
      task: 'chart.recommend',
      kind: 'edit',
      actor: { type: 'user' },
      trust: 0.9,
      signal: {
        type: 'edit',
        beforeHash: 'a',
        afterHash: 'b',
        ops: [],
        distance: 1,
        after: { mark: 'line', x: 'order_date', y: 'revenue', aggregate: 'sum' },
      },
      provenance: { knowledgeIds: [] },
      redactions: 0,
      ...overrides,
    };
  }

  const goodRun = run({ domain: 'sales', intent: 'trend', field: 'revenue' });

  it('returns nothing for a non-edit event or a missing run', () => {
    expect(
      chartInterpreter({ event: event({ signal: { type: 'rating', value: 'up', reasons: [] } }), run: goodRun }),
    ).toEqual([]);
    expect(chartInterpreter({ event: event(), run: undefined })).toEqual([]);
  });

  it('returns nothing when the output or the edit is not a chart', () => {
    expect(
      chartInterpreter({ event: event(), run: { ...goodRun, output: { mark: 'bar' } } }),
    ).toEqual([]);
    expect(
      chartInterpreter({
        event: event({
          signal: { type: 'edit', beforeHash: 'a', afterHash: 'b', ops: [], distance: 1, after: null },
        }),
        run: goodRun,
      }),
    ).toEqual([]);
  });

  it('returns nothing for a non-chart-type edit', () => {
    expect(
      chartInterpreter({
        event: event({
          signal: {
            type: 'edit',
            beforeHash: 'a',
            afterHash: 'b',
            ops: [],
            distance: 1,
            after: { mark: 'bar', x: 'month', y: 'revenue', aggregate: 'sum' },
          },
        }),
        run: goodRun,
      }),
    ).toEqual([]);
  });

  it('returns a lesson for a chart-type edit with complete features', () => {
    const out = chartInterpreter({ event: event(), run: goodRun });
    expect(out).toHaveLength(1);
    expect(out[0]?.kind).toBe('constraint');
  });
});

describe('cardinality ceiling', () => {
  it('rejects a constraint whose maximum is exceeded', () => {
    expect(
      constraintMatches(
        { when: { intent: 'composition', maxCategories: 5 }, then: { mark: 'pie' } },
        { domain: 'sales', intent: 'composition', field: 'revenue', categoryCount: 8 },
      ),
    ).toBe(false);
  });
});

describe('predicate mismatches', () => {
  const features = { domain: 'sales', intent: 'trend', field: 'revenue', categoryCount: 4 } as const;

  it('rejects a different intent, domain, or field when stated', () => {
    expect(
      constraintMatches({ when: { intent: 'comparison' }, then: { mark: 'bar' } }, features),
    ).toBe(false);
    expect(
      constraintMatches({ when: { domain: 'finance' }, then: { mark: 'bar' } }, features),
    ).toBe(false);
    expect(
      constraintMatches({ when: { field: 'units' }, then: { mark: 'bar' } }, features),
    ).toBe(false);
  });
});
