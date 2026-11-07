import { COVERAGE_FLOORS, type CoverageFloorRow, type CoverageHistogram, type UseCensus } from './tau2-use-census.js';

/**
 * U3's floor decision, computed from a COMMITTED histogram and census alone.
 *
 * R47 (run `42337250684`) committed the first real retention curve. TECH-DESIGN
 * 17.95 requires U3's `minCoverage` floor to be chosen from that curve, never
 * from `l4-paired` or any accuracy number: R46 read `0.00pp [-10, +10]
 * p=1.0000 n=50` with MDE 13.73pp, and R47 read `12.00pp p=0.1094` with MDE
 * 17.72pp, so every candidate floor is inside the noise floor.
 *
 * This module is deliberately a decision over structure, not a threshold
 * copied from a competitor. It takes no accuracy input, applies no floor to
 * any pack, and changes no artefact. The cost weights are a required argument
 * with NO default, because the real committed curve proved the choice is not
 * robust to them: a false-positive-averse regime selects `0.01`, while an
 * abstention-averse regime selects `0` (the as-is configuration). The weights
 * and the tie-break rule must be registered before the dispatch that applies
 * the floor; this function makes that registration checkable.
 */

/** Registered before dispatch. `gamma > alpha > beta` penalises a false-positive
 * injection more than a correct reuse is rewarded, and charges an abstained
 * pack least. There is intentionally no default: see the module comment. */
export type CostWeights = {
  /** Reward for one relevant pair retained at this rung. */
  readonly alpha: number;
  /** Penalty for one false-positive (zero-coverage) pair still injected. */
  readonly gamma: number;
  /** Cost of one served pack that this rung would empty. */
  readonly beta: number;
};

/** One rung of the structure-only cost curve, all counts from committed data. */
export type FloorCostRow = {
  readonly minCoverage: number;
  /** Retained pairs with coverage above zero at this rung. */
  readonly relevantPairs: number;
  /** Zero-coverage pairs still injected at this rung. */
  readonly falsePositivePairs: number;
  /** Served packs this rung would empty (abstention as a first-class action). */
  readonly abstainedPacks: number;
  /** `alpha * relevant - gamma * falsePositive - beta * abstained`. */
  readonly net: number;
};

export type FloorTieBreak = 'unique' | 'least-aggressive' | 'refused';

export type FloorDecision = {
  /** Rungs attaining the maximum net cost, in grid order. May be a plateau. */
  readonly admissible: readonly number[];
  /** The registered tie-break's pick, or `undefined` when the input was refused. */
  readonly chosen: number | undefined;
  readonly tieBreak: FloorTieBreak;
  readonly curve: readonly FloorCostRow[];
  readonly reason: string;
};

function refuse(reason: string): FloorDecision {
  return { admissible: [], chosen: undefined, tieBreak: 'refused', curve: [], reason };
}

/**
 * Validate the committed population, then score each rung.
 *
 * The three R47 reconciliation identities are preconditions, not afterthoughts:
 * a broken instrument cannot be interpreted as a finding. The grid is checked
 * against the fixed `COVERAGE_FLOORS` so an implementation detail cannot widen
 * it. Quantile ordering and retention monotonicity are checked for the same
 * reason. Every count comes from `coverage`/`use`; no raw pair population is
 * needed, so two readers of one artefact compute the same decision.
 */
export function decideFloor(
  coverage: CoverageHistogram,
  use: UseCensus,
  weights: CostWeights,
): FloorDecision {
  const rows = coverage.floors;

  if (rows.length !== COVERAGE_FLOORS.length) return refuse('grid length differs from COVERAGE_FLOORS');
  if (rows[0]?.minCoverage !== 0) return refuse('grid first rung is not zero');
  if (rows.some((r, i) => r.minCoverage !== COVERAGE_FLOORS[i])) {
    return refuse('grid values differ from COVERAGE_FLOORS');
  }

  if (coverage.measuredPairs + coverage.unmeasurablePairs !== use.injectedPairs) {
    return refuse('pair-population identity violated');
  }
  if (rows.some((r) => r.retainedPacks + r.emptiedPacks + coverage.unmeasurablePacks !== use.recallServed)) {
    return refuse('pack-population identity violated');
  }
  const zero = rows[0] as CoverageFloorRow;
  if (zero.retainedPairs !== coverage.measuredPairs || zero.emptiedPacks !== 0) {
    return refuse('zero rung identity violated');
  }

  const q = coverage.nonzeroQuantiles;
  const quantiles = [q.min, q.p10, q.p25, q.p50, q.p75, q.p90, q.max];
  if (quantiles.some((v, i) => i > 0 && v < (quantiles[i - 1] as number))) {
    return refuse('quantile ordering violated');
  }

  // `use.zeroCoveragePairs` counts every zero-coverage pair, including the
  // content-free ones already reported as `unmeasurablePairs` by the histogram.
  // Subtracting recovers the measurable zero mass that rung zero still injects.
  const measurableZero = use.zeroCoveragePairs - coverage.unmeasurablePairs;
  if (measurableZero < 0) return refuse('negative measurable zero-coverage count');

  if (rows.some((r, i) => i > 0 &&
      (r.retainedPairs > (rows[i - 1] as CoverageFloorRow).retainedPairs ||
       r.emptiedPacks < (rows[i - 1] as CoverageFloorRow).emptiedPacks))) {
    return refuse('retention monotonicity violated');
  }

  const curve: FloorCostRow[] = rows.map((r) => {
    // At rung zero, every retained pair is injected; the zero-coverage ones are
    // false positives. A positive rung keeps coverage >= floor > 0, so none can
    // be a zero-coverage false positive.
    const falsePositivePairs = r.minCoverage === 0 ? measurableZero : 0;
    const relevantPairs = r.retainedPairs - falsePositivePairs;
    const abstainedPacks = r.emptiedPacks;
    const net = weights.alpha * relevantPairs - weights.gamma * falsePositivePairs - weights.beta * abstainedPacks;
    return { minCoverage: r.minCoverage, relevantPairs, falsePositivePairs, abstainedPacks, net };
  });

  const maxNet = Math.max(...curve.map((row) => row.net));
  const admissible = curve.filter((row) => row.net === maxNet).map((row) => row.minCoverage);
  const chosen = admissible.length > 0 ? Math.min(...admissible) : undefined;
  // Registered tie-break: on a plateau, pick the least aggressive filter.
  const tieBreak: FloorTieBreak = admissible.length > 1 ? 'least-aggressive' : 'unique';

  return {
    admissible,
    chosen,
    tieBreak,
    curve,
    reason: 'structure-only argmax over registered cost, with least-aggressive tie-break',
  };
}
