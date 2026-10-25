import { describe, expect, it } from 'vitest';
import {
  createKnowledgeItem,
  defaultPolicy,
  type DistillCandidate,
  type KnowledgeItem,
} from '../../kernel/index.js';
import { EmbeddedMemory, MemoryJournal } from '../../memory/index.js';
import { openMicroglia } from '../index.js';

const AT = 1_700_000_000_000;

function item(id: string, observations: number): KnowledgeItem {
  const candidate: DistillCandidate = {
    namespace: 'acme',
    kind: 'constraint',
    scope: { task: 'chart.recommend', domain: 'sales' },
    statement: `Rule ${id} about revenue by region.`,
    evidence: { feedbackId: `fb_${id}_1`, runId: `run_${id}`, at: AT, weight: 0.9 },
    trust: 0.9,
    dedupeKey: `k_${id}`,
  };
  const base = createKnowledgeItem(candidate, defaultPolicy, AT, id);
  if (observations === 1) return base;
  return {
    ...base,
    evidence: Array.from({ length: observations }, (_, index) => ({
      feedbackId: `fb_${id}_${index + 1}`,
      runId: `run_${id}`,
      at: AT + index,
      weight: 0.9,
    })),
    support: 0.9 * observations,
  };
}

async function host(items: readonly KnowledgeItem[], floor?: number) {
  const store = await EmbeddedMemory.open(new MemoryJournal());
  for (const entry of items) await store.putKnowledge(entry);
  return openMicroglia({
    app: 'acme',
    namespace: 'acme',
    store,
    ...(floor === undefined ? {} : { corroborationFloor: floor }),
  });
}

const query = { task: 'chart.recommend', text: 'revenue by region', scope: { domain: 'sales' } };

describe('a store that cannot corroborate itself', () => {
  it('injects anyway when no floor is configured', async () => {
    const mg = await host([item('a', 1), item('b', 1)]);
    const pack = await mg.recall(query);
    expect(pack.ids).toHaveLength(2);
    expect(pack.suppressed).toBeUndefined();
    await mg.close();
  });

  it('silences the pack and says why when the floor is configured and unmet', async () => {
    const mg = await host([item('a', 1), item('b', 1)], 0.05);
    const pack = await mg.recall(query);
    expect(pack.ids).toEqual([]);
    expect(pack.rendered).toBe('');
    expect(pack.suppressed).toBe('uncorroborated-store');
    await mg.close();
  });

  it('injects normally once enough of the store is corroborated', async () => {
    const mg = await host([item('a', 2), item('b', 2)], 0.05);
    const pack = await mg.recall(query);
    expect(pack.ids).toHaveLength(2);
    expect(pack.suppressed).toBeUndefined();
    await mg.close();
  });

  it('answers the second request from the cache and the same verdict', async () => {
    // The share is a per-distillation fact read on the request path: recomputing it per
    // request would tax every call for a value that only changes when knowledge does.
    const mg = await host([item('a', 1)], 0.05);
    const first = await mg.recall(query);
    const second = await mg.recall(query);
    expect(second.suppressed).toBe('uncorroborated-store');
    expect(second.hash).toBe(first.hash);
    await mg.close();
  });

  it('refuses a floor outside [0, 1]', async () => {
    await expect(host([], 1.5)).rejects.toThrow(/MG_E_CONFIG/);
    await expect(host([], -0.1)).rejects.toThrow(/MG_E_CONFIG/);
  });

  it('recomputes the share when the knowledge changes', async () => {
    // The cache is invalidated by distillation, and a host that adds the second
    // observation has to see the pack come back without restarting.
    const mg = await host([item('a', 1)], 0.05);
    expect((await mg.recall(query)).suppressed).toBe('uncorroborated-store');
    await mg.store.putKnowledge(item('b', 2));
    await mg.distill();
    const after = await mg.recall(query);
    expect(after.suppressed).toBeUndefined();
    expect(after.ids.length).toBeGreaterThan(0);
    await mg.close();
  });
});
