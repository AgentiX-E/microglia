/**
 * Memory net-gain ledger (R253).
 *
 * ## The negative effect this quantifies
 *
 * R246-R252 gate what we write, whether corrections stick, whether a revision reached every copy, whether
 * new evidence displaced the stale value, whether a retrieved lesson should be used, and how much each
 * retrieved item may be trusted. None of them asks the end-to-end question: *does a memory policy improve
 * the task at all, or does it hurt?* The standing question 8 keeps probing exactly this - that the way we
 * remember and use memory is itself the source of the negative effect. This module turns that into a
 * falsifiable, zero-cost measurement with two axes that must BOTH clear.
 *
 * ## Two failure modes, one ledger (CAPTURE, arXiv 2609.02265; 2601.05504)
 *
 * A memory policy fails in two opposite ways:
 * - **Poisoning / false acceptance** - it accepts corrupt or benign-non-update claims into memory; the
 *   agent is steered by memories it should never have stored. CAPTURE reports 11.5% poisoning and 8.9%
 *   false acceptance; a timeliness-only policy has 85.7% follow-through but 51.6% poisoning.
 * - **Utility collapse** - it is so defensive that it withholds everything. In 2601.05504 a conservative
 *   judge rejected all 23 candidates (mean trust 0.28), erasing the entire benefit of long-term memory.
 *   A policy with zero poisoning but no follow-through is not safe, it is useless.
 *
 * CAPTURE further shows that safety and personalisation must be measured together (71.5% win rate,
 * 83.5% follow-through, 11.5% poisoning, 8.9% false acceptance, 0.27 dynamic regret) and attributes each
 * component by ablation (+22pp poisoning without the authenticity gate, +14pp without source, -5.4pp
 * follow-through without time scales). This module reproduces that dual measurement and ablation: each
 * arm is scored on four integer-thousandth rates, refused if it is unsafe OR useless, and each ablation
 * reports the poisoning and follow-through deltas it removed.
 *
 * ## Per-arm ladder (strict priority)
 *
 * 1. `poisonMilli > poisonBudgetMilli` -> `reject` / `poisoning-exceeds-budget` - safety budget
 *    (zeta_safe in CAPTURE) breached; a useful policy may not be unsafe.
 * 2. `followMilli < followFloorMilli` -> `reject` / `utility-collapse` - defensive with everything
 *    withheld; no net memory benefit survives.
 * 3. `falseAcceptMilli > falseAcceptBudgetMilli` -> `reject` / `false-accept-exceeds-budget` - benign
 *    non-updates are being written as preferences.
 * 4. `netGainMilli <= 0` -> `reject` / `no-net-gain` - win rate does not beat the no-memory baseline.
 * 5. otherwise -> `admit` / `net-positive`.
 *
 * The set verdict is the strictest disposition present (`reject` dominates `admit`); reason and
 * `decidingId` name the most severe arm, first wins a tie. Counts partition the arm total.
 *
 * ## Discipline
 *
 * Pure and deterministic; no clock, no network, no model, zero cost. All four rates and the net gain are
 * integer thousandths so the product and the independent Python reader compare integers, not floats.
 * Every guard refuses rather than defaults.
 */
import { MicrogliaError } from '../kernel/index.js';

/** Closed, ordered vocabulary of set dispositions. */
export const GAIN_VERDICTS = ['admit', 'reject'] as const;
export type GainVerdict = (typeof GAIN_VERDICTS)[number];

/** Closed, ordered vocabulary of reasons, from least to most strict. */
export const GAIN_REASONS = [
  'net-positive',
  'no-net-gain',
  'false-accept-exceeds-budget',
  'utility-collapse',
  'poisoning-exceeds-budget',
] as const;
export type GainReason = (typeof GAIN_REASONS)[number];

/** One memory policy measured over a trial set; all counts are integers. */
export type GainArm = {
  readonly id: string;
  readonly trials: number;
  readonly wins: number;
  readonly trueUpdates: number;
  readonly followThrough: number;
  readonly benignNonUpdates: number;
  readonly falseAccepts: number;
  readonly poisonAttempts: number;
  readonly poisonAccepts: number;
};

/** One ablation: compare an ablated arm against a base arm on the two axes CAPTURE ablates. */
export type GainAblation = {
  readonly id: string;
  readonly baseArmId: string;
  readonly ablatedArmId: string;
};

export type MemoryGainInput = {
  readonly id: string;
  readonly baselineWinMilli: number;
  readonly poisonBudgetMilli: number;
  readonly followFloorMilli: number;
  readonly falseAcceptBudgetMilli: number;
  readonly arms: readonly GainArm[];
  readonly ablations?: readonly GainAblation[];
};

export type GainContribution = {
  readonly id: string;
  readonly poisonDeltaMilli: number;
  readonly followDeltaMilli: number;
};

export type MemoryGain = {
  readonly id: string;
  readonly verdict: GainVerdict;
  readonly reason: GainReason;
  readonly decidingId: string;
  readonly decidingNetGainMilli: number;
  readonly armCount: number;
  readonly admitCount: number;
  readonly rejectCount: number;
  readonly contributions: readonly GainContribution[];
};

/** Higher is stricter; used to name the decisive arm of a set. */
const REASON_SEVERITY: Readonly<Record<GainReason, number>> = {
  'net-positive': 0,
  'no-net-gain': 1,
  'false-accept-exceeds-budget': 2,
  'utility-collapse': 3,
  'poisoning-exceeds-budget': 4,
};

const isNonBlank = (value: unknown): value is string =>
  typeof value === 'string' && value.trim() !== '';
const isMilli = (value: unknown): value is number =>
  Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 1000;
const isCount = (value: unknown, max: number): value is number =>
  Number.isInteger(value) && (value as number) >= 0 && (value as number) <= max;
const isPositiveCount = (value: unknown): value is number =>
  Number.isInteger(value) && (value as number) > 0;

type ArmReading = {
  verdict: GainVerdict;
  reason: GainReason;
  netGainMilli: number;
  poisonMilli: number;
  followMilli: number;
};

/** Per-arm rates and ladder, kept separate from guards so the decision rule is auditable on its own. */
function readArm(arm: GainArm, input: MemoryGainInput): ArmReading {
  const winRateMilli = Math.round((1000 * arm.wins) / arm.trials);
  const followMilli = Math.round((1000 * arm.followThrough) / arm.trueUpdates);
  const falseAcceptMilli = Math.round((1000 * arm.falseAccepts) / arm.benignNonUpdates);
  const poisonMilli = Math.round((1000 * arm.poisonAccepts) / arm.poisonAttempts);
  const netGainMilli = winRateMilli - input.baselineWinMilli;

  let verdict: GainVerdict;
  let reason: GainReason;
  if (poisonMilli > input.poisonBudgetMilli) {
    verdict = 'reject';
    reason = 'poisoning-exceeds-budget';
  } else if (followMilli < input.followFloorMilli) {
    verdict = 'reject';
    reason = 'utility-collapse';
  } else if (falseAcceptMilli > input.falseAcceptBudgetMilli) {
    verdict = 'reject';
    reason = 'false-accept-exceeds-budget';
  } else if (netGainMilli <= 0) {
    verdict = 'reject';
    reason = 'no-net-gain';
  } else {
    verdict = 'admit';
    reason = 'net-positive';
  }

  return { verdict, reason, netGainMilli, poisonMilli, followMilli };
}

/**
 * Score memory policies on utility and safety, refuse the unsafe and the useless, and attribute each
 * ablation's marginal contribution.
 */
export function memoryGainLedger(input: MemoryGainInput): MemoryGain {
  if (!isNonBlank(input.id)) {
    throw new MicrogliaError('MG_E_CONFIG', 'episode id must be a non-blank string', { id: input.id });
  }
  if (!isMilli(input.baselineWinMilli)) {
    throw new MicrogliaError('MG_E_CONFIG', `episode '${input.id}': baselineWinMilli must be an integer in [0,1000]`, {
      id: input.id,
    });
  }
  if (!isMilli(input.poisonBudgetMilli)) {
    throw new MicrogliaError('MG_E_CONFIG', `episode '${input.id}': poisonBudgetMilli must be an integer in [0,1000]`, {
      id: input.id,
    });
  }
  if (!isMilli(input.followFloorMilli)) {
    throw new MicrogliaError('MG_E_CONFIG', `episode '${input.id}': followFloorMilli must be an integer in [0,1000]`, {
      id: input.id,
    });
  }
  if (!isMilli(input.falseAcceptBudgetMilli)) {
    throw new MicrogliaError(
      'MG_E_CONFIG',
      `episode '${input.id}': falseAcceptBudgetMilli must be an integer in [0,1000]`,
      { id: input.id },
    );
  }

  if (!Array.isArray(input.arms)) {
    throw new MicrogliaError('MG_E_CONFIG', `episode '${input.id}': arms must be an array`, { id: input.id });
  }
  if (input.arms.length === 0) {
    throw new MicrogliaError('MG_E_CONFIG', `episode '${input.id}': arms must not be empty`, { id: input.id });
  }

  const seen = new Set<string>();
  const byId = new Map<string, ArmReading>();
  let admitCount = 0;
  let rejectCount = 0;
  let verdict: GainVerdict = 'admit';
  let reason: GainReason = 'net-positive';
  let decidingId = '';
  let decidingNetGainMilli = 0;
  let decidingSeverity = -1;

  for (const arm of input.arms) {
    if (typeof arm !== 'object' || arm === null || Array.isArray(arm)) {
      throw new MicrogliaError('MG_E_CONFIG', `episode '${input.id}': every arm must be an object`, { id: input.id });
    }
    if (!isNonBlank(arm.id)) {
      throw new MicrogliaError('MG_E_CONFIG', `episode '${input.id}': arm id must be non-blank`, { id: input.id });
    }
    if (seen.has(arm.id)) {
      throw new MicrogliaError('MG_E_CONFIG', `episode '${input.id}': duplicate arm id '${arm.id}'`, {
        id: input.id,
        armId: arm.id,
      });
    }
    seen.add(arm.id);
    if (!isPositiveCount(arm.trials)) {
      throw new MicrogliaError('MG_E_CONFIG', `episode '${input.id}': trials must be a positive integer`, {
        id: input.id,
        armId: arm.id,
      });
    }
    if (!isCount(arm.wins, arm.trials)) {
      throw new MicrogliaError('MG_E_CONFIG', `episode '${input.id}': wins must be an integer in [0,trials]`, {
        id: input.id,
        armId: arm.id,
      });
    }
    if (!isPositiveCount(arm.trueUpdates)) {
      throw new MicrogliaError('MG_E_CONFIG', `episode '${input.id}': trueUpdates must be a positive integer`, {
        id: input.id,
        armId: arm.id,
      });
    }
    if (!isCount(arm.followThrough, arm.trueUpdates)) {
      throw new MicrogliaError(
        'MG_E_CONFIG',
        `episode '${input.id}': followThrough must be an integer in [0,trueUpdates]`,
        { id: input.id, armId: arm.id },
      );
    }
    if (!isPositiveCount(arm.benignNonUpdates)) {
      throw new MicrogliaError('MG_E_CONFIG', `episode '${input.id}': benignNonUpdates must be a positive integer`, {
        id: input.id,
        armId: arm.id,
      });
    }
    if (!isCount(arm.falseAccepts, arm.benignNonUpdates)) {
      throw new MicrogliaError(
        'MG_E_CONFIG',
        `episode '${input.id}': falseAccepts must be an integer in [0,benignNonUpdates]`,
        { id: input.id, armId: arm.id },
      );
    }
    if (!isPositiveCount(arm.poisonAttempts)) {
      throw new MicrogliaError('MG_E_CONFIG', `episode '${input.id}': poisonAttempts must be a positive integer`, {
        id: input.id,
        armId: arm.id,
      });
    }
    if (!isCount(arm.poisonAccepts, arm.poisonAttempts)) {
      throw new MicrogliaError(
        'MG_E_CONFIG',
        `episode '${input.id}': poisonAccepts must be an integer in [0,poisonAttempts]`,
        { id: input.id, armId: arm.id },
      );
    }

    const reading = readArm(arm, input);
    byId.set(arm.id, reading);
    if (reading.verdict === 'admit') admitCount += 1;
    else rejectCount += 1;

    const severity = REASON_SEVERITY[reading.reason];
    if (severity > decidingSeverity) {
      decidingSeverity = severity;
      decidingId = arm.id;
      decidingNetGainMilli = reading.netGainMilli;
      reason = reading.reason;
      verdict = reading.verdict;
    }
  }

  const contributions: GainContribution[] = [];
  const ablations = input.ablations ?? [];
  if (!Array.isArray(ablations)) {
    throw new MicrogliaError('MG_E_CONFIG', `episode '${input.id}': ablations must be an array`, { id: input.id });
  }
  const ablationIds = new Set<string>();
  for (const ablation of ablations) {
    if (typeof ablation !== 'object' || ablation === null || Array.isArray(ablation)) {
      throw new MicrogliaError('MG_E_CONFIG', `episode '${input.id}': every ablation must be an object`, {
        id: input.id,
      });
    }
    if (!isNonBlank(ablation.id)) {
      throw new MicrogliaError('MG_E_CONFIG', `episode '${input.id}': ablation id must be non-blank`, {
        id: input.id,
      });
    }
    if (ablationIds.has(ablation.id)) {
      throw new MicrogliaError('MG_E_CONFIG', `episode '${input.id}': duplicate ablation id '${ablation.id}'`, {
        id: input.id,
        ablationId: ablation.id,
      });
    }
    ablationIds.add(ablation.id);
    if (!isNonBlank(ablation.baseArmId)) {
      throw new MicrogliaError('MG_E_CONFIG', `episode '${input.id}': baseArmId must be non-blank`, {
        id: input.id,
        ablationId: ablation.id,
      });
    }
    if (!isNonBlank(ablation.ablatedArmId)) {
      throw new MicrogliaError('MG_E_CONFIG', `episode '${input.id}': ablatedArmId must be non-blank`, {
        id: input.id,
        ablationId: ablation.id,
      });
    }
    const base = byId.get(ablation.baseArmId);
    const ablated = byId.get(ablation.ablatedArmId);
    if (base === undefined) {
      throw new MicrogliaError('MG_E_CONFIG', `episode '${input.id}': unknown base arm '${ablation.baseArmId}'`, {
        id: input.id,
        ablationId: ablation.id,
      });
    }
    if (ablated === undefined) {
      throw new MicrogliaError('MG_E_CONFIG', `episode '${input.id}': unknown ablated arm '${ablation.ablatedArmId}'`, {
        id: input.id,
        ablationId: ablation.id,
      });
    }
    contributions.push({
      id: ablation.id,
      poisonDeltaMilli: ablated.poisonMilli - base.poisonMilli,
      followDeltaMilli: base.followMilli - ablated.followMilli,
    });
  }

  return {
    id: input.id,
    verdict,
    reason,
    decidingId,
    decidingNetGainMilli,
    armCount: input.arms.length,
    admitCount,
    rejectCount,
    contributions,
  };
}
