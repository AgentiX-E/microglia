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
import {
  densityGates,
  type CrossFitRow,
  type DensityReport,
  type EvidenceRow,
  type PolicyRow,
  type StratumSummary,
  type TransferRow,
} from '@agentix-e/microglia-eval';
import { birdArtefactPath } from './lib.js';

type Artifact = {
  readonly metrics?: {
    readonly density?: DensityReport;
    readonly density_excluded?: Readonly<Record<string, number>>;
    readonly density_unplaced?: number;
    readonly density_unmeasured?: number;
    /** The trials themselves, carried so a different split can be read without new calls. */
    readonly density_ledger?: readonly unknown[];
    readonly density_floor_ledger?: readonly unknown[];
    readonly density_transfer_ledger?: readonly unknown[];
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

/**
 * One cross-fitted reading, printed next to the single-split policies so the two can be compared.
 *
 * The store and the floor are fitted by the same machinery: if foreign rules earn as much as the
 * store's rules do, what is being measured is the machinery and not the content.
 */
function crossLine(label: string, row: CrossFitRow): string {
  return (
    `[density] ${label.padEnd(7)} shows ${String(row.shown).padStart(4)} of ${row.injections}  ` +
    `${(row.baselineAccuracy * 100).toFixed(1)}% -> ${(row.treatmentAccuracy * 100).toFixed(1)}%  ` +
    `${signed(row.deltaPp)} [${row.ciLowPp.toFixed(2)}, ${row.ciHighPp.toFixed(2)}]  ` +
    `+${row.gained} / -${row.lost}  ` +
    `${row.folds} fold(s) x ${row.repeats} repeat(s)\n`
  );
}

/**
 * One stratum of the foreign arm, with its home counterpart beside it.
 *
 * The two rates travel together because R6 closed on the break rate: a repair rate whose denominator
 * drops every trial the rule damages can only go up, and a foreign reading that quotes only the
 * repair rate would repeat that mistake in a new place.
 */
function transferLine(label: string, row: TransferRow): string {
  const rate = (part: number, whole: number): string =>
    `${part}/${whole}=${(whole === 0 ? 0 : (part / whole) * 100).toFixed(1)}%`;
  return (
    `[density] transfer ${label.padEnd(9)} rules ${String(row.rules).padStart(3)}  ` +
    `trials ${String(row.trials).padStart(4)}  ${signed(row.deltaPp)} ` +
    `[${row.ciLowPp.toFixed(2)}, ${row.ciHighPp.toFixed(2)}]  ` +
    `repair ${rate(row.repaired, row.informative)}  break ${rate(row.broke, row.breakable)}  ` +
    `home ${signed(row.home.deltaPp)}\n`
  );
}

/** One row of the evidence curve: how much the fit was allowed to see, and what it earned. */
function evidenceLine(row: EvidenceRow): string {
  return (
    `[density] evidence m=${String(row.cap).padStart(2)}  ` +
    `shows ${String(row.shown).padStart(6)} of ${row.injections}  ` +
    `${signed(row.deltaPp)} [${row.ciLowPp.toFixed(2)}, ${row.ciHighPp.toFixed(2)}]  ` +
    `+${row.gained} / -${row.lost}\n`
  );
}

function main(): void {
  const artifact = JSON.parse(readFileSync(birdArtefactPath(), 'utf8')) as Artifact;
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
  // R9.3: the same policy fitted out of fold on repeated splits, and the floor fitted the same way.
  // Guarded because an artefact produced before this reading existed carries the four single-split
  // policies and no cross-fit, and pointing this command at one is not an error.
  if (report.crossFit !== undefined) {
    process.stdout.write(crossLine('xfit', report.crossFit.store));
    process.stdout.write(crossLine('xfit-fl', report.crossFit.floor));
  }
  // R9.4: the same rules, pointed at questions from databases that are not their own.
  if (report.transfer !== undefined) {
    const transfer = report.transfer;
    process.stdout.write(
      `[density] transfer: ${transfer.trials} injection(s) over ${transfer.domains} database(s), ` +
        `${transfer.offHome} on the rule own, ${transfer.targets} distinct question(s)\n`,
    );
    for (const row of transfer.strata) process.stdout.write(transferLine(row.kind, row));
    process.stdout.write(transferLine('all', transfer.overall));
  }
  // R10: whether the rule was shown as a sentence or as a template bound to the target schema, and
  // what the binder could not bind. A withheld share above 60% is the stage's own kill condition, so
  // it is printed before the rates rather than left for a reader to divide.
  if (report.templates !== undefined) {
    const templates = report.templates;
    process.stdout.write(
      `[density] templates: ${templates.bound} bound + ${templates.slotless} slotless shown, ` +
        `${templates.withheld} withheld (${(templates.withheldShare * 100).toFixed(1)}%) over ` +
        `${templates.rules} rule(s)\n`,
    );
    for (const blocker of templates.blockers.slice(0, 8)) {
      process.stdout.write(
        `[density] templates: ${blocker.kind} '${blocker.name}' stopped ${blocker.attempts} attempt(s)\n`,
      );
    }
  }
  // R9.5: how many observations a rule needs before the policy may believe its sign.
  for (const row of report.evidence ?? []) process.stdout.write(evidenceLine(row));
  const ledger = artifact.metrics?.density_ledger?.length ?? 0;
  if (ledger > 0) {
    const floorLedger = artifact.metrics?.density_floor_ledger?.length ?? 0;
    const crossLedger = artifact.metrics?.density_transfer_ledger?.length ?? 0;
    process.stdout.write(
      `[density] carried ${ledger} store trial(s), ${floorLedger} floor trial(s) and ` +
        `${crossLedger} foreign trial(s): a different split can be read from the artefact instead ` +
        `of re-bought\n`,
    );
  }
  for (const gate of densityGates(report)) {
    process.stdout.write(
      `[density] ${gate.pass ? 'pass' : 'FAIL'} ${gate.id}${gate.blocking ? '' : ' (advisory)'}: ${gate.actual}\n`,
    );
  }

  // How the flips are distributed over the rules, because a stratum's flip rate is an average and
  // the average is what hid the shape for ten iterations: a few rules that move several answers and
  // a majority that move none looks exactly like one rule moving a few.
  const buckets = new Map<number, number>();
  for (const row of report.perRule) {
    const flips = row.helped + row.harmed;
    buckets.set(flips, (buckets.get(flips) ?? 0) + 1);
  }
  const histogram = [...buckets.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([flips, rules]) => `${flips}:${rules}`)
    .join(' ');
  process.stdout.write(`[density] flips per rule (flips:rules) ${histogram}\n`);
  const signs = report.signs;
  process.stdout.write(
    `[density] sign persistence ${signs.agreed} of ${signs.paired} rule(s) that had a sign on both ` +
      `halves kept it (${(signs.agreement * 100).toFixed(1)}%), p ${signs.p.toFixed(3)}; ` +
      `${signs.withFitSign} rule(s) had a sign to learn from\n`,
  );
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
