/**
 * The redundancy census, tested on the four shapes a lexical key can get wrong.
 *
 * The instrument exists because "this store is repetitive" has never been a number on this record, and
 * because R120 found that the pass which would remove the repetition is gated to a unit this lane does not
 * run. The fixtures below are pairs from R119's own store — a true repeat at 1.00 with a synonym swapped,
 * and the closest non-repeat — so a threshold change that broke the reading would be visible here rather
 * than in an artefact.
 */
import { describe, expect, it } from 'vitest';
import { REDUNDANCY_FLOOR, redundancyLine, redundancyOfSample, storeRedundancy } from '../store-redundancy.js';

const RETURN_CARRIES =
  'Return actions for delivered items carry the order_id, the specific item_ids being returned, and a payment_method_id.';
const RETURN_CARRIES_SHORT =
  'Each return action carries the order_id, the item_ids being returned, and a payment_method_id.';
const CANCEL_REASON =
  'A cancellation action carries a reason argument drawn from the user’s stated justification.';
/** Two claims a reader calls one, which this key keeps apart at 0.571 — below R58's floor. */
const ADDRESS_CHANGE =
  'When a request combines an address change with an item change on the same pending order, each change is issued as its own action call.';
const ADDRESS_CORRECTION =
  'When a request combines an address correction with an item change, the corrections are issued as separate action calls, one per change.';

describe('the distinct claims in a store', () => {
  it('counts one claim for two statements that differ by a synonym', () => {
    // R119 wrote both of these from two different corrections of one routine. Containment is 0.750: the
    // shorter claim restates three quarters of the longer one's content terms, which is what "the same
    // claim, spelled differently" looks like to the consolidator's key.
    const census = storeRedundancy([RETURN_CARRIES, RETURN_CARRIES_SHORT]);
    expect(census.statements).toBe(2);
    expect(census.pairs).toBe(1);
    expect(census.joined).toBe(1);
    expect(census.groups).toBe(1);
    expect(census.redundancy).toBe(0.5);
    expect(census.largest).toBe(2);
  });

  it('counts two claims for two statements that share a subject and nothing else', () => {
    const census = storeRedundancy([RETURN_CARRIES, CANCEL_REASON]);
    expect(census.joined).toBe(0);
    expect(census.groups).toBe(2);
    expect(census.redundancy).toBe(0);
    expect(census.largest).toBe(1);
  });

  it('keeps apart two claims a reader would call one, because the key is lexical and says so', () => {
    // The honest limitation, asserted rather than footnoted: these two sentences are one instruction and
    // this key puts them at 0.571, under R58's 0.60 floor, so the census counts two claims where a reader
    // counts one — and the redundancy it reports is therefore a **lower** bound on human judgement and an
    // upper bound on what a clipped sample can show. Both bounds are stated in the line.
    const census = storeRedundancy([ADDRESS_CHANGE, ADDRESS_CORRECTION]);
    expect(census.joined).toBe(0);
    expect(census.groups).toBe(2);
  });

  it('closes transitively, because the question is how many claims there are', () => {
    // A chain is the case a greedy pass and a closure disagree about, and the disagreement is the point:
    // `A ~ B` and `B ~ C` with `A !~ C` is one claim by the store's own definition of one claim, whatever
    // order an ordered pass happens to visit them in. The census reports the bound; the pass reports what
    // it reached.
    const a = 'Exchange actions carry the payment_method_id the user named as preferred for the refund.';
    const b = 'Exchange actions carry the payment_method_id the user named as preferred.';
    const c = 'Exchange actions carry the payment_method_id named as preferred.';
    const census = storeRedundancy([a, b, c]);
    expect(census.groups).toBe(1);
    expect(census.largest).toBe(3);
    expect(census.joined).toBe(3);
  });

  it('answers for an empty and a single-statement store rather than reporting an absence', () => {
    // A store of one item is a store with exactly one claim and no repetition. `undefined` here would make
    // it indistinguishable from a store nobody measured, which is the distinction this module's parent
    // defects were made of.
    expect(storeRedundancy([])).toMatchObject({ statements: 0, pairs: 0, groups: 0, redundancy: 0, largest: 0 });
    expect(storeRedundancy([RETURN_CARRIES])).toMatchObject({ statements: 1, pairs: 0, groups: 1, redundancy: 0 });
  });

  it('refuses a floor outside (0, 1], because a containment floor is a share', () => {
    expect(() => storeRedundancy([RETURN_CARRIES], { floor: 0 })).toThrow(/not a containment floor/);
    expect(() => storeRedundancy([RETURN_CARRIES], { floor: 1.2 })).toThrow(/not a containment floor/);
    // The default is the floor R58 measured, and it travels in the census so a reading names its own key.
    expect(storeRedundancy([RETURN_CARRIES]).floor).toBe(REDUNDANCY_FLOOR);
  });
});

describe('the census a sample supports', () => {
  it('carries the sample\'s own clipping into the reading instead of requiring the caller to remember', () => {
    // A projection that cut one statement cannot vouch for the number it produces, and a caller that had to
    // pass that along by hand would eventually forget. The sample already knows.
    const clipped = redundancyOfSample({
      items: [{ statement: RETURN_CARRIES }, { statement: RETURN_CARRIES_SHORT }],
      truncated: 2,
    });
    expect(clipped.truncated).toBe(2);
    expect(redundancyLine(clipped)).toContain('so this is an upper bound');
    const whole = redundancyOfSample({
      items: [{ statement: RETURN_CARRIES }, { statement: RETURN_CARRIES_SHORT }],
      truncated: 0,
    });
    expect(whole.groups).toBe(1);
    expect(redundancyLine(whole)).not.toContain('clipped');
  });
});

describe('the line a readback prints', () => {
  it('states the population, the answer, and the key', () => {
    expect(redundancyLine(storeRedundancy([RETURN_CARRIES, RETURN_CARRIES_SHORT, CANCEL_REASON]))).toBe(
      'redundancy: 3 statement(s), 2 distinct claim(s) (33.3% restated), largest 2, 1 of 3 pair(s) at or above 0.60',
    );
  });

  it('says when the sample was clipped, because clipping inflates the reading', () => {
    // Two claims cut at the same prefix share that prefix, so containment rises and redundancy rises with
    // it. A number that is only an upper bound must not be printed as though it were a measurement.
    const census = storeRedundancy([{ statement: RETURN_CARRIES, clipped: true }, RETURN_CARRIES_SHORT]);
    expect(census.truncated).toBe(1);
    expect(redundancyLine(census)).toContain('1 input(s) were clipped, so this is an upper bound');
    // An unclipped census carries no such sentence, so the two cannot be confused.
    expect(redundancyLine(storeRedundancy([RETURN_CARRIES, RETURN_CARRIES_SHORT]))).not.toContain('clipped');
  });
});

/**
 * R139 — the split between the joins a keyed pass can reach and the ones it cannot.
 *
 * R137's store is the case: 43 distinct claims over 64 statements, and the recurrence pass merged one
 * of them. Neither number was wrong. The pass compares only within a key, and 34 of the 35 joins are
 * filed under different keys, so the census could report the store's redundancy and the pass's
 * inactivity in one artefact without either being legible as a defect.
 */
describe('the joins a keyed pass could reach', () => {
  it('counts a join inside one key and a join across two', () => {
    const census = storeRedundancy([
      { statement: RETURN_CARRIES, key: 'return_delivered_order_items' },
      { statement: RETURN_CARRIES_SHORT, key: 'return_delivered_order_items' },
      { statement: RETURN_CARRIES_SHORT, key: 'cancel_pending_order' },
    ]);
    // Two statements of one claim, then a third that repeats the shorter one under another routine.
    expect(census.joined).toBe(3);
    expect(census.joinedWithinKey).toBe(1);
    expect(census.joinedAcrossKey).toBe(2);
    expect(census.groups).toBe(1);
  });

  it('counts a half-keyed pair by neither counter and still merges it', () => {
    // The regression this case exists for: an early version skipped the union for a pair with a key on
    // one side only, and the census reported three distinct claims over three statements while its own
    // `joined` said 1 — the two numbers would have travelled together and contradicted each other.
    const census = storeRedundancy([
      { statement: RETURN_CARRIES, key: 'return_delivered_order_items' },
      { statement: RETURN_CARRIES_SHORT },
    ]);
    expect(census.joined).toBe(1);
    expect(census.joinedWithinKey).toBe(0);
    expect(census.joinedAcrossKey).toBe(0);
    expect(census.groups).toBe(1);
  });

  it('says nothing about keys when no join carried two of them', () => {
    // Silence rather than "0 of 0": a census over rows that carry no key has not asked the question,
    // and a sentence saying every join is within its key would be an answer it did not have.
    const line = redundancyLine(storeRedundancy([RETURN_CARRIES, RETURN_CARRIES_SHORT]));
    expect(line).not.toContain('filed under different keys');
  });

  it('states the cross-key share on the line when it can, because that is the number a dispatch buys', () => {
    const line = redundancyLine(
      storeRedundancy([
        { statement: RETURN_CARRIES, key: 'a' },
        { statement: RETURN_CARRIES_SHORT, key: 'b' },
      ]),
    );
    expect(line).toContain('1 of the 1 joined pair(s) that carry a key on both sides');
    expect(line).toContain('which a keyed pass cannot reach');
  });

  it('carries the keys through a sample, which is the shape the projection has', () => {
    const census = redundancyOfSample({
      items: [
        { statement: RETURN_CARRIES, key: 'a' },
        { statement: RETURN_CARRIES_SHORT, key: 'b' },
      ],
      truncated: 0,
    });
    expect(census.joinedAcrossKey).toBe(1);
    expect(census.joinedWithinKey).toBe(0);
  });
});
