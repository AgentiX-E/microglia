/**
 * The pack-attribution census: which statement, if any, is the harm in.
 *
 * `--write` regenerates `eval/results/poc-pack-attribution.json`; `--check` recomputes it and fails on
 * any difference, which is what makes this a gate rather than a report. Two things can move the file:
 * the artefacts (a re-run), or the readings (a code change). The check cannot tell them apart, and it
 * is not supposed to — either one is a change in the evidence and has to be read as one.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ATTRIBUTION_SOURCES,
  attributionCensus,
  doseLines,
  filterLines,
  ledgerLines,
  screenLines,
  stratumLines,
} from '../pack-attribution.js';
import { packCopyRowsOf } from '../pack-copy.js';

const OUT = join(process.cwd(), 'eval/results/poc-pack-attribution.json');

const argv = process.argv.slice(2);
const census = attributionCensus(ATTRIBUTION_SOURCES, (path) =>
  packCopyRowsOf(JSON.parse(readFileSync(join(process.cwd(), path), 'utf8')), path),
);

const write = (text: string): void => {
  process.stdout.write(`${text}\n`);
};

write('ledger — statements screened, resolved, and the share of the corpus loss they can explain');
for (const source of census.sources) for (const line of ledgerLines(source)) write(line);

write('\nwhat serving the reading would cost — statements delivered before and after a database profile');
for (const source of census.sources) for (const line of filterLines(source)) write(line);

write('\nwhat the flag is made of — cases flagged by each construct, per arm');
for (const source of census.sources) {
  const parts = source.unsupported.byConstruct.map((entry) => `${entry.construct} ${String(entry.cases)}`);
  write(`  ${source.source.padEnd(18)} ${parts.join(', ')}`);
  write(`  ${''.padEnd(18)} unsupported statements per case ${source.unsupported.meanPerCase.toFixed(2)}`);
}

write('\nthe converse reading and the circulation strata, re-estimated inside a database');
for (const source of census.sources) for (const line of stratumLines(source)) write(line);

write('\ndose — paired gain per additional delivered statement, with database fixed effects');
for (const source of census.sources) for (const line of doseLines(source)) write(line);

write('\nthe screen — every statement at least five databases can compare');
for (const source of census.sources) {
  write(`${source.source} (${String(source.screen.length)} of ${String(source.statements)} statements; ${String(source.unscreened)} below the floor)`);
  for (const line of screenLines(source)) write(line);
}

if (argv.includes('--check')) {
  const committed = readFileSync(OUT, 'utf8');
  if (committed !== `${JSON.stringify(census, null, 2)}\n`) {
    process.stderr.write(
      '\n[pack-attribution] the census has drifted from eval/results/poc-pack-attribution.json.\n' +
        'Regenerate it with `pnpm eval:pack-attribution --write` and read the diff: an arm whose numbers moved\n' +
        'is a change in the evidence, and a reading that moved is this round’s defect.\n',
    );
    process.exitCode = 1;
  } else {
    write('\n[pack-attribution] census matches eval/results/poc-pack-attribution.json');
  }
} else if (argv.includes('--write')) {
  writeFileSync(OUT, `${JSON.stringify(census, null, 2)}\n`);
  write(`\n[pack-attribution] wrote ${OUT}`);
} else {
  write('\nNeither --write nor --check: nothing was changed.');
}
