/**
 * Re-grade committed pair artefacts against the current `pair-gates.ts` without re-running a dispatch.
 *
 * R153 changed `l4-effect-resolved`'s predicate (AUDIT 34.197). Two artefacts in `eval/results/` were
 * generated under the old one, and the honest way to update them is to re-grade the measurements they
 * already carry rather than to buy two more dispatches for a different draw of tasks. The logic is in
 * `pair-regrade.ts` so it can be tested; this file only reads, prints and — with `--write` — writes.
 *
 * Default is a dry run. A command that rewrites committed evidence by default is a command somebody runs
 * by accident, and the printout of what would move is the reviewable thing either way.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { regradePairText } from '../pair-regrade.js';

const args = process.argv.slice(2);
const write = args.includes('--write');
const paths = args.filter((arg) => !arg.startsWith('--'));

if (paths.length === 0) {
  process.stderr.write('usage: l4-regrade <artefact.json ...> [--write]\n');
  process.exit(2);
}

let moved = 0;
for (const path of paths) {
  const absolute = path.startsWith('/') ? path : join(process.cwd(), path);
  const before = readFileSync(absolute, 'utf8');
  const { text, regrade } = regradePairText(before);
  const name = path.replace(`${process.cwd()}/`, '');
  if (regrade.changed.length === 0) {
    process.stdout.write(`[l4-regrade] ${name}: no row moves\n`);
  } else {
    for (const row of regrade.changed) {
      // A row can move without its verdict moving: R153's fix rewords the criterion of every artefact it
      // touches, so a `fail -> fail` here means the sentence changed and the reading did not.
      const move =
        row.from === row.to
          ? `pass stays ${row.to ? 'pass' : 'fail'}`
          : `${row.from ? 'pass' : 'fail'} -> ${row.to ? 'pass' : 'fail'}`;
      process.stdout.write(`[l4-regrade] ${name}: ${row.id} ${move}\n[l4-regrade]   ${row.actual}\n`);
    }
    moved += regrade.changed.length;
  }
  if (regrade.ungraded.length > 0) {
    process.stdout.write(
      `[l4-regrade] ${name}: predates ${regrade.ungraded.join(', ')} — not added, because the driver of` +
        ' the day could not have written them\n',
    );
  }
  // R156: the rows this tool cannot see the evidence for, left exactly as the run wrote them. Printed
  // rather than silent, because "unchanged" and "not checked" are different states and only one of them
  // is a reason to trust the row.
  for (const entry of regrade.preserved) {
    process.stdout.write(`[l4-regrade] ${name}: ${entry.id} kept as written — ${entry.reason}\n`);
  }
  if (write && text !== before) writeFileSync(absolute, text, 'utf8');
}

process.stdout.write(
  `[l4-regrade] ${String(moved)} row(s) moved across ${String(paths.length)} artefact(s)` +
    `${write ? ', written' : ' — dry run, pass --write to apply'}\n`,
);

// A dry run that moved a row is a repository whose committed evidence is graded by a rule that no longer
// ships, so it exits non-zero: `pnpm check` runs this over the two pair artefacts, and a future change to
// `pair-gates.ts` that moves a row without a re-grade fails there rather than in a reader's head.
if (!write && moved > 0) process.exit(1);
