/**
 * Emit the recall floor a pre-registration is permitted to apply.
 *
 * A registration with no `recallFloor` header emits `0`, which keeps every
 * earlier dispatch on the as-is configuration. A registration that declares a
 * non-zero floor must agree with the floor recomputed from the R47 committed
 * histogram under the registered cost weights; otherwise the dispatch is
 * refused before the first model call. The lane reads this number into
 * `TAU_MIN_COVERAGE`, so the floor cannot be supplied from the dispatch menu
 * and cannot be chosen after the readout.
 *
 * Usage: pnpm eval:prereg-floor prereg/<id>.md
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readPrereg } from '../prereg.js';
import {
  AS_IS_FLOOR,
  committedFloor,
  resolveRecallFloor,
  U3_COST_WEIGHTS,
} from '../tau2-recall-floor.js';
import type { CoverageHistogram, UseCensus } from '../tau2-use-census.js';

const FIXTURE = join(process.cwd(), 'eval/fixtures/tau2-r47-coverage-histogram.json');

type Fixture = {
  readonly source: { readonly run: string; readonly pinnedCommit: string; readonly arm: string };
  readonly coverage: CoverageHistogram;
  readonly use: UseCensus;
};

function refuse(message: string): void {
  process.stderr.write(`[prereg-floor] ${message}\n`);
  process.exitCode = 1;
}

function main(): void {
  const file = process.argv[2];
  if (file === undefined) {
    refuse('usage: pnpm eval:prereg-floor prereg/<id>.md');
    return;
  }

  const reading = readPrereg(readFileSync(file, 'utf8'), file);
  if (reading.prereg === undefined) {
    for (const problem of reading.problems) {
      refuse(`at ${problem.where}: ${problem.problem}`);
    }
    return;
  }

  const declared = reading.prereg.recallFloor ?? AS_IS_FLOOR;
  if (declared !== AS_IS_FLOOR) {
    try {
      resolveRecallFloor({ TAU_MIN_COVERAGE: String(declared) });
    } catch (error) {
      refuse(`declared floor ${declared} is not a registered grid rung: ${String(error)}`);
      return;
    }
    const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Fixture;
    const computed = committedFloor(fixture.coverage, fixture.use, U3_COST_WEIGHTS);
    if (computed !== declared) {
      refuse(`${file} declares ${declared}, but the committed ${fixture.source.run} curve computes ${computed}`);
      return;
    }
  }

  process.stdout.write(String(declared));
}

main();
