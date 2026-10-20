/**
 * Scope generalisation.
 *
 * A correction observed in `sales` and again in `hr` is evidence that the
 * domain was never the reason. Promoting the claim to a domain-free scope is
 * the difference between a store that re-learns the same lesson once per
 * department and one that actually compounds.
 *
 * The rule is conservative: only the `domain` dimension is droppable, only when
 * the claim payload is byte-identical, and only when the two observations come
 * from different domains. Intent and field stay, because collapsing those would
 * turn "line for trends" into "line for everything".
 */
import { jsonEqual } from '@agentix-e/microglia-core';
import type { DistillCandidate, KnowledgeItem, KnowledgeScope } from '@agentix-e/microglia-core';

export function payloadsEqual(a: KnowledgeItem, b: DistillCandidate): boolean {
  return jsonEqual(a.payload ?? null, b.payload ?? null);
}

export function canGeneralize(item: KnowledgeItem, candidate: DistillCandidate): boolean {
  if (item.namespace !== candidate.namespace) return false;
  if (item.kind !== candidate.kind) return false;
  if (!payloadsEqual(item, candidate)) return false;
  if (item.scope.task !== candidate.scope.task) return false;
  if (item.scope.intent !== candidate.scope.intent) return false;
  if (item.scope.field !== candidate.scope.field) return false;
  if (candidate.scope.domain === undefined) return false;
  // A domain-free item may absorb evidence from any domain.
  if (item.scope.domain === undefined) return true;
  return item.scope.domain !== candidate.scope.domain;
}

/**
 * The item a new claim widens onto, or `undefined` when nothing can absorb it.
 *
 * Only an **active** sibling is a target. Widening onto a candidate would
 * promote an item that has not yet earned admission, and widening onto a retired
 * item would resurrect a rule the store decided to stop applying. Returning
 * `undefined` instead of throwing lets the caller fall through to creating a new
 * item, which is what a claim with no eligible sibling deserves.
 */
export function pickGeneralizationTarget(
  siblings: readonly KnowledgeItem[],
): KnowledgeItem | undefined {
  return (
    siblings.find((item) => item.scope.domain === undefined && item.status === 'active') ??
    siblings.find((item) => item.status === 'active')
  );
}

export function withoutDomain(scope: KnowledgeScope): KnowledgeScope {
  const { domain: _domain, ...rest } = scope;
  return rest;
}

/**
 * Build the widened scope. Only call after `canGeneralize` returned true: this
 * function does not re-check, because duplicating the predicate in two places
 * is how the two drift.
 */
export function generalizedScope(item: KnowledgeItem): KnowledgeScope {
  return withoutDomain(item.scope);
}

export function mergeEvidence(
  items: readonly KnowledgeItem[],
  candidate: DistillCandidate,
): { evidence: KnowledgeItem['evidence']; support: number } {
  const seen = new Set<string>();
  const evidence: KnowledgeItem['evidence'][number][] = [];
  let support = 0;
  for (const item of items) {
    for (const entry of item.evidence) {
      if (seen.has(entry.feedbackId)) continue;
      seen.add(entry.feedbackId);
      evidence.push(entry);
      support += entry.weight;
    }
  }
  if (!seen.has(candidate.evidence.feedbackId)) {
    evidence.push(candidate.evidence);
    support += candidate.evidence.weight;
  }
  return { evidence, support };
}
