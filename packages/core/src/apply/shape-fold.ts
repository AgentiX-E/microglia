/**
 * The unit the model sees, when a host asks for one line per routine instead of one per failure.
 *
 * R99's store held 73 records and its own census said what they were: **53 action shapes, 30
 * mergeable, 10 taught by two tasks, 5 by three**. The supply was therefore not 73 independent facts.
 * It was 53 routines, five of them taught three separate times — and the pack could not say so,
 * because one correction makes one record and the dedupe key is the normalized statement. Two
 * failures of one shape differ in the order id, the item ids and the gift-card id, which is every
 * token a statement key reads.
 *
 * That support level is the cell the SOTA holder's `sup3` is built on, and no arm in this record can
 * produce an item three tasks agreed on. This module is the delivery-boundary answer to it: a pure
 * function over the pack the recall already produced, so the same store serves both the per-failure
 * and the collapsed arm of one experiment.
 *
 * ## Where the fold belongs, and why not the other two places
 *
 * The store cannot express `support`, and there are three places that could change that. Only one of
 * them changes one thing (ROADMAP R109's decision table):
 *
 * | where | what it changes |
 * |---|---|
 * | write path — supersede an item, union its evidence | the store's *contents*, so a comparison against today's store differs in two places |
 * | distillation — one call per shape | the statement is written from one representative, discarding the others (the laundering R99 already paid for) |
 * | **delivery — collapse same-shape items in the pack** | **the unit the model sees, and nothing else** |
 *
 * Delivery also has the property the other two lack: it is reversible per request, which is what lets
 * one dispatch carry both arms over one store.
 *
 * ## Four decisions, each of which a cheaper version gets wrong
 *
 * **A shape is the ordered list of tool names, and the `kind` joins the key.** The arguments are the
 * instance; the sequence is the routine, which is the unit AWM calls a workflow. Two items of
 * different kinds are never folded together even when they call the same routine: a `negative` and an
 * `exemplar` over one tool sequence assert opposite things, and folding them would silently invert
 * one of them into the other's support.
 *
 * **A group folds only when at least two distinct tasks taught it.** Folding two records of one task
 * produces no support — it produces a task that appears to have been taught twice — and support is
 * the entire reason this exists. The floor is therefore in tasks and not in members, and it is the
 * same quantity ALTK's `sup2` and `sup3` cells are counted in.
 *
 * **The survivor is the group's medoid and its statement is copied, never rewritten.** Containment
 * over content terms, the same measure the consolidator uses to decide whether two claims are one
 * claim — one definition, because a second copy would drift. Ties go to the earliest-ranked member,
 * so the fold cannot promote an item the ranking placed lower on evidence the ranking never read. The
 * claim is the member's own sentence: a merge that paraphrases is the operation ACE measured as
 * **brevity bias, −9.6 points**, and a fold that rewrote its survivors would be that experiment.
 *
 * **Nothing else about the item changes, and the union of evidence is not written back.** Support is
 * *reported* — `ShapeFold.support`, and one row per folded group — rather than attached to the
 * survivor. A pack whose items carried invented evidence trails would be a pack a ledger could not
 * join back to the store, and this project has already paid once for a record that cited a
 * corroboration no task contributed to.
 */
import type { FoldedGroup, KnowledgeItem, ShapeFold, ShapeMode } from '../kernel/index.js';
import { claimContainment, claimTokens } from '../distill/consolidate.js';

/**
 * The fold's types live in `kernel/types.ts`, beside the pack they are a field of; this module is the
 * policy over them and re-exports them so a caller that has the function has the vocabulary.
 */
export type { FoldSupport, FoldedGroup, ShapeFold, ShapeMode } from '../kernel/index.js';

/**
 * Distinct tasks a group needs before it may fold. Two, because one task is not corroboration.
 *
 * Not a parameter of the mode: an arm that folded at three would be measuring the fold *and* a support
 * floor, which is the two-variable arm this project keeps refusing. The types themselves live in
 * `kernel/types.ts`, beside the pack they are a field of.
 */
export const DEFAULT_FOLD_SUPPORT = 2;

export type ShapeFoldOptions = {
  /** `collapse` folds; `per-failure` reads the pack as it is and reports the same census. */
  readonly mode: ShapeMode;
  /**
   * The routine an item states, or `undefined` when it states none.
   *
   * Injected rather than derived here, because the shape of a record is the lane's own vocabulary:
   * this module has no business knowing that a τ² record writes its calls on an `A:` line. An item
   * this function cannot name is never folded — it is its own unit, which is the honest reading of a
   * record that states no routine.
   */
  readonly shapeOf?: (item: KnowledgeItem) => string | undefined;
  /** Distinct tasks a group needs. Defaults to `DEFAULT_FOLD_SUPPORT`; never below two. */
  readonly minSupport?: number;
};

/** Distinct tasks behind one item. The same rule the consolidator counts, so the two agree. */
function tasksOf(item: KnowledgeItem): Set<string> {
  const seen = new Set<string>();
  for (const entry of item.evidence) seen.add(entry.taskId ?? `run:${entry.runId}`);
  return seen;
}

/**
 * The member closest to the group's centre, by containment over content terms.
 *
 * Mean pairwise containment rather than the longest or the most confident: the survivor is the one
 * whose claim the others restate, and the measure is the consolidator's own. Ties keep the first
 * member, which is the earliest-ranked one.
 */
function medoidOf(members: readonly KnowledgeItem[]): KnowledgeItem {
  const terms = members.map((member) => claimTokens(member.statement));
  let best = members[0] as KnowledgeItem;
  let bestScore = -1;
  for (let index = 0; index < members.length; index += 1) {
    let total = 0;
    for (let other = 0; other < members.length; other += 1) {
      if (other === index) continue;
      total += claimContainment(terms[index] as ReadonlySet<string>, terms[other] as ReadonlySet<string>);
    }
    // A single-member group never reaches this function; the divisor is therefore non-zero.
    const score = total / (members.length - 1);
    if (score > bestScore) {
      best = members[index] as KnowledgeItem;
      bestScore = score;
    }
  }
  return best;
}

/** The shape an item states, or `undefined` when it states none this host can name. */
function shapeKeyOf(item: KnowledgeItem, shapeOf?: (item: KnowledgeItem) => string | undefined): string | undefined {
  const shape = shapeOf?.(item)?.trim();
  if (shape === undefined || shape === '') return undefined;
  // The kind is part of the key and not of the reported shape: `negative` and `exemplar` never fold
  // together, and a reader still sees one routine rather than `exemplar:a > b`.
  return `${item.kind}\u0000${shape}`;
}

/**
 * Fold a pack's items by the routine they state.
 *
 * Deterministic and order-preserving: the survivor of a group sits where its earliest member sat, no
 * item is re-ranked, and two runs over one pack produce one fold. The only thing the caller can
 * observe differently is which lines the block carries.
 */
export function foldByShape(
  items: readonly KnowledgeItem[],
  options: ShapeFoldOptions,
): ShapeFold {
  const minSupport = Math.max(DEFAULT_FOLD_SUPPORT, Math.trunc(options.minSupport ?? DEFAULT_FOLD_SUPPORT));

  const buckets = new Map<string, KnowledgeItem[]>();
  const keyOf = items.map((item) => shapeKeyOf(item, options.shapeOf));
  items.forEach((item, index) => {
    const key = keyOf[index];
    if (key === undefined) return;
    const bucket = buckets.get(key);
    if (bucket === undefined) buckets.set(key, [item]);
    else bucket.push(item);
  });

  // Which member each group keeps, and what the unit it survives as can claim.
  //
  // `unitSupport` is the support of a *rendered line*, not of a group: a group's union belongs to the
  // survivor that stands for it, and applying it to every member would report `atLeastTwo: 2` on a
  // per-failure pack of two single-task records — the one number this whole arm is about, inflated by
  // the arithmetic rather than by the store.
  const keep = new Set<string>();
  const foldedKeys = new Set<string>();
  const unitSupport = new Map<string, number>();
  const groups: FoldedGroup[] = [];
  let refused = 0;
  for (const [key, members] of buckets) {
    const tasks = new Set<string>();
    for (const member of members) for (const task of tasksOf(member)) tasks.add(task);
    const support = tasks.size;
    const folds = options.mode === 'collapse' && members.length > 1 && support >= minSupport;
    if (folds) {
      const survivor = medoidOf(members);
      keep.add(survivor.id);
      foldedKeys.add(key);
      unitSupport.set(survivor.id, support);
      groups.push({
        shape: key.slice(key.indexOf('\u0000') + 1),
        kept: survivor.id,
        members: members.map((member) => member.id),
        support,
      });
    } else if (members.length > 1 && support < minSupport) {
      refused += 1;
    }
  }
  for (const item of items) if (!unitSupport.has(item.id)) unitSupport.set(item.id, tasksOf(item).size);

  // One pass over the caller's array, keeping the survivors in place. Nothing is sorted and nothing is
  // re-ranked: the survivor of a group occupies the position its earliest member occupied, so the
  // only observable difference is which lines the block carries.
  const kept = items.filter((item, index) => {
    const key = keyOf[index];
    if (key === undefined || !foldedKeys.has(key)) return true;
    return keep.has(item.id);
  });

  let max = 0;
  let atLeastTwo = 0;
  let atLeastThree = 0;
  for (const item of kept) {
    // Every kept item has an entry: the map is filled for all of them three lines above, and a fallback
    // here would be a branch no input can reach — the same construction `consolidate.ts` uses for the
    // trigger-word map. A default of zero would also be a lie about a unit whose support was measured.
    const support = unitSupport.get(item.id) as number;
    if (support > max) max = support;
    if (support >= 2) atLeastTwo += 1;
    if (support >= 3) atLeastThree += 1;
  }

  return {
    items: kept,
    folded: items.length - kept.length,
    groups,
    refused,
    support: { max, atLeastTwo, atLeastThree },
  };
}
