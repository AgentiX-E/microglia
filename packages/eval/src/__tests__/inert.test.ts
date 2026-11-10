import { describe, expect, it } from 'vitest';
import {
  drawSpread,
  inertReading,
  liveShareBuckets,
  normaliseSql,
  type InertPair,
} from '../inert.js';

const pair = (over: Partial<InertPair> = {}): InertPair => ({
  id: 'q1',
  rule: 'k_rule',
  full: 'SELECT 1',
  without: 'SELECT 2',
  ...over,
});

describe('normaliseSql', () => {
  it('collapses whitespace, because spacing cannot change what a query asks', () => {
    expect(normaliseSql('SELECT   a,\n  b\nFROM  t')).toBe('SELECT a, b FROM t');
  });

  it('drops one trailing semicolon', () => {
    expect(normaliseSql('SELECT 1;')).toBe('SELECT 1');
  });

  it('keeps case, because folding it is a decision the reading reports instead of hiding', () => {
    expect(normaliseSql('select 1')).toBe('select 1');
  });
});

describe('inertReading', () => {
  it('counts a pair as live when the two statements differ at all', () => {
    const reading = inertReading([pair()]);
    expect(reading.pairs).toBe(1);
    expect(reading.live).toBe(1);
    expect(reading.inert).toBe(0);
    expect(reading.inertShare).toBe(0);
  });

  it('counts a pair as inert when they differ only by whitespace', () => {
    const reading = inertReading([pair({ without: 'SELECT   1\n' })]);
    expect(reading.inert).toBe(1);
    expect(reading.inertShare).toBe(1);
  });

  it('counts a pair as live when they differ only by case, and reports how many did', () => {
    // `select 1` and `SELECT 1` are one query to SQLite. Counting them as different answers would
    // report less inertness than there is, so the main reading calls them live and this count says how
    // much of the liveness is that.
    const reading = inertReading([pair({ without: 'select 1' })]);
    expect(reading.live).toBe(1);
    expect(reading.caseOnly).toBe(1);
  });

  it('does not count a statement that failed to parse as an inert answer', () => {
    // A rule that breaks the query is not a rule that did nothing. Calling the pair inert on the
    // evidence of a call that returned no query would report a pack as harmless because it is
    // destructive.
    const reading = inertReading([
      pair({ without: '' }),
      pair({ id: 'q2', full: '   ' }),
      pair({ id: 'q3', without: 'SELECT 2' }),
    ]);
    expect(reading.pairs).toBe(1);
    expect(reading.unmeasured).toBe(2);
  });

  it('ignores a question with nothing withheld, which says nothing about any rule', () => {
    const reading = inertReading([pair({ rule: null }), pair()]);
    expect(reading.unwithheld).toBe(1);
    expect(reading.pairs).toBe(1);
  });

  it('counts per rule over the draws that rule got, not over the population', () => {
    const reading = inertReading([
      pair({ id: 'a', rule: 'always', without: 'SELECT 9' }),
      pair({ id: 'b', rule: 'never', without: 'SELECT 1' }),
      pair({ id: 'c', rule: 'never', without: 'SELECT 1' }),
      pair({ id: 'd', rule: 'half', without: 'SELECT 1' }),
      pair({ id: 'e', rule: 'half', without: 'SELECT 5' }),
    ]);
    // Draws descending, then name, so two readings of one file cannot disagree about the order.
    expect(reading.rules).toEqual([
      { rule: 'half', draws: 2, live: 1 },
      { rule: 'never', draws: 2, live: 0 },
      { rule: 'always', draws: 1, live: 1 },
    ]);
    expect(reading.whollyInert).toBe(1);
  });

  it('reports the share of live answers the busiest tenth of the rules produced', () => {
    // Ten rules, one of which is live on every draw and produces all of the liveness. A pack whose
    // work is done by one rule is a different instrument from one where it is spread, and the delta
    // is the same either way.
    const pairs: InertPair[] = [];
    for (let index = 0; index < 10; index += 1) {
      const rule = `r${String(index)}`;
      pairs.push(pair({ id: `${rule}-a`, rule, without: index === 0 ? 'SELECT 7' : 'SELECT 1' }));
    }
    const reading = inertReading(pairs);
    expect(reading.live).toBe(1);
    expect(reading.liveConcentration).toBe(1);
  });

  it('reports zero concentration when nothing is live, rather than dividing by nothing', () => {
    const reading = inertReading([pair({ without: 'SELECT 1' })]);
    expect(reading.liveConcentration).toBe(0);
  });

  it('survives an empty population', () => {
    const reading = inertReading([]);
    expect(reading).toMatchObject({ pairs: 0, live: 0, inert: 0, inertShare: 0, whollyInert: 0 });
  });
});

describe('liveShareBuckets', () => {
  it('covers every rule, including the ones that changed every answer', () => {
    const rules = [
      { rule: 'a', draws: 4, live: 0 },
      { rule: 'b', draws: 4, live: 1 },
      { rule: 'c', draws: 4, live: 2 },
      { rule: 'd', draws: 4, live: 4 },
    ];
    const buckets = liveShareBuckets(rules);
    expect(buckets.reduce((sum, bucket) => sum + bucket.rules, 0)).toBe(rules.length);
    // 0% exactly is the first bucket; 100% is the last one, which is closed on both sides — and the
    // 0.75–1 band that excludes it is empty, so the closed edge is the only place a full-live rule can
    // land.
    expect(buckets.map((bucket) => bucket.rules)).toEqual([1, 0, 1, 1, 1]);
  });

  it('reports an empty distribution as zeros rather than as no buckets', () => {
    const buckets = liveShareBuckets([]);
    expect(buckets).toHaveLength(5);
    expect(buckets.every((bucket) => bucket.rules === 0)).toBe(true);
  });
});

describe('drawSpread', () => {
  it('reports the median and the tail, which bound a per-rule claim', () => {
    const rules = [
      { rule: 'a', draws: 1, live: 0 },
      { rule: 'b', draws: 2, live: 0 },
      { rule: 'c', draws: 3, live: 0 },
      { rule: 'd', draws: 40, live: 0 },
    ];
    expect(drawSpread(rules)).toEqual({ rules: 4, median: 2, p90: 40, max: 40 });
  });

  it('survives a pack no rule was ever withheld from', () => {
    expect(drawSpread([])).toEqual({ rules: 0, median: 0, p90: 0, max: 0 });
  });
});
