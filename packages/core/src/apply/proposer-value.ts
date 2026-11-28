/**
 * Proposer value (R256) — the zero-cost gate in front of a paid model arm.
 *
 * ## The gap this closes
 *
 * R104b is the one remaining paid arm on the critical path: a model writes an experience candidate, priced at about
 * $0.01 per candidate. Its own registered prediction says *"no gain unless `fragmentation` is high — a proposer
 * fixes prose, and `census.fragmentation` is the number that says whether prose is the problem"*. Every plan before
 * this module treated that prediction as prose and went straight to the price. This module makes it a machine
 * decision: a free, deterministic gate that decides **whether the paid arm is worth calling at all**.
 *
 * That is the cost-minimisation answer to the generator/candidate-pool work. The expensive version of that work is a
 * fine-tuned generator plus a pool of 5–21 heterogeneous candidates — a technique that belongs to the text-to-SQL
 * leaderboard (an `AgentiX-E/nl2charts` concern), not to a general experience-memory amplifier. Here the same
 * intent is served without touching a model: measure whether the deterministic fold already reached the repairs
 * (fragmentation), whether the evidence is trustworthy (witness), whether the real defect is a chain needing a
 * cheaper split (chained), and whether the call fits the budget. Pay only when all three value signals agree.
 *
 * ## The registered ladder (strict priority)
 *
 * 1. `no-candidates` — an empty candidate set is vacuous, not a free win.
 * 2. `over-budget` — `candidateCount * unitCostMicros > budgetMicros` is a hard stop, however good the value signals.
 * 3. `prose-not-the-problem` — `fragmentationMilli < 300`: the deterministic fold already reached the repairs.
 * 4. `weak-witness` — `witnessMilli < 500`: the model arm cannot be trusted on this corpus.
 * 5. `grouping-first` — `chainedShareMilli > 300`: the defect is a chain; the cheaper split arm (R104c) goes first.
 * 6. `worth-proposing` — otherwise pay.
 *
 * The strictest firing rung wins. The three inequality boundaries are chosen so that the gate is falsifiable:
 * fragmentation uses `>=` (at the floor, prose is worth fixing), budget uses strict `>` (spending exactly the budget
 * is allowed), chaining uses strict `>` (at the ceiling, grouping-first does not fire).
 *
 * ## Discipline
 *
 * Pure and deterministic; no clock, no network, no model, zero cost. Every guard refuses rather than defaults: a
 * malformed signal must never silently become an `admit`. All money and rates are integers (micro-USD costs,
 * thousandth rates), so the product and the independent Python reader compare integers, never floats. Cost units are
 * injected by the caller (`unitCostMicros`), so the gate is provider-agnostic: a DeepSeek quote today and any other
 * provider tomorrow use the same ladder.
 */
import { MicrogliaError } from '../kernel/index.js';

/** Pre-registered value floors. Written before any readback, and exported so a reader can bind them. */
export const FRAGMENTATION_FLOOR_MILLI = 300;
export const WITNESS_FLOOR_MILLI = 500;
export const CHAINED_CEILING_MILLI = 300;

/** Set verdicts, in increasing strictness. */
export const PROPOSER_VERDICTS = ['admit', 'reweight', 'abstain', 'reject'] as const;
export type ProposerVerdict = (typeof PROPOSER_VERDICTS)[number];

/** Reasons, one per ladder rung. */
export const PROPOSER_REASONS = [
  'worth-proposing',
  'grouping-first',
  'weak-witness',
  'prose-not-the-problem',
  'over-budget',
  'no-candidates',
] as const;
export type ProposerReason = (typeof PROPOSER_REASONS)[number];

/** Which signal a set-level reason came from. */
export const PROPOSER_SIGNALS = [
  'none',
  'chaining',
  'witness',
  'fragmentation',
  'cost',
  'candidate-count',
] as const;
export type ProposerSignal = (typeof PROPOSER_SIGNALS)[number];

/** Signals a caller may ablate to see which one actually decided the verdict. */
export const ABLATABLE_SIGNALS = ['cost', 'fragmentation', 'witness', 'chaining'] as const;
export type AblatableSignal = (typeof ABLATABLE_SIGNALS)[number];

const REASON_SEVERITY: Readonly<Record<ProposerReason, number>> = {
  'worth-proposing': 0,
  'grouping-first': 1,
  'weak-witness': 2,
  'prose-not-the-problem': 3,
  'over-budget': 4,
  'no-candidates': 5,
};

const VERDICT_OF: Readonly<Record<ProposerReason, ProposerVerdict>> = {
  'worth-proposing': 'admit',
  'grouping-first': 'reweight',
  'weak-witness': 'abstain',
  'prose-not-the-problem': 'reject',
  'over-budget': 'reject',
  'no-candidates': 'reject',
};

const SIGNAL_OF: Readonly<Record<ProposerReason, ProposerSignal>> = {
  'worth-proposing': 'none',
  'grouping-first': 'chaining',
  'weak-witness': 'witness',
  'prose-not-the-problem': 'fragmentation',
  'over-budget': 'cost',
  'no-candidates': 'candidate-count',
};

export type ProposerAblation = {
  readonly id: string;
  readonly removedSignal: AblatableSignal;
};

export type ProposerValueInput = {
  readonly id: string;
  /** Share of repairs no cluster reached, thousandths in [0,1000] — `clusterCensusOf().fragmentation * 1000`. */
  readonly fragmentationMilli: number;
  /** Witness pass rate over the candidate set, thousandths in [0,1000]. */
  readonly witnessMilli: number;
  /** Share of chained clusters, thousandths in [0,1000]. */
  readonly chainedShareMilli: number;
  /** How many candidates the paid arm would write. */
  readonly candidateCount: number;
  /** Injected per-candidate cost, integer micro-USD, so the gate is provider-agnostic. */
  readonly unitCostMicros: number;
  /** Integer micro-USD ceiling for this decision. */
  readonly budgetMicros: number;
  readonly ablations?: readonly ProposerAblation[];
};

export type ProposerAblationReading = {
  readonly id: string;
  readonly removedSignal: AblatableSignal;
  readonly beforeVerdict: ProposerVerdict;
  readonly afterVerdict: ProposerVerdict;
  readonly changed: boolean;
};

export type ProposerValue = {
  readonly id: string;
  readonly verdict: ProposerVerdict;
  readonly reason: ProposerReason;
  readonly decidingSignal: ProposerSignal;
  readonly estimatedCostMicros: number;
  readonly overBudgetByMicros: number;
  readonly candidateCount: number;
  readonly fragmentationFloorMilli: number;
  readonly witnessFloorMilli: number;
  readonly chainedCeilingMilli: number;
  readonly ablations: readonly ProposerAblationReading[];
};

const isNonBlank = (value: unknown): value is string =>
  typeof value === 'string' && value.trim() !== '';
const isMilli = (value: unknown): value is number =>
  Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 1000;
const isCount = (value: unknown): value is number =>
  Number.isInteger(value) && (value as number) >= 0;

/** Validate a set of inputs, or refuse. Shared by the main call and every ablation re-run. */
function checkInput(input: ProposerValueInput): void {
  if (!isNonBlank(input.id)) {
    throw new MicrogliaError('MG_E_CONFIG', 'proposer value: blank id', { field: 'id' });
  }
  if (!isMilli(input.fragmentationMilli)) {
    throw new MicrogliaError('MG_E_CONFIG', 'proposer value: fragmentationMilli out of range', {
      field: 'fragmentationMilli',
    });
  }
  if (!isMilli(input.witnessMilli)) {
    throw new MicrogliaError('MG_E_CONFIG', 'proposer value: witnessMilli out of range', {
      field: 'witnessMilli',
    });
  }
  if (!isMilli(input.chainedShareMilli)) {
    throw new MicrogliaError('MG_E_CONFIG', 'proposer value: chainedShareMilli out of range', {
      field: 'chainedShareMilli',
    });
  }
  if (!isCount(input.candidateCount)) {
    throw new MicrogliaError('MG_E_CONFIG', 'proposer value: candidateCount out of range', {
      field: 'candidateCount',
    });
  }
  if (!isCount(input.unitCostMicros)) {
    throw new MicrogliaError('MG_E_CONFIG', 'proposer value: unitCostMicros out of range', {
      field: 'unitCostMicros',
    });
  }
  if (!isCount(input.budgetMicros)) {
    throw new MicrogliaError('MG_E_CONFIG', 'proposer value: budgetMicros out of range', {
      field: 'budgetMicros',
    });
  }
}

/** Validate ablations without mutating, so a malformed ablation cannot pass as a decision. */
function checkAblations(ablations: readonly ProposerAblation[] | undefined): void {
  if (ablations === undefined) return;
  if (!Array.isArray(ablations)) {
    throw new MicrogliaError('MG_E_CONFIG', 'proposer value: ablations must be an array', {
      field: 'ablations',
    });
  }
  const ablatable: ReadonlySet<string> = new Set<string>(ABLATABLE_SIGNALS);
  const seen = new Set<string>();
  for (const ablation of ablations) {
    if (ablation === null || typeof ablation !== 'object' || Array.isArray(ablation)) {
      throw new MicrogliaError('MG_E_CONFIG', 'proposer value: ablation must be an object', {
        field: 'ablations',
      });
    }
    if (!isNonBlank(ablation.id)) {
      throw new MicrogliaError('MG_E_CONFIG', 'proposer value: blank ablation id', {
        field: 'ablations',
      });
    }
    if (typeof ablation.removedSignal !== 'string' || !ablatable.has(ablation.removedSignal)) {
      throw new MicrogliaError('MG_E_CONFIG', 'proposer value: unknown removed signal', {
        field: 'ablations',
      });
    }
    if (seen.has(ablation.id)) {
      throw new MicrogliaError('MG_E_CONFIG', 'proposer value: duplicate ablation id', {
        field: 'ablations',
      });
    }
    seen.add(ablation.id);
  }
}

/** Compute the estimated cost in integer micro-USD; the multiplication is exact for integer operands. */
function costOf(input: ProposerValueInput): number {
  return input.candidateCount * input.unitCostMicros;
}

/**
 * Every firing rung, collected rather than short-circuited, so "strictest wins" is decided by the severity table and
 * not by the order of the checks below. `neutral` names a signal to ignore (an ablation): the gate re-runs as if that
 * signal had passed at its boundary, so a changed verdict falsifies the claim that this gate was the whole decision.
 */
function firingReasons(input: ProposerValueInput, neutral: AblatableSignal | undefined): ProposerReason[] {
  const fired: ProposerReason[] = [];
  if (input.candidateCount === 0) fired.push('no-candidates');
  if (neutral !== 'cost' && costOf(input) > input.budgetMicros) fired.push('over-budget');
  if (neutral !== 'fragmentation' && input.fragmentationMilli < FRAGMENTATION_FLOOR_MILLI) {
    fired.push('prose-not-the-problem');
  }
  if (neutral !== 'witness' && input.witnessMilli < WITNESS_FLOOR_MILLI) fired.push('weak-witness');
  if (neutral !== 'chaining' && input.chainedShareMilli > CHAINED_CEILING_MILLI) {
    fired.push('grouping-first');
  }
  return fired;
}

/** The strictest firing rung, or `worth-proposing` when none fires. */
function decide(
  input: ProposerValueInput,
  neutral: AblatableSignal | undefined,
): { reason: ProposerReason; estimatedCostMicros: number; overBudgetByMicros: number } {
  const estimatedCostMicros = costOf(input);
  const overBudgetByMicros = Math.max(0, estimatedCostMicros - input.budgetMicros);
  let reason: ProposerReason = 'worth-proposing';
  for (const fired of firingReasons(input, neutral)) {
    if (REASON_SEVERITY[fired] > REASON_SEVERITY[reason]) reason = fired;
  }
  return { reason, estimatedCostMicros, overBudgetByMicros };
}

/**
 * Decide whether the paid proposer arm is worth calling. Zero cost, no model, deterministic.
 *
 * The reason severity ladder exists so that a set-level verdict is a function of the strictest firing rung, and the
 * deciding signal is derived from that reason — never supplied by the caller. Ablations re-run the same ladder with
 * one signal neutralised and report whether the verdict changed; that is the marginal contribution of each gate.
 */
export function proposerValue(input: ProposerValueInput): ProposerValue {
  checkInput(input);
  checkAblations(input.ablations);

  const before = decide(input, undefined);
  const ablations: ProposerAblationReading[] = [];
  for (const ablation of input.ablations ?? []) {
    const after = decide(input, ablation.removedSignal);
    const beforeVerdict = VERDICT_OF[before.reason];
    const afterVerdict = VERDICT_OF[after.reason];
    ablations.push({
      id: ablation.id,
      removedSignal: ablation.removedSignal,
      beforeVerdict,
      afterVerdict,
      changed: beforeVerdict !== afterVerdict,
    });
  }

  return {
    id: input.id,
    verdict: VERDICT_OF[before.reason],
    reason: before.reason,
    decidingSignal: SIGNAL_OF[before.reason],
    estimatedCostMicros: before.estimatedCostMicros,
    overBudgetByMicros: before.overBudgetByMicros,
    candidateCount: input.candidateCount,
    fragmentationFloorMilli: FRAGMENTATION_FLOOR_MILLI,
    witnessFloorMilli: WITNESS_FLOOR_MILLI,
    chainedCeilingMilli: CHAINED_CEILING_MILLI,
    ablations,
  };
}
