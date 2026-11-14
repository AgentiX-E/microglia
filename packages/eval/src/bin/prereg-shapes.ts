/**
 * Emit whether a pre-registration runs R109a's two pack units as two facades.
 *
 * `sota.yml` reads this into `TAU_FACADE_SHAPES`. The dispatch menu cannot turn the arm on: the
 * registration is the only source of truth, and the unit set is fixed (`per-failure`, `collapse`) rather
 * than supplied — a run that chose its units after the readout would be choosing its contrasts.
 *
 * The two units are not two values of one knob: `packShape` is what a single-unit dispatch renders, and
 * this is the pair. A registration that named both would leave the driver two answers to one question,
 * which `readPrereg` refuses at read time and `resolveShapeArmPlan` refuses again before a model call.
 *
 * Usage: pnpm eval:prereg-shapes prereg/<id>.md  ->  "true" | "false"
 */
import { readFileSync } from 'node:fs';
import { readPrereg } from '../prereg.js';

function refuse(message: string): void {
  process.stderr.write(`[prereg-shapes] ${message}\n`);
  process.exitCode = 1;
}

function main(): void {
  const file = process.argv[2];
  if (file === undefined) {
    refuse('usage: pnpm eval:prereg-shapes prereg/<id>.md');
    return;
  }
  const reading = readPrereg(readFileSync(file, 'utf8'), file);
  if (reading.prereg === undefined) {
    for (const problem of reading.problems) refuse(`at ${problem.where}: ${problem.problem}`);
    return;
  }
  process.stdout.write(reading.prereg.facadeShapes === 'two-unit' ? 'true' : 'false');
}

main();
