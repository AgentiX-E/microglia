/**
 * R56 — the register τ²'s distiller is asked to write in, and the ban that makes it real.
 *
 * R54 measured a store whose every item carried a condition, whose every request was served one, and
 * whose conditions shared 8.33% of the request's own terms. Reading the items says why: they were
 * written in the procedure's register. The `lesson` form's guidance asks `when` to name a property
 * "the reader can check on a different input: what the question asks for, which tables or columns it
 * involves" — correct for a database, and in a lane whose input is *"I need to cancel my pending
 * order"* there is no column to name, so the model named the tools it had called.
 *
 * The `procedure` form says the opposite in the same package, and had never been used by this lane.
 * It asks for a trigger in the question's own terms: what is being counted, compared, filtered or
 * ordered. That is a prompt instruction, and a prompt cannot enforce itself — so the ban is applied
 * on the host side, at `DistillOptions.accept`, where a candidate that names one of the nouns it was
 * learned from is refused before it can become an item.
 *
 * Two pieces of instrumentation come with it, because a treatment without a measurement is a change
 * nobody can grade: the inventory the ban reads, and the mechanical share that says whether the
 * register moved. Neither uses a model.
 */

import type { DistillCandidate } from '@agentix-e/microglia-core';
import type { DistillForm } from '@agentix-e/microglia-core/distill';

/**
 * The form this lane asks for.
 *
 * `procedure` is R56's single variable. It is a constant rather than a `TAU_*` environment read so
 * that the dispatch cannot run one form while the artefact records another, and so that a reader of
 * the code sees the treatment the registration describes.
 */
export const TAU2_DISTILL_FORM: DistillForm = 'procedure';

/**
 * Names shorter than this are not evidence of a register.
 *
 * A two-character tool name matches inside ordinary words, and a ban that refuses every candidate for
 * a reason unrelated to the register is worse than no ban: it would empty the store and be read as
 * the mechanism working. τ²'s action names (`find_user`, `cancel_pending_order`) are all longer.
 */
const MIN_TOOL_NAME = 4;

/** The action names a set of corrections used, deduplicated and ordered for a stable artefact. */
export function toolInventoryOf(
  corrections: readonly { readonly actions: readonly { readonly name: string }[] }[],
): readonly string[] {
  const names = new Set<string>();
  for (const correction of corrections) {
    for (const action of correction.actions) {
      const name = action.name.trim().toLowerCase();
      if (name.length >= MIN_TOOL_NAME) names.add(name);
    }
  }
  return [...names].sort();
}

/** Whether a sentence names one of the tools. The test R56 states: a substring match, no judge. */
export function matchesToolName(text: string, inventory: readonly string[]): boolean {
  const haystack = text.toLowerCase();
  return inventory.some((name) => haystack.includes(name));
}

export type ToolNameGuard = {
  /** `DistillOptions.accept`: true when the candidate is in the reader's register. */
  readonly accept: (candidate: DistillCandidate) => boolean;
  /** How many candidates the ban refused. The artefact carries it beside the inventory. */
  readonly refused: () => number;
};

/**
 * The host-side ban.
 *
 * Applied to both halves of a claim, because the condition is the half retrieval reads: a statement
 * in the customer's terms under a condition that names a tool is exactly the R54 defect, and the ban
 * on the statement alone would let it through.
 */
export function guardAgainstToolNames(inventory: readonly string[]): ToolNameGuard {
  let refused = 0;
  return {
    accept: (candidate) => {
      const text = candidate.when === undefined ? candidate.statement : `${candidate.when}\n${candidate.statement}`;
      if (!matchesToolName(text, inventory)) return true;
      refused += 1;
      return false;
    },
    refused: () => refused,
  };
}

export type ToolNameCensus = {
  /** Items the share is over. Every item is one observation, however many names it contains. */
  readonly measured: number;
  /** Items whose condition or statement names a tool. */
  readonly named: number;
  /**
   * `named / measured`, or `null` when the question cannot be asked — no items, or no inventory.
   *
   * Null rather than zero on purpose: a store with no items is not a store whose rules are all in the
   * reader's register, and a reading of 0% would be quoted as the ban having worked.
   */
  readonly share: number | null;
  /** Which names were found, and how many items each appeared in. */
  readonly names: Readonly<Record<string, number>>;
};

/** The register reading, over the same two fields a readback sees in `storeItems`. */
export function toolNameCensus(
  items: readonly { readonly when?: string; readonly statement: string }[],
  inventory: readonly string[],
): ToolNameCensus {
  const counts: Record<string, number> = {};
  let named = 0;
  for (const item of items) {
    const text = item.when === undefined ? item.statement : `${item.when}\n${item.statement}`;
    const hit = inventory.filter((name) => text.toLowerCase().includes(name));
    if (hit.length > 0) named += 1;
    for (const name of hit) counts[name] = (counts[name] ?? 0) + 1;
  }
  return {
    measured: items.length,
    named,
    share: items.length === 0 || inventory.length === 0 ? null : named / items.length,
    names: counts,
  };
}
