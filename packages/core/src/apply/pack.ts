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
   * Independent corrections a rule needs before it may be injected. Default 1.
   *
   * The pack layer already decides what is *relevant* (`minCoverage`) and what the
   * model can be shown safely; this decides what has been *observed enough*. It is a
   * separate question, and on the two workloads measured here it has a large answer:
   *
   *  - BIRD Mini-Dev (350 questions, 5 folds): every one of 1,296 distilled rules came
   *    from a single correction, so a floor of 2 injects nothing - and the mechanism's
   *    cost (-2 to -4pp) goes to zero with it.
   *  - The chart study (recurring defects): the same floor keeps 96.43% of 100.00%,
   *    so requiring a second observation costs 3.57pp of a 68.21pp lift.
   *
   * A host chooses which of those two worlds it is in; the default stays 1 so no
   * existing caller changes behaviour on an upgrade.
   */
  readonly minEvidence?: number;
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
  const byRelevance =
    floor <= 0
      ? hits
      : hits.filter((hit) => queryCoverage(query.text, hit.item.statement) >= floor);
  // Corroboration is a different question from relevance, and it is asked before MMR:
  // a rule with one observation should not occupy a slot that a corroborated rule
  // could have filled.
  const minEvidence = Math.max(1, Math.trunc(options.minEvidence ?? query.minEvidence ?? 1));
  const eligible =
    minEvidence <= 1
      ? byRelevance
      : byRelevance.filter((hit) => hit.item.evidence.length >= minEvidence);

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
