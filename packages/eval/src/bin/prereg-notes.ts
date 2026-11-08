/**
 * Emit whether a pre-registration runs R53's three note levels as three facades.
 *
 * `sota.yml` reads this into `TAU_FACADE_NOTES`. The dispatch menu cannot turn the arm on:
 * the registration is the only source of truth, and the level set is fixed (`none`,
 * `standard`, `hardened`) rather than supplied — a run that chose its levels after the
 * readout would be choosing its contrasts.
 *
 * Usage: pnpm eval:prereg-notes prereg/<id>.md  ->  "true" | "false"
 */
import { readFileSync } from 'node:fs';
import { readPrereg } from '../prereg.js';

function refuse(message: string): void {
  process.stderr.write(`[prereg-notes] ${message}\n`);
  process.exitCode = 1;
}

function main(): void {
  const file = process.argv[2];
  if (file === undefined) {
    refuse('usage: pnpm eval:prereg-notes prereg/<id>.md');
    return;
  }
  const reading = readPrereg(readFileSync(file, 'utf8'), file);
  if (reading.prereg === undefined) {
    for (const problem of reading.problems) refuse(`at ${problem.where}: ${problem.problem}`);
    return;
  }
  process.stdout.write(reading.prereg.facadeNotes === 'three-level' ? 'true' : 'false');
}

main();
