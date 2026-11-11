import { describe, expect, it } from 'vitest';
import {
  drawSpread,
  inertReading,
  liveShareBuckets,
  normaliseSql,
  parseSilencePlan,
  silenceReading,
  silenceTargets,
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

  it('counts a rule that was never drawn in the zero bucket rather than dividing by its draws', () => {
    // `inertReading` never emits a rule with zero draws, but the function is exported and a caller
    // holding rows from anywhere else would otherwise get NaN for a share and lose the rule from the
    // distribution it is supposed to cover.
    const buckets = liveShareBuckets([{ rule: 'never', draws: 0, live: 0 }]);
    expect(buckets[0]?.rules).toBe(1);
    expect(buckets.reduce((sum, bucket) => sum + bucket.rules, 0)).toBe(1);
  });

  it('treats a caller that supplies no edges at all as having none to distribute over', () => {
    expect(liveShareBuckets([{ rule: 'a', draws: 1, live: 1 }], [])).toEqual([]);
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

describe('silenceTargets', () => {
  const rule = (name: string, draws: number, live: number): RuleInertness => ({ rule: name, draws, live });

  it('asks for the draws each silent rule is short of the resolving count, and nothing more', () => {
    const targets = silenceTargets([rule('a', 4, 2), rule('short', 1, 0), rule('near', 4, 0)], { draws: 5 });
    expect(targets).toEqual([
      { rule: 'short', draws: 1, need: 4 },
      { rule: 'near', draws: 4, need: 1 },
    ]);
  });

  it('drops a rule that already holds enough draws to be called dead', () => {
    // The eight rules of R77's pack that already hold five draws are evidence, and spending a call to
    // give them a sixth would be spending it on a settled question.
    expect(silenceTargets([rule('settled', 9, 0), rule('a', 4, 2)], { draws: 5 })).toEqual([]);
  });

  it('never asks for a draw when no rule ever fired, because no number of them resolves anything', () => {
    expect(silenceTargets([rule('dead', 1, 0), rule('also', 2, 0)], { draws: 5 })).toEqual([]);
  });

  it('orders by need, then by name, so two runs of the same file plan the same draws', () => {
    const targets = silenceTargets(
      [rule('b', 3, 0), rule('a', 3, 0), rule('c', 1, 0), rule('live', 4, 1)],
      { draws: 5 },
    );
    expect(targets.map((row) => row.rule)).toEqual(['c', 'a', 'b']);
    // c is four draws short and a and b are two each, so the plan is eight calls and not the thirteen a
    // count of silent rules would suggest.
    expect(targets.reduce((sum, row) => sum + row.need, 0)).toBe(8);
  });

  it('caps the plan at whole rules, because half a rule is not a purchase', () => {
    const rules = [rule('live', 2, 1), rule('a', 1, 0), rule('b', 1, 0), rule('c', 1, 0)];
    // Each silent rule is four draws short: eight calls buy two of them, seven buy one, and a cap is a
    // budget rather than an instruction to overspend it.
    expect(silenceTargets(rules, { draws: 5, cap: 8 })).toHaveLength(2);
    expect(silenceTargets(rules, { draws: 5, cap: 7 })).toEqual([{ rule: 'a', draws: 1, need: 4 }]);
    expect(silenceTargets(rules, { draws: 5, cap: 0 })).toEqual([]);
  });
});

describe('parseSilencePlan', () => {
  const plan = (targets: unknown, draws: unknown = 5): string =>
    JSON.stringify({ source: 'x.json', draws, targets });

  it('reads the plan the tool wrote', () => {
    const parsed = parseSilencePlan(plan([{ rule: 'a', draws: 1, need: 4 }]), 'p.json');
    expect(parsed.draws).toBe(5);
    expect(parsed.targets).toEqual([{ rule: 'a', draws: 1, need: 4 }]);
  });

  it('refuses text that is not JSON, and says which file it came from', () => {
    expect(() => parseSilencePlan('not json at all', 'p.json')).toThrow(/p\.json: not JSON/);
  });

  it('refuses a file that is not a plan rather than reading an empty one', () => {
    // An empty plan and a plan that failed to parse are the same thing to a lane that shrugs at both,
    // and the second is a dispatch that spends its calls on the wrong rules without saying so.
    expect(() => parseSilencePlan('[]', 'p.json')).toThrow(/targets/);
    expect(() => parseSilencePlan('{"targets": 3}', 'p.json')).toThrow(/targets/);
  });

  it('refuses an entry with no rule or a need of zero', () => {
    expect(() => parseSilencePlan(plan([{ rule: '', draws: 1, need: 4 }]), 'p.json')).toThrow(/rule/);
    expect(() => parseSilencePlan(plan([{ rule: 'a', draws: 1, need: 0 }]), 'p.json')).toThrow(/need/);
  });

  it('refuses a plan that names the same rule twice', () => {
    const twice = plan([{ rule: 'a', draws: 1, need: 4 }, { rule: 'a', draws: 1, need: 2 }]);
    expect(() => parseSilencePlan(twice, 'p.json')).toThrow(/twice/);
  });

  it('refuses a draws count that is not a positive integer', () => {
    expect(() => parseSilencePlan(plan([], 0), 'p.json')).toThrow(/draws/);
    expect(() => parseSilencePlan(plan([], 2.5), 'p.json')).toThrow(/draws/);
  });

  it('accepts an empty list, which is a plan to buy nothing', () => {
    expect(parseSilencePlan(plan([]), 'p.json').targets).toEqual([]);
  });

  it('refuses a target that is not an object at all', () => {
    expect(() => parseSilencePlan(plan([null]), 'p.json')).toThrow(/not an object/);
  });

  it('reads a target that does not say how many draws it has as having none', () => {
    // The field is provenance rather than plan: what a dispatch buys is `need`, and a file written
    // before `draws` existed is still a usable plan.
    expect(parseSilencePlan(plan([{ rule: 'a', need: 4 }]), 'p.json').targets).toEqual([
      { rule: 'a', draws: 0, need: 4 },
    ]);
  });
});
