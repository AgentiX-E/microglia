/**
 * Emit the matrix a pre-registration's planted arms fan out into.
 *
 * R57 dispatched its three distractor arms one at a time. `TAU_PLANTED_RULES` is a repository
 * variable, a variable is global, and the dispatch menu has no slot left at twenty-five inputs — so
 * "run the ladder" was three six-hour dispatches that could not overlap, and the next experiment was
 * one forgotten `PATCH` away from measuring a distractor nobody asked for. The arm is a property of
 * the experiment, so it belongs in the registration beside the scenario pair and the recall floor,
 * and the workflow turns the list into one job per arm.
 *
 * The output is the JSON array `strategy.matrix.arm` consumes. A registration with no header emits
 * `[""]`: one leg, no plant, which is what every dispatch before R57 was — and `""` is the value the
 * driver already reads as "plant nothing", so the empty leg needs no branch anywhere in the lane.
 *
 * Usage: pnpm eval:prereg-arms prereg/<id>.md
 *
 * `--csv` prints the arms as a comma-separated list instead of a JSON matrix, and prints nothing at
 * all when the header names no arm beyond the two baselines. That is what the dispatch needs: an
 * empty `SOTA_ARMS` used to fall back to a hard-coded `gated,oracle`, so a registration declaring
 * `arms: full` ran two planted arms it never asked for — R72 bought 7,235 calls of the wrong
 * experiment that way. The registration is the commitment, so it is also the default.
 */
import { readFileSync } from 'node:fs';
import { essentialArms, plantedArmMatrix, readPrereg } from '../prereg.js';

function refuse(message: string): void {
  process.stderr.write(`[prereg-arms] ${message}\n`);
  process.exitCode = 1;
}

function main(): void {
  const csv = process.argv.includes('--csv');
  const file = process.argv.slice(2).find((entry) => !entry.startsWith('--'));
  if (file === undefined) {
    refuse('usage: pnpm eval:prereg-arms [--csv] prereg/<id>.md');
    return;
  }

  const reading = readPrereg(readFileSync(file, 'utf8'), file);
  if (reading.prereg === undefined) {
    for (const problem of reading.problems) {
      refuse(`at ${problem.where}: ${problem.problem}`);
    }
    return;
  }

  if (csv) {
    const arms = essentialArms(reading.prereg.arms);
    process.stdout.write(arms.join(','));
    // The empty list is a fact worth printing on the run's page: it says the file asked for the two
    // baselines and nothing else, which is different from a file whose header failed to parse.
    process.stderr.write(`[prereg-arms] ${file}: ${arms.join(',') || 'baselines only'}\n`);
    return;
  }

  const arms = plantedArmMatrix(reading.prereg);
  process.stdout.write(JSON.stringify(arms));
  // One line on the run's own page: three legs dispatched from a registration should say which,
  // and an arm list read from a file is exactly the kind of thing that is silently empty.
  process.stderr.write(`[prereg-arms] ${file}: ${arms.join(', ') || 'no arm'}\n`);
}

main();
