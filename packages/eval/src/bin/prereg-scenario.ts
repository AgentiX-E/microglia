/**
 * Emit the scenario pair a pre-registration executes, when it pins one.
 *
 * R51 registered three predictions about a within-scenario run and was dispatched against a
 * repository variable that said `TAU_TEST_DOMAIN=airline`, so its readback graded a retail
 * store answering airline questions. Nothing in the artefact was wrong: the run measured
 * exactly what it was configured to measure, and that configuration was invisible in the
 * registration. The scenario is a property of the experiment, like the recall floor, and a
 * property of the experiment belongs beside the predictions.
 *
 * Three lines rather than one token, because `sota.yml` reads each into its own variable and
 * an expression that split a string would be a parser in YAML. A registration that pins
 * nothing prints three empty lines, and the workflow falls back to the repository variables
 * exactly as it did before this script existed.
 *
 * Usage: pnpm eval:prereg-scenario prereg/<id>.md  ->  "train=<domain>" "test=<domain>" "recall=<domain>"
 */
import { readFileSync } from 'node:fs';
import { readPrereg } from '../prereg.js';

function refuse(message: string): void {
  process.stderr.write(`[prereg-scenario] ${message}\n`);
  process.exitCode = 1;
}

function main(): void {
  const file = process.argv[2];
  if (file === undefined) {
    refuse('usage: pnpm eval:prereg-scenario prereg/<id>.md');
    return;
  }
  const reading = readPrereg(readFileSync(file, 'utf8'), file);
  if (reading.prereg === undefined) {
    for (const problem of reading.problems) refuse(`at ${problem.where}: ${problem.problem}`);
    return;
  }
  const { trainDomain, testDomain, recallDomain } = reading.prereg;
  // A registration that pins one of the three and not the others would leave the rest to a
  // variable, which is the defect this script exists to remove. `readPrereg` refuses a lone
  // `recallDomain`; this refuses a lone train or test.
  const pinned = [trainDomain, testDomain, recallDomain].filter((entry) => entry !== undefined);
  if (pinned.length !== 0 && pinned.length !== 3) {
    refuse(`${file} pins ${pinned.length} of 3 domains: declare trainDomain, testDomain and recallDomain together`);
    return;
  }
  process.stdout.write(
    `train=${trainDomain ?? ''}\ntest=${testDomain ?? ''}\nrecall=${recallDomain ?? ''}\n`,
  );
}

main();
