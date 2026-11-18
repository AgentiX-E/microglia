/**
 * Pool two folds of one corpus into one paired reading.
 *
 * τ² retail ships 114 tasks and this lane has only ever scored 40 of them, which is why every paired reading
 * it publishes resolves ~17pp and a ten-point mechanism is never resolved. Two arms of the same registration —
 * `taskSplit: official` and `taskSplit: official-swapped` — read the benchmark's own boundary in opposite
 * directions, and each task is then answered once by a memory that never saw it. This script is the arithmetic
 * that turns those two pair artefacts into one reading, and the guards that decide whether they may be added.
 *
 * It reads two committed pair artefacts and writes one, calls no model, and is deterministic: the seed is part
 * of the module, so the same two ledgers give the same interval and the committed copy can be recomputed by a
 * reader rather than trusted.
 *
 * Usage:
 *   pnpm eval:cross-fit eval/results/folds/official.json eval/results/folds/swapped.json
 */
import { existsSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';
import {
  crossFitLine,
  crossFitPool,
  crossFitRefusalLine,
  foldTasksOf,
  type CrossFitFold,
} from '@agentix-e/microglia-eval';
import { writeJson } from './lib.js';

type PairArtefact = {
  readonly id?: string;
  readonly domain?: string;
  /** R143: the two halves the arms ran, which is what makes a fold checkable against a leak. */
  readonly foldSplit?: { readonly learned: readonly string[]; readonly evaluated: readonly string[] };
  readonly foldSplitAbsent?: { readonly reason: string };
  /** R143: the treatment the two arms agreed on, as `poolArms` compares it. */
  readonly treatment?: {
    readonly unit?: string;
    readonly form?: string;
    readonly scope?: string;
    readonly model?: string;
    readonly traceClaims?: number;
  };
  readonly treatmentAbsent?: { readonly reason: string };
  readonly transfer?: {
    readonly ledger?: readonly {
      readonly task: string;
      readonly blankCorrect: boolean;
      readonly withMemoryCorrect: boolean;
    }[];
  };
};

function fail(reason: string): never {
  process.stderr.write(`[cross-fit] ${reason}\n`);
  process.exit(1);
}

function load(path: string): CrossFitFold {
  if (!existsSync(path)) fail(`missing fold artefact: ${path}`);
  const doc = JSON.parse(readFileSync(path, 'utf8')) as PairArtefact;
  const rows = doc.transfer?.ledger;
  if (rows === undefined || rows.length === 0) {
    // The ledger is the population a fold is made of. An artefact without one is a run that never joined its
    // trials to its tasks, and pooling "no rows" would report a sample that does not exist.
    fail(`${path} carries no transfer ledger, so the fold has no paired trials to pool`);
  }
  const tasks = foldTasksOf(rows);
  if (!tasks.ok) fail(`${path}: ${tasks.reason}`);
  const label = basename(path).replace(/\.json$/, '');
  return {
    label,
    // Absent rather than invented: a fold that does not state what it learned from cannot be checked for the
    // leak, and the pool refuses it with that sentence rather than with one about a mismatch.
    learned: doc.foldSplit?.learned,
    tasks: tasks.tasks,
    unit: doc.treatment?.unit,
    form: doc.treatment?.form,
    scope: doc.treatment?.scope,
    model: doc.treatment?.model,
  };
}

const paths = process.argv.slice(2);
if (paths.length !== 2) {
  fail(
    `two fold artefacts are needed, and ${String(paths.length)} were given: a cross-fit is two halves of one ` +
      'corpus, and one path would be the fold itself',
  );
}
const folds = paths.map(load);
const outcome = crossFitPool(folds);
if (!outcome.ok) {
  process.stderr.write(`${crossFitRefusalLine(outcome.refusals)}\n`);
  process.exit(1);
}
process.stdout.write(`${crossFitLine(outcome.reading)}\n`);
await writeJson('poc-cross-fit', {
  id: 'poc-cross-fit',
  title: 'L4 — two folds of one corpus, paired over every task once',
  ranAt: new Date().toISOString(),
  sources: paths,
  folds: outcome.reading.folds,
  reading: {
    tasks: outcome.reading.tasks,
    memoryPass4: outcome.reading.memoryPass4,
    controlPass4: outcome.reading.controlPass4,
    deltaPp: outcome.reading.deltaPp,
    ciLowPp: outcome.reading.ciLowPp,
    ciHighPp: outcome.reading.ciHighPp,
    p: outcome.reading.p,
    lost: outcome.reading.lost,
    gained: outcome.reading.gained,
    discordance: outcome.reading.discordance,
    mde80Pp: outcome.reading.mde80Pp,
  },
  census: {
    evaluated: outcome.reading.evaluated,
    learned: outcome.reading.learned,
    tiles: outcome.reading.tiles,
    neverLearned: outcome.reading.neverLearned,
    neverScored: outcome.reading.neverScored,
    agreeInSign: outcome.reading.agreeInSign,
  },
});
