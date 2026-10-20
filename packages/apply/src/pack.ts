/**
 * Pack construction: retrieve, diversify, bound.
 *
 * MMR runs before the budget is applied, not after. Budgeting first would let
 * three paraphrases of one rule consume the room that a second, distinct rule
 * needed — the same failure mode as a top-k retrieval with no diversity.
 */
import { mmrSelect } from '@agentix-e/microglia-core';
import type { KnowledgeItem, KnowledgePack, RecallQuery } from '@agentix-e/microglia-core';
import type { MemoryPort } from '@agentix-e/microglia-memory';
import { makePack } from './render.js';

export type BuildPackOptions = {
  readonly memory: MemoryPort;
  readonly budget?: number;
  /** Candidates considered before MMR; the cap bounds worst-case latency. */
  readonly candidates?: number;
  /** Items kept after MMR, before the character budget. */
  readonly limit?: number;
  /**
   * MMR weight on redundancy, in [0, 1]. Zero disables diversification and ranks
   * by relevance alone, which is exactly the ablation the study runs to measure
   * what diversity contributes.
   */
  readonly diversity?: number;
  readonly tag?: string;
};

export async function buildPack(
  query: RecallQuery,
  options: BuildPackOptions,
): Promise<KnowledgePack> {
  const budget = options.budget ?? query.budget ?? 1200;
  const limit = options.limit ?? query.limit ?? 8;
  const hits = await options.memory.search({
    ...query,
    limit: options.candidates ?? Math.max(limit * 3, 12),
  });

  const selected = mmrSelect<KnowledgeItem>(
    hits.map((hit) => ({ item: hit.item, relevance: hit.score, text: hit.item.statement })),
    limit,
    1 - Math.min(1, Math.max(0, options.diversity ?? 0.25)),
  );

  return makePack(selected, {
    budget,
    ...(options.tag === undefined ? {} : { tag: options.tag }),
  });
}
