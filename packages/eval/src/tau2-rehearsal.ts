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
import type { Tau2PhaseUsage } from './tau2-instrument.js';

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
export function rehearsalLine(record: RehearsalRecord): string {
  if (record.refused !== undefined) {
    return (
      `rehearsal: not run — the phase refused to open in a peak-rate window, so the ${String(record.tasks)} ` +
      "task(s) it would have replayed were never asked; the store was not replayed against its own cases"
    );
  }
  const served = `${String(record.served)} of ${String(record.requests)} request(s) served`;
  const rehearsal = record.reading;
  if (rehearsal === undefined) {
    return (
      `rehearsal: ${String(record.tasks)} task(s) replayed, ${served} — no task carried a reward on both ` +
      'sides, so the store was replayed but nothing paired'
    );
  }
  const share = (value: number | null): string => (value === null ? 'none' : `${(value * 100).toFixed(2)}%`);
  const failed = rehearsal.repaired + rehearsal.inert;
  return (
    `rehearsal: ${String(rehearsal.paired)} of ${String(record.tasks)} task(s) replayed, ${served}, ` +
    `${String(rehearsal.repaired)} repaired / ${String(rehearsal.inert)} inert of the ${String(failed)} that ` +
    `failed without memory (${share(rehearsal.repairRate)}); ` +
    `${String(rehearsal.broke)} broken and ${String(rehearsal.kept)} kept of the rest` +
    (rehearsal.harmShare === null ? '' : `; harm share ${share(rehearsal.harmShare)}`) +
    controlClause(record.control)
  );
}

/**
 * The clause the control replay adds, and the four absences it can have.
 *
 * The main clause divides by the population the store was *selected* on: its `inert` cell is "failed without
 * memory, then failed again", which is also what a task that simply fails two thirds of the time produces. The
 * control replaces the without-side with a fresh draw of the same population, so `repaired` and `broke` become
 * discordant pairs and their difference is the store's effect on its own cases with the draw held fixed.
 *
 * Absence is printed rather than omitted, for the reason every reading in this lane prints it: a clause that is
 * simply missing reads as "no effect", and "the store was never compared" is not that.
 */
function controlClause(control: RehearsalControl | undefined): string {
  if (control === undefined) {
    return '; against a no-memory replay: not measured (the registration bought no control phase)';
  }
  if (control.refused !== undefined) {
    return (
      '; against a no-memory replay: not measured (the control phase refused at the rate window, so the store ' +
      'was never compared with a fresh draw of its own population)'
    );
  }
  const reading = control.reading;
  if (reading === undefined) {
    return (
      '; against a no-memory replay: not measured (no task carried a reward on both sides, so the control ran ' +
      'and paired nothing)'
    );
  }
  const net = reading.repaired - reading.broke;
  const signed = `${net > 0 ? '+' : ''}${String(net)}`;
  const share = reading.harmShare === null ? 'none' : `${(reading.harmShare * 100).toFixed(2)}%`;
  return (
    `; against a no-memory replay: ${String(reading.repaired)} repaired / ${String(reading.broke)} broken = ` +
    `${signed} net of ${String(reading.paired)} task(s) (${((net / reading.paired) * 100).toFixed(2)}%)` +
    (reading.repaired + reading.broke === 0 ? '' : `, harm share ${share}`)
  );
}

/**
 * Everything one rehearsal phase measured, in the shape the artefact carries.
 *
 * The counts travel beside the four cells because they answer the question the cells cannot: a replay in which
 * the pack was empty for every task and one in which the pack was served and had no effect produce **the same
 * four cells**, and only `served` separates them. A reading that cannot make that distinction would report a
 * retrieval failure as a distillation failure — which is the defect this whole round exists to stop repeating.
 *
 * `reading` is required and may be `undefined`, so the two absences stay distinguishable in the artefact: the
 * field is written and its pairing is empty (the phase ran, nothing paired) versus the block itself being
 * absent (the phase was never bought). A `?? {}` in the driver would collapse them.
 *
 * `usage` is the phase's own bill, when the phase printed one. Optional because a phase that reported no
 * provider account is a different fact from one that spent nothing, and because the rehearsal is a second paid
 * phase whose cost an artefact has to be able to attribute without reading a workflow log.
 */
export type RehearsalRecord = {
  /** The tasks the replay was asked to run, which is the learn half's own list. */
  readonly tasks: number;
  /** Requests the facade answered, and the ones that carried at least one item. */
  readonly requests: number;
  readonly served: number;
  readonly reading: Rehearsal | undefined;
  /**
   * R133's second replay: the same tasks with the store **off**.
   *
   * Absent when the registration did not buy it. Present-and-empty when it was bought and paired nothing. The
   * distinction is the whole point of the block: `reading.inert` counts tasks that failed without memory and
   * failed again with it, and a task that fails 65% of the time produces that cell whether or not the store
   * did anything. Only a second draw of the same population can say which.
   */
  readonly control?: RehearsalControl;
  /**
   * Why the phase never ran, when it was bought and then refused.
   *
   * One value, because there is one refusal that can arrive here: `run_split.py` declines to open a phase in a
   * peak-rate window, and the window can close between the graded facade and this one. The refusal is recorded
   * rather than thrown because the arm has already been paid for — a second phase must not take the primary
   * measurement with it — and it is recorded *here* rather than left as an absent block, because an absent
   * block would say the registration never bought the phase.
   */
  readonly refused?: 'peak-window';
  readonly usage?: Tau2PhaseUsage;
};

/**
 * The control replay's reading.
 *
 * It carries no `requests` and no `served`, and the omission is a statement: the control runs with the store
 * off, so there is no facade to count. `0 of 0 served` would read as a store that found nothing — the exact
 * misreading AUDIT 34.162 forbids — so the fields are absent rather than zero.
 */
export type RehearsalControl = {
  /** The four cells with the control as the *without* side. `undefined` when nothing paired. */
  readonly reading: Rehearsal | undefined;
  readonly refused?: 'peak-window';
  readonly usage?: Tau2PhaseUsage;
};

/** What one replay phase hands back before it is paired: counts, rewards, bill, and a possible refusal. */
export type RehearsalHalf = {
  readonly requests: number;
  readonly served: number;
  readonly rewards: readonly { readonly task: string; readonly reward: number | null }[];
  readonly usage?: Tau2PhaseUsage;
  readonly refused?: 'peak-window';
};

/** The record of a phase that was bought and refused before its first call. */
export function rehearsalRefused(input: {
  readonly tasks: number;
  readonly reason: 'peak-window';
}): RehearsalRecord {
  return {
    tasks: input.tasks,
    // Zero requests, and stated as zero rather than hidden: no call was made, so the store was not asked.
    requests: 0,
    served: 0,
    reading: undefined,
    refused: input.reason,
  };
}

/**
 * Reduce one replay to the artefact's block.
 *
 * The one decision here is that the pairing is derived from the two reward sets rather than accepted already
 * computed: a caller handing in four numbers could hand in four different ones than the ones its own line
 * printed, and this lane has paid for that twice (R48's two dispatches, R123's seven zeros).
 */
export function rehearsalRecordOf(input: {
  readonly tasks: number;
  readonly requests: number;
  readonly served: number;
  readonly learnRewards: ReadonlyMap<string, number> | Readonly<Record<string, number>>;
  readonly rehearsalRewards: readonly { readonly task: string; readonly reward: number | null }[];
  readonly usage?: Tau2PhaseUsage;
  /**
   * The second replay's rewards, when one was bought. Pairing happens here rather than at the call site for the
   * reason the main pairing does: a caller that handed in four numbers could hand in four different ones than
   * the ones its own line printed.
   */
  readonly control?: {
    readonly rewards: readonly { readonly task: string; readonly reward: number | null }[];
    readonly usage?: Tau2PhaseUsage;
    readonly refused?: 'peak-window';
  };
}): RehearsalRecord {
  return {
    tasks: input.tasks,
    requests: input.requests,
    served: input.served,
    reading: rehearsalOf({
      learnRewards: input.learnRewards,
      rehearsalRewards: input.rehearsalRewards,
    }),
    ...(input.control === undefined
      ? {}
      : {
          control: {
            reading: rehearsalOf({
              learnRewards: new Map(
                input.control.rewards
                  .filter((row): row is { readonly task: string; readonly reward: number } => row.reward !== null)
                  .map((row) => [row.task, row.reward]),
              ),
              rehearsalRewards: input.rehearsalRewards,
            }),
            ...(input.control.refused === undefined ? {} : { refused: input.control.refused }),
            ...(input.control.usage === undefined ? {} : { usage: input.control.usage }),
          },
        }),
    ...(input.usage === undefined ? {} : { usage: input.usage }),
  };
}

/**
 * Whether this dispatch buys a rehearsal.
 *
 * Four spellings and two facts, because two bridges reach this switch and they do not agree on a spelling:
 * `prereg-form` prints a header boolean the way the header wrote it (`true`/`false`, the same wire
 * `TAU_CONSOLIDATE` rides), and a hand-dispatched variable would say `1`/`0` the way `TAU_SPEAK_CENSUS` does.
 * Both are unambiguous booleans, so both are read; anything else is refused before the first model call for
 * `resolveSpeakMargin`'s reason — a misread switch that fell back to "off" would leave an arm whose registration
 * asked the question reporting nothing at all, and the reader would have no way to tell that from a store that
 * repaired nothing.
 *
 * The first version of this function read only `1`/`0`, and R132's first dispatch died on it: the bridge printed
 * `true`, the driver threw, and no episode ran. That is the defect class AUDIT 34.159 is about — a switch whose
 * two ends were never joined — and it is now caught by a test that pushes the bridge's own spelling through this
 * resolver instead of a spelling the test chose.
 *
 * This is a purchase, not an instrument: every run carries the turn census because the phase computes it anyway,
 * and no run carries a rehearsal unless a registration asked. That is why the plan is resolved here rather than
 * printed unconditionally.
 */
export function resolveRehearsal(raw = process.env['TAU_REHEARSAL']): boolean {
  const value = (raw ?? '').trim().toLowerCase();
  if (value === '' || value === '0' || value === 'false') return false;
  if (value === '1' || value === 'true') return true;
  throw new RangeError(
    `TAU_REHEARSAL must be unset, '0'/'false' or '1'/'true'; received '${String(raw)}'`,
  );
}

/**
 * Whether this dispatch buys the control replay as well.
 *
 * Same four spellings and the same refusal as the phase's switch, plus one that only the pair can have: a
 * control with no replay is refused at load. It would run a second no-memory baseline over the learn half's
 * tasks, cost a phase, and compare it against nothing — the shape of a switch whose second end was never built,
 * which is the defect R132's first dispatch paid thirty seconds to teach.
 */
export function resolveRehearsalControl(
  raw = process.env['TAU_REHEARSAL_CONTROL'],
  phaseRaw = process.env['TAU_REHEARSAL'],
): boolean {
  const value = (raw ?? '').trim().toLowerCase();
  if (value === '' || value === '0' || value === 'false') return false;
  if (value === '1' || value === 'true') {
    // Read from the same wire the phase reads, so the two switches cannot disagree about what this dispatch
    // bought. Garbage in the phase's variable throws from `resolveRehearsal` with its own message, which is the
    // refusal that should be attributed to the variable that holds it.
    if (!resolveRehearsal(phaseRaw)) {
      throw new RangeError(
        'TAU_REHEARSAL_CONTROL buys a comparison against the rehearsal, and this dispatch did not buy the ' +
          'rehearsal; a control with nothing to compare against is a phase that cannot be read',
      );
    }
    return true;
  }
  throw new RangeError(
    `TAU_REHEARSAL_CONTROL must be unset, '0'/'false' or '1'/'true'; received '${String(raw)}'`,
  );
}
