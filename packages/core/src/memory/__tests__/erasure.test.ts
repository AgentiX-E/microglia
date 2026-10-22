import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createKnowledgeItem,
  defaultPolicy,
  fixedClock,
  mulberry32,
  type DistillCandidate,
  type ErasureTombstone,
  type FeedbackEvent,
  type KnowledgeItem,
} from '../../kernel/index.js';
import { EmbeddedMemory, JsonlJournal, MemoryJournal } from '../index.js';
import { openMicroglia } from '../../capture/index.js';

const AT = 1_700_000_000_000;

function item(id: string, evidence: readonly string[], overrides: Partial<KnowledgeItem> = {}): KnowledgeItem {
  const candidate: DistillCandidate = {
    namespace: 'acme',
    kind: 'constraint',
    scope: { task: 'chart.recommend', domain: 'sales' },
    statement: `Rule ${id} for revenue questions.`,
    evidence: { feedbackId: evidence[0] as string, runId: 'run_a', at: AT, weight: 0.9 },
    trust: 0.9,
    dedupeKey: id,
  };
  const base = createKnowledgeItem(candidate, defaultPolicy, AT, id);
  return {
    ...base,
    evidence: evidence.map((feedbackId, index) => ({
      feedbackId,
      runId: `run_${index}`,
      at: AT + index,
      weight: 0.9,
    })),
    support: evidence.length * 0.9,
    ...overrides,
  };
}

function event(id: string, taskId: string, actorHash?: string): FeedbackEvent {
  return {
    schema: 'microglia.feedback/1',
    id,
    at: AT,
    namespace: 'acme',
    sessionId: 's1',
    runId: `run_${id}`,
    task: 'chart.recommend',
    taskId,
    attempt: 1,
    kind: 'edit',
    actor: { type: 'user', ...(actorHash === undefined ? {} : { idHash: actorHash }) },
    trust: 0.9,
    signal: {
      type: 'edit',
      beforeHash: 'a',
      afterHash: 'b',
      ops: [],
      distance: 0.5,
      after: { mark: 'line' },
    },
    provenance: { knowledgeIds: [] },
    redactions: 0,
  };
}

async function storeWith(
  items: readonly KnowledgeItem[],
  events: readonly FeedbackEvent[] = [],
): Promise<EmbeddedMemory> {
  const store = await EmbeddedMemory.open(new MemoryJournal());
  for (const entry of items) await store.putKnowledge(entry);
  for (const entry of events) {
    await store.putRun({
      schema: 'microglia.run/1',
      id: `run_${entry.id}`,
      at: entry.at,
      namespace: entry.namespace,
      sessionId: entry.sessionId,
      task: entry.task,
      taskId: entry.taskId,
      attempt: 1,
      input: {},
      output: {},
      provenance: { knowledgeIds: [] },
      feedbackIds: [],
    });
    await store.appendEvent(entry);
  }
  return store;
}

describe('erasure', () => {
  it('removes the events and runs of a task, and the claims left without evidence', async () => {
    const store = await storeWith(
      [item('k_solo', ['fb_a']), item('k_shared', ['fb_a', 'fb_b'])],
      [event('fb_a', 't1'), event('fb_b', 't2')],
    );
    const report = await store.forget({ taskId: 't1' }, defaultPolicy, AT + 10);
    expect(report).toMatchObject({ events: 1, runs: 1, knowledge: 1, rescored: 1 });

    expect(await store.getEvent('fb_a')).toBeUndefined();
    expect(await store.getEvent('fb_b')).toBeDefined();
    expect(await store.getKnowledge('k_solo')).toBeUndefined();

    const shared = await store.getKnowledge('k_shared');
    expect(shared?.evidence.map((entry) => entry.feedbackId)).toEqual(['fb_b']);
    expect(shared?.support).toBeCloseTo(0.9, 6);
    await store.close();
  });

  it('erases by actor hash and leaves other actors alone', async () => {
    const store = await storeWith(
      [item('k_1', ['fb_a']), item('k_2', ['fb_b'])],
      [event('fb_a', 't1', 'hash_alice'), event('fb_b', 't1', 'hash_bob')],
    );
    const report = await store.forget({ actorHash: 'hash_alice' }, defaultPolicy, AT + 10);
    expect(report.events).toBe(1);
    expect(await store.getKnowledge('k_1')).toBeUndefined();
    expect(await store.getKnowledge('k_2')).toBeDefined();
    await store.close();
  });

  it('erases an item named by id even when its evidence survives', async () => {
    const store = await storeWith([item('k_1', ['fb_a'])], [event('fb_a', 't1')]);
    const report = await store.forget({ ids: ['k_1'] }, defaultPolicy, AT + 10);
    expect(report.knowledge).toBe(1);
    expect(await store.getKnowledge('k_1')).toBeUndefined();
    // The event is still there: an item id is not an event id.
    expect(await store.getEvent('fb_a')).toBeDefined();
    await store.close();
  });

  it('refuses an empty selector, because that would be a wipe', async () => {
    const store = await storeWith([item('k_1', ['fb_a'])]);
    await expect(store.forget({}, defaultPolicy, AT)).rejects.toMatchObject({
      code: 'MG_E_CONFIG',
    });
    await store.close();
  });

  it('never reaches another namespace', async () => {
    const store = await storeWith(
      [
        item('k_1', ['fb_a']),
        item('k_2', ['fb_b'], { namespace: 'other' }),
      ],
      [event('fb_a', 't1', 'hash_alice'), { ...event('fb_b', 't1', 'hash_alice'), namespace: 'other' }],
    );
    await store.forget({ namespace: 'acme', actorHash: 'hash_alice' }, defaultPolicy, AT + 10);
    expect(await store.getKnowledge('k_1')).toBeUndefined();
    expect(await store.getKnowledge('k_2')).toBeDefined();
    expect(await store.getEvent('fb_b')).toBeDefined();
    await store.close();
  });

  it('makes an erased statement unreachable by recall', async () => {
    const store = await storeWith([item('k_1', ['fb_a'])], [event('fb_a', 't1')]);
    const before = await store.search({ namespace: 'acme', task: 'chart.recommend', text: 'revenue questions' });
    expect(before.length).toBeGreaterThan(0);
    await store.forget({ taskId: 't1' }, defaultPolicy, AT + 10);
    const after = await store.search({ namespace: 'acme', task: 'chart.recommend', text: 'revenue questions' });
    expect(after).toHaveLength(0);
    await store.close();
  });

  it('keeps the promotion only if the evidence that earned it survived', async () => {
    const outcomeEvent: FeedbackEvent = {
      ...event('fb_outcome', 't1'),
      kind: 'outcome',
      signal: { type: 'outcome', ok: true, code: 'ok' },
    };
    const store = await storeWith(
      [item('k_1', ['fb_text', 'fb_outcome'], { tier: 'outcome' })],
      [{ ...event('fb_text', 't1'), kind: 'clarification', signal: { type: 'clarification', question: 'q', answer: 'a' } }, outcomeEvent],
    );
    await store.forget({ ids: ['fb_outcome'] }, defaultPolicy, AT + 10);
    const demoted = await store.getKnowledge('k_1');
    expect(demoted?.tier).toBe('user-text');
    // One task of prose is not enough: the item is back behind the gate.
    expect(demoted?.status).toBe('candidate');
    expect(demoted?.statusReason).toBe('needs-corroboration');
    await store.close();
  });

  it('records a tombstone that says what was erased and nothing about it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'microglia-erase-'));
    try {
      const journal = new JsonlJournal({ dir });
      const store = await EmbeddedMemory.open(journal);
      await store.putKnowledge(item('k_1', ['fb_a']));
      await store.appendEvent(event('fb_a', 't1'));
      const report = await store.forget({ taskId: 't1' }, defaultPolicy, AT + 10);
      await store.close();

      const lines = (await readFile(join(dir, 'erasures.jsonl'), 'utf8')).trim().split('\n');
      const tombstone = JSON.parse(lines[0] as string) as ErasureTombstone;
      expect(tombstone.schema).toBe('microglia.erasure/1');
      expect(tombstone.id).toBe(report.tombstone);
      expect(tombstone.erased).toEqual({ events: ['fb_a'], runs: [], knowledge: ['k_1'] });
      expect(JSON.stringify(tombstone)).not.toContain('Rule k_1');

      // The rewritten journal is what a reopen sees: erasure survives a restart.
      const reopened = await EmbeddedMemory.open(new JsonlJournal({ dir }));
      expect(await reopened.getKnowledge('k_1')).toBeUndefined();
      expect(await reopened.getEvent('fb_a')).toBeUndefined();
      expect(await reopened.listEvents()).toHaveLength(0);
      await reopened.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('refuses to rewrite a journal that is not open', async () => {
    const journal = new JsonlJournal({ dir: await mkdtemp(join(tmpdir(), 'microglia-closed-')) });
    await journal.load();
    await journal.close();
    await expect(journal.rewrite({ events: [], runs: [], knowledge: [] })).rejects.toMatchObject({
      code: 'MG_E_NOT_OPEN',
    });
  });

  it('is reachable from the facade, scoped to its own namespace', async () => {
    const store = await storeWith([], [event('fb_a', 't1', 'hash_alice')]);
    const mg = await openMicroglia({
      app: 'test',
      namespace: 'acme',
      store,
      clock: fixedClock(AT + 10),
      random: mulberry32(1),
    });
    const report = await mg.forget({ actorHash: 'hash_alice' });
    expect(report.events).toBe(1);
    expect(await store.listEvents()).toHaveLength(0);
    await mg.close();
  });
});
