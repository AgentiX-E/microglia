import { describe, expect, it } from 'vitest';
import {
  drawSpread,
  inertReading,
  liveShareBuckets,
  normaliseSql,
  silenceReading,
  type InertPair,
  type RuleInertness,
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

describe('silenceReading', () => {
  const rule = (name: string, draws: number, live: number): RuleInertness => ({ rule: name, draws, live });

  it('prices silence against the rate the rules that did fire demonstrated', () => {
    // One rule live on half its draws and one silent on three: a working rule is silent three times in
    // a row with probability 0.5³, so the silence costs 0.125 of a rule and the excess is 0.875.
    const reading = silenceReading([rule('a', 4, 2), rule('b', 3, 0)]);
    expect(reading.workingRate).toBe(0.5);
    expect(reading.expectedSilent).toBeCloseTo(0.125, 10);
    expect(reading.silent).toBe(1);
    expect(reading.excess).toBeCloseTo(0.875, 10);
  });

  it('estimates the rate from the rules that fired, not from the dead ones', () => {
    // Nine silent rules with ten draws each would drag a pack-wide rate to 1/92 and make every silence
    // look expected. The rate is 1/2 because that is what the one rule that ever fired demonstrated.
    const rules = [rule('live', 2, 1), ...Array.from({ length: 9 }, (_, i) => rule(`dead${String(i)}`, 10, 0))];
    const reading = silenceReading(rules);
    expect(reading.workingRate).toBe(0.5);
    // Nine rules silent on ten draws at p = 0.5 is 9 × 0.00098 expected, so nearly all of them are
    // excess rather than chance.
    expect(reading.expectedSilent).toBeLessThan(0.01);
    expect(reading.excess).toBeGreaterThan(8.99);
  });

  it('names the draw count at which a rule of the pack rate would be silent by chance less than once in twenty', () => {
    // 0.5⁴ = 6.25% and 0.5⁵ = 3.125%, so five draws is the first count under 5%.
    expect(silenceReading([rule('a', 4, 2), rule('b', 3, 0)]).drawsToResolve).toBe(5);
    expect(silenceReading([rule('a', 4, 4), rule('b', 3, 0)]).drawsToResolve).toBe(1);
  });

  it('refuses to name a draw count when no rule ever fired', () => {
    // With a zero rate the silence is not evidence of chance at any sample size, and a number here
    // would be read as "more draws would settle it" when nothing would.
    const reading = silenceReading([rule('a', 4, 0), rule('b', 3, 0)]);
    expect(reading.workingRate).toBe(0);
    expect(reading.drawsToResolve).toBe(0);
    expect(reading.expectedSilent).toBe(2);
    expect(reading.underPowered).toBe(0);
  });

  it('counts the silent rules that have not yet had enough draws to be called dead', () => {
    const reading = silenceReading([
      rule('short', 3, 0),
      rule('long', 9, 0),
      rule('live', 4, 2),
    ]);
    // 0.5⁹ is under 0.2%, so the long one is evidence at this rate and the short one is not.
    expect(reading.underPowered).toBe(1);
    expect(reading.excess).toBeGreaterThan(0.9);
  });

  it('survives a pack with no rules at all', () => {
    expect(silenceReading([])).toMatchObject({
      silent: 0,
      workingRate: 0,
      expectedSilent: 0,
      excess: 0,
      drawsToResolve: 0,
      underPowered: 0,
    });
  });
});
