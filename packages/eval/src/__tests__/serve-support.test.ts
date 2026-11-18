import { describe, expect, it } from 'vitest';
import { serveSupportCensus, serveSupportLine, supportMapOf } from '../serve-support.js';

/**
 * R141 — was the floor in force at the moment the pack was served?
 *
 * The registration's own criterion is a join between two populations that live in different files: the
 * attribution table says which item was served and what it did, and the store sample says how many tasks
 * stand behind it. Neither alone can say whether the items that hurt were the singletons, which is the whole
 * premise of a serve-time floor — so the census exists as a pure function with a decided verdict rather than
 * as arithmetic typed into a readback.
 */
const item = (id: string, kept: number, broke: number) => ({ id, episodes: kept + broke, kept, broke, net: kept - broke });

const support = (entries: Record<string, number>) => new Map(Object.entries(entries));

describe('the served population by the support behind it', () => {
  it('groups the served items by their support and sums what each bucket did', () => {
    const census = serveSupportCensus({
      items: [item('a', 0, 1), item('b', 0, 1), item('c', 1, 1), item('d', 1, 0), item('e', 2, 0)],
      support: support({ a: 1, b: 1, c: 1, d: 2, e: 3 }),
      servable: 9,
      floor: 1,
    });
    expect(census.served).toBe(5);
    expect(census.buckets).toEqual([
      { support: 1, items: 3, kept: 1, broke: 3, net: -2 },
      { support: 2, items: 1, kept: 1, broke: 0, net: 1 },
      { support: 3, items: 1, kept: 2, broke: 0, net: 2 },
    ]);
  });

  it('reads an item a complete sample does not carry as one task, which is what the store would write', () => {
    // Complete sample, so absence is a fact about the store: the store writes one task per correction, and the
    // conservative reading is the one the floor would act on. A truncated sample is the other case, and it is
    // the one R141 landed in.
    const census = serveSupportCensus({
      items: [item('a', 1, 0), item('sampled-out', 0, 1)],
      support: support({ a: 2 }),
      servable: 3,
      floor: 1,
    });
    expect(census.buckets.find((bucket) => bucket.support === 1)?.items).toBe(1);
    expect(census.served).toBe(2);
  });

  it('reads a merged member through its group, because the group is where its support lives', () => {
    // R141's shape: the sample holds 64 of 83 records, six of the fourteen served ids are outside it, and every
    // one of the six is a member of a group whose support is two or three. Joining on the id alone loses
    // exactly the records that were corroborated enough to merge — the population a floor of two exists to keep.
    const map = supportMapOf(
      { items: [{ id: 'kept', supportTasks: 1 }], omitted: 19 },
      [{ ids: ['merged-a', 'merged-b'], supportTasks: 2 }, { ids: ['merged-c'], supportTasks: 3 }],
    );
    expect(map?.get('kept')).toBe(1);
    expect(map?.get('merged-b')).toBe(2);
    expect(map?.get('merged-c')).toBe(3);
  });

  it('grades a merged member at the support its group carries, instead of failing the floor it satisfied', () => {
    const map = supportMapOf(
      { items: [{ id: 'a', supportTasks: 1 }], omitted: 19 },
      [{ ids: ['a', 'b'], supportTasks: 2 }],
    );
    const census = serveSupportCensus({
      items: [item('a', 2, 0), item('b', 0, 1)],
      support: map ?? new Map(),
      servable: 14,
      floor: 2,
      truncated: true,
    });
    expect(census.belowFloor).toBe(0);
    expect(census.corroborated).toBe(2);
    expect(census.unresolved).toBe(0);
    expect(serveSupportLine(census)).toContain('no served item carries support below it');
  });

  it('refuses to grade an id a truncated sample does not carry and no group names', () => {
    // The census cannot say what support it carried, and the one thing it may not do is say one: R141's sample
    // was 64 of 83, and reading absence as a singleton turned a satisfied criterion into a failed one.
    const census = serveSupportCensus({
      items: [item('a', 2, 0), item('outside', 0, 1)],
      support: support({ a: 2 }),
      servable: 3,
      floor: 2,
      truncated: true,
    });
    expect(census.unresolved).toBe(1);
    expect(census.belowFloor).toBe(0);
    expect(census.buckets).toEqual([{ support: 2, items: 1, kept: 2, broke: 0, net: 2 }]);
    expect(serveSupportLine(census)).toContain(
      '1 served item(s) fall outside the sample and no group names them',
    );
  });

  it('says nothing about ungraded items on a census that resolved every one of them', () => {
    const census = serveSupportCensus({
      items: [item('a', 1, 0)],
      support: support({ a: 1 }),
      floor: 1,
    });
    expect(census.unresolved).toBe(0);
    expect(serveSupportLine(census)).not.toContain('fall outside the sample');
  });

  it('leaves the counterfactual to the singleton bucket, and counts nothing below a floor of one', () => {
    const census = serveSupportCensus({
      items: [item('a', 0, 1), item('b', 0, 1), item('c', 1, 0)],
      support: support({ a: 1, b: 1, c: 2 }),
      servable: 10,
      floor: 1,
    });
    // Floor absent is floor one, and nothing can be below it: the counterfactual is what a floor of two
    // *would* do to this population, which is the singleton bucket and not a field of its own.
    expect(census.corroborated).toBe(1);
    expect(census.belowFloor).toBe(0);
    const line = serveSupportLine(census);
    expect(line).toContain('a floor of 2 would have retired 2 of the 3');
  });

  it('measures the floor instead of predicting it when the arm ran one', () => {
    const census = serveSupportCensus({
      items: [item('a', 1, 0), item('c', 1, 0)],
      support: support({ a: 1, c: 3 }),
      servable: 4,
      floor: 2,
    });
    expect(census.corroborated).toBe(1);
    expect(census.belowFloor).toBe(1);
    // A floor that ran and let a singleton through is a finding, so the prediction is not offered beside it.
    expect(serveSupportLine(census)).not.toContain('would have retired');
  });
});

describe('the sample the support is read from', () => {
  it('reads the count each row carries, and one task for a row that states none', () => {
    const map = supportMapOf({ items: [{ id: 'a', supportTasks: 3 }, { id: 'b' }] });
    expect(map?.get('a')).toBe(3);
    expect(map?.get('b')).toBe(1);
  });

  it('is absent, not empty, when the artefact carries no sample', () => {
    // An artefact written before the sample existed cannot support a statement about support, and an empty
    // map would make every served item a singleton — a finding invented from an absence.
    expect(supportMapOf(undefined)).toBeUndefined();
    expect(supportMapOf({})).toBeUndefined();
    expect(supportMapOf({ items: [] })?.size).toBe(0);
  });

  it('says it cannot be read rather than printing a table over an absent sample', () => {
    expect(serveSupportLine(undefined)).toBe(
      'serve support: the artefact carries no store sample, so the support behind a served item cannot be read',
    );
  });
});

describe('the line a readback quotes', () => {
  it('says nothing was served rather than printing a table of zeroes', () => {
    const line = serveSupportLine(
      serveSupportCensus({ items: [], support: support({}), servable: 5, floor: 2 }),
    );
    expect(line).toBe('serve support: no item was served, so no support can be read');
  });

  it('says a floor would have retired nothing when the pack served only consensus and ran no floor', () => {
    // The arm R141 hopes to produce, read as a control: every served item corroborated, no floor in force,
    // and the counterfactual therefore zero rather than absent. A line that printed `null` here would be
    // the instrument confusing "nothing to retire" with "nothing counted".
    const line = serveSupportLine(
      serveSupportCensus({
        items: [item('c', 1, 0), item('d', 0, 1)],
        support: support({ c: 2, d: 3 }),
        servable: 11,
        floor: 1,
      }),
    );
    expect(line).toContain('no singleton was served');
    expect(line).toContain('support ≥2: 2 item(s), 1 broke, 1 kept, net +0');
    expect(line).toContain('a floor of 2 would have retired 0 of the 2');
  });

  it('omits the denominator rather than printing one over an absent census', () => {
    // An artefact from before the store census carries no servable count, and `21 of 0` is a rate above one:
    // the reader would take it for a miscounted denominator rather than for a field the run never wrote.
    const census = serveSupportCensus({
      items: [item('a', 1, 0)],
      support: support({ a: 1 }),
      floor: 1,
    });
    const line = serveSupportLine(census);
    expect(line).toContain('serve support: 1 item(s) served;');
    expect(line).not.toContain('of 0');
    // The key is absent and not merely `undefined`: `exactOptionalPropertyTypes` is on, and an artefact
    // that writes the key with no number is an artefact that answered the question badly.
    expect('servable' in census).toBe(false);
  });

  it('names the buckets, the harm and the counterfactual on one line', () => {
    const line = serveSupportLine(
      serveSupportCensus({
        items: [item('a', 0, 1), item('b', 0, 1), item('c', 1, 0), item('d', 2, 0)],
        support: support({ a: 1, b: 1, c: 2, d: 3 }),
        servable: 9,
        floor: 1,
      }),
    );
    expect(line).toContain('4 of 9 servable item(s) served');
    expect(line).toContain('support 1: 2 item(s), 2 broke, 0 kept, net -2');
    expect(line).toContain('support ≥2: 2 item(s), 0 broke, 3 kept, net +3');
    expect(line).toContain('floor absent, so a floor of 2 would have retired 2 of the 4');
  });

  it('grades the arm when a floor ran: served items below it are a carriage defect', () => {
    const line = serveSupportLine(
      serveSupportCensus({
        items: [item('a', 1, 0), item('c', 1, 0)],
        support: support({ a: 1, c: 3 }),
        servable: 4,
        floor: 2,
      }),
    );
    expect(line).toContain('floor 2 in force');
    expect(line).toContain('1 of the 2 served item(s) carry support below it');
  });

  it('says nothing was corroborated when every served item was a singleton', () => {
    // R139's own arm, in one line: nineteen of twenty-one served items with one task behind them. The
    // sentence has to be "none corroborated" rather than an empty bucket, because that is what a floor of
    // two is being bought for.
    const line = serveSupportLine(
      serveSupportCensus({
        items: [item('a', 0, 1), item('b', 1, 0)],
        support: support({ a: 1, b: 1 }),
        servable: 55,
        floor: 1,
      }),
    );
    expect(line).toContain('none corroborated');
    expect(line).toContain('a floor of 2 would have retired 2 of the 2');
  });

  it('says no singleton was served when the pack only ever served consensus', () => {
    // The interesting arm: a floor high enough that nothing below it is in the store at all. The line has
    // to say that rather than print `support 1: 0 item(s)`, which reads as a bucket that was measured.
    const line = serveSupportLine(
      serveSupportCensus({
        items: [item('c', 1, 0), item('d', 1, 1)],
        support: support({ c: 2, d: 4 }),
        servable: 2,
        floor: 2,
      }),
    );
    expect(line).toContain('no singleton was served');
    expect(line).toContain('support ≥2: 2 item(s), 1 broke, 2 kept, net +1');
  });

  it('says the floor held when nothing below it was served', () => {
    const line = serveSupportLine(
      serveSupportCensus({
        items: [item('c', 1, 0)],
        support: support({ c: 3 }),
        servable: 2,
        floor: 2,
      }),
    );
    expect(line).toContain('no served item carries support below it');
  });
});
