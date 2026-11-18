/**
 * The pack a request builds when part of the store is withheld.
 *
 * `buildPack` does not know what an exclusion is: it hands the query to the store, and the store skips the
 * ids it names. This file is the contract at the layer that spends the result — the pack keeps its size, its
 * rendered block is the substitute rule rather than the withheld one, and a phase in which everything is
 * withheld answers with an empty pack instead of a one-rule-shorter one.
 */
import { describe, expect, it } from 'vitest';
import {
  createKnowledgeItem,
  defaultPolicy,
  type DistillCandidate,
  type KnowledgeItem,
} from '../../kernel/index.js';
import { EmbeddedMemory, MemoryJournal } from '../../memory/index.js';
import { buildPack } from '../pack.js';

const at = 1_700_000_000_000;

function item(statement: string, id: string): KnowledgeItem {
  const candidate: DistillCandidate = {
    namespace: 'acme',
    kind: 'constraint',
    scope: { task: 'tau2.act', domain: 'retail' },
    statement,
    evidence: { feedbackId: `fb_${id}`, runId: 'run_1', at, weight: 0.9 },
    trust: 0.9,
    dedupeKey: id,
  };
  return createKnowledgeItem(candidate, defaultPolicy, at, id);
}

async function store(): Promise<EmbeddedMemory> {
  const memory = await EmbeddedMemory.open(new MemoryJournal());
  await memory.putKnowledge(item('Confirm the payment method before promising a refund on an order.', 'leader'));
  await memory.putKnowledge(item('Read the return policy before agreeing to swap a delivered order item.', 'runner'));
  await memory.putKnowledge(item('Check the shipping country before quoting a delivery date for an order.', 'tail'));
  return memory;
}

const QUERY = {
  namespace: 'acme',
  task: 'tau2.act',
  text: 'refund an order because the payment method changed',
  scope: { domain: 'retail' },
  limit: 2,
};

describe('a pack built under an exclusion', () => {
  it('serves the same number of items, with the next candidate in the withheld one place', async () => {
    // The whole point of R152: identical dose, different allocation. A pack that came back one item shorter
    // would be a different arm — fewer rules in the prompt — and the rotation's contrast would be unreadable.
    const memory = await store();
    const full = await buildPack(QUERY, { memory });
    const leader = full.ids[0] as string;
    const narrowed = await buildPack({ ...QUERY, exclude: [leader] }, { memory });
    expect(narrowed.ids).toHaveLength(full.ids.length);
    expect(narrowed.ids).not.toContain(leader);
    // A set rather than a sequence: MMR reorders what it keeps, so the claim is *which* two rules the pack
    // carried, and the count above is what makes it a substitution rather than a loss.
    expect([...narrowed.ids].sort()).toEqual(['runner', 'tail']);
    await memory.close();
  });

  it('renders the substitute rule, so the model reads a block and not a hole', async () => {
    const memory = await store();
    const full = await buildPack(QUERY, { memory });
    const leader = full.ids[0] as string;
    const narrowed = await buildPack({ ...QUERY, exclude: [leader] }, { memory });
    expect(narrowed.rendered).not.toBe('');
    expect(narrowed.rendered).not.toContain(full.items[0]?.statement ?? '<none>');
    await memory.close();
  });

  it('answers with an empty pack when every candidate is withheld, and says why', async () => {
    // An arm whose rotation has spent the store must read as a store that served nothing — the same state as
    // a store with no match — because the alternative is a pack of the wrong size being called a treatment.
    const memory = await store();
    const pack = await buildPack({ ...QUERY, exclude: ['leader', 'runner', 'tail'] }, { memory });
    expect(pack.ids).toEqual([]);
    expect(pack.rendered).toBe('');
    await memory.close();
  });

  it('changes nothing when the exclusion names ids the store does not hold', async () => {
    const memory = await store();
    const full = await buildPack(QUERY, { memory });
    const narrowed = await buildPack({ ...QUERY, exclude: ['k_never_stored'] }, { memory });
    expect(narrowed.ids).toEqual(full.ids);
    expect(narrowed.rendered).toBe(full.rendered);
    await memory.close();
  });
});
