import {
  COVERAGE_FLOORS,
  type CoverageHistogram,
  type UseCensus,
} from './tau2-use-census.js';
import { decideFloor, type CostWeights } from './u3-decision.js';

/**
 * The single recall-floor knob U3 is allowed to turn.
 *
 * R47 committed the first real retention curve (run `42337250684`). Its floor
 * is decided from that curve by `decideFloor` with cost weights registered
 * BEFORE the U3 dispatch. Three constraints keep the knob honest:
 *
 *  1. An unset variable leaves the as-is configuration untouched, so every
 *     earlier dispatch stays comparable to its own committed artefact.
 *  2. A set value must be a rung of the fixed `COVERAGE_FLOORS` grid. An
 *     arbitrary float would let a floor be tuned after the readout.
 *  3. The floor a registration declares is recomputed from the committed
 *     histogram by `prereg-floor.ts`; a mismatch refuses the dispatch.
 *
 * No accuracy, `l4-paired` or task-level outcome is read here.
 */

/** `buildPack` keeps every hit when the floor is zero: the as-is configuration. */
export const AS_IS_FLOOR = 0;

/**
 * Registered for U3 before its dispatch. `gamma > alpha > beta` charges a
 * false-positive injection more than a correct reuse is rewarded, and charges
 * an abstained pack least, following RSCB-MC's asymmetric abstention rule.
 * There is no default in `decideFloor`: on the real R47 curve these weights
 * select `0.01`, while an abstention-averse ordering selects `0`.
 */
export const U3_COST_WEIGHTS: CostWeights = { alpha: 1, gamma: 3, beta: 0.5 };

/** Resolve the floor a dispatch is permitted to apply. Refuse rather than clamp. */
export function resolveRecallFloor(env: Readonly<Record<string, string | undefined>>): number {
  const raw = env['TAU_MIN_COVERAGE'];
  if (raw === undefined || raw.trim() === '') return AS_IS_FLOOR;
  const value = Number(raw.trim());
  if (!Number.isFinite(value)) {
    throw new Error(`TAU_MIN_COVERAGE must be a finite number, received '${raw}'`);
  }
  if (value < 0 || value > 1) {
    throw new Error(`TAU_MIN_COVERAGE must lie in the unit interval, received '${raw}'`);
  }
  if (!(COVERAGE_FLOORS as readonly number[]).includes(value)) {
    throw new Error(`TAU_MIN_COVERAGE must be a rung of the registered COVERAGE_FLOORS grid, received '${raw}'`);
  }
  return value;
}

/**
 * Recompute the floor from a committed histogram with registered weights.
 * A refused population is an unusable instrument, not a reason to guess.
 */
export function committedFloor(
  coverage: CoverageHistogram,
  use: UseCensus,
  weights: CostWeights = U3_COST_WEIGHTS,
): number {
  const decision = decideFloor(coverage, use, weights);
  if (decision.chosen === undefined) {
    throw new Error(`cannot compute a floor: ${decision.reason}`);
  }
  return decision.chosen;
}
