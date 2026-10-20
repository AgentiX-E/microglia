/**
 * Contract tests for the storage layer's less-travelled paths.
 *
 * The journal is the only durable thing in the product: if it cannot tell a
 * missing file from a corrupt one, an embedded deployment either loses feedback
 * silently or refuses to start with no explanation. Both cases are asserted
 * here, on the real filesystem, with no fakes.
 */
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EmbeddedMemory, JsonlJournal, journalPath } from '../index.js';
import type { FeedbackEvent, KnowledgeItem, RunRecord } from '@agentix-e/microglia-core';
import { defaultPolicy, createKnowledgeItem } from '@agentix-e/microglia-core';

const AT = 1_700_000_000_000;

/** A journal file on disk: ordering and lifecycle are properties of the file. */
async function openMemory(): Promise<EmbeddedMemory> {
  const dir = await mkdtemp(join(tmpdir(), 'mg-case-'));
  return EmbeddedMemory.open(new JsonlJournal({ dir }));
}

function event(id: string, at = AT): FeedbackEvent {
  return {
    schema: 'microglia.feedback/1',
    id,
    at,
    namespace: 'acme',
    sessionId: 's',
    runId: `run_${id}`,
    task: 'chart.recommend',
    kind: 'rating',
    actor: { type: 'user' },
    trust: 0.6,
    signal: { type: 'rating', value: 'up', reasons: [] },
    provenance: { knowledgeIds: [] },
    redactions: 0,
  };
}

function run(id: string, at = AT): RunRecord {
  return {
    schema: 'microglia.run/1',
    id,
    at,
    namespace: 'acme',
    sessionId: 's',
    task: 'chart.recommend',
    input: { q: 'trend of revenue' },
    output: { mark: 'line' },
    provenance: { knowledgeIds: [] },
    feedbackIds: [],
  };
}

function knowledge(id: string, overrides: Partial<KnowledgeItem> = {}): KnowledgeItem {
  return {
    ...createKnowledgeItem(
      {
        namespace: 'acme',
        kind: 'constraint',
        scope: { task: 'chart.recommend', domain: 'sales', intent: 'trend' },
        statement: `rule ${id}`,
        payload: { when: { intent: 'trend' }, then: { mark: 'line' } },
        evidence: { feedbackId: `fb_${id}`, runId: 'r', at: AT, weight: 0.9 },
        trust: 0.9,
        dedupeKey: id,
      },
      defaultPolicy,
      AT,
      id,
    ),
    ...overrides,
  };
}

describe('journal failures', () => {
  it('reports an unreadable path as a store error rather than treating it as empty', async () => {
    // A directory where a file is expected is the cheapest way to produce a
    // non-ENOENT read failure on every platform.
    const dir = await mkdtemp(join(tmpdir(), 'mg-io-'));
    await mkdir(journalPath(dir, 'events'), { recursive: true });
    await expect(EmbeddedMemory.open(new JsonlJournal({ dir }))).rejects.toMatchObject({
      code: 'MG_E_STORE_IO',
    });
  });

  it('still treats a missing journal as an empty store', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mg-new-'));
    const memory = await EmbeddedMemory.open(new JsonlJournal({ dir }));
    expect(await memory.stats()).toMatchObject({ events: 0, runs: 0, knowledge: 0 });
    await memory.close();
  });

  it('skips a blank trailing line instead of failing to parse it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mg-blank-'));
    const journal = new JsonlJournal({ dir });
    await journal.load();
    await writeFile(
      journalPath(dir, 'events'),
      `${JSON.stringify(event('fb_1'))}\n\n`,
      'utf8',
    );
    const memory = await EmbeddedMemory.open(new JsonlJournal({ dir }));
    expect((await memory.listEvents()).map((entry) => entry.id)).toEqual(['fb_1']);
    await memory.close();
  });
});

describe('deterministic ordering', () => {
  it('breaks an identical timestamp by id in both directions', async () => {
    const memory = await openMemory();
    // Inserted out of order so the comparator sees both `a < b` and `b > a`.
    for (const id of ['fb_c', 'fb_a', 'fb_b']) await memory.appendEvent(event(id));
    expect((await memory.listEvents()).map((entry) => entry.id)).toEqual([
      'fb_a',
      'fb_b',
      'fb_c',
    ]);
    await memory.close();
  });

  it('orders runs and events by time when timestamps differ', async () => {
    const memory = await openMemory();
    await memory.appendEvent(event('fb_late', AT + 10));
    await memory.appendEvent(event('fb_early', AT));
    expect((await memory.listEvents({ since: AT + 1 })).map((entry) => entry.id)).toEqual([
      'fb_late',
    ]);
    await memory.close();
  });
});

describe('filters and lifecycle', () => {
  it('lists knowledge with no filter at all', async () => {
    const memory = await openMemory();
    await memory.putKnowledge(knowledge('k_1'));
    const rows = await memory.listKnowledge();
    expect(rows).toHaveLength(1);
    await memory.close();
  });

  it('filters knowledge by task and status together', async () => {
    const memory = await openMemory();
    await memory.putKnowledge(knowledge('k_1'));
    await memory.putKnowledge(knowledge('k_2', { scope: { task: 'sql.generate' } }));
    expect(await memory.listKnowledge({ task: 'chart.recommend' })).toHaveLength(1);
    expect(await memory.listKnowledge({ status: 'active' })).toHaveLength(2);
    await memory.close();
  });

  it('closes twice without touching a closed journal again', async () => {
    const memory = await openMemory();
    await memory.close();
    await expect(memory.close()).resolves.toBeUndefined();
  });

  it('refuses writes after close but keeps reads available', async () => {
    // Reads are served from memory and stay correct after the journal is closed;
    // a write would be lost, so that is what the store rejects.
    const memory = await openMemory();
    await memory.appendEvent(event('fb_1'));
    await memory.close();
    await expect(memory.appendEvent(event('fb_2'))).rejects.toThrow(/MG_E_NOT_OPEN/);
    expect(await memory.listEvents()).toHaveLength(1);
  });
});

describe('persistence round-trip', () => {
  it('reloads runs, events, and knowledge from a real journal', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mg-rt-'));
    const first = await EmbeddedMemory.open(new JsonlJournal({ dir }));
    await first.appendEvent(event('fb_1'));
    await first.putRun(run('r_1'));
    await first.putKnowledge(knowledge('k_1'));
    await first.close();

    const second = await EmbeddedMemory.open(new JsonlJournal({ dir }));
    expect(await second.getEvent('fb_1')).toMatchObject({ id: 'fb_1' });
    expect(await second.getRun('r_1')).toMatchObject({ id: 'r_1' });
    expect(await second.getKnowledge('k_1')).toMatchObject({ id: 'k_1', status: 'active' });
    await second.close();
  });
});

describe('namespace isolation', () => {
  it('excludes rows from another namespace when one is named', async () => {
    const memory = await openMemory();
    await memory.putKnowledge(knowledge('k_1'));
    await memory.putKnowledge({ ...knowledge('k_2'), namespace: 'other' });
    expect((await memory.listKnowledge({ namespace: 'acme' })).map((row) => row.id)).toEqual([
      'k_1',
    ]);
    expect((await memory.listKnowledge({ namespace: 'other' })).map((row) => row.id)).toEqual([
      'k_2',
    ]);
    await memory.close();
  });

  it('never returns a foreign row from search', async () => {
    const memory = await openMemory();
    await memory.putKnowledge(knowledge('k_1'));
    await memory.putKnowledge({ ...knowledge('k_2'), namespace: 'other' });
    const hits = await memory.search({
      task: 'chart.recommend',
      text: 'rule',
      namespace: 'acme',
      scope: { domain: 'sales' },
    });
    expect(hits.map((hit) => hit.item.id)).toEqual(['k_1']);
    await memory.close();
  });

  it('refuses a knowledge item with no namespace at all', async () => {
    const memory = await openMemory();
    await expect(memory.putKnowledge({ ...knowledge('k_1'), namespace: '' })).rejects.toThrow(
      /MG_E_NAMESPACE_MISMATCH/,
    );
    await memory.close();
  });
});

describe('timestamp rehydration with real values', () => {
  it('preserves finite validity bounds across a reopen', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mg-bounds-'));
    const first = await EmbeddedMemory.open(new JsonlJournal({ dir }));
    await first.putKnowledge({ ...knowledge('k_1'), validUntil: 5, systemUntil: 6 });
    await first.close();

    const second = await EmbeddedMemory.open(new JsonlJournal({ dir }));
    const restored = await second.getKnowledge('k_1');
    expect(restored?.validUntil).toBe(5);
    expect(restored?.systemUntil).toBe(6);
    await second.close();
  });
});
