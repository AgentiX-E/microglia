/**
 * Re-grade a committed pair artefact's `l4-*` rows from the measurements the same file already carries.
 *
 * AUDIT 34.197 fixed a gate whose predicate was looser than its criterion, and the fix moves a row in two
 * artefacts that are already in the repository. Re-running the pair would cost two dispatches and would
 * answer a different question — a new draw of 40 tasks is not the same 40 tasks — so what is needed is not
 * new evidence but the **same** evidence graded by the corrected rule. That is all this does: the numbers
 * (`deltaPp`, `p`, `paired`, `served`, `detectablePp`) are read out of the file and never rewritten; the
 * rows computed from them are recomputed.
 *
 * ## What it refuses, and why refusing is the point
 *
 * A tool that rewrites committed evidence has to be narrower than a tool that writes evidence:
 *
 *   - **A file it cannot read in full.** Every input is read through a typed accessor that throws rather
 *     than defaulting. A missing `protocol.detectablePp` would otherwise become `undefined`, which the
 *     predicate treats as "no resolution", which would silently turn every regraded row false.
 *   - **A file whose serialisation it would change.** The rewrite round-trips the parse through the same
 *     `JSON.stringify(value, null, 2)` the writer uses and refuses if the result is not byte-identical to
 *     the input. Without that, a regrade of two rows could reformat a 43 kB file and no reader could tell
 *     the re-grade from a rewrite of the evidence.
 *   - **A row it would add.** The rows this computes but the file does not carry are reported as `ungraded`
 *     and left out. `poc-l4-pair-official.json` predates `l4-rotation-reconciles`, and appending a row the
 *     driver of the day could not have written would date the file to a run it did not come from.
 *
 * ## What it does not do
 *
 * It does not re-derive the verdict. `verdict.state` is an input: a state recomputed here from the same
 * numbers would agree with the file and prove nothing, and one recomputed from different numbers would be
 * a new experiment. The row that is regraded is the one that grades the verdict, not the verdict itself.
 */

import type { ValidityGate } from '@agentix-e/microglia-protocol';
import { pairGates, type PairGateInput } from './pair-gates.js';
import type { PairedVerdictState } from './paired-verdict.js';

/** One row that the corrected rule reads differently. */
export type RegradedRow = {
  readonly id: string;
  readonly from: boolean;
  readonly to: boolean;
  readonly actual: string;
};

/**
 * The rows a pair artefact can be re-graded on, because their every input is a field of that artefact.
 *
 * R156 is the round that found the rest could not. `l4-projection-complete` grades whether the driver's
 * emitted fields reached the artefact — and a pair artefact records *neither* the emitted fields nor the
 * projection's verdict on them, so a re-grader that recomputes it always finds "every field arrived",
 * because it can only see the fields that did. The first run of the regrade over the two recovered draws
 * did exactly that: R152's artefact carried `l4-projection-complete: false` from the run that wrote it,
 * and the re-grade turned it **true**, silently repairing a defect the file had recorded. That is the
 * worst possible direction for a re-grader to be wrong in, and it is why this list is an allow-list
 * rather than a block-list: a row added to `pairGates` later is preserved by default, and somebody has to
 * argue for it here.
 *
 * `l4-rotation-reconciles` fails the same test for the same reason: it reconciles the arm's serving
 * policy against the arm's pack ledger, and both live in the arm artefact rather than in the pair.
 */
const REGRADABLE = new Set(['l4-paired', 'l4-effect-resolved', 'l4-same-split']);

export type PairRegrade = {
  /** The gate table as it should read now, in the file's own order. */
  readonly gates: readonly ValidityGate[];
  /** Rows whose pass or sentence moved. Empty means the file already reads correctly. */
  readonly changed: readonly RegradedRow[];
  /** Rows this rule computes that the file predates, left out of `gates` and named here instead. */
  readonly ungraded: readonly string[];
  /** Rows kept exactly as the file wrote them, with the reason this tool cannot see their evidence. */
  readonly preserved: readonly { readonly id: string; readonly reason: string }[];
};

/** The artefact fields this reads, named so an error says which one is missing. */
const STATES: readonly PairedVerdictState[] = ['HARM', 'BENEFIT', 'UNRESOLVED'];

function object(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function number(parent: Record<string, unknown>, key: string, path: string): number {
  const value = parent[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${path}.${key} must be a finite number`);
  }
  return value;
}

function array(parent: Record<string, unknown>, key: string, path: string): readonly unknown[] {
  const value = parent[key];
  if (!Array.isArray(value)) throw new Error(`${path}.${key} must be an array`);
  return value;
}

/** Every input `pairGates` reads, taken from the artefact rather than recomputed. */
function inputOf(artefact: Record<string, unknown>): PairGateInput {
  const verdict = object(artefact['verdict'], 'verdict');
  const comparison = object(artefact['comparison'], 'comparison');
  const protocol = object(artefact['protocol'], 'protocol');
  const state = verdict['state'];
  if (typeof state !== 'string' || !STATES.includes(state as PairedVerdictState)) {
    throw new Error(`verdict.state must be one of ${STATES.join(', ')}`);
  }
  const claim = verdict['claim'];
  if (claim !== null && typeof claim !== 'string') {
    throw new Error('verdict.claim must be a string or null');
  }
  const onlyFirst = number(comparison, 'onlyFirst', 'comparison');
  const onlySecond = number(comparison, 'onlySecond', 'comparison');
  // R57's distractor arm, when the pair recorded one. Without it the recomputation treats a planted arm as a
  // treatment and rewrites its `l4-paired` sentence into a claim the arm never made — the row is omitted for
  // a distractor, and the omitted row is then preserved exactly as the run wrote it.
  const plantedArm = artefact['planted_arm'];
  if (plantedArm !== undefined && typeof plantedArm !== 'string') {
    throw new Error('planted_arm must be a string when present');
  }
  return {
    state: state as PairedVerdictState,
    claim,
    deltaPp: number(comparison, 'deltaPp', 'comparison'),
    p: number(comparison, 'p', 'comparison'),
    paired: number(comparison, 'paired', 'comparison'),
    served: number(verdict, 'servedPacks', 'verdict'),
    detectablePp: number(protocol, 'detectablePp', 'protocol'),
    splitMatches: onlyFirst === 0 && onlySecond === 0,
    onlyFirst,
    onlySecond,
    ...(plantedArm === undefined ? {} : { plantedArm }),
  };
}

function gateOf(value: unknown, index: number): ValidityGate {
  const gate = object(value, `gates[${String(index)}]`);
  const id = gate['id'];
  if (typeof id !== 'string') throw new Error(`gates[${String(index)}].id must be a string`);
  if (typeof gate['criterion'] !== 'string') throw new Error(`gates[${String(index)}].criterion must be a string`);
  if (typeof gate['actual'] !== 'string') throw new Error(`gates[${String(index)}].actual must be a string`);
  if (typeof gate['pass'] !== 'boolean') throw new Error(`gates[${String(index)}].pass must be a boolean`);
  if (typeof gate['blocking'] !== 'boolean') throw new Error(`gates[${String(index)}].blocking must be a boolean`);
  return gate as unknown as ValidityGate;
}

/**
 * Re-grade one artefact's `l4-*` rows, leaving every other row and every measurement untouched.
 *
 * Rows are matched by id and replaced whole — criterion, sentence and predicate — because the three have
 * to agree, and a table that kept the old sentence beside the new predicate would be the defect this
 * repairs. Order is the file's own, so a diff of the result shows only rows that moved.
 */
export function regradePair(artefact: unknown): PairRegrade {
  const root = object(artefact, 'artefact');
  const existing = array(root, 'gates', 'artefact').map(gateOf);
  const computed = pairGates(inputOf(root));
  const byId = new Map(computed.map((gate) => [gate.id, gate]));
  const ids = new Set(existing.map((gate) => gate.id));

  const preserved: { id: string; reason: string }[] = [];
  const gates = existing.map((gate) => {
    const reason = preserveReason(gate);
    // Only a row this rule *could* have recomputed is worth reporting: the protocol's own rows are not
    // this tool's subject, and printing "kept as written" beside eighteen of them would bury the two
    // that matter.
    if (reason !== null && byId.has(gate.id)) {
      preserved.push({ id: gate.id, reason });
      return gate;
    }
    return reason !== null ? gate : (byId.get(gate.id) ?? gate);
  });
  const changed: RegradedRow[] = [];
  gates.forEach((gate, index) => {
    const before = existing[index] as ValidityGate;
    if (before.pass === gate.pass && before.actual === gate.actual && before.criterion === gate.criterion) {
      return;
    }
    changed.push({ id: gate.id, from: before.pass, to: gate.pass, actual: gate.actual });
  });

  return {
    gates,
    changed,
    ungraded: computed
      .filter((gate) => !ids.has(gate.id) && REGRADABLE.has(gate.id))
      .map((gate) => gate.id),
    preserved,
  };
}

/**
 * Why this row may not be recomputed from the artefact, or null when it may.
 *
 * Two reasons, and both are about evidence that lives somewhere other than the file being re-graded: the
 * driver's field census, the arm's serving policy, and — the subtler one — the band an arm was held to,
 * which arrives through `TAU_BAND` and not through the artefact. A row graded under a band says so in its
 * own sentence, and re-computing it without one would replace "landed inside the interval it registered"
 * with a resolution question the pair never asked (AUDIT 34.128). The sentence is the only record of the
 * band, so it is read rather than assumed absent.
 */
function preserveReason(gate: ValidityGate): string | null {
  if (!REGRADABLE.has(gate.id)) {
    return gate.id === 'l4-projection-complete'
      ? "the driver's emitted fields are not in the pair artefact, so a recomputation can only confirm the fields that arrived"
      : 'the evidence for this row lives in the arm artefacts, not in the pair';
  }
  if (gate.id === 'l4-effect-resolved' && /registered band/.test(gate.actual)) {
    return 'this row was graded under a band that arrived through the dispatch environment, and the artefact carries it only in this sentence';
  }
  return null;
}

/**
 * The same re-grade as a text transform, on the writer's own serialisation.
 *
 * Refuses a file whose round trip is not byte-identical, so the only lines a regrade can move are the
 * rows it re-graded. Returns the new text rather than writing it: a writer here would be reachable from
 * the test suite, and a test that writes to `eval/results/` is a test that can overwrite the evidence it
 * grades (`POC_RESULT_DIR` exists for the same reason).
 */
export function regradePairText(text: string): { readonly text: string; readonly regrade: PairRegrade } {
  const parsed: unknown = JSON.parse(text);
  const canonical = `${JSON.stringify(parsed, null, 2)}\n`;
  if (canonical !== text) {
    throw new Error('the artefact is not in the canonical serialisation, so a regrade would reformat it');
  }
  const regrade = regradePair(parsed);
  const root = object(parsed, 'artefact');
  return { text: `${JSON.stringify({ ...root, gates: regrade.gates }, null, 2)}\n`, regrade };
}
