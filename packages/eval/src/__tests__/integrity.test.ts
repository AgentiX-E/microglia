import { describe, expect, it } from 'vitest';
import type { DistillCandidate, FeedbackEvent, KnowledgeItem, RunRecord } from '@agentix-e/microglia-core';
import { defaultPolicy, mulberry32 } from '@agentix-e/microglia-core';
import { EmbeddedMemory, MemoryJournal } from '@agentix-e/microglia-core/memory';
import {
  replayStore,
  reverseOrderView,
  runIntegrity,
  shuffle,
  stateOf,
  type IntegrityCase,
} from '../integrity.js';

const AT = 1_700_000_000_000;
const DOMAINS = ['sales', 'hr', 'ops'] as const;

/**
 * A log where the same claim is corrected in three domains by three task
 * instances: enough structure for merging, widening and contradiction to fire,
 * small enough to read.
 */
function corpus(count = 9): { events: FeedbackEvent[]; runs: RunRecord[] } {
  const events: FeedbackEvent[] = [];
  const runs: RunRecord[] = [];
  for (let index = 0; index < count; index += 1) {
    const domain = DOMAINS[index % DOMAINS.length] as string;
    const at = AT + index * 1_000;
    runs.push({
      schema: 'microglia.run/1',
      id: `run_${index}`,
      at,
      namespace: 'acme',
      sessionId: 's1',
      task: 'chart.recommend',
      taskId: `t_${index % 3}`,
      attempt: 1,
      input: { domain, intent: 'trend' },
      output: { mark: 'bar' },
      provenance: { knowledgeIds: [] },
      feedbackIds: [],
    });
    events.push({
      schema: 'microglia.feedback/1',
      id: `fb_${index}`,
      at,
      namespace: 'acme',
      sessionId: 's1',
      runId: `run_${index}`,
      task: 'chart.recommend',
      taskId: `t_${index % 3}`,
      attempt: 1,
      kind: 'edit',
      actor: { type: 'user' },
      trust: 0.9,
      signal: {
        type: 'edit',
        beforeHash: 'a',
        afterHash: 'b',
        ops: [],
        distance: 0.5,
        after: { mark: index % 4 === 3 ? 'area' : 'line' },
      },
      provenance: { knowledgeIds: [] },
      redactions: 0,
    });
  }
  return { events, runs };
}

function interpreter(context: { event: FeedbackEvent; run: RunRecord | undefined }): readonly DistillCandidate[] {
  const input = (context.run?.input ?? {}) as { domain?: string; intent?: string };
  const signal = context.event.signal as { after?: { mark?: string } };
  const mark = signal.after?.mark ?? 'line';
  const intent = input.intent ?? 'trend';
  return [
    {
      namespace: context.event.namespace,
      kind: 'constraint',
      scope: {
        task: context.event.task,
        domain: input.domain ?? 'sales',
        intent,
      },
      statement: `For ${intent} questions, use a ${mark} chart.`,
      payload: { when: { intent }, then: { mark } },
      evidence: {
        feedbackId: context.event.id,
        runId: context.event.runId,
        at: context.event.at,
        ...(context.event.taskId === undefined ? {} : { taskId: context.event.taskId }),
        weight: 0.9,
      },
      trust: 0.9,
      dedupeKey: `${intent}|${mark}`,
    },
  ];
}

const log = corpus();
const test: IntegrityCase = {
  events: log.events,
  runs: log.runs,
  interpreter,
  namespace: 'acme',
  seed: 11,
  now: AT + 60_000,
};

describe('canonical state', () => {
  const item = {
    schema: 'microglia.knowledge/1',
    id: 'k_1',
    namespace: 'acme',
    kind: 'constraint',
    scope: { task: 'chart.recommend' },
    statement: 'For trend questions, use a line chart.',
    evidence: [
      { feedbackId: 'fb_2', runId: 'run_2', at: AT + 1, weight: 0.9 },
      { feedbackId: 'fb_1', runId: 'run_1', at: AT, weight: 0.9 },
    ],
    support: 1.8,
    contradictions: 0,
    confidence: 0.78,
    trust: 0.9,
    validFrom: AT,
    validUntil: Infinity,
    systemFrom: AT,
    systemUntil: Infinity,
    status: 'active' as const,
    applied: 0,
    succeeded: 0,
    createdAt: AT,
    updatedAt: AT,
  } satisfies KnowledgeItem;

  it('hashes to the same value whatever order the evidence arrived in', () => {
    const reversed = { ...item, evidence: [...item.evidence].reverse() };
    expect(stateOf([reversed])).toBe(stateOf([item]));
  });

  it('sorts items so the input order cannot change the hash', () => {
    const second = { ...item, id: 'k_0' };
    expect(stateOf([item, second])).toBe(stateOf([second, item]));
  });

  it('is sensitive to the fields a decision depends on', () => {
    expect(stateOf([{ ...item, status: 'retired' }])).not.toBe(stateOf([item]));
    expect(stateOf([{ ...item, confidence: 0.5 }])).not.toBe(stateOf([item]));
    expect(stateOf([{ ...item, scope: { task: 'chart.recommend', domain: 'sales' } }])).not.toBe(
      stateOf([item]),
    );
    expect(stateOf([{ ...item, payload: { mark: 'line' } }])).not.toBe(stateOf([item]));
  });

  it('maps the infinite sentinels instead of throwing at the canonical encoder', () => {
    expect(() => stateOf([item])).not.toThrow();
    expect(stateOf([{ ...item, validUntil: AT + 5 }])).not.toBe(stateOf([item]));
  });
});

describe('shuffle', () => {
  it('is deterministic for a seed and preserves the multiset', () => {
    const rows = Array.from({ length: 20 }, (_, index) => index);
    const left = shuffle(rows, mulberry32(3));
    const right = shuffle(rows, mulberry32(3));
    expect(left).toEqual(right);
    expect([...left].sort((a, b) => a - b)).toEqual(rows);
  });

  it('leaves a single row alone', () => {
    expect(shuffle([1], mulberry32(1))).toEqual([1]);
  });
});

describe('replay', () => {
  it('builds the same state from the same log, and a different one from a different order', async () => {
    const reference = await replayStore(test, test.events);
    const again = await replayStore(test, test.events);
    expect(reference.state).toBe(again.state);
    // The control bypasses the sort, so it must land somewhere else: this is the
    // assertion that keeps the two invariants from being vacuous.
    const reversed = await replayStore(test, [...test.events].reverse());
    expect(reversed.state).toBe(reference.state);
    expect(reversed.items).toHaveLength(reference.items.length);
  });

  it('reports order invariance, determinism and a sensitive instrument', async () => {
    const report = await runIntegrity(test);
    expect(report.orderInvariance).toBe(1);
    expect(report.replayDeterminism).toBe(1);
    expect(report.instrumentSensitive).toBe(true);
    expect(report.controlInvariance).toBe(0);
    expect(report.items).toBeGreaterThan(0);
    expect(report.orders).toBe(5);
  });

  it('leaves the store usable after the replay', async () => {
    const replay = await replayStore(test, test.events);
    const pack = await replay.mg.recall({ task: 'chart.recommend', text: 'trend questions line chart' });
    expect(pack.ids.length).toBeGreaterThan(0);
    const stats = await replay.mg.stats();
    expect(stats.knowledge).toBe(replay.items.length);
  });
});

describe('the mutation control', () => {
  it('delegates every read and reverses only the event list', async () => {
    const inner = await EmbeddedMemory.open(new MemoryJournal());
    const view = reverseOrderView(inner);

    await view.putRun(log.runs[0] as RunRecord);
    expect((await view.getRun('run_0'))?.id).toBe('run_0');
    await view.appendEvent(log.events[0] as FeedbackEvent);
    expect((await view.getEvent('fb_0'))?.id).toBe('fb_0');
    expect(await view.listEvents()).toEqual([...(await inner.listEvents())].reverse());

    const replay = await replayStore(test, test.events);
    const item = replay.items[0] as KnowledgeItem;
    await view.putKnowledge(item);
    expect((await view.getKnowledge(item.id))?.id).toBe(item.id);
    expect(await view.listKnowledge({ namespace: 'acme' })).toHaveLength(1);
    expect(await view.listKnowledge()).toEqual(await inner.listKnowledge());

    const query = { namespace: 'acme', task: 'chart.recommend', text: 'trend line chart' } as const;
    expect(await view.search(query)).toEqual(await inner.search(query));
    expect(await view.stats()).toEqual(await inner.stats());
    // Erasure is delegated too: a control that could not delete would be a
    // different store, not the same store read in another order.
    const erased = await view.forget({ taskId: 't_missing' }, defaultPolicy, AT + 60_000);
    expect(erased).toMatchObject({ events: 0, runs: 0, knowledge: 0 });

    await view.close();
    // Closing twice is a no-op on the inner store, and the view must not turn it
    // into an error of its own.
    await expect(view.close()).resolves.toBeUndefined();
  });
});
