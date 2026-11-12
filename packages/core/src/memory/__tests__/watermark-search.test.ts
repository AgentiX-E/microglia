import { describe, expect, it } from 'vitest';
import {
  createKnowledgeItem,
  defaultPolicy,
  type DistillCandidate,
  type KnowledgeItem,
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

function item(
  id: string,
  statement: string,
  evidence: Partial<DistillCandidate['evidence']>,
): KnowledgeItem {
  return createKnowledgeItem(
    candidate({
      statement,
      dedupeKey: id,
      evidence: { feedbackId: `fb_${id}`, runId: `run_${id}`, at: now, weight: 0.9, ...evidence },
    }),
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

const statements = {
  offline: 'Ask for the order id before quoting the exchange window.',
  early: 'Confirm the payment method before promising a refund.',
  sameAttempt: 'Check the shipping country before quoting a delivery date.',
  laterAttempt: 'Read the return policy before agreeing to a size swap.',
};

/** One store holding an offline claim and one claim learned by each of attempts 1, 2 and 3. */
async function fourAttemptStore(): Promise<MemoryPort> {
  return seeded([
    item('k_offline', statements.offline, {}),
    item('k_first', statements.early, { attempt: 1 }),
    item('k_second', statements.sameAttempt, { attempt: 2 }),
    item('k_third', statements.laterAttempt, { attempt: 3 }),
  ]);
}

function ids(hits: readonly { item: KnowledgeItem }[]): string[] {
  return hits.map((hit) => hit.item.id).sort();
}

describe('recall under an attempt watermark', () => {
  it('serves every attempt when no watermark is asked for', async () => {
    const memory = await fourAttemptStore();
    const hits = await memory.search({ task: 'retail.1', text: statements.offline, namespace: 'acme' });
    expect(ids(hits)).toEqual(['k_first', 'k_offline', 'k_second', 'k_third']);
  });

  it('serves the offline claim and the strictly earlier attempt to attempt 2', async () => {
    // The reading the arm publishes: attempt 2 reads attempt 1's lesson and the pre-existing store,
    // and reads neither its own nor a later attempt's.
    const memory = await fourAttemptStore();
    const hits = await memory.search({
      task: 'retail.1',
      text: statements.offline,
      namespace: 'acme',
      before: 2,
    });
    expect(ids(hits)).toEqual(['k_first', 'k_offline']);
  });

  it('serves only the offline claim to the first attempt', async () => {
    const memory = await fourAttemptStore();
    const hits = await memory.search({
      task: 'retail.1',
      text: statements.offline,
      namespace: 'acme',
      before: 1,
    });
    expect(ids(hits)).toEqual(['k_offline']);
  });

  it('withholds the watermark filter from the scope index as well as the lexical candidates', async () => {
    // `search` builds its candidates twice -- from the inverted index and, when a scope is supplied,
    // from every active item that matches it. A watermark applied to one path and not the other
    // would leak exactly the rule that carries no word of the question, which is the rule the scope
    // index exists to keep reachable.
    const memory = await fourAttemptStore();
    const hits = await memory.search({
      task: 'retail.1',
      text: 'no shared word here at all',
      namespace: 'acme',
      scope: { domain: 'retail' },
      before: 2,
    });
    expect(ids(hits)).toEqual(['k_first', 'k_offline']);
  });

  it('is a watermark on attempts, not on time: a later write with an earlier attempt is served', async () => {
    // The filter reads the evidence's own number, so it answers "what did this claim learn from"
    // rather than "when did it land". A store whose clock is older than its attempts is not a defect
    // in the arm, and a filter on `at` would have called it one.
    const memory = await seeded([
      item('k_fresh', statements.early, { attempt: 1, at: now - 1_000 }),
      item('k_stale_clock', statements.sameAttempt, { attempt: 2, at: now + 1_000 }),
    ]);
    const hits = await memory.search({
      task: 'retail.1',
      text: statements.early,
      namespace: 'acme',
      before: 2,
    });
    expect(ids(hits)).toEqual(['k_fresh']);
  });

  it('keeps a merged claim out of the attempt that merged it', async () => {
    // Consolidation ran and folded attempt 1's and attempt 3's claim into one item. The pack serves
    // the item, so attempt 3 cannot read it either -- and attempt 4 can.
    const memory = await seeded([
      {
        ...item('k_merged', statements.early, { attempt: 1 }),
        evidence: [
          { feedbackId: 'fb_a', runId: 'run_a', at: now, weight: 0.6, attempt: 1 },
          { feedbackId: 'fb_b', runId: 'run_b', at: now, weight: 0.6, attempt: 3 },
        ],
      },
    ]);
    const at3 = await memory.search({
      task: 'retail.1',
      text: statements.early,
      namespace: 'acme',
      before: 3,
    });
    expect(ids(at3)).toEqual([]);
    const at4 = await memory.search({
      task: 'retail.1',
      text: statements.early,
      namespace: 'acme',
      before: 4,
    });
    expect(ids(at4)).toEqual(['k_merged']);
  });
});
