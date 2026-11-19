/**
 * The pack-copy census: what the delivered statements say about a case they were not distilled from.
 *
 * `--write` regenerates `eval/results/poc-pack-copy.json`; `--check` recomputes it and fails on any
 * difference, which is what makes this a gate rather than a report. Two things can move the file:
 * the artefacts (a re-run), or the rules (a code change). The check cannot tell them apart, and it
 * is not supposed to — either one is a change in the evidence and has to be read as one.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  COMPOSITION_HEADER,
  COPY_HEADER,
  COPY_SOURCES,
  compositionLine,
  copyLines,
  packCopyCensus,
} from '../pack-copy.js';

const OUT = join(process.cwd(), 'eval/results/poc-pack-copy.json');

const argv = process.argv.slice(2);
const census = packCopyCensus(COPY_SOURCES, (path) => JSON.parse(readFileSync(join(process.cwd(), path), 'utf8')));

process.stdout.write(`${COMPOSITION_HEADER}\n`);
for (const source of census.sources) process.stdout.write(`${compositionLine(source)}\n`);

process.stdout.write(`\n${COPY_HEADER}\n`);
for (const source of census.sources) {
  for (const line of copyLines(source)) process.stdout.write(`${line}\n`);
}

process.stdout.write('\ncontradicted constructs, by cases:\n');
for (const source of census.sources) {
  const listed = source.contradicted.map((entry) => `${entry.construct} ${String(entry.cases)}`).join(', ');
  process.stdout.write(`  ${source.source.padEnd(18)} ${listed === '' ? '—' : listed}\n`);
}

if (argv.includes('--check')) {
  const committed = readFileSync(OUT, 'utf8');
  if (committed !== `${JSON.stringify(census, null, 2)}\n`) {
    process.stderr.write(
      '\n[pack-copy] the census has drifted from eval/results/poc-pack-copy.json.\n' +
        'Regenerate it with `pnpm eval:pack-copy --write` and read the diff: an arm whose numbers moved is a\n' +
        'change in the evidence, and a rule that moved is this round’s defect.\n',
    );
    process.exitCode = 1;
  } else {
    process.stdout.write('\n[pack-copy] census matches eval/results/poc-pack-copy.json\n');
  }
} else if (argv.includes('--write')) {
  writeFileSync(OUT, `${JSON.stringify(census, null, 2)}\n`);
  process.stdout.write(`\n[pack-copy] wrote ${OUT}\n`);
} else {
  process.stdout.write('\nNeither --write nor --check: nothing was changed.\n');
}
