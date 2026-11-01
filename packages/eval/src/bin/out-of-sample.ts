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
  memoryDiscordanceOf,
  outOfSampleReadingOf,
  powerVerdictOf,
  sideBySideOf,
  type CommittedRun as LibraryRun,
  type MemoryDiscordance,
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

const devDiscordance = memoryDiscordanceOf(dev.cases);
const trainDiscordance = memoryDiscordanceOf(train.cases);

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
  // Both bars, in one sentence: the interval that excludes zero, and the design's own resolution.
  // The second is the stricter one and it is the one this project files every other artefact under.
  const power = powerVerdictOf(reading.measured);
  return (
    `Out of sample, memory ${harm} ${Math.abs(reading.deltaPp).toFixed(2)}pp ` +
    `(${power.significant95 ? 'interval excludes zero' : 'interval covers zero'}, ` +
    `${power.resolvable ? 'above' : 'below'} the design's ${(power.minDetectablePp ?? 0).toFixed(2)}pp 80%-power resolution). ` +
    `The read-time gate recovers ${recovered.toFixed(2)}pp of it, leaving ${net.toFixed(2)}pp, ` +
    `which is ${product ? 'still distinguishable from no memory' : 'not distinguishable from no memory'}.`
  );
}

/**
 * The sentence the arm's single delta cannot say.
 *
 * A negative delta invites "memory is bad", and the two rates behind it say something narrower: the
 * pack repairs some of what the bare attempt got wrong while breaking some of what it got right, and
 * what turns that into a product decision is the filter's precision. Built from the reading like
 * `statementOf`, so the prose cannot survive a change in the numbers it quotes.
 *
 * The counts are quoted alongside the rates because they disagree in sign and the disagreement is the
 * finding. On the out-of-sample corpus 6.39% of the wrong answers are repaired and 5.82% of the right
 * ones are broken — help is the *more likely* outcome per question — and yet 187 repairs against 237
 * breaks is under one repair per break. The base is not symmetric: 2,925 questions could only be
 * helped and 4,075 could only be harmed. Quoting either number alone would let a reader conclude the
 * opposite of what the pair says.
 */
function precisionStatementOf(reading: MemoryDiscordance): string {
  const text = (value: number | null, digits = 2): string => (value === null ? 'n/a' : value.toFixed(digits));
  const count = (value: number): string => value.toLocaleString('en-US');
  const heavier = reading.net < 0 ? 'heavier' : 'lighter';
  const ceiling = text(reading.ceilingPp);
  const share = reading.shareOfCeiling === null ? 'n/a' : (reading.shareOfCeiling * 100).toFixed(1);
  return (
    `Memory repairs ${text(reading.attempted.ratePp)}% of the ${count(reading.attempted.n)} questions the bare attempt got ` +
    `wrong and breaks ${text(reading.correct.ratePp)}% of the ${count(reading.correct.n)} it got right: ${text(reading.helpPerHarm)} ` +
    `repairs per break, so the arm is a reshuffle with a ${heavier} bad side rather than a drag. The rates are close and ` +
    `the counts are not, because the base is not symmetric — ${count(reading.attempted.n)} questions could only be helped and ` +
    `${count(reading.correct.n)} could only be harmed. A filter that saw every break would be worth ${ceiling}pp; this one discards ` +
    `${reading.filter.discarded} questions (${text((reading.filter.discardedShare ?? 0) * 100, 1)}%), catches ` +
    `${text((reading.filter.caughtShareOfBroken ?? 0) * 100, 1)}% of the breaks and throws away ` +
    `${text((reading.filter.caughtShareOfRepaired ?? 0) * 100, 1)}% of the repairs, spends ` +
    `${text(reading.filter.discardedPerNetError, 1)} questions per net error it prevents, and realises ` +
    `${text(reading.realisedPp)}pp of the ${ceiling}pp available, which is ${share}% of the ceiling.`
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
    resolution: powerVerdictOf(devReading.measured),
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
    resolution: powerVerdictOf(trainReading.measured),
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
  /**
   * What the filter can see of the two directions memory moves a question.
   *
   * Both corpora, because the dev column is where the hypothesis was formed and the train column is
   * where it was tested: if the repair and break rates were the same on both, the arm's sign flip
   * would have to come from the mix of questions rather than from the mechanism.
   */
  discordance: {
    dev: devDiscordance,
    train: trainDiscordance,
    statement: precisionStatementOf(trainDiscordance),
  },
  notes: [
    'The clustered interval is the one that decides this round. Questions inside a database are not independent — one package of rules reaches all of them — so the interval resamples databases. The question-level interval is in the source artefact and is narrower on train by 0.03pp, which is why it was not the one quoted.',
    'No accuracy is compared across the two splits. Dev and train share no database, so only the paired differences between arms are the same quantity.',
    'The dev column of the table is the reading this round was registered against. It is recomputed here rather than quoted from the documentation, so the two cannot drift.',
    'The discordance block splits the corpus by what memory did rather than by what it is worth. Both directions are present on both splits: the pack repairs some of what the bare attempt got wrong and breaks some of what it got right, and a negative delta is entirely consistent with both happening at once. What separates the two splits is the exchange rate between them, and the base the two rates act on. More questions are right without memory than wrong, so a break rate buys more breaks than the same repair rate buys repairs — a base effect, not a severity effect, and the reason the arm can flip sign while the mechanism stays put.',
    'The filter column is the part that decides the product, and it tells the same story on both splits: the gate spends an order of magnitude more questions per net error it prevents than a filter that could see the breaks would, and realises a minority of its own ceiling. A read-time gate that catches a fraction of the breaks at the cost of a fraction of the repairs was never going to carry the product, in sample or out. That is a statement about the signal, not about the corpus it was measured on.',
    'Each resolution block names which of the two bars the arm clears. A delta can exclude zero at 95% and still sit under the 80%-power resolution the design was sized for, and the train arm does: -0.71pp against 0.82pp. That is the same category eval:power assigns to the rest of this repository and it is not upgraded here for being the round that mattered.',
  ],
});

process.stdout.write(`[out-of-sample] ${statementOf(trainReading)}\n`);
for (const row of table) {
  process.stdout.write(`[out-of-sample] ${row.label.padEnd(30)} dev ${row.dev.padEnd(28)} train ${row.train}\n`);
}
for (const verdict of verdicts) {
  process.stdout.write(`[out-of-sample] ${verdict.holds ? 'holds ' : 'FAILED'} ${verdict.id} — ${verdict.observed}\n`);
}
process.stdout.write(
  `[out-of-sample] resolution ${powerVerdictOf(trainReading.measured).label} — ` +
    `${Math.abs(trainReading.deltaPp).toFixed(2)}pp against ${(powerVerdictOf(trainReading.measured).minDetectablePp ?? 0).toFixed(2)}pp\n`,
);
process.stdout.write(`[out-of-sample] ${precisionStatementOf(trainDiscordance)}\n`);
process.stdout.write(
  `[out-of-sample] folds ${trainReading.folds.negative} negative, ${trainReading.folds.positive} positive, ` +
    `${trainReading.folds.ties} ties, p=${trainReading.folds.p.toFixed(4)}\n`,
);
