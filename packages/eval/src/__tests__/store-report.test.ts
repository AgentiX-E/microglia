import { describe, expect, it } from 'vitest';
import { storeReport, type StoreRun } from '../store-report.js';

function run(over: Partial<StoreRun> = {}): StoreRun {
  return {
    id: 'r1',
    rules: 100,
    injectedRules: 50,
    helpfulRules: 2,
    harmfulRules: 4,
    neutralRules: 44,
    harmfulInstanceShare: 0.08,
    ...over,
  };
}

describe('storeReport', () => {
  it('divides the sign classes by the rules that reached a prompt, not by the store', () => {
    // The artefact classifies *rules*, not injection instances: `helpful + harmful + neutral` equals
    // `injectedRules` exactly, which is the arithmetic that settles the unit. Dividing by the store
    // would describe a retrieval gap as a smaller effect.
    const report = storeReport([
      run({ rules: 1000, injectedRules: 100, helpfulRules: 3, harmfulRules: 7, neutralRules: 90 }),
    ]);
    expect(report.helpfulShare).toBeCloseTo(0.03, 12);
    expect(report.harmfulShare).toBeCloseTo(0.07, 12);
    expect(report.neutralShare).toBeCloseTo(0.9, 12);
    expect(report.injectedShare).toBeCloseTo(0.1, 12);
  });

  it('tests the sign classes against each other rather than against the neutral mass', () => {
    // The two non-zero classes are the only ones that carry a sign. A test against the neutral rules
    // would answer whether the model read the prompt, which is not the question: the question is
    // whether showing a rule moved the answer, and in which direction.
    const report = storeReport([
      run({ injectedRules: 50, helpfulRules: 5, harmfulRules: 20, neutralRules: 25 }),
    ]);
    expect(report.net).toBe(-15);
    expect(report.p).toBeLessThan(0.01);
  });

  it('keeps the unit in the field names, so an instance claim cannot be read out of a rule count', () => {
    // Renaming these to `helpful` and `harmful` is what produced a published claim about 3.90% of
    // injection instances when the artefact said 3.90% of injected rules. The name is the guard.
    const report = storeReport([run()]);
    expect('helpfulRules' in report).toBe(true);
    expect('helpful' in report).toBe(false);
    expect('injectedRules' in report).toBe(true);
    expect('injected' in report).toBe(false);
  });

  it('never reports a negative p or one above one', () => {
    for (const [helpfulRules, harmfulRules] of [
      [0, 0],
      [0, 9],
      [9, 0],
      [3, 3],
      [96, 189],
    ] as const) {
      const report = storeReport([
        run({ injectedRules: helpfulRules + harmfulRules, helpfulRules, harmfulRules, neutralRules: 0 }),
      ]);
      expect(report.p).toBeGreaterThanOrEqual(0);
      expect(report.p).toBeLessThanOrEqual(1);
    }
  });

  it('reports p = 1 when no rule had a sign, because there was nothing to test', () => {
    const report = storeReport([
      run({ injectedRules: 40, helpfulRules: 0, harmfulRules: 0, neutralRules: 40 }),
    ]);
    expect(report.p).toBe(1);
    expect(report.net).toBe(0);
  });

  it('adds the runs up rather than averaging their shares', () => {
    // Averaging shares would give a run of sixty questions the same weight as a run of 350, and the
    // small runs in this log disagree with the large ones by a factor of two on this ratio.
    const report = storeReport([
      run({ id: 'small', injectedRules: 10, helpfulRules: 1, harmfulRules: 1, neutralRules: 8 }),
      run({ id: 'large', injectedRules: 1000, helpfulRules: 10, harmfulRules: 200, neutralRules: 790 }),
    ]);
    expect(report.injectedRules).toBe(1010);
    expect(report.helpfulRules).toBe(11);
    expect(report.harmfulRules).toBe(201);
    expect(report.harmfulShare).toBeCloseTo(201 / 1010, 12);
  });

  it('reports the instance-weighted harmful share as a range, not as a mean', () => {
    // The artefact carries the share of injections belonging to a harmful rule, but not the instance
    // total needed to weight the runs against each other. A range cannot be wrong about the weighting
    // the way an unweighted mean can.
    const report = storeReport([
      run({ id: 'a', harmfulInstanceShare: 0.068 }),
      run({ id: 'b', harmfulInstanceShare: 0.167 }),
    ]);
    expect(report.harmfulInstanceRange.low).toBeCloseTo(0.068, 12);
    expect(report.harmfulInstanceRange.high).toBeCloseTo(0.167, 12);
  });

  it('counts a run whose rules never reached a prompt without dividing by zero', () => {
    const report = storeReport([
      run({ rules: 400, injectedRules: 0, helpfulRules: 0, harmfulRules: 0, neutralRules: 0 }),
    ]);
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
    expect(report.harmfulInstanceRange).toEqual({ low: 0, high: 0 });
    expect(report.perRun).toEqual([]);
  });

  it('keeps every run in the table, in the order it was given', () => {
    const report = storeReport([run({ id: 'b' }), run({ id: 'a' })]);
    expect(report.perRun.map((entry) => entry.id)).toEqual(['b', 'a']);
    expect(report.runs).toBe(2);
  });
});
