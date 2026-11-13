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
 * R88 added a third line for the same reason the other two exist: `rawCeiling` is the number R85 was
 * mismeasured by, and a number that decides what an arm measures cannot live in a repository variable
 * where the last dispatch chooses it.
 *
 * R89 added the fourth, and it is the other half of the third. A ceiling is only a promise about what is
 * *written*: the pack charges a fixed wrapper plus a line per item, so at 1,200 characters a record in
 * this arm's shape can state 810 and anything longer is dropped at render, where every artefact this
 * lane has produced reports it as a request with nothing relevant. A registration that states both is
 * checked (`prereg.ts` refuses a ceiling above the capacity); a registration that states only the
 * ceiling inherits the lane's budget, and this script prints the capacity that implies on stderr, so the
 * mismatch is in the dispatch log even where it is not an error.
 *
 * R91 added the fifth: `storePin` is the learn half itself. R90's readback showed the store is a draw —
 * 12 corrections in R89 and 15 in R90 from the same 57 tasks at the same one trial, 8 ids in common — so
 * an arm that does not fix it cannot differ from its predecessor by one variable, whatever its header
 * says. A registration that names a pin rebuilds the same store and skips the episodes that produced it.
 *
 * R92 added the sixth: `taskSplit` says whose halves the arm runs on. τ² publishes 74 train / 40 test for
 * retail and this lane has always cut the 114 itself, so every held-out number it produced was measured
 * on a set the benchmark does not define — and ranking it against a competitor's 67.5% is comparing two
 * populations. `official` reads the boundary from the corpus.
 *
 * Usage: pnpm eval:prereg-caps prereg/<id>.md  ->  "train=57" "test=1" "ceiling=2000" "budget=2400" "pin=" "taskSplit="
 */
import { readFileSync } from 'node:fs';
import { readPrereg } from '../prereg.js';
import { packCouplingProblems, recordCapacityOf } from '../prereg-pack.js';
import { DEFAULT_PACK_BUDGET, ceilingLineOf } from '../tau2-pack.js';

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
  const { trainTasks, testTasks, rawCeiling, packBudget, storePin, taskSplit } = reading.prereg;
  // A ceiling the declared pack cannot carry is refused here rather than priced: the arm would write
  // records the renderer drops, every one of which reads as a request with nothing relevant, and the
  // dispatch costs more than the check does. Only a registration that states both is refused -- see
  // `prereg-pack.ts` for why the arms that predate the budget keep their reading.
  const coupling = packCouplingProblems(reading.prereg);
  if (coupling.length > 0) {
    for (const problem of coupling) refuse(`at ${problem.where}: ${problem.problem}`);
    return;
  }
  // Half a pin is the defect this exists to remove: a registration that fixes the learning half and
  // leaves the evaluation to a variable would have its cost decided by whichever dispatch ran last.
  const pinned = [trainTasks, testTasks].filter((entry) => entry !== undefined);
  if (pinned.length === 1) {
    refuse(`${file} pins ${String(pinned.length)} of 2 caps: declare trainTasks and testTasks together`);
    return;
  }
  process.stdout.write(`train=${trainTasks === undefined ? '' : String(trainTasks)}\n`);
  process.stdout.write(`test=${testTasks === undefined ? '' : String(testTasks)}\n`);
  process.stdout.write(`ceiling=${rawCeiling === undefined ? '' : String(rawCeiling)}\n`);
  process.stdout.write(`budget=${packBudget === undefined ? '' : String(packBudget)}\n`);
  // R91: the learn half, frozen to a list. A path rather than an id because the list is read in the
  // diff, and printed only where the registration states it -- a run without one rebuilds the half,
  // which is the behaviour every earlier arm had and must keep.
  process.stdout.write(`pin=${storePin === undefined ? '' : storePin}\n`);
  // R92: whose halves the arm runs on. Empty means this lane's own cut, which is what every arm before
  // R92 did; `official` reads the boundary from the corpus's own `split_tasks.json`, which is the only
  // one a competitor's number can be compared to.
  process.stdout.write(`taskSplit=${taskSplit === undefined ? '' : taskSplit}\n`);
  // The capacity that follows from the pair, on stderr because no workflow input reads it: the number
  // exists so the dispatch log answers "what could this pack carry" without a second dispatch. Only for
  // the record unit, whose item shape is the interpreter's; a claim's line is the model's.
  if (reading.prereg.distillUnit === 'raw') {
    const budget = packBudget ?? DEFAULT_PACK_BUDGET;
    process.stderr.write(
      `[prereg-caps] ${ceilingLineOf({
        ceiling: rawCeiling,
        budget,
        capacity: recordCapacityOf(reading.prereg),
      })}\n`,
    );
  }
}

main();
