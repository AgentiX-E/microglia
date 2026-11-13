/**
 * TDD for the merge census (R99's instrument, §34.122).
 *
 * The store cannot say how many *routines* its learn half contains, because it stores one statement per
 * failed task and its dedupe key is the statement. This module answers the question a merge arm would
 * be registered to answer — how many distinct tool sequences the half produced, and how many tasks
 * taught each — and it is deliberately a census and not a treatment: nothing here changes what a store
 * holds, so the number it produces can be quoted before an arm is bought.
 *
 * The fixtures are the shapes the retail learn half actually contains: an exchange, a cancel, a modify,
 * a rubric-only task, and a second failure of the exchange routine with different ids. That last one is
 * the whole point — it is one routine and two corrections.
 */
import { describe, expect, it } from 'vitest';
import { MERGE_GROUP_CAP, actionShapeOf, mergeCensusOf } from '../tau2-merge.js';
import type { Correction } from '../tau2.js';

function correction(
  taskId: string,
  names: readonly string[],
  extra: Partial<Correction> = {},
): Correction {
  return {
    taskId,
    // The statement is the one `taskCorrection` writes: the calls *with their arguments*, which is why
    // two failures of one routine are two statements under a statement-keyed dedupe and one shape here.
    statement: `a request of this shape is resolved by calling ${names
      .map((name) => `${name}(order_id="#W${taskId}")`)
      .join(', then ')}`,
    provenance: 'edited',
    actions: names.map((name) => ({ name, arguments: { order_id: `#W${taskId}` } })),
    instruction: `task ${taskId}`,
    assertions: [],
    ...extra,
  };
}

const EXCHANGE = ['find_user_id_by_name_zip', 'get_order_details', 'exchange_delivered_order_items'];
const CANCEL = ['find_user_id_by_email', 'get_order_details', 'cancel_pending_order'];
const MODIFY = ['find_user_id_by_name_zip', 'get_order_details', 'modify_pending_order_address'];

describe('a shape is the routine, not the instance', () => {
  it('ignores the arguments, so two failures of one routine share a shape', () => {
    const left = correction('1', EXCHANGE);
    const right = correction('2', EXCHANGE);
    expect(actionShapeOf(left)).toBe(actionShapeOf(right));
    expect(actionShapeOf(left)).toBe(
      'find_user_id_by_name_zip > get_order_details > exchange_delivered_order_items',
    );
    // The arguments differ on every call and the shape is still one string: this is the identity a
    // shape-keyed store would dedupe on, and the reason it is not the statement.
    expect(left.statement).not.toBe(right.statement);
  });

  it('keeps a correction that states no calls from merging with any other', () => {
    // A rubric-only task has no routine. Two rubrics are two requirements, and a shared empty key would
    // merge a policy about gift cards with one about addresses.
    const left = actionShapeOf(correction('7', []));
    const right = actionShapeOf(correction('8', []));
    expect(left).toBe('task:7');
    expect(left).not.toBe(right);
  });
});

describe('the merge census prices the recurrence the store cannot report', () => {
  it('reports the store the lane writes today as nothing merging', () => {
    // Three different routines, three corrections: `corrections === shapes`, which is R92's store.
    const census = mergeCensusOf([
      correction('1', EXCHANGE),
      correction('2', CANCEL),
      correction('3', MODIFY),
    ]);
    expect(census.corrections).toBe(3);
    expect(census.shapes).toBe(3);
    expect(census.mergeable).toBe(0);
    expect(census.wouldStore).toBe(3);
    expect(census.support).toEqual({ max: 1, atLeastTwo: 0, atLeastThree: 0 });
    expect(census.groups).toEqual([]);
    expect(census.omitted).toBe(0);
  });

  it('counts a repeated routine as one record with the tasks behind it', () => {
    const census = mergeCensusOf([
      correction('1', EXCHANGE),
      correction('2', EXCHANGE),
      correction('3', EXCHANGE),
      correction('4', CANCEL),
    ]);
    expect(census.corrections).toBe(4);
    expect(census.shapes).toBe(2);
    expect(census.mergeable).toBe(3);
    expect(census.wouldStore).toBe(2);
    // Three tasks taught the exchange routine: this is the cell ALTK's `sup3` keeps and the one no arm
    // in this record can produce.
    expect(census.support).toEqual({ max: 3, atLeastTwo: 1, atLeastThree: 1 });
    expect(census.groups).toEqual([
      { shape: actionShapeOf(correction('1', EXCHANGE)), corrections: 3, tasks: ['1', '2', '3'] },
    ]);
  });

  it('ranks groups by size then by shape, and bounds the list without hiding it', () => {
    const many = [
      correction('1', CANCEL),
      correction('2', CANCEL),
      correction('3', EXCHANGE),
      correction('4', EXCHANGE),
      correction('5', MODIFY),
    ];
    const whole = mergeCensusOf(many);
    // Two groups of two; a tie is broken by shape so two arms compare without a second sort.
    expect(whole.groups.map((group) => group.corrections)).toEqual([2, 2]);
    const [first, second] = whole.groups;
    expect(first === undefined || second === undefined || first.shape < second.shape).toBe(true);

    // Three groups of two, inserted in descending shape order, so the tie-break is exercised in both
    // directions rather than one — a comparator tested one way is a comparator half-covered.
    const three = mergeCensusOf([
      correction('9', MODIFY),
      correction('8', MODIFY),
      correction('5', EXCHANGE),
      correction('4', EXCHANGE),
      correction('2', CANCEL),
      correction('1', CANCEL),
    ]);
    expect(three.groups.map((group) => group.shape.split(' > ').at(-1))).toEqual([
      'cancel_pending_order',
      'exchange_delivered_order_items',
      'modify_pending_order_address',
    ]);

    const bounded = mergeCensusOf(many, 1);
    expect(bounded.groups).toHaveLength(1);
    // The count of what did not fit travels with the sample, so a bounded list is never read as the
    // whole population — the defect `storeItems` and `useObservations` both guard against.
    expect(bounded.omitted).toBe(1);
    expect(bounded.shapes).toBe(3);
  });

  it('counts a task once however many corrections it produced', () => {
    // The trace unit can yield up to three claims per task, and support counts *tasks*. A bucket that
    // counted corrections would report recurrence where one task merely repeated itself.
    const census = mergeCensusOf([
      correction('1', EXCHANGE),
      correction('1', EXCHANGE),
      correction('2', EXCHANGE),
    ]);
    expect(census.groups).toEqual([
      { shape: actionShapeOf(correction('1', EXCHANGE)), corrections: 3, tasks: ['1', '2'] },
    ]);
    expect(census.support).toEqual({ max: 2, atLeastTwo: 1, atLeastThree: 0 });
    expect(census.mergeable).toBe(3);
  });

  it('reports an empty learn half as a census of zero rather than as a missing field', () => {
    const census = mergeCensusOf([]);
    expect(census).toEqual({
      corrections: 0,
      shapes: 0,
      mergeable: 0,
      wouldStore: 0,
      support: { max: 0, atLeastTwo: 0, atLeastThree: 0 },
      groups: [],
      omitted: 0,
    });
    // A negative or fractional cap is a caller bug, not a licence to slice from the end.
    expect(mergeCensusOf([correction('1', EXCHANGE)], -1).groups).toEqual([]);
    expect(mergeCensusOf([correction('1', EXCHANGE)], 2.7).groups).toEqual([]);
    expect(MERGE_GROUP_CAP).toBeGreaterThan(0);
  });
});
