/**
 * Can the remaining folds finish inside the ceiling the operator approved?
 *
 * This exists because of one run. Four of five folds completed, the fifth reached call 4,197 of a
 * 4,200 ceiling and threw, and forty-seven minutes of measurement were discarded: the lane exits
 * non-zero, the publish step finds no artefact, and the log's only trace of the cause is a single
 * line at the end. The configuration was wrong by a factor of 1.5, and nothing could tell that
 * before it had paid for it.
 *
 * A forecast is the cheapest available insurance, and the only honest one: it is built from what
 * the folds that already ran actually cost, so it inherits their retry rate, their distillation
 * cost and their arm count rather than assuming any of them. It runs between folds, which is the
 * first moment a sample exists and the last moment before the next fold spends anything.
 *
 * Two properties keep it from becoming a second way to fail:
 *
 *  - It refuses only on evidence. With no completed fold there is nothing to extrapolate from, and
 *    inventing a prior would refuse configurations that are merely expensive.
 *  - It uses the dearest fold, not the mean. Folds are not priced alike — the first pays for a cold
 *    store, and a fold that admits more rules asks for more corrections — and an optimistic
 *    projection is worse than none, because it is quoted as reassurance.
 *
 * A third property was added after R74. The forecast was originally compared against the same number
 * the operator had written as the cap, which made an estimate the run could not survive being wrong
 * about: the run measured a fold at 5,483 calls, projected 29,609 against a cap of 28,000, and
 * stopped — having spent a fifth of its own cost to write down a number that four more folds would
 * have fitted inside a 32,000 bound. An estimate and a bound are different objects. The estimate is
 * arithmetic over a run that has not happened; the bound is a commitment. **Only the bound may end a
 * run**, and when the estimate is low the run raises its own cap to the projection and records that
 * it did, so the next registration can see the miss instead of rediscovering it.
 */

/** One fold's measured cost, in HTTP attempts. */
export type FoldSpend = {
  readonly fold: number;
  /** Attempts this fold spent, retries included — the unit the ceiling counts. */
  readonly calls: number;
};

export type BudgetLedger = {
  /** Attempts spent so far across every completed fold. */
  readonly spent: number;
  /** The ceiling the operator configured. */
  readonly cap: number;
  /**
   * The most the operator authorises, when that is more than the forecast they wrote down.
   *
   * Two numbers because a forecast and a bound answer different questions and only one of them can
   * be wrong. A forecast is arithmetic over a run that has not happened; a bound is a commitment
   * about money. Collapsing them meant a forecast that was 5.7% low killed a run after it had paid
   * for a fifth of itself — 5,483 calls spent to report a number that four more folds could have
   * lived inside. Absent means `cap`, which is the old behaviour exactly.
   */
  readonly ceiling?: number;
  /** Folds that finished, in the order they were appended. */
  readonly folds: readonly FoldSpend[];
  /** Folds the run intends to complete. */
  readonly totalFolds: number;
  /**
   * Headroom applied to the extrapolation, in percent. Defaults to 110: within one run the same
   * configuration cost 5 retries in one fold and 8 in another, so the retry rate is not fixed.
   *
   * Percent rather than a multiplier because the projection must be the same number every time it
   * runs. `1150 * 3 * 1.1` is 3795.0000000000005 in binary floating point, which ceils to 3796 and
   * makes a run's own arithmetic look like a two-call discrepancy somewhere else.
   */
  readonly safetyPct?: number;
};

/**
 * One shape rather than a discriminated union.
 *
 * The union was the obvious encoding and the lane's own type check rejected every read of
 * `shortfall` inside `if (!forecast.ok)`, so the check that was supposed to protect the run from a
 * mis-sized ceiling would have needed a cast to compile. A record whose fields are always present
 * and whose zero means "nothing to report" keeps both numbers readable at the call site.
 */
export type BudgetForecast = {
  readonly ok: boolean;
  /** Attempts the whole run is expected to cost. */
  readonly projected: number;
  /** Room left under the bound; negative when the projection does not fit. */
  readonly margin: number;
  /** How far past the bound the projection goes, or zero when it fits. */
  readonly shortfall: number;
  /**
   * The ceiling to run the remaining folds under: the configured cap, raised to the projection when
   * the projection fits under the bound. This is the number the caller must authorise.
   */
  readonly cap: number;
  /** Whether `cap` is above the configured cap, which is a forecast that was low and says so. */
  readonly resized: boolean;
};

const DEFAULT_SAFETY_PCT = 110;

export function forecastBudget(ledger: BudgetLedger): BudgetForecast {
  const bound = Math.max(ledger.cap, ledger.ceiling ?? ledger.cap);
  const remaining = Math.max(0, ledger.totalFolds - ledger.folds.length);
  if (remaining === 0 || ledger.folds.length === 0) {
    // Nothing left to buy, or nothing yet measured. Both are "no evidence of a shortfall", and the
    // projection is what has already been spent because that is the only figure that is known.
    return {
      ok: true,
      projected: ledger.spent,
      margin: bound - ledger.spent,
      shortfall: 0,
      cap: ledger.cap,
      resized: false,
    };
  }
  const dearest = ledger.folds.reduce((most, fold) => (fold.calls > most ? fold.calls : most), 0);
  const safetyPct = ledger.safetyPct ?? DEFAULT_SAFETY_PCT;
  const projected = ledger.spent + Math.ceil((dearest * remaining * safetyPct) / 100);
  if (projected <= bound) {
    // It fits the bound. Whether it fits the *forecast* is now a fact about the forecast rather than
    // a decision about the run: the ceiling is raised to the projection so the remaining folds can
    // be bought, and `resized` carries the news that the estimate was low.
    const cap = Math.max(ledger.cap, projected);
    return {
      ok: true,
      projected,
      margin: bound - projected,
      shortfall: 0,
      cap,
      resized: cap > ledger.cap,
    };
  }
  return {
    ok: false,
    projected,
    margin: bound - projected,
    shortfall: projected - bound,
    cap: ledger.cap,
    resized: false,
  };
}
