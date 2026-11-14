import { describe, expect, it } from 'vitest';
import { storeItemSample } from '../store-items.js';

/**
 * R54's instrument: the artefact carries what the store said, not only how many items said it.
 *
 * R51 could count conditions and not read one. Its readback therefore could not tell a
 * trigger written in the user's register ("when the customer asks to cancel an order") from
 * one written in the procedure's ("when this request requires cancelling"), and those two
 * predict opposite coverage — the first is the mechanism working, the second is a rule that
 * no question can match. A census that cannot tell them apart certifies nothing about
 * relevance, which is what the next registration has to measure.
 *
 * The bounds are part of the contract, not a convenience: an artefact that silently dropped
 * half a store would let the register of the sample stand in for the register of the store.
 */

const item = (overrides: Partial<Parameters<typeof storeItemSample>[0][number]> = {}) => ({
  id: 'k1',
  kind: 'procedure',
  status: 'active' as const,
  when: 'when the customer asks to cancel an order',
  statement: 'A request of this shape is resolved by calling find_user, then cancel_pending_order.',
  trust: 0.9,
  scope: { domain: 'retail' },
  evidence: [{ taskId: 'task_a', runId: 'run_1' }],
  ...overrides,
});

describe('the store sample the artefact carries', () => {
  it('keeps the condition and the statement, which are the two halves a readback reads', () => {
    const sample = storeItemSample([item()]);
    expect(sample.items).toHaveLength(1);
    expect(sample.items[0]?.when).toBe('when the customer asks to cancel an order');
    expect(sample.items[0]?.statement).toContain('cancel_pending_order');
    expect(sample.items[0]?.scope).toEqual({ domain: 'retail' });
    expect(sample.omitted).toBe(0);
    expect(sample.truncated).toBe(0);
  });

  it('carries the reason an item was retired, which is the only pointer to the survivor', () => {
    // The recurrence pass retires a member and names the survivor in `consolidated:<id>`. Without it
    // the sample holds both items and no join, so a readback can say that a group merged and never
    // say which pair — the one thing the registration asks it to judge.
    const sample = storeItemSample([
      item({ id: 'k2', status: 'retired', statusReason: 'consolidated:k1' }),
      item({ id: 'k1' }),
    ]);
    expect(sample.items[0]?.statusReason).toBe('consolidated:k1');
    // Absent rather than `undefined`: a key that is always present would tell a reader that the
    // store said something about every item's status, which it does not.
    expect(sample.items[1] === undefined ? null : 'statusReason' in sample.items[1]).toBe(false);
  });

  it("carries each item's status, so the sample cannot be read over the wrong population", () => {
    // `conditioned` is counted over *servable* items -- active, and in the recall scope --
    // while the sample is drawn from the whole store. A readback that counted conditions in
    // the sample and compared the total to `conditioned` would be comparing two populations,
    // which is the defect this whole family of instruments exists to close. The status is
    // what lets a reader intersect the sample with the population the count was taken over.
    const sample = storeItemSample([
      item({ id: 'a' }),
      item({ id: 'r', status: 'retired' }),
      item({ id: 'q', status: 'quarantined', when: undefined }),
    ]);
    expect(sample.items.map((entry) => entry.status)).toEqual(['active', 'retired', 'quarantined']);
    expect(sample.items.filter((entry) => entry.status === 'active').length).toBe(1);
  });

  it('omits the condition key entirely when the item states none', () => {
    // Absent and empty are different claims about a rule, and a sample that rendered the
    // absent one as `when: ''` would make every unconditional rule look conditioned-but-blank.
    const sample = storeItemSample([item({ when: undefined })]);
    expect(sample.items[0] === undefined ? true : 'when' in sample.items[0]).toBe(false);
  });

  it('counts what it left out rather than dropping it quietly', () => {
    const many = Array.from({ length: 5 }, (_, index) => item({ id: `k${String(index)}` }));
    const sample = storeItemSample(many, { limit: 2 });
    expect(sample.items.map((entry) => entry.id)).toEqual(['k0', 'k1']);
    expect(sample.omitted).toBe(3);
    expect(sample.limit).toBe(2);
  });

  it('cuts a long statement at the cap and counts the item as truncated', () => {
    const long = 'x'.repeat(400);
    const short = item({ id: 'k2', statement: 'Call cancel_pending_order.', when: undefined });
    const sample = storeItemSample([item({ statement: long }), short], { maxChars: 40 });
    expect(sample.items[0]?.statement).toHaveLength(40);
    expect(sample.items[0]?.statement.endsWith('…')).toBe(true);
    expect(sample.truncated).toBe(1);
    expect(sample.items[1]?.statement).not.toContain('…');
  });

  it('refuses a limit or a cap that would make the sample meaningless', () => {
    const sample = storeItemSample([item()], { limit: 0, maxChars: 0 });
    expect(sample.limit).toBe(1);
    expect(sample.maxChars).toBe(8);
    expect(sample.items).toHaveLength(1);
  });

  it('cuts a long condition too, and counts the item once', () => {
    const sample = storeItemSample([item({ when: 'w'.repeat(300), statement: 'Short.' })], {
      maxChars: 50,
    });
    expect(sample.items[0]?.when).toHaveLength(50);
    expect(sample.items[0]?.when?.endsWith('…')).toBe(true);
    expect(sample.truncated).toBe(1);
  });

  it('carries how many distinct tasks stand behind each item, and how many rows', () => {
    // R55.0's measurement, taken with no treatment at all: the competitive record's `sup3` arm
    // admits a claim only when at least three distinct tasks derived it, and this project has
    // never counted whether anything recurs. Both numbers are already in the store -- an item
    // holds its evidence rows, each naming the task it came from -- so the sample can carry them
    // without changing what the distiller writes.
    const sample = storeItemSample([
      item({
        id: 'recurring',
        evidence: [
          { taskId: 'task_a', runId: 'r1' },
          { taskId: 'task_a', runId: 'r2' },
          { taskId: 'task_b', runId: 'r3' },
        ],
      }),
      item({ id: 'single', evidence: [{ taskId: 'task_c', runId: 'r4' }] }),
    ]);
    expect(sample.items.map((entry) => entry.evidence)).toEqual([3, 1]);
    // Three rows, two tasks: the same task retried is one observation, which is the definition
    // the score uses and the one a recurrence claim has to be read against.
    expect(sample.items.map((entry) => entry.supportTasks)).toEqual([2, 1]);
  });

  it('counts a row with no task as its own observation, as the score does', () => {
    const sample = storeItemSample([
      item({
        id: 'unattributed',
        evidence: [{ runId: 'r1' }, { runId: 'r2' }],
      }),
    ]);
    expect(sample.items[0]?.supportTasks).toBe(2);
    expect(sample.items[0]?.evidence).toBe(2);
  });

  it('reports zero support for an item with no evidence rows rather than one', () => {
    // Unreachable through the store -- an item is created with its first row -- but the count is
    // a claim about corroboration, and an empty list is no corroboration at all.
    const sample = storeItemSample([item({ evidence: [] })]);
    expect(sample.items[0]?.supportTasks).toBe(0);
    expect(sample.items[0]?.evidence).toBe(0);
  });

  it('omits the scope domain when the item has none, which V44 counts separately', () => {
    // An item stored without a domain is unreachable by every recall that asks in one, so a
    // sample that rendered it as `domain: ''` would hide the defect it is supposed to expose.
    const sample = storeItemSample([item({ scope: {} })]);
    expect(sample.items[0]?.scope).toEqual({});
  });

  it('is empty for an empty store, rather than absent', () => {
    // "The store held nothing" and "the artefact did not record the store" are different
    // facts, and only one of them is evidence about a distiller.
    const sample = storeItemSample([]);
    expect(sample.items).toEqual([]);
    expect(sample.omitted).toBe(0);
  });

  it('carries the side the distiller recorded, and omits the field on a store that has none', () => {
    // R110. Without it a consolidator reading a dump cannot tell a correction from a success — the
    // `kind` of both is whatever the model chose to write — and the lane has to refuse rather than
    // treat the whole store as successes. The absent case is a record written before the field
    // existed, and it must stay absent rather than acquire a default.
    const sample = storeItemSample([item({ polarity: 'repair' }), item({ id: 'k2' })]);
    expect(sample.items[0]?.polarity).toBe('repair');
    expect(Object.hasOwn(sample.items[1] ?? {}, 'polarity')).toBe(false);
  });
});
