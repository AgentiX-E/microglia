/**
 * Scope generalisation, bounded.
 *
 * A correction observed in `sales` and again in `hr` is evidence that the
 * domain was never the reason. Promoting the claim to a domain-free scope is
 * the difference between a store that re-learns the same lesson once per
 * department and one that actually compounds.
 *
 * The counter-pressure is MemForm's **scope** route: real records, inflated
 * applicability. A store that widens on thin evidence silently converts a
 * narrow truth into a broad falsehood, and the broader claim is the one that
 * gets injected. So widening is bounded twice:
 *
 *   1. **By construction.** The widened scope is the *meet* of the endorsing
 *      scopes — a dimension survives only when every endorser constrains it
 *      identically. Only `domain` may be dropped; a claim that disagrees on
 *      intent, field, reason code or schema digest is not the same claim, and
 *      dropping those would turn "line for trends" into "line for everything".
 *   2. **By support.** Three distinct tasks must endorse the claim before the
 *      narrow copies are retired, because widening *destroys* the domain-scoped
 *      precision the store had, and a destructive act needs more than a pair.
 *
 * Both halves are pure functions, so the bound is testable without a store.
 */
import { jsonEqual } from '../kernel/index.js';
import type { DistillCandidate, EvidenceRef, KnowledgeItem, KnowledgeScope } from '../kernel/index.js';

/** Distinct tasks required before a claim may widen beyond its endorsers. */
export const WIDENING_TASKS = 3;

/** Dimensions that may never be dropped, in the order they are checked. */
const FIXED_DIMENSIONS = ['schemaDigest', 'intent', 'field', 'reasonCode'] as const;

export function payloadsEqual(a: KnowledgeItem, b: DistillCandidate): boolean {
  return jsonEqual(a.payload ?? null, b.payload ?? null);
}

/**
 * The widest scope that still applies to every endorser, or `undefined` when no
 * such scope exists.
 *
 * A dimension is kept only when all endorsers define it identically. `domain` is
 * the single dimension allowed to disappear; any other dimension that would have
 * to disappear means the endorsers disagree about what the rule is *about*, and
 * the honest answer is that they are different rules.
 */
export function widenedScopeOf(scopes: readonly KnowledgeScope[]): KnowledgeScope | undefined {
  if (scopes.length === 0) return undefined;
  const [first, ...rest] = scopes as [KnowledgeScope, ...KnowledgeScope[]];
  if (!rest.every((scope) => scope.task === first.task)) return undefined;

  const widened: { -readonly [K in keyof KnowledgeScope]: KnowledgeScope[K] } = {
    task: first.task,
  };
  for (const dimension of FIXED_DIMENSIONS) {
    const value = first[dimension];
    if (value !== undefined && rest.every((scope) => scope[dimension] === value)) {
      widened[dimension] = value;
      continue;
    }
    // Either nobody constrains it (fine: the widened scope does not either) or
    // somebody does and another does not (not fine: that dimension would have to
    // be dropped, and only `domain` may be).
    if ([first, ...rest].some((scope) => scope[dimension] !== undefined)) return undefined;
  }

  const domain = first.domain;
  if (domain !== undefined && rest.every((scope) => scope.domain === domain)) {
    widened.domain = domain;
  }
  return widened;
}

/** Same namespace, kind and payload, and a domain that differs. */
function sameRuleShape(item: KnowledgeItem, candidate: DistillCandidate): boolean {
  if (item.namespace !== candidate.namespace) return false;
  if (item.kind !== candidate.kind) return false;
  if (!payloadsEqual(item, candidate)) return false;
  // A candidate without a domain has nothing to widen away, and an item in the
  // same domain is a merge, not a generalisation.
  if (candidate.scope.domain === undefined) return false;
  return item.scope.domain !== candidate.scope.domain;
}

/**
 * Could two observations be the same rule seen from different scopes?
 *
 * This is a *predicate*, not a decision: it answers whether widening is
 * coherent, while `WIDENING_TASKS` answers whether it is earned. Keeping them
 * apart is what lets the support gate move without re-deriving the bound.
 */
export function canGeneralize(item: KnowledgeItem, candidate: DistillCandidate): boolean {
  return (
    sameRuleShape(item, candidate) &&
    widenedScopeOf([item.scope, candidate.scope]) !== undefined
  );
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

export type GeneralizationPlan = {
  readonly target: KnowledgeItem;
  readonly scope: KnowledgeScope;
  /** Siblings whose evidence travels into the widened item. */
  readonly endorsers: readonly KnowledgeItem[];
  /** Distinct tasks behind the claim, including the candidate's. */
  readonly tasks: number;
};

/**
 * Decide, once, whether a claim may widen and onto what.
 *
 * The plan is computed from the whole task pool rather than from a pre-filtered
 * sibling list: the sibling filter is structural (same rule, different domain),
 * and the *scope* bound is applied here, to the set rather than to each pair.
 * Two siblings can each be compatible with the candidate and still disagree with
 * each other, in which case merging both would attribute one sibling's evidence
 * to a scope it never endorsed.
 *
 * `undefined` is the common, cheap answer: no widening, create or merge instead.
 */
export function generalizationPlan(
  pool: readonly KnowledgeItem[],
  candidate: DistillCandidate,
): GeneralizationPlan | undefined {
  // Only an **admitted** claim may endorse a widening. A quarantined or still-
  // candidate sibling is evidence the store has not accepted, and letting it
  // travel into the widened item is how an untrusted channel buys applicability:
  // the scope route needs no false record, only a real one next door.
  const siblings = pool.filter(
    (item) => item.status === 'active' && sameRuleShape(item, candidate),
  );
  if (siblings.length === 0) return undefined;
  const target = pickGeneralizationTarget(siblings);
  if (target === undefined) return undefined;

  let scope = widenedScopeOf([target.scope, candidate.scope]);
  if (scope === undefined) return undefined;

  const endorsers: KnowledgeItem[] = [target];
  for (const item of siblings) {
    if (item === target) continue;
    const next = widenedScopeOf([...endorsers.map((entry) => entry.scope), item.scope, candidate.scope]);
    if (next === undefined) continue;
    endorsers.push(item);
    scope = next;
  }

  const tasks = endorsingTasks(endorsers, candidate);
  if (tasks < WIDENING_TASKS) return undefined;
  return { target, scope, endorsers, tasks };
}

/** How many distinct tasks stand behind the claim once this candidate lands. */
export function endorsingTasks(
  endorsers: readonly KnowledgeItem[],
  candidate: DistillCandidate,
): number {
  const seen = new Set<string>();
  const add = (entry: EvidenceRef): void => {
    seen.add(entry.taskId ?? `run:${entry.runId}`);
  };
  for (const item of endorsers) for (const entry of item.evidence) add(entry);
  add(candidate.evidence);
  return seen.size;
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
