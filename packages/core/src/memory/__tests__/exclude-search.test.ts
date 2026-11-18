/**
 * The ids a request forbids, skipped where the candidates are.
 *
 * R152's serving policy bounds how far one item may travel, and it can only do that if the *next*
 * candidate takes the slot a withheld one would have used. So the tests here are about a property of
 * `search` rather than about a filter at the pack: the excluded item does not appear, the item behind it
 * does, and the pack's own size is unchanged — which is the difference between "another rule" and "one
 * rule fewer".
 */
import { describe, expect, it } from 'vitest';
import {
  createKnowledgeItem,
  defaultPolicy,
  type DistillCandidate,
  type KnowledgeItem,
  type RecallQuery,
} from '../../kernel/index.js';
import { EmbeddedMemory, MemoryJournal, type MemoryPort } from '../index.js';

const now = 1_700_000_000_000;

function candidate(overrides: Partial<DistillCandidate> = {}): DistillCandidate {
  return {
    namespace: 'acme',
    kind: 'constraint',
    scope: { task: 'retail.1', domain: 'retail' },
    statement: 'Ask for the order id before quoting the exchange window.',
    evidence: { feedbackId: 'fb_1', runId: 'run_1', at: now, weight: 0.9 },
    trust: 0.9,
    dedupeKey: 'k1',
    ...overrides,
  };
}

function item(id: string, statement: string): KnowledgeItem {
  return createKnowledgeItem(
    candidate({ statement, dedupeKey: id, evidence: { feedbackId: `fb_${id}`, runId: `run_${id}`, at: now, weight: 0.9 } }),
    defaultPolicy,
    now,
    id,
  );
}

async function seeded(items: readonly KnowledgeItem[]): Promise<MemoryPort> {
  const memory = await EmbeddedMemory.open(new MemoryJournal());
  for (const entry of items) await memory.putKnowledge(entry);
  return memory;
}

const STATEMENTS = {
  strongest: 'Confirm the payment method before promising a refund on an order.',
  middle: 'Read the return policy before agreeing to swap a delivered order item.',
  weakest: 'Check the shipping country before quoting a delivery date for an order.',
};

/** Three items about one question, written so their relevance order is fixed. */
async function threeItemStore(): Promise<MemoryPort> {
  return seeded([
    item('k_strong', STATEMENTS.strongest),
    item('k_middle', STATEMENTS.middle),
    item('k_weak', STATEMENTS.weakest),
  ]);
}

const QUERY: RecallQuery = {
  namespace: 'acme',
  task: 'retail.1',
  text: 'refund an order because the payment method changed',
  scope: { domain: 'retail' },
  limit: 3,
};

describe('recall under an exclusion list', () => {
  it('serves the same ranked order when nothing is excluded', async () => {
    // The order is read from the store rather than assumed here: BM25 over three statements is a fact about
    // the tokeniser, and a test that hard-codes it would fail the first time a stop word moved.
    const memory = await threeItemStore();
    const hits = await memory.search(QUERY);
    expect(hits).toHaveLength(3);
    expect(new Set(hits.map((hit) => hit.item.id))).toEqual(new Set(['k_strong', 'k_middle', 'k_weak']));
  });

  it('drops the excluded item and offers the one behind it, rather than serving one rule fewer', async () => {
    // The assertion that makes the policy a policy: with `limit` 2 the pack still carries two items, and the
    // second one is the item that would have been third. A filter applied to the finished pack would return
    // one item here, which is a dose change wearing the name of an allocation change.
    const memory = await threeItemStore();
    const full = await memory.search(QUERY);
    const top = full[0]?.item.id as string;
    const hits = await memory.search({ ...QUERY, limit: 2, exclude: [top] });
    expect(hits.map((hit) => hit.item.id)).toEqual(
      full.filter((hit) => hit.item.id !== top).map((hit) => hit.item.id).slice(0, 2),
    );
  });

  it('serves nothing when every candidate is excluded', async () => {
    const memory = await threeItemStore();
    expect(await memory.search({ ...QUERY, exclude: ['k_strong', 'k_middle', 'k_weak'] })).toEqual([]);
  });

  it('reads an empty list as no exclusion, so a caller can pass one without a branch', async () => {
    const memory = await threeItemStore();
    const hits = await memory.search({ ...QUERY, exclude: [] });
    expect(hits.map((hit) => hit.item.id)).toEqual((await memory.search(QUERY)).map((hit) => hit.item.id));
  });

  it('excludes an id the store does not hold without refusing the request', async () => {
    // A caller's list is state, and the item behind an id can be retired between building the list and
    // sending it. A store that crashed on that would make the policy unusable against a live store.
    const memory = await threeItemStore();
    const hits = await memory.search({ ...QUERY, exclude: ['k_absent'] });
    expect(hits.map((hit) => hit.item.id)).toEqual((await memory.search(QUERY)).map((hit) => hit.item.id));
  });

  it('normalises relevance over the items it may serve, not over the ones it withheld', async () => {
    // The maximum BM25 in a pack is the divisor every score is read against. Taken over an excluded item it
    // would deflate every remaining score, and a margin gate downstream would then read a contest that the
    // exclusion created rather than one the store has. Excluding the leader makes the runner-up the most
    // lexical candidate of the pack it now leads, so its own score must rise.
    const memory = await threeItemStore();
    const full = await memory.search(QUERY);
    const top = full[0]?.item.id as string;
    const narrowed = await memory.search({ ...QUERY, exclude: [top] });
    const leader = narrowed[0];
    const wasSecond = full[1];
    expect(leader?.item.id).toBe(wasSecond?.item.id);
    expect(leader?.score ?? 0).toBeGreaterThan(wasSecond?.score ?? 1);
    // And the order the pack still holds is not merely sorted by confidence: the score falls off.
    expect(narrowed[0]?.score ?? 0).toBeGreaterThanOrEqual(narrowed[1]?.score ?? 0);
  });

  it('excludes through the lexical anchoring path too, which builds its candidates elsewhere', async () => {
    // Two paths reach the candidate set -- the index and the scope sweep -- and only one of them was written
    // first. An exclusion honoured on one path is a policy that stops working the moment an arm declares
    // `anchoring: lexical`, which is exactly the arm R152's predecessor registered.
    const memory = await threeItemStore();
    const lexical = await memory.search({ ...QUERY, anchoring: 'lexical', exclude: ['k_strong'] });
    expect(lexical.map((hit) => hit.item.id)).not.toContain('k_strong');
    expect(lexical.length).toBeGreaterThan(0);
  });
});
