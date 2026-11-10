/**
 * Re-apply the row-coverage gate to the artefacts in the repository.
 *
 * `V77` runs inside the dispatch, so the only run it can refuse is one that has already been paid
 * for. R70 was refused that way — 2,953 calls, four arms, every other gate green — and the run could
 * not be repaired, because a re-dispatch draws new samples: it buys a different measurement, not a
 * verdict on the old one. Whether the refusal was the run's fault or the gate's is a question about
 * the file, so the gate has to be re-appliable to a file. That is what this command is for, and it is
 * why the rule lives in `armCoverageGate` with tests rather than inside `main()`.
 *
 * Every artefact in `eval/results` is checked, not only today's, because the defect the gate exists
 * for was a *silent* absence: an artefact that buys six arms and publishes five reads as complete.
 * The walk is the only way to know how many such files this repository has.
 *
 *   pnpm eval:arm-coverage           # every poc-sota-bird*.json under POC_RESULT_DIR
 *   pnpm eval:arm-coverage --bird p  # one file, named
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { armCoverageOf } from '@agentix-e/microglia-eval';

type Artefact = {
  readonly config?: { readonly arms?: readonly string[] } | undefined;
  readonly arms?: readonly { readonly arm: string }[] | undefined;
};

const RESULTS = process.env['POC_RESULT_DIR'] ?? join(process.cwd(), 'eval', 'results');

export function main(argv: readonly string[]): number {
  const index = argv.indexOf('--bird');
  const named = index === -1 ? undefined : argv[index + 1];
  const paths =
    named === undefined
      ? readdirSync(RESULTS)
          .filter((name) => name.startsWith('poc-sota-bird') && name.endsWith('.json'))
          .sort()
          .map((name) => join(RESULTS, name))
      : [named];

  let failed = 0;
  let arms = 0;
  for (const path of paths) {
    const artefact = JSON.parse(readFileSync(path, 'utf8')) as Artefact;
    const gate = armCoverageOf(artefact);
    arms += (artefact.config?.arms ?? []).filter((arm) => arm !== 'none').length;
    if (!gate.pass) failed += 1;
    process.stdout.write(`[arm-coverage] ${path}: ${gate.pass ? 'pass' : 'FAIL'} — ${gate.actual}\n`);
  }
  process.stdout.write(
    `[arm-coverage] ${String(paths.length - failed)}/${String(paths.length)} artefact(s) publish a row ` +
      `for every arm they bought; ${String(arms)} bought arm(s) across the walk\n`,
  );
  return failed === 0 ? 0 : 1;
}

process.exitCode = main(process.argv.slice(2));
