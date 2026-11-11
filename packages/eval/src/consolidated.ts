/**
 * The merge arm's memory: one fold's store, folded by the product's own consolidation pass.
 *
 * ## The reading this exists for
 *
 * R81 published `active_corroborated: 0` beside `active_total: 258`. Every claim the BIRD lane's
 * store held was supported by exactly one observation, and the arm that asks for two witnesses —
 * `full-corroborated`, the product's `minEvidence` floor — was therefore going to inject an empty
 * pack on every question: `none` under a second name. The order of the two questions was wrong.
 *
 * A recurrence threshold is a question about the *finished* store ("which of these items are one
 * claim, and how many observations stand behind each?"), and no write-time rule can answer it,
 * because the rule that ran when the second item arrived did not know the third would. So the pass
 * runs over a store that has already been written, groups items that state one claim, and folds each
 * group into a survivor carrying the union of its evidence. `supportAfter` is what the merge bought;
 * `crossTaskGroups` is how much of it was corroboration rather than one failure stated twice.
 *
 * ## Why a copy
 *
 * `full` reads the store the distiller wrote. A pass applied to that store would change what `full`
 * means from the position it ran at, and the two arms would then differ in the order their questions
 * arrived rather than in what they inject. The copy is the comparison — and the tests below hold the
 * source store to being untouched, because a comparison whose control moved is not a comparison.
 *
 * ## Why the clock is not the wall clock
 *
 * Every item this lane writes is stamped by a stepping clock started at a fixed instant, and the
 * pass writes `updatedAt: <now>` into each survivor and each item it retires. Passing the wall clock
 * would project a store built on one timeline into another: the artefact would date the merge nine
 * years after the store it merged, and that number would belong to the dispatch rather than to the
 * pass. `now` is therefore the latest write the store actually holds.
 *
 * Nothing is deleted. The pass retires what it absorbed and names the survivor in `statusReason`
 * (`consolidated:<id>`), so a recall no longer sees the absorbed item while the record of the merge
 * stays in the store.
 */
import { defaultPolicy, mulberry32, steppingClock } from '@agentix-e/microglia-core';
import { openMicroglia } from '@agentix-e/microglia-core/capture';
import { consolidateKnowledge, type ConsolidationCensus } from '@agentix-e/microglia-core/distill';
import { EmbeddedMemory, MemoryJournal } from '@agentix-e/microglia-core/memory';

/**
 * The fields two compared memories have to share.
 *
 * Stated as a value rather than repeated at each `openMicroglia` call: every field that differed
 * between the control memory and the merged one would be reported as the merge's doing. The random
 * source is deliberately *not* here — it is built per memory from the run's seed, because two
 * memories drawing from one generator would hand the second arm a different sample than the first
 * for a reason that is not the arm.
 */
export type MemoryShape = {
  readonly app: string;
  readonly namespace: string;
  /** Characters of knowledge a pack may carry, which is the dose both arms are held to. */
  readonly budget: number;
  /** The instant the lane's stepping clock starts from. */
  readonly clockStart: number;
};

export type ConsolidatedMemory = {
  readonly store: EmbeddedMemory;
  readonly host: Awaited<ReturnType<typeof openMicroglia>>;
  /** The pass's census, which is the manipulation check for the arm that reads this store. */
  readonly report: ConsolidationCensus;
  /** Items the copy began with — the population the census is a census of. */
  readonly written: number;
};

/**
 * Fold `source`'s claims into a second memory, leaving `source` exactly as it was.
 *
 * The floors are the pass's own defaults rather than arguments: they were calibrated on this
 * project's registers (containment 0.60 sits between a measured true pair at 0.700 and the closest
 * non-repeat at 0.533), and a floor chosen by a lane is a floor nobody can test. The report carries
 * the values that were used, so an artefact states the pass it ran rather than the pass it meant.
 */
export async function consolidatedMemoryOf(
  source: EmbeddedMemory,
  shape: MemoryShape,
  seed: number,
): Promise<ConsolidatedMemory> {
  const written = await source.listKnowledge({});
  const now = written.reduce((latest, item) => Math.max(latest, item.updatedAt), 0);
  const pass = consolidateKnowledge(written, { now, policy: defaultPolicy });
  const store = await EmbeddedMemory.open(new MemoryJournal());
  for (const item of pass.items) await store.putKnowledge(item);
  const host = await openMicroglia({
    app: shape.app,
    namespace: shape.namespace,
    store,
    budget: shape.budget,
    clock: steppingClock(shape.clockStart, 1),
    random: mulberry32(seed),
  });
  return { store, host, report: pass.report, written: written.length };
}
