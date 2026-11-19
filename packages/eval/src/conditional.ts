import { wilsonInterval } from './reproduction.js';

/**
 * The two conditional rates a paired fold carries, and the break-even point between them.
 *
 * ## The number that was never divided
 *
 * Every reading in this record has been a **delta over all tasks**: `(repairs − breaks) / n`. That number is
 * the memory's net worth on a sample, and on τ² retail it has bounced between −10.81pp and +2.50pp across
 * four draws without settling. The delta is not wrong; it is *diluted*. A repair can only come from a task
 * the control failed and a break can only come from one it passed, so on a corpus the bare agent already
 * solves 86% of, the denominator spends 86% of its weight on the population where the memory can only lose.
 *
 * Divide the same counts by the populations they came from and the picture changes:
 *
 * | draw | trials | control failed | repaired | passed | broken | repair rate | break rate |
 * | --- | --- | --- | --- | --- | --- | --- | --- |
 * | `official` (committed) | 40 | 4 | 4 | 36 | 3 | 100.0% | 8.3% |
 * | `official-swapped` (committed) | 74 | 11 | 7 | 63 | 15 | 63.6% | 23.8% |
 * | R152 | 40 | 6 | 3 | 34 | 2 | 50.0% | 5.9% |
 * | R152c | 40 | 6 | 4 | 34 | 7 | 66.7% | 20.6% |
 *
 * **The memory repairs two thirds of the trials the control fails.** That is a large, consistent effect, and
 * it is invisible in the delta because failures are 14% of the sample. The question this module answers is
 * not "did the memory help" but "on which population, and by how much".
 *
 * ## The identity, and the target it produces
 *
 * Writing `f` for the failure share, `r` for the repair rate and `b` for the break rate, the delta decomposes
 * exactly:
 *
 * ```
 * delta = f·r − (1−f)·b
 * ```
 *
 * Set it to zero and the store's break rate has a target: `b* = r·f/(1−f)`. On this corpus `f ≈ 0.14` and
 * `r ≈ 0.67`, so **`b* ≈ 10.8%`** — and the observed pooled break rate is 16.2%. The memory is not wrong in
 * the direction this record has been arguing about; it is **1.5× over its own break-even**, and the break-even
 * is a function of the corpus rather than of the store. That is the first numeric goal this lane has had for
 * the harm side, and it is a goal a content axis can be measured against.
 *
 * ## Why the intervals matter more here than anywhere else
 *
 * A rate over 27 failures is estimated from 27 trials, not from 194, so its interval is wide — and wide in a
 * way that is *honest*, because the denominator is the population the rate is about. Wilson rather than the
 * normal approximation: at 4 of 6 the normal interval runs past 1, and a rate of 103% is the kind of number
 * that makes a reader stop trusting the table rather than the row.
 */

/** A proportion with its interval. `rate` is a share, not a percentage. */
export type Rate = {
  /** The denominator the rate is over — failures for a repair rate, passes for a break rate. */
  readonly of: number;
  readonly hits: number;
  readonly rate: number;
  readonly lo: number;
  readonly hi: number;
};

export type ConditionalInput = {
  /**
   * Renders the store was served into — the unit every other serving block counts, and not the task count.
   * At one trial per task the two coincide; at four they do not, and a rate that mixed them would divide
   * repairs counted per render by passes counted per task.
   */
  readonly trials: number;
  /** Trials the memory-free arm failed: the population a repair can come from. */
  readonly failedControl: number;
  /** Trials the treatment passed and the control failed. */
  readonly repairs: number;
  /** Trials the control passed and the treatment failed. */
  readonly breaks: number;
};

export type ConditionalReading = {
  readonly trials: number;
  readonly failedControl: number;
  readonly passedControl: number;
  readonly repairs: number;
  readonly breaks: number;
  /** `failedControl / trials`. Zero failures is a corpus fact, not an error. */
  readonly failureShare: number;
  /**
   * `repairs / failedControl` with its Wilson interval, or `null` when no trial failed — a store cannot be
   * said to repair a population that does not exist, and `0%` would read as "it repaired none of them".
   */
  readonly repairRate: Rate | null;
  /** `breaks / passedControl`, or `null` when the control passed nothing. */
  readonly breakRate: Rate | null;
  /**
   * The break rate at which this store's delta would be exactly zero: `r·f/(1−f)`.
   *
   * `Infinity` when every trial failed (no break can hurt) and `0` when none did (no repair can help). Both
   * are arithmetic rather than special cases, which is why they are not refused.
   */
  readonly breakEvenRate: number;
  /** The delta over all trials, reconstructed from the two conditional rates. */
  readonly netPp: number;
  /** `f·r`, the part of the delta that comes from failures. */
  readonly fromRepairsPp: number;
  /** `(1−f)·b`, the part that comes from passes — the dilution, stated as a number. */
  readonly fromBreaksPp: number;
};

/**
 * A proportion over a population, with the interval the rest of the repository already uses.
 *
 * The interval is **not** recomputed here: `wilsonInterval` in `reproduction.ts` is the one Wilson score
 * interval this codebase has, and a second copy would be two answers to one question — the failure mode that
 * `detectable.ts` exists to prevent on the other formula. What this adds is the population's name: `4 of 6
 * failed trials` rather than `accuracy 0.667 at n = 6`, because the whole point of the block is that the
 * denominator is a subpopulation and not the sample.
 *
 * The three refusals are this module's own, because the shared interval's refusals speak in `accuracy` and
 * `n` and a reader of a repair rate needs the sentence in repairs and failures.
 */
export function proportionRate(hits: number, of: number): Rate {
  if (!Number.isInteger(hits) || !Number.isInteger(of)) {
    throw new Error('a proportion counts integer hits over an integer population');
  }
  if (of <= 0) throw new Error('a proportion needs a positive population');
  if (hits < 0 || hits > of) {
    throw new Error(`${String(hits)} hits over ${String(of)} trials is not a proportion`);
  }
  const rate = hits / of;
  const { low, high } = wilsonInterval({ accuracy: rate, n: of });
  return { of, hits, rate, lo: low, hi: high };
}

/**
 * The two conditional rates, the break-even between them, and the decomposition of the delta.
 *
 * The four refusals are preconditions of the arithmetic and not style. A repair is by definition a trial the
 * control failed, and a break a trial it passed; counts that exceed their population describe a comparison
 * that cannot exist, and each would still produce a plausible number.
 */
export function conditionalReading(input: ConditionalInput): ConditionalReading {
  const { trials, failedControl, repairs, breaks } = input;
  for (const [name, value] of [
    ['trials', trials],
    ['failedControl', failedControl],
    ['repairs', repairs],
    ['breaks', breaks],
  ] as const) {
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`${name} must be a non-negative integer, got ${String(value)}`);
    }
  }
  if (trials <= 0) throw new Error('trials must be positive: a sample with no trial has no rate');
  if (failedControl > trials) {
    throw new Error(`failedControl ${String(failedControl)} exceeds trials ${String(trials)}`);
  }
  if (repairs > failedControl) {
    throw new Error(`repairs ${String(repairs)} exceed the failed trials ${String(failedControl)} they come from`);
  }
  const passedControl = trials - failedControl;
  if (breaks > passedControl) {
    throw new Error(`breaks ${String(breaks)} exceed the passed trials ${String(passedControl)} they come from`);
  }

  const failureShare = failedControl / trials;
  const repairRate = failedControl === 0 ? null : proportionRate(repairs, failedControl);
  const breakRate = passedControl === 0 ? null : proportionRate(breaks, passedControl);
  const repair = repairRate?.rate ?? 0;
  const share = 1 - failureShare;
  // `f === 1` divides by zero, and the answer there is the arithmetic's own: with no passing trial to break,
  // no break rate can make the store net-negative. `f === 0` gives zero, which is equally literal.
  const breakEvenRate = share === 0 ? Number.POSITIVE_INFINITY : (repair * failureShare) / share;
  const fromRepairsPp = failureShare * repair * 100;
  const fromBreaksPp = share * (breakRate?.rate ?? 0) * 100;
  return {
    trials,
    failedControl,
    passedControl,
    repairs,
    breaks,
    failureShare,
    repairRate,
    breakRate,
    breakEvenRate,
    // Written as the identity rather than as `(repairs − breaks) / trials`, so the decomposition and the net
    // cannot disagree: a reader who checks `fromRepairsPp − fromBreaksPp` gets this number to the last bit.
    netPp: fromRepairsPp - fromBreaksPp,
    fromRepairsPp,
    fromBreaksPp,
  };
}

function pct(share: number): string {
  return `${(share * 100).toFixed(2)}%`;
}

/**
 * The reading as one line.
 *
 * Three sentences for the two rates and the target, because the useful comparison is the last one: a break
 * rate is not "low" or "high" in the abstract, it is above or below the rate at which this store's repairs
 * pay for it on this corpus.
 */
export function conditionalLine(reading: ConditionalReading): string {
  const repair =
    reading.repairRate === null
      ? 'no trial failed, so there is no repair rate'
      : `${String(reading.repairs)} of ${String(reading.failedControl)} failed trial(s) repaired ` +
        `(${pct(reading.repairRate.rate)}, 95% [${pct(reading.repairRate.lo)}, ${pct(reading.repairRate.hi)}])`;
  const broken =
    reading.breakRate === null
      ? 'no trial passed, so there is no break rate'
      : `${String(reading.breaks)} of ${String(reading.passedControl)} passed trial(s) broken ` +
        `(${pct(reading.breakRate.rate)}, 95% [${pct(reading.breakRate.lo)}, ${pct(reading.breakRate.hi)}])`;
  const target = Number.isFinite(reading.breakEvenRate)
    ? `break-even at a ${pct(reading.failureShare)} failure share is ${pct(reading.breakEvenRate)}`
    : 'every trial failed, so no break rate can make this store net-negative';
  const against =
    reading.breakRate === null || !Number.isFinite(reading.breakEvenRate)
      ? ''
      : ` (${reading.breakRate.rate > reading.breakEvenRate ? 'over' : 'under'} it by ` +
        `${pct(Math.abs(reading.breakRate.rate - reading.breakEvenRate))})`;
  return `conditional: ${repair}; ${broken}; ${target}${against}`;
}
