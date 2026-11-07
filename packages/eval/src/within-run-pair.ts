/**
 * The within-run pair invariant, lifted out of R48's readback into a typed,
 * testable production primitive.
 *
 * R48 (run `42353229972`) compared a floored memory arm against R47's as-is
 * memory arm. The two lived in different dispatches, so they did not share a
 * learning phase or a store: one distilled 8 items, the other 12, and the
 * memory-free reference arm drifted from `pass^4 = 0.30` to `0.44`. The
 * resulting `-6.00pp` was a difference between two runs, not the contribution
 * of one floor. `AUDIT` 34.35 / `TECH-DESIGN` 17.98 call this defect 29.
 *
 * The next arm is a WITHIN-RUN pair: one dispatch, one learning phase, one
 * distilled store, one held-out split, one seed stream and one model; only the
 * recall facade's `minCoverage` differs between the two memory arms. Common
 * random numbers give `Var(A - B) = 2 * sigma^2 * (1 - rho)` (`AUDIT` 34.36),
 * so two dispatches of one configuration are not a paired comparison no
 * matter how similar their inputs look.
 *
 * This module makes that requirement a runtime refusal rather than a sentence
 * in a document. It has three terminal states, matching the offline R48
 * verifier: PAIRED, REFUSED_CROSS_RUN and NO_MEASUREMENT. A refused pair is
 * never graded, and a pair with no measurement never produces a delta.
 *
 * Two distinctions are part of the type, because confusing them is defect 28
 * and defect 29:
 *
 *   - `l4-paired` (`l4-pair.ts`) pairs the memory arm against the memory-free
 *     reference arm INSIDE ONE DISPATCH. The R45 revert rule in `l4-revert.ts`
 *     consumes that reading and nothing else.
 *   - the contribution computed here contrasts two memory facades. It is
 *     explicitly tagged `facade-contrast` and must not be handed to
 *     `revertRule`, which grades a different population.
 *
 * Nothing here reads accuracy to choose, justify or revise a floor.
 */

import { compareArms, type ArmComparison, type ArmTask } from './l4.js';
import { AS_IS_FLOOR } from './tau2-recall-floor.js';
import { COVERAGE_FLOORS } from './tau2-use-census.js';

/** The pairing seed and resample count `l4-pair.ts` uses, kept identical. */
export const PAIR_SEED = 7;
export const PAIR_RESAMPLES = 10_000;

/**
 * Everything two arms must share to be a pair inside ONE dispatch.
 *
 * `storeFingerprint` is the digest of the single distilled store. Two arms
 * that learned separately cannot have the same one, so a changed learning
 * phase is refused even when every declared input happens to match.
 */
export type RunScope = {
  /** The one `sota.yml` run id both arms were measured in. */
  readonly dispatchId: string;
  /** The one pre-registration both arms execute. */
  readonly preregId: string;
  /** Digest of the one distilled store both facades recall from. */
  readonly storeFingerprint: string;
  readonly learnSplit: readonly string[];
  readonly testSplit: readonly string[];
  readonly seed: number;
  readonly trials: number;
  readonly model: string;
};

/** One memory facade's reading, tagged with the scope that produced it. */
export type FacadeArm = {
  readonly arm: 'as-is' | 'floored';
  /** `AS_IS_FLOOR` for `as-is`; a registered grid rung above it for `floored`. */
  readonly floor: number;
  readonly scope: RunScope;
  /** Packs the facade actually served; a zero says the treatment never arrived. */
  readonly servedPacks: number;
  /** Per-task `pass^4` outcomes, the only rows a paired test is defined on. */
  readonly tasks: readonly ArmTask[];
};

/** The contribution of a floor. Deliberately not a `PairedReading`. */
export type FacadeContrast = {
  readonly kind: 'facade-contrast';
  readonly comparison: ArmComparison;
  readonly floor: number;
  readonly servedPacks: { readonly asIs: number; readonly floored: number };
};

export type WithinRunPairVerdict =
  | { readonly state: 'PAIRED'; readonly contrast: FacadeContrast; readonly reason: string }
  | { readonly state: 'REFUSED_CROSS_RUN'; readonly reason: string }
  | { readonly state: 'NO_MEASUREMENT'; readonly reason: string };

const SCOPE_FIELDS = [
  'dispatchId',
  'preregId',
  'storeFingerprint',
  'learnSplit',
  'testSplit',
  'seed',
  'trials',
  'model',
] as const satisfies readonly (keyof RunScope)[];

function sameValue(first: unknown, second: unknown): boolean {
  if (Array.isArray(first) && Array.isArray(second)) {
    return first.length === second.length && first.every((entry, index) => entry === second[index]);
  }
  return Object.is(first, second);
}

/**
 * Name the first field on which two scopes disagree, or `undefined` when they
 * are the same run. A named field is what makes a refusal actionable: "the
 * store changed" and "the split changed" need different repairs.
 */
export function scopeDifference(first: RunScope, second: RunScope): string | undefined {
  for (const field of SCOPE_FIELDS) {
    if (!sameValue(first[field], second[field])) return field;
  }
  return undefined;
}

function refused(reason: string): WithinRunPairVerdict {
  return { state: 'REFUSED_CROSS_RUN', reason };
}

function unmeasured(reason: string): WithinRunPairVerdict {
  return { state: 'NO_MEASUREMENT', reason };
}

function validArm(arm: FacadeArm, label: string): string | undefined {
  if (arm.scope.dispatchId.trim() === '' || arm.scope.preregId.trim() === '') {
    return `${label} names no dispatch or pre-registration`;
  }
  if (arm.scope.storeFingerprint.trim() === '') {
    return `${label} has no store fingerprint, so no learning phase is attested`;
  }
  if (arm.scope.learnSplit.length === 0 || arm.scope.testSplit.length === 0) {
    return `${label} has an empty split`;
  }
  if (!Number.isInteger(arm.scope.trials) || arm.scope.trials <= 0) {
    return `${label} has a non-positive trial count`;
  }
  if (!Number.isFinite(arm.scope.seed) || arm.scope.model.trim() === '') {
    return `${label} has no seed or model`;
  }
  if (!Number.isFinite(arm.servedPacks) || arm.servedPacks < 0) {
    return `${label} has an invalid served pack count`;
  }
  if (arm.tasks.length === 0) {
    return `${label} scored no tasks`;
  }
  if (new Set(arm.tasks.map((task) => task.id)).size !== arm.tasks.length) {
    return `${label} repeats a task id`;
  }
  return undefined;
}

/**
 * Contrast two memory facades, refusing anything that is not one run.
 *
 * The order of the checks is the order of the failure modes R48 exposed: a
 * scope drift is reported as a refusal even when the task rows are also
 * missing, because "these are two different runs" is the primary fact and a
 * missing artefact is not evidence that the pairing was valid.
 */
export function withinRunPair(asIs: FacadeArm, floored: FacadeArm): WithinRunPairVerdict {
  if (asIs.arm !== 'as-is' || floored.arm !== 'floored') {
    return unmeasured('the two arms are not labelled as-is and floored');
  }
  if (asIs.floor !== AS_IS_FLOOR) {
    return unmeasured(`the as-is arm carries floor ${asIs.floor}, expected ${AS_IS_FLOOR}`);
  }
  if (!(COVERAGE_FLOORS as readonly number[]).includes(floored.floor) || floored.floor <= AS_IS_FLOOR) {
    return unmeasured(`the floored arm carries floor ${floored.floor}, which is not a registered rung above zero`);
  }

  const drift = scopeDifference(asIs.scope, floored.scope);
  if (drift !== undefined) {
    return refused(`the two facades disagree on '${drift}': this is a cross-run comparison, not a within-run pair`);
  }

  const asIsProblem = validArm(asIs, 'the as-is arm');
  if (asIsProblem !== undefined) return unmeasured(asIsProblem);
  const flooredProblem = validArm(floored, 'the floored arm');
  if (flooredProblem !== undefined) return unmeasured(flooredProblem);

  const asIsIds = asIs.tasks.map((task) => task.id).sort();
  const flooredIds = floored.tasks.map((task) => task.id).sort();
  if (asIsIds.length !== flooredIds.length || asIsIds.some((id, index) => id !== flooredIds[index])) {
    return unmeasured('the two facades did not score exactly the same tasks');
  }

  const comparison = compareArms(asIs.tasks, floored.tasks, PAIR_SEED, PAIR_RESAMPLES);
  if (comparison.paired === 0 || comparison.onlyFirst !== 0 || comparison.onlySecond !== 0) {
    return unmeasured('the paired comparison has no common task set');
  }

  return {
    state: 'PAIRED',
    contrast: {
      kind: 'facade-contrast',
      comparison,
      floor: floored.floor,
      servedPacks: { asIs: asIs.servedPacks, floored: floored.servedPacks },
    },
    reason: `within-run pair on ${comparison.paired} tasks; floor ${floored.floor} delivered ${floored.servedPacks} packs against ${asIs.servedPacks} as-is`,
  };
}
