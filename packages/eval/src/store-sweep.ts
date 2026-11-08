/**
 * The floor sweep over a store as an artefact ships it, not as a driver holds it.
 *
 * R61's in-driver sweep runs over full `KnowledgeItem`s and is exact. This runs over the projection
 * the artefact carries — statement, condition, scope, kind and a `supportTasks` count — which is
 * everything a readback has when it wants to re-ask the question months later.
 *
 * The difference has to be stated rather than papered over: without evidence rows the sweep cannot
 * know whether two members came from different tasks, so the support a group could reach is an
 * interval. `supportCeil` sums the members' counts, which is what the group reaches if every task
 * is distinct; `supportFloor` is the largest single count, which is what it reaches if they are all
 * the same task. A group of three at 2, 1 and 1 is therefore "3 or 4, never 2 and never 5", and that
 * interval is enough to answer the only question the sweep is asked.
 *
 * The grouping itself is exact, because it never consults evidence: statement containment under
 * complete linkage, and a condition count that the caller may set. The in-driver sweep and this one
 * must agree on grouping where they overlap, and a test holds them to it.
 */
import {
  claimContainment,
  claimTokens,
  sharedTerms,
} from "@agentix-e/microglia-core/distill";

/** The fields a grouping needs, which the artefact's sample carries and a full item also satisfies. */
export type SweepableItem = {
  readonly id: string;
  readonly kind: string;
  readonly status?: string;
  readonly statement: string;
  readonly when?: string;
  readonly scope: Readonly<Record<string, string>>;
  readonly supportTasks: number;
};

/** One group the floor formed, with the interval its support could lie in. */
export type StoreSweepGroup = {
  readonly ids: readonly string[];
  /** The weakest pair inside the group: complete linkage keeps it at or above the floor. */
  readonly weakestPair: number;
  /** The fewest condition terms any two members share. */
  readonly conditionShared: number;
  /** Support if every member came from a different task. */
  readonly supportCeil: number;
  /** Support if every member came from one task. */
  readonly supportFloor: number;
};

export type StoreSweepPoint = {
  readonly threshold: number;
  readonly groups: readonly StoreSweepGroup[];
  /** Pairs above the floor that complete linkage refused, so a chain did not become a group. */
  readonly refusedLinkage: number;
  /** The largest group at this floor. */
  readonly largestGroup: number;
};

function scopeKey(scope: Readonly<Record<string, string>>): string {
  return Object.entries(scope)
    .filter(([, value]) => value !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : 1))
    .map(([key, value]) => `${key}=${value}`)
    .join("\u0000");
}

/**
 * Group the live items at each floor, keeping the three readings a floor is chosen on.
 *
 * Retired items are excluded: the pass this mirrors excludes them, and a sweep that grouped a
 * survivor with the item it already absorbed would report a corroboration the store does not have.
 */
export function sweepStoreItems(
  items: readonly SweepableItem[],
  thresholds: readonly number[],
  conditionMinShared = 0,
): readonly StoreSweepPoint[] {
  const live = items.filter((item) => item.status !== "retired");
  const tokens = live.map((item) => claimTokens(item.statement));
  const conditions = live.map((item) => claimTokens(item.when ?? ""));
  const cache = new Map<string, number>();
  const contain = (left: number, right: number): number => {
    const key = `${Math.min(left, right)}:${Math.max(left, right)}`;
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    const value = claimContainment(
      tokens[left] as ReadonlySet<string>,
      tokens[right] as ReadonlySet<string>,
    );
    cache.set(key, value);
    return value;
  };
  const sharedConditions = (left: number, right: number): number =>
    sharedTerms(
      conditions[left] as ReadonlySet<string>,
      conditions[right] as ReadonlySet<string>,
    );

  return thresholds.map((threshold) => {
    const parent = live.map((_, index) => index);
    const members = live.map((_, index) => [index]);
    const find = (index: number): number => {
      let root = index;
      while (parent[root] !== root) root = parent[root] as number;
      return root;
    };
    let refusedLinkage = 0;
    for (let left = 0; left < live.length; left += 1) {
      for (let right = left + 1; right < live.length; right += 1) {
        const one = live[left] as SweepableItem;
        const other = live[right] as SweepableItem;
        if (one.kind !== other.kind) continue;
        if (scopeKey(one.scope) !== scopeKey(other.scope)) continue;
        if (contain(left, right) < threshold) continue;
        if (
          conditionMinShared > 0 &&
          sharedConditions(left, right) < conditionMinShared
        )
          continue;
        const leftRoot = find(left);
        const rightRoot = find(right);
        if (leftRoot === rightRoot) continue;
        const leftMembers = members[leftRoot] as number[];
        const rightMembers = members[rightRoot] as number[];
        const linked = leftMembers.every((x) =>
          rightMembers.every((y) => contain(x, y) >= threshold),
        );
        if (!linked) {
          refusedLinkage += 1;
          continue;
        }
        parent[rightRoot] = leftRoot;
        members[leftRoot] = [...leftMembers, ...rightMembers].sort(
          (x, y) => x - y,
        );
        members[rightRoot] = [];
      }
    }
    const groups = members
      .filter((bucket) => bucket.length > 1)
      .map((bucket): StoreSweepGroup => {
        let weakestPair = 1;
        let conditionShared = Number.POSITIVE_INFINITY;
        let supportCeil = 0;
        let supportFloor = 0;
        for (let one = 0; one < bucket.length; one += 1) {
          supportCeil += (live[bucket[one] as number] as SweepableItem)
            .supportTasks;
          supportFloor = Math.max(
            supportFloor,
            (live[bucket[one] as number] as SweepableItem).supportTasks,
          );
          for (let other = one + 1; other < bucket.length; other += 1) {
            weakestPair = Math.min(
              weakestPair,
              contain(bucket[one] as number, bucket[other] as number),
            );
            conditionShared = Math.min(
              conditionShared,
              sharedConditions(bucket[one] as number, bucket[other] as number),
            );
          }
        }
        return {
          ids: bucket.map((index) => (live[index] as SweepableItem).id),
          weakestPair,
          conditionShared,
          supportCeil,
          supportFloor,
        };
      })
      .sort((left, right) => right.ids.length - left.ids.length);
    return {
      threshold,
      groups,
      refusedLinkage,
      largestGroup: groups.reduce(
        (most, group) => Math.max(most, group.ids.length),
        1,
      ),
    };
  });
}
