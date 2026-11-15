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
  options: { readonly speakMargin?: number } = {},
) {
  const store = await EmbeddedMemory.open(new MemoryJournal());
  for (const entry of items) await store.putKnowledge(entry);
  return openMicroglia({
    app: 'acme',
    namespace: 'acme',
    store,
    ...(options.speakMargin === undefined ? {} : { speakMargin: options.speakMargin }),
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
