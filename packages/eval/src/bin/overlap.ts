/**
 * The routing table R72 was registered on, recomputed from an artefact.
 *
 * The registration quoted three numbers from a measurement that existed only in a session: the tercile
 * means, the net flips per tercile, and a cross-fitted threshold region. A registration citing a number
 * no committed code can reproduce is a hypothesis with an unverifiable premise, so this command exists
 * to re-derive all three from the file — and it is what the amendment to R72 was written from, because
 * recomputing moved the threshold by 0.04 and the withheld share by four points.
 *
 *   pnpm eval:overlap                      # the artefact `chooseArtefact` picks
 *   pnpm eval:overlap --bird path.json     # one file
 *
 * Zero calls: everything here is a column in an artefact that has already been paid for.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  OVERLAP_ROUTED_THRESHOLD,
  comparePaired,
  crossFittedThresholds,
  overlapTerciles,
  packOverlapOf,
  tercileVerdicts,
  type OverlapRow,
} from '@agentix-e/microglia-eval';
import { birdArtefactPath } from './lib.js';

type Row = {
  readonly fold: number;
  readonly question?: string | null;
  readonly evidence?: string | null;
  readonly correct: boolean;
  readonly withoutMemoryCorrect: boolean;
  readonly injected?: readonly string[] | null;
};

type Artefact = {
  readonly per_case: readonly Row[];
  readonly generated_at?: string;
};

export function main(argv: readonly string[]): number {
  const index = argv.indexOf('--bird');
  const path = index === -1 ? birdArtefactPath() : (argv[index + 1] ?? birdArtefactPath());
  const artefact = JSON.parse(readFileSync(path, 'utf8')) as Artefact;
  const rows = artefact.per_case.filter((row) => row.question !== null && row.question !== undefined);
  if (rows.length === 0) {
    process.stdout.write(`[overlap] ${path}: no per-case question text, so nothing to route\n`);
    return 0;
  }
  const measured = rows.map((row) => ({
    fold: typeof row.fold === 'number' ? row.fold : 0,
    overlap: packOverlapOf(row.injected ?? [], row.question ?? '', row.evidence),
    gained: row.correct && !row.withoutMemoryCorrect,
    lost: !row.correct && row.withoutMemoryCorrect,
  }));
  const table = overlapTerciles(measured as readonly OverlapRow[]);
  process.stdout.write(
    `[overlap] ${join('.', path)}: ${String(table.all.n)} question(s), net flips ${String(table.all.net)} ` +
      `(${table.all.per100.toFixed(2)} per 100)\n`,
  );
  for (const entry of table.terciles) {
    process.stdout.write(
      `[overlap] ${entry.name.padEnd(6)} mean overlap ${entry.mean.toFixed(3)}  n ${String(entry.n)}  ` +
        `net ${String(entry.net)}  (${entry.per100.toFixed(2)} per 100)\n`,
    );
  }
  // R72's branch is about the low tercile's sign, and a count without an interval cannot decide it.
  const verdicts = tercileVerdicts(measured, OVERLAP_ROUTED_THRESHOLD);
  process.stdout.write(
    `[overlap] tercile  injecting (95% CI, p)              routing at ${OVERLAP_ROUTED_THRESHOLD.toFixed(2)}` +
      `                gate gain\n`,
  );
  const format = (reading: { net: number; per100: number; low: number; high: number; p: number }): string =>
    `${reading.net >= 0 ? '+' : ''}${String(reading.net)} (${reading.per100 >= 0 ? '+' : ''}${reading.per100.toFixed(2)}pp ` +
    `[${reading.low.toFixed(2)}, ${reading.high.toFixed(2)}] p ${reading.p.toFixed(4)})`;
  for (const verdict of verdicts) {
    process.stdout.write(
      `[overlap] ${verdict.name.padEnd(7)} ${format(verdict.injected).padEnd(44)} ` +
        `${format(verdict.routed).padEnd(44)} ${format(verdict.gain)}\n`,
    );
  }
  for (const entry of table.withheldShare) {
    process.stdout.write(
      `[overlap] a pack below ${entry.threshold.toFixed(2)} would be withheld on ` +
        `${(entry.share * 100).toFixed(1)}% of questions\n`,
    );
  }
  const choices = crossFittedThresholds(measured);
  const thresholds = choices.map((choice) => choice.threshold);
  process.stdout.write(
    `[overlap] cross-fitted: ${choices.map((choice) => `${choice.fold}->${choice.threshold.toFixed(2)}`).join(', ')} ` +
      `(region ${Math.min(...thresholds).toFixed(2)}–${Math.max(...thresholds).toFixed(2)})\n`,
  );
  const policy = choices.reduce((sum, choice) => sum + choice.testNet, 0);
  const baseline = choices.reduce((sum, choice) => sum + choice.baselineTestNet, 0);
  process.stdout.write(
    `[overlap] cross-fitted policy ${String(policy)} flips against always-injecting's ${String(baseline)} ` +
      `(${policy - baseline >= 0 ? '+' : ''}${String(policy - baseline)})\n`,
  );
  if (!argv.includes('--policy')) return 0;

  // A routing policy that chooses between two arms already measured on every question is *evaluated*,
  // not estimated: both actions were observed for every question, so any deterministic rule over the
  // recorded pack text has an exact counterfactual. That is why R72 needs no arm of its own.
  const withMemory = rows.map((row) => row.correct);
  const withoutMemory = rows.map((row) => row.withoutMemoryCorrect);
  const sortedOverlaps = measured.map((row) => row.overlap).sort((left, right) => left - right);
  const lowCount = Math.floor(measured.length / 3);
  const lowCutoff = lowCount === 0 ? 0 : (sortedOverlaps[lowCount - 1] ?? 0);
  process.stdout.write(
    '[overlap] threshold  withheld   policy acc   delta vs always-inject   95% CI              low-tercile net\n',
  );
  for (const threshold of [0.2, 0.22, 0.24, 0.26, 0.28, 0.3, 0.34, 0.38, 0.4, 0.44]) {
    const routed = measured.map((row, index) =>
      row.overlap >= threshold ? (withMemory[index] ?? false) : (withoutMemory[index] ?? false),
    );
    const paired = comparePaired(withMemory, routed, 7, 10_000);
    const withheld = measured.filter((row) => row.overlap < threshold).length / measured.length;
    let lowNet = 0;
    measured.forEach((row, index) => {
      if (row.overlap > lowCutoff) return;
      const correct = routed[index] ?? false;
      const baselineCorrect = withMemory[index] ?? false;
      lowNet += (correct && !baselineCorrect ? 1 : 0) - (!correct && baselineCorrect ? 1 : 0);
    });
    process.stdout.write(
      `[overlap] ${threshold.toFixed(2).padStart(9)}  ${(withheld * 100).toFixed(1).padStart(7)}%   ` +
        `${(paired.treatmentAccuracy * 100).toFixed(2).padStart(10)}%   ` +
        `${(paired.delta >= 0 ? '+' : '')}${(paired.delta * 100).toFixed(2)}pp`.padEnd(24) +
        `[${(paired.deltaCI.low * 100).toFixed(2)}, ${(paired.deltaCI.high * 100).toFixed(2)}]`.padEnd(20) +
        `${lowNet >= 0 ? '+' : ''}${String(lowNet)}\n`,
    );
  }
  return 0;
}

process.exitCode = main(process.argv.slice(2));
