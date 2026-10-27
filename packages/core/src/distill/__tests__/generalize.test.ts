import { describe, expect, it } from 'vitest';
import { createKnowledgeItem, defaultPolicy } from '../../kernel/index.js';
import type { DistillCandidate, KnowledgeItem } from '../../kernel/index.js';
import {
  WIDENING_TASKS,
  canGeneralize,
  endorsingTasks,
  generalizationPlan,
  generalizedScope,
  mergeEvidence,
  payloadsEqual,
  widenedScopeOf,
  withoutDomain,
} from '../generalize.js';

const at = 1_700_000_000_000;

function item(domain: string, payload: unknown = { when: { intent: 'trend' }, then: { mark: 'line' } }) {
  const candidate: DistillCandidate = {
    namespace: 'acme',
    kind: 'constraint',
    scope: { task: 'chart.recommend', domain, intent: 'trend' },
    statement: 'For a trend question over revenue. Use a line chart.',
    payload: payload as never,
    evidence: { feedbackId: `fb_${domain}`, runId: 'r', at, weight: 0.9 },
    trust: 0.9,
    dedupeKey: `k_${domain}`,
  };
  return createKnowledgeItem(candidate, defaultPolicy, at, `k_${domain}`);
}

function candidate(domain: string, overrides: Partial<DistillCandidate> = {}): DistillCandidate {
  return {
    namespace: 'acme',
    kind: 'constraint',
    scope: { task: 'chart.recommend', domain, intent: 'trend' },
    statement: 'For a trend question over revenue. Use a line chart.',
    payload: { when: { intent: 'trend' }, then: { mark: 'line' } } as never,
    evidence: { feedbackId: `fb_${domain}_new`, runId: 'r', at, weight: 0.9 },
    trust: 0.9,
    dedupeKey: `k_${domain}`,
    ...overrides,
  };
}

describe('generalisation predicate', () => {
  it('allows a different domain with an identical claim', () => {
    expect(canGeneralize(item('sales'), candidate('hr'))).toBe(true);
  });

  it('refuses the same domain, a missing candidate domain, or a different intent', () => {
    expect(canGeneralize(item('sales'), candidate('sales'))).toBe(false);
    expect(
      canGeneralize(item('sales'), {
        ...candidate('hr'),
        scope: { task: 'chart.recommend', intent: 'trend' },
      }),
    ).toBe(false);
    expect(
      canGeneralize(item('sales'), {
        ...candidate('hr'),
        scope: { task: 'chart.recommend', domain: 'hr', intent: 'comparison' },
      }),
    ).toBe(false);
  });

  it('refuses a different payload, namespace, kind, or task', () => {
    expect(
      canGeneralize(item('sales'), candidate('hr', {
        payload: { when: { intent: 'trend' }, then: { mark: 'pie' } } as never,
      })),
    ).toBe(false);
    expect(canGeneralize(item('sales'), candidate('hr', { namespace: 'other' }))).toBe(false);
    expect(canGeneralize(item('sales'), candidate('hr', { kind: 'negative' }))).toBe(false);
    expect(
      canGeneralize(item('sales'), {
        ...candidate('hr'),
        scope: { task: 'sql.generate', domain: 'hr', intent: 'trend' },
      }),
    ).toBe(false);
  });

  it('lets an already-generalised item absorb any domain', () => {
    const generalized = { ...item('sales'), scope: { task: 'chart.recommend', intent: 'trend' } };
    expect(canGeneralize(generalized, candidate('ops'))).toBe(true);
  });

  it('lets two equal records widen however they were worded', () => {
    // The payload is the claim in a structured domain; the sentence is a description two hosts
    // may write differently. This is the pair the L2b corpus relies on.
    expect(
      canGeneralize(item('sales'), candidate('hr', { statement: 'A different claim entirely.' })),
    ).toBe(true);
  });

  it('needs the sentence when there is no record on either side', () => {
    // A prose lesson has no record, and comparing payloads alone then degenerates to "same
    // kind": 200 distinct notes across five domains became 3 items.
    const prose = { ...item('sales'), payload: undefined };
    expect(canGeneralize(prose, candidate('hr', { payload: undefined }))).toBe(true);
    expect(
      canGeneralize(prose, candidate('hr', { payload: undefined, statement: 'A different claim.' })),
    ).toBe(false);
    expect(canGeneralize(prose, candidate('hr', { payload: undefined, statement: '  For a trend question over revenue. Use a line chart.  ' }))).toBe(true);
  });

  it('refuses the same sentence with different data', () => {
    // The words agree and the records do not: that is two claims about different content, and
    // the store must not merge them or it will average the data.
    expect(
      canGeneralize(item('sales'), candidate('hr', {
        payload: { when: { intent: 'trend' }, then: { mark: 'pie' } } as never,
      })),
    ).toBe(false);
  });

  it('compares payloads structurally', () => {
    expect(payloadsEqual(item('sales'), candidate('hr'))).toBe(true);
    expect(payloadsEqual({ ...item('sales'), payload: undefined }, candidate('hr'))).toBe(false);
  });

  it('passes through payloads that are not records', () => {
    // An array or a scalar is data the host chose to report; only an empty object means
    // nothing, and only absence means nothing at all.
    expect(payloadsEqual({ ...item('sales'), payload: [] }, { ...candidate('hr'), payload: [] })).toBe(true);
    expect(payloadsEqual({ ...item('sales'), payload: [] }, { ...candidate('hr'), payload: {} })).toBe(false);
    expect(payloadsEqual({ ...item('sales'), payload: 'x' }, { ...candidate('hr'), payload: 'x' })).toBe(true);
    expect(payloadsEqual({ ...item('sales'), payload: null }, { ...candidate('hr'), payload: undefined })).toBe(true);
  });

  it('treats an empty object payload as no payload', () => {
    // `{}` is the schema's way of saying "nothing", and a model that writes it on some
    // replies would otherwise split one claim into two that can never corroborate.
    expect(payloadsEqual({ ...item('sales'), payload: {} }, { ...candidate('hr'), payload: undefined })).toBe(true);
    expect(payloadsEqual({ ...item('sales'), payload: {} }, { ...candidate('hr'), payload: {} })).toBe(true);
    expect(payloadsEqual({ ...item('sales'), payload: {} }, candidate('hr'))).toBe(false);
  });

  it('removes only the domain dimension', () => {
    expect(withoutDomain({ task: 't', domain: 'd', intent: 'i' })).toEqual({ task: 't', intent: 'i' });
    expect(generalizedScope(item('sales'))).toEqual({ task: 'chart.recommend', intent: 'trend' });
  });

  it('unions evidence without duplicating a feedback id', () => {
    const merged = mergeEvidence([item('sales'), item('hr')], candidate('ops'));
    expect(merged.evidence).toHaveLength(3);
    expect(merged.support).toBeCloseTo(2.7, 6);

    const duplicate = mergeEvidence(
      [item('sales')],
      candidate('sales', { evidence: { feedbackId: 'fb_sales', runId: 'r', at, weight: 0.9 } }),
    );
    expect(duplicate.evidence).toHaveLength(1);
  });
});

describe('remaining generalisation branches', () => {
  it('treats two absent payloads as equal and rejects a candidate without a domain', () => {
    const left = { ...item('sales'), payload: undefined };
    const right = { ...candidate('hr'), payload: undefined };
    expect(payloadsEqual(left, right)).toBe(true);
    expect(
      canGeneralize(left, { ...candidate('hr'), scope: { task: 'chart.recommend', intent: 'trend' } }),
    ).toBe(false);
  });

  it('deduplicates evidence that appears in two sibling items', () => {
    const a = item('sales');
    const b = { ...item('hr'), evidence: a.evidence };
    const merged = mergeEvidence([a, b], candidate('ops'));
    expect(merged.evidence).toHaveLength(2);
  });
});

describe('the widening bound', () => {
  const base = { task: 'chart.recommend' };

  it('has no meet for an empty set or two different tasks', () => {
    expect(widenedScopeOf([])).toBeUndefined();
    expect(widenedScopeOf([{ ...base }, { task: 'sql.generate' }])).toBeUndefined();
  });

  it('keeps every fixed dimension the endorsers agree on, and drops the domain', () => {
    expect(
      widenedScopeOf([
        { ...base, domain: 'sales', intent: 'trend', field: 'revenue' },
        { ...base, domain: 'hr', intent: 'trend', field: 'revenue' },
      ]),
    ).toEqual({ ...base, intent: 'trend', field: 'revenue' });
  });

  it('refuses to drop a fixed dimension, and keeps a domain all endorsers share', () => {
    expect(
      widenedScopeOf([
        { ...base, domain: 'sales', intent: 'trend' },
        { ...base, domain: 'hr', intent: 'comparison' },
      ]),
    ).toBeUndefined();
    // Constrained by one endorser and open in another: dropping it would widen
    // the claim past what the silent endorser ever asserted.
    expect(
      widenedScopeOf([{ ...base, domain: 'sales', reasonCode: 'empty' }, { ...base, domain: 'hr' }]),
    ).toBeUndefined();
    expect(
      widenedScopeOf([
        { ...base, domain: 'sales', intent: 'trend' },
        { ...base, domain: 'sales', intent: 'trend' },
      ]),
    ).toEqual({ ...base, domain: 'sales', intent: 'trend' });
  });

  it('never drops a dimension that no endorser constrains', () => {
    expect(widenedScopeOf([{ ...base, domain: 'sales' }, { ...base, domain: 'hr' }])).toEqual({
      ...base,
    });
  });
});

describe('the widening plan', () => {
  function sibling(domain: string | undefined, taskId: string, extra: Partial<KnowledgeItem> = {}) {
    const candidate: DistillCandidate = {
      namespace: 'acme',
      kind: 'constraint',
      scope: { task: 'chart.recommend', domain, intent: 'trend' },
      statement: 'For a trend question over revenue. Use a line chart.',
      payload: { when: { intent: 'trend' }, then: { mark: 'line' } } as never,
      evidence: { feedbackId: `fb_${taskId}_${domain ?? 'any'}`, runId: `run_${taskId}`, at, weight: 0.9, taskId },
      trust: 0.9,
      dedupeKey: `k_${taskId}`,
    };
    return {
      ...createKnowledgeItem(candidate, defaultPolicy, at, `k_${taskId}_${domain ?? 'any'}`),
      status: 'active' as const,
      ...extra,
    };
  }

  function incoming(domain: string, taskId: string): DistillCandidate {
    return {
      namespace: 'acme',
      kind: 'constraint',
      scope: { task: 'chart.recommend', domain, intent: 'trend' },
      statement: 'For a trend question over revenue. Use a line chart.',
      payload: { when: { intent: 'trend' }, then: { mark: 'line' } } as never,
      evidence: { feedbackId: `fb_${taskId}`, runId: `run_${taskId}`, at, weight: 0.9, taskId },
      trust: 0.9,
      dedupeKey: `k_${taskId}`,
    };
  }

  it('counts distinct tasks, not observations, and falls back to the run', () => {
    const one = sibling('sales', 't1');
    const again = { ...sibling('hr', 't1'), evidence: [{ feedbackId: 'fb_x', runId: 'run_t1', at, weight: 0.9, taskId: 't1' }] };
    expect(endorsingTasks([one, again], incoming('ops', 't1'))).toBe(1);
    const legacy = { ...sibling('hr', 'r9'), evidence: [{ feedbackId: 'fb_y', runId: 'run_9', at, weight: 0.9 }] };
    expect(endorsingTasks([one, legacy], incoming('ops', 't1'))).toBe(2);
  });

  it('declines when there is no sibling, no active sibling, or too few tasks', () => {
    expect(generalizationPlan([], incoming('sales', 't1'))).toBeUndefined();
    expect(generalizationPlan([sibling('sales', 't1', { status: 'candidate' })], incoming('hr', 't2'))).toBeUndefined();
    expect(generalizationPlan([sibling('sales', 't1')], incoming('hr', 't2'))).toBeUndefined();
  });

  it('widens onto an active domain-free sibling at three tasks', () => {
    const pool = [sibling('sales', 't1'), sibling(undefined, 't2')];
    const plan = generalizationPlan(pool, incoming('ops', 't3'));
    expect(plan?.target.scope.domain).toBeUndefined();
    expect(plan?.scope).toEqual({ task: 'chart.recommend', intent: 'trend' });
    expect(plan?.tasks).toBe(WIDENING_TASKS);
    expect(plan?.endorsers).toHaveLength(2);
  });

  it('leaves out a sibling that keeps the joint meet undefined', () => {
    // `canGeneralize` is pairwise: this sibling agrees with the candidate and
    // still disagrees with the target about the intent. Letting it in would
    // attribute its evidence to a scope it never endorsed.
    const disagreeing = sibling('ops', 't4', {
      scope: { task: 'chart.recommend', domain: 'ops', intent: 'comparison' },
    });
    const pool = [sibling('sales', 't1'), sibling(undefined, 't2'), disagreeing];
    const plan = generalizationPlan(pool, incoming('hr', 't3'));
    expect(plan?.endorsers.map((item) => item.id)).not.toContain(disagreeing.id);
    expect(plan?.scope).toEqual({ task: 'chart.recommend', intent: 'trend' });
  });

  it('lets no unadmitted sibling endorse a widening', () => {
    // An attacker does not need a false record: a real one next door plus two
    // quarantined paraphrases is enough to buy applicability if the widening
    // counts evidence the store never accepted.
    const quarantined = { ...sibling('hr', 't2'), status: 'quarantined' as const };
    const pool = [sibling('sales', 't1'), quarantined];
    expect(generalizationPlan(pool, incoming('ops', 't3'))).toBeUndefined();

    const admitted = [sibling('sales', 't1'), sibling('hr', 't2')];
    expect(generalizationPlan(admitted, incoming('ops', 't3'))?.tasks).toBe(WIDENING_TASKS);
  });

  it('declines when the candidate disagrees with the only sibling about the intent', () => {
    const pool = [sibling('sales', 't1'), sibling('hr', 't2')];
    const conflict = { ...incoming('ops', 't3'), scope: { task: 'chart.recommend', domain: 'ops', intent: 'comparison' } };
    expect(generalizationPlan(pool, conflict)).toBeUndefined();
  });
});
