import { describe, expect, it } from 'vitest';
import {
  defaultPolicy,
  fixedClock,
  mulberry32,
  type DistillCandidate,
  type FeedbackEvent,
  type KnowledgeItem,
  type RunRecord,
} from '../../kernel/index.js';
import { EmbeddedMemory, MemoryJournal } from '../../memory/index.js';
import { distill, type Interpreter } from '../index.js';

const at = 1_700_000_000_000;

/**
 * Two records of two afternoons are not two claims about one afternoon.
 *
 * R85 wrote twelve records and the store admitted **one**. The cause was not the ceiling and not the
 * retriever: `distill` walks the pool looking for an item of the same kind in the same scope with
 * different content and records a contradiction, which halves the older item's support and drops it
 * below `minSupport`. That rule is right for claims — two rules of one kind in one scope answer one
 * question, so different content is a disagreement — and it is wrong for records, because an event
 * does not disagree with another event. Two orders were cancelled on two days; both happened.
 *
 * The twelve records shared a scope because the driver opens every task as `tau2.act`, so the rule
 * fired eleven times and the store ended with `support 0.45` on eleven of twelve items. A store of
 * candidates is the R55.0 defect in another coat: items that exist, are counted, and are reachable by
 * nothing.
 */

function run(id: string, task: string): RunRecord {
  return {
    schema: 'microglia.run/1',
    id,
    at,
    namespace: 'acme',
    sessionId: 's1',
    task,
    input: { question: 'cancel my order' },
    output: { order: 'W237' },
    provenance: { knowledgeIds: [] },
    feedbackIds: [],
  };
}

function edit(id: string, runId: string, task: string): FeedbackEvent {
  return {
    schema: 'microglia.feedback/1',
    id,
    at,
    namespace: 'acme',
    sessionId: 's1',
    runId,
    task,
    kind: 'edit',
    actor: { type: 'user' },
    trust: 0.9,
    signal: {
      type: 'edit',
      beforeHash: 'a',
      afterHash: 'b',
      ops: [],
      distance: 0.5,
      after: { order: 'W237' },
    },
    provenance: { knowledgeIds: [] },
    redactions: 0,
  };
}

function candidate(overrides: Partial<DistillCandidate> = {}): DistillCandidate {
  return {
    namespace: 'acme',
    kind: 'exemplar',
    scope: { task: 'tau2.act', domain: 'retail' },
    statement: 'Q: cancel my order\nA: cancel_pending_order(order_id="W237")',
    payload: { runId: 'run_1' },
    evidence: { feedbackId: 'fb_1', runId: 'run_1', at, weight: 0.9 },
    trust: 0.9,
    dedupeKey: 'k1',
    ...overrides,
  };
}

/** Distil two events whose interpreters both answer with an exemplar, and read the store back. */
async function twoRecords(
  first: Partial<DistillCandidate>,
  second: Partial<DistillCandidate>,
): Promise<readonly KnowledgeItem[]> {
  const memory = await EmbeddedMemory.open(new MemoryJournal());
  const one = edit('fb_1', 'run_1', 'tau2.act');
  const two = edit('fb_2', 'run_2', 'tau2.act');
  await memory.putRun(run('run_1', 'tau2.act'));
  await memory.putRun(run('run_2', 'tau2.act'));
  await memory.appendEvent(one);
  await memory.appendEvent(two);
  const firstInterpreter: Interpreter = () => Promise.resolve([candidate(first)]);
  const secondInterpreter: Interpreter = () => Promise.resolve([candidate(second)]);
  await distill({
    memory,
    interpreter: firstInterpreter,
    policy: defaultPolicy,
    clock: fixedClock(at),
    random: mulberry32(1),
  });
  await distill({
    memory,
    interpreter: secondInterpreter,
    policy: defaultPolicy,
    clock: fixedClock(at + 1_000),
    random: mulberry32(2),
  });
  return memory.listKnowledge({});
}

describe('a record does not contradict another record', () => {
  it('keeps both records active when they share a scope and differ in content', async () => {
    // The exact shape R85 hit. Two episodes, one scope (the driver opens every task as `tau2.act`),
    // two different payloads. Before this rule, the second write halved the first item's support to
    // 0.45 and dropped it to `candidate`; eleven of twelve records died that way.
    const items = await twoRecords(
      { dedupeKey: 'k1', statement: 'Q: cancel W237\nA: cancel_pending_order(order_id="W237")' },
      {
        dedupeKey: 'k2',
        statement: 'Q: where is W991\nA: get_order_details(order_id="W991")',
        // A different event, so a different payload: `contradictSameScope` skips an absent side, and
        // two payloads that happened to match would be merged rather than compared.
        payload: { runId: 'run_2' },
        evidence: { feedbackId: 'fb_2', runId: 'run_2', at: at + 1_000, weight: 0.9 },
      },
    );
    expect(items).toHaveLength(2);
    expect(items.every((item) => item.status === 'active')).toBe(true);
    expect(items.every((item) => item.contradictions === 0)).toBe(true);
    expect(items.map((item) => item.support)).toEqual([0.9, 0.9]);
  });

  it('still contradicts two claims of one kind in one scope, which is the rule being kept', async () => {
    // The regression that matters: this exception is written for events, and a constraint is not one.
    // A store that stopped contradicting claims would let "cancel before shipping" and "never cancel"
    // both stay active, which is the failure the original rule was built for.
    const items = await twoRecords(
      {
        kind: 'constraint',
        dedupeKey: 'k1',
        statement: 'Cancel before the order ships.',
        payload: { rule: 'before-shipping' },
      },
      {
        kind: 'constraint',
        dedupeKey: 'k2',
        statement: 'Never cancel an order.',
        payload: { rule: 'never' },
        evidence: { feedbackId: 'fb_2', runId: 'run_2', at: at + 1_000, weight: 0.9 },
      },
    );
    expect(items).toHaveLength(2);
    const contradicted = items.filter((item) => item.contradictions > 0);
    expect(contradicted).toHaveLength(1);
    expect(contradicted[0]?.support).toBeCloseTo(0.45, 5);
  });

  it('does not contradict across kinds either, which the kind guard already kept', async () => {
    // Kept as a case because the new exception sits beside the old one: a record and a rule in one
    // scope are two different objects of two different kinds, and an event cannot be refuted by a
    // generalisation any more than a generalisation can be refuted by an anecdote.
    const items = await twoRecords(
      { dedupeKey: 'k1', statement: 'Q: cancel W237\nA: cancel_pending_order(order_id="W237")' },
      {
        kind: 'constraint',
        dedupeKey: 'k2',
        statement: 'Cancel before the order ships.',
        payload: { rule: 'before-shipping' },
        evidence: { feedbackId: 'fb_2', runId: 'run_2', at: at + 1_000, weight: 0.9 },
      },
    );
    expect(items.every((item) => item.contradictions === 0)).toBe(true);
  });

  it('reports the exception rather than inferring it, so a count can be read beside it', async () => {
    // The alternative was a silent `continue`. `distill` returns a report, and a store that skipped a
    // rule without saying so is the defect this record keeps paying for: the reader sees two active
    // items and cannot tell whether they were reconciled or exempted.
    const memory = await EmbeddedMemory.open(new MemoryJournal());
    await memory.putRun(run('run_1', 'tau2.act'));
    await memory.appendEvent(edit('fb_1', 'run_1', 'tau2.act'));
    const interpreter: Interpreter = () => Promise.resolve([candidate()]);
    const report = await distill({
      memory,
      interpreter,
      policy: defaultPolicy,
      clock: fixedClock(at),
      random: mulberry32(1),
    });
    expect(report.contradicted).toBe(0);
  });
});
