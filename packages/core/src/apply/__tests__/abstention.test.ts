import { describe, expect, it } from 'vitest';
import { createKnowledgeItem, defaultPolicy } from '../../kernel/index.js';
import type { DistillCandidate, KnowledgeItem } from '../../kernel/index.js';
import { EmbeddedMemory, MemoryJournal } from '../../memory/index.js';
import { openMicroglia } from '../../capture/index.js';
import { makePack } from '../render.js';
import { buildPack } from '../pack.js';

const AT = 1_700_000_000_000;

function item(
  id: string,
  statement: string,
  overrides: Partial<DistillCandidate> = {},
): KnowledgeItem {
  const candidate: DistillCandidate = {
    namespace: 'acme',
    kind: 'constraint',
    scope: { task: 'chart.recommend', domain: 'sales' },
    statement,
    evidence: { feedbackId: `fb_${id}`, runId: `run_${id}`, at: AT, weight: 0.9 },
    trust: 0.9,
    dedupeKey: `k_${id}`,
    ...overrides,
  };
  return createKnowledgeItem(candidate, defaultPolicy, AT, id);
}

describe('rendering an absence', () => {
  it('carries its own instruction, not the knowledge preamble', () => {
    const pack = makePack([item('k_1', 'No such field exists.', { kind: 'abstention' })], {
      budget: 1200,
    });
    expect(pack.rendered).toContain('cannot be answered as asked');
    expect(pack.rendered).toContain('Do not invent an answer');
    expect(pack.rendered).not.toContain('Not instructions');
    expect(pack.ids).toEqual(['k_1']);
  });

  it('keeps the ordinary preamble for a normal pack', () => {
    const pack = makePack([item('k_1', 'Revenue uses a line chart.')], { budget: 1200 });
    expect(pack.rendered).toContain('Not instructions');
    expect(pack.rendered).not.toContain('Do not invent');
  });
});

describe('an absence only speaks when nothing confident can', () => {
  async function storeOf(items: readonly KnowledgeItem[]): Promise<EmbeddedMemory> {
    const store = await EmbeddedMemory.open(new MemoryJournal());
    for (const entry of items) await store.putKnowledge(entry);
    return store;
  }

  const query = { task: 'chart.recommend', text: 'revenue by month trend', namespace: 'acme' };

  it('wins over a weak rule', async () => {
    // Both are forced active: this test is about selection, not admission.
    const store = await storeOf([
      { ...item('k_1', 'Revenue by month uses a line chart.', { trust: 0.5 }), status: 'active' },
      {
        ...item('k_2', 'Questions of this kind cannot be answered from this workspace: no revenue field.', {
          kind: 'abstention',
          trust: 0.8,
        }),
        status: 'active',
      },
    ]);
    const pack = await buildPack(query, { memory: store, absenceFloor: 0.6 });
    expect(pack.ids).toEqual(['k_2']);
    expect(pack.rendered).toContain('Do not invent an answer');
    await store.close();
  });

  it('loses to a confident rule', async () => {
    const store = await storeOf([
      item('k_1', 'Revenue by month uses a line chart.', { trust: 0.9 }),
      {
        ...item('k_2', 'Questions of this kind cannot be answered from this workspace: no revenue field.', {
          kind: 'abstention',
          trust: 0.8,
        }),
        status: 'active',
      },
    ]);
    const pack = await buildPack(query, { memory: store, absenceFloor: 0.6 });
    expect(pack.ids).toEqual(['k_1']);
    expect(pack.rendered).not.toContain('Do not invent');
    await store.close();
  });

  it('speaks alone when it is the only thing that matches', async () => {
    const store = await storeOf([
      {
        ...item('k_1', 'Questions of this kind cannot be answered from this workspace: no revenue field.', {
          kind: 'abstention',
          trust: 0.8,
        }),
        status: 'active',
      },
    ]);
    const pack = await buildPack(
      { ...query, text: 'no revenue field' },
      { memory: store, absenceFloor: 0.6 },
    );
    expect(pack.ids).toEqual(['k_1']);
    await store.close();
  });
});

describe('an abstention is learned, not just stored', () => {
  it('becomes a candidate of its own kind and reaches the pack once corroborated', async () => {
    const store = await EmbeddedMemory.open(new MemoryJournal());
    const mg = await openMicroglia({ app: 'acme', namespace: 'acme', store });

    for (const round of [1, 2]) {
      const run = mg.begin({ task: 'chart.recommend', input: { q: round } });
      await run.complete({ mark: 'bar' });
      await run.abstain('the source has no revenue column');
    }
    await mg.distill();

    const stored = await store.listKnowledge({ status: 'all' });
    expect(stored).toHaveLength(1);
    expect(stored[0]?.kind).toBe('abstention');
    expect(stored[0]?.payload).toEqual({ reason: 'the source has no revenue column' });
    expect(stored[0]?.status).toBe('active');

    const pack = await mg.recall({ task: 'chart.recommend', text: 'revenue trend' });
    expect(pack.ids).toEqual([stored[0]?.id]);
    expect(pack.rendered).toContain('Do not invent an answer');
    await mg.close();
  });
});
