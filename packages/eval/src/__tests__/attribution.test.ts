import { describe, expect, it } from 'vitest';
import { attributeRules, byNetAscending, byNetDescending } from '../attribution.js';

describe('per-rule attribution', () => {
  const items = [
    { fold: 0, id: 'r1', statement: 'normal values are negative' },
    { fold: 0, id: 'r2', statement: 'join on the shared id' },
    { fold: 0, id: 'r3', statement: 'never used by anything' },
  ];

  it('credits a rule with the questions that flipped while it was present', () => {
    const summary = attributeRules(
      [
        { fold: 0, injected: ['r1'], baselineCorrect: false, treatmentCorrect: true },
        { fold: 0, injected: ['r1', 'r2'], baselineCorrect: true, treatmentCorrect: false },
        { fold: 0, injected: ['r2'], baselineCorrect: true, treatmentCorrect: true },
      ],
      items,
    );
    const r1 = summary.top.find((rule) => rule.id === 'r1');
    const r2 = summary.top.find((rule) => rule.id === 'r2');
    expect(r1).toMatchObject({ injected: 2, helped: 1, hurt: 1, net: 0 });
    expect(r2).toMatchObject({ injected: 2, helped: 0, hurt: 1, net: -1 });
    expect(summary.injectedRules).toBe(2);
    expect(summary.harmful).toBe(1);
    expect(summary.neutral).toBe(1);
  });

  it('sorts the worst rules first and stops at twenty', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      fold: 0,
      id: `r${i}`,
      statement: `rule ${i}`,
    }));
    const summary = attributeRules(
      many.map((item, index) => ({
        fold: 0,
        injected: [item.id],
        baselineCorrect: index < 10,
        treatmentCorrect: index >= 10,
      })),
      many,
    );
    expect(summary.top).toHaveLength(20);
    expect(summary.top[0]?.net).toBe(-1);
    expect(summary.top.at(-1)?.net).toBe(1);
  });

  it('keeps the same id from two folds apart', () => {
    const summary = attributeRules(
      [{ fold: 1, injected: ['r1'], baselineCorrect: true, treatmentCorrect: false }],
      [
        { fold: 0, id: 'r1', statement: 'fold zero rule' },
        { fold: 1, id: 'r1', statement: 'fold one rule, different text' },
      ],
    );
    const harmed = summary.top.filter((rule) => rule.net === -1);
    expect(harmed).toHaveLength(1);
    expect(harmed[0]?.fold).toBe(1);
    expect(harmed[0]?.statement).toBe('fold one rule, different text');
  });

  it('ignores unknown ids and counts a rule that changed nothing as neutral', () => {
    const summary = attributeRules(
      [
        { fold: 0, injected: ['ghost'], baselineCorrect: false, treatmentCorrect: true },
        { fold: 0, injected: ['r1'], baselineCorrect: true, treatmentCorrect: true },
      ],
      items,
    );
    expect(summary.injectedRules).toBe(1);
    expect(summary.neutral).toBe(1);
    expect(summary.harmfulShare).toBe(0);
    expect(summary.rules).toBe(3);
  });

  it('reports the share of injections that belong to a harmful rule', () => {
    const summary = attributeRules(
      [
        { fold: 0, injected: ['r1'], baselineCorrect: true, treatmentCorrect: false },
        { fold: 0, injected: ['r1', 'r2'], baselineCorrect: true, treatmentCorrect: false },
        { fold: 0, injected: ['r2'], baselineCorrect: false, treatmentCorrect: true },
      ],
      items,
    );
    // r1: net -1 over 2 injections; r2: net 0 over 2 injections.
    expect(summary.harmfulShare).toBeCloseTo(0.5, 6);
  });

  it('reports a zero harmful share when nothing was injected at all', () => {
    // A lane whose pack was empty injected no rule-instances, and dividing by that
    // zero would make the summary NaN — which reads as "no data" in a table and as
    // a crash in a gate.
    const summary = attributeRules(
      [{ fold: 0, injected: [], baselineCorrect: false, treatmentCorrect: true }],
      [{ fold: 0, id: 'k1', statement: 'Use a line chart.' }],
    );
    expect(summary).toMatchObject({ injectedRules: 0, harmfulShare: 0, neutral: 0 });
  });

  it('orders equally-shaped rules by id so two runs report the same table', () => {
    // The tie-break is what makes the table diffable across runs; without it the
    // order follows insertion, which follows the store.
    const summary = attributeRules(
      [
        { fold: 0, injected: ['k2'], baselineCorrect: true, treatmentCorrect: false },
        { fold: 0, injected: ['k1'], baselineCorrect: true, treatmentCorrect: false },
      ],
      [
        { fold: 0, id: 'k2', statement: 'Use a bar chart.' },
        { fold: 0, id: 'k1', statement: 'Use a pie chart.' },
      ],
    );
    expect(summary.top.map((rule) => rule.id)).toEqual(['k1', 'k2']);
  });

  it('publishes the rules that helped as well as the ones that hurt', () => {
    // The artefact used to carry only the worst twenty. A reader given a list of
    // suspects and nothing else concludes the pack is uniformly bad, when what the
    // same table shows is 11 harmful against 5 helpful of 74 injected.
    const summary = attributeRules(
      [
        { fold: 0, injected: ['k_bad'], baselineCorrect: true, treatmentCorrect: false },
        { fold: 0, injected: ['k_good'], baselineCorrect: false, treatmentCorrect: true },
        { fold: 0, injected: ['k_good'], baselineCorrect: false, treatmentCorrect: true },
      ],
      [
        { fold: 0, id: 'k_bad', statement: 'Wrong but plausible.' },
        { fold: 0, id: 'k_good', statement: 'Right and useful.' },
      ],
    );
    expect(summary.top.map((rule) => rule.id)).toEqual(['k_bad', 'k_good']);
    expect(summary.best.map((rule) => rule.id)).toEqual(['k_good']);
    expect(summary.best[0]?.net).toBe(2);
  });

  it('leaves the best list empty when nothing helped', () => {
    const summary = attributeRules(
      [{ fold: 0, injected: ['k_bad'], baselineCorrect: true, treatmentCorrect: false }],
      [{ fold: 0, id: 'k_bad', statement: 'Wrong.' }],
    );
    expect(summary.best).toEqual([]);
  });

  it('orders equally useful rules by id, in both directions', () => {
    // Three rules with the same net and the same count: the only thing left is the
    // id, and a comparator that is only ever called one way is half verified.
    const summary = attributeRules(
      [
        { fold: 0, injected: ['k_m'], baselineCorrect: false, treatmentCorrect: true },
        { fold: 0, injected: ['k_a'], baselineCorrect: false, treatmentCorrect: true },
        { fold: 0, injected: ['k_z'], baselineCorrect: false, treatmentCorrect: true },
      ],
      [
        { fold: 0, id: 'k_m', statement: 'Middle.' },
        { fold: 0, id: 'k_a', statement: 'First.' },
        { fold: 0, id: 'k_z', statement: 'Last.' },
      ],
    );
    expect(summary.best.map((rule) => rule.id)).toEqual(['k_a', 'k_m', 'k_z']);
  });

  it('orders two rules the same way whichever one is handed over first', () => {
    // Called directly, so both directions are checked rather than whatever order
    // Array.prototype.sort happens to use for two elements. A comparator that
    // returns 1 for both (a, b) and (b, a) is not a total order, and a sort given
    // one is free to produce either.
    const rule = (id: string, net: number, injected: number, fold = 0) => ({
      fold,
      id,
      statement: id,
      injected,
      helped: 0,
      hurt: 0,
      net,
    });
    const low = rule('k_a', 1, 1);
    const high = rule('k_b', 3, 1);
    expect(byNetAscending(low, high)).toBeLessThan(0);
    expect(byNetAscending(high, low)).toBeGreaterThan(0);
    expect(byNetDescending(high, low)).toBeLessThan(0);
    expect(byNetDescending(low, high)).toBeGreaterThan(0);
    // Same net, different exposure: the more-seen rule sorts first in both orders.
    const often = rule('k_c', 1, 3);
    const rare = rule('k_d', 1, 2);
    expect(byNetAscending(often, rare)).toBeLessThan(0);
    expect(byNetDescending(often, rare)).toBeLessThan(0);
    // Identical claims in two folds fall back to the fold, so the order is total.
    expect(byNetAscending(rule('k_e', 1, 1, 0), rule('k_e', 1, 1, 1))).toBeLessThan(0);
    expect(byNetAscending(rule('k_e', 1, 1, 1), rule('k_e', 1, 1, 0))).toBeGreaterThan(0);
    // The descending order needs the same two fallbacks, and a test that only
    // exercises the first comparator would leave them unverified behind it.
    expect(byNetDescending(rule('k_f', 1, 1), rule('k_g', 1, 1))).toBeLessThan(0);
    expect(byNetDescending(rule('k_g', 1, 1), rule('k_f', 1, 1))).toBeGreaterThan(0);
    expect(byNetDescending(rule('k_h', 1, 1, 0), rule('k_h', 1, 1, 1))).toBeLessThan(0);
    expect(byNetDescending(rule('k_h', 1, 1, 1), rule('k_h', 1, 1, 0))).toBeGreaterThan(0);
  });

  it('breaks ties on net, then on how often the rule was injected', () => {
    // Three arms of one comparator, and the middle one is easy to miss: two rules
    // that traded the same net over different numbers of appearances are not equal
    // evidence, and the one that was seen more often goes first.
    const summary = attributeRules(
      [
        // k_a: two appearances, both flips up  → net 2, injected 2
        { fold: 0, injected: ['k_a'], baselineCorrect: false, treatmentCorrect: true },
        { fold: 0, injected: ['k_a'], baselineCorrect: false, treatmentCorrect: true },
        // k_b: three appearances, two up and one down → net 1, injected 3
        { fold: 0, injected: ['k_b'], baselineCorrect: false, treatmentCorrect: true },
        { fold: 0, injected: ['k_b'], baselineCorrect: false, treatmentCorrect: true },
        { fold: 0, injected: ['k_b'], baselineCorrect: true, treatmentCorrect: false },
        // k_c: two appearances, one up and one neutral → net 1, injected 2
        { fold: 0, injected: ['k_c'], baselineCorrect: false, treatmentCorrect: true },
        { fold: 0, injected: ['k_c'], baselineCorrect: true, treatmentCorrect: true },
      ],
      [
        { fold: 0, id: 'k_a', statement: 'A.' },
        { fold: 0, id: 'k_b', statement: 'B.' },
        { fold: 0, id: 'k_c', statement: 'C.' },
      ],
    );
    expect(summary.best.map((rule) => [rule.id, rule.net, rule.injected])).toEqual([
      ['k_a', 2, 2],
      ['k_b', 1, 3],
      ['k_c', 1, 2],
    ]);
  });
});
