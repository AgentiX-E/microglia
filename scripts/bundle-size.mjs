#!/usr/bin/env node
/**
 * Bundle-size gate: what a browser host actually ships.
 *
 * The library's promise is "no runtime dependency", and a promise about bytes is
 * worth nothing unless it is measured on the artefact a consumer bundles. Two
 * facts come out of one esbuild run:
 *
 *   1. **it bundles for the browser at all** — `platform: browser` makes a Node
 *      builtin an error, so a `node:fs` that crept into a shared module fails here
 *      rather than in someone's page;
 *   2. **it stays small** — the minified and gzipped sizes are compared against a
 *      ceiling, and a dependency that doubles the bundle cannot land quietly.
 *
 * The ceilings are **regression ceilings, not targets**: each is the measured size
 * at the commit that introduced this gate, rounded up to leave room for small
 * changes and no room for a dependency. Raising one is a decision that has to be
 * written down next to the number.
 *
 * `--probe` halves the first ceiling and expects the gate to fail. A budget that
 * cannot be exceeded is not a gate, and this is how the check proves it is wired.
 */
import { gzipSync } from 'node:zlib';
import { build } from 'esbuild';

/** Measured 2026-10-22, esbuild 0.28.2, target es2022, minified ESM. */
const BUDGETS = [
  { name: 'browser', entry: 'packages/browser/dist/index.js', raw: 3200, gzip: 1600 },
  { name: 'core', entry: 'packages/core/dist/index.js', raw: 42000, gzip: 15000 },
];

const probe = process.argv.includes('--probe');

async function measure(entry) {
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    minify: true,
    write: false,
    logLevel: 'silent',
  });
  const [file] = result.outputFiles;
  return { raw: file.contents.length, gzip: gzipSync(file.contents, { level: 9 }).length };
}

const rows = [];
let failed = false;

for (const [index, budget] of BUDGETS.entries()) {
  let size;
  try {
    size = await measure(budget.entry);
  } catch (error) {
    process.stderr.write(
      `bundle:size — ${budget.name} does not bundle for the browser: ${String(error).split('\n')[0]}\n`,
    );
    process.exit(1);
  }
  // The probe only needs one row to prove the comparison is live.
  const scale = probe && index === 0 ? 0.5 : 1;
  const rawBudget = Math.round(budget.raw * scale);
  const gzipBudget = Math.round(budget.gzip * scale);
  const pass = size.raw <= rawBudget && size.gzip <= gzipBudget;
  if (!pass) failed = true;
  rows.push({ name: budget.name, ...size, rawBudget, gzipBudget, pass });
}

const width = Math.max(...rows.map((row) => row.name.length));
for (const row of rows) {
  process.stdout.write(
    `  ${row.pass ? 'PASS' : 'FAIL'} ${row.name.padEnd(width)}  raw ${String(row.raw).padStart(6)} / ${String(row.rawBudget).padStart(6)} B   gzip ${String(row.gzip).padStart(6)} / ${String(row.gzipBudget).padStart(6)} B\n`,
  );
}

if (probe) {
  // The probe's contract is the opposite of the gate's: it must fail.
  if (failed) {
    process.stdout.write('bundle:size probe ok: a halved budget was rejected\n');
    process.exit(0);
  }
  process.stderr.write('bundle:size probe FAILED: a halved budget was accepted, so the gate is inert\n');
  process.exit(1);
}

if (failed) {
  process.stderr.write('bundle:size — a bundle exceeded its ceiling; raise the budget deliberately or remove the weight\n');
  process.exit(1);
}
process.stdout.write('bundle:size ok\n');
