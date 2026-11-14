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

/**
 * Measured 2026-10-22, esbuild 0.28.2, target es2022, minified ESM.
 *
 * Raised twice on 2026-10-25, for one feature family rather than for drift:
 *
 *   42,000 -> 43,000 (gzip 15,000 -> 15,500): `when` on every item, `minEvidence` on the
 *   pack, and `corroborationShare`/`observationsOf`/`Microglia.corroboration`.
 *   43,000 -> 44,000 (gzip 15,500 -> 16,000): `corroborationFloor`, the cached share on
 *   the recall path, and `KnowledgePack.suppressed` - the enforcement of the same
 *   measurement, which would otherwise ship as advice in a document.
 *
 * Written down instead of adjusted silently, because a ceiling nobody argues about is a
 * ceiling that only ever moves one way by accident.
 *
 * Raised once on 2026-11-07, 44,000 -> 46,000 raw (gzip untouched: 15,191 measured
 * against a 16,000 ceiling):
 *
 *   `kernel/admission.ts` — the write-time decision (`add` / `update` / `noop` against
 *   the top-s nearest memories), its two configurable bounds, the validation that makes
 *   a bad bound a thrown error rather than a silent default, and the lexical
 *   neighbourhood that a store without embeddings uses. Measured 45,309 raw at this
 *   commit. It ships because the distiller calls it and the next arm varies it; a
 *   mechanism that only exists in a document is not a mechanism.
 *
 * Raised once on 2026-11-08, 46,000 -> 47,000 raw (gzip untouched: 15,4xx measured
 * against a 16,000 ceiling), for one capability:
 *
 *   `RecallQuery.note` and `budgetBasis` — the note becomes a rendering option of one
 *   recall, and the character budget declares whether the wrapper is charged to it. Both
 *   are what make three note levels comparable over one store (R53), and the alternative
 *   was a treatment whose arms carried different packs. Measured 46,136 raw at this
 *   commit, so the raise is 864 bytes of headroom rather than a new allowance.
 *
 * Raised once on 2026-11-12, 47,000 -> 47,500 raw and 16,000 -> 16,200 gzip (the first
 * time the gzip ceiling has moved), for one correction:
 *
 *   the reference exemption in `kernel/guard.ts` — the phone rule no longer replaces a
 *   bare digit run under a reference key, and both redaction entry points carry the key
 *   that decides. It is the difference between a store that quotes a product id and one
 *   that says `product_id="[phone]"`, which R88 measured as 46 of 128 entity values lost
 *   before persistence. Measured 47,375 raw and 16,025 gzip at this commit, so the raise
 *   is 125 raw and 175 gzip of headroom: the smallest raise this gate has taken, and
 *   still a deliberate one. Anything that needed more than a thousand bytes would be a
 *   mechanism rather than a correction, and would have to be argued on its own.
 *
 * Raised once on 2026-11-14, 47,500 -> 50,600 raw and 16,200 -> 17,400 gzip, for one mechanism
 * and the thing that makes its switch reachable:
 *
 *   `apply/shape-fold.ts` (1,250 B of the measurement) — R109's fold: one line per routine instead of
 *   one per failure, the medoid that survives it, and the support census the artefact reads. It ships
 *   because the arm it prices is the only store-side mechanism left with a counted target (53 shapes,
 *   5 taught by three tasks) and because a mechanism that exists only in a document is not a mechanism.
 *   `kernel/recall-query.ts` (1,004 B) — the wire's field list, moved out of the HTTP package. This is
 *   the part that is not optional: the driver grades the arm through its own facade, the facade read
 *   `task` and `text` and dropped every other pair, and the switch R109 needs would have been inert in
 *   exactly the way the prefix arm's four knobs were. One parser, two callers.
 *   The rest is the `fold` field on the pack, the hook in `buildPack`, and the two names of the mode.
 *   Measured 50,478 raw and 17,203 gzip at this commit: 122 bytes of raw headroom and 197 of gzip, so
 *   the raise is an allowance for what shipped rather than for what might.
 */
const BUDGETS = [
  { name: 'browser', entry: 'packages/browser/dist/index.js', raw: 3200, gzip: 1600 },
  { name: 'core', entry: 'packages/core/dist/index.js', raw: 50600, gzip: 17400 },
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
