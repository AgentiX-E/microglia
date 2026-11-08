/**
 * Consolidation: the store's own recurrence, read after the fact.
 *
 * ## The question this answers
 *
 * Every write-side mechanism in this package compares **one incoming claim** with what is already
 * stored: the exact key absorbs a repeat inside one scope, generalisation absorbs a recurrence
 * across domains, admission absorbs a paraphrase. All three run at the moment the second episode
 * arrives, and all three are therefore decided by the evidence that exists at that moment.
 *
 * That is fine for deduplication and wrong for recurrence. A recurrence threshold — the published
 * competitive arm admits a guideline after three distinct learning tasks — asks a question about
 * the *finished* store: which of these items are one claim, and how many tasks stand behind each?
 * The answer cannot be produced by a rule that ran before the third item existed, and a store of
 * seven items with one task each and a store of three items with two or three tasks each can be
 * identical from the write path's point of view.
 *
 * So this pass runs over a store that has already been written, groups items that state one claim,
 * and folds each group into a survivor that carries the union of its evidence. The union is what
 * `countDistinctTasks` reads, which is what makes `supportTasks` reach 2 or 3 without a threshold
 * being lowered anywhere.
 *
 * ## Why a lexical key rather than an embedding
 *
 * A deterministic key is the only kind this project can test: a merge decided by a cosine is
 * decided by the model that produced the vectors, and the run that reads the census could not
 * reproduce it. The cost is that the key is coarse — token overlap over the claim's own words,
 * with the condition held to the same test — and the census carries the threshold it used so a
 * strict pass can be told from a loose one.
 *
 * ## What it will not do
 *
 * It will not merge two claims whose payloads differ (one item cannot carry both), whose evidence
 * is identical (that buys no support and would report a duplicate as corroboration), or whose
 * conditions disagree (the first would win by arrival order, which is the defect the write path
 * counts as `conditionConflicts`). Each refusal is counted rather than silently skipped: a pass
 * that merged nothing because every pair was refused and a pass that merged nothing because no
 * pair recurred are different findings.
 */
import {
  TIER_RANK,
  decideStatus,
  jsonEqual,
  scopeKey,
  scoreKnowledge,
} from '../kernel/index.js';
import type { KnowledgeItem, Policy, ProvenanceTier } from '../kernel/index.js';

export type ConsolidationOptions = {
  readonly now: number;
  /** Needed to re-score a survivor: two tasks of support are not one task of confidence. */
  readonly policy: Policy;
  /**
   * Token-overlap floor at which two claims are one claim. Default 0.7.
   *
   * Calibrated on the shape a distiller writes: a claim is one sentence of six to twenty content
   * terms, and the paraphrases this pass exists for share most of them ("confirm the customer's
   * identity before changing a booking" / "confirm the customer identity before you change the
   * booking"). Below 0.5 two claims that share only their subject merge, which is how a store
   * loses the distinction it was built to keep.
   */
  readonly threshold?: number;
};

/** What consolidation did, in the numbers a readback reads. */
export type ConsolidationCensus = {
  /** Items the pass considered: everything the store holds that is not retired. */
  readonly considered: number;
  /** Groups of two or more that became one item. */
  readonly groups: number;
  /** Items retired because a survivor absorbed them. */
  readonly merged: number;
  /** Items left, which is `considered - merged`. */
  readonly retained: number;
  /** The overlap floor this pass used. */
  readonly threshold: number;
  /** Pairs that overlapped and were refused for stating two different conditions. */
  readonly refusedCondition: number;
  /** Pairs that overlapped and were refused for carrying two different payloads. */
  readonly refusedPayload: number;
  /** Pairs that overlapped and held the same evidence, so a merge would buy no support. */
  readonly refusedDuplicateEvidence: number;
  /** Items by distinct tasks before the pass. */
  readonly supportBefore: Readonly<Record<number, number>>;
  /** Items by distinct tasks after it. */
  readonly supportAfter: Readonly<Record<number, number>>;
  readonly maxSupportBefore: number;
  readonly maxSupportAfter: number;
};

export type ConsolidationResult = {
  readonly items: readonly KnowledgeItem[];
  readonly report: ConsolidationCensus;
};

/**
 * Words that carry no claim.
 *
 * Deliberately short: the key is a similarity, so a stop list that removes meaning ("not",
 * "before", "only") would merge claims that differ in exactly the way that matters. "Before" is a
 * stopword here only because the distiller writes it in nearly every sentence, and it stays in the
 * key of a *pair* that differs by it — which is the case this list must not decide.
 */
const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'is', 'are', 'be', 'been',
  'that', 'this', 'these', 'those', 'it', 'its', 'you', 'your', 'they', 'their', 'when', 'from',
]);

export function claimTokens(text: string): ReadonlySet<string> {
  const out = new Set<string>();
  for (const raw of text.normalize('NFKC').toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length === 0 || STOPWORDS.has(raw)) continue;
    out.add(raw);
  }
  return out;
}

/**
 * Jaccard overlap over content terms: 1 when the two sets are equal, 0 when they share nothing.
 *
 * Two empty sets are 0 and not 1. A statement made only of stopwords reduces to no content terms,
 * and "these two claims have nothing in them" is not evidence that they are the same claim —
 * treating it as one would fold an unreadable item into a readable one and report a corroboration
 * that no task contributed to.
 */
export function claimOverlap(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / (left.size + right.size - shared);
}

/** Distinct tasks behind an item, with the score's own grouping. */
function tasksOf(item: KnowledgeItem): number {
  const seen = new Set<string>();
  for (const entry of item.evidence) seen.add(entry.taskId ?? `run:${entry.runId}`);
  return seen.size;
}

/** Whether a member is a candidate to be the survivor at all. */
function liveRank(item: KnowledgeItem): number {
  // Quarantined last: it is not cleared for injection, and making it the survivor of a merge would
  // launder a status the policy set.
  return item.status === 'quarantined' ? 0 : 1;
}

type Ranked = { readonly index: number; readonly item: KnowledgeItem };

function better(left: Ranked, right: Ranked): Ranked {
  const liveDifference = liveRank(left.item) - liveRank(right.item);
  if (liveDifference !== 0) return liveDifference > 0 ? left : right;
  const taskDifference = tasksOf(left.item) - tasksOf(right.item);
  if (taskDifference !== 0) return taskDifference > 0 ? left : right;
  const evidenceDifference = left.item.evidence.length - right.item.evidence.length;
  if (evidenceDifference !== 0) return evidenceDifference > 0 ? left : right;
  // Last resort, and the one that makes two runs over one store produce one store.
  return left.item.id <= right.item.id ? left : right;
}

/** The union of two items' evidence, without the rows both already hold. */
function unionEvidence(
  members: readonly KnowledgeItem[],
): readonly KnowledgeItem['evidence'][number][] {
  const seen = new Set<string>();
  const out: KnowledgeItem['evidence'][number][] = [];
  for (const member of members) {
    for (const entry of member.evidence) {
      const key = `${entry.feedbackId}\u0000${entry.runId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(entry);
    }
  }
  return out;
}

function sameEvidence(left: KnowledgeItem, right: KnowledgeItem): boolean {
  const keys = new Set(left.evidence.map((entry) => `${entry.feedbackId}\u0000${entry.runId}`));
  return right.evidence.every((entry) => keys.has(`${entry.feedbackId}\u0000${entry.runId}`));
}

function distribution(items: readonly KnowledgeItem[]): Record<number, number> {
  const out: Record<number, number> = {};
  for (const item of items) {
    const tasks = tasksOf(item);
    out[tasks] = (out[tasks] ?? 0) + 1;
  }
  return out;
}

function maxSupport(items: readonly KnowledgeItem[]): number {
  return items.reduce((most, item) => Math.max(most, tasksOf(item)), 0);
}

export function consolidateKnowledge(
  items: readonly KnowledgeItem[],
  options: ConsolidationOptions,
): ConsolidationResult {
  const threshold = options.threshold ?? 0.7;
  const consideredIndexes: number[] = [];
  for (let index = 0; index < items.length; index += 1) {
    if (items[index]?.status !== 'retired') consideredIndexes.push(index);
  }
  const considered = consideredIndexes.map((index) => items[index] as KnowledgeItem);
  const tokensOf = new Map<number, ReadonlySet<string>>();
  for (const index of consideredIndexes) {
    tokensOf.set(index, claimTokens((items[index] as KnowledgeItem).statement));
  }

  // Union-find over store order, so the grouping is a function of the store and not of the order
  // in which pairs happened to be examined.
  const parent = new Map<number, number>();
  for (const index of consideredIndexes) parent.set(index, index);
  // Path compression is deliberately absent: a union always attaches a root to a root, so a chain
  // is at most as deep as the number of groups, and this pass runs once over a store of tens of
  // items. The compression loop it would buy is a branch no store this lane produces can reach —
  // and an unreachable branch in a coverage report is a line that claims to be tested.
  const find = (index: number): number => {
    let root = index;
    while (parent.get(root) !== root) root = parent.get(root) as number;
    return root;
  };

  let refusedCondition = 0;
  let refusedPayload = 0;
  let refusedDuplicateEvidence = 0;

  for (let left = 0; left < consideredIndexes.length; left += 1) {
    const leftIndex = consideredIndexes[left] as number;
    const leftItem = items[leftIndex] as KnowledgeItem;
    for (let right = left + 1; right < consideredIndexes.length; right += 1) {
      const rightIndex = consideredIndexes[right] as number;
      const rightItem = items[rightIndex] as KnowledgeItem;
      if (leftItem.kind !== rightItem.kind) continue;
      if (scopeKey(leftItem.scope) !== scopeKey(rightItem.scope)) continue;
      const overlap = claimOverlap(
        tokensOf.get(leftIndex) as ReadonlySet<string>,
        tokensOf.get(rightIndex) as ReadonlySet<string>,
      );
      if (overlap < threshold) continue;
      if (
        leftItem.when !== undefined &&
        rightItem.when !== undefined &&
        claimOverlap(claimTokens(leftItem.when), claimTokens(rightItem.when)) < threshold
      ) {
        refusedCondition += 1;
        continue;
      }
      if (leftItem.payload !== undefined && rightItem.payload !== undefined && !jsonEqual(leftItem.payload, rightItem.payload)) {
        refusedPayload += 1;
        continue;
      }
      if (sameEvidence(leftItem, rightItem)) {
        refusedDuplicateEvidence += 1;
        continue;
      }
      const leftRoot = find(leftIndex);
      const rightRoot = find(rightIndex);
      if (leftRoot !== rightRoot) parent.set(rightRoot, leftRoot);
    }
  }

  const components = new Map<number, number[]>();
  for (const index of consideredIndexes) {
    const root = find(index);
    const bucket = components.get(root);
    if (bucket === undefined) components.set(root, [index]);
    else bucket.push(index);
  }

  const output: KnowledgeItem[] = [...items];
  let groups = 0;
  let merged = 0;
  for (const bucket of components.values()) {
    if (bucket.length < 2) continue;
    groups += 1;
    const members = bucket
      .map((index) => ({ index, item: items[index] as KnowledgeItem }))
      .sort((a, b) => a.index - b.index);
    let best = members[0] as Ranked;
    for (const member of members.slice(1)) best = better(best, member);

    const evidence = unionEvidence(members.map((member) => member.item));
    const support = evidence.reduce((sum, entry) => sum + entry.weight, 0);
    const adoptedWhen = best.item.when ?? members.find((member) => member.item.when !== undefined)?.item.when;
    const adoptedPayload = best.item.payload ?? members.find((member) => member.item.payload !== undefined)?.item.payload;
    const tier = members
      .map((member) => member.item.tier)
      .filter((value): value is ProvenanceTier => value !== undefined)
      .sort((a, b) => TIER_RANK[b] - TIER_RANK[a])[0];
    const contradictions = members.reduce((sum, member) => sum + member.item.contradictions, 0);
    const trust = Math.max(...members.map((member) => member.item.trust));

    const fused: KnowledgeItem = {
      ...best.item,
      evidence,
      support,
      contradictions,
      trust,
      ...(adoptedWhen === undefined ? {} : { when: adoptedWhen }),
      ...(adoptedPayload === undefined ? {} : { payload: adoptedPayload }),
      ...(tier === undefined ? {} : { tier }),
      updatedAt: options.now,
    };
    const decision = decideStatus(
      { ...fused, confidence: scoreKnowledge(fused, options.policy, options.now) },
      options.policy,
      options.now,
    );
    output[best.index] = {
      ...fused,
      confidence: decision.confidence,
      status: decision.status,
      statusReason: decision.reason,
    };
    for (const member of members) {
      if (member.index === best.index) continue;
      output[member.index] = {
        ...member.item,
        status: 'retired',
        statusReason: `consolidated:${best.item.id}`,
        systemUntil: options.now,
        updatedAt: options.now,
      };
      merged += 1;
    }
  }

  const survivors = output.filter((item) => item.status !== 'retired');
  return {
    items: output,
    report: {
      considered: considered.length,
      groups,
      merged,
      retained: survivors.length,
      threshold,
      refusedCondition,
      refusedPayload,
      refusedDuplicateEvidence,
      supportBefore: distribution(considered),
      supportAfter: distribution(survivors),
      maxSupportBefore: maxSupport(considered),
      maxSupportAfter: maxSupport(survivors),
    },
  };
}
