/**
 * Pack construction: retrieve, diversify, bound.
 *
 * MMR runs before the budget is applied, not after. Budgeting first would let
 * three paraphrases of one rule consume the room that a second, distinct rule
 * needed — the same failure mode as a top-k retrieval with no diversity.
 */
import { defaultPolicy, mmrSelect, queryCoverage, recallText } from '../kernel/index.js';
import type { KnowledgeItem, KnowledgePack, RecallQuery } from '../kernel/index.js';
import type { MemoryPort } from '../memory/index.js';
import { SERVING_DEFAULTS } from '../memory/serving.js';
import { emptyPack, makePack, type NoteMode } from './render.js';
import { foldByShape, type ShapeFold, type ShapeMode } from './shape-fold.js';
import { decideSpeak, suppressionOf } from './speak.js';

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
  /** The sentence the block opens with; see `NoteMode`. Absent means `standard`. */
  readonly note?: NoteMode;
  /**
   * What the budget is charged for; see `RenderOptions.budgetBasis`.
   *
   * Absent means `note-included`, the accounting every published number was produced under. A
   * dispatch that varies the note must declare `note-excluded`, because otherwise the longer
   * sentence displaces the last rule and the arms differ in their packs as well as their wording.
   */
  readonly budgetBasis?: 'note-included' | 'note-excluded';
  /**
   * The unit the pack renders: one line per failure, or one line per routine.
   *
   * Absent means `per-failure`, which is what every committed artefact measured, so a caller that never
   * heard of this option renders the pack it always rendered. `collapse` folds same-shape items at the
   * render boundary and changes nothing else — see `foldByShape` for what a shape is, why the fold
   * needs two distinct tasks, and why the survivor's statement is copied rather than rewritten.
   *
   * The switch is per request rather than per host because that is what lets one dispatch carry both
   * arms over one store: the same recall, the same ranking, the same budget, one line different.
   */
  readonly shape?: ShapeMode;
  /**
   * The routine an item states, when the host can name one.
   *
   * Absent means the host has no vocabulary for shapes: the pack carries no `fold` census at all, which
   * is the honest reading of a host that never asked, and it is what keeps every existing caller's
   * packs byte-identical.
   */
  readonly shapeOf?: (item: KnowledgeItem) => string | undefined;
  /**
   * How far ahead of its runner-up the best candidate must be for the pack to speak at all.
   *
   * Zero — the default — speaks on every non-empty pack, which is the behaviour every committed
   * artefact measured. A positive value withholds the pack when the store's top two candidates are
   * closer together than this, because a store that holds several answers and prefers none of them
   * has not decided what to teach. See `decideSpeak` for why a relevance floor cannot express this
   * question: on the same 650 pairs the retention curve falls off a cliff at 0.15, serving 75 of 162
   * requests, so a floor withholds half the traffic or none of it and never the contested half.
   */
  readonly speakMargin?: number;
  /**
   * Whether the pack records the decision it made, in `pack.decision`.
   *
   * An observer: the rendered bytes, the ids and the fingerprint are identical with this on and off,
   * which `__tests__/speak.test.ts` pins. Absent means the pack carries no census, so every pack
   * written before this option existed is unchanged.
   */
  readonly decision?: boolean;
};

export async function buildPack(
  query: RecallQuery,
  options: BuildPackOptions,
): Promise<KnowledgePack> {
  const budget = options.budget ?? query.budget ?? 1200;
  // R236. The default is the manifest's line budget rather than a literal: the block the evaluation measured spends
  // eight lines, and a product that spends another number is a product the published number does not describe.
  const limit = options.limit ?? query.limit ?? SERVING_DEFAULTS.blockLines;
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
      : hits.filter((hit) => queryCoverage(query.text, recallText(hit.item)) >= floor);
  // Corroboration is a different question from relevance, and it is asked before MMR:
  // a rule with one observation should not occupy a slot that a corroborated rule
  // could have filled.
  const minEvidence = Math.max(1, Math.trunc(options.minEvidence ?? query.minEvidence ?? 1));
  const eligible =
    minEvidence <= 1
      ? byRelevance
      : byRelevance.filter((hit) => hit.item.evidence.length >= minEvidence);

  const selected = mmrSelect<KnowledgeItem>(
    eligible.map((hit) => ({ item: hit.item, relevance: hit.score, text: recallText(hit.item) })),
    limit,
    1 - Math.min(1, Math.max(0, options.diversity ?? 0.25)),
  );

  // Whether to speak is asked before what to say, and over the candidates rather than over the pack:
  // `limit` is the host's room, so a small budget must not be able to manufacture a leader. The census
  // is computed on both settings of `text` — the reduction is pure and cheap — and recorded only when
  // the host asked to see it.
  const decision = decideSpeak({
    candidates: hits.length,
    afterCoverage: byRelevance.length,
    afterEvidence: eligible.length,
    selected: selected.length,
    scores: eligible.map((hit) => hit.score),
    speakMargin: Math.max(0, options.speakMargin ?? 0),
  });
  if (!decision.spoke) {
    const suppression = suppressionOf(decision.silentBecause);
    return {
      ...emptyPack(budget),
      ...(suppression === undefined ? {} : { suppressed: suppression }),
      ...(options.decision === true ? { decision } : {}),
    };
  }

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

  // The fold is the last thing that happens to the selection: one line per routine instead of one per
  // failure, with every other decision — which rules, what order, how much room — already made.
  const fold = foldOf(chosen, options, query);
  const pack = makePack(
    fold?.items ?? chosen,
    {
      budget,
      ...(options.tag === undefined ? {} : { tag: options.tag }),
      ...(options.note === undefined ? {} : { note: options.note }),
      ...(options.budgetBasis === undefined ? {} : { budgetBasis: options.budgetBasis }),
    },
    fold,
  );
  return options.decision === true ? { ...pack, decision } : pack;
}

/**
 * The fold, or nothing when the host cannot name a shape.
 *
 * `per-failure` still computes the census — a control that reports `atLeastTwo: 0` on its own pack is a
 * reading, and the alternative is an arm whose field exists only where the treatment is. The items it
 * returns are the items it was given, in order.
 */
function foldOf(
  items: readonly KnowledgeItem[],
  options: BuildPackOptions,
  query: RecallQuery,
): ShapeFold | undefined {
  const { shapeOf } = options;
  if (shapeOf === undefined) return undefined;
  // The option wins over the query, as `budget` and `limit` do: an option is the host's decision about
  // this pack, and the query is a request that a host without the option would still honour.
  return foldByShape(items, { mode: options.shape ?? query.shape ?? 'per-failure', shapeOf });
}
