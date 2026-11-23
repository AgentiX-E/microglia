/**
 * R201's dose–response, recomputed and gated.
 *
 * `--write` regenerates `eval/results/rung-dose.json` from the committed pair artefacts; `--check` recomputes it and
 * fails on any drift. The record is derived, not transcribed: every point is re-derivable from a `serveSweep`
 * ladder by path, and the gate's job is to keep the two from moving apart — a fold re-run and a rule changed look
 * identical to a diff, and only the second is a change in the evidence.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { doseFoldOf, dosePointLine, doseResponseOf, driftOfDose, parseRungDose, shippableLine, type DoseFold } from '../rung-dose.js';

const RESULTS = join(process.cwd(), 'eval/results');
const RECORD = join(RESULTS, 'rung-dose.json');
const argv = process.argv.slice(2);

const write = (text: string): void => {
  process.stdout.write(`${text}\n`);
};

const folds: DoseFold[] = [];
const problems: string[] = [];
for (const name of readdirSync(RESULTS)
  .filter((entry) => entry.startsWith('poc-l4-pair') && entry.endsWith('.json'))
  .sort()) {
  const path = `eval/results/${name}`;
  const read = doseFoldOf(JSON.parse(readFileSync(join(RESULTS, name), 'utf8')) as unknown, path);
  if (read.fold === undefined) problems.push(...read.problems);
  else folds.push(read.fold);
}
if (problems.length > 0) {
  for (const problem of problems) write(`refused: ${problem}`);
  process.exit(1);
}

const read = doseResponseOf(folds);
if (!read.ok) {
  for (const refusal of read.refusals) write(`refused: ${refusal}`);
  process.exit(1);
}

const fresh = read.dose;

if (argv.includes('--write')) {
  writeFileSync(RECORD, `${JSON.stringify(fresh, null, 2)}\n`);
  write(`wrote ${RECORD}`);
  process.exit(0);
}

for (const point of fresh.points) write(dosePointLine(point));
write(
  `corpus: ${String(fresh.corpus.trials)} trial(s) over ${String(fresh.corpus.folds)} fold(s), ` +
    `${String(fresh.corpus.repairs)} repair(s) and ${String(fresh.corpus.breaks)} break(s) at rung 0`,
);
write(shippableLine(fresh));

if (argv.includes('--check')) {
  const stored = parseRungDose(JSON.parse(readFileSync(RECORD, 'utf8')) as unknown);
  if (stored.record === undefined) {
    for (const refusal of stored.refusals) write(`refused: ${refusal}`);
    process.exit(1);
  }
  const drift = driftOfDose(stored.record, fresh);
  for (const problem of drift) write(`drifted: ${problem}`);
  if (drift.length > 0) {
    write('regenerate the record with `pnpm eval:rung-dose --write` and read the difference as evidence');
    process.exit(1);
  }
  write(`held: the committed record matches the ${String(fresh.corpus.folds)} fold(s) it is derived from`);
}
