/**
 * R9.1's reading: what one rule does when it is given twenty chances.
 *
 * The artefact already carries the ledger; this command turns it back into sentences, because the
 * distinction the stage exists for is not visible in a single accuracy:
 *
 *  - a rule that never moves an answer is **inert**, and inertness at twenty chances is a different
 *    finding from inertness at three;
 *  - a rule that moves answers only when its vocabulary is in the question is **retrievable**, which
 *    makes the store's silence a retrieval problem rather than a distillation one;
 *  - a rule that moves answers as often as a rule from another database does is **noise**, and every
 *    attribution this project has published would have to be reread.
 *
 * The floor is what separates the third from the first two, and it costs one rule per database.
 * Nothing here is a bar: the gates are in the artefact, and this command exits zero whatever they
 * say, because a family that failed its own pre-registration is a result.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { densityGates, type DensityReport, type PolicyRow, type StratumSummary } from '@agentix-e/microglia-eval';

type Artifact = {
  readonly metrics?: {
    readonly density?: DensityReport;
    readonly density_excluded?: Readonly<Record<string, number>>;
    readonly density_unplaced?: number;
    readonly density_unmeasured?: number;
  };
};

const RESULTS = process.env['POC_RESULT_DIR'] ?? join(process.cwd(), 'eval', 'results');

const signed = (value: number): string => `${value >= 0 ? '+' : ''}${value.toFixed(2)}pp`;

function stratumLine(label: string, stratum: StratumSummary): string {
  return (
    `[density] ${label.padEnd(12)} ${String(stratum.rules).padStart(3)} rule(s) ` +
    `${String(stratum.injections).padStart(5)} injection(s)  ` +
    `discriminating ${(100 - stratum.inertShare * 100).toFixed(1)}%  ` +
    `flips ${(stratum.flipRate * 100).toFixed(1)}%  ` +
    `${(stratum.baselineAccuracy * 100).toFixed(1)}% -> ${(stratum.treatmentAccuracy * 100).toFixed(1)}%  ` +
    `${signed(stratum.deltaPp)} [${stratum.ciLowPp.toFixed(2)}, ${stratum.ciHighPp.toFixed(2)}]  ` +
    `sign p ${stratum.signP.toFixed(3)}\n`
  );
}

function policyLine(row: PolicyRow): string {
  return (
    `[density] ${row.name.padEnd(7)} shows ${String(row.shown).padStart(4)} of ${row.injections}  ` +
    `${(row.baselineAccuracy * 100).toFixed(1)}% -> ${(row.treatmentAccuracy * 100).toFixed(1)}%  ` +
    `${signed(row.deltaPp)} [${row.ciLowPp.toFixed(2)}, ${row.ciHighPp.toFixed(2)}]  ` +
    `+${row.gained} / -${row.lost}\n`
  );
}

function main(): void {
  const artifact = JSON.parse(readFileSync(join(RESULTS, 'poc-sota-bird.json'), 'utf8')) as Artifact;
  const report = artifact.metrics?.density;
  if (report === undefined) {
    process.stdout.write(
      '[density] this run did not measure the family: dispatch with SOTA_DENSITY_PANEL set to a\n' +
        '[density] positive number of questions per rule (zero is the default because the stage costs\n' +
        '[density] one call per rule per question)\n',
    );
    return;
  }

  process.stdout.write(
    `[density] ${report.rules} rule(s) x ${report.panel} question(s) over ${report.targets} ` +
      `target(s): ${report.injections} injection(s), ${report.shown.min}-${report.shown.max} per rule ` +
      `(median ${report.shown.median})\n`,
  );
  const excluded = Object.entries(artifact.metrics?.density_excluded ?? {});
  if (excluded.length > 0) {
    process.stdout.write(
      `[density] left out ${excluded.map(([db, count]) => `${db} (${count} usable question(s))`).join(', ')}\n`,
    );
  }
  const unplaced = artifact.metrics?.density_unplaced ?? 0;
  if (unplaced > 0) {
    process.stdout.write(`[density] ${unplaced} selected rule(s) named a database the panels do not cover\n`);
  }
  const unmeasured = artifact.metrics?.density_unmeasured ?? 0;
  if (unmeasured > 0) {
    process.stdout.write(`[density] ${unmeasured} injection(s) never returned and are not in the ledger\n`);
  }

  process.stdout.write(stratumLine('overall', report.overall));
  process.stdout.write(stratumLine('relevant', report.relevant));
  process.stdout.write(stratumLine('irrelevant', report.irrelevant));
  process.stdout.write(stratumLine('cued', report.cued));
  process.stdout.write(stratumLine('floor', report.floor));
  for (const row of report.policies) process.stdout.write(policyLine(row));
  for (const gate of densityGates(report)) {
    process.stdout.write(
      `[density] ${gate.pass ? 'pass' : 'FAIL'} ${gate.id}${gate.blocking ? '' : ' (advisory)'}: ${gate.actual}\n`,
    );
  }

  const relevant = report.relevant;
  const floorFlip = report.floor.flipRate;
  process.stdout.write(
    report.rules === 0
      ? '[density] the run selected no rule, so nothing here is a measurement of the store\n'
      : `[density] ${(relevant.inertShare * 100).toFixed(1)}% of the rules shown a question they could answer ` +
          `never moved it, against ${(report.overall.inertShare * 100).toFixed(1)}% overall; the floor flips ` +
          `${(floorFlip * 100).toFixed(1)}% of injections and the store flips ` +
          `${(report.overall.flipRate * 100).toFixed(1)}%\n`,
  );
}

main();
