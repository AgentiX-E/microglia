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
});
