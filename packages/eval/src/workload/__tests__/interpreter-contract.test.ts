/**
 * Cases the pack must handle but a normal edit never produces.
 *
 * A pack is a contract with the core: canonicalise, validate, classify, and
 * describe. Each of those has a "cannot" answer, and a host that wires a new
 * domain will hit them before it hits the happy path.
 */
import { describe, expect, it } from 'vitest';
import { dedupeKeyOf, type FeedbackEvent, type RunRecord } from '@agentix-e/microglia-core';
import {
  chartInterpreter,
  constraintMatches,
  renderConstraint,
  type ChartConstraint,
} from '../index.js';

const AT = 1_700_000_000_000;

function run(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    schema: 'microglia.run/1',
    id: 'run_1',
    at: AT,
    namespace: 'acme',
    sessionId: 's',
    task: 'chart.recommend',
    input: { domain: 'sales', intent: 'trend', field: 'revenue', categoryCount: 4 },
    output: { mark: 'bar', x: 'order_date', y: 'revenue', aggregate: 'sum' },
    provenance: { knowledgeIds: [] },
    feedbackIds: [],
    ...overrides,
  };
}

function editEvent(after: unknown): FeedbackEvent {
  return {
    schema: 'microglia.feedback/1',
    id: 'fb_1',
    at: AT,
    namespace: 'acme',
    sessionId: 's',
    runId: 'run_1',
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
      after: after as never,
    },
    provenance: { knowledgeIds: [] },
    redactions: 0,
  };
}

describe('interpreter abstentions', () => {
  it('stays silent when the run row is unavailable', () => {
    expect(
      chartInterpreter({ event: editEvent({ mark: 'line', x: 'd', y: 'r', aggregate: 'sum' }), run: undefined }),
    ).toEqual([]);
  });

  it('stays silent when the host did not record query features', () => {
    const noFeatures = run({ input: { q: 'trend of revenue' } });
    expect(
      chartInterpreter({
        event: editEvent({ mark: 'line', x: 'd', y: 'r', aggregate: 'sum' }),
        run: noFeatures,
      }),
    ).toEqual([]);
  });

  it('stays silent when the edit is not a chart-type change', () => {
    // Same spec on both sides: there is no lesson, and inventing one would put a
    // rule in the store for a non-correction.
    const same = run();
    expect(
      chartInterpreter({ event: editEvent({ ...same.output }), run: same }),
    ).toEqual([]);
  });

  it('stays silent when either side is not a chart spec', () => {
    const legacy = run({ output: { chartType: 'bar' } });
    expect(
      chartInterpreter({
        event: editEvent({ mark: 'line', x: 'd', y: 'r', aggregate: 'sum' }),
        run: legacy,
      }),
    ).toEqual([]);
  });
});

describe('interpreter output', () => {
  it('emits a candidate whose dedupe key is the one the store will use', () => {
    const [candidate] = chartInterpreter({
      event: editEvent({ mark: 'line', x: 'order_date', y: 'revenue', aggregate: 'sum' }),
      run: run(),
    });
    expect(candidate).toBeDefined();
    expect(candidate?.dedupeKey).toBe(
      dedupeKeyOf({
        namespace: 'acme',
        kind: 'constraint',
        scope: { task: 'chart.recommend', domain: 'sales', intent: 'trend' },
        statement: candidate?.statement ?? '',
      }),
    );
    expect(candidate?.scope).toEqual({
      task: 'chart.recommend',
      domain: 'sales',
      intent: 'trend',
    });
  });
});

describe('constraint rendering and matching', () => {
  it('renders every stated dimension', () => {
    const payload: ChartConstraint = {
      when: { intent: 'trend', domain: 'sales', field: 'revenue', minCategories: 6 },
      then: { mark: 'line' },
    };
    expect(renderConstraint(payload)).toBe(
      'intent=trend AND domain=sales AND field=revenue AND categories>=6 -> mark=line',
    );
  });

  it('treats a missing category count as zero when a bound is stated', () => {
    const trend = { domain: 'sales', intent: 'trend' as const, field: 'revenue' };
    expect(constraintMatches({ when: { minCategories: 3 }, then: { mark: 'line' } }, trend)).toBe(
      false,
    );
    expect(constraintMatches({ when: { maxCategories: 5 }, then: { mark: 'line' } }, trend)).toBe(
      true,
    );
  });

  it('rejects a cardinality that exceeds the stated maximum', () => {
    const wide = { domain: 'sales', intent: 'composition' as const, field: 'revenue', categoryCount: 9 };
    expect(constraintMatches({ when: { maxCategories: 5 }, then: { mark: 'pie' } }, wide)).toBe(
      false,
    );
    expect(constraintMatches({ when: { minCategories: 6 }, then: { mark: 'bar' } }, wide)).toBe(true);
  });
});
