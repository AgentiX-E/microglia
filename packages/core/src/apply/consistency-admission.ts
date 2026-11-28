/**
 * Consistency admission (R255) — a write-time factual-support gate.
 *
 * ## The gap this closes
 *
 * R244-R254 gate how a memory is revised, revoked, trusted, composed and whether a policy helps at all. None of them
 * asks the question ConsistencyGate (arXiv 2607.22962) shows is structurally invisible to every novelty/recency/
 * utility admission policy: *is the candidate fact actually supported by the source context it was extracted from?*
 * A hallucinated detail is as novel, recent and seemingly useful as a correct one, so utility-based admission is
 * blind to contamination by construction. This module makes correctness an explicit, falsifiable admission
 * criterion — the one criterion the paper argues has no substitute in existing memory machinery.
 *
 * ## Three modes, faithful to the paper
 *
 * - `fixed`: K soft support scores s_k in [0,1000] (0 = contradicted, 500 = ambiguous, 1000 = fully supported);
 *   mean(p) = round((sum s_k)/K); admit iff p >= tau. The paper recommends tau=700, K=5. The comparison is >=,
 *   not >: a candidate exactly at the threshold is admitted.
 * - `logprob`: a single forward pass reads log p(yes), log p(no); support = round(1000 * softmax(yes,no)[0]) using a
 *   numerically stable max subtraction. No model is called here — the scores are supplied by the caller.
 * - `adaptive`: tau* = tauMin + round((tauMax - tauMin) * min(1, |M|/C)), monotone in occupancy — permissive when
 *   memory is sparse, strict as it fills. occupancy above capacity clamps to tauMax.
 *
 * A contradicted candidate (all samples zero) is rejected with reason `contradicted`; a candidate below threshold
 * but with any positive support is `insufficient-support`. The set verdict is reject if any candidate is rejected;
 * the deciding candidate is the one with the highest reason severity (ties to the first). Counts partition the set.
 * Each ablation removes one candidate, re-runs the admission and reports before/after/changed — the marginal
 * contribution of that write, in the same falsifiable style as R253/R254.
 *
 * ## Discipline
 *
 * Pure and deterministic; no clock, no network, no model, zero cost. Every guard refuses rather than defaults: a
 * malformed score must never silently become an admit. Integer thousandths only (the logprob input is the sole
 * continuous value, converted once at the boundary), so the product and the independent Python reader compare
 * integers, never floats.
 */
import { MicrogliaError } from '../kernel/index.js';

/** Set verdicts. */
export const CONSISTENCY_VERDICTS = ['admit', 'reject'] as const;
export type ConsistencyVerdict = (typeof CONSISTENCY_VERDICTS)[number];

/** Reasons, from least to most severe. */
export const CONSISTENCY_REASONS = ['supported', 'insufficient-support', 'contradicted'] as const;
export type ConsistencyReason = (typeof CONSISTENCY_REASONS)[number];

const REASON_SEVERITY: Readonly<Record<ConsistencyReason, number>> = {
  supported: 0,
  'insufficient-support': 1,
  contradicted: 2,
};

/** How a candidate's support is established. */
export type ConsistencyEvidence =
  | { readonly kind: 'samples'; readonly supportsMilli: readonly number[] }
  | { readonly kind: 'logprob'; readonly yesLog: number; readonly noLog: number };

export type ConsistencyCandidate = {
  readonly id: string;
  readonly evidence: ConsistencyEvidence;
};

/** Threshold policy: a fixed tau, or an occupancy-scaled tau. */
export type ConsistencyThreshold =
  | { readonly mode: 'fixed'; readonly tauMilli: number }
  | {
      readonly mode: 'adaptive';
      readonly tauMinMilli: number;
      readonly tauMaxMilli: number;
      readonly memorySize: number;
      readonly capacity: number;
    };

export type ConsistencyAblation = {
  readonly id: string;
  readonly removedCandidateId: string;
};

export type ConsistencyAdmissionInput = {
  readonly id: string;
  readonly threshold: ConsistencyThreshold;
  readonly candidates: readonly ConsistencyCandidate[];
  readonly ablations?: readonly ConsistencyAblation[];
};

export type ConsistencyAblationReading = {
  readonly id: string;
  readonly removedCandidateId: string;
  readonly beforeVerdict: ConsistencyVerdict;
  readonly afterVerdict: ConsistencyVerdict;
  readonly changed: boolean;
};

export type ConsistencyAdmission = {
  readonly id: string;
  readonly verdict: ConsistencyVerdict;
  readonly reason: ConsistencyReason;
  readonly decidingId: string;
  readonly decidingReason: ConsistencyReason;
  readonly decidingSupportMilli: number;
  readonly thresholdMilli: number;
  readonly candidateCount: number;
  readonly admitCount: number;
  readonly rejectCount: number;
  readonly ablations: readonly ConsistencyAblationReading[];
};

const isNonBlank = (value: unknown): value is string =>
  typeof value === 'string' && value.trim() !== '';
const isMilli = (value: unknown): value is number =>
  Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 1000;
const isCount = (value: unknown): value is number =>
  Number.isInteger(value) && (value as number) >= 0;
const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

type SetReading = {
  verdict: ConsistencyVerdict;
  reason: ConsistencyReason;
  decidingId: string;
  decidingReason: ConsistencyReason;
  decidingSupportMilli: number;
  admitCount: number;
  rejectCount: number;
};

/** Compose a candidate set. An empty set admits (no gate objected), matching R254's empty-set rule. */
function compose(
  candidates: readonly ConsistencyCandidate[],
  supportById: ReadonlyMap<string, number>,
  thresholdMilli: number,
): SetReading {
  let admitCount = 0;
  let rejectCount = 0;
  let decidingSeverity = -1;
  let decidingId = '';
  let decidingReason: ConsistencyReason = 'supported';
  let decidingSupportMilli = 0;

  for (const candidate of candidates) {
    const support = supportById.get(candidate.id) as number;
    const reason: ConsistencyReason =
      support >= thresholdMilli ? 'supported' : support === 0 ? 'contradicted' : 'insufficient-support';
    if (reason === 'supported') {
      admitCount += 1;
    } else {
      rejectCount += 1;
    }
    const severity = REASON_SEVERITY[reason];
    if (severity > decidingSeverity) {
      decidingSeverity = severity;
      decidingId = candidate.id;
      decidingReason = reason;
      decidingSupportMilli = support;
    }
  }

  return {
    verdict: rejectCount > 0 ? 'reject' : 'admit',
    reason: decidingReason,
    decidingId,
    decidingReason,
    decidingSupportMilli,
    admitCount,
    rejectCount,
  };
}

/** Resolve the effective threshold in integer thousandths. */
function resolveThreshold(threshold: ConsistencyThreshold, id: string): number {
  if (typeof threshold !== 'object' || threshold === null || Array.isArray(threshold)) {
    throw new MicrogliaError('MG_E_CONFIG', `episode '${id}': threshold must be an object`, { id });
  }
  if (threshold.mode === 'fixed') {
    if (!isMilli(threshold.tauMilli)) {
      throw new MicrogliaError('MG_E_CONFIG', `episode '${id}': fixed tauMilli must be an integer in [0,1000]`, { id });
    }
    return threshold.tauMilli;
  }
  if (threshold.mode === 'adaptive') {
    if (!isMilli(threshold.tauMinMilli) || !isMilli(threshold.tauMaxMilli)) {
      throw new MicrogliaError('MG_E_CONFIG', `episode '${id}': adaptive taus must be integers in [0,1000]`, { id });
    }
    if (threshold.tauMinMilli > threshold.tauMaxMilli) {
      throw new MicrogliaError('MG_E_CONFIG', `episode '${id}': tauMinMilli must not exceed tauMaxMilli`, { id });
    }
    if (!isCount(threshold.memorySize)) {
      throw new MicrogliaError('MG_E_CONFIG', `episode '${id}': memorySize must be a non-negative integer`, { id });
    }
    if (!Number.isInteger(threshold.capacity) || threshold.capacity <= 0) {
      throw new MicrogliaError('MG_E_CONFIG', `episode '${id}': capacity must be a positive integer`, { id });
    }
    const occupancy = Math.min(1, threshold.memorySize / threshold.capacity);
    return threshold.tauMinMilli + Math.round((threshold.tauMaxMilli - threshold.tauMinMilli) * occupancy);
  }
  throw new MicrogliaError('MG_E_CONFIG', `episode '${id}': unknown threshold mode`, { id });
}

/** Read one candidate's support in integer thousandths. */
function supportOf(evidence: ConsistencyEvidence, id: string, candidateId: string): number {
  if (typeof evidence !== 'object' || evidence === null || Array.isArray(evidence)) {
    throw new MicrogliaError('MG_E_CONFIG', `episode '${id}': candidate '${candidateId}' evidence must be an object`, { id });
  }
  if (evidence.kind === 'samples') {
    const values = evidence.supportsMilli;
    if (!Array.isArray(values) || values.length === 0) {
      throw new MicrogliaError('MG_E_CONFIG', `episode '${id}': candidate '${candidateId}' needs a non-empty sample array`, { id });
    }
    let total = 0;
    for (const value of values) {
      if (!isMilli(value)) {
        throw new MicrogliaError('MG_E_CONFIG', `episode '${id}': candidate '${candidateId}' sample must be an integer in [0,1000]`, { id });
      }
      total += value;
    }
    return Math.round(total / values.length);
  }
  if (evidence.kind === 'logprob') {
    if (!isFiniteNumber(evidence.yesLog) || !isFiniteNumber(evidence.noLog)) {
      throw new MicrogliaError('MG_E_CONFIG', `episode '${id}': candidate '${candidateId}' logprobs must be finite numbers`, { id });
    }
    const largest = Math.max(evidence.yesLog, evidence.noLog);
    const yesWeight = Math.exp(evidence.yesLog - largest);
    const noWeight = Math.exp(evidence.noLog - largest);
    return Math.round((1000 * yesWeight) / (yesWeight + noWeight));
  }
  throw new MicrogliaError('MG_E_CONFIG', `episode '${id}': candidate '${candidateId}' has unknown evidence kind`, { id });
}

/**
 * Gate a set of candidate memories on their factual support in the source context.
 * Refuses malformed input rather than admitting by default.
 */
export function consistencyAdmission(input: ConsistencyAdmissionInput): ConsistencyAdmission {
  if (!isNonBlank(input.id)) {
    throw new MicrogliaError('MG_E_CONFIG', 'episode id must be a non-blank string', { id: input.id });
  }
  if (!Array.isArray(input.candidates) || input.candidates.length === 0) {
    throw new MicrogliaError('MG_E_CONFIG', `episode '${input.id}': candidates must be a non-empty array`, { id: input.id });
  }

  const thresholdMilli = resolveThreshold(input.threshold, input.id);
  const supportById = new Map<string, number>();
  for (const candidate of input.candidates) {
    if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
      throw new MicrogliaError('MG_E_CONFIG', `episode '${input.id}': every candidate must be an object`, { id: input.id });
    }
    if (!isNonBlank(candidate.id)) {
      throw new MicrogliaError('MG_E_CONFIG', `episode '${input.id}': candidate id must be non-blank`, { id: input.id });
    }
    if (supportById.has(candidate.id)) {
      throw new MicrogliaError('MG_E_CONFIG', `episode '${input.id}': duplicate candidate id '${candidate.id}'`, { id: input.id });
    }
    supportById.set(candidate.id, supportOf(candidate.evidence, input.id, candidate.id));
  }

  const main = compose(input.candidates, supportById, thresholdMilli);
  const ablations: ConsistencyAblationReading[] = [];
  if (input.ablations !== undefined) {
    if (!Array.isArray(input.ablations)) {
      throw new MicrogliaError('MG_E_CONFIG', `episode '${input.id}': ablations must be an array`, { id: input.id });
    }
    const seen = new Set<string>();
    for (const ablation of input.ablations) {
      if (typeof ablation !== 'object' || ablation === null || Array.isArray(ablation)) {
        throw new MicrogliaError('MG_E_CONFIG', `episode '${input.id}': every ablation must be an object`, { id: input.id });
      }
      if (!isNonBlank(ablation.id)) {
        throw new MicrogliaError('MG_E_CONFIG', `episode '${input.id}': ablation id must be non-blank`, { id: input.id });
      }
      if (seen.has(ablation.id)) {
        throw new MicrogliaError('MG_E_CONFIG', `episode '${input.id}': duplicate ablation id '${ablation.id}'`, { id: input.id });
      }
      seen.add(ablation.id);
      if (!isNonBlank(ablation.removedCandidateId) || !supportById.has(ablation.removedCandidateId)) {
        throw new MicrogliaError('MG_E_CONFIG', `episode '${input.id}': ablation '${ablation.id}' points to a missing candidate`, { id: input.id });
      }
      const remaining = input.candidates.filter((candidate) => candidate.id !== ablation.removedCandidateId);
      const after = compose(remaining, supportById, thresholdMilli).verdict;
      ablations.push({
        id: ablation.id,
        removedCandidateId: ablation.removedCandidateId,
        beforeVerdict: main.verdict,
        afterVerdict: after,
        changed: after !== main.verdict,
      });
    }
  }

  return {
    id: input.id,
    verdict: main.verdict,
    reason: main.reason,
    decidingId: main.decidingId,
    decidingReason: main.decidingReason,
    decidingSupportMilli: main.decidingSupportMilli,
    thresholdMilli,
    candidateCount: input.candidates.length,
    admitCount: main.admitCount,
    rejectCount: main.rejectCount,
    ablations,
  };
}
