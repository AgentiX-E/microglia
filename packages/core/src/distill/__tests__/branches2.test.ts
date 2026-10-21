import { describe, expect, it } from 'vitest';
import { createKnowledgeItem, defaultPolicy, fixedClock, mulberry32 } from '../../kernel/index.js';
import type { DistillCandidate, FeedbackEvent } from '../../kernel/index.js';
import { EmbeddedMemory, MemoryJournal } from '../../memory/index.js';
import { distill } from '../distiller.js';

const at = 1_700_000_000_000;

function event(id: string, trust = 0.9): FeedbackEvent {
  return {
    schema: 'microglia.feedback/1',
    id,
    at,
    namespace: 'acme',
    sessionId: 's',
    runId: `run_${id}`,
    task: 'chart.recommend',
    kind: 'edit',
    actor: { type: 'user' },
    trust,
    signal: { type: 'edit', beforeHash: 'a', afterHash: 'b', ops: [], distance: 1, after: { mark: 'line' } },
    provenance: { knowledgeIds: [] },
    redactions: 0,
  };
}

function candidate(id: string, overrides: Partial<DistillCandidate> = {}): DistillCandidate {
  return {
    namespace: 'acme',
    kind: 'constraint',
    scope: { task: 'chart.recommend', domain: 'sales', intent: 'trend' },
    statement: `Rule ${id}`,
    evidence: { feedbackId: id, runId: `run_${id}`, at, weight: 0.9 },
    trust: 0.9,
    dedupeKey: id,
    ...overrides,
  };
}

describe('payload and quarantine branches', () => {
  it('merges two candidates that both omit a payload', async () => {
    const memory = await EmbeddedMemory.open(new MemoryJournal());
    await memory.appendEvent(event('fb_1'));
    await memory.appendEvent(event('fb_2'));
    const report = await distill({
      memory,
      policy: defaultPolicy,
      clock: fixedClock(at),
      random: mulberry32(1),
      interpreter: (context) => [candidate(context.event.id, { statement: 'Rule one' })],
    });
    expect(report.created).toBe(1);
    expect(report.merged).toBe(1);
    await memory.close();
  });

  it('keeps a quarantined item quarantined when evidence merges', async () => {
    const memory = await EmbeddedMemory.open(new MemoryJournal());
    await memory.appendEvent(event('fb_1', 0.2));
    await memory.appendEvent(event('fb_2', 0.2));
    const report = await distill({
      memory,
      policy: defaultPolicy,
      clock: fixedClock(at),
      random: mulberry32(2),
      interpreter: (context) => [candidate(context.event.id, { trust: 0.2, statement: 'Low trust rule' })],
    });
    expect(report.quarantined).toBeGreaterThan(0);
    const items = await memory.listKnowledge({ namespace: 'acme', status: 'all' });
    expect(items.every((item) => item.status === 'quarantined')).toBe(true);
    await memory.close();
  });

  it('quarantines through the merge path too', async () => {
    const memory = await EmbeddedMemory.open(new MemoryJournal());
    await memory.appendEvent(event('fb_1', 0.2));
    await memory.appendEvent(event('fb_2', 0.2));
    const item = createKnowledgeItem(
      candidate('fb_1', { trust: 0.2, statement: 'Low trust rule' }),
      defaultPolicy,
      at,
      'k_low',
    );
    await memory.putKnowledge(item);
    const report = await distill({
      memory,
      policy: defaultPolicy,
      clock: fixedClock(at),
      random: mulberry32(3),
      interpreter: (context) => [candidate(context.event.id, { trust: 0.2, statement: 'Low trust rule' })],
    });
    expect(report.quarantined).toBeGreaterThanOrEqual(1);
    await memory.close();
  });
});
