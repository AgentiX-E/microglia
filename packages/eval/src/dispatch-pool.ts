/**
 * One arm, several dispatches, one estimate.
 *
 * R131 read `pass^4` **0.625** on the arm that read **0.775** in R123a and **0.750** in R124 — same store shape,
 * same split, same headers, same gate setting. The record had been quoting the largest of the three as the arm's
 * score, and Appendix AR had ranked it above a competitor on that basis. A single number from a single sample of
 * forty tasks is not an estimate of an arm; it is one draw from a distribution whose spread this lane has now
 * measured three times.
 *
 * The arithmetic that turns those draws into an estimate is a random-effects pool, and the reason it is a module
 * rather than a mean of three numbers is that the interesting quantity is not the mean — it is the **ratio of
 * between-dispatch to within-dispatch variance**. When that ratio is large, the pooled value is a summary of
 * disagreeing runs rather than an estimate of one quantity, and quoting it without the interval is what produced
 * the retracted ranking. When it is zero, the dispatches differ only by sampling noise and the pool is sharp
 * enough to order two arms.
 *
 * Four decisions, each of which changes the number a reader would quote:
 *
 *  - **DerSimonian–Laird for the between-dispatch variance**, truncated at zero. It is the standard estimator for
 *    a small number of studies and it needs no assumption about the shape of the arm's variability; the
 *    truncation is what makes a homogeneous set of dispatches collapse to a fixed-effect pool instead of
 *    inheriting a negative variance.
 *  - **The t quantile on `dispatches - 1` degrees of freedom**, not the normal one. With three dispatches that is
 *    4.303 against 1.96 — a factor of 2.2 on the interval, and the difference between "0.775 beats 0.675" and
 *    "these cannot be ordered". Using 1.96 here is exactly how a three-run record talks itself into a ranking.
 *  - **I² travels with the estimate.** A pooled value over heterogeneous dispatches is a summary; a reader has to
 *    be able to see that without recomputing it.
 *  - **Nothing is dropped.** A dispatch whose rate is unreadable, or whose `k` differs, throws rather than being
 *    filtered out: a pool of the readable subset of a record's runs is a selection, and this record has paid for
 *    selections made silently (AUDIT 34.164).
 */

/** One arm's reading from one dispatch. */
export type DispatchRow = {
  /** The dispatch, as the artefact or the reader names it. */
  readonly dispatch: string;
  /** The `k` the arm ran at, because a `pass^2` and a `pass^4` are different statistics. */
  readonly k: number;
  /** Held-out tasks the reading covers. */
  readonly tasks: number;
  /** `pass^k` over those tasks. */
  readonly passAtK: number;
  /** Episode-level rate, when the artefact carries one. Never pooled here; carried through for the line. */
  readonly episodeRate?: number;
};

/** What a pool of one arm's dispatches establishes. */
export type DispatchPool = {
  readonly dispatches: number;
  /** The pooled `pass^k`. */
  readonly pooled: number;
  /** 95% interval on the pooled value, in `pass^k` units. */
  readonly low: number;
  readonly high: number;
  /** The same interval in percentage points, which is how this record quotes deltas. */
  readonly halfWidthPp: number;
  /** Between-dispatch variance, truncated at zero. */
  readonly tau2: number;
  /** Share of the total spread that is between dispatches. */
  readonly iSquared: number;
  /** Degrees of freedom the interval used, and the quantile it used them at. */
  readonly df: number;
  readonly quantile: number;
  /** `random-effects` when the dispatches disagree by more than their own sampling error, else `fixed-effect`. */
  readonly label: 'random-effects' | 'fixed-effect';
  readonly k: number;
  readonly tasks: readonly number[];
};

/**
 * Two-sided 97.5% quantiles of Student's t, by degrees of freedom.
 *
 * A table rather than a library because the pool is small by construction — a record with more than ten
 * dispatches of one arm would not need this module — and because the value has to be inspectable: the whole
 * argument for using it is that 4.303 is not 1.96.
 */
const T975: readonly number[] = [
  12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.16, 2.145, 2.131,
  2.12, 2.11, 2.101, 2.093, 2.086, 2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048, 2.045, 2.042,
];

/**
 * The t quantile for a dispatch count, falling back to the normal quantile past the table.
 *
 * No guard for `dispatches < 2`: `poolDispatches` returns `undefined` before it gets here, so a guard would be a
 * branch no run can take — and this record has spent four rounds removing those rather than counting them as
 * coverage.
 */
function quantileFor(dispatches: number): number {
  return T975[dispatches - 2] ?? 1.96;
}

/**
 * Pool repeated dispatches of one arm.
 *
 * `undefined` when there are fewer than two: one dispatch is a draw, and wrapping it in an interval would make
 * it look like an estimate. Everything else that cannot be read throws — see the module note.
 */
export function poolDispatches(rows: readonly DispatchRow[]): DispatchPool | undefined {
  if (rows.length < 2) return undefined;
  const k = rows[0]?.k;
  for (const row of rows) {
    if (row.k !== k) {
      throw new RangeError(
        `a pool cannot mix k: '${String(rows[0]?.dispatch)}' ran at k=${String(k)} and ` +
          `'${row.dispatch}' at k=${String(row.k)}; pass^${String(row.k)} is not a pass^${String(k)}`,
      );
    }
    if (!Number.isFinite(row.passAtK) || row.passAtK < 0 || row.passAtK > 1) {
      throw new RangeError(
        `'${row.dispatch}' reports ${String(row.passAtK)}, which is not a rate between 0 and 1`,
      );
    }
    if (!Number.isInteger(row.tasks) || row.tasks < 1) {
      throw new RangeError(`'${row.dispatch}' reports ${String(row.tasks)} task(s), which is not a count`);
    }
  }
  // Within-dispatch variance of a proportion. At p=0 or p=1 the variance is zero and its weight infinite, so
  // the proportion is nudged by half a task — the standard continuity correction, and stated here rather than
  // hidden: a run that swept its split would otherwise carry a weight of infinity.
  const variance = (row: DispatchRow): number => {
    const p = (row.passAtK * row.tasks + 0.5) / (row.tasks + 1);
    return (p * (1 - p)) / row.tasks;
  };
  const weights = rows.map((row) => 1 / variance(row));
  const sumW = weights.reduce((sum, w) => sum + w, 0);
  const fixedMean = rows.reduce((sum, row, i) => sum + (weights[i] as number) * row.passAtK, 0) / sumW;

  const q = rows.reduce((sum, row, i) => sum + (weights[i] as number) * (row.passAtK - fixedMean) ** 2, 0);
  const qDf = rows.length - 1;
  const sumW2 = weights.reduce((sum, w) => sum + w * w, 0);
  const c = sumW - sumW2 / sumW;
  // `c` is strictly positive for any pool of two or more rows, so the only truncation that can fire is the one
  // the estimator needs: a negative between-dispatch variance is zero between-dispatch variance.
  const tau2 = Math.max(0, (q - qDf) / c);
  const iSquared = q > qDf && q > 0 ? (q - qDf) / q : 0;

  const randomWeights = rows.map((row) => 1 / (variance(row) + tau2));
  const sumR = randomWeights.reduce((sum, w) => sum + w, 0);
  const pooled = rows.reduce((sum, row, i) => sum + (randomWeights[i] as number) * row.passAtK, 0) / sumR;
  const standardError = Math.sqrt(1 / sumR);
  // The quantile follows the variance the estimate is actually made of. When nothing is between dispatches the
  // uncertainty is the episodes' own, and its degrees of freedom are the episodes — the normal quantile. When the
  // dispatches disagree, the estimate's uncertainty is a variance estimated from `dispatches` numbers, and the t
  // quantile on `dispatches - 1` is the honest one. Applying t(k-1) to a homogeneous pair would report ±36pp for
  // two runs of 160 episodes that agree, which is not a conservative reading but a wrong one.
  const random = tau2 > 0;
  const quantile = random ? quantileFor(rows.length) : 1.96;
  const df = random ? rows.length - 1 : rows.reduce((sum, row) => sum + row.tasks, 0) - rows.length;
  const halfWidth = quantile * standardError;

  return {
    dispatches: rows.length,
    pooled,
    low: Math.max(0, pooled - halfWidth),
    high: Math.min(1, pooled + halfWidth),
    halfWidthPp: halfWidth * 100,
    tau2,
    iSquared,
    df,
    quantile,
    label: tau2 > 0 ? 'random-effects' : 'fixed-effect',
    k: k as number,
    tasks: rows.map((row) => row.tasks),
  };
}

/**
 * The sentence a reader prints.
 *
 * It carries the interval *and* the heterogeneity, because the pooled value alone is the number Appendix AR
 * quoted. The last clause states what the estimate cannot do rather than leaving it to be inferred: an interval
 * that wide does not order two arms, and a record that has retracted one ranking should say so where the number
 * is printed.
 */
export function dispatchPoolLine(reading: DispatchPool | undefined): string {
  if (reading === undefined) {
    return (
      'dispatch pool: not measured — one dispatch is a draw and not an estimate, so two are the minimum a ' +
      'pool can say anything about'
    );
  }
  const pct = (value: number): string => (value * 100).toFixed(2);
  const tasks = [...new Set(reading.tasks)].join('/');
  const spread =
    reading.iSquared === 0
      ? 'the dispatches agree within their own sampling error'
      : `${pct(reading.iSquared)}% of the spread is between-dispatch, so this is a summary of disagreeing runs`;
  const orders =
    reading.halfWidthPp > 10
      ? `an interval this wide does not order two arms`
      : `an interval this width can order two arms ${(2 * reading.halfWidthPp).toFixed(1)}pp apart`;
  return (
    `dispatch pool: ${String(reading.dispatches)} dispatch(es) at k=${String(reading.k)} over ${tasks} task(s): ` +
    `pass^${String(reading.k)} ${pct(reading.pooled)}% [${pct(reading.low)}, ${pct(reading.high)}] ` +
    `(±${reading.halfWidthPp.toFixed(2)}pp at ` +
    `${reading.label === 'random-effects' ? `t(${String(reading.df)})` : 'z'}=${reading.quantile.toFixed(3)}, ` +
    `${reading.label}) — ${spread}; ${orders}`
  );
}

/**
 * Read one row out of an arm document.
 *
 * `undefined` when the document does not say which `k` it ran: every artefact before R92 wrote `pass4` without a
 * `k`, and a `k` inferred from the field's name is precisely how a `pass^2` would enter a pool of `pass^4`s.
 */
export function dispatchRowOf(dispatch: string, document: unknown): DispatchRow | undefined {
  if (typeof document !== 'object' || document === null) return undefined;
  const metrics = (document as { readonly metrics?: unknown }).metrics;
  if (typeof metrics !== 'object' || metrics === null) return undefined;
  const m = metrics as {
    readonly pass4?: unknown;
    readonly tasks?: unknown;
    readonly k?: unknown;
    readonly episode_rate?: unknown;
  };
  if (typeof m.pass4 !== 'number' || typeof m.tasks !== 'number' || typeof m.k !== 'number') return undefined;
  return {
    dispatch,
    k: m.k,
    tasks: m.tasks,
    passAtK: m.pass4,
    ...(typeof m.episode_rate === 'number' ? { episodeRate: m.episode_rate } : {}),
  };
}
