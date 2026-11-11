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
 *
 * The `--with` form exists because R68's Amendment 1 requires it: the readback intersects this run's
 * question ids with R67's **before computing anything**, so a question one run lost to a provider failure
 * cannot make the selector and the ceiling numbers refer to different populations.
 *
 * Arms are read off the artefact by name, not assumed to exist. Every reading names the arms it found and
 * the ones it did not, because a share computed from a missing arm would be a number about two arms
 * wearing a third's name.
 */
import { readFileSync } from 'node:fs';
import { sharedCases, widthShare, type WidthCase } from '@agentix-e/microglia-eval';
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

/** The three arms a width dispatch buys, by the name the artefact uses. */
const SELECTED = 'sample-5-exec';
const FIRST = 'sample-5-first';
const ORACLE = 'sample-5-oracle';

function read(path: string): { readonly cases: readonly WidthCase[]; readonly arms: readonly string[] } {
  const artefact = JSON.parse(readFileSync(path, 'utf8')) as Artefact;
  const arms = artefact.config?.arms ?? [];
  const cases: WidthCase[] = [];
  for (const row of artefact.per_case) {
    const id = row.questionId ?? row.id;
    if (id === null || id === undefined) continue;
    const marks = row.arms;
    if (marks === undefined) continue;
    const first = marks[FIRST];
    const selected = marks[SELECTED];
    const oracle = marks[ORACLE];
    // A question missing any of the three is excluded rather than defaulted: `false` is a scored wrong
    // answer for every arm, so a missing mark that became `false` would depress all three rates equally
    // and shrink the denominator that the share divides by.
    if (first === undefined || selected === undefined || oracle === undefined) continue;
    cases.push({ id: String(id), first, selected, oracle });
  }
  return { cases, arms };
}

function main(argv: readonly string[]): number {
  const at = argv.indexOf('--bird');
  const path = at === -1 ? birdArtefactPath() : (argv[at + 1] ?? birdArtefactPath());
  const withAt = argv.indexOf('--with');
  const primary = read(path);

  if (primary.cases.length === 0) {
    process.stdout.write(
      `[width] ${path}: no question carries all three of ${FIRST}, ${SELECTED}, ${ORACLE}\n` +
        `[width] arms this artefact bought: ${primary.arms.join(', ') || 'none recorded'}\n`,
    );
    return 1;
  }

  let cases = primary.cases;
  if (withAt !== -1) {
    const other = argv[withAt + 1];
    if (other === undefined) {
      process.stdout.write('[width] --with needs a path\n');
      return 1;
    }
    const between = read(other);
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
    `[width] ${cases.length} question(s): first ${pct(reading.first * 100)}%, ` +
      `selected ${pct(reading.selected * 100)}%, oracle ${pct(reading.oracle * 100)}%\n` +
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
    process.stdout.write(`[width] verdict ${verdict}: the interval ${low > 0 ? 'excludes' : high < 0 ? 'lies below' : 'covers'} zero\n`);
  }
  return 0;
}

process.exitCode = main(process.argv.slice(2));
