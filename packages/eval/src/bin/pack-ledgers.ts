/**
 * The pack's three ledgers, recomputed and gated.
 *
 * `--write` regenerates `eval/results/pack-ledgers.json` from the committed pair artefacts; `--check`
 * recomputes it and fails on any drift, which is what makes it a gate rather than a report. `--print` is
 * the same read without the filesystem's other half: it is what a reader opens when asking why the record
 * says what it says.
 *
 * The record is derived, not transcribed. Every number in it is re-derivable from a pair artefact by path,
 * and the gate's whole job is to keep the two from moving apart: a re-run of one fold and a change of rule
 * look identical to a diff, and only the second is a change in the evidence.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  driftOf,
  headlineLine,
  ledgerLine,
  packLedgersRecord,
  parseLedgersRecord,
  pooledLine,
  priceLines,
  type LedgerSource,
} from '../pack-ledgers.js';

const RESULTS = join(process.cwd(), 'eval/results');
const RECORD = join(RESULTS, 'pack-ledgers.json');
const argv = process.argv.slice(2);

/** Every pair artefact the lane has committed, in a fixed order so the record is reproducible. */
function sources(): readonly LedgerSource[] {
  const files = readdirSync(RESULTS)
    .filter((name) => name.startsWith('poc-l4-pair') && name.endsWith('.json'))
    .sort();
  return files.map((name) => ({
    path: `eval/results/${name}`,
    artefact: JSON.parse(readFileSync(join(RESULTS, name), 'utf8')) as unknown,
  }));
}

const write = (text: string): void => {
  process.stdout.write(`${text}\n`);
};

const read = packLedgersRecord(sources());

if (read.record === undefined) {
  for (const refusal of read.refusals) write(`refused: ${refusal}`);
  process.exit(1);
}

const fresh = read.record;

if (argv.includes('--write')) {
  writeFileSync(RECORD, `${JSON.stringify(fresh, null, 2)}\n`);
  write(`wrote ${RECORD}`);
  process.exit(0);
}

for (const fold of fresh.folds) write(ledgerLine(fold));
write('');
for (const pool of fresh.pooled) write(pooledLine(pool));
write(headlineLine(fresh.headline));
for (const line of priceLines(fresh.price)) write(line);

if (argv.includes('--check')) {
  const stored = parseLedgersRecord(JSON.parse(readFileSync(RECORD, 'utf8')) as unknown);
  if (stored.record === undefined) {
    for (const refusal of stored.refusals) write(`refused: ${refusal}`);
    process.exit(1);
  }
  const problems = driftOf(stored.record, fresh);
  for (const problem of problems) write(`drifted: ${problem}`);
  if (problems.length > 0) {
    write('regenerate the record with `pnpm eval:pack-ledgers --write` and read the difference as evidence');
    process.exit(1);
  }
  write(`held: the committed record matches the ${fresh.folds.length} fold(s) it is derived from`);
}
