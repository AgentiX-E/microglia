/**
 * Emit whether a pre-registration registers a within-run paired facade.
 *
 * `sota.yml` reads this into `TAU_FACADE_PAIR`. The dispatch menu cannot turn
 * on a pair: the registration is the only source of truth, and it must also
 * declare a positive `recallFloor` (checked by `readPrereg`). `prereg-floor.ts`
 * separately recomputes that floor from the committed R47 curve under the
 * registered cost weights, so neither the pair nor its treatment can be chosen
 * after the readout.
 *
 * Usage: pnpm eval:prereg-pair prereg/<id>.md  ->  "true" | "false"
 */
import { readFileSync } from 'node:fs';
import { facadePairSwitch, readPrereg } from '../prereg.js';
import { AS_IS_FLOOR, resolveRecallFloor } from '../tau2-recall-floor.js';

function refuse(message: string): void {
  process.stderr.write(`[prereg-pair] ${message}\n`);
  process.exitCode = 1;
}

function main(): void {
  const file = process.argv[2];
  if (file === undefined) {
    refuse('usage: pnpm eval:prereg-pair prereg/<id>.md');
    return;
  }
  const reading = readPrereg(readFileSync(file, 'utf8'), file);
  if (reading.prereg === undefined) {
    for (const problem of reading.problems) refuse(`at ${problem.where}: ${problem.problem}`);
    return;
  }
  if (!facadePairSwitch(reading.prereg)) {
    process.stdout.write('false');
    return;
  }
  const floor = reading.prereg.recallFloor ?? AS_IS_FLOOR;
  try {
    resolveRecallFloor({ TAU_MIN_COVERAGE: String(floor) });
  } catch (error) {
    refuse(`declared floor ${floor} is not a registered grid rung: ${String(error)}`);
    return;
  }
  process.stdout.write('true');
}

main();
