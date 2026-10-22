import { describe, expect, it } from 'vitest';
import { EmbeddedMemory, MemoryJournal } from '@agentix-e/microglia-core/memory';
import { openMicroglia, type Microglia } from '@agentix-e/microglia-core/capture';
import { knowledgeEvents, snapshotOf } from '@agentix-e/microglia-core/delivery';
import { mulberry32, steppingClock, type JsonObject } from '@agentix-e/microglia-core';
import { chartEditDistance, chartInterpreter } from '../workload/index.js';

/**
 * Distillation reprocesses the log from the beginning unless the caller passes
 * `since`, and every lane and host here calls it without one. That is fine —
 * evidence is de-duplicated by feedback id — as long as a second pass over the
 * same events changes nothing. It used to advance `updatedAt` on every rule it
 * re-merged, which made "nothing happened" and "this rule was rewritten" the same
 * observation, and that is the difference a delivery log reads.
 *
 * The test uses the chart workload rather than a hand-written interpreter: the
 * defect was in the merge path every lane goes through, and a bespoke interpreter
 * would have exercised a path no product has.
 */

const CORRECTIONS: readonly { readonly domain: string; readonly intent: string; readonly mark: string }[] = [
  { domain: 'sales', intent: 'trend', mark: 'line' },
  { domain: 'hr', intent: 'comparison', mark: 'bar' },
];

function features(domain: string, intent: string): JsonObject {
  return { question: `q-${domain}-${intent}`, domain, intent, field: `${domain}_measure`, categoryCount: 4, grain: 'month' };
}

async function laneStore(): Promise<Microglia> {
  const store = await EmbeddedMemory.open(new MemoryJournal());
  return openMicroglia({
    app: 'distill-idempotence',
    namespace: 'acme',
    store,
    interpreter: async (context) => chartInterpreter(context),
    editSemantics: chartEditDistance,
    clock: steppingClock(1_700_000_000_000, 1),
    random: mulberry32(7),
  });
}

async function correct(mg: Microglia, domain: string, intent: string, mark: string): Promise<void> {
  const run = mg.begin({ task: 'chart.recommend', input: features(domain, intent) });
  await run.complete({ mark: 'pie', x: `${domain}_measure`, y: 'v', aggregate: 'sum' });
  await run.edit({ mark, x: `${domain}_measure`, y: 'v', aggregate: 'sum' });
}

describe('distillation is a no-op when nothing new arrived', () => {
  it('leaves every rule identical on a second pass, timestamps included', async () => {
    const mg = await laneStore();
    for (const entry of CORRECTIONS) await correct(mg, entry.domain, entry.intent, entry.mark);

    await mg.distill({ generalize: false });
    const first = await mg.store.listKnowledge({ namespace: 'acme', status: 'all' });
    await mg.distill({ generalize: false });
    const after = await mg.store.listKnowledge({ namespace: 'acme', status: 'all' });

    expect(first.length).toBe(CORRECTIONS.length);
    expect(after).toEqual(first);
    expect(after.map((item) => item.updatedAt)).toEqual(first.map((item) => item.updatedAt));
    await mg.close();
  });

  it('publishes no delivery event for a pass that changed nothing', async () => {
    const mg = await laneStore();
    for (const entry of CORRECTIONS) await correct(mg, entry.domain, entry.intent, entry.mark);
    await mg.distill({ generalize: false });
    const before = await mg.store.listKnowledge({ namespace: 'acme', status: 'all' });
    const snapshot = snapshotOf(before);

    await mg.distill({ generalize: false });
    const after = await mg.store.listKnowledge({ namespace: 'acme', status: 'all' });
    expect(
      knowledgeEvents({ namespace: 'acme', taskType: 'chart.recommend', previous: snapshot, current: after }),
    ).toEqual([]);
    await mg.close();
  });

  it('still records a rule that genuinely changes', async () => {
    // The guard must not freeze a rule against new evidence: the same correction
    // observed again is a second observation of one claim, and `updatedAt` moves.
    const mg = await laneStore();
    for (const entry of CORRECTIONS) await correct(mg, entry.domain, entry.intent, entry.mark);
    await mg.distill({ generalize: false });
    const before = await mg.store.listKnowledge({ namespace: 'acme', status: 'all' });

    const [first] = CORRECTIONS;
    if (first === undefined) throw new Error('no corrections');
    await correct(mg, first.domain, first.intent, first.mark);
    const report = await mg.distill({ generalize: false });
    const after = await mg.store.listKnowledge({ namespace: 'acme', status: 'all' });

    expect(report.created).toBe(0);
    // Candidates, not items: the pass reprocesses every event, and the new one is
    // another observation of a claim the store already holds.
    expect(report.merged).toBeGreaterThanOrEqual(CORRECTIONS.length);
    const salesTrend = after.filter(
      (item) => item.scope.domain === first.domain && item.scope.intent === first.intent,
    );
    const previous = before.find((item) => item.scope.domain === first.domain && item.scope.intent === first.intent);
    const current = salesTrend.find((item) => item.id === previous?.id);
    expect(current?.updatedAt).toBeGreaterThan(previous?.updatedAt ?? 0);
    expect(current?.evidence.length).toBeGreaterThan(previous?.evidence.length ?? 0);
    await mg.close();
  });
});
