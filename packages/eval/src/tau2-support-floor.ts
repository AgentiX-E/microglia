/**
 * R141 — the support floor at serve time: keep only what two tasks agreed on.
 *
 * ## What the store's own numbers said
 *
 * R139 measured a store of 70 items whose recurrence pass was finally allowed to compare every pair: 11
 * groups, **8 items corroborated by two or more tasks**, max support 4, and a bill that is now the control's
 * ($0.0958 against $0.0962). It also measured two things that decide this round:
 *
 *  - of the 21 items served over 40 requests, **every one of the three negative-net items had one task of
 *    support**, and neither of the two corroborated items that were served did;
 *  - **43 of 64 items were never served at all**, because the store is 1.75× the request population and the
 *    pack serves one item a request. An item cannot accumulate outcomes it is never handed.
 *
 * So the store holds a consensus it never uses, and the items that hurt are the ones nothing corroborates.
 * A floor on `supportTasks` is the smallest mechanism that acts on both facts at once: it is the gate ALTK's
 * `sup2`/`sup3` cells and ACE's helpfulness counters both implement, applied at the moment the memory is
 * *served* rather than the moment it is written.
 *
 * ## Why a status and not a filter
 *
 * The recall path runs in a separate process, and a filter there would be a second implementation of a rule
 * that already exists in the store's own vocabulary. Retiring an item is the vocabulary the consolidation
 * pass uses (`statusReason: consolidated:<id>`), it is reversible by re-activating, and it is legible in the
 * census a readback already reads — `store.reasons` gains one key, and `servable` falls.
 *
 * ## What it must not do
 *
 * It must not retire an item the pass just corroborated, and it must not touch an item whose support it
 * cannot read. `supportTasks` is computed by the score from evidence and travels in the sample; an item that
 * carries no evidence at all has `supportTasks` 0 by the same rule the score uses, and a floor above zero
 * retires it — which is the point, not an accident: an item no task stands behind is a claim nobody made.
 */
import type { KnowledgeItem } from '@agentix-e/microglia-core';

/** Distinct tasks behind an item, with the score's own grouping (a task once, whatever its attempts). */
function tasksOf(item: KnowledgeItem): number {
  const seen = new Set<string>();
  for (const entry of item.evidence) seen.add(entry.taskId ?? `run:${entry.runId}`);
  return seen.size;
}

export type SupportFloorResult = {
  readonly items: readonly KnowledgeItem[];
  /** Items this pass looked at, carried so the printed line and the record cannot disagree about it. */
  readonly total: number;
  /** Items retired by this pass, which is the number `store.reasons['support-floor']` grows by. */
  readonly retired: number;
  /** Items left active, which is what the recall path will see. */
  readonly retained: number;
  /** The floor this pass used, carried so an artefact cannot be read against another setting. */
  readonly floor: number;
};

/**
 * Retire every live item backed by fewer than `floor` distinct tasks.
 *
 * `floor <= 1` is a no-op rather than an error: it is the value every arm before this one ran at, and a
 * registration that names it explicitly should get the control rather than a refusal — the refusal belongs in
 * the resolver, where a misspelt value cannot be confused with a deliberate zero.
 */
export function retireBelowSupport(
  items: readonly KnowledgeItem[],
  floor: number,
  now: number,
): SupportFloorResult {
  if (!(floor > 1)) {
    return {
      items,
      total: items.length,
      retired: 0,
      retained: items.filter((item) => item.status !== 'retired').length,
      floor,
    };
  }
  let retired = 0;
  const out = items.map((item) => {
    if (item.status === 'retired') return item;
    if (tasksOf(item) >= floor) return item;
    retired += 1;
    return {
      ...item,
      status: 'retired' as const,
      statusReason: 'support-floor',
      systemUntil: now,
      updatedAt: now,
    };
  });
  return {
    items: out,
    total: items.length,
    retired,
    retained: out.filter((item) => item.status !== 'retired').length,
    floor,
  };
}

/** One line, printed whether or not the floor did anything: a zero here is a reading, not an absence. */
export function supportFloorLine(reading: SupportFloorResult): string {
  if (!(reading.floor > 1)) {
    return `support floor: off (${String(reading.retained)} item(s) servable)`;
  }
  return (
    `support floor ${String(reading.floor)}: ${String(reading.retired)} of ${String(reading.total)} item(s) ` +
    `retired for want of corroboration, ${String(reading.retained)} servable`
  );
}
