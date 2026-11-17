import { describe, expect, it } from 'vitest';
import { createKnowledgeItem, defaultPolicy, type KnowledgeItem } from '@agentix-e/microglia-core';
import { retireBelowSupport, supportFloorLine } from '../tau2-support-floor.js';

const NOW = 1_700_000_000_000;

/** One item backed by `tasks` distinct tasks. */
function item(id: string, tasks: readonly string[], status: 'active' | 'retired' = 'active'): KnowledgeItem {
  const created = createKnowledgeItem(
    {
      namespace: 'test',
      kind: 'procedure',
      scope: { domain: 'retail' },
      statement: `a claim stated by ${id}`,
      evidence: { feedbackId: `fb_${id}`, runId: `run_${id}`, at: NOW, weight: 1 },
      trust: 0.9,
      dedupeKey: `key_${id}`,
    },
    defaultPolicy,
    NOW,
    id,
  );
  return {
    ...created,
    status,
    // One row per task, because the floor counts distinct tasks and a fixture with two rows of one task
    // would test the wrong rule — that case is written out on purpose below.
    evidence: tasks.map((taskId, index) => ({
      feedbackId: `fb_${id}_${String(index)}`,
      runId: `run_${id}_${String(index)}`,
      taskId,
      at: NOW,
      weight: 1,
    })),
  };
}

/**
 * R141 — the store's consensus, served instead of its instances.
 *
 * R139 read two facts off one artefact: every negative-net item had **one** task of support, and **43 of 64**
 * items were never served because the store is 1.75× the request population with one item a request. This
 * pass acts on both at once, and these cases pin what it may and may not touch.
 */
describe('the support floor at serve time', () => {
  it('retires what one task said and keeps what two agreed on', () => {
    const reading = retireBelowSupport(
      [item('a', ['t1']), item('b', ['t1', 't2']), item('c', ['t1', 't2', 't3'])],
      2,
      NOW,
    );
    expect(reading).toMatchObject({ retired: 1, retained: 2, floor: 2 });
    expect(reading.items.map((entry) => entry.status)).toEqual(['retired', 'active', 'active']);
  });

  it('names the reason, so the store census can count what the floor removed', () => {
    // The census groups retired items by `statusReason`; a floor that retired without naming itself would be
    // indistinguishable from the consolidation pass's own retirements.
    const reading = retireBelowSupport([item('a', ['t1'])], 2, NOW);
    expect(reading.items[0]?.statusReason).toBe('support-floor');
    expect(reading.items[0]?.systemUntil).toBe(NOW);
  });

  it('counts distinct tasks the way the score does, so two attempts cannot stand in for two tasks', () => {
    // One task with two episodes is one task of support. A floor that counted evidence rows would keep it,
    // and the item would be served as though a second task had agreed with it.
    const reading = retireBelowSupport([item('a', ['t1', 't1'])], 2, NOW);
    expect(reading).toMatchObject({ retired: 1, retained: 0 });
  });

  it('falls back to the run a record came from when the record names no task', () => {
    // The trace unit's records carry a `runId` and no `taskId`, and the store's own count falls back to the
    // run for exactly that shape. A floor that read `taskId` alone would count every such item as zero
    // support and retire the whole store — the treatment silently becoming the empty arm.
    const base = item('a', []);
    const untasked: KnowledgeItem = {
      ...base,
      evidence: [
        { feedbackId: 'fb_1', runId: 'run_1', at: NOW, weight: 1 },
        { feedbackId: 'fb_2', runId: 'run_2', at: NOW, weight: 1 },
      ],
    };
    expect(retireBelowSupport([untasked], 2, NOW)).toMatchObject({ retired: 0, retained: 1 });
    // Two rows of one run are one task's worth, by the same rule.
    const oneRun: KnowledgeItem = {
      ...base,
      evidence: [
        { feedbackId: 'fb_1', runId: 'run_1', at: NOW, weight: 1 },
        { feedbackId: 'fb_2', runId: 'run_1', at: NOW, weight: 1 },
      ],
    };
    expect(retireBelowSupport([oneRun], 2, NOW)).toMatchObject({ retired: 1, retained: 0 });
  });

  it('leaves retirement alone, because a retired item is not this pass’s finding', () => {
    // Double-counting would make `retired` a sum of two mechanisms and the readback unable to say how much
    // the floor removed.
    const reading = retireBelowSupport([item('a', ['t1'], 'retired'), item('b', ['t1'])], 2, NOW);
    expect(reading).toMatchObject({ retired: 1, retained: 0 });
    expect(reading.items[0]?.statusReason).not.toBe('support-floor');
  });

  it('is a no-op at a floor of one or zero, which is every arm before this one', () => {
    const items = [item('a', ['t1']), item('b', ['t1', 't2'])];
    for (const floor of [0, 1]) {
      const reading = retireBelowSupport(items, floor, NOW);
      expect(reading.retired).toBe(0);
      expect(reading.retained).toBe(2);
      expect(reading.items).toBe(items);
    }
  });

  it('says it is off rather than printing a zero that reads as a finding', () => {
    const off = retireBelowSupport([item('a', ['t1'])], 1, NOW);
    expect(supportFloorLine(off)).toBe('support floor: off (1 item(s) servable)');
    const on = retireBelowSupport([item('a', ['t1']), item('b', ['t1', 't2'])], 2, NOW);
    expect(supportFloorLine(on)).toBe(
      'support floor 2: 1 of 2 item(s) retired for want of corroboration, 1 servable',
    );
  });

  it('carries the population it counted, so the line cannot be read against another one', () => {
    // The line and the record come from one object: a `total` passed in beside the reading is a second
    // source of truth for the denominator, and the round that miscounted it would print a share that no
    // record could contradict.
    const reading = retireBelowSupport([item('a', ['t1']), item('b', ['t1', 't2'])], 2, NOW);
    expect(reading.total).toBe(2);
    expect(reading.retired + reading.retained).toBe(reading.total);
    // Off still reports what is servable rather than what it looked at: an arm with items already retired
    // by the recurrence pass would otherwise read as though they were being served.
    const off = retireBelowSupport([item('a', ['t1'], 'retired'), item('b', ['t1'])], 1, NOW);
    expect(off.total).toBe(2);
    expect(supportFloorLine(off)).toBe('support floor: off (1 item(s) servable)');
  });
});
