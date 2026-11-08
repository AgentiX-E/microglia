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
 * reproduce it. The cost is that the key is coarse — token containment over the claim's own words —
 * and the census carries the floor it used so a strict pass can be told from a loose one.
 *
 * ## Why containment, measured on the register rather than assumed
 *
 * The first version scored a pair with Jaccard, and R58's store is the reason it is not that any
 * more. Its two closest items are one claim: both open "when a request bundles several changes,
 * carry out every requested change in the order the requester stated them", and then differ — one
 * ends "do not stop after the first one succeeds", the other "stop once all are applied rather than
 * adding extra lookups or calculations". Jaccard puts that pair at **0.483** against a 0.70 floor,
 * and 0.483 is the *maximum* of all 105 pairs in the store; the next-highest pair, which is not a
 * repeat, is 0.250.
 *
 * Jaccard charges the difference twice: once for the terms the trailing clause adds, once for the
 * terms it does not share. Containment charges it once — shared terms over the *smaller* claim's
 * terms — and puts the same pair at **0.700** against 0.533 for the closest non-repeat. A floor of
 * 0.60 therefore sits between them, which is where a floor has to sit to be a decision rather than
 * a hope. Both numbers are measured on the store, not chosen.
 *
 * The condition is tested a different way, and that is also measured. The same pair's conditions —
 * "multiple distinct changes in one request and names the order" against "multiple distinct
 * modifications and specifies the sequence" — share four content terms of eight; the closest
 * non-repeat pair's conditions share four as well, and two conditions that disagree about the
 * subject ("the customer asks to change a booking" against "the customer asks for a refund on a
 * flight") share two. As a *ratio* the condition therefore reads 0.400 whether the pair is one
 * claim or two, which is no resolution at all: holding it to any floor in that neighbourhood would
 * veto the one merge the register offers, and the pass would report itself inert a second time.
 *
 * What does separate them is an absolute count. A paraphrased trigger shares more than its subject
 * — the register's true pair shares four terms — and a conflicting one shares the subject and
 * nothing else. So the condition is vetoed only below three shared terms, and the census carries
 * that count beside the ratio so a reader can see which test refused what.
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
} from "../kernel/index.js";
import type { KnowledgeItem, Policy, ProvenanceTier } from "../kernel/index.js";

export type ConsolidationOptions = {
  readonly now: number;
  /** Needed to re-score a survivor: two tasks of support are not one task of confidence. */
  readonly policy: Policy;
  /**
   * Containment floor at which two claims are one claim. Default 0.6.
   *
   * Calibrated on the register this lane actually writes: the store's one genuine pair of repeats
   * reads 0.700 and the closest pair that is not a repeat reads 0.533 (see the header). Below 0.5
   * two claims that share only their subject merge, which is how a store loses the distinction it
   * was built to keep.
   */
  readonly threshold?: number;
  /**
   * Shared content terms below which two conditions are held to disagree. Default 0, no veto.
   *
   * It was 3, on the argument that a count separates a paraphrased trigger from an unrelated one
   * where a ratio does not. Measured over the 37-item store R60 produced — 666 pairs — neither
   * measure separates: for pairs whose statements match (containment >= 0.60) the shared condition
   * count has median 1, and for pairs whose statements are unrelated (< 0.40) it also has median 1,
   * with 75% and 82% of each band sharing at least one term. The ratio behaves the same way, median
   * 0.11 in both bands.
   *
   * What a floor of 3 therefore did was admit roughly the top decile of pairs by condition overlap
   * regardless of whether their statements said the same thing. On that store it refused the most
   * similar pair it held — containment 0.88, Jaccard 0.70, conditions sharing one term — while
   * admitting a pair at 0.64 whose conditions shared five. A gate that is non-monotonic in the
   * measure that does separate (statement containment reads 0.88 / 0.64 / 0.62 / 0.62, then a clean
   * gap to 0.50) is not testing what it claims to test.
   *
   * The condition is still measured and still reported, per group, because two items with disjoint
   * triggers are weaker corroboration than two with the same trigger and a readback should see that.
   * It is no longer a veto: the decision it was vetoing had already been made, with better
   * separation, by the statement.
   */
  readonly conditionMinShared?: number;
};

/** One group of items the pass folded into one, and the two readings that say how strong it is. */
export type ConsolidatedGroup = {
  /** Member ids, survivor first, in store order after it. */
  readonly ids: readonly string[];
  /** Distinct tasks behind the group once their evidence is unioned. */
  readonly supportTasks: number;
  /**
   * The weakest pair inside the group.
   *
   * Complete linkage makes this >= the threshold by construction, so a readback can assert it
   * instead of hoping. It is the reading that separates "three tasks said the same thing" from
   * "A resembles B and B resembles C": under single linkage the second shape was reported as the
   * first, with a group whose extreme members shared nothing.
   */
  readonly weakestPair: number;
  /** The fewest condition terms any two members share. Zero means two triggers were disjoint. */
  readonly conditionShared: number;
  /**
   * Whether the union covers a task that no single member held.
   *
   * A merge of two items from one task is not corroboration, it is the same failure stated twice —
   * `sameEvidence` refuses that pair, but three items from two tasks can still group in a shape
   * where the union adds nothing. This is the count that says the merge bought support.
   */
  readonly crossTask: boolean;
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
  /** The claim floor this pass used. */
  readonly threshold: number;
  /** The condition count floor it used, which is not a ratio and not the same number. */
  readonly conditionMinShared: number;
  /** Pairs that overlapped and were refused for stating two different conditions. */
  readonly refusedCondition: number;
  /** Pairs that overlapped and were refused for carrying two different payloads. */
  readonly refusedPayload: number;
  /** Pairs that overlapped and held the same evidence, so a merge would buy no support. */
  readonly refusedDuplicateEvidence: number;
  /** Pairs that overlapped and were refused because merging them would break complete linkage. */
  readonly refusedLinkage: number;
  /** Items by distinct tasks before the pass. */
  readonly supportBefore: Readonly<Record<number, number>>;
  /** Items by distinct tasks after it. */
  readonly supportAfter: Readonly<Record<number, number>>;
  readonly maxSupportBefore: number;
  readonly maxSupportAfter: number;
  /** Every group, in the order the pass formed them. Empty when nothing merged. */
  readonly groupDetail: readonly ConsolidatedGroup[];
  /** The weakest pair across every group; 1 when there are none. */
  readonly weakestPair: number;
  /** The largest group's member count; 1 when nothing merged. */
  readonly largestGroup: number;
  /** Groups whose evidence union covers more tasks than any one member did — merges that bought support. */
  readonly crossTaskGroups: number;
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
  "a",
  "an",
  "the",
  "and",
  "or",
  "of",
  "to",
  "in",
  "on",
  "for",
  "with",
  "is",
  "are",
  "be",
  "been",
  "that",
  "this",
  "these",
  "those",
  "it",
  "its",
  "you",
  "your",
  "they",
  "their",
  "when",
  "from",
]);

export function claimTokens(text: string): ReadonlySet<string> {
  const out = new Set<string>();
  for (const raw of text
    .normalize("NFKC")
    .toLowerCase()
    .split(/[^a-z0-9]+/)) {
    if (raw.length === 0 || STOPWORDS.has(raw)) continue;
    out.add(raw);
  }
  return out;
}

/**
 * Content terms the two claims share.
 *
 * The unit the condition test is written in: a paraphrase shares more than the subject it restates,
 * and a conflict shares the subject and nothing else, which a ratio over two short sets hides.
 */
export function sharedTerms(
  left: ReadonlySet<string>,
  right: ReadonlySet<string>,
): number {
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared;
}

/**
 * Containment over content terms: 1 when the smaller claim's every term appears in the larger, 0
 * when they share nothing.
 *
 * The denominator is the *smaller* claim, not the union, and that is the whole point of the
 * change: a claim that restates another and then adds a caveat is the same claim, and a measure
 * that charges for the caveat twice cannot see it. The measure is symmetric because the smaller
 * side is chosen rather than named — two items in the opposite order score the same, which is what
 * keeps the pass a function of the store rather than of its order.
 *
 * Two empty sets are 0 and not 1. A statement made only of stopwords reduces to no content terms,
 * and "these two claims have nothing in them" is not evidence that they are the same claim —
 * treating it as one would fold an unreadable item into a readable one and report a corroboration
 * that no task contributed to.
 */
export function claimContainment(
  left: ReadonlySet<string>,
  right: ReadonlySet<string>,
): number {
  if (left.size === 0 || right.size === 0) return 0;
  return sharedTerms(left, right) / Math.min(left.size, right.size);
}

/** Distinct tasks behind an item, with the score's own grouping. */
function tasksOf(item: KnowledgeItem): number {
  const seen = new Set<string>();
  for (const entry of item.evidence)
    seen.add(entry.taskId ?? `run:${entry.runId}`);
  return seen.size;
}

/** Whether a member is a candidate to be the survivor at all. */
function liveRank(item: KnowledgeItem): number {
  // Quarantined last: it is not cleared for injection, and making it the survivor of a merge would
  // launder a status the policy set.
  return item.status === "quarantined" ? 0 : 1;
}

type Ranked = { readonly index: number; readonly item: KnowledgeItem };

function better(left: Ranked, right: Ranked): Ranked {
  const liveDifference = liveRank(left.item) - liveRank(right.item);
  if (liveDifference !== 0) return liveDifference > 0 ? left : right;
  const taskDifference = tasksOf(left.item) - tasksOf(right.item);
  if (taskDifference !== 0) return taskDifference > 0 ? left : right;
  const evidenceDifference =
    left.item.evidence.length - right.item.evidence.length;
  if (evidenceDifference !== 0) return evidenceDifference > 0 ? left : right;
  // Last resort, and the one that makes two runs over one store produce one store.
  return left.item.id <= right.item.id ? left : right;
}

/** The union of two items' evidence, without the rows both already hold. */
function unionEvidence(
  members: readonly KnowledgeItem[],
): readonly KnowledgeItem["evidence"][number][] {
  const seen = new Set<string>();
  const out: KnowledgeItem["evidence"][number][] = [];
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
  const keys = new Set(
    left.evidence.map((entry) => `${entry.feedbackId}\u0000${entry.runId}`),
  );
  return right.evidence.every((entry) =>
    keys.has(`${entry.feedbackId}\u0000${entry.runId}`),
  );
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
  const threshold = options.threshold ?? 0.6;
  const conditionMinShared = options.conditionMinShared ?? 0;
  const consideredIndexes: number[] = [];
  for (let index = 0; index < items.length; index += 1) {
    if (items[index]?.status !== "retired") consideredIndexes.push(index);
  }
  const considered = consideredIndexes.map(
    (index) => items[index] as KnowledgeItem,
  );
  const tokensOf = new Map<number, ReadonlySet<string>>();
  const conditionOf = new Map<number, ReadonlySet<string>>();
  for (const index of consideredIndexes) {
    const item = items[index] as KnowledgeItem;
    tokensOf.set(index, claimTokens(item.statement));
    conditionOf.set(index, claimTokens(item.when ?? ""));
  }
  // Every pair score the pass needs, computed once. Complete linkage asks about pairs the outer
  // loop never reaches — the two oldest members of a group it is about to extend — so a score
  // recomputed on demand would be recomputed quadratically at best.
  const overlapCache = new Map<string, number>();
  // Normalised with min/max rather than a comparison, so the key is order-independent without a
  // branch: both sides of a ternary here would be the same cache miss for a caller that passed the
  // pair the other way round, and one of them would be a line no test can reach.
  const overlapOf = (left: number, right: number): number => {
    const key = `${Math.min(left, right)}:${Math.max(left, right)}`;
    const cached = overlapCache.get(key);
    if (cached !== undefined) return cached;
    const value = claimContainment(
      tokensOf.get(left) as ReadonlySet<string>,
      tokensOf.get(right) as ReadonlySet<string>,
    );
    overlapCache.set(key, value);
    return value;
  };
  const conditionSharedOf = (left: number, right: number): number =>
    sharedTerms(
      conditionOf.get(left) as ReadonlySet<string>,
      conditionOf.get(right) as ReadonlySet<string>,
    );

  // Union-find over store order. The grouping is a function of the store, but complete linkage makes
  // it a function of the order pairs are examined too: the first pair that admits a member decides
  // the group it lands in. The order is the store's, which is stable, so the result is reproducible
  // for a given store even though it is not order-invariant in the abstract.
  const parent = new Map<number, number>();
  const membersOf = new Map<number, number[]>();
  for (const index of consideredIndexes) {
    parent.set(index, index);
    membersOf.set(index, [index]);
  }
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
  let refusedLinkage = 0;

  for (let left = 0; left < consideredIndexes.length; left += 1) {
    const leftIndex = consideredIndexes[left] as number;
    const leftItem = items[leftIndex] as KnowledgeItem;
    for (let right = left + 1; right < consideredIndexes.length; right += 1) {
      const rightIndex = consideredIndexes[right] as number;
      const rightItem = items[rightIndex] as KnowledgeItem;
      if (leftItem.kind !== rightItem.kind) continue;
      if (scopeKey(leftItem.scope) !== scopeKey(rightItem.scope)) continue;
      const overlap = overlapOf(leftIndex, rightIndex);
      if (overlap < threshold) continue;
      if (
        conditionMinShared > 0 &&
        conditionSharedOf(leftIndex, rightIndex) < conditionMinShared
      ) {
        refusedCondition += 1;
        continue;
      }
      if (
        leftItem.payload !== undefined &&
        rightItem.payload !== undefined &&
        !jsonEqual(leftItem.payload, rightItem.payload)
      ) {
        refusedPayload += 1;
        continue;
      }
      if (sameEvidence(leftItem, rightItem)) {
        refusedDuplicateEvidence += 1;
        continue;
      }
      // Complete linkage: the pair joins only if every member of one group matches every member of
      // the other. Single linkage admitted A-B and B-C and then reported one group of three whose
      // extreme members could share nothing, which is the shape a readback reads as "three tasks
      // agreed" when only the middle item ever agreed with both. The cost is stated rather than
      // hidden: a genuine chain of paraphrases now stays two groups instead of becoming one, and
      // `refusedLinkage` counts how often that happened.
      const leftRoot = find(leftIndex);
      const rightRoot = find(rightIndex);
      if (leftRoot === rightRoot) continue;
      const leftMembers = membersOf.get(leftRoot) as number[];
      const rightMembers = membersOf.get(rightRoot) as number[];
      let linked = true;
      for (const one of leftMembers) {
        for (const other of rightMembers) {
          if (overlapOf(one, other) >= threshold) continue;
          linked = false;
          break;
        }
        if (!linked) break;
      }
      if (!linked) {
        refusedLinkage += 1;
        continue;
      }
      parent.set(rightRoot, leftRoot);
      membersOf.set(
        leftRoot,
        [...leftMembers, ...rightMembers].sort((a, b) => a - b),
      );
      membersOf.delete(rightRoot);
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
  const groupDetail: ConsolidatedGroup[] = [];
  for (const bucket of components.values()) {
    if (bucket.length < 2) continue;
    groups += 1;
    const members = bucket
      .map((index) => ({ index, item: items[index] as KnowledgeItem }))
      .sort((a, b) => a.index - b.index);
    let best = members[0] as Ranked;
    for (const member of members.slice(1)) best = better(best, member);

    // Complete linkage already guarantees the first, so asserting it in a readback costs nothing
    // and catches a linkage change that silently went back to single. Seeded from the first pair
    // rather than from a sentinel: a group has at least two members by construction, so a sentinel
    // would be a branch no store can reach — a line that claims to be tested.
    const [firstMember, secondMember] = bucket as [number, number, ...number[]];
    let weakestPair = overlapOf(firstMember, secondMember);
    let conditionShared = conditionSharedOf(firstMember, secondMember);
    for (let one = 0; one < bucket.length; one += 1) {
      for (let other = one + 1; other < bucket.length; other += 1) {
        weakestPair = Math.min(
          weakestPair,
          overlapOf(bucket[one] as number, bucket[other] as number),
        );
        conditionShared = Math.min(
          conditionShared,
          conditionSharedOf(bucket[one] as number, bucket[other] as number),
        );
      }
    }
    const evidence = unionEvidence(members.map((member) => member.item));
    const supportTasks = new Set(
      evidence.map((entry) => entry.taskId ?? `run:${entry.runId}`),
    ).size;
    const widestMember = members.reduce(
      (most, member) => Math.max(most, tasksOf(member.item)),
      0,
    );
    groupDetail.push({
      ids: [
        best.item.id,
        ...members
          .filter((member) => member.index !== best.index)
          .map((member) => member.item.id),
      ],
      supportTasks,
      weakestPair,
      conditionShared,
      crossTask: supportTasks > widestMember,
    });
    const support = evidence.reduce((sum, entry) => sum + entry.weight, 0);
    const adoptedWhen =
      best.item.when ??
      members.find((member) => member.item.when !== undefined)?.item.when;
    const adoptedPayload =
      best.item.payload ??
      members.find((member) => member.item.payload !== undefined)?.item.payload;
    const tier = members
      .map((member) => member.item.tier)
      .filter((value): value is ProvenanceTier => value !== undefined)
      .sort((a, b) => TIER_RANK[b] - TIER_RANK[a])[0];
    const contradictions = members.reduce(
      (sum, member) => sum + member.item.contradictions,
      0,
    );
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
      {
        ...fused,
        confidence: scoreKnowledge(fused, options.policy, options.now),
      },
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
        status: "retired",
        statusReason: `consolidated:${best.item.id}`,
        systemUntil: options.now,
        updatedAt: options.now,
      };
      merged += 1;
    }
  }

  const survivors = output.filter((item) => item.status !== "retired");
  return {
    items: output,
    report: {
      considered: considered.length,
      groups,
      merged,
      retained: survivors.length,
      threshold,
      conditionMinShared,
      refusedCondition,
      refusedPayload,
      refusedDuplicateEvidence,
      refusedLinkage,
      supportBefore: distribution(considered),
      supportAfter: distribution(survivors),
      maxSupportBefore: maxSupport(considered),
      maxSupportAfter: maxSupport(survivors),
      groupDetail,
      weakestPair: groupDetail.reduce(
        (low, group) => Math.min(low, group.weakestPair),
        1,
      ),
      largestGroup: groupDetail.reduce(
        (most, group) => Math.max(most, group.ids.length),
        1,
      ),
      crossTaskGroups: groupDetail.filter((group) => group.crossTask).length,
    },
  };
}
