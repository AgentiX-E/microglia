/**
 * Which item cost which case.
 *
 * Every arm this lane has dispatched writes two things that have never been joined: `pack.ledger`, the item
 * ids each request was served, and `per_task`, whether that request's episode passed. Joined, they price an
 * **item** rather than a store — and the store-level reading cannot do that. R133's replay repaired 11 cases
 * and broke 7 with 73 active items; nothing in the artefact said whether the 7 and the 11 came from the same
 * six items.
 *
 * The join needs an order, and an order is exactly what a lane that has already published a wrongly-ordered
 * census should not assume. Three arrays carry it — `pack.ledger` (one row per request), `per_task` (one row
 * per episode) and `turnCensus.rows` (one row per episode) — and they are written by different parts of the
 * driver. So the caller passes the task list it believes the pack rows belong to, and this module refuses
 * when the counts do not line up; the caller's own check that the three arrays agree belongs beside it, not
 * inside here.
 *
 * **What a negative net means, and what it does not.** An item's net is the difference between the cases it
 * repaired and the cases it broke over the requests that were served it — against no reward at all when no
 * baseline is given, and as discordant pairs against a store-off re-draw when one is. Items co-occur: a
 * request served four ids, so a break is counted against all four. The sum of the negative nets is therefore
 * an **upper bound** on what deleting them recovers, and the sentence says so; the honest reading is that it
 * prices a deletion arm before it is bought, not that it predicts its result.
 */

/** One item's cases, as the ledger can see them. */
export type ItemReading = {
  readonly id: string;
  /** Requests this item was served on. */
  readonly served: number;
  /** Of those, the ones whose episode passed. */
  readonly passed: number;
  readonly failed: number;
  /**
   * `passed − failed`, or `null` when the caller supplied no baseline and the two cells are not discordant.
   *
   * `null` rather than `0`: an item served on no request and an item served on requests that all passed are
   * different facts, and a zero would merge them.
   */
  readonly net: number | null;
};

export type ItemLedgerInput = {
  /** The item ids served, one row per request, in the order the episodes were run. */
  readonly packs: readonly (readonly string[])[];
  /** The task each row belongs to, in the same order. Its length is the check. */
  readonly tasks: readonly string[];
  /** Task id → 1 for a pass, 0 for a failure. Absent ids are not counted, which is how an unscored task stays out. */
  readonly rewards: ReadonlyMap<string, number>;
  /** The same tasks with the store off. When present, `net` is the discordant difference rather than a raw one. */
  readonly baseline?: ReadonlyMap<string, number>;
};

/**
 * Price every item over the requests it was served on.
 *
 * Refuses a row count that disagrees with the task list rather than truncating: a ledger joined to the wrong
 * episode is worse than no ledger, because it reports a number.
 */
export function itemLedgerOf(input: ItemLedgerInput): readonly ItemReading[] {
  if (input.packs.length !== input.tasks.length) {
    throw new RangeError(
      `the pack ledger carries ${String(input.packs.length)} request(s) and the task list ${String(
        input.tasks.length,
      )}; a ledger joined to the wrong episode reports a number rather than a defect`,
    );
  }
  const seen = new Map<string, { served: number; passed: number; failed: number; net: number }>();
  input.packs.forEach((ids, index) => {
    // The counts were checked above, so the row has a task; the guard that used to stand here could not be
    // reached and is deleted rather than covered.
    const task = input.tasks[index] as string;
    const reward = input.rewards.get(task);
    if (reward === undefined) return;
    const after = input.baseline?.get(task);
    for (const id of new Set(ids)) {
      const row = seen.get(id) ?? { served: 0, passed: 0, failed: 0, net: 0 };
      row.served += 1;
      if (reward >= 1) row.passed += 1;
      else row.failed += 1;
      // `now - before` is `repaired - broke` without the four-way ternary: a case the store passed and the
      // baseline failed is +1, the mirror is -1, and agreement is 0 either way. A task the baseline did not
      // score counts as "no change", and the row's net is discarded below when no baseline was supplied.
      const now = reward >= 1 ? 1 : 0;
      const before = after === undefined ? now : after >= 1 ? 1 : 0;
      row.net += now - before;
      seen.set(id, row);
    }
  });
  return [...seen]
    .map(([id, row]) => ({
      id,
      served: row.served,
      passed: row.passed,
      failed: row.failed,
      net: input.baseline === undefined ? null : row.net,
    }))
    .sort((left, right) => (left.net ?? 0) - (right.net ?? 0) || left.id.localeCompare(right.id));
}

/**
 * The sentence, with the two absences it can have printed rather than omitted.
 *
 * A store in which no item has a negative net and a store that was never read produce the same silence, so
 * the line says which. The bound is named as a bound: `Σ|net|` over the negative items is what deleting them
 * would recover *if* each item's cases were its own, and four-item packs guarantee they are not.
 */
export function itemLedgerLine(
  readings: readonly ItemReading[],
  storeItems: number,
  sharedRequests: number,
): string {
  if (readings.length === 0) {
    return (
      `item ledger: none of the ${String(storeItems)} item(s) in the store was served on a scored request, so ` +
      'nothing was priced — this is a reachability reading, not an item one'
    );
  }
  const requests = readings.reduce((total, row) => total + row.served, 0);
  const unreached = Math.max(0, storeItems - readings.length);
  const head =
    `item ledger: ${String(readings.length)} of ${String(storeItems)} item(s) served over ` +
    `${String(requests)} item-request(s)`;
  const signed = readings.filter((row): row is ItemReading & { readonly net: number } => row.net !== null);
  if (signed.length === 0) {
    return (
      `${head} and ${String(unreached)} never served; no baseline, so each row carries its cases rather than a ` +
      'net — an item that was served on three passing requests and an item that was served on none are ' +
      'different counts, and only a store-off draw can say what the passing ones cost'
    );
  }
  const negative = signed.filter((row) => row.net < 0);
  const positive = signed.filter((row) => row.net > 0);
  const loss = negative.reduce((total, row) => total - row.net, 0);
  const gain = positive.reduce((total, row) => total + row.net, 0);
  // Whether the sum is a bound is a property of the packs this arm served, not of the module's history. R134
  // served one item a request, so every case an item carries is its own and `Σ|net|` is the exact number a
  // deletion would recover; printing the four-item caveat over that measurement would make a reader
  // discount a figure that needs no discount.
  const isBound =
    sharedRequests === 0
      ? 'and no served request carried a second item, so each case is that item\'s own: the sum is exact, ' +
        'not a bound'
      : `and ${String(sharedRequests)} served request(s) carried more than one item, so their cases are ` +
        'shared: this is an upper bound on a deletion arm, not a prediction of one';
  return (
    `${head}; ${String(negative.length)} negative summing -${String(loss)}, ${String(positive.length)} positive ` +
    `summing +${String(gain)}, ${String(unreached)} never served. Deleting the negative ones recovers at most ` +
    `+${String(loss)} case(s), ${isBound}`
  );
}
