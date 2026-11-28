/**
 * Experience gate (R254) — the missing bridge between evaluation and product.
 *
 * ## The gap this closes
 *
 * R244-R253 added ten pure criteria — one per failure mode the memory literature reports — and pinned each with a
 * three-reader contract. Every one of them is exported from `apply/index.ts`, yet **none is called by the product's
 * real `recall`/`distill` path**: they live in tests and evaluation fixtures only. That is the "product and
 * evaluation are split" the standing question 6 keeps probing, and it is why the negative effect question 8 keeps
 * raising is still unconstrained at run time. A criterion nobody calls cannot prevent anything.
 *
 * This module is the orchestration seam R104b needs before its proposer is worth paying for. It does not re-derive
 * any criterion — each stage carries the disposition a criterion already computed under its own three-reader
 * contract. What it adds is the one decision the criteria deliberately do not make together: given all of their
 * verdicts, what does the product actually DO with this experience? It composes them into a single executable
 * decision, under a strict, falsifiable priority ladder.
 *
 * ## Decision ladder (strict priority)
 *
 * The effective disposition of a stage is its disposition, except that a source declared advisory has its `reject`
 * downgraded to `reweight` — an advisory criterion is a strong warning, not a hard veto (this is how the
 * domain-boundary and cost criteria are meant to be consumed: informative, not authoritative over safety).
 *
 * The set verdict is the strictest effective disposition present, by severity `admit < reweight < abstain < reject`.
 * The deciding stage is the first to reach that severity (ties go to the earlier stage, so the reading is
 * deterministic). Reason is derived from the verdict, never supplied by a stage — a stage may name *why* it
 * decided (`decidingReason`), but the set-level reason is a function of the verdict alone.
 *
 * Counts partition the stage total by effective disposition. Each ablation removes one stage by id, re-runs the
 * same ladder, and reports whether the verdict changed — the marginal contribution of that gate, in the same
 * falsifiable style as R253's gain ledger.
 *
 * ## Discipline
 *
 * Pure and deterministic; no clock, no network, no model, zero cost. Every guard refuses rather than defaults:
 * a muted guard would let a malformed stage silently become an admit. Integer thousandths only, so the product
 * and the independent Python reader compare integers, not floats.
 */
import { MicrogliaError } from '../kernel/index.js';

/** The eleven criteria, plus the cost lane. Closed and ordered; a stage may name no other source. */
export const EXPERIENCE_GATE_SOURCES = [
  'view-consistency',
  'abstraction-lifecycle',
  'revision-integrity',
  'stale-revocation',
  'memory-admission',
  'memory-confidence',
  'memory-gain-ledger',
  'consistency-admission',
  'state-role',
  'competition-domain',
  'cost-429',
] as const;
export type ExperienceGateSource = (typeof EXPERIENCE_GATE_SOURCES)[number];

/** One criterion's disposition, in increasing strictness. */
export const GATE_DISPOSITIONS = ['admit', 'reweight', 'abstain', 'reject'] as const;
export type GateDisposition = (typeof GATE_DISPOSITIONS)[number];

/** Set verdicts, identical vocabulary to the strictest disposition. */
export const EXPERIENCE_VERDICTS = ['admit', 'reweight', 'abstain', 'reject'] as const;
export type ExperienceVerdict = (typeof EXPERIENCE_VERDICTS)[number];

/** Set-level reasons, derived from the verdict and nothing else. */
export const GATE_REASONS = [
  'all-admitted',
  'reweight-required',
  'abstention-required',
  'hard-gate-rejected',
] as const;
export type GateReason = (typeof GATE_REASONS)[number];

/** The verdict a criterion already reached, carried into the composition unchanged. */
export type GateStage = {
  readonly id: string;
  readonly source: ExperienceGateSource;
  readonly disposition: GateDisposition;
  /** The criterion's own reason, reported as `decidingReason` when this stage decides. */
  readonly reason: string;
  /** Integer thousandths, in [0, 1000]; a confidence-like weight for readback, never for the ladder. */
  readonly scoreMilli: number;
};

/** Remove one stage by id and re-run the ladder — the marginal contribution of that gate. */
export type GateAblation = {
  readonly id: string;
  readonly removedStageId: string;
};

export type ExperienceGateInput = {
  readonly id: string;
  readonly stages: readonly GateStage[];
  /** Sources whose `reject` is downgraded to `reweight`; a closed subset of the gate sources. */
  readonly advisorySources?: readonly ExperienceGateSource[];
  readonly ablations?: readonly GateAblation[];
};

export type GateAblationReading = {
  readonly id: string;
  readonly removedStageId: string;
  readonly beforeVerdict: ExperienceVerdict;
  readonly afterVerdict: ExperienceVerdict;
  readonly changed: boolean;
};

export type ExperienceGateResult = {
  readonly id: string;
  readonly verdict: ExperienceVerdict;
  readonly reason: GateReason;
  readonly decidingStageId: string;
  readonly decidingReason: string;
  readonly decidingScoreMilli: number;
  readonly stageCount: number;
  readonly admitCount: number;
  readonly reweightCount: number;
  readonly abstainCount: number;
  readonly rejectCount: number;
  readonly ablations: readonly GateAblationReading[];
};

const SOURCE_SET: ReadonlySet<string> = new Set<string>(EXPERIENCE_GATE_SOURCES);
const DISPOSITION_SET: ReadonlySet<string> = new Set<string>(GATE_DISPOSITIONS);

/** Strictness, indexed by disposition. Higher wins; ties go to the earlier stage. */
const SEVERITY: Readonly<Record<GateDisposition, number>> = {
  admit: 0,
  reweight: 1,
  abstain: 2,
  reject: 3,
};

const REASON_OF: Readonly<Record<ExperienceVerdict, GateReason>> = {
  admit: 'all-admitted',
  reweight: 'reweight-required',
  abstain: 'abstention-required',
  reject: 'hard-gate-rejected',
};

const isMilli = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 1000;

/** The effective disposition after advisory downgrade. */
function effective(stage: GateStage, advisory: ReadonlySet<string>): GateDisposition {
  return stage.disposition === 'reject' && advisory.has(stage.source) ? 'reweight' : stage.disposition;
}

/**
 * The strictest effective verdict over a list of stages, with its deciding stage.
 *
 * An empty list is the ablation boundary: removing the only gate leaves nothing to object, so the verdict is
 * `admit` (the identity of "strictest") and there is no deciding stage. Refusing here would make removing a
 * single-gate set crash instead of reporting that the gate was the whole decision.
 */
function compose(
  stages: readonly GateStage[],
  advisory: ReadonlySet<string>,
): { verdict: ExperienceVerdict; deciding: GateStage | undefined } {
  if (stages.length === 0) return { verdict: 'admit', deciding: undefined };
  let deciding = stages[0] as GateStage;
  let decidingSeverity = SEVERITY[effective(deciding, advisory)];
  for (let index = 1; index < stages.length; index += 1) {
    const stage = stages[index] as GateStage;
    const severity = SEVERITY[effective(stage, advisory)];
    if (severity > decidingSeverity) {
      decidingSeverity = severity;
      deciding = stage;
    }
  }
  return { verdict: effective(deciding, advisory), deciding };
}

/**
 * Compose the criteria's verdicts into one executable product decision.
 *
 * Every guard refuses rather than defaults: a stage that slips through a guard as an implicit admit would defeat
 * the entire purpose of a gate. The returned reading is fully determined by the input bytes.
 */
export function experienceGate(input: ExperienceGateInput): ExperienceGateResult {
  if (typeof input.id !== 'string' || input.id.trim() === '') {
    throw new MicrogliaError('MG_E_CONFIG', 'experience id must be a non-blank string', { id: input.id });
  }
  if (!Array.isArray(input.stages)) {
    throw new MicrogliaError('MG_E_CONFIG', `experience '${input.id}': stages must be an array`, { id: input.id });
  }
  if (input.stages.length === 0) {
    throw new MicrogliaError('MG_E_CONFIG', `experience '${input.id}': stages must not be empty`, { id: input.id });
  }

  if (input.advisorySources !== undefined && !Array.isArray(input.advisorySources)) {
    throw new MicrogliaError('MG_E_CONFIG', `experience '${input.id}': advisorySources must be an array`, {
      id: input.id,
    });
  }
  const advisory = new Set<string>();
  for (const source of input.advisorySources ?? []) {
    if (typeof source !== 'string' || !SOURCE_SET.has(source)) {
      throw new MicrogliaError('MG_E_CONFIG', `experience '${input.id}': unknown advisory source '${String(source)}'`, {
        id: input.id,
      });
    }
    advisory.add(source);
  }

  const seenStages = new Set<string>();
  let admitCount = 0;
  let reweightCount = 0;
  let abstainCount = 0;
  let rejectCount = 0;
  for (const stage of input.stages) {
    if (typeof stage !== 'object' || stage === null || Array.isArray(stage)) {
      throw new MicrogliaError('MG_E_CONFIG', `experience '${input.id}': every stage must be an object`, {
        id: input.id,
      });
    }
    if (typeof stage.id !== 'string' || stage.id.trim() === '') {
      throw new MicrogliaError('MG_E_CONFIG', `experience '${input.id}': stage id must be non-blank`, { id: input.id });
    }
    if (seenStages.has(stage.id)) {
      throw new MicrogliaError('MG_E_CONFIG', `experience '${input.id}': duplicate stage id '${stage.id}'`, {
        id: input.id,
        stageId: stage.id,
      });
    }
    seenStages.add(stage.id);
    if (typeof stage.source !== 'string' || !SOURCE_SET.has(stage.source)) {
      throw new MicrogliaError('MG_E_CONFIG', `experience '${input.id}': unknown source '${String(stage.source)}'`, {
        id: input.id,
        stageId: stage.id,
      });
    }
    if (typeof stage.disposition !== 'string' || !DISPOSITION_SET.has(stage.disposition)) {
      throw new MicrogliaError(
        'MG_E_CONFIG',
        `experience '${input.id}': unknown disposition '${String(stage.disposition)}'`,
        { id: input.id, stageId: stage.id },
      );
    }
    if (typeof stage.reason !== 'string' || stage.reason.trim() === '') {
      throw new MicrogliaError('MG_E_CONFIG', `experience '${input.id}': stage reason must be non-blank`, {
        id: input.id,
        stageId: stage.id,
      });
    }
    if (!isMilli(stage.scoreMilli)) {
      throw new MicrogliaError('MG_E_CONFIG', `experience '${input.id}': scoreMilli must be an integer in [0, 1000]`, {
        id: input.id,
        stageId: stage.id,
      });
    }
    const disposition = effective(stage, advisory);
    if (disposition === 'admit') admitCount += 1;
    else if (disposition === 'reweight') reweightCount += 1;
    else if (disposition === 'abstain') abstainCount += 1;
    else rejectCount += 1;
  }

  if (input.ablations !== undefined && !Array.isArray(input.ablations)) {
    throw new MicrogliaError('MG_E_CONFIG', `experience '${input.id}': ablations must be an array`, { id: input.id });
  }
  const ablationReadings: GateAblationReading[] = [];
  const seenAblations = new Set<string>();
  // input.stages is guarded non-empty above, so the main composition always has a deciding stage.
  const { verdict, deciding } = compose(input.stages, advisory) as {
    verdict: ExperienceVerdict;
    deciding: GateStage;
  };
  for (const ablation of input.ablations ?? []) {
    if (typeof ablation !== 'object' || ablation === null || Array.isArray(ablation)) {
      throw new MicrogliaError('MG_E_CONFIG', `experience '${input.id}': every ablation must be an object`, {
        id: input.id,
      });
    }
    if (typeof ablation.id !== 'string' || ablation.id.trim() === '') {
      throw new MicrogliaError('MG_E_CONFIG', `experience '${input.id}': ablation id must be non-blank`, {
        id: input.id,
      });
    }
    if (seenAblations.has(ablation.id)) {
      throw new MicrogliaError('MG_E_CONFIG', `experience '${input.id}': duplicate ablation id '${ablation.id}'`, {
        id: input.id,
        ablationId: ablation.id,
      });
    }
    seenAblations.add(ablation.id);
    if (typeof ablation.removedStageId !== 'string' || !seenStages.has(ablation.removedStageId)) {
      throw new MicrogliaError(
        'MG_E_CONFIG',
        `experience '${input.id}': ablation '${ablation.id}' names a missing stage`,
        { id: input.id, ablationId: ablation.id },
      );
    }
    const remaining = input.stages.filter((stage) => stage.id !== ablation.removedStageId);
    const after = compose(remaining, advisory).verdict;
    ablationReadings.push({
      id: ablation.id,
      removedStageId: ablation.removedStageId,
      beforeVerdict: verdict,
      afterVerdict: after,
      changed: after !== verdict,
    });
  }

  return {
    id: input.id,
    verdict,
    reason: REASON_OF[verdict],
    decidingStageId: deciding.id,
    decidingReason: deciding.reason,
    decidingScoreMilli: deciding.scoreMilli,
    stageCount: input.stages.length,
    admitCount,
    reweightCount,
    abstainCount,
    rejectCount,
    ablations: ablationReadings,
  };
}
