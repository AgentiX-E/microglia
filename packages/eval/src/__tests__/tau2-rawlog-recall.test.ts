import { describe, expect, it } from 'vitest';
import { EmbeddedMemory, MemoryJournal } from '@agentix-e/microglia-core/memory';
import { openMicroglia } from '@agentix-e/microglia-core/capture';
import { mulberry32, steppingClock } from '@agentix-e/microglia-core';
import { rawLogInterpreter } from '../tau2-rawlog.js';
import { stampDomain } from '../tau2-distill.js';
import { tau2EditSemantics } from '../tau2-admission.js';

/**
 * The arm's premise, measured in-process before a dispatch pays for it.
 *
 * `unit=raw` exists because a distilled claim is a statement *about* a class of requests and the
 * retriever that serves it is lexical, so a claim about cancelling an order cannot be matched by the
 * order id the next customer quotes. That is a claim about *this* retriever, not about the papers it
 * came from, and the coverage reading that motivated the arm (10.53% against a 12% floor) is the
 * evidence it is true here.
 *
 * These cases assert the premise directly: a record written from one task is served to a *different*
 * task's question that shares its words, and is not served to a question that shares none. If either
 * half failed, the dispatch would spend an hour of evaluation measuring a mechanism that was never
 * there — and the failure would look exactly like a memory that did not help.
 */

async function hostWith(question: string, correction: { note: string; arguments: Record<string, unknown> }) {
  const store = await EmbeddedMemory.open(new MemoryJournal());
  const host = await openMicroglia({
    app: 'microglia-l4',
    namespace: 'tau2',
    store,
    interpreter: stampDomain(rawLogInterpreter, 'retail'),
    budget: 1200,
    // The lane's own edit semantics, which is what makes a τ² correction a gold-verified one: the
    // default prices a correction by how many leaves it changed, and a correction that swaps one
    // order id for another is a small edit to a textfield and a total one to the task. Without this
    // the event carries trust 0.833, the item lands at confidence 0.5396 against an activation
    // threshold of 0.6, and the store marks it a candidate -- stored, counted, and reachable by
    // nothing. The driver passes it; a test that did not would be measuring a different writer.
    editSemantics: tau2EditSemantics,
    clock: steppingClock(1_700_000_000_000, 1),
    random: mulberry32(7),
  });
  const handle = host.begin({
    task: 'tau2.act',
    taskId: 'retail/3',
    input: { question, domain: 'retail', schemaDigest: 'retail', taskId: 'retail/3' },
    model: 'deepseek-chat',
    promptVersion: 'tau2/1',
    domainPack: 'tau2',
  });
  await handle.complete({ actions: ['lookup_order'] });
  await handle.edit({ actions: [{ name: 'cancel_pending_order', arguments: correction.arguments }] }, {
    note: correction.note,
  });
  await host.distill({ generalize: false });
  return { host, store };
}

describe('a record is reachable by the words the next request uses', () => {
  it('serves a record written from one task to another task that shares its words', async () => {
    const { host, store } = await hostWith('I need to cancel order W237, it is no longer needed', {
      note: 'cancel_pending_order(order_id="W237", reason="no longer needed")',
      arguments: { order_id: 'W237', reason: 'no longer needed' },
    });
    const items = await store.listKnowledge({});
    // Stored *and active*: the first version of this arm wrote a record at trust 0.7, under the
    // policy's 0.8 support floor, and the store marked it a candidate — one item, zero servable.
    expect(items).toHaveLength(1);
    expect(items[0]?.status).toBe('active');
    expect(items[0]?.statement).toContain('W237');

    const pack = await host.recall({
      // A different task id, and the domain the write was stamped with.
      task: 'tau2.act',
      text: 'Please cancel W237, the item is no longer needed',
      scope: { domain: 'retail' },
    });
    expect(pack.ids).toHaveLength(1);
    expect(pack.rendered).toContain('W237');
  });

  it('is the floor that separates a request it answers from one it does not', async () => {
    // Two facts, and the second is the one that decides the arm. At `minCoverage: 0` — which is what
    // this lane's registrations pass, `recallFloor: 0` — the pack carries whatever is servable, so a
    // coverage reading taken there measures the record's text rather than a filter's decision. Put a
    // floor under it and the discrimination appears: the request that shares the record's words keeps
    // it, and a request about the weather in Lisbon does not. An abstraction that says only
    // "cancellations need the order id" would score zero against both, which is the 10.53% R58
    // measured.
    const { host } = await hostWith('I need to cancel order W237, it is no longer needed', {
      note: 'cancel_pending_order(order_id="W237", reason="no longer needed")',
      arguments: { order_id: 'W237', reason: 'no longer needed' },
    });
    const related = await host.recall({
      task: 'tau2.act',
      text: 'Please cancel W237, the item is no longer needed',
      scope: { domain: 'retail' },
      minCoverage: 0.2,
    });
    expect(related.ids).toHaveLength(1);
    const unrelated = await host.recall({
      task: 'tau2.act',
      text: 'What is the weather in Lisbon next Tuesday?',
      scope: { domain: 'retail' },
      minCoverage: 0.2,
    });
    expect(unrelated.ids).toEqual([]);
  });

  it('carries the argument values into the pack, which is the faithfulness claim made concrete', async () => {
    // The claim `tau2-faithfulness.ts` measures in aggregate, asserted once on the rendered text: what
    // the model reads contains the entities the episode stated. An abstraction is free to drop them;
    // a record is not, and this is the assertion that says so at the boundary where it matters.
    const { host } = await hostWith('exchange the shoes in W237 for item 9', {
      note: 'exchange_delivered_order(order_id="W237", new_item_ids=["item-9"])',
      arguments: { order_id: 'W237', new_item_ids: ['item-9'] },
    });
    const pack = await host.recall({
      task: 'tau2.act',
      text: 'the shoes in W237 are too small, can I exchange them for item-9',
      scope: { domain: 'retail' },
    });
    expect(pack.ids).toHaveLength(1);
    expect(pack.rendered).toContain('W237');
    expect(pack.rendered).toContain('item-9');
  });
});
