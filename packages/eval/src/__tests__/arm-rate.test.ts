/**
 * TDD for the rate `pass^4` is a nonlinear function of, and for the reading that made R119 → R120 legible.
 *
 * The fixtures are the two runs' own shapes: R119 had 24 tasks at 4/4, 13 at 3/4, 2 at 2/4 and 1 at 1/4;
 * R120 had 30, 6, 1, 1 and 2 at 0/4. Both are 140 and 141 successes over 160 episodes, and their headline
 * figures are 0.600 and 0.750. A test that used round numbers instead would not have caught the defect this
 * module exists to make visible — a 15pp difference produced by one episode changing side.
 */
import { describe, expect, it } from 'vitest';
import { denominatorFieldsOf, independenceOf, rateLineOf, trialRateOf } from '../arm-rate.js';

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

/**
 * The denominator a run line has to carry, or the reader ranks a coin.
 *
 * R120's log line read `[poc-l4] pass4=0.75 published_pass4=0.575 …` and nothing else. Every number a
 * reader needed to know that the score was the tail of four trials — 141 of 160 episodes, the rate, the
 * `rate⁴` the rate implies — was *in the same artefact* and not on the line, so the honest reading cost a
 * download and the dishonest one cost nothing. The fields below are computed from `per_task`, which every
 * run since R85 writes, so this is a change of one line and no change of measurement.
 */
describe('the denominator fields a run line carries', () => {
  it('reports the rate and its interval beside the headline it produced', () => {
    const fields = denominatorFieldsOf(
      trialRateOf([...rows(30, 4), ...rows(6, 3), ...rows(1, 2), ...rows(1, 1), ...rows(2, 0)]),
    );
    expect(fields).not.toBeNull();
    expect(fields?.episode_rate).toBeCloseTo(0.88125, 5);
    // 1.96·sqrt(.88125·.11875/160) = 5.01pp, against the 13.42pp the measured 0.75 is quoted with.
    expect(fields?.episode_half_width_pp).toBeCloseTo(5.01, 2);
    expect(fields?.rate_to_the_k).toBeCloseTo(0.6031, 3);
    expect(fields?.episode_trials).toBe(160);
  });

  it('is absent rather than zero when no episode recorded an outcome', () => {
    // A run that measured nothing must not print `episode_rate=0`, which is a rate no episode produced
    // and which would be read as a run in which everything failed.
    expect(denominatorFieldsOf(trialRateOf([]))).toBeNull();
  });

  it('keeps the two levels apart when they agree, which is the case a reader cannot check by eye', () => {
    // Forty tasks at 3/4 is rate 0.75 and headline 0.0 — agreement is not required and is not evidence.
    // The fields exist so that "they agree" is read rather than assumed, and so that "they disagree" is
    // visible on the line that states the score.
    const fields = denominatorFieldsOf(trialRateOf(rows(40, 3)));
    expect(fields?.episode_rate).toBeCloseTo(0.75, 6);
    expect(fields?.rate_to_the_k).toBeCloseTo(0.3164, 3);
  });
});
