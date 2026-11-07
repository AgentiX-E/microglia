/**
 * Write-side admission: decide against the nearest neighbours, before the write.
 *
 * The store has always merged a repeat of the *same* claim: `dedupeKeyOf` is an
 * exact key over namespace, kind, scope and normalised statement, so a candidate
 * whose key matches an existing item accumulates evidence into it. That key
 * contains the scope, which is what makes it blind to the shape the store
 * actually grows in: the same lesson learned on task A and re-derived on task B
 * is two items, and a pack drawn from both pays for the same sentence twice.
 *
 * The two consequences are the ones the memory literature reports as the negative
 * effect. First, retrieval slots and prompt tokens are spent on paraphrases, so
 * the pack is thinner than its size suggests. Second, and worse, the two copies
 * *compete*: each carries one observation, so neither corroborates on its own,
 * and a promotion gate that wants two independent tasks sees one task twice.
 *
 * The alternative measured elsewhere is a write-time decision rather than a
 * read-time filter: compare the candidate against its nearest existing memories
 * and let the store refuse the write. This module is that decision, and it is
 * deliberately the *smallest* version that can be defended:
 *
 *   - `add`     — nothing comparable is stored; the candidate becomes an item;
 *   - `update`  — a comparable item exists and this observation changes it (new
 *                 evidence, a new condition, a stronger tier); the caller merges;
 *   - `noop`    — a comparable item exists and this observation changes nothing;
 *                 the write is refused and the suppression is counted.
 *
 * The fourth operation the leading memory layer ships is `delete`, and it is
 * absent on purpose. Deleting on a similarity match would let a paraphrase
 * retire the rule it paraphrases, and this repository has already refused that
 * move once: curation will not merge two items whose payloads disagree, because
 * a merge would let the survivor's payload inherit the loser's evidence — the
 * selection route, and it needs no attacker beyond a paraphrase. Retirement here
 * has its own model (`decideStatus`, `recordContradiction`, `curateKnowledge`'s
 * `retire`), all of which keep the closed item and its reason. A similarity
 * match is not evidence about which of two statements is true, and only evidence
 * is allowed to retire anything.
 *
 * What this module does *not* decide: how similarity is computed. The caller
 * supplies neighbours with their scores, because the store may rank lexically or
 * over embeddings and both are legitimate; what must not vary is what happens
 * once a candidate has a nearest neighbour.
 */
import { MicrogliaError } from './errors.js';
import { jsonEqual } from './hash.js';
import { wouldChange } from './knowledge.js';
import { diceSimilarity } from './similarity.js';
import type { DistillCandidate, KnowledgeItem, Policy } from './types.js';

/**
 * A stored item and how close the candidate is to it, in [0, 1].
 *
 * The score is supplied rather than recomputed so that a store with embeddings
 * and a store without can share this decision; `neighbourhood` below is the
 * lexical implementation for callers that have nothing better.
 */
export type WriteNeighbour = {
  readonly item: KnowledgeItem;
  readonly similarity: number;
};

/** Default: the same threshold curation uses to call two statements one rule. */
export const WRITE_ADMISSION_THRESHOLD = 0.85;

/**
 * Default neighbour count. Ten is the published setting of the most widely
 * deployed write-time admission (Mem0's update phase compares against the top-s
 * most similar memories, s = 10), and it is also small enough that the decision
 * stays local: a candidate is judged by what it resembles, not by the store.
 */
export const WRITE_ADMISSION_TOP_S = 10;

export type WriteAdmissionOptions = {
  /** Similarity at which a candidate is considered the same rule. In (0, 1]. */
  readonly threshold?: number;
  /** Neighbours the decision is allowed to see. A positive integer. */
  readonly topS?: number;
};

export type WriteDecision =
  | {
      readonly op: 'add';
      readonly reason: 'no-neighbour' | 'below-threshold' | 'different-payload';
      /** Closest eligible neighbour, even when it was too far to merge. */
      readonly nearest: number | null;
    }
  | { readonly op: 'update'; readonly target: KnowledgeItem; readonly similarity: number }
  | { readonly op: 'noop'; readonly target: KnowledgeItem; readonly similarity: number };

/**
 * Decide what a write should do, given what the store already holds.
 *
 * `neighbours` may contain any live or retired items from the same namespace;
 * items of another namespace or kind are ignored rather than rejected, because a
 * caller is allowed to hand over a broad retrieval and this function is where
 * tenancy and kind become hard gates. Retired items are *not* ignored: an
 * observation that revives one is a change, and `wouldChange` is the one place
 * that rule lives.
 */
export function admitWrite(
  candidate: DistillCandidate,
  neighbours: readonly WriteNeighbour[],
  policy: Policy,
  options: WriteAdmissionOptions = {},
): WriteDecision {
  const threshold = options.threshold ?? WRITE_ADMISSION_THRESHOLD;
  if (!(threshold > 0 && threshold <= 1)) {
    throw new MicrogliaError('MG_E_CONFIG', 'admission threshold must be in (0, 1]', {
      threshold,
    });
  }
  const topS = options.topS ?? WRITE_ADMISSION_TOP_S;
  if (!Number.isInteger(topS) || topS < 1) {
    throw new MicrogliaError('MG_E_CONFIG', 'admission topS must be a positive integer', {
      topS,
    });
  }

  const seen = new Set<string>();
  for (const neighbour of neighbours) {
    if (!Number.isFinite(neighbour.similarity) || neighbour.similarity < 0 || neighbour.similarity > 1) {
      throw new MicrogliaError('MG_E_CONFIG', 'neighbour similarity must be in [0, 1]', {
        id: neighbour.item.id,
        similarity: neighbour.similarity,
      });
    }
    // The same item twice would let one candidate fill the whole top-s window and
    // silently exclude the neighbour that should have been compared.
    if (seen.has(neighbour.item.id)) {
      throw new MicrogliaError('MG_E_CONFIG', 'the same neighbour was supplied twice', {
        id: neighbour.item.id,
      });
    }
    seen.add(neighbour.item.id);
  }

  const eligible = neighbours.filter(
    (neighbour) =>
      neighbour.item.namespace === candidate.namespace && neighbour.item.kind === candidate.kind,
  );
  // Ranked by similarity, then id: the decision must not depend on the order the
  // store happened to return, or two runs over one store could disagree.
  const ranked = [...eligible].sort(
    (left, right) =>
      right.similarity - left.similarity || (left.item.id < right.item.id ? -1 : 1),
  );
  const window = ranked.slice(0, topS);
  const best = window[0];
  if (best === undefined) return { op: 'add', reason: 'no-neighbour', nearest: null };
  if (best.similarity < threshold) {
    return { op: 'add', reason: 'below-threshold', nearest: best.similarity };
  }

  // A payload disagreement is a different fact that happens to share words — the
  // same reason curation keeps such a pair as two items. Merging would overwrite
  // the survivor's payload with the candidate's, so the check comes before the
  // merge question rather than after it.
  const agreeing = window.find((neighbour) =>
    jsonEqual(neighbour.item.payload ?? null, candidate.payload ?? null),
  );
  if (agreeing === undefined) {
    return { op: 'add', reason: 'different-payload', nearest: best.similarity };
  }

  // The item travels with the decision rather than its id: the caller would
  // otherwise have to look it up again, and a lookup that can fail is a branch
  // that cannot be reached — which is how a silent fall-through gets written.
  return wouldChange(agreeing.item, candidate, policy)
    ? { op: 'update', target: agreeing.item, similarity: agreeing.similarity }
    : { op: 'noop', target: agreeing.item, similarity: agreeing.similarity };
}

/**
 * Neighbours for `admitWrite`, scored lexically.
 *
 * Used by callers with no embedding index and by the distiller, whose store may
 * hold both. Lexical similarity is deliberately the fallback rather than a
 * placeholder: it is exact, deterministic and free, and the decision it feeds is
 * a threshold rather than a ranking, so a coarse score costs recall of the
 * suppression, never correctness of the store.
 */
export function neighbourhood(
  candidate: DistillCandidate,
  items: readonly KnowledgeItem[],
): readonly WriteNeighbour[] {
  return items.map((item) => ({
    item,
    similarity: diceSimilarity(candidate.statement, item.statement),
  }));
}
