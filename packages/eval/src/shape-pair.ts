/**
 * R109a's two-unit facade pair: one dispatch, one learning phase, one store, two units.
 *
 * R109 shipped the fold and stopped at a switch. A switch is not an arm: `TAU_PACK_SHAPE=collapse`
 * renders one dispatch's packs in one unit, and the comparison that matters — does the unit change the
 * score? — needs both units over the *same* store. Two dispatches are two stores: a dispatch's
 * corrections are produced by the model at run time, so R54 distilled ten corrections and R56 eight on
 * the same 32-row learning fold, and two such stores cannot be paired by any statistic.
 *
 * The machinery is R53's (`note-facade.ts`), generalised from the sentence to the unit, and one thing
 * had to change. R53's control is **identity**: under `budgetBasis: 'note-excluded'` the note cannot
 * displace a rule, so every request must be served the same statements by every arm, and any difference
 * means the arms differed in something the registration did not name. A shape arm cannot have that
 * control, because the fold *does* change the pack — that is its whole point. The control it can have
 * is **containment**, and the shape of the containment is readable off `buildPack`:
 *
 *   1. the fold is the last thing that happens to the selection (`buildPack`: MMR, then the fold, then
 *      the budget), so with the same store, query, floor, limit and diversity the two arms select *the
 *      same items* and the treatment arm keeps a subset of them;
 *   2. therefore, on any request whose pack the budget did not cut, the treatment arm's ids must be a
 *      subset of the control's, and the two pack sizes must differ by exactly the items the fold
 *      reports removing.
 *
 * The second clause is the stronger one and the reason this is a control rather than a sanity check: a
 * fold that kept a non-member, dropped an unfolded item, or reported a count it did not perform fails
 * it. Requests the budget cut are **excluded and counted** rather than quietly skipped, because on
 * those the control's assertion is not true by construction (a shorter unit can leave room for an item
 * the control dropped) and an excluded population nobody printed is how a control becomes decoration.
 *
 * Nothing here reads accuracy to choose a unit. The contrasts are reported; the readback decides.
 */
import type { KnowledgePack, ShapeMode } from '@agentix-e/microglia-core';
import { compareArms, type ArmComparison, type ArmTask } from './l4.js';
import { PAIR_RESAMPLES, PAIR_SEED, type RunScope } from './within-run-pair.js';
import type { FacadePairPlan } from './facade-pair.js';
import type { FacadeNotePlan } from './note-facade.js';
import type { InactionCensus } from './inaction.js';

/** The one environment switch that enables a two-unit dispatch. */
export const SHAPE_ARMS_ENV = 'TAU_FACADE_SHAPES';

/**
 * The two units, in the order the registration names them.
 *
 * `per-failure` is the control and the arm every committed artefact ran, so the main `poc-l4` document
 * stays the artefact comparable to the lane's history and the treatment is reported as a difference
 * from it. The order is also the order the facades are built in, which is why the first one is the one
 * whose evaluation becomes `primary`.
 */
export const SHAPE_UNITS: readonly ShapeMode[] = ['per-failure', 'collapse'];

/** The arm the lane grades as the memory arm; the other is the contrast. */
export const PRIMARY_SHAPE: ShapeMode = 'per-failure';

const ENABLED_SWITCHES = new Set(['1', 'true', 'on', 'two-unit']);
const DISABLED_SWITCHES = new Set(['', '0', 'false', 'off', 'no']);

export type ShapeArmPlan =
  | { readonly enabled: false; readonly reason: string }
  | {
      readonly enabled: true;
      readonly arms: readonly ShapeMode[];
      readonly primary: ShapeMode;
    };

/**
 * Resolve whether this dispatch runs both units, refusing the combinations that would confound it.
 *
 * One dispatch varies ONE thing, and the refusal is not politeness: the note arms vary the sentence and
 * the shape arms vary the unit, so a run carrying both would make every delta a difference of two
 * treatments and the primary arm ambiguous — the same rule `resolveFacadeNotePlan` applies to the floor
 * pair, applied to this axis.
 *
 * A declared `TAU_PACK_SHAPE` is refused rather than overridden. That variable is the *single*-unit
 * switch (R109), and a dispatch that declares one unit while the pair renders both has two declarations
 * of one variable; the resolver cannot know which the registration meant, and picking one would publish
 * an arm under a name the other half of the run contradicts.
 */
export function resolveShapeArmPlan(
  env: Readonly<Record<string, string | undefined>>,
  context: {
    readonly pair: Pick<FacadePairPlan, 'enabled'>;
    readonly notes: Pick<FacadeNotePlan, 'enabled'>;
  },
): ShapeArmPlan {
  const raw = env[SHAPE_ARMS_ENV];
  const disabled: ShapeArmPlan = {
    enabled: false,
    reason: 'no two-unit dispatch was registered',
  };
  if (raw === undefined) return disabled;
  const value = raw.trim().toLowerCase();
  if (DISABLED_SWITCHES.has(value)) return disabled;
  if (!ENABLED_SWITCHES.has(value)) {
    throw new Error(`${SHAPE_ARMS_ENV} must be a declared shape switch, received '${raw}'`);
  }
  const declaredShape = (env['TAU_PACK_SHAPE'] ?? '').trim();
  if (declaredShape !== '') {
    throw new Error(
      `${SHAPE_ARMS_ENV} renders both units and TAU_PACK_SHAPE names '${declaredShape}': ` +
        'the two declarations disagree about how many units this dispatch has',
    );
  }
  if (context.pair.enabled) {
    throw new Error(
      `${SHAPE_ARMS_ENV} and the paired recall facade both vary a treatment: one dispatch ` +
        'measures one variable, and a run with two would report every delta as a difference of two',
    );
  }
  if (context.notes.enabled) {
    throw new Error(
      `${SHAPE_ARMS_ENV} and the three-level note facade both vary a treatment: the note varies ` +
        'the sentence and this varies the unit, and a dispatch that ran both could not say which ' +
        'one its delta belonged to',
    );
  }
  return { enabled: true, arms: [...SHAPE_UNITS], primary: PRIMARY_SHAPE };
}

/**
 * One request, as one arm served it.
 *
 * `statements` is deliberately absent: the note census reads *content* because a sentence is content,
 * and this reads *identity and size* because a unit is exactly the set of ids plus the characters it
 * costs. Keeping the text here would invite a coverage reading of a pack whose unit is under test.
 */
export type ShapeObservation = {
  readonly query: string;
  /** The items the pack rendered, in pack order. */
  readonly ids: readonly string[];
  /** Characters the rendered block cost, which is the half of the mechanism's claim that is not a score. */
  readonly chars: number;
  /** Items the fold removed. Zero on the control arm, which never folds. */
  readonly folded: number;
  /** Whether the budget cut the pack: 1 when it did. */
  readonly truncated: number;
};

/**
 * Whether the treatment arm's packs were the control's under the fold, and nothing else.
 *
 * `compared` is the population the assertion held on; `excluded` is the population it could not be
 * asserted on, printed so a run that compared three requests out of two hundred cannot be read as a
 * clean control. A request one arm answered twice with different packs is a mismatch, not an
 * inconsistency to be averaged: one store cannot serve one request two ways, so the difference is in
 * the plumbing rather than in the unit.
 */
export type ShapeContainment = {
  readonly compared: number;
  readonly mismatched: number;
  /** Requests a budget cut, where containment is not true by construction. */
  readonly excluded: number;
  /** Up to three mismatching queries, so a failure is actionable without the whole dump. */
  readonly examples: readonly string[];
};

/**
 * The control, computed over what the facades actually served.
 *
 * Three ways to fail it, and each one is a defect this arm could otherwise publish as a result: a
 * treatment id the control never had (the fold invented an item or read a different store); a size
 * difference that is not the fold's own count (the fold did something it did not report); and a control
 * arm reporting a fold (the switch was read by the wrong facade, which is the failure R109 found in the
 * prefix knobs).
 */
export function shapeContainment(arms: readonly ShapeArmReading[]): ShapeContainment {
  const control = arms.find((arm) => arm.shape === PRIMARY_SHAPE);
  const treatment = arms.find((arm) => arm.shape !== PRIMARY_SHAPE);
  if (control === undefined || treatment === undefined) {
    return { compared: 0, mismatched: 0, excluded: 0, examples: [] };
  }
  const controlPacks = byQuery(control.observations);
  const treatmentPacks = byQuery(treatment.observations);
  let compared = 0;
  let mismatched = 0;
  let excluded = 0;
  const examples: string[] = [];
  for (const [query, before] of controlPacks) {
    const after = treatmentPacks.get(query);
    if (after === undefined) continue;
    if (before.truncated > 0 || after.truncated > 0) {
      excluded += 1;
      continue;
    }
    compared += 1;
    const beforeIds = new Set(before.ids);
    const invented = after.ids.filter((id) => !beforeIds.has(id));
    // The control serves every selected item when the budget does not cut, so the two sizes differ by
    // exactly what the *treatment* says it removed. Reading the control's own count here would compare
    // the two arms to the same number and pass every pack the fold shortened.
    const accountedFor = before.ids.length - after.folded === after.ids.length;
    // The control arm never folds. A non-zero count here is the switch being read by the wrong facade,
    // which is the failure R109 found in the prefix knobs and the one an arm report could not show.
    const controlFolded = before.folded !== 0;
    if (invented.length > 0 || !accountedFor || controlFolded) {
      mismatched += 1;
      if (examples.length < 3) examples.push(query.slice(0, 120));
    }
  }
  return { compared, mismatched, excluded, examples };
}

/**
 * One served pack, in the terms the control reads it.
 *
 * A function rather than five inline object literals in the driver, for the reason every reader in this
 * package is one: the driver has two serving sites (a plain pack and a pack with the planted line
 * appended) and a reading taken by hand at each of them is a reading that can drift from the other. The
 * planted line is deliberately not in `chars`: it is not a store item, and a unit comparison that priced
 * it would report the fold as having saved characters it never saved.
 */
export function shapeObservationOf(
  query: string,
  pack: Pick<KnowledgePack, 'ids' | 'rendered' | 'truncated'> &
    Pick<Partial<KnowledgePack>, 'fold'>,
): ShapeObservation {
  return {
    query,
    ids: pack.ids,
    chars: pack.rendered.length,
    folded: pack.fold?.folded ?? 0,
    truncated: pack.truncated,
  };
}

/**
 * One pack per query, or the first one when an arm answered a query twice.
 *
 * The driver asks a handful of questions repeatedly, so the map is the identity of a *request* rather
 * than of an episode. Collapsing duplicates to the first is what makes a repeated question a single
 * compared row instead of inflating the population with copies of itself.
 */
function byQuery(observations: readonly ShapeObservation[]): Map<string, ShapeObservation> {
  const packs = new Map<string, ShapeObservation>();
  for (const observation of observations) {
    if (!packs.has(observation.query)) packs.set(observation.query, observation);
  }
  return packs;
}

/** One arm's reading, as the driver produced it. */
export type ShapeArmReading = {
  readonly shape: ShapeMode;
  /** Packs the facade served; a zero says the treatment never arrived. */
  readonly servedPacks: number;
  readonly recallRequests: number;
  readonly unscored: number;
  readonly tasks: readonly ArmTask[];
  readonly inaction: InactionCensus;
  /** What each served pack contained, which is the population the containment control reads. */
  readonly observations: readonly ShapeObservation[];
};

/** One unit against the primary, on the tasks both arms scored. */
export type ShapeContrast = {
  readonly kind: 'shape-contrast';
  readonly baseline: ShapeMode;
  readonly arm: ShapeMode;
  readonly comparison: ArmComparison;
};

/** The serialisable record of one two-unit dispatch. */
export type ShapeArmRecord = {
  readonly dispatchId: string;
  readonly preregId: string;
  /** The two units this run rendered, in execution order. */
  readonly units: readonly ShapeMode[];
  /** The one store, learning phase, split, seed and model both arms share. */
  readonly scope: RunScope;
  readonly arms: readonly {
    readonly shape: ShapeMode;
    readonly servedPacks: number;
    readonly recallRequests: number;
    /** Items served per request: the delivery census a unit change is expected to move. */
    readonly itemsPerRequest: number;
    /**
     * Characters served per request: the mechanism's own signature.
     *
     * A fold that does not shrink the block did not happen, whatever the score says, and printing it
     * beside `pass^4` is what makes "same knowledge, fewer lines" a measurement instead of a claim.
     */
    readonly charsPerRequest: number;
    /** Items the fold removed across the arm's requests. Zero on the control, by construction. */
    readonly folded: number;
    readonly scoredTasks: number;
    readonly unscoredTasks: number;
    readonly pass4: number;
    readonly inaction: InactionCensus;
  }[];
  readonly contrasts: readonly ShapeContrast[];
  readonly containment: ShapeContainment;
  readonly seed: number;
  readonly model: string;
};

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * Build the reading from the two facades, computing nothing the artefact cannot defend.
 *
 * Every contrast is on the intersection of the two arms' tasks, and an arm that scored nothing produces
 * no contrast rather than a delta against an empty denominator. The contrasts are computed **after** the
 * state, because two of the four states report no contribution: a dispatch whose facades served no pack
 * has two arms with identical task rows, so a contrast computed before the state would carry
 * `0.00pp [0.00, 0.00]` — a delta between two arms that never delivered anything, sitting in an artefact
 * whose own `state` says it is not a result. The first version of this function did exactly that, and
 * the test that caught it is the one asserting the summary of a `NO_DELIVERY` run carries no contrast.
 */
export function shapeArmReading(input: {
  readonly dispatchId: string;
  readonly preregId: string;
  readonly scope: RunScope;
  readonly arms: readonly ShapeArmReading[];
  readonly seed: number;
  readonly model: string;
}): ShapeArmRecord {
  const draft: ShapeArmRecord = {
    dispatchId: input.dispatchId,
    preregId: input.preregId,
    units: input.arms.map((arm) => arm.shape),
    scope: input.scope,
    arms: input.arms.map((arm) => ({
      shape: arm.shape,
      servedPacks: arm.servedPacks,
      recallRequests: arm.recallRequests,
      itemsPerRequest: mean(arm.observations.map((observation) => observation.ids.length)),
      charsPerRequest: mean(arm.observations.map((observation) => observation.chars)),
      folded: arm.observations.reduce((sum, observation) => sum + observation.folded, 0),
      scoredTasks: arm.tasks.length,
      unscoredTasks: arm.unscored,
      pass4: mean(arm.tasks.map((task) => (task.passedAll ? 1 : 0))),
      inaction: arm.inaction,
    })),
    contrasts: [],
    containment: shapeContainment(input.arms),
    seed: input.seed,
    model: input.model,
  };
  if (shapeArmState(draft) !== 'MEASURED') return draft;
  const primary = input.arms.find((arm) => arm.shape === PRIMARY_SHAPE);
  const contrasts: ShapeContrast[] = [];
  if (primary !== undefined) {
    for (const arm of input.arms) {
      if (arm.shape === PRIMARY_SHAPE) continue;
      if (arm.tasks.length === 0 || primary.tasks.length === 0) continue;
      const comparison = compareArms(primary.tasks, arm.tasks, PAIR_SEED, PAIR_RESAMPLES);
      if (comparison.paired === 0) continue;
      contrasts.push({ kind: 'shape-contrast', baseline: PRIMARY_SHAPE, arm: arm.shape, comparison });
    }
  }
  return { ...draft, contrasts };
}

/**
 * Whether the dispatch measured anything.
 *
 * The states are ordered by what they invalidate, not by how surprising they are. `CONTAINMENT_BROKEN`
 * first because every delta in such a run describes a difference the registration did not name.
 * `NO_DELIVERY` next: no pack reached the model, so the score is the agent's. `NO_TREATMENT` last and it
 * is the one this arm exists to be able to say: both facades ran, both served packs, and the fold
 * removed nothing — a registered treatment that never fired, which is a null result about the *store*
 * rather than about the mechanism, and must not be read as "the fold did not help".
 */
export function shapeArmState(reading: ShapeArmRecord): string {
  if (reading.containment.mismatched > 0) return 'CONTAINMENT_BROKEN';
  if (reading.arms.every((arm) => arm.servedPacks === 0)) return 'NO_DELIVERY';
  const treatment = reading.arms.find((arm) => arm.shape !== PRIMARY_SHAPE);
  if (treatment !== undefined && treatment.folded === 0) return 'NO_TREATMENT';
  return 'MEASURED';
}

/** One line for the workflow's readback step and the job summary. */
export function shapeArmSummary(reading: ShapeArmRecord): string {
  const arms = reading.arms
    .map(
      (arm) =>
        `${arm.shape} pass4 ${(arm.pass4 * 100).toFixed(2)}% served ${String(arm.servedPacks)}` +
        `/${String(arm.recallRequests)} items/req ${arm.itemsPerRequest.toFixed(3)}` +
        ` chars/req ${arm.charsPerRequest.toFixed(0)} folded ${String(arm.folded)}`,
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
    `${shapeArmState(reading)}: ${arms}` +
    `${contrasts === '' ? '' : ` | ${contrasts}`}` +
    ` | containment on ${String(reading.containment.compared)} request(s), ` +
    `${String(reading.containment.mismatched)} mismatch, ` +
    `${String(reading.containment.excluded)} excluded for a cut pack`
  );
}

/** The document `l4.ts` writes beside the other artefacts. */
export type ShapeArmArtifact = ShapeArmRecord & {
  readonly id: 'poc-l4-facade-shapes';
  readonly title: string;
  readonly ranAt: string;
  readonly state: string;
  readonly summary: string;
  readonly notes: readonly string[];
};

export function shapeArmArtifact(reading: ShapeArmRecord, ranAt: string): ShapeArmArtifact {
  return {
    id: 'poc-l4-facade-shapes',
    title: 'R109a — one store delivered in two units',
    ranAt,
    state: shapeArmState(reading),
    summary: shapeArmSummary(reading),
    ...reading,
    notes: [
      'Two facades of ONE driver run: one dispatch, one learning phase, one distilled store, one held-out split, one seed stream and one model; only the pack unit differs.',
      "The unit is a rendering option of one recall (`RecallQuery.shape`), which is why one dispatch can carry both arms; two dispatches of one configuration distil different stores and their packs cannot be paired.",
      '`shapeContainment` is the control, not a result: on every request the budget did not cut, the treatment pack must be the control pack minus exactly the items the fold reports removing. Requests a cut pack excludes from the assertion are counted, not skipped.',
      '`NO_TREATMENT` is a real state: the fold removing nothing is a finding about the store, not evidence that the unit does not matter.',
      'This is a shape-contrast, NOT the l4-paired memory-versus-reference gate the R45 revert rule grades, and not the l4-facade-pair floor contrast or R53 note levels.',
      'Only MEASURED reports a contrast; CONTAINMENT_BROKEN, NO_DELIVERY and NO_TREATMENT report none.',
    ],
  };
}

/**
 * What the workflow is allowed to conclude from a two-unit artefact.
 *
 * A shape contrast has no delta in `CONTAINMENT_BROKEN`: the arms differed in something the
 * registration did not name, so every number in it describes a different experiment. Same rule, same
 * reason, as `readNotedFacadeArtifact` — and a function rather than a `node -e` expression because the
 * refusal has to be tested.
 */
export type ShapeArmReadback = {
  readonly state: 'MEASURED' | 'CONTAINMENT_BROKEN' | 'NO_DELIVERY' | 'NO_TREATMENT';
  readonly summary: string;
  readonly units: readonly string[];
  readonly arms: readonly {
    readonly shape: string;
    readonly servedPacks: number;
    readonly itemsPerRequest: number;
    readonly charsPerRequest: number;
    readonly folded: number;
    readonly pass4: number;
  }[];
  /** Present only for MEASURED; empty in the three states that report no contribution. */
  readonly contrasts: readonly {
    readonly arm: string;
    /** The unit the contrast is against, read from the artefact rather than assumed by the reader. */
    readonly baseline: string;
    readonly deltaPp: number;
    readonly ciLowPp: number;
    readonly ciHighPp: number;
    readonly p: number;
    readonly paired: number;
  }[];
  readonly containment: { readonly compared: number; readonly mismatched: number; readonly excluded: number };
};

const SHAPE_STATES = ['MEASURED', 'CONTAINMENT_BROKEN', 'NO_DELIVERY', 'NO_TREATMENT'] as const;

function numeric(value: unknown, where: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`the artefact has no numeric ${where}`);
  }
  return value;
}

function recordOf(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) throw new Error(`the artefact has no ${where}`);
  return value as Record<string, unknown>;
}

/**
 * Read an artefact back into its four states, refusing anything it cannot attest.
 *
 * A missing or unknown `state` is refused rather than inferred: the state is the record of what the run
 * decided about itself, and recomputing it here would let a reader's arithmetic disagree with the
 * artefact it is reading.
 */
export function readShapeArmArtifact(value: unknown): ShapeArmReadback {
  const record = recordOf(value, 'document');
  const state = record['state'];
  if (typeof state !== 'string' || !(SHAPE_STATES as readonly string[]).includes(state)) {
    throw new Error(`the artefact has no recognised state, received '${String(state)}'`);
  }
  const summary = record['summary'];
  if (typeof summary !== 'string') throw new Error('the artefact carries no summary');
  const control = recordOf(record['containment'], 'containment control');
  const containment = {
    compared: numeric(control['compared'], 'containment population'),
    mismatched: numeric(control['mismatched'], 'containment mismatch count'),
    excluded: numeric(control['excluded'], 'containment exclusion count'),
  };

  const rawArms = record['arms'];
  if (!Array.isArray(rawArms)) throw new Error('the artefact carries no arms');
  const arms = rawArms.map((entry) => {
    const arm = recordOf(entry, 'arm');
    if (typeof arm['shape'] !== 'string') throw new Error('an arm names no unit');
    return {
      shape: arm['shape'],
      servedPacks: numeric(arm['servedPacks'], `served pack count for '${arm['shape']}'`),
      itemsPerRequest: numeric(arm['itemsPerRequest'], `items per request for '${arm['shape']}'`),
      charsPerRequest: numeric(arm['charsPerRequest'], `characters per request for '${arm['shape']}'`),
      folded: numeric(arm['folded'], `folded count for '${arm['shape']}'`),
      pass4: numeric(arm['pass4'], `pass^4 for '${arm['shape']}'`),
    };
  });

  const units = Array.isArray(record['units']) ? record['units'].map(String) : arms.map((arm) => arm.shape);

  if (state !== 'MEASURED') {
    return {
      state: state as ShapeArmReadback['state'],
      summary,
      units,
      arms,
      contrasts: [],
      containment,
    };
  }
  const rawContrasts = record['contrasts'];
  if (!Array.isArray(rawContrasts) || rawContrasts.length === 0) {
    throw new Error('a MEASURED artefact must carry at least one contrast');
  }
  const contrasts = rawContrasts.map((entry) => {
    const contrast = recordOf(entry, 'contrast');
    if (typeof contrast['arm'] !== 'string') throw new Error('a contrast names no arm');
    if (typeof contrast['baseline'] !== 'string') throw new Error('a contrast names no baseline');
    const comparison = recordOf(contrast['comparison'], `comparison for '${contrast['arm']}'`);
    return {
      arm: contrast['arm'],
      baseline: contrast['baseline'],
      deltaPp: numeric(comparison['deltaPp'], `delta for '${contrast['arm']}'`),
      ciLowPp: numeric(comparison['ciLowPp'], `interval low for '${contrast['arm']}'`),
      ciHighPp: numeric(comparison['ciHighPp'], `interval high for '${contrast['arm']}'`),
      p: numeric(comparison['p'], `p-value for '${contrast['arm']}'`),
      paired: numeric(comparison['paired'], `paired count for '${contrast['arm']}'`),
    };
  });
  return { state: 'MEASURED', summary, units, arms, contrasts, containment };
}
