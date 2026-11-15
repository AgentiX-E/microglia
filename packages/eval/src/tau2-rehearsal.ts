/**
 * The store on the cases it was built from.
 *
 * Every held-out measurement in this lane answers "does the memory help on tasks it was never taught" — a
 * question that mixes two failures: an item that is **wrong**, and an item that is **right but applied where it
 * does not belong**. R124/R123a/R123 span a 27pp range of harm share and none of them can say which of the two
 * produced it.
 *
 * The learn half already runs every training task with **no** memory and knows which ones failed; each of those
 * failures is what an item was distilled from. Replaying them with the store turns the question around: *does
 * an item repair the case it was written from?* Two outcomes are possible and they point in opposite
 * directions — a store that repairs most of its own cases is right and misapplied on held-out tasks (a
 * conditioning problem), and a store that repairs few is inert or wrong (a distillation problem).
 *
 * This module is the arithmetic and the sentence, and nothing else: it reads two reward sets and adds up four
 * counts. It does not run anything, because the thing that runs a phase is the driver and a harness that could
 * take either input would be two descriptions of one experiment.
 */

/** One training task's outcome on each side of the replay. */
export type RehearsalCell = {
  /** The task, qualified the way the trial rows name it. */
  readonly task: string;
  /** Whether the task passed with no memory, during the learn half. */
  readonly withoutMemory: boolean;
  /** Whether it passed with the store, during the rehearsal. */
  readonly withMemory: boolean;
};

/** The four counts, and the two rates they support. */
export type Rehearsal = {
  /** Tasks that appear on both sides. A task the rehearsal never ran is not evidence either way. */
  readonly paired: number;
  /** Failed without memory, passed with it: the store repaired its own case. */
  readonly repaired: number;
  /** Passed without memory, failed with it. */
  readonly broke: number;
  /** Passed both times — nothing to repair, and the store did not break it. */
  readonly kept: number;
  /** Failed both times: the item was inert, or wrong in a way that changed nothing. */
  readonly inert: number;
  /**
   * `repaired / (repaired + inert)` — of the cases the store was written from, the share it repairs.
   *
   * The denominator is the *failed* population, because a task the model already passed teaches nothing and
   * asks the store nothing. A rate over every task would be diluted by passes and would read like a held-out
   * score, which it is not: these are the store's own cases.
   */
  readonly repairRate: number | null;
  /** `broke / (repaired + broke)` — of the outcomes the store changed, the share it changed for the worse. */
  readonly harmShare: number | null;
};

/**
 * Pair the two reward sets by task and count the four cells.
 *
 * `undefined` when nothing paired, for the reason every other reader in this lane returns `undefined`: a zero
 * would read as "the store repaired nothing", which is the sentence a store that was never replayed can least
 * afford. A task present on one side only is dropped rather than counted as a failure — the rehearsal runs the
 * learn half's task list, so a mismatch means the two phases disagree about the split, and that is a finding
 * about the plan rather than about the memory.
 */
export function rehearsalOf(input: {
  readonly learnRewards: ReadonlyMap<string, number> | Readonly<Record<string, number>>;
  readonly rehearsalRewards: readonly { readonly task: string; readonly reward: number | null }[];
}): Rehearsal | undefined {
  const without = input.learnRewards instanceof Map
    ? input.learnRewards
    : new Map<string, number>(Object.entries(input.learnRewards));
  const cells: RehearsalCell[] = [];
  for (const row of input.rehearsalRewards) {
    const before = without.get(row.task);
    // `null` is the harness declining to score, which is not a failure and must not enter either denominator.
    if (before === undefined || row.reward === null) continue;
    cells.push({ task: row.task, withoutMemory: before === 1, withMemory: row.reward === 1 });
  }
  if (cells.length === 0) return undefined;
  let repaired = 0;
  let broke = 0;
  let kept = 0;
  let inert = 0;
  for (const cell of cells) {
    if (!cell.withoutMemory && cell.withMemory) repaired += 1;
    else if (cell.withoutMemory && !cell.withMemory) broke += 1;
    else if (cell.withoutMemory) kept += 1;
    else inert += 1;
  }
  const failed = repaired + inert;
  const changed = repaired + broke;
  return {
    paired: cells.length,
    repaired,
    broke,
    kept,
    inert,
    repairRate: failed === 0 ? null : repaired / failed,
    harmShare: changed === 0 ? null : broke / changed,
  };
}

/**
 * The sentence a phase prints about its own store.
 *
 * It leads with the repair rate and its denominator, because that is the number the two explanations for a 30%
 * held-out harm share are separated by, and it names the held-out half nowhere: this reading is about the store's
 * own cases and quoting it beside a held-out score would invite exactly the confusion it exists to remove.
 */
export function rehearsalLine(rehearsal: Rehearsal | undefined, tasks: number): string {
  if (rehearsal === undefined) {
    return (
      'rehearsal: not measured — no task carried a reward on both sides, so the store was not replayed against ' +
      'the cases it was built from'
    );
  }
  const share = (value: number | null): string => (value === null ? 'none' : `${(value * 100).toFixed(2)}%`);
  const failed = rehearsal.repaired + rehearsal.inert;
  return (
    `rehearsal: ${String(rehearsal.paired)} of ${String(tasks)} task(s) replayed, ` +
    `${String(rehearsal.repaired)} repaired / ${String(rehearsal.inert)} inert of the ${String(failed)} that ` +
    `failed without memory (${share(rehearsal.repairRate)}); ` +
    `${String(rehearsal.broke)} broken and ${String(rehearsal.kept)} kept of the rest` +
    (rehearsal.harmShare === null ? '' : `; harm share ${share(rehearsal.harmShare)}`)
  );
}
