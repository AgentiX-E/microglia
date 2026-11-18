/**
 * R141 — was the floor in force where the pack was served?
 *
 * The registration's criterion is not a score: it is that **no served item carries support below the floor**.
 * Answering it needs two populations that live in two artefacts — the attribution table (which item was
 * served, and what it did) and the store sample (how many tasks stand behind it) — and neither alone can say
 * whether the items that hurt were the singletons. A join typed into a readback is a join with no test, so it
 * lives here with its verdicts decided.
 *
 * ## The two readings, and why both are needed
 *
 * On an arm that ran no floor, the useful number is the **counterfactual**: how many of the served items a
 * floor of *n* would have removed. That is what R139's readback was done by hand to answer, and it is what the
 * next registration is sized from. On an arm that ran one, the counterfactual is meaningless — a floor that
 * ran and let a singleton through is a carriage defect, not a prediction — so the same field reports the
 * measured count instead. `wouldRetire` and `belowFloor` are therefore never both live: absence of a floor
 * makes `belowFloor` a forecast, presence makes it a grade.
 *
 * ## What it may not do
 *
 * It may not treat a served item that the sample does not carry as unknown. The sample is capped, and the
 * store writes one task per correction: an item outside the sample is, for the purposes of a floor, an item
 * with one task until something says otherwise. A bucket named `unknown` would make the census look like it
 * measured something it declined to.
 */
import type { ItemTransfer } from './tau2-attribution.js';

export type ServeSupportBucket = {
  readonly support: number;
  readonly items: number;
  readonly kept: number;
  readonly broke: number;
  readonly net: number;
};

export type ServeSupportCensus = {
  /** Items the pack served into a measured episode. */
  readonly served: number;
  /** Ascending by support; the last bucket is the floor's own population, whatever its size. */
  readonly buckets: readonly ServeSupportBucket[];
  /**
   * Items the store said were servable when the pack was read, so the served share has a denominator.
   *
   * Optional because an artefact from before the store census carries none, and a zero written there would
   * print `21 of 0 servable item(s) served` — a rate above one, which is the shape of a miscounted
   * denominator rather than of a missing one.
   */
  readonly servable?: number;
  /** The floor the arm ran at. 1 is the control: every item servable. */
  readonly floor: number;
  /**
   * Served items below the floor.
   *
   * A grade when a floor ran, and zero when it did not — because nothing can be below the control's floor of
   * one. The counterfactual a control arm is priced on is the singleton bucket, which `buckets` already
   * carries: a second field for it was a number that could disagree with the bucket it counted.
   */
  readonly belowFloor: number;
  /** Served items with two or more tasks behind them — the population a floor of two leaves. */
  readonly corroborated: number;
  /**
   * Served items a truncated sample does not carry and no group names.
   *
   * Neither graded nor bucketed: the census cannot say what support they carried, and the one thing it may not
   * do is say one. Zero on every arm whose sample is the whole store.
   */
  readonly unresolved: number;
};

/**
 * The support each sampled item carries, keyed by id.
 *
 * `undefined` when the artefact carries no sample at all, and that is a different fact from an empty one: an
 * artefact written before the store sample existed cannot support a statement about support, and a map built
 * from nothing would have the census call every served item a singleton — a finding invented from an absence.
 */
export function supportMapOf(
  sample: { readonly items?: readonly { readonly id: string; readonly supportTasks?: number }[] } | undefined,
  groups?: readonly { readonly ids: readonly string[]; readonly supportTasks: number }[],
): ReadonlyMap<string, number> | undefined {
  if (sample?.items === undefined) return undefined;
  const map = new Map<string, number>();
  for (const row of sample.items) map.set(row.id, row.supportTasks ?? 1);
  // R143: the move pass merges records and keeps one row per group, so a served id can be a member the store
  // no longer holds under its own name. The group table names every member and carries the group's support,
  // which is the number the floor acted on — and joining on the id alone loses exactly the records that were
  // corroborated enough to merge, which is the population a floor of two exists to keep.
  for (const group of groups ?? []) {
    for (const id of group.ids) map.set(id, group.supportTasks);
  }
  return map;
}

export function serveSupportCensus(input: {
  readonly items: readonly ItemTransfer[];
  readonly support: ReadonlyMap<string, number>;
  readonly servable?: number;
  readonly floor: number;
  /**
   * Whether the sample is the whole store or a prefix of it.
   *
   * R143, and this is the defect the field closes: `storeItemSample` caps at 64 rows and records what it left
   * out, but the census read every unlisted id as one task. On R141 — 83 items, 64 sampled, 19 omitted — six of
   * the fourteen served records were in the omitted nineteen, and all six had two or three tasks behind them.
   * The census would have reported `6 of 14 served items below the floor`, which is the round's own criterion
   * failing on a run that satisfied it, and the failure would have been the sample's size rather than the store.
   *
   * A truncated sample makes absence uninformative. Absence from a *complete* sample is still a fact — the
   * store writes one task per correction — so the default of one survives exactly where it is justified.
   */
  readonly truncated?: boolean;
}): ServeSupportCensus {
  const counted = new Map<number, ServeSupportBucket>();
  let belowFloor = 0;
  let corroborated = 0;
  let unresolved = 0;
  for (const item of input.items) {
    const resolved = input.support.get(item.id);
    if (resolved === undefined && input.truncated === true) {
      unresolved += 1;
      continue;
    }
    const support = resolved ?? 1;
    const current = counted.get(support) ?? { support, items: 0, kept: 0, broke: 0, net: 0 };
    counted.set(support, {
      support,
      items: current.items + 1,
      kept: current.kept + item.kept,
      broke: current.broke + item.broke,
      net: current.net + item.net,
    });
    if (support < input.floor) belowFloor += 1;
    if (support >= 2) corroborated += 1;
  }
  const buckets = [...counted.values()].sort((left, right) => left.support - right.support);
  return {
    served: input.items.length,
    buckets,
    // Absent, not `undefined`: the type says the field may be missing, and `exactOptionalPropertyTypes`
    // makes that literalism fair — a present key holding `undefined` is a census that answered "no
    // denominator" with a value the reader would print.
    ...(input.servable === undefined ? {} : { servable: input.servable }),
    floor: input.floor,
    belowFloor,
    corroborated,
    unresolved,
  };
}

/** One line, printed whether or not a floor ran: "no floor" is a reading and not an absence. */
export function serveSupportLine(census: ServeSupportCensus | undefined): string {
  if (census === undefined) {
    return 'serve support: the artefact carries no store sample, so the support behind a served item cannot be read';
  }
  if (census.served === 0) {
    return 'serve support: no item was served, so no support can be read';
  }
  const one = census.buckets.find((bucket) => bucket.support === 1);
  const rest = census.buckets.filter((bucket) => bucket.support > 1);
  const sum = (pick: (bucket: ServeSupportBucket) => number): number =>
    rest.reduce((total, bucket) => total + pick(bucket), 0);
  const single =
    one === undefined
      ? 'no singleton was served'
      : `support 1: ${String(one.items)} item(s), ${String(one.broke)} broke, ${String(one.kept)} kept, net ${signed(one.net)}`;
  const corroborated =
    rest.length === 0
      ? 'none corroborated'
      : `support ≥2: ${String(sum((bucket) => bucket.items))} item(s), ${String(sum((bucket) => bucket.broke))} broke, ${String(sum((bucket) => bucket.kept))} kept, net ${signed(sum((bucket) => bucket.net))}`;
  const verdict =
    census.floor > 1
      ? census.belowFloor === 0
        ? `floor ${String(census.floor)} in force, and no served item carries support below it`
        : `floor ${String(census.floor)} in force, and ${String(census.belowFloor)} of the ${String(census.served)} served item(s) carry support below it`
      : // The counterfactual a control arm is priced on: the singletons, read from the bucket that counted them.
        `floor absent, so a floor of 2 would have retired ${String(one === undefined ? 0 : one.items)} of the ${String(census.served)}`;
  const served =
    census.servable === undefined
      ? `${String(census.served)} item(s) served`
      : `${String(census.served)} of ${String(census.servable)} servable item(s) served`;
  const ungraded =
    census.unresolved === 0
      ? ''
      : `; ${String(census.unresolved)} served item(s) fall outside the sample and no group names them, so ` +
        'neither the bucket nor the floor is graded for them';
  return `serve support: ${served}; ${single}; ${corroborated}; ${verdict}${ungraded}`;
}

function signed(value: number): string {
  return `${value >= 0 ? '+' : ''}${String(value)}`;
}
