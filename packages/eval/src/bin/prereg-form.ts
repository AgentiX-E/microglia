/**
 * Emit the distiller form a pre-registration fixes, or refuse the dispatch that would run another one.
 *
 * R56's treatment is a single switch, and until now the only way to set it was `vars.TAU_DISTILL_FORM`
 * — a repository variable. A variable is global: it is one experiment's setting applied to every queued
 * dispatch, two forms cannot be run side by side, and a forgotten value keys a run that its registration
 * never described. The record has closed this shape twice (the model in R68, the thinking regime in R84)
 * and this is the third instance of the same defect, found by writing the registration for the switch.
 *
 * Both arguments are passed in because neither representation may overwrite the other in silence: the
 * variable is what the workflow would run, the header is what the experiment says it runs, and a stated
 * disagreement is a refusal rather than a note. An unset variable is not a second opinion.
 *
 * Usage: pnpm eval:prereg-form prereg/<id>.md [configured-form] [configured-unit]
 *   -> prints "form=<value>" and exits 0, or prints the reason to stderr and exits 1.
 */
import { readFileSync } from 'node:fs';
import { distillFormProblem, readPrereg } from '../prereg.js';

function refuse(message: string): void {
  process.stderr.write(`[prereg-form] ${message}\n`);
  process.exitCode = 1;
}

function main(): void {
  const file = process.argv[2];
  if (file === undefined) {
    refuse('usage: pnpm eval:prereg-form prereg/<id>.md [configured-form] [configured-unit]');
    return;
  }
  const configured = process.argv[3] ?? '';
  const unit = (process.argv[4] ?? '').trim() === 'trace' ? 'trace' : 'correction';
  const reading = readPrereg(readFileSync(file, 'utf8'), file);
  if (reading.prereg === undefined) {
    for (const problem of reading.problems) refuse(`at ${problem.where}: ${problem.problem}`);
    return;
  }
  const declared = reading.prereg.distillForm;
  const problem = distillFormProblem(configured, declared, unit);
  if (problem !== undefined) {
    refuse(problem);
    return;
  }
  // The header wins when it names one, because `distillFormProblem` has already refused the case where
  // the two disagree. Empty means the variable stands, exactly as it did before this script existed.
  process.stdout.write(`form=${declared ?? ''}\n`);
}

main();
