/**
 * The decision to speak, and the census that makes the decision readable.
 *
 * Every arm before this one served the pack on every request: `served 162 of 162` was the record's
 * delivery rate because at floor 0 nothing *could* be refused, so no reader could ask whether the
 * memory should have spoken. The gate below is the askable version, and these tests pin the two
 * properties a gate must have to be worth a dispatch:
 *
 *   1. it reports the population it withheld as well as the one it served, and the reason is a
 *      named state rather than a zero; and
 *   2. it does not move the pack when the host only asked to look. The census is an observer, so the
 *      arm that measures and the arm that does not must render identical bytes.
 */
import { describe, expect, it } from 'vitest';
import { createKnowledgeItem, defaultPolicy } from '../../kernel/index.js';
import type { DistillCandidate, KnowledgeItem } from '../../kernel/index.js';
import { EmbeddedMemory, MemoryJournal } from '../../memory/index.js';
import { buildPack } from '../pack.js';
import { suppressionOf } from '../speak.js';

const AT = 1_700_000_000_000;

function item(
  id: string,
  statement: string,
  overrides: Partial<DistillCandidate> = {},
): KnowledgeItem {
  const candidate: DistillCandidate = {
    namespace: 'acme',
    kind: 'constraint',
    scope: { task: 'retail.return', domain: 'retail' },
    statement,
    evidence: { feedbackId: `fb_${id}`, runId: `run_${id}`, at: AT, weight: 0.9 },
    trust: 0.9,
    dedupeKey: `k_${id}`,
    ...overrides,
  };
  // Forced active: this file is about the decision to speak, not about admission.
  return { ...createKnowledgeItem(candidate, defaultPolicy, AT, id), status: 'active' };
}

async function storeOf(items: readonly KnowledgeItem[]): Promise<EmbeddedMemory> {
  const store = await EmbeddedMemory.open(new MemoryJournal());
  for (const entry of items) await store.putKnowledge(entry);
  return store;
}

// Statements whose relevance the probe measured against `QUERY`: `strong` 0.8255, `weak` 0.3089,
// `tieA` = `tieB` 0.8858 (permutations over one vocabulary, so the margin is exactly zero), `third`
// 0.4894. Fixed strings rather than a fabricated score, because the gate reads the real ranking.
const STRONG = 'A return action carries the item ids being returned for the order.';
const WEAK = 'The order id is required.';
const TIE_A = 'A return action carries the item ids of the order.';
const TIE_B = 'A return action carries the order ids of the item.';
const THIRD = 'Refunds of the order require the item ids being returned.';

const QUERY = {
  task: 'retail.return',
  text: 'return the item on this order and refund the customer',
  namespace: 'acme',
};

describe('the pack says what it saw', () => {
  it('records the population, the ranking and the margin when it speaks', async () => {
    const store = await storeOf([item('k_1', STRONG), item('k_2', WEAK)]);
    const pack = await buildPack(QUERY, { memory: store, decision: true });
    const census = pack.decision;
    expect(census).toBeDefined();
    expect(census?.spoke).toBe(true);
    expect(census?.silentBecause).toBeNull();
    expect(census?.candidates).toBe(2);
    expect(census?.afterCoverage).toBe(2);
    expect(census?.afterEvidence).toBe(2);
    // The margin is a difference of two numbers the artefact carries, so a readback recomputes it.
    expect(census?.topScore).not.toBeNull();
    expect(census?.runnerUpScore).not.toBeNull();
    expect(census?.margin).toBeCloseTo(
      (census?.topScore ?? 0) - (census?.runnerUpScore ?? 0),
      12,
    );
    expect(census?.margin ?? -1).toBeGreaterThanOrEqual(0);
  });

  it('names the silence when the store returned nothing', async () => {
    const store = await storeOf([item('k_1', STRONG)]);
    const pack = await buildPack(
      { task: 'retail.invoice', text: 'reconcile the ledger for the fiscal quarter', namespace: 'acme' },
      { memory: store, decision: true },
    );
    expect(pack.decision?.spoke).toBe(false);
    expect(pack.decision?.silentBecause).toBe('nothing-matched');
    expect(pack.decision?.candidates).toBe(0);
    expect(pack.decision?.topScore).toBeNull();
    expect(pack.ids).toEqual([]);
  });

  it('counts what the coverage floor removed instead of reporting an empty store', async () => {
    const store = await storeOf([item('k_1', STRONG), item('k_2', WEAK)]);
    const pack = await buildPack(QUERY, { memory: store, minCoverage: 0.99, decision: true });
    expect(pack.decision?.silentBecause).toBe('nothing-covered');
    expect(pack.decision?.candidates).toBe(2);
    expect(pack.decision?.belowCoverage).toBe(2);
    expect(pack.decision?.afterCoverage).toBe(0);
    // The distinction matters: a store that was searched and refused is not a store that was empty.
    expect(pack.decision?.candidates).not.toBe(0);
  });

  it('counts what the corroboration floor removed', async () => {
    const store = await storeOf([item('k_1', STRONG), item('k_2', WEAK)]);
    const pack = await buildPack(QUERY, { memory: store, minEvidence: 2, decision: true });
    expect(pack.decision?.silentBecause).toBe('nothing-corroborated');
    expect(pack.decision?.afterCoverage).toBe(2);
    expect(pack.decision?.belowEvidence).toBe(2);
    expect(pack.decision?.afterEvidence).toBe(0);
  });

  it('reports no leader when the top of the ranking is a tie', async () => {
    const store = await storeOf([item('k_1', TIE_A), item('k_2', TIE_B)]);
    const pack = await buildPack(QUERY, { memory: store, speakMargin: 1e9, decision: true });
    expect(pack.decision?.margin).toBe(0);
    expect(pack.decision?.spoke).toBe(false);
    expect(pack.decision?.silentBecause).toBe('no-leader');
    // The pack is empty *and* says so: `suppressed` is the field a host reads, and the reason on it is
    // the difference between a deliberate silence and a retrieval that failed.
    expect(pack.ids).toEqual([]);
    expect(pack.rendered).toBe('');
    expect(pack.suppressed).toBe('no-leader');
    expect(pack.decision?.topScore).not.toBeNull();
  });

  it('speaks when one candidate has no rival, because nothing contests it', async () => {
    const store = await storeOf([item('k_1', STRONG)]);
    const pack = await buildPack(QUERY, { memory: store, speakMargin: 1e9, decision: true });
    expect(pack.decision?.spoke).toBe(true);
    expect(pack.decision?.runnerUpScore).toBeNull();
    expect(pack.decision?.margin).toBeNull();
    expect(pack.ids).toEqual(['k_1']);
  });

  it('counts the survivors the limit did not carry', async () => {
    const store = await storeOf([
      item('k_1', STRONG),
      item('k_2', WEAK),
      item('k_3', TIE_A),
      item('k_4', TIE_B),
      item('k_5', THIRD),
    ]);
    const pack = await buildPack({ ...QUERY, limit: 1 }, { memory: store, decision: true });
    expect(pack.decision?.afterEvidence).toBe(5);
    expect(pack.decision?.overLimit).toBe(4);
    expect(pack.ids).toHaveLength(1);
  });
});

describe('a silence says which gate emptied it', () => {
  it('names the host when the host asked for no room', async () => {
    const store = await storeOf([item('k_1', STRONG), item('k_2', WEAK)]);
    const pack = await buildPack(QUERY, { memory: store, limit: 0, decision: true });
    expect(pack.decision?.silentBecause).toBe('nothing-selected');
    // The host got what it asked for, so this is not a suppression the store is responsible for.
    expect(pack.suppressed).toBeUndefined();
    expect(pack.ids).toEqual([]);
  });

  it('carries a suppression only when the memory decided to withhold', async () => {
    expect(suppressionOf('nothing-corroborated')).toBe('uncorroborated-store');
    expect(suppressionOf('no-leader')).toBe('no-leader');
    expect(suppressionOf('nothing-matched')).toBeUndefined();
    expect(suppressionOf('nothing-covered')).toBeUndefined();
    expect(suppressionOf('nothing-selected')).toBeUndefined();
    expect(suppressionOf(null)).toBeUndefined();
  });

  it('marks an uncorroborated store on the pack a host reads', async () => {
    const store = await storeOf([item('k_1', STRONG), item('k_2', WEAK)]);
    const pack = await buildPack(QUERY, { memory: store, minEvidence: 2, decision: true });
    expect(pack.suppressed).toBe('uncorroborated-store');
    expect(pack.rendered).toBe('');
  });
});

describe('the census is an observer', () => {
  it('writes nothing into a pack whose host did not ask for it', async () => {
    const store = await storeOf([item('k_1', STRONG), item('k_2', WEAK)]);
    const quiet = await buildPack(QUERY, { memory: store });
    expect(quiet.decision).toBeUndefined();
    expect(quiet.suppressed).toBeUndefined();
  });

  it('renders the same bytes with the census on and off', async () => {
    const store = await storeOf([item('k_1', STRONG), item('k_2', WEAK)]);
    const withCensus = await buildPack(QUERY, { memory: store, decision: true });
    const without = await buildPack(QUERY, { memory: store });
    expect(withCensus.rendered).toBe(without.rendered);
    expect(withCensus.ids).toEqual(without.ids);
    expect(withCensus.hash).toBe(without.hash);
  });

  it('leaves a margin of zero at the default, so every served pack still speaks', async () => {
    // The default is the world every committed artefact measured: floor 0, no leader requirement.
    const store = await storeOf([item('k_1', TIE_A), item('k_2', TIE_B)]);
    const pack = await buildPack(QUERY, { memory: store, decision: true });
    expect(pack.decision?.spoke).toBe(true);
    expect(pack.ids.length).toBe(2);
  });
});
