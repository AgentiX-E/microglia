import { describe, expect, it } from 'vitest';
import { conditionalLine, conditionalReading, proportionRate, stratifyByK } from '../conditional.js';

/**
 * The conditional rates are the only readings in this lane whose denominator is the population the rate is
 * about, so their cases are the four draws already in the record plus the degenerate populations — no
 * failure, no pass — that a corpus can actually produce.
 */

describe('a proportion with an interval', () => {
  it('keeps the interval inside the unit square where the normal approximation leaves it', () => {
    // 4 of 6: the textbook interval is [0.29, 1.04], and a 104% repair rate is a wrong number rather than a
    // wide one. Wilson at z = 1.96 is [30.00%, 90.32%].
    const rate = proportionRate(4, 6);
    expect(rate.rate).toBeCloseTo(0.6667, 4);
    expect(rate.lo).toBeCloseTo(0.3, 4);
    expect(rate.hi).toBeCloseTo(0.9032, 3);
    expect(rate.hi).toBeLessThanOrEqual(1);
  });

  it('gives a non-zero lower bound at zero hits and an upper bound below one at all hits', () => {
    const none = proportionRate(0, 10);
    expect(none.rate).toBe(0);
    expect(none.lo).toBe(0);
    expect(none.hi).toBeGreaterThan(0.2);
    const all = proportionRate(10, 10);
    expect(all.rate).toBe(1);
    // The shared interval clamps at the boundary rather than returning exactly one, and both are the same
    // statement: no sample of ten can rule out a miss.
    expect(all.hi).toBeCloseTo(1, 12);
    expect(all.lo).toBeLessThan(0.8);
  });

  it('refuses a population it cannot divide into', () => {
    expect(() => proportionRate(2, 0)).toThrow(/positive population/);
    expect(() => proportionRate(3, 2)).toThrow(/is not a proportion/);
    expect(() => proportionRate(-1, 2)).toThrow(/is not a proportion/);
    expect(() => proportionRate(1.5, 3)).toThrow(/integer/);
  });
});

describe('the two conditional rates of a draw', () => {
  it('reads R152c as two thirds repaired and a fifth broken, and puts the delta back together', () => {
    const reading = conditionalReading({ trials: 40, failedControl: 6, repairs: 4, breaks: 7 });
    expect(reading.passedControl).toBe(34);
    expect(reading.failureShare).toBeCloseTo(0.15, 10);
    expect(reading.repairRate?.rate).toBeCloseTo(4 / 6, 10);
    expect(reading.breakRate?.rate).toBeCloseTo(7 / 34, 10);
    // f·r − (1−f)·b = 0.15·0.6667 − 0.85·0.2059 = −7.50pp, the delta the pair published.
    expect(reading.netPp).toBeCloseTo(-7.5, 10);
    expect(reading.fromRepairsPp).toBeCloseTo(10, 10);
    expect(reading.fromBreaksPp).toBeCloseTo(17.5, 10);
    // The target: 0.6667 · 0.15 / 0.85 = 11.76%, which the observed 20.59% is 8.83pp over.
    expect(reading.breakEvenRate).toBeCloseTo(0.1176, 4);
    expect(conditionalLine(reading)).toContain('over it by');
  });

  it('decomposes every draw in the record with the identity rather than beside it', () => {
    const draws = [
      { trials: 40, failedControl: 4, repairs: 4, breaks: 3 },
      { trials: 74, failedControl: 11, repairs: 7, breaks: 15 },
      { trials: 40, failedControl: 6, repairs: 3, breaks: 2 },
      { trials: 40, failedControl: 6, repairs: 4, breaks: 7 },
    ];
    for (const draw of draws) {
      const reading = conditionalReading(draw);
      expect(reading.fromRepairsPp - reading.fromBreaksPp).toBeCloseTo(reading.netPp, 12);
      expect(reading.netPp).toBeCloseTo(
        ((draw.repairs - draw.breaks) / draw.trials) * 100,
        12,
      );
    }
  });

  it('pools the four draws to a repair rate the delta hides', () => {
    // 18 repairs of 27 failures against 27 breaks of 167 passes: the repair rate is two thirds and the break
    // rate is a sixth, and the net is negative only because passes outnumber failures five to one.
    const pooled = conditionalReading({ trials: 194, failedControl: 27, repairs: 18, breaks: 27 });
    expect(pooled.repairRate?.rate).toBeCloseTo(18 / 27, 10);
    expect(pooled.breakRate?.rate).toBeCloseTo(27 / 167, 10);
    expect(pooled.netPp).toBeCloseTo(-4.64, 2);
    expect(pooled.breakRate?.rate).toBeGreaterThan(pooled.breakEvenRate);
    // The interval on a rate over 27 failures is wider than the rate over 167 passes, and it is the one that
    // decides whether the repair claim is quotable.
    const repairWidth = (pooled.repairRate?.hi ?? 0) - (pooled.repairRate?.lo ?? 0);
    const breakWidth = (pooled.breakRate?.hi ?? 0) - (pooled.breakRate?.lo ?? 0);
    expect(repairWidth).toBeGreaterThan(breakWidth);
  });

  it('reports no repair rate on a corpus the control solved completely', () => {
    const reading = conditionalReading({ trials: 40, failedControl: 0, repairs: 0, breaks: 2 });
    expect(reading.repairRate).toBeNull();
    expect(reading.breakEvenRate).toBe(0);
    expect(reading.netPp).toBeCloseTo(-5, 10);
    expect(conditionalLine(reading)).toContain('no trial failed');
  });

  it('reports no break rate on a corpus the control failed completely', () => {
    const reading = conditionalReading({ trials: 10, failedControl: 10, repairs: 4, breaks: 0 });
    expect(reading.breakRate).toBeNull();
    expect(reading.breakEvenRate).toBe(Number.POSITIVE_INFINITY);
    expect(reading.netPp).toBeCloseTo(40, 10);
    expect(conditionalLine(reading)).toContain('no break rate can make this store net-negative');
  });

  it('says under the target when the store pays for itself', () => {
    const reading = conditionalReading({ trials: 40, failedControl: 6, repairs: 5, breaks: 1 });
    expect(reading.breakRate?.rate).toBeCloseTo(1 / 34, 10);
    expect(reading.netPp).toBeGreaterThan(0);
    expect(conditionalLine(reading)).toContain('under it by');
  });

  it('refuses counts that describe a comparison that cannot exist', () => {
    expect(() => conditionalReading({ trials: 0, failedControl: 0, repairs: 0, breaks: 0 })).toThrow(
      /no trial has no rate/,
    );
    expect(() => conditionalReading({ trials: 4, failedControl: 5, repairs: 0, breaks: 0 })).toThrow(
      /exceeds trials/,
    );
    expect(() => conditionalReading({ trials: 40, failedControl: 4, repairs: 5, breaks: 0 })).toThrow(
      /exceed the failed trials/,
    );
    expect(() => conditionalReading({ trials: 40, failedControl: 4, repairs: 4, breaks: 37 })).toThrow(
      /exceed the passed trials/,
    );
    expect(() => conditionalReading({ trials: 40, failedControl: -1, repairs: 0, breaks: 0 })).toThrow(
      /non-negative integer/,
    );
    expect(() => conditionalReading({ trials: 40, failedControl: 4, repairs: 1.5, breaks: 0 })).toThrow(
      /non-negative integer/,
    );
  });

  it('names the denominator in every clause it prints', () => {
    const line = conditionalLine(conditionalReading({ trials: 40, failedControl: 6, repairs: 4, breaks: 7 }));
    expect(line).toContain('4 of 6 failed trial(s) repaired');
    expect(line).toContain('7 of 34 passed trial(s) broken');
    expect(line).toContain('break-even at a 15.00% failure share');
  });
});

describe('the pool split by the metric each draw was scored at', () => {
  const DRAWS = [
    { label: 'official', k: 4, trials: 40, failedControl: 4, repairs: 4, breaks: 3 },
    { label: 'swapped', k: 4, trials: 74, failedControl: 11, repairs: 7, breaks: 15 },
    { label: 'R152', k: null, trials: 40, failedControl: 6, repairs: 3, breaks: 2 },
    { label: 'R152c', k: null, trials: 40, failedControl: 6, repairs: 4, breaks: 7 },
  ];

  it('gives each metric its own counts and its own target', () => {
    // The four draws that produced `b* = 10.78%` in R155 are two pairs of artefacts written under two
    // different metric states: `poc-l4-pair-official`/`-swapped` state `k = 4`, and the two recovered
    // draws state nothing at all. Splitting them is what makes the target auditable per population.
    const strata = stratifyByK(DRAWS);
    expect(strata.map((stratum) => stratum.k)).toEqual([4, null]);
    const four = strata[0]?.reading;
    expect(four?.trials).toBe(114);
    expect(four?.passedControl).toBe(99);
    expect(four?.breakRate?.rate).toBeCloseTo(18 / 99, 9);
    // `b* = r·f/(1−f)`; at 11 repairs over 15 failures and 114 trials that is 11/99 = 11.11%.
    expect(four?.breakEvenRate).toBeCloseTo(11 / 99, 9);
    const unstated = strata[1]?.reading;
    expect(unstated?.trials).toBe(80);
    expect(unstated?.breakRate?.rate).toBeCloseTo(9 / 68, 9);
    expect(strata[0]?.draws).toEqual(['official', 'swapped']);
    expect(strata[1]?.draws).toEqual(['R152', 'R152c']);
  });

  it('reconstructs the pooled delta of the whole set when the strata are added back', () => {
    const strata = stratifyByK(DRAWS);
    const total = strata.reduce(
      (sum, stratum) => ({
        trials: sum.trials + stratum.reading.trials,
        failedControl: sum.failedControl + stratum.reading.failedControl,
        repairs: sum.repairs + stratum.reading.repairs,
        breaks: sum.breaks + stratum.reading.breaks,
      }),
      { trials: 0, failedControl: 0, repairs: 0, breaks: 0 },
    );
    const pooled = conditionalReading(total);
    expect(pooled.trials).toBe(194);
    expect(pooled.netPp).toBeCloseTo(-4.6392, 3);
    expect(pooled.breakEvenRate).toBeCloseTo(0.1078, 4);
  });

  it('orders the strata so two runs of one census print one table', () => {
    const shuffled = [DRAWS[3], DRAWS[0], DRAWS[2], DRAWS[1]];
    expect(stratifyByK(shuffled).map((stratum) => stratum.k)).toEqual([4, null]);
  });

  it('refuses a level that is not a trial count', () => {
    expect(() => stratifyByK([{ label: 'x', k: 0, trials: 4, failedControl: 1, repairs: 1, breaks: 0 }])).toThrow(
      /states k = 0, which is not a trial count/,
    );
    expect(() => stratifyByK([{ label: 'x', k: 1.5, trials: 4, failedControl: 1, repairs: 1, breaks: 0 }])).toThrow(
      /not a trial count/,
    );
  });
});
