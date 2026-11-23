/**
 * Two folds of one corpus, read as one pair.
 *
 * ## The sample this lane cannot otherwise reach
 *
 * Every paired reading on τ² retail this record has published sits on 40 held-out tasks, and at n = 40 the
 * pair resolves 17.16pp (R141, measured). A memory worth ten points is therefore never resolved, and the
 * records keep saying so: five rounds of `UNRESOLVED` around a mechanism whose direction has been consistent
 * since R139. The corpus is 114 tasks and the lane has always scored 40 of them.
 *
 * A cross-fit is the design that spends the whole corpus without leaking it. The benchmark states a
 * boundary — 74 train, 40 test — and two folds read it in opposite directions: fold A learns from the 74 and
 * answers the 40, fold B learns from the 40 and answers the 74. Every task is answered exactly once, by a
 * memory that never saw it, and the two folds pool to 114 pairs. At n = 114 the same pair resolves ~10pp,
 * which is the size of the effect R141 measured.
 *
 * ## Why the pooling is a module with refusals
 *
 * "Concatenate the two ledgers" is one line and it is the wrong line whenever the two ledgers are not two
 * halves of one corpus. Four things can be true of a concatenation and each produces a number rather than an
 * error:
 *
 * - **the same task in both folds** — counted twice, so n is inflated and the interval narrows in exactly the
 *   direction that flatters the result;
 * - **a fold that scored a task its own store learned from** — the leak the design exists to exclude, and the
 *   most expensive kind of wrong: the number is *better* than the truth;
 * - **a fold that does not say what it learned from** — the check above cannot run, and a missing check is
 *   never reported as missing by an average;
 * - **two folds of two treatments** — a larger sample of two experiments, averaged.
 *
 * The arithmetic is the last step and it is not re-derived here: the pooled ledger is handed to
 * `comparePaired`, the same function `compareArms` calls, so the interval and the McNemar p-value of a
 * cross-fit are comparable by construction with every other paired reading in this record. A second
 * implementation of one statistic is two answers to a question the record already answers.
 *
 * ## What the reading says that a delta cannot
 *
 * A pooled +10pp can be +25pp in one fold and −5pp in the other, which is not a finding but an average of two
 * opposite findings — and the corpus, not the mechanism, is usually what separates them. So the reading
 * carries the per-fold deltas and `agreeInSign`, and it carries the tiling census: a task evaluated by one
 * fold and learned by neither is a task no memory had seen at all, and a task learned from and evaluated by
 * neither is the corpus's leftover, which the pooled n does not cover. Both are counts rather than refusals,
 * because both leave a valid reading of a smaller population — and a refusal would make the instrument
 * unusable for exactly the diagnosis it exists to support.
 */

import { comparePaired } from './stats.js';
import { detectableDelta } from './detectable.js';

/**
 * The seed of the pooled bootstrap interval.
 *
 * Fixed and exported so the committed reading is reproducible: a cross-fit recomputed from the same two
 * ledgers must give the same interval, and a default that changed between runs would make two readings of one
 * experiment differ in the third digit for no reason a reader could see.
 */
export const CROSS_FIT_SEED = 20_261_118;

/** Resamples for the pooled interval; the protocol's own figure, so a cross-fit is quoted like every other. */
export const CROSS_FIT_RESAMPLES = 10_000;

/**
 * One task's outcome in one fold, both arms paired on the task id.
 *
 * `memoryPassed` is the k=4 reading as the pair artefact records it: a task counts only when every trial
 * passed. The cross-fit does not re-derive that from trials — the fold's ledger is the unit, and a pool that
 * reinterpreted trials would disagree with the pair it was built from.
 */
export type CrossFitTask = {
  readonly id: string;
  readonly memoryPassed: boolean;
  readonly controlPassed: boolean;
};

/**
 * One fold: the half a store learned from, and the half it answered.
 *
 * `learned` is optional in the type and required by the pool. That asymmetry is deliberate — an artefact
 * written before the field existed must reach the guard as absent rather than be refused at the type level,
 * because the refusal is the sentence a reader needs: "this fold cannot say what it learned from".
 */
export type CrossFitFold = {
  readonly label: string;
  readonly learned: readonly string[] | undefined;
  readonly tasks: readonly CrossFitTask[];
  /** The treatment's identity, as `poolArms` compares it: two folds of two treatments are two experiments. */
  readonly unit: string | undefined;
  readonly form: string | undefined;
  readonly scope: string | undefined;
  readonly model: string | undefined;
  /**
   * The recall knobs the arm's request carried, verbatim — `anchoring=lexical&minCoverage=0`, or empty.
   *
   * R150. It is the only record of *what filter ran*, and it is an identity rather than a detail: two folds of
   * one store served through two different filters are two experiments, and a pool that averaged them would
   * report a treatment that neither fold ran. Absent on every artefact written before the field, and absent is
   * normalised to `none` rather than to the empty string, because "this run named no knob" and "this artefact
   * could not say" are the same reading for the purpose of comparing two folds and different facts about them.
   */
  readonly knobs?: string;
  /**
   * The serving policy the fold declared: `off`, `fair-share`, or absent on every artefact before R152.
   *
   * It is an identity and not a detail, for the reason `knobs` is: two folds of one store, one of which bounded
   * how far each item could travel, are two experiments — and the second one's arithmetic (a cap resolved from
   * the store the run built) is not a number the first one's pool may average in.
   */
  readonly rotation?: string;
};

export type CrossFitFoldReading = {
  readonly label: string;
  readonly tasks: number;
  readonly memoryPass4: number;
  readonly controlPass4: number;
  /** `memory - control`, in percentage points, so a negative number means the memory did worse. */
  readonly deltaPp: number;
  readonly lost: number;
  readonly gained: number;
};

export type CrossFitReading = {
  readonly folds: readonly CrossFitFoldReading[];
  readonly tasks: number;
  readonly memoryPass4: number;
  readonly controlPass4: number;
  readonly deltaPp: number;
  readonly ciLowPp: number;
  readonly ciHighPp: number;
  /** Two-sided exact McNemar p-value over the pooled discordant pairs. */
  readonly p: number;
  readonly lost: number;
  readonly gained: number;
  readonly discordance: number;
  /** The smallest pooled difference this many pairs could detect at 80% power, in percentage points. */
  readonly mde80Pp: number;
  /** Distinct tasks the folds evaluated; the denominator the pooled rate is over. */
  readonly evaluated: number;
  /** Distinct tasks the folds learned from; equal to `evaluated` on a tiling cross-fit. */
  readonly learned: number;
  /** Evaluated by a fold and learned by neither: a task no memory had seen, at all. */
  readonly neverLearned: readonly string[];
  /** Learned by a fold and evaluated by neither: the corpus's leftover, which no number here covers. */
  readonly neverScored: readonly string[];
  /** Whether the two censuses above are empty, which is what lets the pool be called the corpus's. */
  readonly tiles: boolean;
  /** Whether the folds' deltas point the same way; false means the pool averages two directions. */
  readonly agreeInSign: boolean;
};

export type CrossFitOutcome =
  | { readonly ok: true; readonly reading: CrossFitReading }
  | { readonly ok: false; readonly refusals: readonly string[] };

/**
 * What one fold's ledger says, without an interval: the per-fold row a reader checks the pool against.
 *
 * Called only on folds the guard has already admitted, which is why there is no empty-fold branch here: a fold
 * with no tasks is refused before any rate is taken, and a `n === 0 ? 0` in this function would be a branch no
 * input can reach — dead protection that reads as care.
 */
function foldReadingOf(fold: CrossFitFold): CrossFitFoldReading {
  let memory = 0;
  let control = 0;
  let lost = 0;
  let gained = 0;
  for (const task of fold.tasks) {
    if (task.memoryPassed) memory += 1;
    if (task.controlPassed) control += 1;
    if (task.controlPassed && !task.memoryPassed) lost += 1;
    if (!task.controlPassed && task.memoryPassed) gained += 1;
  }
  const n = fold.tasks.length;
  return {
    label: fold.label,
    tasks: n,
    memoryPass4: memory / n,
    controlPass4: control / n,
    deltaPp: ((memory - control) / n) * 100,
    lost,
    gained,
  };
}

/**
 * The identity `poolArms` compares, spelled the same way here so the two pools refuse with one vocabulary.
 *
 * A record rather than a list of pairs: the comparison walks a fixed set of names, so every field is compared
 * on every fold and none can be skipped by a list that happened to be shorter.
 */
type FoldIdentity = Readonly<Record<'unit' | 'form' | 'scope' | 'model' | 'knobs' | 'rotation', string>>;

const IDENTITY_FIELDS = ['unit', 'form', 'scope', 'model', 'knobs', 'rotation'] as const;

function identityOf(fold: CrossFitFold): FoldIdentity {
  return {
    unit: fold.unit ?? 'unrecorded',
    form: fold.form ?? 'unrecorded',
    scope: fold.scope ?? 'unrecorded',
    model: fold.model ?? 'unrecorded',
    // `none` rather than `unrecorded`: a run that carried no knob and an artefact that could not say produced
    // the same request, and a pool that refused them would refuse every fold written before the field existed.
    knobs: fold.knobs === undefined || fold.knobs === '' ? 'none' : fold.knobs,
    // `none` for the same reason `knobs` uses it: an artefact written before the field and a run that declared no
    // policy produced the same request. A declared `off` is not `none` — it is the identity, chosen and recorded,
    // and a pool that merged it with an undeclared run would be averaging a control into a treatment.
    rotation: fold.rotation === undefined || fold.rotation === '' ? 'none' : fold.rotation,
  };
}

/**
 * The first few ids of a list, with the rest counted rather than printed.
 *
 * Both refusals below name ids, and both have to stay one sentence when a store leaks forty of them: a refusal
 * a reader has to scroll is a refusal they skip, and the count is what they act on.
 */
function elide(ids: readonly string[], separator: string): string {
  const shown = ids.slice(0, 5).join(separator);
  return ids.length > 5 ? `${shown}${separator}and ${String(ids.length - 5)} more` : shown;
}

/**
 * Every reason these folds are not two halves of one corpus.
 *
 * Returned as a list rather than thrown, because a caller that can see all four at once fixes them in one
 * edit, and because each sentence names the field and the two values it disagreed on — a pool that refused
 * with "the folds differ" would be a guard nobody could act on.
 */
export type CrossFitGuard = {
  readonly refusals: readonly string[];
  /** Every id the folds say they learned from, which the tiling census is taken over. */
  readonly learned: ReadonlySet<string>;
};

function guardOf(folds: readonly CrossFitFold[]): CrossFitGuard {
  if (folds.length < 2) {
    return {
      refusals: [
        'a cross-fit needs two folds: one fold is not a fit — a task is answered by a memory that never saw it ' +
          'only because the other half trained it, and with one fold there is no other half',
      ],
      learned: new Set(),
    };
  }
  const refusals: string[] = [];

  const empty = folds.filter((fold) => fold.tasks.length === 0).map((fold) => fold.label);
  if (empty.length > 0) {
    refusals.push(
      `fold(s) with no scored tasks: ${empty.join(', ')} — a fold that measured nothing cannot be half of a ` +
        'corpus, and dropping it silently would leave a pool that reads as two folds when it is one',
    );
  }

  const learnedBy = new Set<string>();
  const evaluatedBy = new Map<string, string>();
  const overlapping = new Set<string>();
  const leaked = new Map<string, string[]>();
  for (const fold of folds) {
    for (const task of fold.tasks) {
      const previous = evaluatedBy.get(task.id);
      if (previous !== undefined && previous !== fold.label) overlapping.add(`${task.id} (${previous}, ${fold.label})`);
      evaluatedBy.set(task.id, fold.label);
    }
    const learned = new Set(fold.learned ?? []);
    const own = fold.tasks.filter((task) => learned.has(task.id)).map((task) => task.id);
    if (own.length > 0) leaked.set(fold.label, own);
    for (const id of learned) learnedBy.add(id);
  }

  if (overlapping.size > 0) {
    refusals.push(
      `the same task is evaluated in two folds: ${elide([...overlapping].sort(), '; ')} — every task is answered once, by the memory ` +
        'that did not train on it; a task answered twice inflates the sample and narrows the interval in the ' +
        'direction that flatters the result',
    );
  }

  for (const [label, ids] of leaked) {
    refusals.push(
      `fold '${label}' evaluates ${String(ids.length)} task(s) its store learned from: ${elide(ids, ', ')} — that is ` +
        'the leak the cross-fit exists to exclude, and it is the expensive kind of wrong: the number comes out ' +
        'better than the truth rather than failing',
    );
  }

  const silent = folds.filter((fold) => fold.learned === undefined).map((fold) => fold.label);
  if (silent.length > 0) {
    refusals.push(
      `fold(s) that do not say what they learned from: ${silent.join(', ')} — the leak check is the whole claim ` +
        'of a cross-fit, and a fold that does not state its learning half cannot be checked for it',
    );
  }

  const base = identityOf(folds[0]!);
  for (const fold of folds.slice(1)) {
    const mine = identityOf(fold);
    for (const name of IDENTITY_FIELDS) {
      if (base[name] !== mine[name]) {
        refusals.push(
          `the folds are two experiments, not one corpus: ${name} is '${base[name]}' on ${folds[0]!.label} and ` +
            `'${mine[name]}' on ${fold.label}`,
        );
      }
    }
  }

  return { refusals, learned: learnedBy };
}

/**
 * Pool two folds of one corpus into one paired reading, or say why they are not two halves of one corpus.
 */
export function crossFitPool(
  folds: readonly CrossFitFold[],
  seed = CROSS_FIT_SEED,
  resamples = CROSS_FIT_RESAMPLES,
): CrossFitOutcome {
  const guard = guardOf(folds);
  if (guard.refusals.length > 0) return { ok: false, refusals: guard.refusals };

  const pooled = folds.flatMap((fold) => fold.tasks);
  const comparison = comparePaired(
    pooled.map((task) => task.controlPassed),
    pooled.map((task) => task.memoryPassed),
    seed,
    resamples,
  );

  const evaluated = new Set(pooled.map((task) => task.id));
  const neverLearned = [...evaluated].filter((id) => !guard.learned.has(id)).sort();
  const neverScored = [...guard.learned].filter((id) => !evaluated.has(id)).sort();
  const readings = folds.map(foldReadingOf);
  const positives = readings.filter((reading) => reading.deltaPp > 0).length;
  const negatives = readings.filter((reading) => reading.deltaPp < 0).length;

  return {
    ok: true,
    reading: {
      folds: readings,
      tasks: comparison.n,
      memoryPass4: comparison.treatmentAccuracy,
      controlPass4: comparison.baselineAccuracy,
      deltaPp: comparison.delta * 100,
      ciLowPp: comparison.deltaCI.low * 100,
      ciHighPp: comparison.deltaCI.high * 100,
      p: comparison.p,
      lost: comparison.lost,
      gained: comparison.gained,
      discordance: comparison.discordance,
      mde80Pp: detectableDelta(comparison.n, comparison.discordance) * 100,
      evaluated: evaluated.size,
      learned: guard.learned.size,
      neverLearned,
      neverScored,
      tiles: neverLearned.length === 0 && neverScored.length === 0,
      // Two deltas that both sit at exactly zero agree — neither contradicts the other. A pooled number
      // built from one positive and one negative fold is an average of two findings, and the flag is how a
      // reader learns that without recomputing the columns.
      agreeInSign: positives === 0 || negatives === 0,
    },
  };
}

/** The reading as one line, in the shape every other instrument in this lane prints. */
export function crossFitLine(reading: CrossFitReading): string {
  const folds = reading.folds
    .map((fold) => `${fold.label} ${fold.deltaPp >= 0 ? '+' : ''}${fold.deltaPp.toFixed(2)}pp (n=${String(fold.tasks)})`)
    .join(', ');
  const tiling = reading.tiles
    ? `tiles ${String(reading.evaluated)} of ${String(reading.learned)} task(s)`
    : `does not tile: ${String(reading.neverLearned.length)} evaluated task(s) learned by neither fold, ` +
      `${String(reading.neverScored.length)} learned task(s) evaluated by neither`;
  return (
    `[cross-fit] pooled n=${String(reading.tasks)} memory=${reading.memoryPass4.toFixed(4)} ` +
    `control=${reading.controlPass4.toFixed(4)} delta=${reading.deltaPp >= 0 ? '+' : ''}` +
    `${reading.deltaPp.toFixed(2)}pp [${reading.ciLowPp.toFixed(2)}, ${reading.ciHighPp.toFixed(2)}] ` +
    `p=${reading.p.toFixed(4)} lost=${String(reading.lost)} gained=${String(reading.gained)} ` +
    `mde80=${reading.mde80Pp.toFixed(2)}pp\n` +
    `[cross-fit] folds: ${folds}\n` +
    `[cross-fit] ${tiling}; folds ${reading.agreeInSign ? 'agree' : 'disagree'} in sign`
  );
}

/** The refusal as one line per reason, which is what a caller prints before it exits non-zero. */
export function crossFitRefusalLine(refusals: readonly string[]): string {
  return refusals.map((reason) => `[cross-fit] REFUSED: ${reason}`).join('\n');
}

/**
 * The two id sets a fold is, read from the arms' own record of the split.
 *
 * The pair artefact states the split it ran only since R143, and until now nothing in the record let a reader
 * check the one property a cross-fit rests on: that no fold scored a task its store had learned from. The
 * arms carry their `train`/`test` lists, so the pair can state both halves and the pool can refuse a leak
 * before an arm is ever dispatched.
 *
 * The two arms must agree on both halves. They are the same split by construction, and an artefact whose
 * memory arm learned from one half while its reference arm answered the other is not a pair — it is two runs,
 * and the delta between them is not a treatment effect.
 */
export type FoldSplitArm = {
  readonly label: string;
  readonly train: readonly string[] | undefined;
  readonly test: readonly string[] | undefined;
};

export type FoldSplitOutcome =
  | { readonly ok: true; readonly learned: readonly string[]; readonly evaluated: readonly string[] }
  | { readonly ok: false; readonly reason: string };

/**
 * The arms that state what they answered, or nothing when one of them does not.
 *
 * Returned as a list of narrower objects rather than read through an optional twice: the guard's conclusion
 * is a fact the compiler should be told, and `test?.x ?? []` after the guard would be a branch no input can
 * reach — the kind of dead protection that reads as care and is never exercised.
 *
 * Only `test` is required. `train` is not, because the two arms of this lane are not symmetric: the reference
 * arm serves no pack and distils nothing, so `controlRaw` records an empty learning half on purpose, and an
 * arm whose store is empty is a control rather than a fold that forgot to state its split.
 */
function statedHalvesOf(
  arms: readonly FoldSplitArm[],
): readonly { readonly label: string; readonly train: readonly string[] | undefined; readonly test: readonly string[] }[] | undefined {
  const stated: { label: string; train: readonly string[] | undefined; test: readonly string[] }[] = [];
  for (const arm of arms) {
    if (arm.test === undefined) return undefined;
    stated.push({ label: arm.label, train: arm.train, test: arm.test });
  }
  return stated;
}

export function foldSplitOf(arms: readonly FoldSplitArm[]): FoldSplitOutcome {
  if (arms.length === 0) {
    // No arms at all: a caller that read an empty directory. Refused rather than answered with two empty
    // halves, which would read as a split over nothing.
    return { ok: false, reason: 'no arm to read a split from' };
  }
  const stated = statedHalvesOf(arms);
  if (stated === undefined) {
    const silent = arms.filter((arm) => arm.test === undefined).map((arm) => arm.label);
    return { ok: false, reason: `arm(s) record no evaluation half: ${silent.join(', ')}` };
  }
  const first = stated[0]!;
  const evaluated = [...first.test].sort();
  for (const arm of stated.slice(1)) {
    const theirs = [...arm.test].sort();
    if (theirs.join(',') !== evaluated.join(',')) {
      return {
        ok: false,
        reason: `the arms answered different halves: '${arm.label}' answered ${String(theirs.length)} against ` +
          `${String(evaluated.length)}, and the lists differ`,
      };
    }
  }

  // The learning half is the pair's too, and it is the union of every half an arm actually learned from: a
  // control arm's empty list adds nothing, and two arms that state two different non-empty halves are two
  // stores rather than one treatment. Narrowed here rather than filtered and re-read with `?? []` below,
  // because a fallback after the filter would be a branch no input can reach.
  const learnedBy: { readonly label: string; readonly train: readonly string[] }[] = [];
  for (const arm of stated) {
    const mine = arm.train;
    if (mine !== undefined && mine.length > 0) learnedBy.push({ label: arm.label, train: mine });
  }
  const [learner, ...others] = learnedBy;
  if (learner === undefined) {
    // No store anywhere: the leak check would compare nothing and the pool would report a fold whose memory
    // never existed. Refused rather than pooled as a control, which is not a half of a corpus.
    return { ok: false, reason: 'no arm states a learning half: a fold whose store learned nothing cannot be half of a corpus' };
  }
  const base = [...learner.train].sort();
  for (const arm of others) {
    const mine = [...arm.train].sort();
    if (mine.join(',') !== base.join(',')) {
      return {
        ok: false,
        reason: `the arms learned different halves: '${arm.label}' learned ${String(mine.length)} against ${String(base.length)}`,
      };
    }
  }
  const learned = [...new Set(learnedBy.flatMap((arm) => [...arm.train]))].sort();
  const overlap = learned.filter((id) => evaluated.includes(id));
  if (overlap.length > 0) {
    return {
      ok: false,
      reason: `${String(overlap.length)} task(s) are in both halves of the split: ${overlap.slice(0, 5).join(', ')}`,
    };
  }
  return { ok: true, learned, evaluated };
}

/**
 * What the pair ran, read from the two arms rather than from the dispatch that sent them.
 *
 * The cross-fit's second claim is that its folds are two halves of one treatment, and until this existed the
 * only record of what the treatment was lived in the workflow's environment and in prose. An artefact that
 * cannot state its own unit, form, scope and model cannot be pooled against another one — which is the rule
 * `poolArms` has enforced since R85 — so the pair states them and the pool compares them.
 *
 * Three rules, and each one is a way the pair is not a pair:
 *
 * - a field the arms disagree on is two runs, not one treatment, and the delta between them is not an effect;
 * - a field one arm states and the other does not is a field nobody can compare, which is the same defect as a
 *   disagreement with less information;
 * - a field neither arm states is left out of the result rather than filled with a default, because a default
 *   that reached the pool would make two different runs look identical.
 */
export type TreatmentArm = {
  readonly label: string;
  readonly unit: string | undefined;
  readonly form: string | undefined;
  readonly scope: string | undefined;
  readonly model: string | undefined;
  readonly traceClaims: number | undefined;
  readonly knobs: string | undefined;
  readonly rotation: string | undefined;
  /** R204: what the pack was made of. Stated by the arm that serves one, silent on the control. */
  readonly serveBody: string | undefined;
};

export type Treatment = {
  readonly unit?: string;
  readonly form?: string;
  readonly scope?: string;
  readonly model?: string;
  readonly traceClaims?: number;
  readonly knobs?: string;
  /**
   * R152, total since R202: how far the treatment let its items travel.
   *
   * Always present on a treatment this module returns, and `none` is the literal for a pair no arm declared a
   * policy for. It used to be omitted in that case, which made a declared `none` and an artefact written before
   * the field indistinguishable at the one place the distinction matters — the pool key — and that is how
   * R152c's bounded fold was averaged with three unbounded ones under one label. The field is written rather
   * than defaulted at the reader because the pair is the last producer that knows which arm stated what.
   */
  readonly rotation: string;
  /**
   * R204, total from the start: what the pack is made of at serve time.
   *
   * `rendered` for every arm written before this field existed, and that is a fact rather than a default: there
   * was one body, and the record's own module docstring says so. `guidance` is the transient arm, where the
   * block is the summariser's input and the sentence is the pack.
   *
   * Total at the producer for R202's reason. A pool key that cannot see the body would average a block arm's
   * `pass^4` with a sentence arm's and call the result the treatment's — and unlike `rotation`, where the
   * historical artefact ambiguity had to be preserved because five committed folds' keys depended on it, here
   * the honest value for every earlier fold is known.
   */
  readonly serveBody: string;
};

export type TreatmentOutcome =
  | { readonly ok: true; readonly treatment: Treatment }
  | { readonly ok: false; readonly reason: string };

type Stated<T> = { readonly label: string; readonly value: T | undefined };

/**
 * One field, compared across the arms.
 *
 * A generic rather than five copies of the same four lines: the rule is identical for all five fields, and a
 * field that skipped the comparison because it was copied by hand is exactly the defect this guards.
 *
 * The comparison is over the arms that state the field. A control arm states none of the store's shape — it
 * serves no pack, distils nothing, and has no unit, form, scope or knobs to report — so requiring every field
 * twice made this function refuse the only pair shape this lane produces: the committed artefact still reads
 * `treatmentAbsent: "the arms do not both state unit: reference record none"`. What is still refused, and is
 * what the guard exists for, is two arms that both state a field and disagree — that is two runs, and the
 * delta between them is not a treatment effect.
 */
function agreement<T extends string | number>(
  field: string,
  first: Stated<T>,
  rest: readonly Stated<T>[],
): { readonly ok: true; readonly value: T | undefined } | { readonly ok: false; readonly reason: string } {
  if (rest.length === 0) return { ok: false, reason: 'a treatment needs two arms: one arm is not a pair' };
  const stated: { readonly label: string; readonly value: T }[] = [];
  for (const arm of [first, ...rest]) {
    if (arm.value !== undefined) stated.push({ label: arm.label, value: arm.value });
  }
  const [head, ...tail] = stated;
  if (head === undefined) return { ok: true, value: undefined };
  const differing = tail.find((arm) => arm.value !== head.value);
  if (differing !== undefined) {
    return {
      ok: false,
      reason:
        `the arms are two runs, not one treatment: ${field} is '${String(head.value)}' on ${head.label} and ` +
        `'${String(differing.value)}' on ${differing.label}`,
    };
  }
  return { ok: true, value: head.value };
}

export function treatmentOf(arms: readonly TreatmentArm[]): TreatmentOutcome {
  const [head, ...rest] = arms;
  if (head === undefined) return { ok: false, reason: 'no arm to read a treatment from' };
  const others = rest.map((arm) => ({
    label: arm.label,
    unit: arm.unit,
    form: arm.form,
    scope: arm.scope,
    model: arm.model,
    traceClaims: arm.traceClaims,
    knobs: arm.knobs,
    rotation: arm.rotation,
    serveBody: arm.serveBody,
  }));
  const unit = agreement('unit', { label: head.label, value: head.unit }, others.map((arm) => ({ label: arm.label, value: arm.unit })));
  if (!unit.ok) return unit;
  const form = agreement('form', { label: head.label, value: head.form }, others.map((arm) => ({ label: arm.label, value: arm.form })));
  if (!form.ok) return form;
  const scope = agreement('scope', { label: head.label, value: head.scope }, others.map((arm) => ({ label: arm.label, value: arm.scope })));
  if (!scope.ok) return scope;
  const model = agreement('model', { label: head.label, value: head.model }, others.map((arm) => ({ label: arm.label, value: arm.model })));
  if (!model.ok) return model;
  const ceiling = agreement(
    'traceClaims',
    { label: head.label, value: head.traceClaims },
    others.map((arm) => ({ label: arm.label, value: arm.traceClaims })),
  );
  if (!ceiling.ok) return ceiling;
  const knobs = agreement(
    'knobs',
    { label: head.label, value: head.knobs },
    others.map((arm) => ({ label: arm.label, value: arm.knobs })),
  );
  if (!knobs.ok) return knobs;
  // R152: the serving policy. Compared like every other field, and stated only by an arm that declared one — the
  // control arm serves no pack and therefore has no policy to state, which is silence rather than a disagreement.
  // R202: and then written unconditionally. `agreement` answers `undefined` when no arm stated the field, which
  // is the shape a pair of pre-R152 artefacts has; omitting it there made the pair's key identical to a pair that
  // declared `none`, so the pool could not separate "served without a rotation" from "cannot say". The value is
  // now `none` in that case — a claim about the treatment rather than about the file — and the artefact-level
  // ambiguity that remains is confined to the three folds written before the field existed, whose keys stay
  // exactly as they were because `treatmentKeyOf` still omits a field the file does not carry.
  const rotation = agreement(
    'rotation',
    { label: head.label, value: head.rotation },
    others.map((arm) => ({ label: arm.label, value: arm.rotation })),
  );
  if (!rotation.ok) return rotation;
  // R204: written unconditionally, like `rotation` and for the same reason — but with a value that is true of
  // every earlier fold rather than one that has to be declared, because before this field there was only ever
  // one body. Two folds that served different bodies are two treatments, and the pool refuses them here.
  const serveBody = agreement(
    'serveBody',
    { label: head.label, value: head.serveBody },
    others.map((arm) => ({ label: arm.label, value: arm.serveBody })),
  );
  if (!serveBody.ok) return serveBody;
  return {
    ok: true,
    treatment: {
      ...(unit.value === undefined ? {} : { unit: unit.value }),
      ...(form.value === undefined ? {} : { form: form.value }),
      ...(scope.value === undefined ? {} : { scope: scope.value }),
      ...(model.value === undefined ? {} : { model: model.value }),
      ...(ceiling.value === undefined ? {} : { traceClaims: ceiling.value }),
      ...(knobs.value === undefined ? {} : { knobs: knobs.value }),
      rotation: rotation.value ?? 'none',
      serveBody: serveBody.value ?? 'rendered',
    },
  };
}

/**
 * A fold's ledger as one outcome per task, which is the unit both arms are paired on.
 *
 * `pass^4` is the lane's reading, so a task counts only when every trial passed — an arm that passed three of
 * four is the same task-level result as one that passed none, and averaging trials instead would quietly turn
 * the lane's own metric into a different one.
 */
export type FoldTrialRow = {
  readonly task: string;
  readonly blankCorrect: boolean;
  readonly withMemoryCorrect: boolean;
};

export type FoldTasksOutcome =
  | { readonly ok: true; readonly tasks: readonly CrossFitTask[] }
  | { readonly ok: false; readonly reason: string };

export function foldTasksOf(rows: readonly FoldTrialRow[]): FoldTasksOutcome {
  if (rows.length === 0) {
    return { ok: false, reason: 'the ledger carries no trial rows, so the fold measured nothing' };
  }
  const byTask = new Map<string, { memory: boolean; control: boolean }>();
  for (const row of rows) {
    const current = byTask.get(row.task) ?? { memory: true, control: true };
    byTask.set(row.task, {
      memory: current.memory && row.withMemoryCorrect,
      control: current.control && row.blankCorrect,
    });
  }
  return {
    ok: true,
    // `localeCompare` rather than a hand-rolled comparator: the record's ledgers are ordered by id in every
    // artefact and a reader diffing two of them should not see them differ by sort algorithm.
    tasks: [...byTask].sort(([left], [right]) => left.localeCompare(right)).map(([id, outcome]) => ({
      id,
      memoryPassed: outcome.memory,
      controlPassed: outcome.control,
    })),
  };
}
