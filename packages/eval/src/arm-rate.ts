/**
 * The rate `pass^4` is a nonlinear function of, measured over the episodes rather than the tasks.
 *
 * R119 and R120 ran one lane — one form, one split, one seed, one model, forty tasks, four trials — and
 * scored **0.600** and **0.750**. Between them, **140 of 160 episodes** passed and **141 of 160** passed.
 * The underlying rate moved by 0.6pp and the headline moved by 15.00pp.
 *
 * The arithmetic is not subtle once it is written down. `pass^4` on a task is one exactly when all four
 * trials passed, so under independent trials it estimates `p⁴`, and the *task count* is the sample it is
 * averaged over: at p = 0.88 the standard error of that fraction is 7.7pp over forty tasks. The episodes
 * are the same forty tasks times four, and the rate over them has a standard error of 2.6pp. **The same
 * experiment reported at two levels has a factor of three in resolution**, and the coarse one is the level
 * the competitor's table is written at.
 *
 * So the two are reported together and neither substitutes for the other. `pass^4` is the interface: it is
 * what ALTK-Evolve publishes and what a SOTA table compares. The trial rate is the measurement: it is what
 * an arm can be graded on at this `n`, and it is the only one of the two that can distinguish a mechanism
 * from a redraw. A run whose `pass^4` moves and whose rate does not has had its misses reshuffled, which
 * is exactly what R119 → R120 did: ten successes gained, nine lost, net **one episode**.
 */

/** What a run's episodes did, aggregated over the tasks the run scored. */
export type TrialRate = {
  /** Tasks that contributed at least one trial. */
  readonly tasks: number;
  /** Episodes: the denominator of `rate`. */
  readonly trials: number;
  readonly successes: number;
  /** `successes / trials`, or `null` when no episode ran — never zero, which reads as a measurement. */
  readonly rate: number | null;
  /** Half-width of the 95% interval on `rate`, in absolute units; `null` over no episode. */
  readonly halfWidth: number | null;
  /** Trials per task, which is what makes `pass^4`'s own resolution comparable to this one. */
  readonly k: number;
};

/** One arm's per-task rows, as the L4 artefact writes them. */
export type TaskSuccessRow = {
  readonly id?: string;
  readonly successes?: number;
  readonly trials?: number;
};

/**
 * The rate, its interval, and the `k` it was measured at.
 *
 * A row with no `successes` or no `trials` is skipped rather than counted as zero: an artefact that did
 * not record a trial's outcome is not an artefact that recorded a failure, and the two have been confused
 * once already in this record (`unscored` against `unscored_reported`).
 */
export function trialRateOf(rows: readonly TaskSuccessRow[]): TrialRate {
  let tasks = 0;
  let trials = 0;
  let successes = 0;
  let k = 0;
  for (const row of rows) {
    const ran = row.trials;
    const won = row.successes;
    if (ran === undefined || won === undefined || ran <= 0) continue;
    tasks += 1;
    trials += ran;
    successes += won;
    if (ran > k) k = ran;
  }
  if (trials === 0) return { tasks: 0, trials: 0, successes: 0, rate: null, halfWidth: null, k: 0 };
  const rate = successes / trials;
  // 1.96·sqrt(p(1−p)/n), the same rule `sample-gates` applies to the headline, so the two intervals on one
  // run are computed the same way and cannot disagree about which of them is the wider one.
  const halfWidth = 1.96 * Math.sqrt((rate * (1 - rate)) / trials);
  return { tasks, trials, successes, rate, halfWidth, k };
}

/** One line for the run log, with the rate and the half-width it has to clear. */
export function rateLineOf(arm: string, rate: TrialRate): string {
  if (rate.rate === null || rate.halfWidth === null) {
    return `${arm}: rate absent (no episode recorded an outcome)`;
  }
  const points = (rate.rate * 100).toFixed(2);
  const width = (rate.halfWidth * 100).toFixed(2);
  return (
    `${arm}: ${String(rate.successes)} of ${String(rate.trials)} episode(s) passed ` +
    `(${points}% ±${width}pp over ${String(rate.tasks)} task(s) × ${String(rate.k)})`
  );
}

/**
 * What `pass^4` would be if the trials were independent and the rate were the only thing that moved.
 *
 * Printed beside the measured headline because the two disagreeing is the finding: `rate⁴` is what a
 * change in the underlying rate can explain, and a headline above it means the misses clustered into fewer
 * tasks. R120 measured `0.7500` against a `rate⁴` of `0.6031`, which is why its score was not claimed.
 */
export function independenceOf(rate: TrialRate): number | null {
  if (rate.rate === null || rate.k === 0) return null;
  return rate.rate ** rate.k;
}

/**
 * The fields that put a run's second denominator on the line that states its score.
 *
 * A `[poc-l4]` line is what a dispatch's log shows and what a readback quotes, and until this existed it
 * carried the headline and nothing else — `pass4=0.75 published_pass4=0.575 …`. The 141 of 160 episodes
 * behind that 0.75 were in the same artefact, one download away, so the honest reading cost work and the
 * dishonest one cost nothing. `writeResult` renders every key of `metrics`, so a field added here reaches
 * the log, the artefact and a readback at once, and no reader has to remember to compute it.
 *
 * `null` over no episode rather than zeros: a run that measured nothing has no rate, and `0` would be a
 * rate no episode produced — the same distinction `unscored`/`unscored_reported` and `absent`/`empty` have
 * carried in this record since R85.
 */
export type DenominatorFields = {
  /** Episodes passed over episodes run, the level at which this `n` has resolution. */
  readonly episode_rate: number;
  /** Half-width of the 95% interval on that rate, in percentage points, beside the headline's own. */
  readonly episode_half_width_pp: number;
  /** `rate^k` under independence: what a change in the rate alone would have scored. */
  readonly rate_to_the_k: number;
  /** The denominator of `episode_rate`, so the interval can be recomputed by a reader who doubts it. */
  readonly episode_trials: number;
};

export function denominatorFieldsOf(rate: TrialRate): DenominatorFields | null {
  // One guard for all three preconditions, because the second of them is the only one `independenceOf`
  // refuses for a reason of its own and a second check here would be a branch no caller can reach --
  // which is a defect this record has deleted five times rather than exempted.
  if (rate.rate === null || rate.halfWidth === null || rate.k === 0) return null;
  return {
    episode_rate: rate.rate,
    episode_half_width_pp: Number((rate.halfWidth * 100).toFixed(2)),
    rate_to_the_k: rate.rate ** rate.k,
    episode_trials: rate.trials,
  };
}
