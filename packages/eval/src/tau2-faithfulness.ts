/**
 * R85 — the half of the memory tax this lane could not see: what was destroyed at write time.
 *
 * `Memory Tax` (UIUC / Tsinghua / RUC) splits a memory system's net value into two failures and names
 * them: **faithfulness** — the detail was destroyed when the memory was written — and
 * **accessibility** — the detail survived and the retriever never served it. It measures the first by
 * checking 500 raw turns against what the store retained: `OpenViking` kept 39.4% intact and could not
 * find 38.0% at all, `SimpleMem` kept 65.6%, `Memory-R2` 72.6%.
 *
 * Every instrument in this repository measures the second. `asked`, `dropped`, `served`,
 * `store.active`, the pack's coverage, the funnel — all of them describe the route from a stored item
 * to a prompt, and every one of them reads the same whether the item was written perfectly or written
 * with the order id removed. Six nulls on this lane were read as six different stories about
 * retrieval; two of them may be one story about writing, and nothing here could tell them apart.
 *
 * This module is that telling, and it is model-free: for each correction, the entity strings its own
 * recorded calls carried — the order ids, the item ids, the amounts — and whether the text the store
 * kept for that correction still contains them. No judgement, no threshold, no model call. The number
 * is a property of the write, and it can be recomputed from any artefact that carries per-trial
 * corrections beside item evidence.
 *
 * ## Three decisions
 *
 * **An entity is a value, not a word.** Argument values, three characters or longer, deduplicated
 * within one correction: a value that appears twice is one thing to preserve. Strings longer than 64
 * characters are excluded, because a sentence pasted into an argument is prose and counting it would
 * make every long statement look faithful.
 *
 * **The denominator is entities, and the population is stated.** A correction with no argument values
 * contributes nothing and is counted separately, so a rate over four corrections out of fifteen cannot
 * be read as a rate over fifteen. This is the rule `holdRate` follows for pairs, for the same reason.
 *
 * **A correction whose item was written from *another* correction's run counts as lost.** The join is
 * the evidence's own `runId`, and a store that answers a correction with an item that cites a different
 * one has not preserved it — it has replaced it. That is a real reading and not an artefact of the
 * join: it is exactly what a distiller that merges aggressively does.
 */
import type { Json } from '@agentix-e/microglia-core';

/** Argument values shorter than this are not entities: `1`, `-`, `no` carry no identity. */
export const ENTITY_MIN_CHARS = 3;

/** Argument values longer than this are prose pasted into a field, not entities. */
export const ENTITY_MAX_CHARS = 64;

export type FaithfulnessCensus = {
  /** Corrections that carried at least one entity, which is the population the rate is over. */
  readonly corrections: number;
  /** Corrections that carried none, counted so the denominator cannot be read as the whole corpus. */
  readonly withoutEntities: number;
  /** Distinct entity strings the corrections stated. */
  readonly entities: number;
  /** Entities still present in the text the store kept for that correction. */
  readonly kept: number;
  /** Corrections whose every entity survived. */
  readonly whole: number;
  /**
   * Corrections with entities that the store never answered **because the store was empty**.
   *
   * Zero whenever the store held at least one item. This is the counter that keeps a store nobody
   * wrote from being read as a writer that destroyed everything: with no items there is no text to
   * contain an entity, so every entity would "fail" and the rate would be `0 of 15 kept (0.0%)` --
   * which is what a dispatch whose distiller faulted eleven times out of fifteen actually printed.
   */
  readonly unwritten: number;
};

/** One string, when it is an identity rather than prose, from a value of any JSON shape. */
function entityValues(value: Json): readonly string[] {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length >= ENTITY_MIN_CHARS && trimmed.length <= ENTITY_MAX_CHARS ? [trimmed] : [];
  }
  if (typeof value === 'number' && Number.isFinite(value)) return [String(value)];
  if (Array.isArray(value)) return value.flatMap((entry) => entityValues(entry));
  return [];
}

/**
 * The entity strings one correction's calls carried, deduplicated in the order they were stated.
 *
 * Exported because the driver stamps them onto the capture row, and a test that had to build a
 * correction to assert this would be testing the τ² parser rather than the definition.
 */
export function entitiesOf(
  actions: readonly { readonly arguments: Record<string, Json> }[],
): readonly string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const action of actions) {
    for (const value of Object.values(action.arguments)) {
      for (const entity of entityValues(value)) {
        // Case-folded for the set, because a store that writes `w237` for `W237` has preserved the
        // identity; the string kept for matching is the first spelling that was stated.
        const key = entity.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(entity);
      }
    }
  }
  return out;
}

export type FaithfulnessRow = {
  /** The capture run this correction wrote, which is what an item's evidence cites. */
  readonly runId: string;
  readonly entities: readonly string[];
};

export type FaithfulnessItem = {
  readonly statement: string;
  /** The trigger, when the item states one: a claim's condition is part of what it kept. */
  readonly condition?: string;
  readonly evidence: readonly { readonly runId: string }[];
};

/**
 * How much of each correction's own detail survived into the text the store keeps for it.
 *
 * `undefined` when no correction carried an entity, which is a different fact from `0 of 0`: a corpus
 * with nothing to preserve cannot be found unfaithful, and reporting `1.0` for it would make an
 * entity-free lane look like a perfect writer.
 */
export function faithfulnessOf(
  rows: readonly FaithfulnessRow[],
  items: readonly FaithfulnessItem[],
): FaithfulnessCensus | undefined {
  const textByRun = new Map<string, string>();
  for (const item of items) {
    const text = `${item.statement}\n${item.condition ?? ''}`.toLowerCase();
    for (const evidence of item.evidence) {
      textByRun.set(evidence.runId, `${textByRun.get(evidence.runId) ?? ''}\n${text}`);
    }
  }
  // Whether any write happened at all. This is a property of the store rather than of a correction,
  // and it is the only thing that can tell "the writer destroyed the detail" from "the writer never
  // ran": per correction the two look identical, because a run with no item citing it and a run whose
  // item was replaced by a merge both leave an empty text.
  const storeEmpty = items.length === 0;
  let corrections = 0;
  let withoutEntities = 0;
  let entities = 0;
  let kept = 0;
  let whole = 0;
  let unwritten = 0;
  for (const row of rows) {
    if (row.entities.length === 0) {
      withoutEntities += 1;
      continue;
    }
    corrections += 1;
    const text = textByRun.get(row.runId) ?? '';
    let here = 0;
    for (const entity of row.entities) {
      entities += 1;
      if (text.includes(entity.toLowerCase())) {
        kept += 1;
        here += 1;
      }
    }
    if (storeEmpty) unwritten += 1;
    if (here === row.entities.length) whole += 1;
  }
  if (corrections === 0) return undefined;
  return { corrections, withoutEntities, entities, kept, whole, unwritten };
}

/**
 * The kept share, or `undefined` when nothing was there to keep -- or nothing was written at all.
 *
 * The second absence is the one worth stating: a rate over a store no write reached is not zero, it is
 * missing, and a `0.0` there is indistinguishable from a writer that strips every identity it is given.
 */
export function faithfulnessRate(census: FaithfulnessCensus | undefined): number | undefined {
  if (census === undefined || census.entities === 0) return undefined;
  // `> 0` is load-bearing: with no correction carrying an entity, `corrections` is 0 and `unwritten`
  // is 0, so the equality holds on a population that has nothing to do with an empty store. That
  // collapse made "this corpus had no entity" read as "no write reached the store".
  if (census.unwritten > 0 && census.unwritten === census.corrections) return undefined;
  return census.kept / census.entities;
}

/** One line for the run's log, phrased so a zero and an absence read differently. */
export function faithfulnessLine(census: FaithfulnessCensus | undefined): string {
  if (census === undefined) {
    return 'faithfulness: absent (no correction carried an argument value)';
  }
  if (census.unwritten > 0 && census.unwritten === census.corrections) {
    return (
      `faithfulness: no measurement -- ${String(census.entities)} entity(ies) in ` +
      `${String(census.corrections)} correction(s) never reached the store`
    );
  }
  if (census.entities === 0) {
    // The correction(s) reached the store and none of them carried an argument value, so there is no
    // denominator. A `0 of 0 (0.0%)` here would be the third time this module printed an absence as a
    // zero, and this one was found by a coverage row rather than by a run: the `?? 0` below it was
    // unreachable for exactly the input that needed a sentence of its own.
    return `faithfulness: absent (${String(census.withoutEntities)} correction(s) carried no argument value)`;
  }
  // Both guards above are what make this division total: the store answered at least one correction and
  // at least one entity value exists, so there is no `?? 0` left to hide a missing denominator behind.
  const rate = census.kept / census.entities;
  return (
    `faithfulness: ${String(census.kept)} of ${String(census.entities)} entity(ies) kept ` +
    `(${(rate * 100).toFixed(1)}%), whole in ${String(census.whole)} of ` +
    `${String(census.corrections)} correction(s), ${String(census.withoutEntities)} with none to keep`
  );
}
