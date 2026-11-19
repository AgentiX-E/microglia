/**
 * The exchange census: every arm this repository can read, with the decision statistic and a
 * clustered interval.
 *
 * `--write` regenerates `eval/results/poc-exchange-census.json`; `--check` recomputes it and fails on
 * any difference. The check is what makes the census a gate rather than a report: an artefact that
 * changes underneath it, or a rule that drifts, breaks the build instead of the reader's trust.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CENSUS_HEADER, CENSUS_SOURCES, censusLine, exchangeCensus } from '../exchange.js';

const OUT = join(process.cwd(), 'eval/results/poc-exchange-census.json');

const argv = process.argv.slice(2);
const census = exchangeCensus(CENSUS_SOURCES, (path) => JSON.parse(readFileSync(join(process.cwd(), path), 'utf8')));

process.stdout.write(`${CENSUS_HEADER}\n`);
for (const source of census.sources) process.stdout.write(`${censusLine(source)}\n`);

if (argv.includes('--check')) {
  const committed = readFileSync(OUT, 'utf8');
  if (committed !== `${JSON.stringify(census, null, 2)}\n`) {
    process.stderr.write(
      '\n[exchange] the census has drifted from eval/results/poc-exchange-census.json.\n' +
        'Regenerate it with `pnpm eval:exchange --write` and read the diff: an arm whose numbers moved is a\n' +
        'change in the evidence, not in the arithmetic, and a rule that moved is this round’s defect.\n',
    );
    process.exitCode = 1;
  } else {
    process.stdout.write('\n[exchange] census matches eval/results/poc-exchange-census.json\n');
  }
} else if (argv.includes('--write')) {
  writeFileSync(OUT, `${JSON.stringify(census, null, 2)}\n`);
  process.stdout.write(`\n[exchange] wrote ${OUT}\n`);
} else {
  process.stdout.write('\nNeither --write nor --check: nothing was changed.\n');
}
