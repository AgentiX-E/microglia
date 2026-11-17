/**
 * Price a store's items from the artefacts an arm already wrote.
 *
 * Usage: `pnpm eval:item-ledger eval/results/arms/memory/poc-l4.json [--baseline <reference.json>]`
 *
 * Nothing here is measured: `pack.ledger` and `per_task` are fields every arm this lane has dispatched since
 * R92 already carries, and joining them costs no calls. That is the point of the command — it prices a
 * deletion arm (R129's mechanism, the literature's only +10pp effect) before one is bought.
 *
 * The join is by order, so the order is checked rather than assumed. `pack.ledger` rows, `per_task` rows and
 * `turnCensus.rows` are written by three different parts of the driver; when the third disagrees with the
 * second about which task a row is, the ledger stops and says so.
 */
import { readFileSync } from 'node:fs';
import {
  boundaryJoin,
  boundaryLine,
  boundaryTasksOf,
  episodeStartsOf,
  namedLedgerOf,
} from '../tau2-attribution.js';
import { itemLedgerLine, itemLedgerOf } from '../item-ledger.js';

type L4 = {
  readonly per_task?: readonly { readonly id: string; readonly outcomes?: readonly boolean[] }[];
  readonly per_trial?: readonly { readonly id: string; readonly trial: number; readonly reward: number | null }[];
  readonly tau2?: {
    readonly pack?: { readonly ledger?: readonly (readonly string[])[] };
    readonly turnCensus?: { readonly rows?: readonly { readonly task: string }[] };
    readonly storeItems?: { readonly items?: readonly unknown[] };
    readonly memory?: {
      readonly census?: number;
      readonly episodeStarts?: readonly number[];
      readonly boundaryTasks?: readonly (string | null)[];
    };
  };
};

function refuse(message: string): never {
  process.stderr.write(`[item-ledger] ${message}\n`);
  process.exit(1);
}

function read(path: string): L4 {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as L4;
  } catch (error) {
    refuse(`${path}: ${(error as Error).message}`);
  }
}

/** Task id → 1/0 from an arm's `per_task`, with a partial pass counted as a failure at one trial. */
function rewardsOf(arm: L4): Map<string, number> {
  const rows = arm.per_task ?? [];
  if (rows.length === 0) refuse('the artefact carries no per_task, so nothing can be priced');
  return new Map(
    rows.map((row) => [row.id, (row.outcomes ?? []).every((outcome) => outcome) ? 1 : 0] as const),
  );
}

function main(): void {
  const args = process.argv.slice(2);
  const baselineAt = args.indexOf('--baseline');
  const path = args[0];
  if (path === undefined || path.startsWith('--')) refuse('usage: eval:item-ledger <poc-l4.json> [--baseline <file>]');
  const arm = read(path);
  const ledger = arm.tau2?.pack?.ledger ?? [];
  const tasks = (arm.per_task ?? []).map((row) => row.id);
  // R136: the boundary is printed before the count is checked, because the count is what fails on a retried
  // task — and a refusal that cannot say *which* task repeated is the refusal R135 spent a course on. The
  // join is the repair; this guard still refuses until the repair is priced.
  const boundary = boundaryJoin({
    episodeStarts: episodeStartsOf(arm.tau2?.memory),
    boundaryTasks: boundaryTasksOf(arm.tau2?.memory),
    memoryTrials: arm.per_trial,
  });
  process.stdout.write(`[item-ledger] ${boundaryLine(boundary)}\n`);
  // R138. τ² re-runs a simulation whose first attempt died, so the ledger can carry a request the runner never
  // scored. That row is droppable *by its own boundary's name* rather than by position, and what is dropped is
  // reported — a count of requests that belong to no trial is a fact about the harness, not a loss.
  const joined = namedLedgerOf({
    ledger,
    boundaryTasks: boundaryTasksOf(arm.tau2?.memory),
    tasks,
  });
  if ('absent' in joined) {
    refuse(`${joined.absent}: ${joined.detail}`);
  }
  const packs = joined.ledger;
  if (joined.dropped > 0) {
    process.stdout.write(
      `[item-ledger] ${String(joined.dropped)} request(s) belong to an attempt no trial names, and are dropped ` +
        'before the join rather than paired with a neighbour\n',
    );
  }
  // The third array, checked against the second: `turnCensus.rows[i].task` is the episode the driver believes
  // row i belongs to, and `per_task[i].id` is the task it scored. One dispatcher's order is a claim; two that
  // agree is a reading.
  const census = arm.tau2?.turnCensus?.rows ?? [];
  census.forEach((row, index) => {
    const scored = tasks[index];
    if (scored === undefined) return;
    if (scored !== `retail/${row.task}`) {
      refuse(
        `row ${String(index)} is task ${scored} in per_task and ${row.task} in the turn census; the two ` +
          'arrays disagree about the order and the ledger cannot be joined',
      );
    }
  });
  const readings = itemLedgerOf({
    packs,
    tasks,
    rewards: rewardsOf(arm),
    ...(baselineAt === -1 ? {} : { baseline: rewardsOf(read(args[baselineAt + 1] ?? '')) }),
  });
  const store = arm.tau2?.storeItems?.items?.length ?? arm.tau2?.memory?.census ?? 0;
  // Whether the sum is a bound is read off the packs this arm served: a request that carried two ids shares
  // its case between them, and a request that carried one does not.
  const sharedRequests = packs.filter((ids) => ids.length > 1).length;
  process.stdout.write(`[item-ledger] ${path}\n`);
  process.stdout.write(`[item-ledger] ${itemLedgerLine(readings, store, sharedRequests)}\n`);
  for (const row of readings.filter((entry) => (entry.net ?? 0) < 0).slice(0, 10)) {
    process.stdout.write(
      `[item-ledger]   ${row.id} served ${String(row.served)}: ${String(row.passed)} passed, ` +
        `${String(row.failed)} failed, net ${String(row.net)}\n`,
    );
  }
}

main();
