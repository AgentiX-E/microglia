import { describe, expect, it } from 'vitest';
import {
  createKnowledgeItem,
  defaultPolicy,
  mergeEvidence,
  type DistillCandidate,
  type KnowledgeItem,
} from '../../kernel/index.js';
import { EmbeddedMemory, MemoryJournal } from '../../memory/index.js';
import { buildPack } from '../pack.js';

const at = 1_700_000_000_000;

function candidate(id: string, statement: string): DistillCandidate {
  return {
    namespace: 'acme',
    kind: 'constraint',
    scope: { task: 'sql.generate', domain: 'shop' },
    statement,
    evidence: { feedbackId: `fb_${id}_1`, runId: `run_${id}`, at, weight: 0.9 },
    trust: 0.9,
    dedupeKey: id,
  };
}

/** An item with `n` independent corrections behind it. */
function item(id: string, statement: string, observations: number): KnowledgeItem {
  let stored = createKnowledgeItem(candidate(id, statement), defaultPolicy, at, id);
  for (let index = 2; index <= observations; index += 1) {
    stored = mergeEvidence(
      stored,
      {
        ...candidate(id, statement),
        evidence: { feedbackId: `fb_${id}_${index}`, runId: `run_${id}`, at: at + index, weight: 0.9 },
      },
      defaultPolicy,
      at + index,
    );
  }
  return stored;
}

async function store(): Promise<EmbeddedMemory> {
  const memory = await EmbeddedMemory.open(new MemoryJournal());
  await memory.putKnowledge(item('once', 'Total revenue by region is reported in thousands of euros', 1));
  await memory.putKnowledge(item('twice', 'Revenue by region excludes cancelled orders', 2));
  await memory.putKnowledge(item('thrice', 'Regional revenue is reported net of tax', 3));
  return memory;
}

const query = {
  task: 'sql.generate',
  text: 'revenue by region',
  namespace: 'acme',
  scope: { domain: 'shop' },
};

describe('the corroboration floor', () => {
  it('injects single-observation rules when no floor is set', async () => {
    const memory = await store();
    const pack = await buildPack(query, { memory });
    expect(pack.ids.sort()).toEqual(['once', 'thrice', 'twice']);
    await memory.close();
  });

  it('keeps only rules observed at least as often as the floor', async () => {
    const memory = await store();
    const twice = await buildPack(query, { memory, minEvidence: 2 });
    expect(twice.ids.sort()).toEqual(['thrice', 'twice']);
    const thrice = await buildPack(query, { memory, minEvidence: 3 });
    expect(thrice.ids).toEqual(['thrice']);
    await memory.close();
  });

  it('reads the floor from the query as well as the options', async () => {
    // A caller that already builds one query object should not have to thread the
    // same number through two places; the option wins when both are set.
    const memory = await store();
    const fromQuery = await buildPack({ ...query, minEvidence: 2 }, { memory });
    expect(fromQuery.ids.sort()).toEqual(['thrice', 'twice']);
    const overridden = await buildPack({ ...query, minEvidence: 3 }, { memory, minEvidence: 2 });
    expect(overridden.ids.sort()).toEqual(['thrice', 'twice']);
    await memory.close();
  });

  it('returns an empty pack rather than an uncorroborated one', async () => {
    // The BIRD case: everything was learned once. An empty pack is the honest answer,
    // and it is what makes the mechanism cost nothing there instead of costing 3pp.
    const memory = await EmbeddedMemory.open(new MemoryJournal());
    await memory.putKnowledge(item('once', 'Revenue by region is reported in thousands', 1));
    const pack = await buildPack(query, { memory, minEvidence: 2 });
    expect(pack.ids).toEqual([]);
    expect(pack.rendered).toBe('');
    await memory.close();
  });

  it('treats a nonsense floor as the shipped behaviour', async () => {
    // 0, -5 and 1.7 cannot mean "require fewer than one observation"; the floor is
    // clamped rather than trusted, because a negative threshold would otherwise have
    // to be interpreted by whoever reads the call site next.
    const memory = await store();
    for (const minEvidence of [0, -5, 1.7]) {
      const pack = await buildPack(query, { memory, minEvidence });
      expect(pack.ids).toHaveLength(3);
    }
    await memory.close();
  });

  it('lets a corroborated rule take the slot an uncorroborated one would have', async () => {
    // The filter runs before selection, not after: with room for one rule the pack
    // must be the corroborated one, whatever order the store returned them in.
    const memory = await store();
    const pack = await buildPack(query, { memory, minEvidence: 2, limit: 1 });
    expect(pack.ids).toHaveLength(1);
    expect(['thrice', 'twice']).toContain(pack.ids[0]);
    await memory.close();
  });
});
