import { describe, expect, it } from 'vitest';
import { createKnowledgeItem, defaultPolicy } from '../../kernel/index.js';
import type { DistillCandidate } from '../../kernel/index.js';
import {
  canGeneralize,
  generalizedScope,
  mergeEvidence,
  payloadsEqual,
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

  it('compares payloads structurally', () => {
    expect(payloadsEqual(item('sales'), candidate('hr'))).toBe(true);
    expect(payloadsEqual({ ...item('sales'), payload: undefined }, candidate('hr'))).toBe(false);
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
