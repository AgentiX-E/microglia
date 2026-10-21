/**
 * Knowledge lifecycle: fusion, admission, application, retirement.
 *
 * One rule governs this file: **a correction is evidence, not truth**. Nothing
 * a user does becomes active knowledge because they did it; it becomes active
 * because the aggregate evidence, weighted by source trust, clears a threshold,
 * and it stays active only while its observed applications succeed.
 *
 * The score is a log-odds fusion (the same shape Cortex uses for contradiction
 * resolution) multiplied by a smoothed empirical success factor. It is written
 * out rather than tuned into a single sigmoid because the two halves answer
 * different questions:
 *
 *   evidence     — is the claim supported by enough trusted observations?
 *   empirical    — when applied, did it actually help?
 */
import { contentKey } from './ids.js';
import { clamp01, logit, sigmoid, smoothedRate } from './stats.js';
import type {
  DistillCandidate,
  EvidenceRef,
  Json,
  KnowledgeItem,
  KnowledgeScope,
  KnowledgeStatus,
  Policy,
  RecallQuery,
} from './types.js';

const BASE_PRIOR = 0.35;

export function scopeKey(scope: KnowledgeScope): string {
  const parts = [
    scope.task,
    scope.domain ?? '',
    scope.schemaDigest ?? '',
    scope.intent ?? '',
    scope.field ?? '',
    scope.reasonCode ?? '',
  ];
  return parts.join('|');
}

export function dedupeKeyOf(
  candidate: Pick<DistillCandidate, 'namespace' | 'kind' | 'scope' | 'statement'>,
): string {
  const normalized = candidate.statement
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  return contentKey(
    `${candidate.namespace}|${candidate.kind}|${scopeKey(candidate.scope)}|${normalized}`,
  );
}

export function scopeMatches(scope: KnowledgeScope, query: RecallQuery): boolean {
  if (scope.task !== query.task) return false;
  const filter = query.scope;
  if (!filter) return true;
  if (filter.domain !== undefined && scope.domain !== undefined && scope.domain !== filter.domain) {
    return false;
  }
  if (filter.intent !== undefined && scope.intent !== undefined && scope.intent !== filter.intent) {
    return false;
  }
  if (filter.field !== undefined && scope.field !== undefined && scope.field !== filter.field) {
    return false;
  }
  if (
    filter.schemaDigest !== undefined &&
    scope.schemaDigest !== undefined &&
    scope.schemaDigest !== filter.schemaDigest
  ) {
    return false;
  }
  if (
    filter.reasonCode !== undefined &&
    scope.reasonCode !== undefined &&
    scope.reasonCode !== filter.reasonCode
  ) {
    return false;
  }
  return true;
}

/** Number of constrained dimensions; specificity is the tie-breaker in ranking. */
export function specificity(scope: KnowledgeScope): number {
  let count = 1;
  if (scope.domain !== undefined) count += 1;
  if (scope.schemaDigest !== undefined) count += 1;
  if (scope.intent !== undefined) count += 1;
  if (scope.field !== undefined) count += 1;
  if (scope.reasonCode !== undefined) count += 1;
  return count;
}

export function scoreKnowledge(item: KnowledgeItem, policy: Policy, now = item.updatedAt): number {
  let logOdds = logit(BASE_PRIOR);
  // One task, one observation. Six attempts of the same task by the same user are
  // not six independent endorsements, and summing them let a single persistent
  // user clear the activation threshold alone. The strongest observation within a
  // task is kept, the weakest is dropped, and tasks are summed -- which is what
  // "independent evidence" means for a store whose evidence is user actions.
  // Evidence without a task falls back to its run id, so a host that never opened
  // a task keeps the previous one-run-one-observation behaviour exactly.
  const perTask = new Map<string, number>();
  for (const evidence of item.evidence) {
    const key = evidence.taskId ?? `run:${evidence.runId}`;
    const observed = perTask.get(key);
    if (observed === undefined || evidence.weight > observed) perTask.set(key, evidence.weight);
  }
  const odds = logit(clamp01(item.trust));
  for (const weight of perTask.values()) logOdds += weight * odds;
  logOdds -= item.contradictions * policy.contradictionPenalty;

  // A memory that has not been tested is not credited as if it had succeeded.
  const empirical = smoothedRate(item.succeeded, item.applied, 0.5, 2);
  const decay = validityDecay(item, now);
  return clamp01(sigmoid(logOdds) * (0.55 + 0.45 * empirical) * decay);
}

/**
 * Bitemporal decay: an item whose world-time validity has ended stops steering
 * answers without being deleted. This is what makes "that rule changed last
 * quarter" expressible, and what a plain vector store cannot represent.
 */
export function validityDecay(item: KnowledgeItem, now: number): number {
  if (now <= item.validUntil) return 1;
  // Half-life of 30 days past expiry, floored at 0.2 so an expired rule can be
  // re-asserted by fresh evidence instead of being permanently unreachable.
  const days = (now - item.validUntil) / 86_400_000;
  return Math.max(0.2, 0.5 ** (days / 30));
}

export type AdmissionDecision = {
  readonly status: KnowledgeStatus;
  readonly reason: string;
  readonly confidence: number;
};

/**
 * Decide whether a scored item may be activated.
 *
 * A retired item can be resurrected by new evidence. That is intentional: the
 * world changes, and a store that can only forget in one direction turns one bad
 * quarter into a permanent blind spot.
 */
export function decideStatus(item: KnowledgeItem, policy: Policy, now: number): AdmissionDecision {
  const confidence = scoreKnowledge(item, policy, now);
  if (item.status === 'quarantined') {
    // Preserve the reason that caused the quarantine; a generic "awaiting
    // review" would erase whether it was source trust or a manual hold.
    return { status: 'quarantined', reason: item.statusReason ?? 'awaiting-review', confidence };
  }
  if (item.contradictions > policy.maxContradictions) {
    return { status: 'conflicted', reason: 'contradiction-budget-exceeded', confidence };
  }
  if (
    item.applied >= policy.minApplicationsForRetirement &&
    smoothedRate(item.succeeded, item.applied) < policy.failureRateThreshold
  ) {
    return { status: 'retired', reason: 'observed-failure-rate', confidence };
  }
  if (item.status === 'active' && confidence < policy.retirementThreshold) {
    return { status: 'retired', reason: 'confidence-below-retirement', confidence };
  }
  if (confidence >= policy.activationThreshold && item.support >= policy.minSupport) {
    return { status: 'active', reason: 'confidence-cleared', confidence };
  }
  if (item.status === 'retired') {
    return { status: 'retired', reason: 'insufficient-new-evidence', confidence };
  }
  return { status: 'candidate', reason: 'insufficient-evidence', confidence };
}

export function createKnowledgeItem(
  candidate: DistillCandidate,
  policy: Policy,
  now: number,
  id: string,
): KnowledgeItem {
  const quarantined = candidate.trust < policy.quarantineBelowTrust;
  const base: KnowledgeItem = {
    schema: 'microglia.knowledge/1',
    id,
    namespace: candidate.namespace,
    kind: candidate.kind,
    scope: candidate.scope,
    statement: candidate.statement,
    evidence: [candidate.evidence],
    support: candidate.evidence.weight,
    contradictions: 0,
    confidence: 0,
    trust: candidate.trust,
    validFrom: now,
    validUntil: Infinity,
    systemFrom: now,
    systemUntil: Infinity,
    status: quarantined ? 'quarantined' : 'candidate',
    applied: 0,
    succeeded: 0,
    createdAt: now,
    updatedAt: now,
    ...(candidate.payload === undefined ? {} : { payload: candidate.payload }),
    ...(quarantined ? { statusReason: 'source-trust-below-quarantine' } : {}),
  };
  const confidence = scoreKnowledge(base, policy, now);
  const decision = decideStatus({ ...base, confidence }, policy, now);
  return {
    ...base,
    confidence: decision.confidence,
    status: decision.status,
    statusReason: decision.reason,
  };
}

/**
 * Merge a new observation into an existing item.
 *
 * Identity is `dedupeKey`, not statement text: two phrasings of the same rule
 * must accumulate support rather than compete. The caller resolves the key, so
 * this function never has to guess.
 */
export function mergeEvidence(
  item: KnowledgeItem,
  candidate: DistillCandidate,
  policy: Policy,
  now: number,
): KnowledgeItem {
  /**
   * Rehabilitation: a direct, trusted correction resets the empirical ledger.
   *
   * The failures counted against a retired item are failures of *application*,
   * and the host may have applied it to the wrong case. Letting three bad
   * applications veto every future human correction would make the store
   * permanently deaf to the person it exists to learn from. The reset is
   * recorded implicitly by `applied: 0`, and the retirement can recur if the
   * fresh evidence also fails.
   */
  const rehabilitate =
    item.status === 'retired' && candidate.trust >= policy.singleObservationTrust;
  const base: KnowledgeItem = rehabilitate
    ? { ...item, applied: 0, succeeded: 0, status: 'candidate', statusReason: 'rehabilitated' }
    : item;
  const duplicate = base.evidence.some(
    (entry) => entry.feedbackId === candidate.evidence.feedbackId,
  );
  const evidence: readonly EvidenceRef[] = duplicate
    ? base.evidence
    : [...base.evidence, candidate.evidence];
  const support = duplicate ? base.support : base.support + candidate.evidence.weight;
  const merged: KnowledgeItem = {
    ...base,
    evidence,
    support,
    trust: Math.max(base.trust, candidate.trust),
    updatedAt: now,
    ...(candidate.payload === undefined ? {} : { payload: candidate.payload }),
  };
  const decision = decideStatus({ ...merged, confidence: scoreKnowledge(merged, policy, now) }, policy, now);
  return {
    ...merged,
    confidence: decision.confidence,
    status: decision.status,
    statusReason: decision.reason,
  };
}

/** Record a contradiction without overwriting the statement (evidence, not edit). */
export function recordContradiction(
  item: KnowledgeItem,
  weight: number,
  policy: Policy,
  now: number,
): KnowledgeItem {
  const contradicted: KnowledgeItem = {
    ...item,
    contradictions: item.contradictions + 1,
    support: Math.max(0, item.support - weight * 0.5),
    updatedAt: now,
  };
  const decision = decideStatus(
    { ...contradicted, confidence: scoreKnowledge(contradicted, policy, now) },
    policy,
    now,
  );
  return {
    ...contradicted,
    confidence: decision.confidence,
    status: decision.status,
    statusReason: decision.reason,
  };
}

/** Record the outcome of a run in which this item was injected. */
export function applyOutcome(
  item: KnowledgeItem,
  success: boolean,
  policy: Policy,
  now: number,
): KnowledgeItem {
  const appliedItem: KnowledgeItem = {
    ...item,
    applied: item.applied + 1,
    succeeded: item.succeeded + (success ? 1 : 0),
    // The denominator retirement needs: how often this item was given a chance,
    // and how often the answer that cited it was accepted.
    utility: {
      injected: (item.utility?.injected ?? 0) + 1,
      flippedUp: (item.utility?.flippedUp ?? 0) + (success ? 1 : 0),
      flippedDown: (item.utility?.flippedDown ?? 0) + (success ? 0 : 1),
    },
    updatedAt: now,
  };
  const decision = decideStatus(
    { ...appliedItem, confidence: scoreKnowledge(appliedItem, policy, now) },
    policy,
    now,
  );
  return {
    ...appliedItem,
    confidence: decision.confidence,
    status: decision.status,
    statusReason: decision.reason,
  };
}

export function reinstate(item: KnowledgeItem, policy: Policy, now: number): KnowledgeItem {
  const reinstated: KnowledgeItem = {
    ...item,
    status: 'candidate',
    statusReason: 'manually-reinstated',
    updatedAt: now,
  };
  const decision = decideStatus(
    { ...reinstated, confidence: scoreKnowledge(reinstated, policy, now) },
    policy,
    now,
  );
  return {
    ...reinstated,
    confidence: decision.confidence,
    status: decision.status,
    statusReason: decision.reason,
  };
}

export function expireKnowledge(item: KnowledgeItem, at: number, reason: string): KnowledgeItem {
  return {
    ...item,
    validUntil: at,
    systemUntil: at,
    status: 'retired',
    statusReason: reason,
    updatedAt: at,
  };
}

/**
 * A stable identity for the claim, exported so a distiller can detect that two
 * differently-worded corrections mean the same thing before creating two items.
 */
export function statementIdentity(
  namespace: string,
  kind: string,
  scope: KnowledgeScope,
  statement: string,
): string {
  return dedupeKeyOf({ namespace, kind: kind as DistillCandidate['kind'], scope, statement });
}

/** True when the payload is small enough to render without a separate fetch. */
export function isInlinePayload(payload: Json | undefined): boolean {
  return payload === undefined || JSON.stringify(payload).length <= 800;
}
