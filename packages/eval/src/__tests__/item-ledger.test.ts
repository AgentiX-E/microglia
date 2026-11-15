import { describe, expect, it } from 'vitest';
import { itemLedgerLine, itemLedgerOf } from '../item-ledger.js';

const rewardsOf = (...pairs: readonly (readonly [string, number])[]) => new Map(pairs);

describe('an item, priced over the requests it was served on', () => {
  it('counts the cases an item was served on and refuses a row count that disagrees', () => {
    // The join is by order, and order is the one thing this lane has published wrongly before: a ledger
    // joined to the wrong episode does not fail, it reports a number. Three requests, two tasks is a refusal.
    expect(() =>
      itemLedgerOf({ packs: [['a'], ['b']], tasks: ['t1'], rewards: rewardsOf(['t1', 1]) }),
    ).toThrow(RangeError);
    expect(() =>
      itemLedgerOf({ packs: [['a'], ['b']], tasks: ['t1'], rewards: rewardsOf(['t1', 1]) }),
    ).toThrow('a ledger joined to the wrong episode reports a number');
  });

  it('counts each request once even when the pack repeats an id', () => {
    // A pack that lists the same id twice would otherwise double the item's exposure and its net, which is
    // how an item reaches a threshold it never earned.
    const rows = itemLedgerOf({
      packs: [['a', 'a'], ['a']],
      tasks: ['t1', 't2'],
      rewards: rewardsOf(['t1', 1], ['t2', 0]),
    });
    expect(rows).toEqual([{ id: 'a', served: 2, passed: 1, failed: 1, net: null }]);
  });

  it('carries cases rather than a net when no baseline was supplied', () => {
    const rows = itemLedgerOf({
      packs: [['a'], ['b'], ['a']],
      tasks: ['t1', 't2', 't3'],
      rewards: rewardsOf(['t1', 1], ['t2', 0], ['t3', 1]),
    });
    expect(rows).toEqual([
      { id: 'a', served: 2, passed: 2, failed: 0, net: null },
      { id: 'b', served: 1, passed: 0, failed: 1, net: null },
    ]);
    // A zero would merge "served on nothing" with "served on two passes", so the absence is a null.
    expect(rows.every((row) => row.net === null)).toBe(true);
  });

  it('signs the net as discordant pairs against a store-off draw', () => {
    // `a` is served on t1 (the baseline failed, the store passed: repaired) and on t2 (both failed: inert), so
    // its net is +1. `b` is served on t3, which the baseline passed and the store failed: broke, so -1. The
    // two items are indistinguishable by pass rate and opposite by net, which is the whole point of the join.
    const rows = itemLedgerOf({
      packs: [['a'], ['a', 'b'], ['b']],
      tasks: ['t1', 't2', 't3'],
      rewards: rewardsOf(['t1', 1], ['t2', 0], ['t3', 0]),
      baseline: rewardsOf(['t1', 0], ['t2', 0], ['t3', 1]),
    });
    expect(rows).toEqual([
      { id: 'b', served: 2, passed: 0, failed: 2, net: -1 },
      { id: 'a', served: 2, passed: 1, failed: 1, net: 1 },
    ]);
  });

  it('leaves a task out when either side has no reward, rather than reading it as a failure', () => {
    // An unscored task is not a failed one. Reading a missing reward as zero would turn every unscored
    // request into a break and put the item on the deletion list for a case nobody measured.
    const rows = itemLedgerOf({
      packs: [['a'], ['a']],
      tasks: ['t1', 't2'],
      rewards: rewardsOf(['t1', 1]),
      baseline: rewardsOf(['t1', 0], ['t2', 1]),
    });
    expect(rows).toEqual([{ id: 'a', served: 1, passed: 1, failed: 0, net: 1 }]);
  });
});

describe('the sentence a store prints about its items', () => {
  it('says nothing was priced, and calls it a reachability reading', () => {
    // An empty ledger has two causes: the store served nothing, or nothing scored. Both are reachability, and
    // both are different from "every item was neutral" — so the sentence names the count it divided by.
    expect(itemLedgerLine([], 73, 0)).toContain('none of the 73 item(s) in the store was served on a scored request');
    expect(itemLedgerLine([], 73, 0)).toContain('this is a reachability reading, not an item one');
  });

  it('separates the negative items from the positive ones and quotes the bound as a bound', () => {
    const line = itemLedgerLine(
      [
        { id: 'b', served: 2, passed: 0, failed: 2, net: -1 },
        { id: 'c', served: 4, passed: 1, failed: 3, net: -3 },
        { id: 'a', served: 2, passed: 1, failed: 1, net: 1 },
      ],
      9,
      6,
    );
    expect(line).toContain('3 of 9 item(s) served over 8 item-request(s)');
    expect(line).toContain('2 negative summing -4, 1 positive summing +1, 6 never served');
    // The bound is the reading. A pack that serves four ids counts one break against four items, so the sum
    // over the negative items is an upper bound on a deletion arm and never a prediction of one.
    expect(line).toContain('recovers at most +4 case(s)');
    expect(line).toContain('6 served request(s) carried more than one item');
    expect(line).toContain('this is an upper bound on a deletion arm, not a prediction of one');
  });

  it('prints the case counts when the arm bought no baseline', () => {
    const line = itemLedgerLine(
      [{ id: 'a', served: 2, passed: 2, failed: 0, net: null }],
      1,
      0,
    );
    expect(line).toContain('1 of 1 item(s) served over 2 item-request(s) and 0 never served');
    expect(line).toContain('no baseline, so each row carries its cases rather than a net');
  });

  it('drops the caveat when no request carried a second item, because then the sum is exact', () => {
    // R134 served one item a request: 40 item-requests, 40 packs, no sharing. `Σ|net|` over the negative
    // items is then the exact number of cases a deletion recovers -- an item served 3 requests that lost 1
    // is worth exactly that case -- and printing the four-item bound over it would make a reader discount a
    // measurement that needs no discount.
    const line = itemLedgerLine(
      [
        { id: 'b', served: 1, passed: 0, failed: 1, net: -1 },
        { id: 'c', served: 3, passed: 2, failed: 1, net: -1 },
        { id: 'a', served: 1, passed: 1, failed: 0, net: 1 },
      ],
      64,
      0,
    );
    expect(line).toContain('recovers at most +2 case(s)');
    expect(line).toContain('no served request carried a second item');
    expect(line).toContain('the sum is exact, not a bound');
    expect(line).not.toContain('upper bound');
  });

  it('never reports a negative remainder when the store holds fewer items than the ledger saw', () => {
    // The store census and the ledger are written by different code, and a folded store can list fewer items
    // than the packs named. `-3 never served` would be the arithmetic showing through.
    expect(itemLedgerLine([{ id: 'a', served: 1, passed: 1, failed: 0, net: 0 }], 0, 0)).toContain(
      '0 never served',
    );
  });
});
