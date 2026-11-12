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
  sameTrial: 'Check the shipping country before quoting a delivery date.',
  laterTrial: 'Read the return policy before agreeing to a size swap.',
};

/** One store holding an offline claim, one from trial 0, one from trial 2 and one from trial 3. */
async function fourTrialStore(): Promise<MemoryPort> {
  return seeded([
    item('k_offline', statements.offline, {}),
    item('k_early', statements.early, { trial: 0 }),
    item('k_same', statements.sameTrial, { trial: 2 }),
    item('k_later', statements.laterTrial, { trial: 3 }),
  ]);
}

function ids(hits: readonly { item: KnowledgeItem }[]): string[] {
  return hits.map((hit) => hit.item.id).sort();
}

describe('recall under an in-episode watermark', () => {
  it('serves every trial when no watermark is asked for', async () => {
    const memory = await fourTrialStore();
    const hits = await memory.search({ task: 'retail.1', text: statements.offline, namespace: 'acme' });
    expect(ids(hits)).toEqual(['k_early', 'k_later', 'k_offline', 'k_same']);
  });

  it('serves the offline claim and the strictly earlier trials to trial 2', async () => {
    // The reading the arm publishes: trial 2 reads trial 0's lesson and the pre-existing store, and
    // reads neither its own nor a later attempt's.
    const memory = await fourTrialStore();
    const hits = await memory.search({
      task: 'retail.1',
      text: statements.offline,
      namespace: 'acme',
      before: 2,
    });
    expect(ids(hits)).toEqual(['k_early', 'k_offline']);
  });

  it('serves only the offline claim to the first trial', async () => {
    const memory = await fourTrialStore();
    const hits = await memory.search({
      task: 'retail.1',
      text: statements.offline,
      namespace: 'acme',
      before: 0,
    });
    expect(ids(hits)).toEqual(['k_offline']);
  });

  it('withholds the watermark filter from the scope index as well as the lexical candidates', async () => {
    // `search` builds its candidates twice -- from the inverted index and, when a scope is supplied,
    // from every active item that matches it. A watermark applied to one path and not the other
    // would leak exactly the rule that carries no word of the question, which is the rule the scope
    // index exists to keep reachable.
    const memory = await fourTrialStore();
    const hits = await memory.search({
      task: 'retail.1',
      text: 'no shared word here at all',
      namespace: 'acme',
      scope: { domain: 'retail' },
      before: 2,
    });
    expect(ids(hits)).toEqual(['k_early', 'k_offline']);
  });

  it('is a watermark on trials, not on time: a later write with an earlier trial is served', async () => {
    // The filter reads the evidence's own index, so it answers "what did this claim learn from"
    // rather than "when did it land". A store whose clock is older than its trials is not a defect
    // in the arm, and a filter on `at` would have called it one.
    const memory = await seeded([
      item('k_fresh_trial', statements.early, { trial: 0, at: now - 1_000 }),
      item('k_stale_clock', statements.sameTrial, { trial: 2, at: now + 1_000 }),
    ]);
    const hits = await memory.search({ task: 'retail.1', text: statements.early, namespace: 'acme', before: 2 });
    expect(ids(hits)).toEqual(['k_fresh_trial']);
  });
});
