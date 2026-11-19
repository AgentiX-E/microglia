/**
 * Read the two conditional rates out of archive pair artefacts, and check the decomposition against the delta.
 *
 * R155's table is produced here rather than assembled by hand for the same reason R154's was: the numbers are
 * the argument, and an argument copied from a terminal is an argument nobody can re-run. Every row is
 * arithmetic over a committed artefact — the repair count and the break count the pair already carries, divided
 * by the populations they came from.
 *
 * The command is also a **gate**, and the gate is narrower than the finding. It does not grade whether a store
 * pays for itself — that is a measurement, and a build that fails on a negative measurement teaches its readers
 * to skip the line. It grades whether `serveYield`'s counts reconstruct the delta the pair published, because
 * two independent blocks that disagree about one comparison mean one of them is wrong, and neither of them says
 * which. Exits 2 for an artefact it cannot read, 1 for a decomposition that does not reconcile, 0 otherwise.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { conditionalReading, stratifyByK, type ConditionalReading } from '../conditional.js';
import { tasksForDelta } from '../detectable.js';
import { certificationLine, certificationOf, changePriceOf, passesToCertify } from '../certify.js';

type Rate = { readonly rate: number; readonly lo: number; readonly hi: number };

type PairShape = {
  readonly comparison?: { readonly paired?: number; readonly deltaPp?: number };
  readonly serveYield?: {
    readonly renders?: number;
    readonly opportunity?: number;
    readonly repairs?: number;
    readonly breaks?: number;
  };
  readonly conditional?: {
    readonly trials?: number;
    readonly failedControl?: number;
    readonly repairs?: number;
    readonly breaks?: number;
    readonly netPp?: number;
  };
};

/** How far a decomposition may sit from the published delta: both are computed from the same integers. */
const RECONCILE_PP = 0.005;

const arguments_ = process.argv.slice(2);
const drawsPath = arguments_
  .find((argument) => argument.startsWith('--draws='))
  ?.slice('--draws='.length);
const paths = arguments_.filter((argument) => !argument.startsWith('--'));
if (paths.length === 0) {
  process.stderr.write('usage: conditional <pair-artefact.json ...> [--draws=<census.json>]\n');
  process.exit(2);
}

function pct(share: number): string {
  return `${(share * 100).toFixed(2)}%`;
}

function interval(rate: Rate | null | undefined): string {
  if (rate === undefined || rate === null) return '—';
  return `${pct(rate.rate)} [${pct(rate.lo)}, ${pct(rate.hi)}]`;
}

const readings: { name: string; paired: number; reading: ConditionalReading; deltaPp: number }[] = [];
let unreconciled = 0;

process.stdout.write('| fold | trials | failed | repaired | passed | broken | repair rate | break rate | break-even | net |\n');
process.stdout.write('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n');

for (const path of paths) {
  const absolute = path.startsWith('/') ? path : join(process.cwd(), path);
  let pair: PairShape;
  try {
    pair = JSON.parse(readFileSync(absolute, 'utf8')) as PairShape;
  } catch (error) {
    process.stderr.write(`conditional: cannot read ${path}: ${String(error)}\n`);
    process.exit(2);
  }
  const block = pair.conditional;
  const yields = pair.serveYield;
  // The block travels in the artefact when the driver that wrote it had one; older artefacts are read from the
  // census they do carry. Both routes end in the same four counts, which is what makes the recount a check.
  const trials = block?.trials ?? yields?.renders;
  const failedControl = block?.failedControl ?? yields?.opportunity;
  const repairs = block?.repairs ?? yields?.repairs;
  const breaks = block?.breaks ?? yields?.breaks;
  if (
    typeof trials !== 'number' ||
    typeof failedControl !== 'number' ||
    typeof repairs !== 'number' ||
    typeof breaks !== 'number'
  ) {
    process.stderr.write(`conditional: ${path} carries neither a conditional block nor a serveYield census\n`);
    process.exit(2);
  }
  const reading = conditionalReading({ trials, failedControl, repairs, breaks });
  const paired = pair.comparison?.paired ?? trials;
  const deltaPp = pair.comparison?.deltaPp ?? 0;
  if (Math.abs(reading.netPp - deltaPp) > RECONCILE_PP) {
    unreconciled += 1;
    process.stderr.write(
      `conditional: ${path} decomposes to ${reading.netPp.toFixed(2)}pp but published ${deltaPp.toFixed(2)}pp — ` +
        'the census and the comparison are two readings of one sample and they disagree\n',
    );
  }
  // The label every later block looks the row up by, so the census can be checked against the artefact it
  // claims to describe rather than against a second copy of the numbers.
  const name = path.replace(`${process.cwd()}/`, '').replace('eval/results/', '').replace('.json', '');
  readings.push({ name, paired, reading, deltaPp });
  process.stdout.write(
    `| \`${name}\` | ${String(reading.trials)} | ${String(reading.failedControl)} | ${String(reading.repairs)} | ` +
      `${String(reading.passedControl)} | ${String(reading.breaks)} | ${interval(reading.repairRate)} | ` +
      `${interval(reading.breakRate)} | ${pct(reading.breakEvenRate)} | ${reading.netPp.toFixed(2)}pp |\n`,
  );
}

const pool = readings.reduce(
  (sum, row) => ({
    trials: sum.trials + row.reading.trials,
    failedControl: sum.failedControl + row.reading.failedControl,
    repairs: sum.repairs + row.reading.repairs,
    breaks: sum.breaks + row.reading.breaks,
  }),
  { trials: 0, failedControl: 0, repairs: 0, breaks: 0 },
);
const pooled = conditionalReading(pool);
const discordance = (pooled.repairs + pooled.breaks) / pooled.trials;
process.stdout.write(
  `| **pooled (${String(readings.length)} fold(s))** | ${String(pooled.trials)} | ${String(pooled.failedControl)} | ` +
    `${String(pooled.repairs)} | ${String(pooled.passedControl)} | ${String(pooled.breaks)} | ` +
    `${interval(pooled.repairRate)} | ${interval(pooled.breakRate)} | ${pct(pooled.breakEvenRate)} | ` +
    `${pooled.netPp.toFixed(2)}pp |\n\n`,
);

process.stdout.write(
  `conditional: pooled at a ${pct(pooled.failureShare)} failure share, the store repairs ` +
    `${interval(pooled.repairRate)} of failures and breaks ${interval(pooled.breakRate)} of passes; ` +
    `break-even is ${pct(pooled.breakEvenRate)}, so it is ` +
    `${pooled.breakRate === null ? 'unmeasured' : `${pct(Math.abs(pooled.breakRate.rate - pooled.breakEvenRate))} ` +
      `${pooled.breakRate.rate > pooled.breakEvenRate ? 'over' : 'under'} its own bar`}\n`,
);

// What the bars would cost. The discordance is this record's own, so the price is the one this lane would pay
// rather than a textbook figure, and it is the same arithmetic `tasksForDelta` gives a registration.
process.stdout.write('\n| bar | effect | paired trials needed | largest fold in this record |\n');
process.stdout.write('| --- | --- | --- | --- |\n');
const largest = Math.max(...readings.map((row) => row.paired));
for (const bar of [3, 5, 10, 15]) {
  const needed = tasksForDelta(bar / 100, discordance);
  process.stdout.write(
    `| ${String(bar)}pp | ${bar.toFixed(2)}pp | ${Number.isFinite(needed) ? String(needed) : '∞'} | ` +
      `${String(largest)} |\n`,
  );
}
process.stdout.write(
  `\nThe bar this lane reverts on is 5pp; at a ${pct(discordance)} discordance that needs ` +
    `${String(tasksForDelta(0.05, discordance))} paired trials, and the largest fold above is ` +
    `${String(largest)}.\n`,
);

// R156: what the target itself costs. The break-even is a level, and a level is certified by an interval
// rather than by a delta — so it has a price in *passes* that no earlier table computed. The reading is on
// the pooled population, because that is where `b*` was computed.
const target = pooled.breakEvenRate;
if (Number.isFinite(target) && target > 0 && target < 1 && pooled.breakRate !== null) {
  const observed = pooled.breakRate.rate;
  const reading = certificationOf({ target, planned: observed, passes: pooled.passedControl });
  process.stdout.write(`\n${certificationLine(reading)}\n`);
  process.stdout.write(
    '\n| planned break rate | passes to certify it below the break-even | the same, if every pass were a task |\n',
  );
  process.stdout.write('| --- | --- | --- |\n');
  // Four points below the bar, because the interesting question is not "can we certify the rate we have"
  // — we cannot, at any sample — but "how far below it must the content axis get before this instrument
  // can say so", and that distance is the fold's own half width.
  for (const planned of [target * 0.25, target * 0.5, target * 0.75, target]) {
    const passes = passesToCertify(target, planned);
    const tasks = passes === null ? null : Math.ceil(passes / (pooled.passedControl / pooled.trials));
    process.stdout.write(
      `| ${pct(planned)} | ${passes === null ? 'never' : String(passes)} | ` +
        `${tasks === null ? 'never' : String(tasks)} |\n`,
    );
  }
  // The two prices of *moving* the rate. The nested end is exact algebra, the unrelated end is the
  // corpus's own discordance; the fold on the table is quoted against both so the next dispatch is
  // bought knowing which end of the range it can reach.
  const price = changePriceOf({ from: observed, to: target, passShare: 1 - pooled.failureShare, discordance });
  process.stdout.write(
    `\nMoving the break rate from ${pct(observed)} to the ${pct(target)} bar costs between ` +
      `${String(price.nested)} paired tasks (if every remaining break was already one) and ` +
      `${String(price.independent)} (at this corpus's ${pct(price.discordance)} discordance), against the ` +
      `${String(largest)}-pair fold on the table.\n`,
  );
}

/**
 * The same pool split by the metric each draw was scored at, when a census says which one that was.
 *
 * A pair artefact written before R156 carries no `k` — the field did not exist — so the census is the only
 * place the level can live, and every row it marks with an `artefact` is checked against that file before
 * it is printed. A census that disagreed with the artefact would be a second copy of the numbers, which is
 * the defect `poc-l4-pool` would have had if it had ever been written as prose.
 */
if (drawsPath !== undefined) {
  const census = JSON.parse(readFileSync(drawsPath, 'utf8')) as {
    readonly draws?: readonly {
      readonly label: string;
      readonly k: number | null;
      readonly trials: number;
      readonly failedControl: number;
      readonly repairs: number;
      readonly breaks: number;
      readonly artefact?: string;
    }[];
  };
  const draws = census.draws ?? [];
  if (draws.length === 0) {
    process.stderr.write(`conditional: ${drawsPath} carries no draws\n`);
    process.exit(2);
  }
  let disagrees = 0;
  for (const draw of draws) {
    if (draw.artefact === undefined) continue;
    const read = readings.find((row) => row.name === draw.label);
    if (read === undefined) {
      process.stderr.write(`conditional: ${draw.label} is in the census but not on the command line\n`);
      disagrees += 1;
      continue;
    }
    const same =
      read.reading.trials === draw.trials &&
      read.reading.failedControl === draw.failedControl &&
      read.reading.repairs === draw.repairs &&
      read.reading.breaks === draw.breaks;
    if (!same) {
      process.stderr.write(
        `conditional: ${draw.label} census reads ${String(draw.trials)}/${String(draw.failedControl)}/` +
          `${String(draw.repairs)}/${String(draw.breaks)} and the artefact reads ` +
          `${String(read.reading.trials)}/${String(read.reading.failedControl)}/` +
          `${String(read.reading.repairs)}/${String(read.reading.breaks)}\n`,
      );
      disagrees += 1;
    }
  }
  process.stdout.write('\n| metric | draws | trials | failed | repaired | passed | broken | repair rate | break rate | break-even | net |\n');
  process.stdout.write('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n');
  for (const stratum of stratifyByK(draws)) {
    const label = stratum.k === null ? 'unstated' : `pass^${String(stratum.k)}`;
    process.stdout.write(
      `| ${label} | ${stratum.draws.join(', ')} | ${String(stratum.reading.trials)} | ` +
        `${String(stratum.reading.failedControl)} | ${String(stratum.reading.repairs)} | ` +
        `${String(stratum.reading.passedControl)} | ${String(stratum.reading.breaks)} | ` +
        `${interval(stratum.reading.repairRate)} | ${interval(stratum.reading.breakRate)} | ` +
        `${pct(stratum.reading.breakEvenRate)} | ${stratum.reading.netPp.toFixed(2)}pp |\n`,
    );
  }
  process.stdout.write(
    '\nThe strata answer one question: whether the target survives the metric split. A break rate is over ' +
      'the trials the control passed, and a `pass^4` pass is a different event from a `pass^1` pass — so a ' +
      'pooled rate is a mixture, and a break-even that stays put across the strata is a target that does ' +
      'not depend on the mixture.\n',
  );
  if (disagrees > 0) process.exit(1);
}

if (unreconciled > 0) process.exit(1);
