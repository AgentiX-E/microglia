/**
 * The gate as a host reaches it.
 *
 * `apply/speak.ts` is tested as a reduction over a population; this file pins the two things only the
 * host layer can get wrong — that a declared margin reaches `buildPack` at all, and that a host which
 * declares none keeps serving the pack every committed artefact measured. The second half is the R124
 * failure in its general form: a knob that is read, validated and then dropped on the way to the thing
 * that would use it.
 */
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

/** Two statements that tie on relevance: permutations over one vocabulary. */
const TIE_A = 'A return action carries the item ids of the order.';
const TIE_B = 'A return action carries the order ids of the item.';
const STRONG = 'A return action carries the item ids being returned for the order.';
/** Barely on topic: relevance 0.3089 against `STRONG`'s 0.8255, so the pair has a clear leader. */
const WEAK = 'The order id is required.';

function item(id: string, statement: string): KnowledgeItem {
  const candidate: DistillCandidate = {
    namespace: 'acme',
    kind: 'constraint',
    scope: { task: 'retail.return', domain: 'retail' },
    statement,
    evidence: { feedbackId: `fb_${id}`, runId: `run_${id}`, at: AT, weight: 0.9 },
    trust: 0.9,
    dedupeKey: `k_${id}`,
  };
  return { ...createKnowledgeItem(candidate, defaultPolicy, AT, id), status: 'active' };
}

async function hostOf(
  items: readonly KnowledgeItem[],
  options: { readonly speakMargin?: number; readonly speakCensus?: boolean } = {},
) {
  const store = await EmbeddedMemory.open(new MemoryJournal());
  for (const entry of items) await store.putKnowledge(entry);
  return openMicroglia({
    app: 'acme',
    namespace: 'acme',
    store,
    ...(options.speakMargin === undefined ? {} : { speakMargin: options.speakMargin }),
    ...(options.speakCensus === undefined ? {} : { speakCensus: options.speakCensus }),
  });
}

const QUERY = { task: 'retail.return', text: 'return the item on this order and refund the customer' };

describe('a host that names a margin', () => {
  it('withholds a contested store and says which gate withheld it', async () => {
    const mg = await hostOf([item('k_1', TIE_A), item('k_2', TIE_B)], { speakMargin: 1e9 });
    const pack = await mg.recall(QUERY);
    expect(pack.suppressed).toBe('no-leader');
    expect(pack.decision?.silentBecause).toBe('no-leader');
    expect(pack.decision?.margin).toBe(0);
    expect(pack.ids).toEqual([]);
    expect(pack.rendered).toBe('');
  });

  it('serves an uncontested store, and records that it did', async () => {
    const mg = await hostOf([item('k_1', STRONG), item('k_2', WEAK)], { speakMargin: 0.4 });
    const pack = await mg.recall(QUERY);
    expect(pack.decision?.spoke).toBe(true);
    expect(pack.decision?.silentBecause).toBeNull();
    expect(pack.suppressed).toBeUndefined();
    expect(pack.ids.length).toBeGreaterThan(0);
  });
});

describe('a host that names none', () => {
  it('serves the contested store and carries no census', async () => {
    const mg = await hostOf([item('k_1', TIE_A), item('k_2', TIE_B)]);
    const pack = await mg.recall(QUERY);
    expect(pack.decision).toBeUndefined();
    expect(pack.suppressed).toBeUndefined();
    expect(pack.ids).toEqual(['k_1', 'k_2']);
  });
});

describe('a host that asks for the census without the gate', () => {
  it('records the margin on a pack it served anyway', async () => {
    // R123a. The margin between a store's top two candidates is a property of the store, so a rung that
    // withholds a third of one store's traffic can withhold all of another's. Recording the distribution
    // costs nothing and is what makes the rung choosable rather than guessed.
    const mg = await hostOf([item('k_1', STRONG), item('k_2', WEAK)], { speakCensus: true });
    const pack = await mg.recall(QUERY);
    expect(pack.decision?.spoke).toBe(true);
    expect(pack.decision?.margin).toBeGreaterThan(0);
    expect(pack.decision?.topScore).toBeGreaterThan(pack.decision?.runnerUpScore ?? 0);
    // A served pack is not a suppressed one: the census observed and the memory did not withhold.
    expect(pack.suppressed).toBeUndefined();
  });

  it('records a null margin when the store left nothing to be contested', async () => {
    // One candidate has no rival. `null` and `0` are different facts and the ladder must not read the
    // first as the second, or every single-item request would enter the population a rung acts on.
    const mg = await hostOf([item('k_1', STRONG)], { speakCensus: true });
    const pack = await mg.recall(QUERY);
    expect(pack.decision?.margin).toBeNull();
    expect(pack.decision?.spoke).toBe(true);
  });

  it('moves no byte of the pack it describes', async () => {
    // The observer rule, at the layer that renders: an arm cannot be read back into a different arm.
    const quiet = await (await hostOf([item('k_1', STRONG), item('k_2', WEAK)])).recall(QUERY);
    const watched = await (await hostOf([item('k_1', STRONG), item('k_2', WEAK)], { speakCensus: true })).recall(QUERY);
    expect(watched.rendered).toBe(quiet.rendered);
    expect(watched.ids).toEqual(quiet.ids);
    expect(watched.hash).toBe(quiet.hash);
    expect(quiet.decision).toBeUndefined();
  });

  it('keeps the gate off, so a contested store is still served', async () => {
    // The difference between this arm and the treatment: the same census, and the tie is served.
    const mg = await hostOf([item('k_1', TIE_A), item('k_2', TIE_B)], { speakCensus: true });
    const pack = await mg.recall(QUERY);
    expect(pack.decision?.margin).toBe(0);
    expect(pack.decision?.spoke).toBe(true);
    expect(pack.ids).toHaveLength(2);
  });
});
