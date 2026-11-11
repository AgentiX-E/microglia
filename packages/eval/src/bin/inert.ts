/**
 * R77's reading, recomputed from an artefact with zero calls.
 *
 * The dispatch buys the `loo` arm; this prints how much of the pack changed any answer. Everything here
 * is a column in a file that has already been paid for: `per_case.predictedSql` is the `full` arm's
 * statement, `per_case.armSql.loo` is the same question with one rule withheld, and `per_case.looDropped`
 * is which rule it was.
 *
 *   pnpm eval:inert                      # the artefact `chooseArtefact` picks
 *   pnpm eval:inert --bird path.json     # one file
 *
 * Read it at temperature 0 and nowhere else. At any other temperature the same prompt returns the same
 * query by chance, and every "unchanged" pair is then a mixture of a rule that did nothing and a decoder
 * that did not move — R74 measured 52.0% at T = 0.7, which is why the number this prints is only a
 * count when the run was deterministic.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  drawSpread,
  inertReading,
  liveShareBuckets,
  silenceReading,
  silenceTargets,
  type InertPair,
} from '@agentix-e/microglia-eval';
import { birdArtefactPath } from './lib.js';

type Row = {
  readonly questionId?: string | number | null;
  readonly predictedSql?: string | null;
  readonly armSql?: Readonly<Record<string, string | null>> | undefined;
  readonly looDropped?: string | null;
  readonly arms?: Readonly<Record<string, boolean>> | undefined;
};

type Artefact = {
  readonly per_case: readonly Row[];
  readonly config?: { readonly sample_temperature?: number | null; readonly split?: string | null };
};

export function main(argv: readonly string[]): number {
  const index = argv.indexOf('--bird');
  const path = index === -1 ? birdArtefactPath() : (argv[index + 1] ?? birdArtefactPath());
  const artefact = JSON.parse(readFileSync(path, 'utf8')) as Artefact;

  const pairs: InertPair[] = [];
  for (const row of artefact.per_case) {
    const without = row.armSql?.['loo'];
    if (without === undefined) continue;
    pairs.push({
      id: row.questionId === null || row.questionId === undefined ? '' : String(row.questionId),
      rule: row.looDropped ?? null,
      full: row.predictedSql ?? '',
      without: without ?? '',
    });
  }
  if (pairs.length === 0) {
    process.stdout.write(
      `[inert] ${join('.', path)}: no 'loo' statement recorded, so the arm did not run in this artefact\n`,
    );
    return 0;
  }

  const reading = inertReading(pairs);
  const temperature = artefact.config?.sample_temperature;
  process.stdout.write(`[inert] artefact    ${path}\n`);
  process.stdout.write(
    `[inert] temperature ${temperature === undefined || temperature === null ? 'not recorded' : String(temperature)}` +
      (temperature === 0 ? ' — deterministic, so an unchanged pair is an inert rule\n' : ' — NOT zero: unchanged pairs mix inertness with coincidence\n'),
  );
  process.stdout.write(
    `[inert] pairs       ${String(reading.pairs)} compared, ${String(reading.unmeasured)} with no statement on one side, ` +
      `${String(reading.unwithheld)} with nothing withheld\n`,
  );
  process.stdout.write(
    `[inert] inert       ${String(reading.inert)} of ${String(reading.pairs)} = ` +
      `${(reading.inertShare * 100).toFixed(2)}%  (${String(reading.caseOnly)} live pair(s) differ only by case)\n`,
  );
  const spread = drawSpread(reading.rules);
  process.stdout.write(
    `[inert] rules       ${String(spread.rules)} ever withheld; draws per rule median ${String(spread.median)}, ` +
      `p90 ${String(spread.p90)}, max ${String(spread.max)}\n`,
  );
  process.stdout.write(
    `[inert] wholly      ${String(reading.whollyInert)} rule(s) changed no answer on any draw they got ` +
      `(${((reading.whollyInert / Math.max(1, spread.rules)) * 100).toFixed(1)}% of the pack)\n`,
  );
  process.stdout.write(
    `[inert] concentration the busiest tenth of the rules produced ` +
      `${(reading.liveConcentration * 100).toFixed(1)}% of the live answers\n`,
  );
  process.stdout.write('[inert] live share  bucket        rules\n');
  for (const bucket of liveShareBuckets(reading.rules)) {
    process.stdout.write(
      `[inert]             ${`${(bucket.atLeast * 100).toFixed(0)}–${(bucket.below * 100).toFixed(0)}%`.padEnd(12)} ` +
        `${String(bucket.rules).padStart(5)}\n`,
    );
  }
  // What the silence is evidence of, which is the difference between a pruning and a bigger sample. A
  // rule silent on three draws at the pack's own rate is silent by chance an eighth of the time, so the
  // headline number above over-counts dead rules by however many of them are short.
  const silence = silenceReading(reading.rules);
  process.stdout.write(
    `[inert] working     the rules that fired did so on ${(silence.workingRate * 100).toFixed(1)}% of ` +
      `their draws, which predicts ${silence.expectedSilent.toFixed(1)} silence(s) among the ` +
      `${String(silence.silent)}\n`,
  );
  process.stdout.write(
    `[inert] silent      ${String(silence.silent)} rule(s) never fired; ${silence.excess.toFixed(1)} more ` +
      `than that rate explains, and ${String(silence.underPowered)} of them hold fewer than ` +
      `${String(silence.drawsToResolve)} draw(s), where silence would be chance once in twenty\n`,
  );
  // The purchase order, when one is asked for: which rules are short of draws, how many each, and in
  // what order a dispatch that can only pay for part of the plan should pay for them.
  const emitAt = argv.indexOf('--emit-targets');
  if (emitAt !== -1) {
    const destination = argv[emitAt + 1];
    if (destination === undefined) throw new Error('--emit-targets needs a path');
    const drawsFlag = argv.indexOf('--draws');
    const draws = drawsFlag === -1 ? 5 : Number(argv[drawsFlag + 1]);
    const capFlag = argv.indexOf('--cap');
    const targets = silenceTargets(reading.rules, {
      draws: Number.isFinite(draws) ? draws : 5,
      cap: capFlag === -1 ? undefined : Number(argv[capFlag + 1]),
    });
    writeFileSync(
      destination,
      `${JSON.stringify({ source: path, draws, targets }, null, 2)}\n`,
      'utf8',
    );
    process.stdout.write(
      `[inert] targets     ${String(targets.length)} rule(s), ` +
        `${String(targets.reduce((sum, row) => sum + row.need, 0))} draw(s) short of ${String(draws)} ` +
        `-> ${destination}\n`,
    );
  }
  // The busiest rules, because a pack's problem is usually visible in the first ten lines of this table.
  process.stdout.write('[inert] top rules   rule                          draws  live\n');
  for (const rule of reading.rules.slice(0, 10)) {
    process.stdout.write(
      `[inert]             ${rule.rule.padEnd(28)} ${String(rule.draws).padStart(5)} ${String(rule.live).padStart(5)}\n`,
    );
  }
  return 0;
}

process.exitCode = main(process.argv.slice(2));
