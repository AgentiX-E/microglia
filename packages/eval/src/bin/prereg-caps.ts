/**
 * Emit the two task caps a pre-registration pins, when it pins them.
 *
 * R86 was dispatched with one number. `l4_tasks = 10` became `TAU_MAX_TASKS = 10`, which slices the
 * evaluated list, and the plan splits that slice in half — so a census of distillation faults bought
 * five learning tasks, one failed, and the instrument was asked once instead of fifteen times. The cap
 * was never wrong; using one number for two populations was.
 *
 * Two lines rather than one token, for the reason `prereg-scenario` prints three: `sota.yml` reads each
 * into its own variable, and an expression that split a string would be a parser in YAML. A
 * registration that pins nothing prints two empty lines and the repository variables stand.
 *
 * Usage: pnpm eval:prereg-caps prereg/<id>.md  ->  "train=57" "test=1"
 */
import { readFileSync } from 'node:fs';
import { readPrereg } from '../prereg.js';

function refuse(message: string): void {
  process.stderr.write(`[prereg-caps] ${message}\n`);
  process.exitCode = 1;
}

function main(): void {
  const file = process.argv[2];
  if (file === undefined) {
    refuse('usage: pnpm eval:prereg-caps prereg/<id>.md');
    return;
  }
  const reading = readPrereg(readFileSync(file, 'utf8'), file);
  if (reading.prereg === undefined) {
    for (const problem of reading.problems) refuse(`at ${problem.where}: ${problem.problem}`);
    return;
  }
  const { trainTasks, testTasks } = reading.prereg;
  // Half a pin is the defect this exists to remove: a registration that fixes the learning half and
  // leaves the evaluation to a variable would have its cost decided by whichever dispatch ran last.
  const pinned = [trainTasks, testTasks].filter((entry) => entry !== undefined);
  if (pinned.length === 1) {
    refuse(`${file} pins ${String(pinned.length)} of 2 caps: declare trainTasks and testTasks together`);
    return;
  }
  process.stdout.write(`train=${trainTasks === undefined ? '' : String(trainTasks)}\n`);
  process.stdout.write(`test=${testTasks === undefined ? '' : String(testTasks)}\n`);
}

main();
