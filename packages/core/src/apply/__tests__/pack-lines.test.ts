/**
 * The pack's default `limit`, as behaviour rather than as a constant.
 *
 * R236 found the block's line budget written down four times — `buildPack`'s literal, the Python parser's
 * `MAX_ITEMS`, the instrument's `CAP`, and the R232 registration's arithmetic — and a constant in four places is a
 * constant that is eventually changed in three. `serving.test.ts` binds the manifest to the shipped value; this file
 * binds the value to what a caller who asked for nothing actually gets, which is the only assertion a literal can
 * fail while every other test stays green.
 *
 * The fixture is deliberately more items than the window and more budget than they need, so the *only* thing that
 * can bound the pack is the limit.
 */
import { describe, expect, it } from 'vitest';

import { createKnowledgeItem, defaultPolicy } from '../../kernel/index.js';
import type { DistillCandidate, KnowledgeItem } from '../../kernel/index.js';
import { EmbeddedMemory, MemoryJournal } from '../../memory/index.js';
import { SERVING_DEFAULTS } from '../../memory/serving.js';
import { buildPack } from '../pack.js';

const AT = 1_700_000_000_000;

function item(index: number): KnowledgeItem {
  const candidate: DistillCandidate = {
    namespace: 'acme',
    kind: 'constraint',
    scope: { task: 'retail.return', domain: 'retail' },
    statement: `Rule number ${index} about returning a delivered item.`,
    evidence: { feedbackId: `fb_${index}`, runId: `run_${index}`, at: AT, weight: 0.9 },
    trust: 0.9,
    dedupeKey: `k_${index}`,
  };
  return { ...createKnowledgeItem(candidate, defaultPolicy, AT, `id_${index}`), status: 'active' };
}

const QUERY = {
  task: 'retail.return',
  text: 'return the delivered item and refund the customer',
  namespace: 'acme',
} as const;

async function store(): Promise<EmbeddedMemory> {
  const memory = await EmbeddedMemory.open(new MemoryJournal());
  for (let index = 0; index < 12; index += 1) await memory.putKnowledge(item(index));
  return memory;
}

describe('the pack spends the manifest’s line budget', () => {
  it('carries no more items than the block has lines, when the caller names no limit', async () => {
    const pack = await buildPack(QUERY, { memory: await store(), budget: 100_000 });
    expect(pack.items.length).toBe(SERVING_DEFAULTS.blockLines);
  });

  it('carries more than that when the caller asks for more, so the default is what bound it', async () => {
    const pack = await buildPack(QUERY, { memory: await store(), budget: 100_000, limit: 12 });
    expect(pack.items.length).toBeGreaterThan(SERVING_DEFAULTS.blockLines);
  });

  it('still lets a query’s own limit win over the default', async () => {
    const pack = await buildPack({ ...QUERY, limit: 3 }, { memory: await store(), budget: 100_000 });
    expect(pack.items.length).toBe(3);
  });
});
