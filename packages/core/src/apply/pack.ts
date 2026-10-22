/**
 * Pack construction: retrieve, diversify, bound.
 *
 * MMR runs before the budget is applied, not after. Budgeting first would let
 * three paraphrases of one rule consume the room that a second, distinct rule
 * needed — the same failure mode as a top-k retrieval with no diversity.
 */
import { defaultPolicy, mmrSelect, queryCoverage } from '../kernel/index.js';
import type { KnowledgeItem, KnowledgePack, RecallQuery } from '../kernel/index.js';
import type { MemoryPort } from '../memory/index.js';
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
  /**
   * Minimum share of the query's content terms a rule must mention. Defaults to
   * the query's own `minCoverage`, and to no gate when neither is set.
   */
  readonly minCoverage?: number;
  /**
   * Trust at which a positive rule silences an abstention. Defaults to the
   * activation threshold, so "confident enough to inject" and "confident enough to
   * overrule a recorded absence" are the same number.
   */
  readonly absenceFloor?: number;
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

  // A scope match is not a topical match: a store returns every active rule in the
  // question's scope, including rules that share none of its words. Ranking those
  // last is not enough — they are still injected, still paid for in tokens, and
  // measured to move nothing. The coverage floor turns a weak match into no match.
  const floor = options.minCoverage ?? query.minCoverage ?? 0;
  const eligible =
    floor <= 0
      ? hits
      : hits.filter((hit) => queryCoverage(query.text, hit.item.statement) >= floor);

  const selected = mmrSelect<KnowledgeItem>(
    eligible.map((hit) => ({ item: hit.item, relevance: hit.score, text: hit.item.statement })),
    limit,
    1 - Math.min(1, Math.max(0, options.diversity ?? 0.25)),
  );

  // An abstention is not a rule: it may only speak when nothing confident can. A
  // pack that carries both tells the model "here is the convention" and "there is
  // no answer" at once, and the model resolves that contradiction by answering.
  const floorTrust = options.absenceFloor ?? defaultPolicy.activationThreshold;
  const positive = selected.filter((item) => item.kind !== 'abstention');
  const absence = selected.filter((item) => item.kind === 'abstention');
  const confident = positive.some((item) => item.trust >= floorTrust);
  const chosen =
    confident || absence.length === 0
      ? positive
      : [absence.reduce((best, item) => (item.trust > best.trust ? item : best))];

  return makePack(chosen, {
    budget,
    ...(options.tag === undefined ? {} : { tag: options.tag }),
  });
}
