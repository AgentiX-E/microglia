/**
 * Put every published paired delta beside the difference its own sample could have resolved.
 *
 * This is the audit the record has never run on itself. It reads only committed artefacts, makes
 * no call, and is deterministic, so the workflow can recompute it and refuse a stale copy. A new
 * artefact on disk means a new row, and the committed copy has to be regenerated deliberately —
 * the same discipline `eval:protocol --write` uses for derived reports.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { powerOf, readPower, type PairedCase, type PowerRow } from '@agentix-e/microglia-eval';
import { writeJson } from './lib.js';

const DIRECTORY = process.env['POWER_DIR'] ?? join('eval', 'results');

type Candidate = {
  readonly id?: string;
  readonly per_case?: readonly (PairedCase & { readonly id?: string })[];
};

const rows: PowerRow[] = [];
for (const entry of readdirSync(DIRECTORY).filter((name) => name.endsWith('.json')).sort()) {
  let parsed: Candidate;
  try {
    parsed = JSON.parse(readFileSync(join(DIRECTORY, entry), 'utf8')) as Candidate;
  } catch {
    // A file that does not parse is a different check's problem, and refusing here would report
    // one defect twice under a name that does not describe it.
    continue;
  }
  const cases = parsed.per_case;
  if (cases === undefined || cases.length === 0) continue;
  // Only a paired run has a delta to audit. The field is checked on the first row rather than
  // inferred from the file name: a name is a label, and this audit is about arithmetic.
  if (!('withoutMemoryCorrect' in (cases[0] as object))) continue;
  rows.push(powerOf(entry, cases));
}

const summary = readPower(rows);
const resolvableShare = summary.total === 0 ? 0 : summary.resolvable / summary.total;

await writeJson('poc-power-audit', {
  id: 'poc-power-audit',
  title: 'Every published paired delta beside the difference its sample could resolve',
  source: DIRECTORY,
  rows,
  resolvable: summary.resolvable,
  significant95: summary.significant95,
  total: summary.total,
  resolvableShare,
  largest: summary.largest,
  sharpest: summary.sharpest,
  notes: [
    'A row is resolvable when |delta| exceeds the minimum detectable difference at 80% power for that artefact\'s own n and discordance; equality counts as unresolved, because a result at the edge of what a design can see is not a detection. significant95 is the same comparison against the 95% half-width, the looser bar, and both travel so neither can be quoted alone.',
    'The widths count only the discordant pairs. Two independent rates at these sample sizes would each carry an interval several times wider, which is why every comparison in this record is paired.',
    'Coverage is whole-artefact deltas. An arm inside an artefact is not a row: the values channel at +1.17pp [−0.13, +2.48] is the record\'s one positive reading and it lives in an arm, not in a file. That gap is why the audit undercounts positives rather than overcounting them.',
    'The audit reads committed files, so a new artefact on disk means a new row and the committed copy must be regenerated with `pnpm eval:power`.',
  ],
});

const line = (row: PowerRow): string =>
  `[power] ${row.artefact.padEnd(46)} n=${String(row.n).padStart(5)} ` +
  `${String(row.helped).padStart(3)}+/${String(row.harmed).padStart(3)}- ` +
  `delta=${row.deltaPp.toFixed(2).padStart(7)}pp ±${row.halfWidthPp.toFixed(2).padStart(5)} ` +
  `mde=${row.minDetectablePp.toFixed(2).padStart(6)}pp ` +
  `${row.resolvable ? 'RESOLVABLE' : row.significant95 ? 'within 95% but under 80% power' : 'underpowered'}\n`;
process.stdout.write(rows.map(line).join(''));
process.stdout.write(
  `[power] ${summary.resolvable} of ${summary.total} published deltas exceed their own minimum ` +
    `detectable difference (${(resolvableShare * 100).toFixed(1)}%); ${summary.significant95} exceed their own 95% half-width\n`,
);
if (summary.sharpest !== null) {
  process.stdout.write(
    `[power] sharpest design ${summary.sharpest.artefact} at ${summary.sharpest.minDetectablePp.toFixed(2)}pp; ` +
      `largest claim ${summary.largest?.artefact} at ${summary.largest?.deltaPp.toFixed(2)}pp\n`,
  );
}
