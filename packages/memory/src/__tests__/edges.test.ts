import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createKnowledgeItem,
  defaultPolicy,
  type DistillCandidate,
  type FeedbackEvent,
} from '@agentix-e/microglia-core';
import {
  EmbeddedMemory,
  JsonlJournal,
  MemoryJournal,
  ensureParent,
  journalPath,
} from '../index.js';

const at = 1_700_000_000_000;

function item(id: string, overrides: Partial<DistillCandidate> = {}) {
  const candidate: DistillCandidate = {
    namespace: 'acme',
    kind: 'constraint',
    scope: { task: 'chart.recommend', domain: 'sales' },
    statement: `Rule ${id}`,
    evidence: { feedbackId: `fb_${id}`, runId: 'r', at, weight: 0.9 },
    trust: 0.9,
    dedupeKey: id,
    ...overrides,
  };
  return createKnowledgeItem(candidate, defaultPolicy, at, id);
}

function event(id: string, overrides: Partial<FeedbackEvent> = {}): FeedbackEvent {
  return {
    schema: 'microglia.feedback/1',
    id,
    at,
    namespace: 'acme',
    sessionId: 's1',
    runId: 'r1',
    task: 'chart.recommend',
    kind: 'rating',
    actor: { type: 'user' },
    trust: 0.5,
    signal: { type: 'rating', value: 'up', reasons: [] },
    provenance: { knowledgeIds: [] },
    redactions: 0,
    ...overrides,
  };
}

describe('store filters', () => {
  it('filters events by namespace, session, and limit', async () => {
    const memory = await EmbeddedMemory.open(new MemoryJournal());
    await memory.appendEvent(event('a'));
    await memory.appendEvent(event('b', { sessionId: 's2', at: at + 1 }));
    await memory.appendEvent(event('c', { namespace: 'other', at: at + 2 }));

    expect((await memory.listEvents({ namespace: 'acme' })).map((e) => e.id)).toEqual(['a', 'b']);
    expect((await memory.listEvents({ sessionId: 's2' })).map((e) => e.id)).toEqual(['b']);
    expect(await memory.listEvents({ limit: 1 })).toHaveLength(1);
    expect(await memory.getEvent('missing')).toBeUndefined();
    await memory.close();
  });

  it('filters knowledge by task, status, and limit', async () => {
    const memory = await EmbeddedMemory.open(new MemoryJournal());
    await memory.putKnowledge(item('a'));
    await memory.putKnowledge(item('b', { trust: 0.1 }));
    await memory.putKnowledge(item('c', { scope: { task: 'sql.generate', domain: 'sales' } }));

    expect(await memory.listKnowledge({ namespace: 'acme', task: 'chart.recommend' })).toHaveLength(2);
    expect(await memory.listKnowledge({ namespace: 'acme', status: 'quarantined' })).toHaveLength(1);
    expect(await memory.listKnowledge({ namespace: 'acme', limit: 1 })).toHaveLength(1);
    await memory.close();
  });

  it('returns every active item for an empty query, ranked by confidence', async () => {
    const memory = await EmbeddedMemory.open(new MemoryJournal());
    await memory.putKnowledge(item('a'));
    await memory.putKnowledge(item('b'));
    const hits = await memory.search({ task: 'chart.recommend', text: '', namespace: 'acme' });
    expect(hits).toHaveLength(2);
    await memory.close();
  });

  it('rejects knowledge without a namespace', async () => {
    const memory = await EmbeddedMemory.open(new MemoryJournal());
    await expect(memory.putKnowledge({ ...item('a'), namespace: '' })).rejects.toThrow(
      /MG_E_NAMESPACE_MISMATCH/,
    );
    await memory.close();
  });

  it('returns an undefined run rather than throwing', async () => {
    const memory = await EmbeddedMemory.open(new MemoryJournal());
    expect(await memory.getRun('nope')).toBeUndefined();
    expect(await memory.getKnowledge('nope')).toBeUndefined();
    await memory.close();
  });
});

describe('journal edges', () => {
  it('refuses an append before open', async () => {
    const journal = new MemoryJournal();
    await expect(journal.appendEvent(event('a'))).resolves.toBeUndefined();
  });

  it('refuses to append to a JSONL journal that was never loaded', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mg-'));
    const journal = new JsonlJournal({ dir });
    await expect(journal.appendEvent(event('a'))).rejects.toThrow(/MG_E_NOT_OPEN/);
  });

  it('exposes the journal path and creates parents', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mg-'));
    expect(journalPath(dir, 'events')).toContain('events.jsonl');
    await ensureParent(join(dir, 'a', 'b', 'c.jsonl'));
  });
});

describe('store idempotency and filters', () => {
  it('ignores a duplicate event or run id', async () => {
    const memory = await EmbeddedMemory.open(new MemoryJournal());
    await memory.appendEvent(event('a'));
    await memory.appendEvent(event('a'));
    expect(await memory.stats()).toMatchObject({ events: 1 });

    const run = {
      schema: 'microglia.run/1' as const,
      id: 'r1',
      at,
      namespace: 'acme',
      sessionId: 's',
      task: 'chart.recommend',
      input: { q: 'x' },
      output: null,
      provenance: { knowledgeIds: [] },
      feedbackIds: [],
    };
    await memory.putRun(run);
    await memory.putRun(run);
    expect(await memory.stats()).toMatchObject({ runs: 1 });
    await memory.close();
  });

  it('excludes other namespaces and inactive items from scope candidates', async () => {
    const memory = await EmbeddedMemory.open(new MemoryJournal());
    await memory.putKnowledge(item('a'));
    await memory.putKnowledge({ ...item('b'), namespace: 'other' });
    await memory.putKnowledge({ ...item('c'), status: 'candidate' });
    await memory.putKnowledge({ ...item('d'), scope: { task: 'sql.generate', domain: 'sales' } });

    const hits = await memory.search({
      task: 'chart.recommend',
      text: '',
      namespace: 'acme',
      scope: { domain: 'sales' },
    });
    expect(hits.map((hit) => hit.item.id)).toEqual(['a']);
    await memory.close();
  });

  it('rehydrates finite timestamps unchanged', async () => {
    const memory = await EmbeddedMemory.open(new MemoryJournal());
    await memory.putKnowledge({ ...item('a'), validUntil: 5, systemUntil: 6 });
    expect((await memory.getKnowledge('a'))?.validUntil).toBe(5);
    expect((await memory.getKnowledge('a'))?.systemUntil).toBe(6);
    await memory.close();
  });
});

describe('schema validation', () => {
  it('refuses a journal written by an unknown schema version', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mg-'));
    const journal = new JsonlJournal({ dir });
    await journal.load();
    await writeFile(
      journalPath(dir, 'events'),
      `${JSON.stringify({ ...event('a'), schema: 'microglia.feedback/0' })}\n`,
      'utf8',
    );
    await expect(EmbeddedMemory.open(new JsonlJournal({ dir }))).rejects.toMatchObject({
      code: 'MG_E_SCHEMA_VERSION',
    });
  });
});

describe('deterministic tie ordering', () => {
  it('orders knowledge with the same updatedAt by id', async () => {
    const memory = await EmbeddedMemory.open(new MemoryJournal());
    await memory.putKnowledge(item('b'));
    await memory.putKnowledge(item('a'));
    const rows = await memory.listKnowledge({ namespace: 'acme' });
    expect(rows.map((entry) => entry.id)).toEqual(['a', 'b']);
    await memory.close();
  });

  it('orders scope-only search hits by id when scores tie', async () => {
    const memory = await EmbeddedMemory.open(new MemoryJournal());
    await memory.putKnowledge(item('b'));
    await memory.putKnowledge(item('a'));
    const hits = await memory.search({
      task: 'chart.recommend',
      text: '',
      namespace: 'acme',
      scope: { domain: 'sales' },
    });
    expect(hits.map((hit) => hit.item.id)).toEqual(['a', 'b']);
    await memory.close();
  });
});
