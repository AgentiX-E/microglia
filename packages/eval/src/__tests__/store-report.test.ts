import { describe, expect, it } from 'vitest';
import { storeReport, type StoreRun } from '../store-report.js';

function run(over: Partial<StoreRun> = {}): StoreRun {
  return { id: 'r1', rules: 100, injected: 50, helpful: 2, harmful: 4, neutral: 44, ...over };
}

describe('storeReport', () => {
  it('divides by the rule instances that reached a prompt, not by the store', () => {
    // The denominator matters. A store of 7,775 rules in which 2,414 instances were injected is not
    // "3.4% of the store helped": the 69% that never reached a prompt did not do anything at all,
    // and putting them in the denominator would make a store that injects more look worse without
    // measuring anything about what it injects.
    const report = storeReport([run({ rules: 1000, injected: 100, helpful: 3, harmful: 7, neutral: 90 })]);
    expect(report.helpfulShare).toBeCloseTo(0.03, 12);
    expect(report.harmfulShare).toBeCloseTo(0.07, 12);
    expect(report.neutralShare).toBeCloseTo(0.9, 12);
    expect(report.injectedShare).toBeCloseTo(0.1, 12);
  });

  it('tests harm against help rather than against everything else', () => {
    // The two discordant outcomes are the only ones that carry a sign. A test against "neutral"
    // would be a test of whether the rule was read, which is not the question: the question is
    // whether showing it moved the answer, and in which direction.
    const report = storeReport([run({ injected: 50, helpful: 5, harmful: 20, neutral: 25 })]);
    expect(report.net).toBe(-15);
    expect(report.netShare).toBeCloseTo(-0.3, 12);
    expect(report.p).toBeLessThan(0.01);
  });

  it('never reports a negative p or one above one', () => {
    for (const [helpful, harmful] of [
      [0, 0],
      [0, 9],
      [9, 0],
      [3, 3],
      [96, 189],
    ] as const) {
      const report = storeReport([run({ injected: helpful + harmful, helpful, harmful, neutral: 0 })]);
      expect(report.p).toBeGreaterThanOrEqual(0);
      expect(report.p).toBeLessThanOrEqual(1);
    }
  });

  it('reports p = 1 when nothing moved, because no sign was observed', () => {
    const report = storeReport([run({ injected: 40, helpful: 0, harmful: 0, neutral: 40 })]);
    expect(report.p).toBe(1);
    expect(report.net).toBe(0);
  });

  it('adds the runs up rather than averaging their shares', () => {
    // Averaging shares would give a run of sixty questions the same weight as a run of 350, and the
    // small runs in this log disagree with the large ones by a factor of two on this ratio.
    const report = storeReport([
      run({ id: 'small', injected: 10, helpful: 1, harmful: 1, neutral: 8 }),
      run({ id: 'large', injected: 1000, helpful: 10, harmful: 200, neutral: 790 }),
    ]);
    expect(report.injected).toBe(1010);
    expect(report.helpful).toBe(11);
    expect(report.harmful).toBe(201);
    expect(report.harmfulShare).toBeCloseTo(201 / 1010, 12);
  });

  it('counts a run whose stored rules were never injected without dividing by zero', () => {
    const report = storeReport([run({ rules: 400, injected: 0, helpful: 0, harmful: 0, neutral: 0 })]);
    expect(report.injectedShare).toBe(0);
    expect(report.helpfulShare).toBe(0);
    expect(report.harmfulShare).toBe(0);
    expect(report.neutralShare).toBe(0);
    expect(Number.isNaN(report.p)).toBe(false);
  });

  it('reports zeros for no runs at all', () => {
    const report = storeReport([]);
    expect(report.runs).toBe(0);
    expect(report.rules).toBe(0);
    expect(report.p).toBe(1);
    expect(report.perRun).toEqual([]);
  });

  it('keeps every run in the table, in the order it was given', () => {
    const report = storeReport([run({ id: 'b' }), run({ id: 'a' })]);
    expect(report.perRun.map((entry) => entry.id)).toEqual(['b', 'a']);
    expect(report.runs).toBe(2);
  });
});
