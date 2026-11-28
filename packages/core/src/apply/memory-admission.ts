/**
 * Evidence-linked admission gate: decide which retrieved lessons may enter a model's context (R251).
 *
 * ## The negative effect this prevents
 *
 * R249 gates whether an explicit revision reached every derived site; R250 gates whether new evidence actually
 * displaced the stale value it invalidated. Both stop *before* the retrieval set is handed to a model. MemTrapBench
 * (arXiv 2608.20202) measures a separate failure boundary after retrieval: valid, semantically related history can
 * still anchor the actor on an obsolete strategy or a false belief. In its matched Task Boundary control, the same
 * independently solvable query scores 92.29 with no memory, 94.39 with trap-free history, and 31.05 with
 * trap-inducing history — a causal effect of trap *semantics* on the answer, not of retrieval failure. It concludes
 * that retrieval correctness is not enough: the consumer needs an admission decision that keeps useful evidence
 * and declines misleading prior context. Memory Trust Gap (arXiv 2609.01852) shows the same over-trust is
 * capability-gated and grows when the stale value is dressed as the newest.
 *
 * WikiTrace (arXiv 2611.14320) supplies the mechanism. A lesson distilled from a trajectory labelled only
 * success/failure is handed over without the trajectory, so the agent cannot check it — the source of
 * memory-induced degradation. WikiTrace stores each insight linked to a success/failure diagnosis and the raw
 * trajectory, and descends through those links with terminal tools when an insight lacks detail needed to act,
 * conflicts with another, or comes from a failed task. Across five agentic benchmarks it beats the same insights
 * without evidence and reduces degradation (regression 6.5% -> 4.5%).
 *
 * ## The model
 *
 * A query carries an `id`, a `key` (the conflict/lookup key) and a `boundary` (the live task the retrieval must
 * serve). Each retrieved `candidate` carries an `id`, a `key`, an `outcome` (success/failure of the source task),
 * a `detail` level (sufficient/insufficient to act), a `conflict` kind (none/rule/boundary) and an `evidence`
 * link (`linked` to the raw trajectory, `reachable` through terminal tools). A boundary conflict means the lesson
 * belongs to a different live task — MemTrapBench's task-boundary trap.
 *
 * ## Disposition ladder (strict priority, per candidate)
 *
 * 1. `conflict === 'boundary'` -> `reject` / `task-boundary-violation` — a trap is withheld before any check.
 * 2. `detail === 'insufficient'` -> `escalate` / `verify-details` if evidence is reachable, else `reject` /
 *    `unverifiable-detail`.
 * 3. `conflict === 'rule'` -> `escalate` / `verify-conflict` if reachable, else `reject` / `unverifiable-conflict`.
 * 4. `outcome === 'failure'` -> `escalate` / `verify-failed-source` if reachable, else `reject` /
 *    `unverifiable-failed-source`.
 * 5. otherwise -> `admit` / `valid-lesson`.
 *
 * The three WikiTrace checks are ordered detail -> rule -> failed-source, matching its description. An unreachable
 * link turns a would-be escalation into a rejection: an insight you cannot check is an insight you must not follow.
 *
 * ## Aggregation
 *
 * The set verdict is the strictest disposition present: `reject` dominates `escalate` dominates `admit`. One
 * boundary trap is enough to spoil a whole batch of otherwise good lessons, so the set is only as safe as its worst
 * member. `reason` and `decidingId` name the most severe candidate. The three disposition counts partition the
 * candidate total.
 *
 * ## Discipline
 *
 * Pure and deterministic; no clock, no network, no model, zero cost. Every guard refuses rather than defaults — a
 * duplicate id or a `reachable` link that is not `linked` would make the readback silently wrong. The module audits
 * a description supplied by the caller; it neither retrieves memory nor edits any store.
 */
import { MicrogliaError } from '../kernel/index.js';

/** Closed, ordered vocabulary of a lesson's source-task outcome. */
export const LESSON_OUTCOMES = ['success', 'failure'] as const;
export type LessonOutcome = (typeof LESSON_OUTCOMES)[number];

/** Closed, ordered vocabulary of how complete a lesson is for acting. */
export const DETAIL_LEVELS = ['sufficient', 'insufficient'] as const;
export type DetailLevel = (typeof DETAIL_LEVELS)[number];

/** Closed, ordered vocabulary of the conflict a lesson carries. */
export const CONFLICT_KINDS = ['none', 'rule', 'boundary'] as const;
export type ConflictKind = (typeof CONFLICT_KINDS)[number];

/** Closed, ordered vocabulary of per-candidate dispositions. */
export const DISPOSITIONS = ['admit', 'escalate', 'reject'] as const;
export type Disposition = (typeof DISPOSITIONS)[number];

/** Closed, ordered vocabulary of set verdicts. */
export const ADMISSION_VERDICTS = ['admit', 'escalate', 'reject'] as const;
export type AdmissionVerdict = (typeof ADMISSION_VERDICTS)[number];

/** Closed, ordered vocabulary of reasons, grouped by the disposition they justify. */
export const ADMISSION_REASONS = [
  'valid-lesson',
  'verify-details',
  'verify-conflict',
  'verify-failed-source',
  'task-boundary-violation',
  'unverifiable-detail',
  'unverifiable-conflict',
  'unverifiable-failed-source',
] as const;
export type AdmissionReason = (typeof ADMISSION_REASONS)[number];

export type AdmissionQuery = {
  readonly id: string;
  readonly key: string;
  readonly boundary: string;
};

export type EvidenceLink = {
  readonly linked: boolean;
  readonly reachable: boolean;
};

export type AdmissionCandidate = {
  readonly id: string;
  readonly key: string;
  readonly outcome: LessonOutcome;
  readonly detail: DetailLevel;
  readonly conflict: ConflictKind;
  readonly evidence: EvidenceLink;
};

export type MemoryAdmissionInput = {
  readonly id: string;
  readonly query: AdmissionQuery;
  readonly candidates: readonly AdmissionCandidate[];
};

export type MemoryAdmission = {
  readonly id: string;
  readonly queryKey: string;
  readonly verdict: AdmissionVerdict;
  readonly reason: AdmissionReason;
  readonly decidingId: string;
  readonly candidateCount: number;
  readonly admitCount: number;
  readonly escalateCount: number;
  readonly rejectCount: number;
};

const OUTCOME_SET = new Set<string>(LESSON_OUTCOMES);
const DETAIL_SET = new Set<string>(DETAIL_LEVELS);
const CONFLICT_SET = new Set<string>(CONFLICT_KINDS);

/** Higher is stricter; used to name the decisive candidate of a set. */
const REASON_SEVERITY: Readonly<Record<AdmissionReason, number>> = {
  'valid-lesson': 0,
  'verify-details': 1,
  'verify-conflict': 1,
  'verify-failed-source': 1,
  'unverifiable-detail': 2,
  'unverifiable-conflict': 2,
  'unverifiable-failed-source': 2,
  'task-boundary-violation': 3,
};

type DispositionReading = { disposition: Disposition; reason: AdmissionReason };

/** The per-candidate ladder. Kept separate from the guards so the decision rule is auditable on its own. */
function dispositionOf(candidate: AdmissionCandidate): DispositionReading {
  const reachable = candidate.evidence.reachable;
  if (candidate.conflict === 'boundary') {
    return { disposition: 'reject', reason: 'task-boundary-violation' };
  }
  if (candidate.detail === 'insufficient') {
    return reachable
      ? { disposition: 'escalate', reason: 'verify-details' }
      : { disposition: 'reject', reason: 'unverifiable-detail' };
  }
  if (candidate.conflict === 'rule') {
    return reachable
      ? { disposition: 'escalate', reason: 'verify-conflict' }
      : { disposition: 'reject', reason: 'unverifiable-conflict' };
  }
  if (candidate.outcome === 'failure') {
    return reachable
      ? { disposition: 'escalate', reason: 'verify-failed-source' }
      : { disposition: 'reject', reason: 'unverifiable-failed-source' };
  }
  return { disposition: 'admit', reason: 'valid-lesson' };
}

/**
 * Audit which retrieved lessons may enter the model context.
 *
 * Each candidate is placed on the disposition ladder; the set verdict is the strictest disposition present and the
 * decisive candidate is the one with the highest reason severity (first wins a tie).
 */
export function memoryAdmission(input: MemoryAdmissionInput): MemoryAdmission {
  if (typeof input.id !== 'string' || input.id.trim() === '') {
    throw new MicrogliaError('MG_E_CONFIG', 'episode id must be a non-blank string', { id: input.id });
  }
  const query = input.query;
  if (typeof query !== 'object' || query === null || Array.isArray(query)) {
    throw new MicrogliaError('MG_E_CONFIG', `episode '${input.id}': query must be an object`, { id: input.id });
  }
  if (typeof query.id !== 'string' || query.id.trim() === '') {
    throw new MicrogliaError('MG_E_CONFIG', `episode '${input.id}': query id must be non-blank`, { id: input.id });
  }
  if (typeof query.key !== 'string' || query.key.trim() === '') {
    throw new MicrogliaError('MG_E_CONFIG', `episode '${input.id}': query key must be non-blank`, { id: input.id });
  }
  if (typeof query.boundary !== 'string' || query.boundary.trim() === '') {
    throw new MicrogliaError('MG_E_CONFIG', `episode '${input.id}': query boundary must be non-blank`, {
      id: input.id,
    });
  }

  if (!Array.isArray(input.candidates)) {
    throw new MicrogliaError('MG_E_CONFIG', `episode '${input.id}': candidates must be an array`, { id: input.id });
  }
  if (input.candidates.length === 0) {
    throw new MicrogliaError('MG_E_CONFIG', `episode '${input.id}': candidates must not be empty`, { id: input.id });
  }

  const seen = new Set<string>();
  let admitCount = 0;
  let escalateCount = 0;
  let rejectCount = 0;
  let verdict: AdmissionVerdict = 'admit';
  let reason: AdmissionReason = 'valid-lesson';
  let decidingId = '';
  let decidingSeverity = -1;

  for (const candidate of input.candidates) {
    if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
      throw new MicrogliaError('MG_E_CONFIG', `episode '${input.id}': every candidate must be an object`, {
        id: input.id,
      });
    }
    if (typeof candidate.id !== 'string' || candidate.id.trim() === '') {
      throw new MicrogliaError('MG_E_CONFIG', `episode '${input.id}': candidate id must be non-blank`, {
        id: input.id,
      });
    }
    if (seen.has(candidate.id)) {
      throw new MicrogliaError('MG_E_CONFIG', `episode '${input.id}': duplicate candidate id '${candidate.id}'`, {
        id: input.id,
        candidateId: candidate.id,
      });
    }
    seen.add(candidate.id);
    if (typeof candidate.key !== 'string' || candidate.key.trim() === '') {
      throw new MicrogliaError('MG_E_CONFIG', `episode '${input.id}': candidate key must be non-blank`, {
        id: input.id,
        candidateId: candidate.id,
      });
    }
    if (typeof candidate.outcome !== 'string' || !OUTCOME_SET.has(candidate.outcome)) {
      throw new MicrogliaError('MG_E_CONFIG', `episode '${input.id}': unknown outcome '${candidate.outcome}'`, {
        id: input.id,
        candidateId: candidate.id,
      });
    }
    if (typeof candidate.detail !== 'string' || !DETAIL_SET.has(candidate.detail)) {
      throw new MicrogliaError('MG_E_CONFIG', `episode '${input.id}': unknown detail '${candidate.detail}'`, {
        id: input.id,
        candidateId: candidate.id,
      });
    }
    if (typeof candidate.conflict !== 'string' || !CONFLICT_SET.has(candidate.conflict)) {
      throw new MicrogliaError('MG_E_CONFIG', `episode '${input.id}': unknown conflict '${candidate.conflict}'`, {
        id: input.id,
        candidateId: candidate.id,
      });
    }
    const evidence = candidate.evidence;
    if (typeof evidence !== 'object' || evidence === null || Array.isArray(evidence)) {
      throw new MicrogliaError('MG_E_CONFIG', `episode '${input.id}': evidence must be an object`, {
        id: input.id,
        candidateId: candidate.id,
      });
    }
    if (typeof evidence.linked !== 'boolean' || typeof evidence.reachable !== 'boolean') {
      throw new MicrogliaError('MG_E_CONFIG', `episode '${input.id}': evidence flags must be booleans`, {
        id: input.id,
        candidateId: candidate.id,
      });
    }
    if (evidence.reachable && !evidence.linked) {
      throw new MicrogliaError('MG_E_CONFIG', `episode '${input.id}': reachable evidence must also be linked`, {
        id: input.id,
        candidateId: candidate.id,
      });
    }

    const reading = dispositionOf(candidate);
    if (reading.disposition === 'admit') admitCount += 1;
    else if (reading.disposition === 'escalate') escalateCount += 1;
    else rejectCount += 1;

    const severity = REASON_SEVERITY[reading.reason];
    if (severity > decidingSeverity) {
      decidingSeverity = severity;
      reason = reading.reason;
      decidingId = candidate.id;
      verdict = reading.disposition;
    }
  }

  return {
    id: input.id,
    queryKey: query.key,
    verdict,
    reason,
    decidingId,
    candidateCount: input.candidates.length,
    admitCount,
    escalateCount,
    rejectCount,
  };
}
