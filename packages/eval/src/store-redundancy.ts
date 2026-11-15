/**
 * How much of a store is a restatement of another part of it.
 *
 * R120. The store this lane writes is one item per correction, `supportTasks: 1` on every one of them,
 * and the dedupe key is the normalized statement. Nothing has ever said *how much* repetition that
 * leaves behind, so "the memory is redundant" has been an impression rather than a number, and the
 * question the user of a memory system actually asks — how many distinct things does this store know —
 * had no instrument.
 *
 * It is measured with the consolidator's own key and no other. `claimTokens` and `claimContainment` are
 * imported from `distill/consolidate.ts` rather than re-derived, because a second implementation of
 * "two claims are one claim" would drift from the pass that acts on it, and the census and the pass
 * would then disagree about the same store — which is the defect R120 spent a round fixing in the fold.
 *
 * ## Three decisions
 *
 * **Transitive closure, not a greedy pass.** `consolidateKnowledge` merges in rank order and stops when
 * a group's survivor has absorbed its neighbours; this census asks a different question — *how many
 * distinct claims does the store contain* — so pairs above the floor are closed transitively. The two
 * numbers are not meant to be equal: this one is an upper bound on what any single ordered pass reaches,
 * and it is the bound a reader needs before deciding whether a pass is worth a dispatch.
 *
 * **A floor, stated and defaulted to the pass's own.** 0.60 is the number R58 measured between the closest
 * true repeat (0.700) and the closest non-repeat (0.533) of a real store; a census at any other floor is
 * a different claim, so the floor travels in the census.
 *
 * **A clipped sample is declared, because clipping inflates the number.** These statements are read from
 * an artefact, which truncates each at a fixed width. Two claims cut at the same prefix share that prefix,
 * so containment rises and the redundancy reading rises with it. The count of clipped inputs is passed
 * through and the line says so, because a reading that cannot be trusted to be tight must not be quoted
 * as though it were.
 */
import { claimContainment, claimTokens } from '@agentix-e/microglia-core/distill';

/** R58's measured floor: above the closest non-repeat and below the closest true repeat. */
export const REDUNDANCY_FLOOR = 0.6;

export type RedundancyCensus = {
  /** Statements the census was taken over — the population, stated so a sample cannot stand in for a store. */
  readonly statements: number;
  /** All pairs compared. `statements·(statements−1)/2`, carried so a zero can be checked. */
  readonly pairs: number;
  /** Pairs at or above the floor. */
  readonly joined: number;
  /** Connected components: the claims the store actually contains, by this key. */
  readonly groups: number;
  /** `1 − groups/statements`: the share of the store that restates another part of it. */
  readonly redundancy: number;
  /** The largest component, which is the claim the store repeated most. */
  readonly largest: number;
  readonly floor: number;
  /** Inputs the caller clipped before handing them over. Non-zero makes the reading an upper bound. */
  readonly truncated: number;
};

/** A statement and whether the caller had to clip it to get here. */
export type RedundancyInput = { readonly statement: string; readonly clipped?: boolean };

/**
 * The distinct claims in a set of statements, by the consolidator's key.
 *
 * Empty and single-statement inputs answer a census of their own rather than `undefined`: a store of one
 * item is a store with exactly one claim and no repetition, which is a finding, and an absence here would
 * make it indistinguishable from a store nobody measured.
 */
export function storeRedundancy(
  input: readonly (string | RedundancyInput)[],
  options: { readonly floor?: number } = {},
): RedundancyCensus {
  const floor = options.floor ?? REDUNDANCY_FLOOR;
  if (!(floor > 0 && floor <= 1)) {
    throw new Error(`${String(floor)} is not a containment floor: it must be in (0, 1]`);
  }
  const rows = input.map((entry) => (typeof entry === 'string' ? { statement: entry, clipped: false } : entry));
  const terms = rows.map((row) => claimTokens(row.statement));
  const parent = rows.map((_, index) => index);
  const find = (start: number): number => {
    let node = start;
    while (parent[node] !== node) {
      parent[node] = parent[parent[node] as number] as number;
      node = parent[node] as number;
    }
    return node;
  };

  let pairs = 0;
  let joined = 0;
  for (let left = 0; left < rows.length; left += 1) {
    for (let right = left + 1; right < rows.length; right += 1) {
      pairs += 1;
      if (claimContainment(terms[left] as ReadonlySet<string>, terms[right] as ReadonlySet<string>) < floor) continue;
      joined += 1;
      const a = find(left);
      const b = find(right);
      if (a !== b) parent[a] = b;
    }
  }

  const sizes = new Map<number, number>();
  for (let index = 0; index < rows.length; index += 1) {
    const root = find(index);
    sizes.set(root, (sizes.get(root) ?? 0) + 1);
  }
  const groups = sizes.size;
  return {
    statements: rows.length,
    pairs,
    joined,
    groups,
    redundancy: rows.length === 0 ? 0 : 1 - groups / rows.length,
    largest: sizes.size === 0 ? 0 : Math.max(...sizes.values()),
    floor,
    truncated: rows.filter((row) => row.clipped === true).length,
  };
}

/**
 * One line for a readback.
 *
 * The caveat comes last and only when it applies: a clipped sample's redundancy is an upper bound, and a
 * reader who quotes the number without the sentence would be quoting a bound as a measurement.
 */
export function redundancyLine(census: RedundancyCensus): string {
  const head =
    `redundancy: ${String(census.statements)} statement(s), ${String(census.groups)} distinct claim(s) ` +
    `(${(census.redundancy * 100).toFixed(1)}% restated), largest ${String(census.largest)}, ` +
    `${String(census.joined)} of ${String(census.pairs)} pair(s) at or above ${census.floor.toFixed(2)}`;
  return census.truncated === 0
    ? head
    : `${head}; ${String(census.truncated)} input(s) were clipped, so this is an upper bound`;
}

/**
 * The census over a `storeItems` sample, with the caveat the sample itself imposes.
 *
 * The projection clips each statement and stops after `limit` items, so a reading taken off it is over a
 * *sample of clipped text*. Both facts are carried rather than commented: `truncated` makes the number an
 * upper bound, and the caller is expected to print the sample's size beside the answer — the module cannot
 * know how many items it was not shown, so it does not guess.
 */
export function redundancyOfSample(sample: {
  readonly items: readonly { readonly statement: string }[];
  readonly truncated: number;
}): RedundancyCensus {
  return storeRedundancy(
    sample.items.map((item) => ({ statement: item.statement, clipped: sample.truncated > 0 })),
  );
}
