/**
 * R39's reading: every arm in the record, repriced against its own resolution.
 *
 * `pnpm eval:power` audits one row per artefact and answers "could this run have seen the effect it
 * reported". Twenty artefacts is twenty answers, and the record's claims are not twenty — they are
 * the ninety-eight arm rows inside those artefacts, which is where `values` at +1.17pp and `linked`
 * at −9.26pp live. §25.7 left that gap open on a schema question; the answer is that an arm is a
 * column of a run and not a run, so it needs no validity schema and it does need the two arithmetic
 * columns this command computes.
 *
 * Three readings, each a different claim:
 *
 *  - **the ledger** — one row per published arm: its delta, the two bars it can be read against, and
 *    whether the printed number is the one its own counts imply.
 *  - **the price** — for every undecided row, how many questions the effect it found would need.
 *    A question that costs fifty thousand questions to answer is not a question this project can
 *    ask, and that is a result rather than a shrug.
 *  - **the replication** — each contrast name across the runs that measured it, with the decided
 *    ones counted separately. Two runs that disagree at 0.3pp each did not disagree; neither of them
 *    measured anything.
 *
 * No model call: every column is arithmetic over a committed artefact.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  armReadingOf,
  coverageGate,
  designFloors,
  priceGate,
  readResolution,
  reconcileGate,
  replicationsOf,
  shrinkageOf,
  type ArmReading,

} from '../resolution.js';
import { writeJson } from './lib.js';

const COMMITTED = join('eval', 'results');

type Row = {
  readonly arm: string;
  readonly n?: number;
  readonly gained?: number;
  readonly lost?: number;
  readonly delta_pp?: number;
  readonly deltaPp?: number;
};

type Artefact = {
  readonly id?: string;
  readonly dataset?: string;
  readonly arms?: readonly Row[];
  readonly arm_pairs?: readonly Row[];
  readonly n?: { readonly total?: number } | number;
};

const files = readdirSync(COMMITTED)
  .filter((name) => name.endsWith('.json'))
  .sort();

const readings: ArmReading[] = [];
const byArtefact: { artefact: string; dataset: string; rows: number; decided: number }[] = [];
let published = 0;
let skipped = 0;
let artefacts = 0;

for (const file of files) {
  let parsed: Artefact;
  try {
    parsed = JSON.parse(readFileSync(join(COMMITTED, file), 'utf8')) as Artefact;
  } catch {
    // A results directory may hold a file that is not an artefact. Skipping it silently is right
    // only because the artefact count below is a claim the gate checks: a file that *is* an
    // artefact and fails to parse would reduce it, and `V69` prints the count beside the rows.
    continue;
  }
  const arms = Array.isArray(parsed.arms) ? parsed.arms : [];
  if (arms.length === 0) continue;
  artefacts += 1;
  const dataset = parsed.dataset ?? 'unknown';
  const artefactReadings: ArmReading[] = [];
  const take = (row: Row, control: string): void => {
    published += 1;
    const n = row.n ?? 0;
    const helped = row.gained ?? 0;
    const harmed = row.lost ?? 0;
    const foundPp = row.delta_pp ?? row.deltaPp;
    if (n <= 0 || foundPp === undefined) {
      skipped += 1;
      return;
    }
    artefactReadings.push(armReadingOf(file, dataset, { arm: row.arm, control, n, helped, harmed, foundPp }));
  };
  for (const row of arms) take(row, 'none');
  for (const row of Array.isArray(parsed.arm_pairs) ? parsed.arm_pairs : []) take(row, 'full');
  readings.push(...artefactReadings);
  byArtefact.push({
    artefact: file,
    dataset,
    rows: artefactReadings.length,
    decided: artefactReadings.filter((row) => row.decided).length,
  });
}

const ledger = readResolution(readings);
const replications = replicationsOf(readings);
const floors = designFloors(readings);
const shrinkage = shrinkageOf(readings);
const gates = [
  coverageGate({ published, emitted: readings.length, artefacts }),
  reconcileGate(readings),
  priceGate(readings),
];

/**
 * The price list, sorted by what it would cost to settle.
 *
 * Only undecided rows appear: a decided row has already been paid for. A `null` price is a zero
 * effect and sorts last, because "infinitely many questions" is not the most expensive real item,
 * it is a different statement.
 */
const priceList = readings
  .filter((row) => !row.decided)
  .sort((left, right) => (left.requiredN ?? Number.POSITIVE_INFINITY) - (right.requiredN ?? Number.POSITIVE_INFINITY))
  .map((row) => ({
    artefact: row.artefact,
    arm: row.arm,
    control: row.control,
    n: row.n,
    deltaPp: row.deltaPp,
    minDetectablePp: row.minDetectablePp,
    requiredN: row.requiredN,
  }));

const contrastOf = (arm: string, control: string): string => `${arm} − ${control}`;
const memoryRuns = readings.filter((row) => contrastOf(row.arm, row.control) === 'full − none');
const memoryDecided = memoryRuns.filter((row) => row.decided);
const memorySignificant = memoryRuns.filter((row) => row.significant95);
const widestRun = memoryRuns.reduce<ArmReading | null>(
  (best, row) => (best === null || row.n > best.n ? row : best),
  null,
);

const statement = `${String(ledger.rows)} arm rows over ${String(ledger.artefacts)} artefacts, `
  + `${String(ledger.decided)} decided at 80% power and ${String(ledger.significant95)} at a 95% interval, `
  + `${String(ledger.reconciled)} reconciled; the largest claim was ${describe(ledger.largest)} and the sharpest `
  + `design resolved ${ledger.sharpest === null ? 'nothing' : `${String(ledger.sharpest.minDetectablePp)}pp`}; `
  + `\`full − none\` has been measured ${String(memoryRuns.length)} times, ${String(memoryDecided.length)} could decide `
  + `and ${String(memorySignificant.length)} cleared a 95% interval, ${String(memoryRuns.filter((row) => row.deltaPp > 0).length)} of them positive; `
  + `${String(ledger.quiet)} rows sit under 1pp and were never decided.`;

await writeJson('poc-resolution', {
  id: 'poc-resolution',
  title: 'Every published arm, beside the difference its own sample could resolve',
  source: COMMITTED,
  artefacts,
  ledger: {
    rows: ledger.rows,
    decided: ledger.decided,
    significant95: ledger.significant95,
    reconciled: ledger.reconciled,
    undecided: ledger.undecided,
    quiet: ledger.quiet,
    published,
    skipped,
    largest: summaryOf(ledger.largest),
    sharpest: summaryOf(ledger.sharpest),
  },
  memory: {
    runs: memoryRuns.length,
    decided: memoryDecided.length,
    significant95: memorySignificant.length,
    positive: memoryRuns.filter((row) => row.deltaPp > 0).length,
    negative: memoryRuns.filter((row) => row.deltaPp < 0).length,
    decidedRows: memoryDecided.map(summaryOf),
    significantRows: memorySignificant.map(summaryOf),
    widest: summaryOf(widestRun),
  },
  readings,
  replications,
  shrinkage,
  floors,
  priceList,
  byArtefact,
  gates,
  statement,
});

process.stdout.write(
  `[resolution] ${statement}\n`
  + `[resolution] gates ${gates.map((gate) => `${gate.id} ${gate.pass ? 'pass' : 'FAIL'}`).join(', ')}\n`,
);

function describe(row: ArmReading | null): string {
  if (row === null) return 'nothing';
  return `${row.arm} − ${row.control} at ${row.deltaPp > 0 ? '+' : ''}${String(row.deltaPp)}pp `
    + `on a design resolving ${String(row.minDetectablePp)}pp`;
}

function summaryOf(row: ArmReading | null): Record<string, unknown> | null {
  if (row === null) return null;
  return {
    artefact: row.artefact,
    dataset: row.dataset,
    arm: row.arm,
    control: row.control,
    n: row.n,
    helped: row.helped,
    harmed: row.harmed,
    deltaPp: row.deltaPp,
    minDetectablePp: row.minDetectablePp,
  };
}
