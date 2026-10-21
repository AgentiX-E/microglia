import { describe, expect, it } from 'vitest';
import { EmbeddedMemory, MemoryJournal } from '../../memory/index.js';
import { openMicroglia } from '../../capture/index.js';
import { createKnowledgeItem, mergeEvidence } from '../knowledge.js';
import { defaultPolicy } from '../policy.js';
import { tierFor } from '../provenance.js';
import type { DistillCandidate, ProvenanceTier } from '../types.js';

const AT = 1_700_000_000_000;

function candidate(taskId: string, tier: ProvenanceTier, trust = 0.95): DistillCandidate {
  return {
    namespace: 'acme',
    kind: 'constraint',
    scope: { task: 'chart.recommend' },
    statement: 'Revenue questions use a line chart, not a bar chart.',
    evidence: { feedbackId: `fb_${taskId}`, runId: `run_${taskId}`, at: AT, weight: trust, taskId },
    trust,
    dedupeKey: 'acme|constraint|k',
    tier,
  };
}

describe('tier of a signal', () => {
  it('maps by shape, not by who sent it', () => {
    expect(tierFor('edit')).toBe('structured-edit');
    expect(tierFor('outcome')).toBe('outcome');
    expect(tierFor('rating')).toBe('user-text');
    expect(tierFor('clarification')).toBe('user-text');
    expect(tierFor('preference')).toBe('user-text');
    expect(tierFor('abstain')).toBe('user-text');
  });
});

describe('the promotion gate', () => {
  it('will not activate a rule that only prose endorses', () => {
    const item = createKnowledgeItem(candidate('task_a', 'user-text'), defaultPolicy, AT, 'k_1');
    expect(item.tier).toBe('user-text');
    expect(item.status).toBe('candidate');
    expect(item.statusReason).toBe('needs-corroboration');
  });

  it('promotes it once a second distinct task says the same thing', () => {
    const first = createKnowledgeItem(candidate('task_a', 'user-text'), defaultPolicy, AT, 'k_1');
    const second = mergeEvidence(first, candidate('task_b', 'user-text'), defaultPolicy, AT);
    expect(second.status).toBe('active');
    expect(second.statusReason).toBe('confidence-cleared');
  });

  it('does not count one task insisting twice as corroboration', () => {
    const first = createKnowledgeItem(candidate('task_a', 'user-text'), defaultPolicy, AT, 'k_1');
    const same = mergeEvidence(
      first,
      { ...candidate('task_a', 'user-text'), evidence: { ...candidate('task_a', 'user-text').evidence, feedbackId: 'fb_2' } },
      defaultPolicy,
      AT,
    );
    expect(same.status).toBe('candidate');
    expect(same.statusReason).toBe('needs-corroboration');
  });

  it('lets a structured edit activate on its own, as before', () => {
    const item = createKnowledgeItem(
      candidate('task_a', 'structured-edit', 0.9),
      defaultPolicy,
      AT,
      'k_1',
    );
    expect(item.status).toBe('active');
  });

  it('keeps the strongest tier through a merge', () => {
    const prose = createKnowledgeItem(candidate('task_a', 'user-text'), defaultPolicy, AT, 'k_1');
    expect(prose.status).toBe('candidate');
    const measured = mergeEvidence(prose, candidate('task_b', 'outcome'), defaultPolicy, AT);
    expect(measured.tier).toBe('outcome');
    expect(measured.status).toBe('active');
  });

  it('leaves an unclassified item alone, so a persisted store keeps working', () => {
    const unclassified = createKnowledgeItem(
      { ...candidate('task_a', 'user-text'), tier: undefined },
      defaultPolicy,
      AT,
      'k_1',
    );
    expect(unclassified.tier).toBeUndefined();
    // No tier means no gate: this is exactly how every record written before the
    // field existed has to keep behaving.
    expect(unclassified.status).toBe('active');
  });
});

describe('the gate end to end', () => {
  it('stores a clarification and refuses to act on it until another task agrees', async () => {
    const store = await EmbeddedMemory.open(new MemoryJournal());
    const mg = await openMicroglia({ app: 'acme', namespace: 'acme', store });

    const first = mg.begin({ task: 'chart.recommend', input: { q: 1 } });
    await first.complete({ mark: 'bar' });
    await first.clarify('what does revenue mean here', 'net revenue, excluding tax');
    await mg.distill();

    const afterFirst = await store.listKnowledge({ status: 'all' });
    expect(afterFirst).toHaveLength(1);
    expect(afterFirst[0]?.tier).toBe('user-text');
    expect(afterFirst[0]?.status).not.toBe('active');

    const second = mg.begin({ task: 'chart.recommend', input: { q: 2 } });
    await second.complete({ mark: 'bar' });
    await second.clarify('what does revenue mean here', 'net revenue, excluding tax');
    await mg.distill();

    const afterSecond = await store.listKnowledge({ status: 'all' });
    expect(afterSecond).toHaveLength(1);
    expect(afterSecond[0]?.status).toBe('active');
    await mg.close();
  });
});
