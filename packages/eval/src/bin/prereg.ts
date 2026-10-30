/**
 * Refuse a pre-registration that is not one.
 *
 * Called directly, and as the first step of every dispatched benchmark run: a run whose
 * prediction was not written down before it started is a run whose number can only ever be
 * read as a description of what happened.
 *
 * Usage:
 *   tsx packages/eval/src/bin/prereg.ts                 # every prereg/*.md except the template
 *   tsx packages/eval/src/bin/prereg.ts prereg/R8.3-xiyan-cell.md
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { preregGate, readPrereg } from '@agentix-e/microglia-eval';

function main(): void {
  const root = process.cwd();
  const directory = join(root, 'prereg');
  const named = process.argv.slice(2).filter((entry) => !entry.startsWith('--'));
  const files =
    named.length > 0
      ? named.map((entry) => (entry.startsWith('/') ? entry : join(root, entry)))
      : readdirSync(directory)
          .filter((entry) => entry.endsWith('.md') && entry !== 'TEMPLATE.md')
          .sort()
          .map((entry) => join(directory, entry));

  if (files.length === 0) {
    process.stderr.write('[prereg] no pre-registration found\n');
    process.exitCode = 1;
    return;
  }

  let failed = 0;
  for (const file of files) {
    const relative = file.startsWith(`${root}/`) ? file.slice(root.length + 1) : file;
    const reading = readPrereg(readFileSync(file, 'utf8'), relative);
    const gate = preregGate(reading);
    process.stdout.write(`[prereg] ${gate.ok ? 'pass' : 'FAIL'} ${relative} — ${gate.detail}\n`);
    for (const problem of reading.problems) {
      process.stdout.write(`[prereg]   at ${problem.where}: ${problem.problem}\n`);
    }
    if (!gate.ok) failed += 1;
  }
  process.stdout.write(`[prereg] ${files.length - failed}/${files.length} valid\n`);
  if (failed > 0) process.exitCode = 1;
}

main();
