import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createKnowledgeItem,
  defaultPolicy,
  mulberry32,
  newId,
  type DistillCandidate,
  type FeedbackEvent,
  type KnowledgeItem,
  type RunRecord,
} from '../../kernel/index.js';
import {
  EmbeddedMemory,
  JsonlJournal,
  MemoryJournal,
  journalPath,
  type MemoryPort,
} from '../index.js';

const now = 1_700_000_000_000;

function candidate(overrides: Partial<DistillCandidate> = {}): DistillCandidate {
  return {
    namespace: 'acme',
    kind: 'constraint',
    scope: { task: 'chart.recommend', domain: 'sales', intent: 'trend' },
    statement: 'For a monthly trend in sales, prefer a line chart.',
    evidence: { feedbackId: 'fb_1', runId: 'run_1', at: now, weight: 0.9 },
    trust: 0.9,
    dedupeKey: 'k1',
    ...overrides,
  };
}

function item(overrides: Partial<DistillCandidate> = {}, id = 'k_1'): KnowledgeItem {
  return createKnowledgeItem(candidate(overrides), defaultPolicy, now, id);
}

async function openMemory(): Promise<MemoryPort> {
  return EmbeddedMemory.open(new MemoryJournal());
}

describe('embedded memory', () => {
  it('stores and retrieves events by run and time', async () => {
    const memory = await openMemory();
    const event: FeedbackEvent = {
      schema: 'microglia.feedback/1',
      id: 'fb_1',
      at: now,
      namespace: 'acme',
      sessionId: 's1',
      runId: 'run_1',
      task: 'chart.recommend',
      kind: 'rating',
      actor: { type: 'user' },
      trust: 0.5,
      signal: { type: 'rating', value: 'down', reasons: ['wrong_chart_type'] },
      provenance: { knowledgeIds: [] },
      redactions: 0,
    };
    await memory.appendEvent(event);
    await memory.appendEvent({ ...event, id: 'fb_2', at: now + 10, runId: 'run_2' });

    expect(await memory.getEvent('fb_1')).toEqual(event);
    expect(await memory.listEvents({ runId: 'run_1' })).toHaveLength(1);
    expect(await memory.listEvents({ since: now + 5 })).toHaveLength(1);
    expect((await memory.listEvents())[0]?.id).toBe('fb_1');
    await memory.close();
  });

  it('only returns active knowledge in the same namespace', async () => {
    const memory = await openMemory();
    await memory.putKnowledge(item({}, 'k_active'));
    await memory.putKnowledge(
      item({ namespace: 'other', evidence: { feedbackId: 'fb_x', runId: 'r', at: now, weight: 0.9 } }, 'k_other'),
    );
    await memory.putKnowledge(item({ trust: 0.2 }, 'k_quarantine'));

    const hits = await memory.search({
      task: 'chart.recommend',
      text: 'monthly revenue trend sales',
      namespace: 'acme',
    });
    expect(hits.map((hit) => hit.item.id)).toEqual(['k_active']);
    await memory.close();
  });

  it('ranks a lexically closer rule first and breaks ties deterministically', async () => {
    const memory = await openMemory();
    await memory.putKnowledge(item({ statement: 'Prefer a line chart for monthly revenue trends.' }, 'k_line'));
    await memory.putKnowledge(
      item({
        statement: 'Exclude cancelled orders from revenue.',
        scope: { task: 'chart.recommend', domain: 'sales', intent: 'trend' },
        evidence: { feedbackId: 'fb_2', runId: 'run_2', at: now, weight: 0.9 },
      }, 'k_cancel'),
    );
    const hits = await memory.search({
      task: 'chart.recommend',
      text: 'monthly revenue trend',
      namespace: 'acme',
    });
    expect(hits[0]?.item.id).toBe('k_line');
    expect(hits).toHaveLength(2);
    await memory.close();
  });

  it('applies a scope filter rather than relying on ranking alone', async () => {
    const memory = await openMemory();
    await memory.putKnowledge(item({ scope: { task: 'chart.recommend', domain: 'sales' } }, 'k_sales'));
    await memory.putKnowledge(item({ scope: { task: 'chart.recommend', domain: 'hr' } }, 'k_hr'));
    const hits = await memory.search({
      task: 'chart.recommend',
      text: 'monthly trend',
      namespace: 'acme',
      scope: { domain: 'hr' },
    });
    expect(hits.map((hit) => hit.item.id)).toEqual(['k_hr']);
    await memory.close();
  });

  it('reports counts and refuses writes after close', async () => {
    const memory = await openMemory();
    await memory.putKnowledge(item());
    expect(await memory.stats()).toEqual({ events: 0, runs: 0, knowledge: 1, active: 1 });
    await memory.close();
    await expect(memory.putKnowledge(item())).rejects.toMatchObject({ code: 'MG_E_NOT_OPEN' });
  });
});

describe('JSONL journal', () => {
  it('survives a reopen with knowledge supersession resolved to the latest write', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'microglia-'));
    const first = await EmbeddedMemory.open(new JsonlJournal({ dir }));
    const original = item();
    await first.putKnowledge(original);
    await first.putKnowledge({ ...original, statement: 'Updated statement.', confidence: 0.7 });
    await first.close();

    const second = await EmbeddedMemory.open(new JsonlJournal({ dir, compactOnOpen: true }));
    const restored = await second.getKnowledge(original.id);
    expect(restored?.statement).toBe('Updated statement.');
    const lines = (await readFile(journalPath(dir, 'knowledge'), 'utf8')).trim().split('\n');
    expect(lines).toHaveLength(1);
    await second.close();
  });

  it('round-trips runs and events across processes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'microglia-'));
    const run: RunRecord = {
      schema: 'microglia.run/1',
      id: 'run_1',
      at: now,
      namespace: 'acme',
      sessionId: 's1',
      task: 'chart.recommend',
      input: { question: 'revenue by month' },
      output: { mark: 'bar' },
      provenance: { knowledgeIds: [] },
      feedbackIds: [],
    };
    const first = await EmbeddedMemory.open(new JsonlJournal({ dir }));
    await first.putRun(run);
    await first.close();

    const second = await EmbeddedMemory.open(new JsonlJournal({ dir }));
    expect(await second.getRun('run_1')).toEqual(run);
    await second.close();
  });

  it('reports a corrupt line with its number instead of dropping it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'microglia-'));
    const journal = new JsonlJournal({ dir });
    await journal.load();
    await writeFile(journalPath(dir, 'events'), '{"ok":true}\nnot-json\n', 'utf8');
    await expect(EmbeddedMemory.open(new JsonlJournal({ dir }))).rejects.toMatchObject({
      code: 'MG_E_STORE_CORRUPT',
    });
  });

  it('requires a directory', () => {
    expect(() => new JsonlJournal({ dir: '' })).toThrow(/MG_E_CONFIG/);
  });
});

describe('determinism', () => {
  it('produces identical ids and order under the same seed', async () => {
    const build = async (): Promise<string[]> => {
      const random = mulberry32(11);
      const memory = await openMemory();
      for (let i = 0; i < 5; i += 1) {
        await memory.putKnowledge(
          item(
            {
              statement: `Rule ${i} about monthly revenue trend.`,
              evidence: { feedbackId: `fb_${i}`, runId: `run_${i}`, at: now, weight: 0.9 },
            },
            newId('k', now + i, random),
          ),
        );
      }
      const hits = await memory.search({
        task: 'chart.recommend',
        text: 'monthly revenue trend',
        namespace: 'acme',
      });
      await memory.close();
      return hits.map((hit) => hit.item.id);
    };
    expect(await build()).toEqual(await build());
  });
});

describe('timestamp round-trip', () => {
  it('rehydrates the two infinite timestamps that JSON encodes as null', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'microglia-'));
    const first = await EmbeddedMemory.open(new JsonlJournal({ dir }));
    await first.putKnowledge(item());
    await first.close();

    const second = await EmbeddedMemory.open(new JsonlJournal({ dir }));
    const restored = await second.getKnowledge('k_1');
    expect(restored?.validUntil).toBe(Infinity);
    expect(restored?.systemUntil).toBe(Infinity);
    expect(Number.isFinite(restored?.confidence ?? Number.NaN)).toBe(true);
    await second.close();
  });
});
