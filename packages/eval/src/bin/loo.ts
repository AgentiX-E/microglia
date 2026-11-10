/**
 * R74's reading, recomputed from an artefact with zero calls.
 *
 * The dispatch buys the arm; this prints what it said. Everything here is a column in a file that has
 * already been paid for — the `loo` verdict is `per_case.arms.loo`, the paired baseline is
 * `per_case.correct`, the withheld rule is `per_case.looDropped`, and the rule ledger is arithmetic
 * over `per_case.packIdList`.
 *
 *   pnpm eval:loo                      # the artefact `chooseArtefact` picks
 *   pnpm eval:loo --bird path.json     # one file
 *
 * The three sections are in the order the branches are decided in: the whole split first, because a
 * null there closes the question; the classes second, because a null overall with a real difference
 * between harmful and helpful rules is the most useful outcome the design can produce; and the draw
 * counts last, because they bound what any per-rule sentence is allowed to claim.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  looCrossFitted,
  looDraws,
  looGroups,
  looOverall,
  observationalLedger,
  ruleClassOf,
  type LooRow,
} from '@agentix-e/microglia-eval';
import { birdArtefactPath } from './lib.js';

type Row = {
  readonly fold: number;
  readonly question?: string | null;
  readonly correct: boolean;
  readonly withoutMemoryCorrect: boolean;
  readonly packIdList?: readonly string[] | null;
  readonly looDropped?: string | null;
  readonly arms?: Readonly<Record<string, boolean>> | undefined;
};

type Artefact = {
  readonly per_case: readonly Row[];
  readonly generated_at?: string;
};

export function main(argv: readonly string[]): number {
  const index = argv.indexOf('--bird');
  const path = index === -1 ? birdArtefactPath() : (argv[index + 1] ?? birdArtefactPath());
  const artefact = JSON.parse(readFileSync(path, 'utf8')) as Artefact;
  const rows = artefact.per_case.filter((row) => row.looDropped !== undefined);
  if (rows.length === 0) {
    process.stdout.write(
      `[loo] ${join('.', path)}: no withheld rule recorded, so the 'loo' arm did not run in this artefact\n`,
    );
    return 0;
  }
  const measured: LooRow[] = rows.map((row) => ({
    fold: typeof row.fold === 'number' ? row.fold : 0,
    // The arm's verdict is `arms.loo`; the paired baseline is the artefact's own `correct`, which is
    // the `full` arm. `?? false` is the honest default for a row whose arm produced no parseable
    // query, and it is not a filter: a missing verdict is a failure to answer, which is what the
    // lane scores it as.
    correct: row.arms?.['loo'] ?? false,
    injectedCorrect: row.correct,
    dropped: row.looDropped ?? null,
    packIds: row.packIdList ?? [],
  }));
  const withoutMemory = rows.map((row) => row.withoutMemoryCorrect);
  const overall = looOverall(measured);
  process.stdout.write(
    `[loo] ${join('.', path)}: ${String(measured.length)} question(s), ${String(overall.pairs)} pair(s), ` +
      `${String(overall.nothingToWithhold)} with nothing to withhold\n`,
  );
  const draws = looDraws(measured);
  process.stdout.write(
    `[loo] drawing: ${String(draws.withheld)} withheld over ${String(draws.rules)} rule(s), ` +
      `median ${String(draws.median)}, max ${String(draws.max)}, mean ${draws.mean.toFixed(2)}\n`,
  );
  const ledger = observationalLedger(measured, withoutMemory);
  const classes = { harmful: 0, helpful: 0, neutral: 0 } as Record<string, number>;
  for (const verdict of ledger) classes[ruleClassOf(verdict)] = (classes[ruleClassOf(verdict)] ?? 0) + 1;
  process.stdout.write(
    `[loo] ledger: ${String(ledger.length)} rule(s) ever injected, ` +
      `${String(classes['harmful'] ?? 0)} harmful / ${String(classes['helpful'] ?? 0)} helpful / ` +
      `${String(classes['neutral'] ?? 0)} neutral\n`,
  );
  process.stdout.write(
    '[loo] group          pairs    loo       full      delta      95% CI              p\n',
  );
  const print = (name: string, pairs: number, measuredRow: { treatmentAccuracy: number; baselineAccuracy: number; delta: number; deltaCI: { low: number; high: number }; p: number }): void => {
    process.stdout.write(
      `[loo] ${name.padEnd(12)} ${String(pairs).padStart(5)}   ` +
        `${(measuredRow.treatmentAccuracy * 100).toFixed(2).padStart(6)}%   ` +
        `${(measuredRow.baselineAccuracy * 100).toFixed(2).padStart(6)}%   ` +
        `${(measuredRow.delta >= 0 ? '+' : '')}${(measuredRow.delta * 100).toFixed(2)}pp`.padEnd(11) +
        `[${(measuredRow.deltaCI.low * 100).toFixed(2)}, ${(measuredRow.deltaCI.high * 100).toFixed(2)}]`.padEnd(20) +
        `${measuredRow.p.toFixed(4)}\n`,
    );
  };
  print('overall', overall.pairs, overall.reading);
  for (const group of looGroups(measured, withoutMemory)) print(group.name, group.pairs, group.reading);
  // The same class table with each rule's class decided on the folds the effect is not measured on.
  // The in-sample table above cannot distinguish "the rule is harmful" from "the question was hard",
  // because a question the full arm happened to fail is a question whose rules were called harmful.
  const fitted = looCrossFitted(measured, withoutMemory);
  process.stdout.write(`[loo] cross-fitted: ${String(fitted.unseen)} pair(s) withheld a rule no other fold saw\n`);
  for (const group of fitted.readings) print(group.name, group.pairs, group.reading);
  return 0;
}

process.exitCode = main(process.argv.slice(2));
