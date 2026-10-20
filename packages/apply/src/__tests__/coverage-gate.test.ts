import { describe, expect, it } from 'vitest';
import {
  createKnowledgeItem,
  defaultPolicy,
  type DistillCandidate,
  type KnowledgeItem,
} from '@agentix-e/microglia-core';
import { EmbeddedMemory, MemoryJournal } from '@agentix-e/microglia-memory';
import { buildPack } from '../pack.js';

const at = 1_700_000_000_000;

function item(statement: string, id: string): KnowledgeItem {
  const candidate: DistillCandidate = {
    namespace: 'acme',
    kind: 'constraint',
    scope: { task: 'sql.generate', domain: 'shop' },
    statement,
    evidence: { feedbackId: `fb_${id}`, runId: 'run_1', at, weight: 0.9 },
    trust: 0.9,
    dedupeKey: id,
  };
  return createKnowledgeItem(candidate, defaultPolicy, at, id);
}

async function store(): Promise<EmbeddedMemory> {
  const memory = await EmbeddedMemory.open(new MemoryJournal());
  await memory.putKnowledge(item('Total revenue by region is reported in thousands of euros', 'topical'));
  await memory.putKnowledge(item('Patient identifiers are never reused across visits', 'scope_only'));
  return memory;
}

const query = { task: 'sql.generate', text: 'total revenue by region', namespace: 'acme', scope: { domain: 'shop' } };

describe('coverage gate', () => {
  it('injects every scope match when no floor is set', async () => {
    const memory = await store();
    const pack = await buildPack(query, { memory });
    expect(pack.ids.sort()).toEqual(['scope_only', 'topical']);
    await memory.close();
  });

  it('drops a rule the question does not mention, even in the same scope', async () => {
    const memory = await store();
    const pack = await buildPack({ ...query, minCoverage: 0.5 }, { memory });
    expect(pack.ids).toEqual(['topical']);
    await memory.close();
  });

  it('returns an empty pack rather than a weak one when nothing clears the floor', async () => {
    const memory = await store();
    const pack = await buildPack(
      { ...query, text: 'total revenue by region in february', minCoverage: 1 },
      { memory },
    );
    expect(pack.ids).toEqual([]);
    expect(pack.rendered).toBe('');
    expect(pack.items).toEqual([]);
    await memory.close();
  });

  it('lets the option override the query, and treats zero as no gate', async () => {
    const memory = await store();
    const overridden = await buildPack({ ...query, minCoverage: 1 }, { memory, minCoverage: 0.5 });
    expect(overridden.ids).toEqual(['topical']);
    const disabled = await buildPack({ ...query, minCoverage: 0.5 }, { memory, minCoverage: 0 });
    expect(disabled.ids.sort()).toEqual(['scope_only', 'topical']);
    await memory.close();
  });
});
