/**
 * The reuse ceiling, recomputed from committed artefacts.
 *
 * `--write` regenerates `eval/results/poc-reuse-ceiling.json`; `--check` recomputes it and fails on
 * any difference, which is what makes the reading a gate rather than a report. The file can move for
 * two reasons — the artefacts were regenerated, or the reading changed — and the check cannot tell
 * them apart, which is the point: either one changes the evidence and has to be read as a change.
 *
 * No model calls. Every number here is a column in a run the project already paid for, which is why
 * the lane is `--check`-able on every push.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { bandLines, censusOf, reuseLines, reuseRowsOf } from '../reuse-ceiling.js';

const OUT = join(process.cwd(), 'eval/results/poc-reuse-ceiling.json');

/** The two corpora: one the record has read for twelve rounds, one it has not. */
const SOURCES = [
  { name: 'dev', path: 'eval/results/poc-sota-bird-dev-R26-channels.json' },
  { name: 'train', path: 'eval/results/poc-sota-bird-train.json' },
] as const;

const inputs = SOURCES.map((source) => ({
  source: source.name,
  rows: reuseRowsOf(JSON.parse(readFileSync(join(process.cwd(), source.path), 'utf8')), source.path),
}));

const census = censusOf(inputs);
const write = (text: string): void => {
  process.stdout.write(`${text}\n`);
};

write('the top band, per corpus — the only row a replication compares');
for (const line of reuseLines(census)) write(line);

write('\nthe bands below it — what the reading is made of');
for (const corpus of census.corpora) for (const line of bandLines(corpus)) write(line);

write('\nband edges are fixed in the module and not chosen per run: a threshold fitted to noise is the failure this lane exists to catch');

if (process.argv.slice(2).includes('--check')) {
  const committed = readFileSync(OUT, 'utf8');
  if (committed !== `${JSON.stringify(census, null, 2)}\n`) {
    process.stderr.write(
      '\n[reuse-ceiling] the census has drifted from eval/results/poc-reuse-ceiling.json.\n' +
        'Regenerate it with `pnpm eval:reuse --write` and read the diff: a corpus whose bands moved\n' +
        'is a change in the evidence, and a verdict that moved is this round’s defect.\n',
    );
    process.exitCode = 1;
  } else {
    write('\n[reuse-ceiling] census matches eval/results/poc-reuse-ceiling.json');
  }
} else if (process.argv.slice(2).includes('--write')) {
  writeFileSync(OUT, `${JSON.stringify(census, null, 2)}\n`);
  write(`\n[reuse-ceiling] wrote ${OUT}`);
} else {
  write('\nNeither --write nor --check: nothing was changed.');
}
