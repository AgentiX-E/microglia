import { describe, expect, it } from 'vitest';
import { createKnowledgeItem, defaultPolicy } from '@agentix-e/microglia-core';
import { openMicroglia } from '@agentix-e/microglia-core/capture';
import type { DistillCandidate, KnowledgeItem } from '@agentix-e/microglia-core';
import { EmbeddedMemory, MemoryJournal } from '@agentix-e/microglia-core/memory';
import { consolidatedMemoryOf, type MemoryShape } from '../consolidated.js';

const AT = 1_700_000_000_000;

/** The identity and dose every memory in this lane is opened with; only `budget` matters here. */
const SHAPE: MemoryShape = { app: 'microglia-sota', namespace: 'bird', budget: 1200, clockStart: AT };

/**
 * One claim, learned from one task.
 *
 * `taskId` rather than a fresh run id per item: support is counted per task, and the whole question
 * this module answers is whether two *tasks* stand behind one claim. Evidence that differed only in
 * its run id would be one task observed twice, which the pass refuses on purpose.
 */
function claim(id: string, statement: string, taskId: string): KnowledgeItem {
  const candidate: DistillCandidate = {
    namespace: 'bird',
    kind: 'constraint',
    scope: { task: 'bird.query', domain: 'sales' },
    statement,
    evidence: { feedbackId: `fb_${id}`, runId: `run_${id}`, at: AT, weight: 0.9, taskId },
    trust: 0.9,
    dedupeKey: `k_${id}`,
  };
  return createKnowledgeItem(candidate, defaultPolicy, AT, id);
}

/**
 * Two statements of one claim and one of another.
 *
 * The first two share every content term of the shorter one — containment 1.00 against the pass's
 * 0.60 floor — and the third shares none. That is the shape the pass was calibrated for: a repeat it
 * must fold, beside a claim it must not.
 */
const ONE_CLAIM =
  'When several columns must change, apply every requested change in the order stated.';
const SAME_CLAIM_AGAIN =
  'When several columns must change, apply every requested change in the order stated rather than grouping them.';
const OTHER_CLAIM = 'Revenue over time is plotted as a line chart, never as a bar chart.';

async function storeOf(items: readonly KnowledgeItem[]): Promise<EmbeddedMemory> {
  const store = await EmbeddedMemory.open(new MemoryJournal());
  for (const item of items) await store.putKnowledge(item);
  return store;
}

const QUERY = { task: 'bird.query', text: 'apply every requested change in the order stated' };

/** The three-item store every fold test starts from: a repeat, and a claim that is not one. */
function threeClaims(): Promise<EmbeddedMemory> {
  return storeOf([
    claim('k1', ONE_CLAIM, 'task-1'),
    claim('k2', SAME_CLAIM_AGAIN, 'task-2'),
    claim('k3', OTHER_CLAIM, 'task-3'),
  ]);
}

describe('a memory built from the merge', () => {
  it('folds two statements of one claim into a survivor carrying both witnesses', async () => {
    const merged = await consolidatedMemoryOf(await threeClaims(), SHAPE, 7);
    expect(merged.written).toBe(3);
    expect(merged.report).toMatchObject({
      considered: 3,
      groups: 1,
      merged: 1,
      retained: 2,
      crossTaskGroups: 1,
      maxSupportBefore: 1,
      maxSupportAfter: 2,
    });
    // The distributions are the reading: three claims with one witness each became one claim with
    // two witnesses and one with one. The same item count could have been two other stores.
    expect(merged.report.supportBefore).toEqual({ 1: 3 });
    expect(merged.report.supportAfter).toEqual({ 1: 1, 2: 1 });
  });

  it('leaves the store it read exactly as it was', async () => {
    const source = await storeOf([
      claim('k1', ONE_CLAIM, 'task-1'),
      claim('k2', SAME_CLAIM_AGAIN, 'task-2'),
    ]);
    await consolidatedMemoryOf(source, SHAPE, 7);
    // The control arm reads this store. A pass in place would have retired `k1`/`k2` here, and the
    // comparison would then be between the merged store and itself.
    const after = await source.listKnowledge({});
    expect(after.map((item) => item.id).sort()).toEqual(['k1', 'k2']);
    expect(after.every((item) => item.status === 'active')).toBe(true);
    expect(after.every((item) => item.evidence.length === 1)).toBe(true);
  });

  it('recalls the survivor and not what it absorbed', async () => {
    const source = await threeClaims();
    const merged = await consolidatedMemoryOf(source, SHAPE, 7);
    // The control's own host: same identity, same budget, same question. The store is the only
    // difference between these two recalls.
    const control = await openMicroglia({ ...SHAPE, store: source });
    expect((await control.recall(QUERY)).ids.length).toBe(2);
    const pack = await merged.host.recall(QUERY);
    expect(pack.ids.length).toBe(1);
    expect(pack.items[0]?.evidence.length).toBe(2);
    // The absorbed claim is retired rather than deleted, and it says what absorbed it.
    const retired = await merged.store.listKnowledge({ status: 'retired' });
    expect(retired.length).toBe(1);
    expect(retired[0]?.statusReason).toMatch(/^consolidated:/);
  });

  it('stamps the merged store with the clock it was written on, not the wall clock', async () => {
    const merged = await consolidatedMemoryOf(
      await storeOf([claim('k1', ONE_CLAIM, 'task-1'), claim('k2', SAME_CLAIM_AGAIN, 'task-2')]),
      SHAPE,
      7,
    );
    const items = await merged.store.listKnowledge({});
    // A pass that took `Date.now()` would date every survivor years after the store it merged, in
    // the one field a reader uses to ask when this claim was last supported.
    expect(items.every((item) => item.updatedAt === AT)).toBe(true);
  });

  it('reports nothing to fold when no two claims state one thing', async () => {
    const merged = await consolidatedMemoryOf(
      await storeOf([claim('k1', ONE_CLAIM, 'task-1'), claim('k2', OTHER_CLAIM, 'task-2')]),
      SHAPE,
      7,
    );
    expect(merged.report).toMatchObject({ groups: 0, merged: 0, retained: 2, crossTaskGroups: 0 });
    expect(merged.report.supportAfter).toEqual({ 1: 2 });
  });

  it('refuses to call one task observed twice a corroboration', async () => {
    const first = claim('k1', ONE_CLAIM, 'task-1');
    // The same task, the same evidence: folding these would report a duplicate as two witnesses.
    const duplicate = { ...claim('k2', SAME_CLAIM_AGAIN, 'task-1'), evidence: first.evidence };
    const merged = await consolidatedMemoryOf(await storeOf([first, duplicate]), SHAPE, 7);
    expect(merged.report.merged).toBe(0);
    expect(merged.report.refusedDuplicateEvidence).toBe(1);
    expect(merged.report.maxSupportAfter).toBe(1);
  });
});
