/**
 * What an arm declared, and which gates that declaration changes.
 *
 * ## The defect this exists to remove
 *
 * R101 registered a *scaffold* arm whose store is empty by construction — no learn episodes, no
 * distillation, no rules, the whole delivery path intact — and inverted two gates by hand, by name:
 * `V0-instrument-ready` and `V1-pack-not-empty`. The run then failed **three** gates nobody had
 * listed, every one of them for the same reason:
 *
 * ```
 * FAIL V44-domain-accounted     the store holds no item, so there is no ledger to account for
 * FAIL V16-transfer-resolvable  18 informative trial(s), 11 repair(s)
 * FAIL l4-effect-resolved       UNRESOLVED: |-5.00pp| against 24.27pp minimum detectable difference
 * ```
 *
 * The first two are gates that presume a store with something in it. The third is a gate that asks a
 * significance question of a pair registered to a *band*. Neither failure is a fact about the arm;
 * both are facts about a harness whose exceptions are remembered rather than derived. §34.124 had
 * already inverted two gates by hand and called it a design, and the run found three more of the
 * same kind — which is the third appearance of one pattern, and the reason this is a module rather
 * than three more `if` statements.
 *
 * ## The three dispositions, and why only one of them is admissible
 *
 * | disposition | what it makes the arm | verdict |
 * |---|---|---|
 * | waive the gate | unmeasurable — a gate that stands down for one arm is the vacuous pass this record keeps finding | refused |
 * | omit the gate | silent — and the statement would be "this run is not graded", about the run whose pipeline matters most | refused, **unless the arm has no subject for it at all** |
 * | **invert the gate** | **falsifiable** — the arm declared zero, so the quantity the gate requires to be non-zero must be zero | chosen |
 *
 * Omission survives in exactly one case: a gate whose *subject does not exist* on this arm, such as a
 * transfer trial for a store that served no rule to transfer. There the honest sentence is "not
 * graded, and here is why", and the omission is carried in `ScopedGates.omitted` rather than dropped
 * from the report. What is refused is omission as a convenience — a gate that could have fired and
 * was removed because it would have been red.
 *
 * ## Why the set is derived rather than listed
 *
 * A list of gate ids in a registration file is a second copy of the gates, maintained by whoever
 * writes the registration, and it drifts the first time somebody adds a gate. Instead each gate
 * declares **what it reads** at the point it is constructed — {@link storeReading} — and the set is
 * the filter over that declaration. Adding a store-reading gate without declaring it is a mistake
 * the *inverse* direction catches, because `V0-instrument-ready` still requires the funnel to be
 * empty and a gate that reads a store it does not declare will be graded against a zero population.
 *
 * The declaration travels on the gate as a non-enumerable symbol. That is deliberate and it is the
 * one subtle thing here: a published artefact is compared byte for byte by `eval:protocol`, so a
 * marker that serialised would have rewritten thirty-one committed reports to say something their
 * runs never knew. A symbol key is invisible to `JSON.stringify` and to `toEqual`, which keeps the
 * published shape of a gate exactly what it was.
 */

import type { ValidityGate } from './gates.js';

/** What a gate reads. Declared where the gate is built; the set of affected gates is a filter. */
export type GateSubject = 'store' | 'pack' | 'trial' | 'run';

/**
 * What a gate requires of a *declared-empty* arm.
 *
 * `null` is the inversion: the arm said it carried nothing, so the quantity this gate normally
 * requires to be non-zero is required to be zero instead. `measure` is that quantity and `reading`
 * is the sentence the gate would have printed on a normal arm — both come from the gate's own
 * inputs, so the inversion cannot describe a number the gate did not read.
 */
export type EmptyForm =
  | { readonly kind: 'null'; readonly measure: number; readonly reading: string }
  | { readonly kind: 'omit'; readonly reason: string };

const SUBJECT = Symbol.for('microglia.gate.subject');
const EMPTY = Symbol.for('microglia.gate.empty');

type Tagged = ValidityGate & {
  readonly [SUBJECT]?: GateSubject;
  readonly [EMPTY]?: EmptyForm;
};

function tag(gate: ValidityGate, subject: GateSubject, empty?: EmptyForm): ValidityGate {
  const target = gate as Tagged;
  Object.defineProperty(target, SUBJECT, { value: subject, enumerable: false, configurable: true });
  if (empty !== undefined) {
    Object.defineProperty(target, EMPTY, { value: empty, enumerable: false, configurable: true });
  }
  return gate;
}

/**
 * A gate that reads the store, and what it requires when the store is empty by declaration.
 *
 * `empty` is not optional here, and that is the point: a store-reading gate has to say what its
 * null looks like, because the reviewer of a red run will otherwise be the first person to ask.
 */
export function storeReading(gate: ValidityGate, empty: EmptyForm): ValidityGate {
  return tag(gate, 'store', empty);
}

/** A gate that reads transfer or repair trials, which a store with no rule cannot produce. */
export function trialReading(gate: ValidityGate, empty: EmptyForm): ValidityGate {
  return tag(gate, 'trial', empty);
}

/** A gate that reads the pack, which a store with no rule cannot fill. */
export function packGate(gate: ValidityGate, empty: EmptyForm): ValidityGate {
  return tag(gate, 'pack', empty);
}

/** Whether a gate reads the store, for a harness that wants to enumerate rather than scope. */
export function subjectOf(gate: ValidityGate): GateSubject {
  return (gate as Tagged)[SUBJECT] ?? 'run';
}

/** What an arm declared about itself. The only input to every disposition below. */
export type Declaration = {
  readonly declaredEmptyStore: boolean;
};

/** A gate that was not graded, and the sentence that says why. */
export type OmittedGate = { readonly id: string; readonly reason: string };

export type ScopedGates = {
  readonly gates: readonly ValidityGate[];
  /** Gates this arm has no subject for. Empty on every arm that declared nothing. */
  readonly omitted: readonly OmittedGate[];
};

/**
 * The criterion an inverted gate states.
 *
 * Written once rather than per gate because the claim is the same for all of them: the zero is the
 * arm agreeing with its declaration, not the gate standing down. A gate that phrased this itself
 * would sooner or later phrase it as a pass.
 */
const INVERTED_CRITERION =
  'the arm declared its store empty before the first episode, so the quantity this gate requires ' +
  'to be non-zero is required to be zero: a declaration that carries anything is no longer the ' +
  'control it was registered as';

/**
 * Apply an arm's declaration to the gates it would otherwise be graded by.
 *
 * A gate the arm declared nothing about is returned untouched — including its identity, so a caller
 * comparing two runs of the same arm sees the same objects it saw before this module existed.
 */
export function scopeGates(
  gates: readonly ValidityGate[],
  declaration: Declaration | undefined,
): ScopedGates {
  if (declaration === undefined || declaration.declaredEmptyStore !== true) {
    return { gates, omitted: [] };
  }
  const kept: ValidityGate[] = [];
  const omitted: OmittedGate[] = [];
  for (const gate of gates) {
    if (subjectOf(gate) === 'run') {
      kept.push(gate);
      continue;
    }
    const form = (gate as Tagged)[EMPTY];
    if (form === undefined) {
      // A gate that reads a populated store and never said what its empty form is. Refusing is the
      // only honest reading: grading it as it stands is how R101 produced three failures the
      // registration did not predict, and dropping it quietly is the vacuous pass §34.126 records.
      throw new Error(
        `gate '${gate.id}' reads the ${subjectOf(gate)} and declares no empty form: a declared-empty ` +
          'arm cannot be graded by a gate whose null the gate does not state',
      );
    }
    if (form.kind === 'omit') {
      omitted.push({ id: gate.id, reason: form.reason });
      continue;
    }
    kept.push({
      id: gate.id,
      criterion: INVERTED_CRITERION,
      actual:
        `${form.reading}; declared empty, so this must be 0 and is ${form.measure}` +
        (form.measure === 0 ? '' : ' — the declaration and the run disagree'),
      pass: form.measure === 0,
      // Blocking, and not the gate's own flag: the declaration is the arm's strongest claim about
      // itself, so a run that contradicts it has no numbers worth reading at all.
      blocking: true,
    });
  }
  return { gates: kept, omitted };
}
