/**
 * The reading R73's writer gets, recomputed from an artefact.
 *
 * The arm costs one call per question and the number it produces has to be a computation over the
 * file rather than a second dispatch: the writer's assertions are recorded beside the candidates they
 * were scored against, so this command re-derives the four signals — the three kinds separately and
 * their sum — with no model at all.
 *
 * The three kinds separately is the point of the registration. A combined number can say that the
 * writer helped or did not; it cannot say which sentence carried it, and the next iteration's choice
 * depends on exactly that: a `rows:` assertion is a shape signal this lane already knows is inert,
 * while a `column:` assertion is the content claim nobody here has priced without a model.
 *
 *   pnpm eval:assertion                      # the artefact `chooseArtefact` picks
 *   pnpm eval:assertion --bird path.json     # one file
 *
 * Zero calls. A file whose writer did not run prints "no population" rather than chance, which is
 * the distinction the content readings made and the reason the count is printed beside the table.
 */
import { readFileSync } from 'node:fs';
import {
  assertionPopulation,
  assertionReadings,
  shapeOf,
  type Assertions,
  type PoolCandidate,
  type PoolQuestion,
} from '@agentix-e/microglia-eval';
import { birdArtefactPath } from './lib.js';

type Row = {
  readonly question?: string | null;
  readonly evidence?: string | null;
  readonly pool?: readonly PoolCandidate[] | null;
  readonly assertions?: Assertions | null;
};

type Artefact = {
  readonly per_case: readonly Row[];
};

export function main(argv: readonly string[]): number {
  const index = argv.indexOf('--bird');
  const path = index === -1 ? birdArtefactPath() : (argv[index + 1] ?? birdArtefactPath());
  const artefact = JSON.parse(readFileSync(path, 'utf8')) as Artefact;

  const questions: (PoolQuestion & { readonly assertions?: Assertions })[] = [];
  for (const row of artefact.per_case) {
    const pool = row.pool ?? [];
    if (pool.length === 0) continue;
    questions.push({
      id: `${String(row.question ?? '')}`,
      shape: shapeOf(row.question ?? '', row.evidence ?? ''),
      candidates: pool,
      question: row.question ?? undefined,
      ...(row.assertions === null || row.assertions === undefined
        ? {}
        : { assertions: row.assertions }),
    });
  }

  const written = assertionPopulation(questions);
  process.stdout.write(
    `[assertion] ${String(questions.length)} question(s) with a pool, ` +
      `${String(written)} with assertions from a writer\n`,
  );
  if (written === 0) {
    process.stdout.write(
      '[assertion] no population — this artefact carries no assertions; the arm did not run\n',
    );
    return 0;
  }

  const readings = assertionReadings(questions);
  process.stdout.write('[assertion] signal              auc    95% CI            top pick   eligible\n');
  for (const reading of readings) {
    const low = reading.aucLow.toFixed(3);
    const high = reading.aucHigh.toFixed(3);
    process.stdout.write(
      `[assertion] ${reading.signal.padEnd(18)} ${reading.auc.toFixed(3)}  ` +
        `[${low}, ${high}]`.padEnd(18) +
        `${(reading.accuracy * 100).toFixed(2).padStart(7)}%` +
        `${String(reading.eligible).padStart(10)}\n`,
    );
  }
  return 0;
}

process.exitCode = main(process.argv.slice(2));
