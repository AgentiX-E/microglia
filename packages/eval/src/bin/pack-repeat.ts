#!/usr/bin/env node
/**
 * What two runs of one lane delivered differently, and how their scores differ per task.
 *
 *   pnpm tsx packages/eval/src/bin/pack-repeat.ts <control.json> <treatment.json>
 *
 * R120 and R119 ran one lane — one form, one split, one seed, one model, one `n` — and scored 0.600 and
 * 0.750. The difference is fifteen points, which is the half-width of the interval either run is measured
 * with, and neither artefact could say *which packs* differed: the census kept counts and dropped ids. A
 * difference larger than every effect this record has reported was unattributable to a claim.
 *
 * The ledger closes that, for the runs that carry one. This prints the positions two runs repacked and the
 * records that entered or left, beside the per-task flip table — the tasks that went from failing to passing
 * and the ones that went the other way. Both are read with their denominators, because a flip table over
 * forty tasks has no interval of its own: the counts are exact and their *significance* is what the run's
 * own half-width decides, and that is printed for the reader rather than left to arithmetic in a message.
 *
 * Absence is stated, never counted: an artefact written before the ledger existed says so. Its score
 * comparison is still printed, because that reading does not depend on the ledger.
 */
import { existsSync, readFileSync } from 'node:fs';
import { independenceOf, rateLineOf, trialRateOf } from '../arm-rate.js';
import { ledgerDiff, ledgerLineOf } from '../tau2-pack.js';

type TaskRow = { readonly id?: string; readonly successes?: number; readonly trials?: number };
type Artefact = {
  readonly metrics?: { readonly pass4?: number; readonly tasks?: number };
  readonly tau2?: { readonly pack?: { readonly ledger?: readonly (readonly string[])[] } };
  readonly per_task?: readonly TaskRow[];
};

function load(path: string): Artefact {
  if (!existsSync(path)) {
    process.stderr.write(`[pack-repeat] ${path} does not exist\n`);
    process.exit(2);
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Artefact;
  } catch {
    process.stderr.write(`[pack-repeat] ${path} is not readable JSON\n`);
    process.exit(2);
  }
}

/** `pass^k` on one task, which for k = trials is one exactly when every trial passed. */
function passed(row: TaskRow): boolean | null {
  const successes = row.successes;
  const trials = row.trials;
  if (successes === undefined || trials === undefined || trials === 0) return null;
  return successes === trials;
}

const [controlPath, treatmentPath] = process.argv.slice(2);
if (controlPath === undefined || treatmentPath === undefined) {
  process.stderr.write('[pack-repeat] usage: pack-repeat.ts <control.json> <treatment.json>\n');
  process.exit(2);
}

const control = load(controlPath);
const treatment = load(treatmentPath);

// The rate before the headline, because the headline is a nonlinear function of it and at forty tasks the
// one can move by fifteen points while the other moves by half a point. Both are printed with their own
// interval: the rate is measured over episodes, the headline over tasks, and a factor of three separates them.
const controlRate = trialRateOf(control.per_task ?? []);
const treatmentRate = trialRateOf(treatment.per_task ?? []);
process.stdout.write(`${rateLineOf('control', controlRate)}\n`);
process.stdout.write(`${rateLineOf('treatment', treatmentRate)}\n`);
const implied = independenceOf(treatmentRate);
process.stdout.write(
  `headline if the rate were the only thing that moved: ${implied === null ? 'absent' : implied.toFixed(4)}` +
    `${treatment.metrics?.pass4 === undefined ? '' : ` against the measured ${treatment.metrics.pass4.toFixed(4)}`}\n`,
);

const left = control.per_task ?? [];
const right = new Map((treatment.per_task ?? []).map((row) => [row.id ?? '', row]));
let bothPass = 0;
let bothFail = 0;
let gained = 0;
let lost = 0;
let unpaired = 0;
for (const row of left) {
  const id = row.id ?? '';
  const other = right.get(id);
  const before = passed(row);
  if (other === undefined || before === null) {
    unpaired += 1;
    continue;
  }
  const after = passed(other);
  if (after === null) {
    unpaired += 1;
    continue;
  }
  if (before && after) bothPass += 1;
  else if (!before && !after) bothFail += 1;
  else if (!before && after) gained += 1;
  else lost += 1;
}
const paired = bothPass + bothFail + gained + lost;

const before = control.metrics?.pass4;
const after = treatment.metrics?.pass4;
const score =
  before === undefined || after === undefined
    ? 'score: absent (one file carries no pass4)'
    : `score: ${before.toFixed(4)} → ${after.toFixed(4)} (${((after - before) * 100).toFixed(2)}pp) over ` +
      `${String(control.metrics?.tasks ?? 0)} and ${String(treatment.metrics?.tasks ?? 0)} task(s)`;
process.stdout.write(`${score}\n`);

process.stdout.write(
  `tasks: ${String(paired)} paired, ${String(bothPass)} passed both, ${String(bothFail)} failed both, ` +
    `${String(gained)} gained, ${String(lost)} lost` +
    `${unpaired === 0 ? '' : `, ${String(unpaired)} unpaired`}\n`,
);

// A flip that one run gained and another lost is the only part of the score a repack can explain, and it
// is stated as a count rather than as a rate: over forty tasks a rate reads as precision it does not have.
if (gained !== 0 || lost !== 0) {
  process.stdout.write(
    `attributable: ${String(gained + lost)} of ${String(paired)} task(s) changed side; ` +
      `the net is ${String(gained - lost)} task(s)\n`,
  );
}

const controlLedger = control.tau2?.pack?.ledger;
const treatmentLedger = treatment.tau2?.pack?.ledger;
const diff =
  controlLedger === undefined || treatmentLedger === undefined
    ? undefined
    : ledgerDiff(controlLedger, treatmentLedger);
process.stdout.write(`${ledgerLineOf(diff)}\n`);
