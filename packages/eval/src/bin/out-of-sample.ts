/**
 * The verdict the out-of-sample dispatch was paid for, computed from the two committed artefacts.
 *
 * R30 stage 2 is the first estimate in this record that is not in-sample, and this reading is the
 * only place the in-sample and the out-of-sample numbers are put beside each other. It recomputes
 * everything from `per_case`, so it costs no model call and the workflow can hold it to the
 * committed copy byte for byte.
 *
 * Two things it deliberately does not do. It does not compare accuracies across splits — dev and
 * train share no database, so only the paired differences are the same quantity — and it does not
 * re-adjudicate a prediction whose number arrived the wrong way. A refuted prediction is the
 * output, not an obstacle to one.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  adjudicateOutOfSample,
  diffCasesOf,
  outOfSampleReadingOf,
  sideBySideOf,
  type CommittedRun as LibraryRun,
  type OutOfSampleReading,
} from '@agentix-e/microglia-eval';
import { writeJson } from './lib.js';

const DEV = process.env['POC_DEV_ARTEFACT'] ?? join('eval', 'results', 'poc-sota-bird-dev-R26-channels.json');
const TRAIN = process.env['POC_TRAIN_ARTEFACT'] ?? join('eval', 'results', 'poc-sota-bird-train.json');

/**
 * The fields this reading needs on top of the ones every run carries.
 *
 * An extension rather than a fresh type, so `diffCasesOf` — which is the single join point from a
 * run to per-question deltas — accepts the same object this file reads its gates and folds from.
 * Two types for one artefact is how a reading ends up over a different corpus than the one its
 * gates describe.
 */
type CommittedRun = LibraryRun & {
  readonly dataset?: string | null;
  readonly gates?: readonly { readonly id: string; readonly pass: boolean }[];
  readonly per_fold?: readonly { readonly fold: number; readonly delta_pp: number }[];
};

function load(path: string): { cases: ReturnType<typeof diffCasesOf>; run: CommittedRun } {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as CommittedRun;
  return { cases: diffCasesOf(raw, path), run: raw };
}

/**
 * Whether the run itself is usable, taken from its own gates rather than from a hand-kept list.
 *
 * A blocking gate that failed makes every number downstream a measurement of the harness. Reading
 * the artefact's own verdict is the only version of this that cannot drift from what the lane did.
 */
function measurable(run: CommittedRun): boolean {
  const gates = run.gates ?? [];
  return gates.length > 0 && gates.every((gate) => gate.pass);
}

const dev = load(DEV);
const train = load(TRAIN);

const devReading = outOfSampleReadingOf(dev.cases, [], { runsMeasured: measurable(dev.run) });
const trainReading = outOfSampleReadingOf(
  train.cases,
  (train.run.per_fold ?? []).map((fold) => fold.delta_pp),
  { runsMeasured: measurable(train.run) },
);

const verdicts = adjudicateOutOfSample(trainReading);
const table = sideBySideOf({ dev: devReading, train: trainReading });

/**
 * What the round is allowed to conclude, derived rather than written.
 *
 * Three sentences, each a claim about numbers in this file: the arm is or is not harmful on
 * evidence that survives clustering, the gate does or does not recover it, and the product is or is
 * not better than no memory. Prose that restates a number is the part of an artefact nobody
 * re-checks, so the sentence is built from the reading and the tests pin the construction.
 */
function statementOf(reading: OutOfSampleReading): string {
  const harm = reading.clustered.resolved ? 'costs' : 'does not measurably change';
  const recovered = reading.gate.improvementPp ?? 0;
  const net = reading.gate.gated.deltaPp ?? 0;
  const product = reading.gate.gated.halfWidthPp !== null && Math.abs(net) > reading.gate.gated.halfWidthPp;
  return (
    `Out of sample, memory ${harm} ${Math.abs(reading.deltaPp).toFixed(2)}pp. ` +
    `The read-time gate recovers ${recovered.toFixed(2)}pp of it, leaving ${net.toFixed(2)}pp, ` +
    `which is ${product ? 'still distinguishable from no memory' : 'not distinguishable from no memory'}.`
  );
}

await writeJson('poc-out-of-sample', {
  id: 'poc-out-of-sample',
  title: 'Whether the read-time gate survives a corpus the hypothesis was not formed on',
  registered: 'prereg/R30-stage2.md',
  sources: { dev: DEV, train: TRAIN },
  datasets: { dev: dev.run.dataset ?? null, train: train.run.dataset ?? null },
  verdicts,
  table,
  dev: {
    deltaPp: devReading.deltaPp,
    clustered: devReading.clustered,
    gate: {
      discarded: devReading.gate.discarded,
      improvementPp: devReading.gate.improvementPp,
      gatedDeltaPp: devReading.gate.gated.deltaPp,
    },
    imported: {
      n: devReading.imported.present.n,
      deltaPp: devReading.imported.present.deltaPp,
      restDeltaPp: devReading.imported.absent.deltaPp,
    },
  },
  train: {
    deltaPp: trainReading.deltaPp,
    clustered: trainReading.clustered,
    folds: trainReading.folds,
    gate: {
      discarded: trainReading.gate.discarded,
      improvementPp: trainReading.gate.improvementPp,
      gatedDeltaPp: trainReading.gate.gated.deltaPp,
    },
    imported: {
      n: trainReading.imported.present.n,
      deltaPp: trainReading.imported.present.deltaPp,
      restDeltaPp: trainReading.imported.absent.deltaPp,
    },
  },
  statement: statementOf(trainReading),
  notes: [
    'The clustered interval is the one that decides this round. Questions inside a database are not independent — one package of rules reaches all of them — so the interval resamples databases. The question-level interval is in the source artefact and is narrower on train by 0.03pp, which is why it was not the one quoted.',
    'No accuracy is compared across the two splits. Dev and train share no database, so only the paired differences between arms are the same quantity.',
    'The dev column of the table is the reading this round was registered against. It is recomputed here rather than quoted from the documentation, so the two cannot drift.',
  ],
});

const pct = (value: number | null): string => (value === null ? 'n/a' : value.toFixed(2));
process.stdout.write(`[out-of-sample] ${statementOf(trainReading)}\n`);
for (const row of table) {
  process.stdout.write(`[out-of-sample] ${row.label.padEnd(30)} dev ${row.dev.padEnd(28)} train ${row.train}\n`);
}
for (const verdict of verdicts) {
  process.stdout.write(`[out-of-sample] ${verdict.holds ? 'holds ' : 'FAILED'} ${verdict.id} — ${verdict.observed}\n`);
}
process.stdout.write(
  `[out-of-sample] folds ${trainReading.folds.negative} negative, ${trainReading.folds.positive} positive, ` +
    `${trainReading.folds.ties} ties, p=${trainReading.folds.p.toFixed(4)}\n`,
);
