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
  /** Room left under the cap; negative when the projection does not fit. */
  readonly margin: number;
  /** How far past the cap the projection goes, or zero when it fits. */
  readonly shortfall: number;
};

const DEFAULT_SAFETY_PCT = 110;

export function forecastBudget(ledger: BudgetLedger): BudgetForecast {
  const remaining = Math.max(0, ledger.totalFolds - ledger.folds.length);
  if (remaining === 0 || ledger.folds.length === 0) {
    // Nothing left to buy, or nothing yet measured. Both are "no evidence of a shortfall", and the
    // projection is what has already been spent because that is the only figure that is known.
    return {
      ok: true,
      projected: ledger.spent,
      margin: ledger.cap - ledger.spent,
      shortfall: 0,
    };
  }
  const dearest = ledger.folds.reduce((most, fold) => (fold.calls > most ? fold.calls : most), 0);
  const safetyPct = ledger.safetyPct ?? DEFAULT_SAFETY_PCT;
  const projected = ledger.spent + Math.ceil((dearest * remaining * safetyPct) / 100);
  if (projected <= ledger.cap) {
    return { ok: true, projected, margin: ledger.cap - projected, shortfall: 0 };
  }
  return { ok: false, projected, margin: ledger.cap - projected, shortfall: projected - ledger.cap };
}
