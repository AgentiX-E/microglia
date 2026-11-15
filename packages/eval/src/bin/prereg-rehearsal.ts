/**
 * Emit whether a pre-registration buys R132's replay of the learn half against its own store.
 *
 * `sota.yml` reads this into `TAU_REHEARSAL`. The dispatch menu cannot turn it on: the replay is a second paid
 * phase over the same store, so the registration is the only source of truth — a run that decided to buy a
 * reading after the readout would be choosing its evidence.
 *
 * The value is a boolean and nothing else. `rehearsal: true` with no evaluation would be a phase buying rewards
 * nothing pairs against, so `readPrereg` refuses it against `learnOnly` and this program refuses to print `true`
 * for a registration that failed to parse: an unreadable header is an error, not an arm.
 *
 * Usage: pnpm eval:prereg-rehearsal prereg/<id>.md  ->  "true" | "false"
 */
import { readFileSync } from 'node:fs';
import { readPrereg } from '../prereg.js';

function refuse(message: string): void {
  process.stderr.write(`[prereg-rehearsal] ${message}\n`);
  process.exitCode = 1;
}

function main(): void {
  const file = process.argv[2];
  if (file === undefined) {
    refuse('usage: pnpm eval:prereg-rehearsal prereg/<id>.md');
    return;
  }
  const reading = readPrereg(readFileSync(file, 'utf8'), file);
  if (reading.prereg === undefined) {
    for (const problem of reading.problems) refuse(`at ${problem.where}: ${problem.problem}`);
    return;
  }
  process.stdout.write(reading.prereg.rehearsal === true ? 'true' : 'false');
}

main();
