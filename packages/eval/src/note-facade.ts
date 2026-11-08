/**
 * R53's three-level note arm: one dispatch, one learning phase, one store, three recall
 * facades that differ in exactly one sentence.
 *
 * R49's paired facade (two arms, one `minCoverage` apart) is the pattern, generalised from
 * two arms to three. The reason it has to be one run rather than three is not tidiness: a
 * dispatch's corrections are produced by the model at run time, so two dispatches of one
 * configuration distil different stores (R54 distilled from ten corrections and R56 from
 * eight on the same 32-row learning fold). A registration whose first refutation is "the
 * three arms' delivery censuses are identical to the digit" cannot be graded by running
 * three arms.
 *
 * Two properties are load-bearing here, and each one is a machine rather than a sentence:
 *
 *  1. **The store is attested, not assumed.** `facadeScope` fingerprints the one distilled
 *     store and `withinRunPair`'s scope comparison is what makes "same store" checkable.
 *  2. **The items are identical, and that is checked rather than argued.** Under
 *     `budgetBasis: 'note-excluded'` the note cannot displace a rule (see
 *     `RenderOptions.budgetBasis`), so for any request both arms saw, the served statements
 *     must be equal. `packIdentity` is the control: if it fires, the arms differed in
 *     something other than the sentence and the comparison is abandoned rather than
 *     reinterpreted.
 *
 * Nothing here reads accuracy to choose a level. The contrasts are reported; the readback
 * decides what they mean.
 */
import type { NoteMode } from '@agentix-e/microglia-core/apply';
import { compareArms, type ArmComparison, type ArmTask } from './l4.js';
import { PAIR_RESAMPLES, PAIR_SEED, type RunScope } from './within-run-pair.js';
import type { FacadePairPlan } from './facade-pair.js';
import type { InactionCensus } from './inaction.js';
import type { UseObservation } from './tau2-use-census.js';

/** The one environment switch that enables a three-level note dispatch. */
export const FACADE_NOTES_ENV = 'TAU_FACADE_NOTES';

/**
 * The three levels, in the order the registration names them.
 *
 * `standard` is the middle arm and the primary one: it is the level every committed
 * artefact ran, so the other two are reported as differences from it rather than from each
 * other. Ordering the arms this way also makes the run's main `poc-l4` artefact the arm
 * that is comparable to the lane's history.
 */
export const NOTE_LEVELS: readonly NoteMode[] = ['none', 'standard', 'hardened'];

/** The arm the lane grades as the memory arm; the others are contrasts against it. */
export const PRIMARY_NOTE: NoteMode = 'standard';

const ENABLED_SWITCHES = new Set(['1', 'true', 'on', 'three-level']);
const DISABLED_SWITCHES = new Set(['', '0', 'false', 'off', 'no']);

export type FacadeNotePlan =
  | { readonly enabled: false; readonly reason: string }
  | {
      readonly enabled: true;
      readonly arms: readonly NoteMode[];
      readonly primary: NoteMode;
      /**
       * What the budget is charged for in this dispatch. `note-excluded` is not a
       * convenience: it is what makes "same items, same order" true by construction, and a
       * three-level run under the historical accounting would vary a sentence and a pack at
       * once.
       */
      readonly budgetBasis: 'note-excluded';
    };

/**
 * Resolve whether this dispatch runs the three-level note arm.
 *
 * A dispatch varies ONE thing. R49's paired facade varies the recall floor and this varies
 * the note; enabling both in one run would make every delta a difference of two treatments
 * and the primary arm ambiguous, so the combination is refused rather than resolved into an
 * arbitrary order. An unknown switch value is refused for the same reason an unknown note
 * level is: a silently disabled experiment is indistinguishable from a completed one.
 */
export function resolveFacadeNotePlan(
  env: Readonly<Record<string, string | undefined>>,
  pair: Pick<FacadePairPlan, 'enabled'>,
): FacadeNotePlan {
  const raw = env[FACADE_NOTES_ENV];
  const disabled: FacadeNotePlan = {
    enabled: false,
    reason: 'no three-level note dispatch was registered',
  };
  if (raw === undefined) return disabled;
  const value = raw.trim().toLowerCase();
  if (DISABLED_SWITCHES.has(value)) return disabled;
  if (!ENABLED_SWITCHES.has(value)) {
    throw new Error(`${FACADE_NOTES_ENV} must be a declared note switch, received '${raw}'`);
  }
  const declaredNote = (env['TAU_INJECTION_NOTE'] ?? '').trim();
  if (declaredNote !== '') {
    throw new Error(
      `${FACADE_NOTES_ENV} runs all three levels, and TAU_INJECTION_NOTE names '${declaredNote}': ` +
        'the two declarations disagree about how many arms this dispatch has',
    );
  }
  if (pair.enabled) {
    throw new Error(
      `${FACADE_NOTES_ENV} and the paired recall facade both vary a treatment: one dispatch ` +
        'measures one variable, and a run with two would report every delta as a difference ' +
        'of two',
    );
  }
  return {
    enabled: true,
    arms: [...NOTE_LEVELS],
    primary: PRIMARY_NOTE,
    budgetBasis: 'note-excluded',
  };
}

/** One arm's reading, as the driver produced it. */
export type NoteArmReading = {
  readonly note: NoteMode;
  /** Packs the facade served; a zero says the treatment never arrived. */
  readonly servedPacks: number;
  readonly recallRequests: number;
  /**
   * Tasks the reader could not score in this arm.
   *
   * A note that costs the model its tool-call format is a note that changed the answer for the
   * wrong reason, and R53's third prediction bounds the parse rate against the standard arm. The
   * count travels per arm because the whole point is that one level can differ from the others.
   */
  readonly unscored: number;
  readonly tasks: readonly ArmTask[];
  readonly inaction: InactionCensus;
  /** What each served pack contained, which is the population the identity control reads. */
  readonly observations: readonly UseObservation[];
};

/**
 * Whether the three arms served the same items for the same request.
 *
 * This is R53's first refutation made checkable. It is a *control*, not a result: under
 * `note-excluded` the item list is a pure function of store, query text, floor and limit,
 * so any mismatch means the arms differed in something the registration did not name.
 *
 * `compared` counts the request texts at least two arms asked and `mismatched` counts the
 * ones whose served statements differ. A query that one arm answered two different ways is
 * also a mismatch: the same request against one store cannot produce two packs, so the
 * difference is in the plumbing rather than in the note.
 */
export type PackIdentity = {
  readonly compared: number;
  readonly mismatched: number;
  /** Up to three mismatching queries, so a failure is actionable without the whole dump. */
  readonly examples: readonly string[];
};

export function packIdentity(arms: readonly NoteArmReading[]): PackIdentity {
  const signatures = new Map<string, Map<NoteMode, string>>();
  const inconsistent = new Set<string>();
  for (const arm of arms) {
    for (const observation of arm.observations) {
      const signature = observation.statements.join('\u0000');
      let perArm = signatures.get(observation.query);
      if (perArm === undefined) {
        perArm = new Map<NoteMode, string>();
        signatures.set(observation.query, perArm);
      }
      const prior = perArm.get(arm.note);
      if (prior !== undefined && prior !== signature) inconsistent.add(observation.query);
      if (prior === undefined) perArm.set(arm.note, signature);
    }
  }
  let compared = 0;
  let mismatched = 0;
  const examples: string[] = [];
  for (const [query, perArm] of signatures) {
    if (perArm.size < 2) continue;
    compared += 1;
    const distinct = new Set(perArm.values()).size;
    if (distinct > 1 || inconsistent.has(query)) {
      mismatched += 1;
      if (examples.length < 3) examples.push(query.slice(0, 120));
    }
  }
  return { compared, mismatched, examples };
}

/** One level against the primary, on the tasks both arms scored. */
export type NoteContrast = {
  readonly kind: 'note-contrast';
  readonly baseline: NoteMode;
  readonly arm: NoteMode;
  readonly comparison: ArmComparison;
};

/** The serialisable record of one three-level note dispatch. */
export type NotedFacadeReading = {
  readonly dispatchId: string;
  readonly preregId: string;
  /** The three levels this run rendered, in execution order. */
  readonly levels: readonly NoteMode[];
  readonly budgetBasis: 'note-excluded';
  /** The one store, learning phase, split, seed and model all three arms share. */
  readonly scope: RunScope;
  readonly arms: readonly {
    readonly note: NoteMode;
    readonly servedPacks: number;
    readonly recallRequests: number;
    /** Items served per request: the delivery census R53 asks to hold constant. */
    readonly itemsPerRequest: number;
    /** Scored and unscored task counts, so the parse rate is recoverable per arm. */
    readonly scoredTasks: number;
    readonly unscoredTasks: number;
    readonly pass4: number;
    readonly inaction: InactionCensus;
  }[];
  readonly contrasts: readonly NoteContrast[];
  readonly packIdentity: PackIdentity;
  readonly seed: number;
  readonly model: string;
};

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * Build the reading from the three facades, computing nothing the artefact cannot defend.
 *
 * Every contrast is computed on the intersection of the two arms' tasks, and a facade that
 * scored nothing produces no contrast at all rather than a delta against an empty
 * denominator (`compareArms` refuses an empty paired set the same way).
 */
export function noteFacadeReading(input: {
  readonly dispatchId: string;
  readonly preregId: string;
  readonly scope: RunScope;
  readonly arms: readonly NoteArmReading[];
  readonly seed: number;
  readonly model: string;
}): NotedFacadeReading {
  const primary = input.arms.find((arm) => arm.note === PRIMARY_NOTE);
  const contrasts: NoteContrast[] = [];
  if (primary !== undefined) {
    for (const arm of input.arms) {
      if (arm.note === PRIMARY_NOTE) continue;
      if (arm.tasks.length === 0 || primary.tasks.length === 0) continue;
      const comparison = compareArms(primary.tasks, arm.tasks, PAIR_SEED, PAIR_RESAMPLES);
      if (comparison.paired === 0) continue;
      contrasts.push({ kind: 'note-contrast', baseline: PRIMARY_NOTE, arm: arm.note, comparison });
    }
  }
  return {
    dispatchId: input.dispatchId,
    preregId: input.preregId,
    levels: input.arms.map((arm) => arm.note),
    budgetBasis: 'note-excluded',
    scope: input.scope,
    arms: input.arms.map((arm) => ({
      note: arm.note,
      servedPacks: arm.servedPacks,
      recallRequests: arm.recallRequests,
      // One observation per request, pushed at the facade boundary, so this is the mean
      // pack size the agent actually received rather than a mean over a counter that could
      // drift from the population it claims to describe.
      itemsPerRequest:
        arm.observations.length === 0
          ? 0
          : arm.observations.reduce((sum, entry) => sum + entry.statements.length, 0) /
            arm.observations.length,
      scoredTasks: arm.tasks.length,
      unscoredTasks: arm.unscored,
      pass4: mean(arm.tasks.map((task) => (task.passedAll ? 1 : 0))),
      inaction: arm.inaction,
    })),
    contrasts,
    packIdentity: packIdentity(input.arms),
    seed: input.seed,
    model: input.model,
  };
}

/**
 * Whether the dispatch measured anything at all.
 *
 * `IDENTITY_BROKEN` is not a failed hypothesis: it is a run whose arms differed in
 * something the registration did not name, and no delta from it is interpretable. The
 * distinction is the one R56 paid for — a recording defect and a harmful treatment are
 * different findings, and an artefact that reports only the state keeps them apart.
 */
export function noteFacadeState(reading: NotedFacadeReading): string {
  if (reading.packIdentity.mismatched > 0) return 'IDENTITY_BROKEN';
  if (reading.arms.every((arm) => arm.servedPacks === 0)) return 'NO_DELIVERY';
  return 'MEASURED';
}

/** One line for the workflow's readback step and the job summary. */
export function noteFacadeSummary(reading: NotedFacadeReading): string {
  const arms = reading.arms
    .map(
      (arm) =>
        `${arm.note} pass4 ${(arm.pass4 * 100).toFixed(2)}% served ${String(arm.servedPacks)}` +
        `/${String(arm.recallRequests)} items/req ${arm.itemsPerRequest.toFixed(3)}`,
    )
    .join(' | ');
  const contrasts = reading.contrasts
    .map(
      (contrast) =>
        `${contrast.arm} vs ${contrast.baseline} ${contrast.comparison.deltaPp.toFixed(2)}pp ` +
        `[${contrast.comparison.ciLowPp.toFixed(2)}, ${contrast.comparison.ciHighPp.toFixed(2)}] ` +
        `p=${contrast.comparison.p.toFixed(4)} n=${String(contrast.comparison.paired)}`,
    )
    .join(' | ');
  return (
    `${noteFacadeState(reading)}: ${arms}` +
    `${contrasts === '' ? '' : ` | ${contrasts}`}` +
    ` | packs identical on ${String(reading.packIdentity.compared)} shared request(s), ` +
    `${String(reading.packIdentity.mismatched)} mismatch`
  );
}

/** The document `l4.ts` writes beside the other artefacts. */
export type NotedFacadeArtifact = NotedFacadeReading & {
  readonly id: 'poc-l4-facade-notes';
  readonly title: string;
  readonly ranAt: string;
  readonly state: string;
  readonly summary: string;
  readonly notes: readonly string[];
};

export function notedFacadeArtifact(
  reading: NotedFacadeReading,
  ranAt: string,
): NotedFacadeArtifact {
  return {
    id: 'poc-l4-facade-notes',
    title: "R53 — the pack's note at three levels over one distilled store",
    ranAt,
    state: noteFacadeState(reading),
    summary: noteFacadeSummary(reading),
    ...reading,
    notes: [
      'Three facades of ONE driver run: one dispatch, one learning phase, one distilled store, one held-out split, one common seed stream and one model; only the pack note differs.',
      "The note is a rendering option of one recall (`RecallQuery.note`), not a host property, because three dispatches of one configuration distil different stores and their delivery censuses cannot be equal.",
      "`budgetBasis: note-excluded` charges the character budget to the block's data, so the longer sentence cannot displace the last rule; without it the arms differ in their packs as well as their wording.",
      '`packIdentity` is the control, not a result: on every request two arms both saw, the served statements must be equal, and `IDENTITY_BROKEN` means the arms differed in something the registration did not name.',
      'This is a note-contrast, NOT the l4-paired memory-versus-reference gate the R45 revert rule grades, and not the l4-facade-pair floor contrast.',
      'Only MEASURED reports a contrast; IDENTITY_BROKEN and NO_DELIVERY report none.',
    ],
  };
}

/**
 * What the workflow is allowed to conclude from a three-level artefact.
 *
 * A note contrast has no delta in `IDENTITY_BROKEN`: the arms differed in something the
 * registration did not name, so every number in it describes a different experiment. This
 * is the same rule `readFacadePairArtifact` follows, for the same reason — a defaulted
 * readback is how a run that never measured becomes a result — and it is a function rather
 * than a `node -e` expression because the refusal has to be tested.
 */
export type NoteFacadeReadback = {
  readonly state: 'MEASURED' | 'IDENTITY_BROKEN' | 'NO_DELIVERY';
  readonly summary: string;
  readonly levels: readonly string[];
  readonly arms: readonly {
    readonly note: string;
    readonly servedPacks: number;
    readonly itemsPerRequest: number;
    readonly pass4: number;
  }[];
  /** Present only for MEASURED; empty in the two states that report no contribution. */
  readonly contrasts: readonly {
    readonly arm: string;
    readonly deltaPp: number;
    readonly ciLowPp: number;
    readonly ciHighPp: number;
    readonly p: number;
    readonly paired: number;
  }[];
  readonly identity: { readonly compared: number; readonly mismatched: number };
};

const NOTE_STATES = ['MEASURED', 'IDENTITY_BROKEN', 'NO_DELIVERY'] as const;

function numeric(value: unknown, where: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`the artefact has no numeric ${where}`);
  }
  return value;
}

/**
 * Read an artefact back into its three states, refusing anything it cannot attest.
 *
 * A missing or unknown `state` is refused rather than inferred: the state is the record of
 * what the run decided about itself, and recomputing it here would let a reader's arithmetic
 * disagree with the artefact it is reading.
 */
export function readNotedFacadeArtifact(value: unknown): NoteFacadeReadback {
  if (typeof value !== 'object' || value === null) throw new Error('the artefact is not an object');
  const record = value as Record<string, unknown>;
  const state = record['state'];
  if (typeof state !== 'string' || !(NOTE_STATES as readonly string[]).includes(state)) {
    throw new Error(`the artefact has no recognised state, received '${String(state)}'`);
  }
  const summary = record['summary'];
  if (typeof summary !== 'string') throw new Error('the artefact carries no summary');
  const identity = record['packIdentity'];
  if (typeof identity !== 'object' || identity === null) {
    throw new Error('the artefact carries no pack-identity control');
  }
  const control = identity as Record<string, unknown>;
  const compared = numeric(control['compared'], 'pack-identity population');
  const mismatched = numeric(control['mismatched'], 'pack-identity mismatch count');

  const rawArms = record['arms'];
  if (!Array.isArray(rawArms)) throw new Error('the artefact carries no arms');
  const arms = rawArms.map((entry) => {
    if (typeof entry !== 'object' || entry === null) throw new Error('an arm is not an object');
    const arm = entry as Record<string, unknown>;
    if (typeof arm['note'] !== 'string') throw new Error('an arm names no note level');
    return {
      note: arm['note'],
      servedPacks: numeric(arm['servedPacks'], `served pack count for '${arm['note']}'`),
      itemsPerRequest: numeric(arm['itemsPerRequest'], `items per request for '${arm['note']}'`),
      pass4: numeric(arm['pass4'], `pass^4 for '${arm['note']}'`),
    };
  });

  const levels = Array.isArray(record['levels']) ? record['levels'].map(String) : arms.map((arm) => arm.note);

  if (state !== 'MEASURED') {
    return {
      state: state as NoteFacadeReadback['state'],
      summary,
      levels,
      arms,
      contrasts: [],
      identity: { compared, mismatched },
    };
  }
  const rawContrasts = record['contrasts'];
  if (!Array.isArray(rawContrasts) || rawContrasts.length === 0) {
    throw new Error('a MEASURED artefact must carry at least one contrast');
  }
  const contrasts = rawContrasts.map((entry) => {
    if (typeof entry !== 'object' || entry === null) throw new Error('a contrast is not an object');
    const contrast = entry as Record<string, unknown>;
    if (typeof contrast['arm'] !== 'string') throw new Error('a contrast names no arm');
    const comparison = contrast['comparison'];
    if (typeof comparison !== 'object' || comparison === null) {
      throw new Error(`the contrast for '${contrast['arm']}' carries no comparison`);
    }
    const c = comparison as Record<string, unknown>;
    return {
      arm: contrast['arm'],
      deltaPp: numeric(c['deltaPp'], `delta for '${contrast['arm']}'`),
      ciLowPp: numeric(c['ciLowPp'], `interval low for '${contrast['arm']}'`),
      ciHighPp: numeric(c['ciHighPp'], `interval high for '${contrast['arm']}'`),
      p: numeric(c['p'], `p-value for '${contrast['arm']}'`),
      paired: numeric(c['paired'], `paired count for '${contrast['arm']}'`),
    };
  });
  return {
    state: 'MEASURED',
    summary,
    levels,
    arms,
    contrasts,
    identity: { compared, mismatched },
  };
}
