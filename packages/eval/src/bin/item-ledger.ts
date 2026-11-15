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
import { itemLedgerLine, itemLedgerOf } from '../item-ledger.js';

type L4 = {
  readonly per_task?: readonly { readonly id: string; readonly outcomes?: readonly boolean[] }[];
  readonly tau2?: {
    readonly pack?: { readonly ledger?: readonly (readonly string[])[] };
    readonly turnCensus?: { readonly rows?: readonly { readonly task: string }[] };
    readonly storeItems?: { readonly items?: readonly unknown[] };
    readonly memory?: { readonly census?: number };
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
  const packs = arm.tau2?.pack?.ledger ?? [];
  const tasks = (arm.per_task ?? []).map((row) => row.id);
  if (packs.length !== tasks.length) {
    refuse(
      `the pack ledger carries ${String(packs.length)} request(s) and the arm ${String(tasks.length)} episode(s); ` +
        'a ledger joined to the wrong episode reports a number rather than a defect',
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
    ...(baselineAt === -1 ? {} : { baseline: rewardsOf(read(read(args[baselineAt + 1] ?? ''))) }),
  });
  const store = arm.tau2?.storeItems?.items?.length ?? arm.tau2?.memory?.census ?? 0;
  process.stdout.write(`[item-ledger] ${path}\n`);
  process.stdout.write(`[item-ledger] ${itemLedgerLine(readings, store)}\n`);
  for (const row of readings.filter((entry) => (entry.net ?? 0) < 0).slice(0, 10)) {
    process.stdout.write(
      `[item-ledger]   ${row.id} served ${String(row.served)}: ${String(row.passed)} passed, ` +
        `${String(row.failed)} failed, net ${String(row.net)}\n`,
    );
  }
}

main();
