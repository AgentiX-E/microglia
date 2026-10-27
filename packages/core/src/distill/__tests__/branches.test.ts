import { describe, expect, it } from 'vitest';
import {
  createKnowledgeItem,
  defaultPolicy,
  fixedClock,
  mulberry32,
  type DistillCandidate,
  type FeedbackEvent,
} from '../../kernel/index.js';
import { EmbeddedMemory, MemoryJournal } from '../../memory/index.js';
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

  it('does not treat an absent payload as conflicting content', async () => {
    // The defect this test was written for: a model that writes `"payload": {}` on some
    // replies and omits it on others made every claim in the store contradict every other,
    // because `jsonEqual({}, null)` is false. Nineteen of twenty items stall at confidence
    // 0.456 and never activate, so the memory looks empty while holding the lessons.
    const memory = await EmbeddedMemory.open(new MemoryJournal());
    await memory.appendEvent(event('fb_1'));
    await memory.appendEvent(event('fb_2'));
    await memory.putKnowledge(
      createKnowledgeItem(
        candidate('fb_1', { payload: { wrong: 'counted distinct ids', cause: 'the join multiplies rows' } }),
        defaultPolicy,
        at,
        'k_existing',
      ),
    );

    const report = await distill({
      memory,
      policy: defaultPolicy,
      clock: fixedClock(at),
      random: mulberry32(4),
      // The helper defaults to a payload; this candidate is the one a model returns when it
      // writes `"payload": {}` and the parser normalises it away.
      interpreter: () => [
        candidate('fb_2', { statement: 'A different lesson with no payload.', payload: undefined }),
      ],
    });
    expect(report.contradicted).toBe(0);
    await memory.close();
  });
});

describe('interpreter failure isolation', () => {
  it('counts a throwing interpreter and still processes the rest of the batch', async () => {
    const memory = await EmbeddedMemory.open(new MemoryJournal());
    await memory.appendEvent(event('fb_1'));
    await memory.appendEvent(event('fb_2'));

    let call = 0;
    const report = await distill({
      memory,
      policy: defaultPolicy,
      clock: fixedClock(at),
      random: mulberry32(4),
      interpreter: (context) => {
        call += 1;
        // A model that answers with prose instead of JSON is the common case: one
        // bad response must not discard the batch.
        if (call === 1) throw new Error('LLM response is not JSON');
        return [candidate(context.event.id)];
      },
    });
    expect(report.failed).toBe(1);
    expect(report.created).toBe(1);
    await memory.close();
  });

  it('aborts when the host asked for strict mode', async () => {
    const memory = await EmbeddedMemory.open(new MemoryJournal());
    await memory.appendEvent(event('fb_1'));
    await expect(
      distill({
        memory,
        policy: defaultPolicy,
        clock: fixedClock(at),
        random: mulberry32(5),
        strict: true,
        interpreter: () => {
          throw new Error('parser failed');
        },
      }),
    ).rejects.toThrow(/parser failed/);
    await memory.close();
  });
});
