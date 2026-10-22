/**
 * Curation: merge what is the same, retire what has been shown useless, and never
 * rewrite the store in one pass.
 *
 * Three rules, each with a reason that came from a measurement rather than a
 * preference:
 *
 *   - **Merge, do not rewrite.** The store grows by accumulating near-duplicate
 *     phrasings of one rule. Rewriting everything is how a context collapses, so a
 *     merge keeps one survivor and closes the others with a pointer.
 *   - **Prune only when asked.** Pruning is off by default, because the most
 *     widely used memory SDK ships with deletes off and because a rule with no
 *     observed outcome is unmeasured, not useless.
 *   - **Deterministic.** The same store and the same options produce the same
 *     decision, so a curated store can be compared with an uncurated one.
 */
import { MicrogliaError, hashJson } from '../kernel/index.js';
import {
  decideStatus,
  diceSimilarity,
  scoreKnowledge,
  scopeKey,
} from '../kernel/index.js';
import type { EvidenceRef, Json, KnowledgeItem, Policy } from '../kernel/index.js';
import type { MemoryPort } from '../memory/index.js';

export type CurationOptions = {
  readonly namespace?: string;
  /** Restrict to one task; omitted means every task in the namespace. */
  readonly task?: string;
  /** Report what would happen without writing anything. */
  readonly dryRun?: boolean;
  /** Items allowed per (namespace, task) before the cap is reported. */
  readonly maxItemsPerTask?: number;
  /** Retire the lowest-utility items above the cap. Off unless asked. */
  readonly prune?: boolean;
  /** Statement similarity at which two items are the same rule, in [0, 1]. */
  readonly mergeThreshold?: number;
};

export type CurationReport = {
  readonly scanned: number;
  readonly merged: number;
  readonly pruned: number;
  /** Items above the cap that were left alone because `prune` is off. */
  readonly overCap: number;
  readonly cappedTasks: number;
  readonly dryRun: boolean;
};

const DEFAULT_MAX_ITEMS = 2_000;
const DEFAULT_THRESHOLD = 0.85;

/** Only these can be merged or pruned; a merged loser is already closed. */
const LIVE_STATUSES = new Set(['active', 'candidate', 'quarantined', 'conflicted']);

export async function curateKnowledge(
  store: MemoryPort,
  policy: Policy,
  now: number,
  options: CurationOptions = {},
): Promise<CurationReport> {
  const threshold = options.mergeThreshold ?? DEFAULT_THRESHOLD;
  if (!(threshold > 0 && threshold <= 1)) {
    throw new MicrogliaError('MG_E_CONFIG', 'mergeThreshold must be in (0, 1]', { threshold });
  }
  const maxItems = options.maxItemsPerTask ?? DEFAULT_MAX_ITEMS;
  if (!Number.isInteger(maxItems) || maxItems < 1) {
    throw new MicrogliaError('MG_E_CONFIG', 'maxItemsPerTask must be a positive integer', {
      maxItems,
    });
  }

  const items = await store.listKnowledge({
    ...(options.namespace === undefined ? {} : { namespace: options.namespace }),
    ...(options.task === undefined ? {} : { task: options.task }),
    status: 'all',
  });
  const dryRun = options.dryRun === true;
  const writes = new Map<string, KnowledgeItem>();

  let merged = 0;
  const kept: KnowledgeItem[] = [];
  for (const group of groupForMerge(items)) {
    const survivors: KnowledgeItem[] = [];
    for (const item of group) {
      const index = survivors.findIndex(
        (candidate) => diceSimilarity(candidate.statement, item.statement) >= threshold,
      );
      if (index === -1) {
        survivors.push(item);
        continue;
      }
      const combined = mergeInto(survivors[index] as KnowledgeItem, item, policy, now);
      survivors[index] = combined;
      writes.set(combined.id, combined);
      const loser = close(item, combined.id, 'merged', now);
      writes.set(loser.id, loser);
      merged += 1;
    }
    kept.push(...survivors);
  }

  // The cap is counted over what remains open, per task, after merging.
  const byTask = new Map<string, KnowledgeItem[]>();
  for (const item of kept.map((entry) => writes.get(entry.id) ?? entry)) {
    const key = `${item.namespace}|${item.scope.task}`;
    const bucket = byTask.get(key) ?? [];
    bucket.push(item);
    byTask.set(key, bucket);
  }

  let pruned = 0;
  let overCap = 0;
  let cappedTasks = 0;
  for (const bucket of byTask.values()) {
    if (bucket.length <= maxItems) continue;
    cappedTasks += 1;
    const excess = bucket.length - maxItems;
    if (options.prune !== true) {
      overCap += excess;
      continue;
    }
    // Lowest utility density first: a rule that was given many chances and helped
    // rarely is the cheapest thing to lose. Ties break on id so the decision is
    // reproducible.
    const ordered = [...bucket].sort(
      (a, b) => density(a) - density(b) || (a.id < b.id ? -1 : 1),
    );
    for (const item of ordered.slice(0, excess)) {
      const closed = close(item, undefined, 'pruned', now);
      writes.set(closed.id, closed);
      pruned += 1;
    }
  }

  if (!dryRun) {
    for (const item of [...writes.values()].sort((a, b) => (a.id < b.id ? -1 : 1))) {
      await store.putKnowledge(item);
    }
  }

  return { scanned: items.length, merged, pruned, overCap, cappedTasks, dryRun };
}

/**
 * Laplace-smoothed success density.
 *
 * Unobserved is not bad: a rule with no outcome sits at 0.5, between a rule that
 * always helped and one that always hurt, which is why pruning it needs the cap
 * to be exceeded by a population, not by its own silence.
 */
export function density(item: KnowledgeItem): number {
  const up = item.utility?.flippedUp ?? item.succeeded;
  const total = item.utility?.injected ?? item.applied;
  return (up + 1) / (total + 2);
}

function groupForMerge(
  items: readonly KnowledgeItem[],
): readonly (readonly KnowledgeItem[])[] {
  const buckets = new Map<string, KnowledgeItem[]>();
  for (const item of items) {
    if (!LIVE_STATUSES.has(item.status)) continue;
    // The payload is part of the identity, not a detail: two items whose
    // statements are near-identical and whose payloads disagree are a
    // contradiction, and a merge would let the survivor's payload inherit the
    // loser's evidence. That is the selection route, and it needs no attacker
    // beyond a paraphrase.
    const key = `${item.namespace}|${item.kind}|${scopeKey(item.scope)}|${hashJson(
      (item.payload ?? null) as Json,
    )}`;
    const bucket = buckets.get(key) ?? [];
    bucket.push(item);
    buckets.set(key, bucket);
  }
  // Sorted keys and sorted members: two runs over the same store must decide the
  // same merge, or a curated run and an uncurated one cannot be compared.
  return [...buckets.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([, bucket]) => [...bucket].sort((a, b) => (a.id < b.id ? -1 : 1)));
}

function mergeInto(
  survivor: KnowledgeItem,
  other: KnowledgeItem,
  policy: Policy,
  now: number,
): KnowledgeItem {
  const seen = new Set(survivor.evidence.map((entry) => entry.feedbackId));
  // Support is the mass of *distinct* observations. Adding `other.support` would
  // double count any event both items cite — and two items citing one event is
  // exactly what a near-duplicate pair is — which would let one user's single
  // correction pay for two rules and admit the sum of them.
  const added = other.evidence.filter((entry) => !seen.has(entry.feedbackId));
  const evidence = orderedEvidence([...survivor.evidence, ...added]);
  const merged: KnowledgeItem = {
    ...survivor,
    evidence,
    support: survivor.support + added.reduce((sum, entry) => sum + entry.weight, 0),
    applied: survivor.applied + other.applied,
    succeeded: survivor.succeeded + other.succeeded,
    contradictions: Math.max(survivor.contradictions, other.contradictions),
    trust: Math.max(survivor.trust, other.trust),
    validFrom: Math.min(survivor.validFrom, other.validFrom),
    updatedAt: now,
    utility: {
      injected: (survivor.utility?.injected ?? 0) + (other.utility?.injected ?? 0),
      flippedUp: (survivor.utility?.flippedUp ?? 0) + (other.utility?.flippedUp ?? 0),
      flippedDown: (survivor.utility?.flippedDown ?? 0) + (other.utility?.flippedDown ?? 0),
    },
  };
  const decision = decideStatus(
    { ...merged, confidence: scoreKnowledge(merged, policy, now) },
    policy,
    now,
  );
  return {
    ...merged,
    confidence: decision.confidence,
    status: decision.status,
    statusReason: decision.reason,
  };
}

/**
 * Evidence in a canonical order.
 *
 * A merge product must not depend on which of two near-duplicates was seen
 * first: the whole store is replayed from a shuffled log in the integrity lane,
 * and an array whose order came from arrival order would make two equivalent
 * stores compare unequal. Sorting is by observation time, then id, so the order
 * is also *meaningful* — oldest first, the way the story happened.
 */
function orderedEvidence(evidence: readonly EvidenceRef[]): readonly EvidenceRef[] {
  return [...evidence].sort((a, b) => a.at - b.at || (a.feedbackId < b.feedbackId ? -1 : 1));
}

function close(
  item: KnowledgeItem,
  into: string | undefined,
  why: 'merged' | 'pruned',
  now: number,
): KnowledgeItem {
  return {
    ...item,
    status: 'retired',
    statusReason: into === undefined ? `${why}:low-utility` : `${why}:${into}`,
    // Closing the interval is what makes the merge visible to a query about the
    // past: the old phrasing existed, and this is when it stopped applying.
    validUntil: Math.min(item.validUntil, now),
    updatedAt: now,
  };
}
