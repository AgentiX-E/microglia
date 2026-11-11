/**
 * R68's reading: how much of the ceiling the selectors captured, intersected with R67's questions.
 *
 * Three arms of the same dispatch answer the same question three ways — take draw one, take the
 * selector's pick, take whichever draw was right — and the number that decides whether breadth is worth
 * its calls is not any of their accuracies but the ratio of the two differences between them.
 *
 *   pnpm eval:width-share                                   # the artefact `chooseArtefact` picks
 *   pnpm eval:width-share --bird a.json                     # one artefact
 *   pnpm eval:width-share --bird a.json --with b.json        # intersect with a second artefact
 *   pnpm eval:width-share --bird a.json --selected sample-5-assert
 *
 * The `--with` form exists because R68's Amendment 1 requires it: the readback intersects this run's
 * question ids with R67's **before computing anything**, so a question one run lost to a provider failure
 * cannot make the selector and the ceiling numbers refer to different populations.
 *
 * `--selected` exists because R80 buys `sample-5-assert` instead of `sample-5-exec`: the first and oracle
 * arms keep their names, the middle one does not, and a reading hard-coded to `exec` would have reported
 * a ceiling with an arm that dispatch never ran.
 *
 * Arms are read off the artefact by name, not assumed to exist. Every reading names the arms it found and
 * the ones it did not, because a share computed from a missing arm would be a number about two arms
 * wearing a third's name.
 */
import { readFileSync } from 'node:fs';
import {
  selectedArmProblem,
  sharedCases,
  widthArguments,
  widthCases,
  widthShare,
  type WidthCase,
} from '@agentix-e/microglia-eval';
import { birdArtefactPath } from './lib.js';

type Row = {
  readonly questionId?: string | number | null;
  readonly id?: string | number | null;
  readonly arms?: Readonly<Record<string, boolean>> | undefined;
};

type Artefact = {
  readonly per_case: readonly Row[];
  readonly config?: { readonly arms?: readonly string[] };
};

/** The two arms a width dispatch always buys under these names, whatever the selector is called. */
const FIRST = 'sample-5-first';
const ORACLE = 'sample-5-oracle';

function read(
  path: string,
  selectedArm: string,
): { readonly cases: readonly WidthCase[]; readonly arms: readonly string[] } {
  const artefact = JSON.parse(readFileSync(path, 'utf8')) as Artefact;
  const arms = artefact.config?.arms ?? [];
  const rows = artefact.per_case.map((row) => ({ id: row.questionId ?? row.id, marks: row.arms }));
  return { cases: widthCases(rows, { first: FIRST, selected: selectedArm, oracle: ORACLE }), arms };
}

function main(argv: readonly string[]): number {
  let args;
  try {
    args = widthArguments(argv);
  } catch (error) {
    process.stdout.write(`[width] ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
  const path = args.bird ?? birdArtefactPath();
  const { arm, explicit } = args.selected;
  const primary = read(path, arm);

  // A named arm the artefact never bought is the caller's mistake and is reported as one, before any
  // number is printed: the alternative is a reading that divides by an arm with no marks at all.
  const problem = explicit ? selectedArmProblem(arm, primary.arms) : null;
  if (problem !== null) {
    process.stdout.write(`[width] ${problem}\n`);
    return 1;
  }

  if (primary.cases.length === 0) {
    process.stdout.write(
      `[width] ${path}: no question carries all three of ${FIRST}, ${arm}, ${ORACLE}\n` +
        `[width] arms this artefact bought: ${primary.arms.join(', ') || 'none recorded'}\n`,
    );
    return 1;
  }

  let cases = primary.cases;
  if (args.with !== null) {
    const between = read(args.with, arm);
    cases = sharedCases(primary.cases, between.cases);
    process.stdout.write(
      `[width] intersection ${cases.length} of ${primary.cases.length} and ${between.cases.length}\n`,
    );
    if (cases.length === 0) {
      process.stdout.write('[width] the two artefacts share no question, so there is nothing to compare\n');
      return 1;
    }
  }

  const reading = widthShare(cases);
  const pct = (value: number): string => value.toFixed(2);
  process.stdout.write(
    `[width] ${cases.length} question(s)${explicit ? `, selected = ${arm}` : ''}: ` +
      `first ${pct(reading.first * 100)}%, selected ${pct(reading.selected * 100)}%, ` +
      `oracle ${pct(reading.oracle * 100)}%\n` +
      `[width] ceiling ${pct(reading.ceilingPp)}pp, captured ${pct(reading.capturedPp)}pp\n`,
  );
  if (reading.share === null) {
    process.stdout.write('[width] share undefined: the pool has no ceiling to capture\n');
  } else {
    const interval =
      reading.interval === null
        ? `no interval (${String(reading.usableResamples)} resample(s) had a ceiling)`
        : `95% [${pct(reading.interval.low)}, ${pct(reading.interval.high)}]`;
    process.stdout.write(`[width] share ${pct(reading.share)} ${interval}\n`);
  }
  // The verdict this dispatch was registered to produce, stated as one of three rather than as a number
  // a reader has to compare against a bar they have to find.
  if (reading.share !== null && reading.interval !== null) {
    const { low, high } = reading.interval;
    const verdict = low > 0 ? 'CAPTURED' : high < 0 ? 'NEGATIVE' : 'INCONCLUSIVE';
    process.stdout.write(
      `[width] verdict ${verdict}: the interval ${low > 0 ? 'excludes' : high < 0 ? 'lies below' : 'covers'} zero\n`,
    );
  }
  return 0;
}

process.exitCode = main(process.argv.slice(2));
