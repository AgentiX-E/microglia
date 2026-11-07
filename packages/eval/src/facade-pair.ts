/**
 * The R49 paired-facade contract: one dispatch, one learning phase, one store,
 * two recall facades.
 *
 * R48 measured a floored memory arm in dispatch `42353229972` and compared it
 * with R47's as-is arm in `42337250684`. They did not share a learning phase or
 * a store (8 versus 12 distilled items), and the memory-free reference drifted
 * from `pass^4 = 0.30` to `0.44`. The reported `-6.00pp` was a difference
 * between two runs, not the contribution of one floor. `AUDIT` 34.35 / 34.36
 * and `TECH-DESIGN` 17.98 call this defect 29.
 *
 * `within-run-pair.ts` already refuses such a comparison at runtime. This
 * module is the layer ABOVE it: it resolves a dispatch's paired-facade plan,
 * attests the single scope both facades must share, maps the driver's per-task
 * `pass^4` inputs onto paired outcomes, and grades the result through that
 * invariant. Keep the two layers separate: the invariant says what a valid pair
 * IS, and this module says how one driver run PRODUCES one.
 *
 * Two deliberate constraints:
 *
 *  - The floored rung is read from `TAU_MIN_COVERAGE`, which the workflow takes
 *    from the dispatch's own pre-registration. Nothing here invents, clamps or
 *    revises a floor, and no accuracy is read at any point.
 *  - The result is a `FacadeContrast`, tagged `facade-contrast`. It is NOT the
 *    `l4-paired` memory-versus-reference reading the R45 revert rule grades,
 *    and it is never handed to `revertRule`.
 *
 * The subprocesses and the network belong to the driver and the CI job. Every
 * function here is pure and therefore fully testable on committed readings.
 */

import type { PassAtKInput } from './passk.js';
import type { ArmTask } from './l4.js';
import { AS_IS_FLOOR, resolveRecallFloor } from './tau2-recall-floor.js';
import { noMeasurementRefusal } from './provider-probe.js';
import {
  withinRunPair,
  type FacadeArm,
  type RunScope,
  type WithinRunPairVerdict,
} from './within-run-pair.js';

/** The one environment switch that enables a paired-facade dispatch. */
export const FACADE_PAIR_ENV = 'TAU_FACADE_PAIR';

/** The registered floor variable; `prereg-floor.ts` is its only source of truth. */
export const FACADE_FLOOR_ENV = 'TAU_MIN_COVERAGE';

const ENABLED_SWITCHES = new Set(['1', 'true', 'on', 'as-is-floored']);
const DISABLED_SWITCHES = new Set(['', '0', 'false', 'off', 'no']);

export type FacadePairPlan =
  | { readonly enabled: false; readonly reason: string }
  | {
      readonly enabled: true;
      readonly asIsFloor: number;
      readonly flooredFloor: number;
    };

/**
 * Resolve whether this dispatch is a within-run pair, and which two rungs it
 * may contrast.
 *
 * An unset switch leaves the single-facade path exactly as it was for every
 * dispatch before R49, so committed artefacts stay comparable. An enabled pair
 * MUST carry a registered floor that is a grid rung strictly above as-is:
 * `resolveRecallFloor` refuses arbitrary floats, and a pair of two identical
 * rungs would measure nothing. An unknown switch value is refused rather than
 * interpreted, because a silently disabled experiment is indistinguishable
 * from a completed one in a CI log.
 */
export function resolveFacadePairPlan(
  env: Readonly<Record<string, string | undefined>>,
): FacadePairPlan {
  const raw = env[FACADE_PAIR_ENV];
  const disabled: FacadePairPlan = {
    enabled: false,
    reason: 'no paired-facade dispatch was registered',
  };
  if (raw === undefined) return disabled;
  const value = raw.trim().toLowerCase();
  if (DISABLED_SWITCHES.has(value)) return disabled;
  if (!ENABLED_SWITCHES.has(value)) {
    throw new Error(
      `${FACADE_PAIR_ENV} must be a declared paired-facade switch, received '${raw}'`,
    );
  }

  const declared = env[FACADE_FLOOR_ENV];
  if (declared === undefined || declared.trim() === '') {
    throw new Error(
      `a paired facade needs ${FACADE_FLOOR_ENV} from the dispatch's pre-registration`,
    );
  }
  // `resolveRecallFloor` validates the finite unit interval and the fixed grid.
  const floor = resolveRecallFloor(env);
  if (floor <= AS_IS_FLOOR) {
    throw new Error(
      `a paired facade needs a treatment rung strictly above ${AS_IS_FLOOR}, received '${declared}'`,
    );
  }
  return { enabled: true, asIsFloor: AS_IS_FLOOR, flooredFloor: floor };
}

/**
 * Map one facade's per-task `pass^4` inputs onto paired outcomes.
 *
 * A task is `passedAll` only when every trial passed, which is the k=4 reading
 * `l4-pair.ts` already grades. A task without an id is refused rather than
 * renamed: `PassAtKInput.taskId` is optional because the estimator does not
 * need it, but a paired test does. The empty set is returned unchanged so that
 * `withinRunPair` can report NO_MEASUREMENT instead of this layer inventing a
 * result for a facade that scored nothing.
 */
export function facadeArmTasks(tasks: readonly PassAtKInput[]): readonly ArmTask[] {
  const seen = new Set<string>();
  return tasks.map((task) => {
    if (task.taskId === undefined || task.taskId.trim() === '') {
      throw new Error('a paired facade cannot grade a task with no task id');
    }
    if (!Number.isFinite(task.trials) || task.trials < 0) {
      throw new Error(`task '${task.taskId}' has an invalid trial count`);
    }
    if (seen.has(task.taskId)) {
      throw new Error(`a paired facade cannot grade duplicate task id '${task.taskId}'`);
    }
    seen.add(task.taskId);
    return { id: task.taskId, passedAll: task.successes === task.trials };
  });
}

/**
 * A deterministic, printable digest of the one distilled store.
 *
 * `RunScope.storeFingerprint` exists so that two arms which learned separately
 * cannot be graded as a pair even if every declared input happens to match.
 * Order independence matters because the store is read as a list whose order
 * is not part of the experiment. This is an identity attestation, NOT a
 * cryptographic commitment: FNV-1a over UTF-8 bytes is stable across Node and
 * browsers, needs no `node:crypto`, and is collision-resistant enough for one
 * process comparing two of its own arms.
 */
export function storeFingerprintOf(statements: readonly string[]): string {
  const normalised = statements
    .map((statement) => statement.trim())
    .filter((statement) => statement !== '')
    .sort();
  const bytes = new TextEncoder().encode(normalised.join('\n'));
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `store:${hash.toString(16).padStart(8, '0')}`;
}

/** What one driver run must attest before two facades can be called a pair. */
export type FacadeShared = {
  readonly dispatchId: string;
  readonly preregId: string;
  /** The statements of the single distilled store, before either facade recalls. */
  readonly storeStatements: readonly string[];
  readonly learnSplit: readonly string[];
  readonly testSplit: readonly string[];
  readonly seed: number;
  readonly trials: number;
  readonly model: string;
};

/**
 * Attest the eight fields `within-run-pair.ts` compares.
 *
 * The splits are copied, so a later mutation of the driver's arrays cannot
 * rewrite an attestation the verdict was already computed on. Basic
 * malformed-instrument checks live here as well as in `withinRunPair`: a
 * missing dispatch id is a broken instrument at the point it is produced, and
 * reporting it early gives the operator an actionable repair.
 */
export function facadeScope(shared: FacadeShared): RunScope {
  if (shared.dispatchId.trim() === '') throw new Error('facadeScope needs a dispatchId');
  if (shared.preregId.trim() === '') throw new Error('facadeScope needs a preregId');
  if (shared.model.trim() === '') throw new Error('facadeScope needs a model');
  if (shared.storeStatements.length === 0) {
    throw new Error('facadeScope needs the one distilled store to attest');
  }
  if (shared.learnSplit.length === 0 || shared.testSplit.length === 0) {
    throw new Error('facadeScope needs both halves of the split');
  }
  if (!Number.isFinite(shared.seed)) throw new Error('facadeScope needs a finite seed');
  if (!Number.isInteger(shared.trials) || shared.trials <= 0) {
    throw new Error('facadeScope needs a positive integer trial count');
  }
  return {
    dispatchId: shared.dispatchId,
    preregId: shared.preregId,
    storeFingerprint: storeFingerprintOf(shared.storeStatements),
    learnSplit: [...shared.learnSplit],
    testSplit: [...shared.testSplit],
    seed: shared.seed,
    trials: shared.trials,
    model: shared.model,
  };
}

/**
 * Attest the pair scope, or refuse as a no-measurement.
 *
 * `facadeScope` is strict on purpose -- an unattestable pair is not a pair --
 * but a thrown error at the driver boundary reaches the lane as an unhandled
 * crash, and a crash is indistinguishable from a bug. R41 is why this matters:
 * 36.0 was scored from a store that held nothing and the reading looked like a
 * result. The lane therefore gets the same labelled refusal it gets for a
 * provider outage, so an empty store is reported as an instrument that did not
 * measure rather than as a stack trace or a number.
 */
export function attestPairScope(shared: FacadeShared): RunScope {
  try {
    return facadeScope(shared);
  } catch (error) {
    throw noMeasurementRefusal((error as Error).message);
  }
}

/** One facade's reading as the driver produced it. */
export type FacadeReading = {
  readonly scope: RunScope;
  readonly tasks: readonly PassAtKInput[];
  readonly servedPacks: number;
};

/**
 * Grade two facades of one driver run through the within-run invariant.
 *
 * A disabled plan produces NO_MEASUREMENT rather than a comparison, so a lane
 * that forgot to register the pair cannot accidentally publish a contrast.
 * Mapping errors (an unnamed or repeated task) are converted into the same
 * terminal state: a broken instrument is not a result. Only a PAIRED verdict
 * carries a `FacadeContrast`, and that contrast is the floor's contribution --
 * never the memory-versus-reference `l4-paired` gate.
 */
export function facadePairVerdict(input: {
  readonly plan: FacadePairPlan;
  readonly asIs: FacadeReading;
  readonly floored: FacadeReading;
}): WithinRunPairVerdict {
  if (!input.plan.enabled) {
    return { state: 'NO_MEASUREMENT', reason: input.plan.reason };
  }
  let asIsTasks: readonly ArmTask[];
  let flooredTasks: readonly ArmTask[];
  try {
    asIsTasks = facadeArmTasks(input.asIs.tasks);
    flooredTasks = facadeArmTasks(input.floored.tasks);
  } catch (error) {
    return { state: 'NO_MEASUREMENT', reason: (error as Error).message };
  }
  const asIs: FacadeArm = {
    arm: 'as-is',
    floor: AS_IS_FLOOR,
    scope: input.asIs.scope,
    servedPacks: input.asIs.servedPacks,
    tasks: asIsTasks,
  };
  const floored: FacadeArm = {
    arm: 'floored',
    floor: input.plan.flooredFloor,
    scope: input.floored.scope,
    servedPacks: input.floored.servedPacks,
    tasks: flooredTasks,
  };
  return withinRunPair(asIs, floored);
}

/**
 * Whether the treatment actually arrived at the agent.
 *
 * R42 served two hundred empty packs and the record could not say so. A
 * PAIRED verdict with `servedPacks.floored === 0` is a valid zero-delta pair
 * of two untreated arms, not evidence that a floor does nothing. Any other
 * terminal state is not a delivery statement at all.
 */
export function treatmentDelivered(verdict: WithinRunPairVerdict): boolean {
  return verdict.state === 'PAIRED' && verdict.contrast.servedPacks.floored > 0;
}

/**
 * The serialisable record of one paired-facade dispatch.
 *
 * `l4.ts` writes this as its own artefact (`poc-l4-facade-pair.json`), separate
 * from `poc-l4.json`. Keeping them apart is the point: the main artefact still
 * grades the memory arm against the memory-free reference through `l4-paired`,
 * while this one grades floor against floor. Merging them is how defect 28 and
 * defect 29 became representable in the first place.
 */
export type PairedFacadeReading = {
  readonly dispatchId: string;
  readonly preregId: string;
  readonly floors: { readonly asIs: number; readonly floored: number };
  readonly scope: RunScope;
  readonly servedPacks: { readonly asIs: number; readonly floored: number };
  readonly pass4: { readonly asIs: number; readonly floored: number };
  readonly verdict: WithinRunPairVerdict;
  readonly treatmentDelivered: boolean;
  /** The common seed both facades were evaluated with; CRN is an attested fact. */
  readonly seed: number;
  readonly model: string;
};

/**
 * One line, and one terminal state, for the workflow's readback step.
 *
 * REFUSED_CROSS_RUN and NO_MEASUREMENT say nothing about the floor: the first
 * is a broken design, the second is a broken instrument. Only PAIRED reports a
 * delta, and it reports the interval, the p-value, the paired count and the
 * delivered population beside it, so a reader cannot quote the point estimate
 * alone. No revert rule is consulted here.
 */
export function facadePairSummary(reading: PairedFacadeReading): string {
  const verdict = reading.verdict;
  if (verdict.state === 'REFUSED_CROSS_RUN') {
    return `REFUSED_CROSS_RUN: ${verdict.reason}`;
  }
  if (verdict.state === 'NO_MEASUREMENT') {
    return `NO_MEASUREMENT: ${verdict.reason}`;
  }
  const comparison = verdict.contrast.comparison;
  return (
    `PAIRED: floor ${reading.floors.floored} delta ${comparison.deltaPp.toFixed(2)}pp ` +
    `[${comparison.ciLowPp.toFixed(2)}, ${comparison.ciHighPp.toFixed(2)}] ` +
    `p=${comparison.p.toFixed(4)} n=${comparison.paired} ` +
    `served ${reading.servedPacks.floored}/${reading.servedPacks.asIs} ` +
    `delivered=${reading.treatmentDelivered}`
  );
}

/** The terminal state of a readback, which the workflow may gate on. */
export function facadePairState(reading: PairedFacadeReading): string {
  return reading.verdict.state;
}

/** The document `l4.ts` writes beside `poc-l4.json`. */
export type PairedFacadeArtifact = PairedFacadeReading & {
  readonly id: 'poc-l4-facade-pair';
  readonly title: string;
  readonly ranAt: string;
  readonly state: string;
  readonly summary: string;
  readonly notes: readonly string[];
};

/**
 * Build the paired-facade artefact. Pure: the timestamp is supplied so a test
 * can assert the whole document. The artefact is deliberately flat, so the
 * workflow's readback step can read `state` and `summary` without knowing the
 * nested verdict shape.
 */
export function pairedFacadeArtifact(
  reading: PairedFacadeReading,
  ranAt: string,
): PairedFacadeArtifact {
  return {
    id: 'poc-l4-facade-pair',
    title: 'R49 — within-run paired recall facades on one distilled store',
    ranAt,
    state: facadePairState(reading),
    summary: facadePairSummary(reading),
    ...reading,
    notes: [
      'Two facades of ONE driver run: one dispatch, one learning phase, one distilled store, one held-out split, one common seed stream and one model; only buildPack minCoverage differs.',
      'This is a facade-contrast, NOT the l4-paired memory-versus-reference gate the R45 revert rule grades. No revert rule is consulted here.',
      'Only PAIRED reports a contribution; REFUSED_CROSS_RUN and NO_MEASUREMENT report none.',
      'The main poc-l4 artefact still grades the registered (floored) facade against the memory-free reference arm.',
      'No accuracy, l4-paired value or offline proxy was used to choose, justify or revise the floor.',
    ],
  };
}

/** What the workflow is allowed to conclude from a paired-facade artefact. */
export type FacadePairReadback = {
  readonly state: 'PAIRED' | 'REFUSED_CROSS_RUN' | 'NO_MEASUREMENT';
  readonly summary: string;
  readonly treatmentDelivered: boolean;
  readonly floor: number;
  readonly servedPacks: { readonly asIs: number; readonly floored: number };
  /** Present only for PAIRED; null in the other two terminal states. */
  readonly paired: number | null;
  readonly deltaPp: number | null;
  readonly ciLowPp: number | null;
  readonly ciHighPp: number | null;
  readonly p: number | null;
};

const READBACK_STATES = ['PAIRED', 'REFUSED_CROSS_RUN', 'NO_MEASUREMENT'] as const;

/**
 * Read an artefact back into the three terminal states.
 *
 * Strict on purpose. A missing or unknown `state` is refused rather than
 * defaulted to PAIRED, because a defaulted readback is how a run that never
 * measured would be reported as a result. REFUSED_CROSS_RUN and
 * NO_MEASUREMENT carry NO delta, NO p-value and NO paired count: fields that
 * only a PAIRED comparison is defined on.
 */
export function readFacadePairArtifact(value: unknown): FacadePairReadback {
  if (typeof value !== 'object' || value === null) throw new Error('the artefact is not an object');
  const record = value as Record<string, unknown>;
  const state = record['state'];
  if (typeof state !== 'string' || !(READBACK_STATES as readonly string[]).includes(state)) {
    throw new Error(`the artefact has no recognised terminal state, received '${String(state)}'`);
  }
  const summary = record['summary'];
  const floors = record['floors'];
  const served = record['servedPacks'];
  const verdict = record['verdict'];
  const delivered = record['treatmentDelivered'];
  if (
    typeof summary !== 'string' ||
    typeof floors !== 'object' ||
    floors === null ||
    typeof (floors as Record<string, unknown>)['floored'] !== 'number' ||
    typeof served !== 'object' ||
    served === null ||
    typeof (served as Record<string, unknown>)['floored'] !== 'number' ||
    typeof (served as Record<string, unknown>)['asIs'] !== 'number' ||
    typeof verdict !== 'object' ||
    verdict === null ||
    typeof delivered !== 'boolean'
  ) {
    throw new Error('the artefact is missing a field the readback must attest');
  }
  // Narrow each number to its own local: an indexed read of a `Record` under
  // `noUncheckedIndexedAccess` stays optional, so the checks above do not by
  // themselves convince the type checker that the field exists.
  const floored = (floors as Record<string, unknown>)['floored'];
  const servedAsIs = (served as Record<string, unknown>)['asIs'];
  const servedFloored = (served as Record<string, unknown>)['floored'];
  if (
    typeof floored !== 'number' ||
    typeof servedAsIs !== 'number' ||
    typeof servedFloored !== 'number'
  ) {
    throw new Error('the artefact is missing a numeric field the readback must attest');
  }
  const base = {
    state: state as FacadePairReadback['state'],
    summary,
    treatmentDelivered: delivered,
    floor: floored,
    servedPacks: { asIs: servedAsIs, floored: servedFloored },
    paired: null,
    deltaPp: null,
    ciLowPp: null,
    ciHighPp: null,
    p: null,
  } satisfies FacadePairReadback;
  if (state !== 'PAIRED') return base;
  const contrast = (verdict as Record<string, unknown>)['contrast'];
  if (typeof contrast !== 'object' || contrast === null) {
    throw new Error('a PAIRED artefact must carry its contrast');
  }
  const comparison = (contrast as Record<string, unknown>)['comparison'];
  if (typeof comparison !== 'object' || comparison === null) {
    throw new Error('a PAIRED artefact must carry its comparison');
  }
  const c = comparison as Record<string, unknown>;
  const paired = c['paired'];
  const deltaPp = c['deltaPp'];
  const ciLowPp = c['ciLowPp'];
  const ciHighPp = c['ciHighPp'];
  const p = c['p'];
  if (
    typeof paired !== 'number' ||
    typeof deltaPp !== 'number' ||
    typeof ciLowPp !== 'number' ||
    typeof ciHighPp !== 'number' ||
    typeof p !== 'number'
  ) {
    throw new Error('a PAIRED comparison needs paired, deltaPp, ciLowPp, ciHighPp and p');
  }
  return { ...base, paired, deltaPp, ciLowPp, ciHighPp, p };
}
