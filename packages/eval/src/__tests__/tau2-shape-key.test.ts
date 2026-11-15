/**
 * The fold's key, tested against the store it was inert on.
 *
 * R119 printed two numbers about one store, in one dispatch: `fold: units 631, folded 0, groups 0,
 * atLeastTwo 0, max 1` and `merge: shapes 53, support.atLeastTwo 10, max 5`. They are the same
 * question asked with two keys, and only one of the keys had an input. The merge census keys a
 * correction by the tools it called; the fold keys an item by the `A:` line in its statement — and a
 * record written by the distiller is a sentence with no `A:` line at all, so `callsOfStatement`
 * returned `[]` for all 79 servable items and every one of them was its own unit.
 *
 * The fixtures below are the population that produced that printout: statements in the distiller's
 * register (no answer line), evidence that names the task it came from, and two corrections of one
 * routine. The first test asserts the defect; the rest assert the repair.
 */
import { describe, expect, it } from 'vitest';
import { defaultPolicy, type DistillCandidate, type KnowledgeItem } from '@agentix-e/microglia-core';
import { createKnowledgeItem } from '@agentix-e/microglia-core';
import { foldByShape } from '@agentix-e/microglia-core/apply';
import { actionShapeOf } from '../tau2-merge.js';
import { callsOfStatement, shapeByTaskOf, tau2ShapeOf, tau2ShapeWithFallback } from '../tau2-shape.js';

const AT = 1_700_000_000_000;

/** One claim in the register the distiller writes: a sentence, a scope, and the task behind it. */
function lesson(id: string, statement: string, taskId: string): KnowledgeItem {
  const candidate: DistillCandidate = {
    namespace: 'tau2',
    kind: 'procedure',
    scope: { task: 'tau2.act', domain: 'retail' },
    statement,
    payload: {},
    evidence: { feedbackId: `f_${id}`, runId: `r_${id}`, at: AT, taskId, weight: 0.9 },
    trust: 0.9,
    dedupeKey: `claim|${id}`,
  };
  return createKnowledgeItem(candidate, defaultPolicy, AT, id);
}

const EXCHANGE = 'get_order_details > exchange_delivered_order_items';
const RETURN = 'get_order_details > return_delivered_order_items';

/** Two failures of one routine, and one of another — R119's shape, at three items. */
const STORE: readonly KnowledgeItem[] = [
  lesson('k1', 'An exchange action carries the payment_method_id the user named.', 't1'),
  lesson('k2', 'The payment_method_id on an exchange is the one the user preferred.', 't2'),
  lesson('k3', 'A return action carries the item_ids being returned.', 't3'),
];

const BY_TASK = new Map([
  ['t1', EXCHANGE],
  ['t2', EXCHANGE],
  ['t3', RETURN],
]);

describe('the shape a distilled record states', () => {
  it('states none in its text, which is what made the fold inert', () => {
    // The defect, asserted rather than described: the extractor the lane installs reads an `A:` line
    // and the distiller writes none, so the key is `undefined` for every item of every distilled
    // store — and `foldByShape` treats `undefined` as "its own unit", by design.
    for (const item of STORE) {
      expect(callsOfStatement(item.statement)).toEqual([]);
      expect(tau2ShapeOf(item)).toBeUndefined();
    }
    const inert = foldByShape(STORE, { mode: 'collapse', shapeOf: tau2ShapeOf });
    expect(inert.folded).toBe(0);
    expect(inert.groups).toEqual([]);
    expect(inert.support).toEqual({ max: 1, atLeastTwo: 0, atLeastThree: 0 });
  });

  it('folds when the key comes from the correction that wrote it', () => {
    // `k1` and `k2` are two sentences taught by two tasks of one routine. That is the object ALTK's
    // `sup2` is made of, and it is the object the store could not name.
    const folded = foldByShape(STORE, {
      mode: 'collapse',
      shapeOf: tau2ShapeWithFallback(BY_TASK),
    });
    expect(folded.folded).toBe(1);
    expect(folded.groups).toHaveLength(1);
    expect(folded.groups[0]?.shape).toBe(EXCHANGE);
    expect(folded.groups[0]?.support).toBe(2);
    expect(folded.support).toEqual({ max: 2, atLeastTwo: 1, atLeastThree: 0 });
    // The survivor is one of the two, in the position the earliest member held, and the third item
    // is untouched: nothing is re-ranked and nothing is rewritten.
    expect(folded.items.map((item) => item.id)).toContain('k3');
    expect(folded.items).toHaveLength(2);
  });

  it('prefers the routine a record states itself over the one its task called', () => {
    // A raw capture record carries its own `A:` line, and that line is the routine it *did* call,
    // which is not always the routine the reference trajectory asked for. A fallback that overrode
    // the text would replace a measurement with a task's intention.
    const raw = createKnowledgeItem(
      {
        namespace: 'tau2',
        kind: 'exemplar',
        scope: { task: 'tau2.act' },
        statement: 'Q: cancel my order\nA: cancel_pending_order(order_id="W1")',
        payload: { calls: 1 },
        evidence: { feedbackId: 'f_raw', runId: 'r_raw', at: AT, taskId: 't1', weight: 0.9 },
        trust: 0.9,
        dedupeKey: 'rawlog|raw',
      },
      defaultPolicy,
      AT,
      'raw',
    );
    expect(tau2ShapeWithFallback(BY_TASK)(raw)).toBe('cancel_pending_order');
  });

  it('refuses to name one routine when the evidence names two that differ', () => {
    // An item whose evidence cites an exchange and a return is not one routine. Folding it into
    // either would credit one shape with the other's support, which is the laundering R99 paid for.
    const both: KnowledgeItem = {
      ...lesson('both', 'Both exchanges and returns carry a payment_method_id.', 't1'),
      evidence: [
        { feedbackId: 'f_a', runId: 'r_a', at: AT, taskId: 't1', weight: 0.9 },
        { feedbackId: 'f_b', runId: 'r_b', at: AT, taskId: 't3', weight: 0.9 },
      ],
    };
    expect(tau2ShapeWithFallback(BY_TASK)(both)).toBeUndefined();
  });

  it('names the one routine three tasks agree on', () => {
    const three: KnowledgeItem = {
      ...lesson('three', 'Exchanges carry the payment_method_id the user preferred.', 't1'),
      evidence: [
        { feedbackId: 'f_a', runId: 'r_a', at: AT, taskId: 't1', weight: 0.9 },
        { feedbackId: 'f_b', runId: 'r_b', at: AT, taskId: 't2', weight: 0.9 },
        { feedbackId: 'f_c', runId: 'r_c', at: AT, taskId: 't3', weight: 0.9 },
      ],
    };
    // `t1` and `t2` agree on EXCHANGE and `t3` disagrees, so there is no single routine here either.
    expect(tau2ShapeWithFallback(BY_TASK)(three)).toBeUndefined();
    // With the dissent removed the same item names its routine, which is the branch's other side.
    const agreed = tau2ShapeWithFallback(new Map([['t1', EXCHANGE], ['t2', EXCHANGE], ['t3', EXCHANGE]]));
    expect(agreed(three)).toBe(EXCHANGE);
  });

  it('leaves an item its own unit when no evidence task has a known routine', () => {
    // A claim the store wrote from a run whose correction is not in the learn half — a hand-written
    // rule, or a record from a store written by another arm — has no routine this host can name.
    const orphan = lesson('k9', 'A cancellation reason is supplied once the user states it.', 't_absent');
    expect(tau2ShapeWithFallback(BY_TASK)(orphan)).toBeUndefined();
    expect(tau2ShapeWithFallback(new Map())(STORE[0] as KnowledgeItem)).toBeUndefined();
  });

  it('derives the index from the same function the merge census uses, and stops where a routine stops', () => {
    // One definition, because a second copy would drift: the census that priced the merge and the
    // key the fold reads are the same function of the same correction.
    const corrections = [
      { taskId: 't1', actions: [{ name: 'get_order_details' }, { name: 'exchange_delivered_order_items' }] },
      { taskId: 't2', actions: [] },
    ];
    const byTask = shapeByTaskOf(corrections);
    expect(byTask.get('t1')).toBe(actionShapeOf(corrections[0] as never));
    // The two keys deliberately part company here. The census needs *a* bucket for every correction
    // so `wouldStore` counts a store's size, and a correction that called nothing gets `task:<id>`;
    // the fold needs a *routine*, and `task:t2` is not one — an item naming no routine is its own
    // unit, which is what `shape-fold.ts` already decides. Writing `task:t2` into the fold would put
    // a string in `groups[].shape` that no task ever called.
    expect(actionShapeOf(corrections[1] as never)).toBe('task:t2');
    expect(byTask.has('t2')).toBe(false);
  });
});

describe('the evidence the fallback declines to read', () => {
  it('ignores an evidence entry that names no task, rather than refusing the item', () => {
    // A run that was recorded without a task id is still evidence; it simply cannot be joined to a
    // correction. Letting that silence veto a name another entry supplies would make the key depend on
    // which form of evidence a store happened to write.
    const item: KnowledgeItem = {
      ...lesson('k7', 'An exchange carries the payment_method_id the user named.', 't1'),
      evidence: [
        { feedbackId: 'f_x', runId: 'r_x', at: AT, weight: 0.9 },
        { feedbackId: 'f_y', runId: 'r_y', at: AT, taskId: 't1', weight: 0.9 },
      ],
    };
    expect(tau2ShapeWithFallback(BY_TASK)(item)).toBe(EXCHANGE);
    // And an item whose only evidence names no task resolves to nothing, which makes it its own unit.
    const anonymous: KnowledgeItem = {
      ...lesson('k8', 'An exchange carries the payment_method_id the user named.', 't1'),
      evidence: [{ feedbackId: 'f_z', runId: 'r_z', at: AT, weight: 0.9 }],
    };
    expect(tau2ShapeWithFallback(BY_TASK)(anonymous)).toBeUndefined();
  });

  it('accepts an item the projection had no evidence for at all', () => {
    // `{ statement }` is what the fold's own type asks for; `evidence` is the lane's addition. A caller
    // that has only a statement gets `undefined` rather than an exception, because a fold that threw on
    // a store written by another arm would be a mechanism that only works on its own output.
    expect(tau2ShapeWithFallback(BY_TASK)({ statement: 'An exchange carries a payment_method_id.' })).toBeUndefined();
  });
});
