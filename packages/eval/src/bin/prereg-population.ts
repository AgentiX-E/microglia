/**
 * Emit the population a pre-registration scores, so the dispatch menu stops being a second claim.
 *
 * `sample` has been in every header since the first registration and nothing ever compared it with
 * what the lane drew: the workflow's `limit` input defaulted to `0` ("every usable question"), the
 * menu's number was copied by hand when somebody remembered, and the artefact then reported a
 * population the registration had not sized. That is the same shape as R67's arm list, which was
 * read from a menu default while its file said something else, and it has now been fixed the same
 * way: the file that declares the experiment supplies the number.
 *
 * `offset` is the second half of the same fact. A `loo` draw is a (rule, question) pair and cannot
 * be drawn twice — the same pack, the same withheld rule and temperature zero are the same call — so
 * a top-up of draws is a claim about *different* questions. `SOTA_LIMIT` can only ever hand back a
 * prefix of the corpus, which is why R78 was first written as "the same 2,000 questions, more
 * draws": a dispatch that would have re-bought every pair R77 had already spent. An offset names
 * where the slice starts, and it belongs beside the sample for the same reason.
 *
 * Empty output means the registration says nothing: `offset` is zero for every file written before
 * R78, and `sample` is required by the header validator, so an empty `sample` is a file that failed
 * to parse and is refused rather than defaulted.
 *
 * Usage: pnpm eval:prereg-population --field sample prereg/<id>.md
 *        pnpm eval:prereg-population --field offset prereg/<id>.md
 */
import { readFileSync } from 'node:fs';
import { readPrereg } from '../prereg.js';

function refuse(message: string): void {
  process.stderr.write(`[prereg-population] ${message}\n`);
  process.exitCode = 1;
}

function main(): void {
  const args = process.argv.slice(2);
  const at = args.indexOf('--field');
  const field = at === -1 ? undefined : args[at + 1];
  const file = args.find((entry, index) => !entry.startsWith('--') && index !== at + 1);

  if ((field !== 'sample' && field !== 'offset') || file === undefined) {
    refuse('usage: pnpm eval:prereg-population --field sample|offset prereg/<id>.md');
    return;
  }

  let markdown: string;
  try {
    markdown = readFileSync(file, 'utf8');
  } catch {
    // The scheduled run has no registration, and the lane refuses a dispatch that names a missing
    // file a step later. An empty value keeps this script about the population rather than about
    // registration existence, and the workflow then falls back to its own default.
    process.stdout.write('');
    process.stderr.write(`[prereg-population] ${file}: no such file, lane default\n`);
    return;
  }

  const reading = readPrereg(markdown, file);
  if (reading.prereg === undefined) {
    for (const problem of reading.problems) {
      refuse(`at ${problem.where}: ${problem.problem}`);
    }
    return;
  }

  const value = field === 'sample' ? String(reading.prereg.sample) : reading.prereg.offset;
  process.stdout.write(value === undefined ? '' : String(value));
  // On the run's own page: a population read from a file is exactly the number a reader assumes the
  // dispatch menu set, and zero is a legal offset that looks like "nothing was said".
  process.stderr.write(
    `[prereg-population] ${file}: ${field} = ${value === undefined ? 'unset' : String(value)}\n`,
  );
}

main();
