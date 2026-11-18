/**
 * Compose two pair artefacts into the two fold records a cross-fit is run on.
 *
 * A pair artefact is the join of two arm files and calls no model, so a fold's ledger travels in a 30KB file.
 * What it does not always carry is the fold's learning half and the treatment identity: artefacts written before
 * R152 refused both (`AUDIT 34.191`), and those runs are paid for. The two artefacts together do state
 * everything the pool needs — one fold's learning half is the other's evaluation half — and `foldRecordsOf` is
 * the composition, with the tiling checked before a byte is written.
 *
 * Usage:
 *   pnpm eval:fold-records <pair-a.json> <pair-b.json> --out-dir eval/results/folds
 *
 * The labels are the file names, because the pool prints them in every line it writes and `official` is the name
 * a reader will look for.
 */
import { basename } from 'node:path';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  foldRecordsLine,
  foldRecordsOf,
  type FoldInput,
  type FoldLedgerRow,
} from '@agentix-e/microglia-eval';

type PairArtefact = {
  readonly id?: string;
  readonly domain?: string;
  readonly ranAt?: string;
  readonly first?: { readonly ranAt?: string | null };
  readonly second?: { readonly ranAt?: string | null };
  readonly foldSplit?: { readonly learned: readonly string[]; readonly evaluated: readonly string[] };
  readonly foldSplitAbsent?: { readonly reason: string };
  readonly treatment?: {
    readonly unit?: string;
    readonly form?: string;
    readonly scope?: string;
    readonly model?: string;
    readonly traceClaims?: number;
    readonly knobs?: string;
    /** R152: the serving policy, forwarded so the composition can refuse two policies as one treatment. */
    readonly rotation?: string;
  };
  readonly treatmentAbsent?: { readonly reason: string };
  readonly transfer?: { readonly ledger?: readonly FoldLedgerRow[] };
};

function fail(reason: string): never {
  process.stderr.write(`[fold-records] ${reason}\n`);
  process.exit(1);
}

async function load(path: string): Promise<FoldInput> {
  // Named rather than thrown: a mistyped path reaches the reader as "missing pair artefact", not as a stack
  // trace from `readFile`, and the two files are usually typed out of a run's readback.
  if (!existsSync(path)) fail(`missing pair artefact: ${path}`);
  const doc = JSON.parse(await readFile(path, 'utf8')) as PairArtefact;
  const ledger = doc.transfer?.ledger;
  if (ledger === undefined) fail(`${path} carries no transfer ledger, so the fold has no paired outcomes`);
  return {
    label: basename(path).replace(/\.json$/, ''),
    ledger,
    // Absent rather than invented: an artefact whose guards refused to state a half reaches the composition as
    // absent, and the composition is what decides whether the sibling can state it instead.
    ...(doc.foldSplit === undefined ? {} : { split: doc.foldSplit }),
    ...(doc.treatment === undefined ? {} : { treatment: doc.treatment }),
    source: [doc.id ?? 'poc-l4-pair', doc.ranAt ?? doc.first?.ranAt ?? doc.second?.ranAt ?? 'undated'].join(' @ '),
  };
}

const args = process.argv.slice(2);
// Parsed rather than filtered: `--out-dir`'s value is an argument too, and a filter that treated it as a path
// counted three artefacts for a two-fold call. The flag is required rather than defaulted because the default
// would be the repository's own results directory, which a test run must never write into.
const paths: string[] = [];
let outDir: string | undefined;
for (let index = 0; index < args.length; index += 1) {
  const argument = args[index]!;
  if (argument === '--out-dir') {
    outDir = args[index + 1];
    index += 1;
  } else {
    paths.push(argument);
  }
}
if (paths.length !== 2 || outDir === undefined) {
  fail(
    `two pair artefacts and an output directory are needed; ${String(paths.length)} path(s) and ` +
      `${outDir === undefined ? 'no' : 'an'} output directory were given`,
  );
}

const inputs = await Promise.all(paths.map(load));
const outcome = foldRecordsOf(inputs);
if (!outcome.ok) {
  for (const reason of outcome.refusals) process.stderr.write(`[fold-records] REFUSED: ${reason}\n`);
  process.exit(1);
}

process.stdout.write(`${foldRecordsLine(outcome.records)}\n`);
await mkdir(outDir, { recursive: true });
for (const record of outcome.records) {
  const path = join(outDir, `${record.id}.json`);
  // Written verbatim, with the derivation inside the file: a reader who distrusts a carried field must be able
  // to see which one it was without running this command again.
  await writeFile(path, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  process.stdout.write(`[fold-records] wrote ${path}\n`);
  for (const note of record.derivation) process.stdout.write(`[fold-records] ${record.id} — ${note}\n`);
}
