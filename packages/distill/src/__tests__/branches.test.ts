import { describe, expect, it } from 'vitest';
import {
  createKnowledgeItem,
  defaultPolicy,
  fixedClock,
  mulberry32,
  type DistillCandidate,
  type FeedbackEvent,
} from '@agentix-e/microglia-core';
import { EmbeddedMemory, MemoryJournal } from '@agentix-e/microglia-memory';
import { distill } from '../distiller.js';

const at = 1_700_000_000_000;

function event(id: string): FeedbackEvent {
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
    trust: 0.9,
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
    statement: 'For a trend question over revenue. Use a line chart.',
    payload: { when: { intent: 'trend' }, then: { mark: 'line' } },
    evidence: { feedbackId: id, runId: `run_${id}`, at, weight: 0.9 },
    trust: 0.9,
    dedupeKey: id,
    ...overrides,
  };
}

describe('distillation branches', () => {
  it('honours a limit and can disable generalisation', async () => {
    const memory = await EmbeddedMemory.open(new MemoryJournal());
    await memory.appendEvent(event('fb_1'));
    await memory.appendEvent(event('fb_2'));

    const report = await distill({
      memory,
      policy: defaultPolicy,
      clock: fixedClock(at),
      random: mulberry32(1),
      interpreter: (context) => [candidate(context.event.id)],
      limit: 1,
      generalize: false,
    });
    expect(report.events).toBe(1);
    expect(report.created).toBe(1);
    await memory.close();
  });

  it('skips contradiction against equal, inactive, other-kind, and low-trust candidates', async () => {
    const memory = await EmbeddedMemory.open(new MemoryJournal());
    await memory.appendEvent(event('fb_1'));
    await memory.appendEvent(event('fb_2'));
    await memory.appendEvent(event('fb_3'));

    const existing = createKnowledgeItem(candidate('fb_1'), defaultPolicy, at, 'k_existing');
    await memory.putKnowledge(existing);

    let call = 0;
    const report = await distill({
      memory,
      policy: defaultPolicy,
      clock: fixedClock(at),
      random: mulberry32(2),
      interpreter: () => {
        call += 1;
        if (call === 1) return []; // equal payload is not a contradiction
        if (call === 2) return [candidate('fb_2', { kind: 'negative' })]; // other kind
        return [candidate('fb_3', { trust: 0.5 })]; // low trust
      },
    });
    expect(report.contradicted).toBe(0);
    await memory.close();
  });

  it('records a contradiction for a trusted conflicting claim in the same scope', async () => {
    const memory = await EmbeddedMemory.open(new MemoryJournal());
    await memory.appendEvent(event('fb_1'));
    await memory.appendEvent(event('fb_2'));
    await memory.putKnowledge(createKnowledgeItem(candidate('fb_1'), defaultPolicy, at, 'k_existing'));

    const report = await distill({
      memory,
      policy: defaultPolicy,
      clock: fixedClock(at),
      random: mulberry32(3),
      interpreter: () => [
        candidate('fb_2', {
          payload: { when: { intent: 'trend' }, then: { mark: 'scatter' } },
          statement: 'For a trend question over revenue. Use a scatter chart.',
        }),
      ],
    });
    expect(report.contradicted).toBe(1);
    await memory.close();
  });
});
