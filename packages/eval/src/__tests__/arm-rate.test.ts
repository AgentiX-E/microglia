/**
 * TDD for the rate `pass^4` is a nonlinear function of, and for the reading that made R119 → R120 legible.
 *
 * The fixtures are the two runs' own shapes: R119 had 24 tasks at 4/4, 13 at 3/4, 2 at 2/4 and 1 at 1/4;
 * R120 had 30, 6, 1, 1 and 2 at 0/4. Both are 140 and 141 successes over 160 episodes, and their headline
 * figures are 0.600 and 0.750. A test that used round numbers instead would not have caught the defect this
 * module exists to make visible — a 15pp difference produced by one episode changing side.
 */
import { describe, expect, it } from 'vitest';
import { independenceOf, rateLineOf, trialRateOf } from '../arm-rate.js';

/** `count` rows that each passed `successes` of four trials. */
function rows(count: number, successes: number): { successes: number; trials: number }[] {
  return Array.from({ length: count }, () => ({ successes, trials: 4 }));
}

describe('the trial rate', () => {
  it('counts episodes rather than tasks, which is where its resolution comes from', () => {
    const r119 = trialRateOf([...rows(24, 4), ...rows(13, 3), ...rows(2, 2), ...rows(1, 1)]);
    expect(r119.successes).toBe(140);
    expect(r119.trials).toBe(160);
    expect(r119.tasks).toBe(40);
    expect(r119.k).toBe(4);
    expect(r119.rate).toBeCloseTo(0.875, 4);
    // 1.96·sqrt(.875·.125/160) = 5.12pp, against the 15.18pp the headline is measured with at n = 40.
    expect(r119.halfWidth).toBeCloseTo(0.0512, 3);
  });

  it('separates a run whose misses clustered from one whose misses spread, at the same rate', () => {
    const r119 = trialRateOf([...rows(24, 4), ...rows(13, 3), ...rows(2, 2), ...rows(1, 1)]);
    const r120 = trialRateOf([...rows(30, 4), ...rows(6, 3), ...rows(1, 2), ...rows(1, 1), ...rows(2, 0)]);
    // One episode apart over one hundred and sixty, and fifteen points apart in the headline they produce.
    expect(r120.successes - r119.successes).toBe(1);
    expect((r120.rate as number) - (r119.rate as number)).toBeCloseTo(0.00625, 4);
  });

  it('is absent rather than zero when no episode recorded an outcome', () => {
    expect(trialRateOf([])).toEqual({ tasks: 0, trials: 0, successes: 0, rate: null, halfWidth: null, k: 0 });
    // A row with trials but no outcome is skipped, not counted as a failure.
    const partial = trialRateOf([{ successes: 4, trials: 4 }, { trials: 4 }, { id: 'x' }]);
    expect(partial.trials).toBe(4);
    expect(partial.tasks).toBe(1);
  });

  it('prints the rate with the interval it has to clear, and the absence when there is none', () => {
    expect(rateLineOf('R119', trialRateOf(rows(40, 3)))).toBe(
      'R119: 120 of 160 episode(s) passed (75.00% ±6.71pp over 40 task(s) × 4)',
    );
    expect(rateLineOf('R120', trialRateOf([]))).toContain('rate absent');
  });

  it('says what the headline would be if the rate were the only thing that moved', () => {
    // p⁴ is the headline indepedence implies; the measured 0.750 against this run's 0.6031 is the gap that
    // says the misses moved between tasks rather than the memory getting better.
    const r120 = trialRateOf([...rows(30, 4), ...rows(6, 3), ...rows(1, 2), ...rows(1, 1), ...rows(2, 0)]);
    expect(independenceOf(r120) as number).toBeCloseTo(0.6031, 3);
    expect(independenceOf(trialRateOf([]))).toBeNull();
  });
});
