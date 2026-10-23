import { describe, expect, it } from 'vitest';
import { attributeRules } from '../attribution.js';

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
});
