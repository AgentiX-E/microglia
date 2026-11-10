/**
 * Emit the sampling temperature a pre-registration runs at, so the workflow can unset its variable.
 *
 * `SOTA_SAMPLE_TEMPERATURE` was a repository variable. That is the correct shape for a *lane-wide*
 * default and the wrong shape for an experiment: R69 measures a pool at the lane's 0.7 and R70
 * measures the same arms at 1.0, and on a variable that is two dispatches separated by a mutation
 * that every queued run inherits — including one dispatched in between, which would then measure
 * neither temperature and report the lane's.
 *
 * The arms already come from the registration (`prereg-arms.ts`) for exactly this reason. This is
 * the same fix for the second knob: a property of the experiment is read from the file that
 * declares the experiment.
 *
 * Output is the bare number on stdout, or the empty string when the registration declares none —
 * the workflow treats empty as "keep the lane's default", so a registration that says nothing about
 * temperature behaves exactly like every registration written before this one.
 *
 * Usage: pnpm eval:prereg-temperature prereg/<id>.md
 */
import { readFileSync } from 'node:fs';
import { readPrereg } from '../prereg.js';

function refuse(message: string): void {
  process.stderr.write(`[prereg-temperature] ${message}\n`);
  process.exitCode = 1;
}

function main(): void {
  const file = process.argv[2];
  if (file === undefined) {
    refuse('usage: pnpm eval:prereg-temperature prereg/<id>.md');
    return;
  }

  let markdown: string;
  try {
    markdown = readFileSync(file, 'utf8');
  } catch {
    // A dispatch with no registration is legitimate (the scheduled run has none) and must not be
    // stopped here: the lane's own gate refuses a missing registration a step later. Reporting an
    // empty value keeps this script about temperature rather than about registration existence.
    process.stdout.write('');
    process.stderr.write(`[prereg-temperature] ${file}: no such file, lane default\n`);
    return;
  }

  const reading = readPrereg(markdown, file);
  if (reading.prereg === undefined) {
    for (const problem of reading.problems) {
      refuse(`at ${problem.where}: ${problem.problem}`);
    }
    return;
  }

  const temperature = reading.prereg.sampleTemperature;
  process.stdout.write(temperature === undefined ? '' : String(temperature));
  // On the run's own page, because a temperature read from a file is exactly the kind of value a
  // reader assumes the dispatch menu set.
  process.stderr.write(
    `[prereg-temperature] ${file}: ${temperature === undefined ? 'lane default' : String(temperature)}\n`,
  );
}

main();
