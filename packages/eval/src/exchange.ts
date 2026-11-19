/**
 * Does the memory pay, and with what interval?
 *
 * ## The statistic that could not answer its own question
 *
 * `admission.ts` publishes `clearance = helpPerHarm / hurdle`, where `helpPerHarm = repaired / broken`
 * and `hurdle = breakable / repairable`, and its own doc comment says "a clearance below one is a
 * memory that loses". That sentence is false, and the committed artefacts say so.
 *
 * Net accuracy change is `repaired − broken`, so the memory pays exactly when `repaired ≥ broken`:
 * the bar on `helpPerHarm` is **1**, and `requiredRepairRatePp = breakRatePp × hurdle` is the same
 * condition written in rate units —
 *
 *     repairRate ≥ breakRate · (breakable / repairable)
 *     ⇔ repaired / repairable ≥ (broken / breakable)(breakable / repairable)
 *     ⇔ repaired ≥ broken.
 *
 * So the hurdle is already inside the rate form of the bar. Dividing the *count* ratio by it as well
 * multiplies the distance from paying by `hurdle` a second time. On the BIRD dev corpus that factor is
 * 1.33, and the record has three arms with a positive net that its own statistic calls losses:
 *
 * | arm | repaired | broken | net | `helpPerHarm` | `hurdle` | `clearance` | pays? |
 * | --- | --- | --- | --- | --- | --- | --- | --- |
 * | BIRD dev, rule grain | 67 | 62 | **+5** | 1.081 | 1.349 | 0.801 | **yes** |
 * | BIRD dev, lexicon grain | 78 | 67 | **+11** | 1.164 | 1.328 | 0.877 | **yes** |
 * | BIRD mini-dev, recall order | 19 | 17 | **+2** | 1.118 | 1.059 | 1.056 | **yes** |
 * | BIRD train | 187 | 237 | −50 | 0.789 | 1.393 | 0.566 | no |
 *
 * `clearance` also orders corpora by their own base rate rather than by the memory: on τ² retail it
 * reads 0.108 against BIRD train's 0.566, while the decision statistic reads 0.667 against 0.789 —
 * the opposite ordering. A number that moves when the corpus moves cannot compare two corpora, and a
 * number whose sign disagrees with `repaired − broken` cannot decide anything.
 *
 * ## What this module reports instead
 *
 * The exchange rate with a **clustered** interval. Every one of these corpora clusters — BIRD by
 * database, τ² by task across the four draws — and an interval that resamples questions as if they
 * were independent is narrower than the data by roughly the square root of the cluster size. That is
 * not a small correction here: BIRD dev has 1,534 questions over 11 databases, so the effective
 * sample is the database count, and the interval has to be read that way.
 *
 * The verdict is computed from the delta's interval, because that is the quantity the rest of the
 * record gates on (`l4-effect-resolved`, `V5-resolution`); the exchange rate and its interval are
 * published beside it, since the break-even target `b*` is written in that language.
 */
import { clusterBootstrapStatistic, type ResampledInterval } from './stats.js';

/** One case, with the cluster it belongs to. The cluster is what makes the interval honest. */
export type ExchangeRow = {
  /** The unit of correlation: a database in BIRD, a task in τ². */
  readonly cluster: string;
  readonly correct: boolean;
  readonly withoutMemoryCorrect: boolean;
};

/** How a census reads the interval it was given. */
export type ExchangeVerdict = 'pays' | 'loses' | 'unresolved';

export type ExchangeCensus = {
  readonly source: string;
  readonly n: number;
  readonly clusters: number;
  /** Questions the bare arm got wrong. Only these can be repaired. */
  readonly repairable: number;
  /** Questions it got right. Only these can be broken. */
  readonly breakable: number;
  readonly repaired: number;
  readonly broken: number;
  readonly netPp: number;
  /** `repaired / broken`, the decision statistic: it pays at **1**. `null` when nothing broke. */
  readonly netOdds: number | null;
  readonly netOddsInterval: ResampledInterval | null;
  /** `breakable / repairable`, the corpus's own odds. A property of the corpus, not of the memory. */
  readonly parity: number | null;
  /** The delta in percentage points, and its clustered interval. */
  readonly deltaPp: number;
  readonly deltaInterval: ResampledInterval;
  readonly verdict: ExchangeVerdict;
  /** One sentence a reader can quote, built from the numbers above and from nothing else. */
  readonly statement: string;
};

const RESAMPLES = 2_000;

function assertRows(rows: readonly ExchangeRow[]): void {
  if (rows.length === 0) throw new Error('an exchange census needs at least one case');
  for (const row of rows) {
    if (typeof row.cluster !== 'string' || row.cluster === '') {
      throw new Error('every case needs a cluster label, and an empty one is not a label');
    }
    if (typeof row.correct !== 'boolean' || typeof row.withoutMemoryCorrect !== 'boolean') {
      throw new Error(`case ${row.cluster} carries an outcome that is not a boolean`);
    }
  }
}

function tally(rows: readonly ExchangeRow[]): {
  repairable: number;
  breakable: number;
  repaired: number;
  broken: number;
} {
  let repairable = 0;
  let breakable = 0;
  let repaired = 0;
  let broken = 0;
  for (const row of rows) {
    if (row.withoutMemoryCorrect) breakable += 1;
    else repairable += 1;
    if (row.correct && !row.withoutMemoryCorrect) repaired += 1;
    if (!row.correct && row.withoutMemoryCorrect) broken += 1;
  }
  return { repairable, breakable, repaired, broken };
}

/** The delta in percentage points, which is `repaired − broken` over `n` scaled to 100. */
export function deltaPpOf(rows: readonly ExchangeRow[]): number {
  let net = 0;
  for (const row of rows) {
    if (row.correct !== row.withoutMemoryCorrect) net += row.correct ? 1 : -1;
  }
  return (net / rows.length) * 100;
}

/**
 * The census of one arm.
 *
 * `resamples` is a parameter rather than a constant so that a registration can fix it, in the spirit of
 * `comparePaired`: two reports that resampled a different number of times are not comparable, and the
 * default here is the census's own protocol (2,000), not the primitive's 10,000.
 */
export function exchangeCensusOf(
  source: string,
  rows: readonly ExchangeRow[],
  resamples = RESAMPLES,
): ExchangeCensus {
  assertRows(rows);
  const { repairable, breakable, repaired, broken } = tally(rows);
  const n = rows.length;
  const netPp = ((repaired - broken) / n) * 100;

  const netOddsInterval = clusterBootstrapStatistic(
    rows,
    (row) => row.cluster,
    (drawn) => {
      const counts = tally(drawn);
      return counts.broken === 0 ? null : counts.repaired / counts.broken;
    },
    resamples,
  );
  // `clusterBootstrapStatistic` returns null only when it has nothing to interval: an empty sample, or a
  // statistic that is undefined on every draw. `assertRows` has already refused the first, and the delta
  // is finite on every non-empty sample, so the second cannot occur. The invariant is asserted in the
  // type rather than tested as a branch no input reaches — the rule this repository applies to the four
  // unreachable branches it still counts (TECH-DESIGN §13.6).
  const deltaInterval = clusterBootstrapStatistic(
    rows,
    (row) => row.cluster,
    (drawn) => deltaPpOf(drawn),
    resamples,
  ) as ResampledInterval;

  const verdict: ExchangeVerdict =
    deltaInterval.high < 0 ? 'loses' : deltaInterval.low > 0 ? 'pays' : 'unresolved';

  return {
    source,
    n,
    clusters: new Set(rows.map((row) => row.cluster)).size,
    repairable,
    breakable,
    repaired,
    broken,
    netPp,
    netOdds: broken === 0 ? null : repaired / broken,
    netOddsInterval,
    parity: repairable === 0 ? null : breakable / repairable,
    deltaPp: netPp,
    deltaInterval,
    verdict,
    statement: statementOf({ source, n, repaired, broken, netPp, netOddsInterval, deltaInterval, verdict }),
  };
}

function pp(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}pp`;
}

function statementOf(input: {
  readonly source: string;
  readonly n: number;
  readonly repaired: number;
  readonly broken: number;
  readonly netPp: number;
  readonly netOddsInterval: ResampledInterval | null;
  readonly deltaInterval: ResampledInterval;
  readonly verdict: ExchangeVerdict;
}): string {
  const odds =
    input.netOddsInterval === null
      ? 'with no exchange rate to form, because nothing broke'
      : `on an exchange rate of ${input.netOddsInterval.point.toFixed(3)} over [${input.netOddsInterval.low.toFixed(3)}, ${input.netOddsInterval.high.toFixed(3)}]`;
  const delta = `a delta of ${pp(input.netPp)} over [${pp(input.deltaInterval.low)}, ${pp(input.deltaInterval.high)}]`;
  const head =
    input.verdict === 'pays'
      ? 'the memory pays'
      : input.verdict === 'loses'
        ? 'the memory loses'
        : 'unresolved';
  const reading =
    input.verdict === 'unresolved'
      ? `${delta}, whose interval contains zero`
      : `${delta}, whose interval excludes zero`;
  return `${input.source}: ${head} — ${input.repaired} repaired against ${input.broken} broken is ${reading}, ${odds}.`;
}

/** The column widths, in one place, so the header and the rows cannot disagree. */
const WIDTHS = [30, 5, 4, 5, 5, 8, 8, 8, 22] as const;

/** A number in a fixed column. A statistic that does not exist is the caller's to draw. */
function col(value: number, digits: number, width: number): string {
  return value.toFixed(digits).padStart(width);
}

/** The three-cell exchange-rate group, so its header and its numbers share one layout. */
function oddsCell(point: string, low: string, high: string): string {
  return `${point.padStart(7)} ${low.padStart(5)} ${high.padStart(5)}`.padStart(22);
}

function rowOf(cells: readonly string[]): string {
  return cells
    .map((cell, at) => {
      const width = WIDTHS[at];
      if (width === undefined) return cell;
      // The first column is a name and reads left-aligned; every other column is a number.
      return at === 0 ? cell.padEnd(width) : cell.padStart(width);
    })
    .join(' ');
}

/** The census as one table row, so five arms can be read at once. */
export function censusLine(census: ExchangeCensus): string {
  const interval = census.netOddsInterval;
  return rowOf([
    census.source,
    String(census.n),
    String(census.clusters),
    String(census.repaired),
    String(census.broken),
    col(census.netPp, 2, 8),
    col(census.deltaInterval.low, 2, 8),
    col(census.deltaInterval.high, 2, 8),
    interval === null
      ? oddsCell('—', '', '')
      : oddsCell(interval.point.toFixed(3), interval.low.toFixed(3), interval.high.toFixed(3)),
    census.verdict,
  ]);
}

/** The header `censusLine` is aligned to, built from the same widths. */
export const CENSUS_HEADER = rowOf([
  'source',
  'n',
  'clus',
  'rep',
  'brk',
  'netPp',
  'low',
  'high',
  oddsCell('netOdds', 'low', 'high'),
  'verdict',
]);

/**
 * A BIRD arm: `per_case` rows, each with the database it came from.
 *
 * The cluster is `dbId` and not the question, because BIRD's databases are the correlated unit — every
 * question in one database shares its schema, its values and its rules, and a fold that resamples
 * questions treats 1,534 correlated draws as 1,534 independent ones.
 */
export function perCaseRows(artefact: unknown, source: string): ExchangeRow[] {
  const rows = arrayField(artefact, 'per_case', source);
  return rows.map((row, at) => {
    const entry = objectAt(row, `${source}.per_case[${String(at)}]`);
    const cluster = entry['dbId'];
    const correct = entry['correct'];
    const without = entry['withoutMemoryCorrect'];
    if (typeof cluster !== 'string' || cluster === '') {
      throw new Error(`${source}.per_case[${String(at)}] carries no dbId, so it has no cluster`);
    }
    if (typeof correct !== 'boolean' || typeof without !== 'boolean') {
      throw new Error(`${source}.per_case[${String(at)}] does not carry both arms' outcomes`);
    }
    return { cluster, correct, withoutMemoryCorrect: without };
  });
}

/**
 * A τ² pair: `transfer.ledger` rows, each naming the task it came from.
 *
 * The cluster is the task, not the draw: the four draws behind the pooled fold re-run the same forty
 * tasks, so a per-question resampling would be counting the same question four times over.
 */
export function pairRows(artefact: unknown, source: string): ExchangeRow[] {
  const root = objectAt(artefact, source);
  const transfer = objectAt(root['transfer'], `${source}.transfer`);
  const rows = arrayField(transfer, 'ledger', `${source}.transfer`);
  return rows.map((row, at) => {
    const entry = objectAt(row, `${source}.transfer.ledger[${String(at)}]`);
    const cluster = entry['task'];
    const correct = entry['withMemoryCorrect'];
    const without = entry['blankCorrect'];
    if (typeof cluster !== 'string' || cluster === '') {
      throw new Error(`${source}.transfer.ledger[${String(at)}] carries no task, so it has no cluster`);
    }
    if (typeof correct !== 'boolean' || typeof without !== 'boolean') {
      throw new Error(`${source}.transfer.ledger[${String(at)}] does not carry both arms' outcomes`);
    }
    return { cluster, correct, withoutMemoryCorrect: without };
  });
}

function objectAt(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${where} is not an object`);
  }
  return value as Record<string, unknown>;
}

function arrayField(value: unknown, key: string, where: string): readonly unknown[] {
  const root = objectAt(value, where);
  const field = root[key];
  if (!Array.isArray(field)) throw new Error(`${where} carries no ${key} array`);
  return field;
}

/** One arm of the census: where its rows come from, and how they are read out of the file. */
export type CensusSource = {
  readonly name: string;
  readonly kind: 'per_case' | 'pair';
  readonly paths: readonly string[];
};

/**
 * The arms this repository can census from artefacts it has already committed.
 *
 * Two corpora and five readings. BIRD train is the only one whose interval resolves, and it is here
 * first because a census that began with the small readings would be sorted by convenience.
 */
export const CENSUS_SOURCES: readonly CensusSource[] = [
  { name: 'bird-train', kind: 'per_case', paths: ['eval/results/poc-sota-bird-train.json'] },
  { name: 'bird-dev-rule', kind: 'per_case', paths: ['eval/results/poc-sota-bird-dev-R26-channels.json'] },
  { name: 'bird-dev-lexicon', kind: 'per_case', paths: ['eval/results/poc-sota-bird-dev-R37-lexicon-grain.json'] },
  { name: 'bird-mini-recall-order', kind: 'per_case', paths: ['eval/results/poc-sota-bird-R63-recall-order.json'] },
  {
    name: 'tau2-retail-pooled',
    kind: 'pair',
    paths: [
      'eval/results/poc-l4-pair-official.json',
      'eval/results/poc-l4-pair-swapped.json',
      'eval/results/poc-l4-pair-r152.json',
      'eval/results/poc-l4-pair-r152c.json',
    ],
  },
];

export type CensusEntry = ExchangeCensus & { readonly paths: readonly string[] };

export type ExchangeCensusSet = {
  readonly id: string;
  readonly registered: string;
  readonly resamples: number;
  readonly seed: number;
  readonly rule: string;
  readonly sources: readonly CensusEntry[];
};

/**
 * The rule, in the artefact rather than in a report.
 *
 * A reader who disagrees with the verdict has to be able to see which predicate produced it, and a
 * census that states only the numbers leaves that to the code under whatever name it has today.
 */
export const CENSUS_RULE =
  'pays when the clustered 95% interval of the net change excludes zero; the decision statistic is repaired against broken, which pays at 1, not the clearance ratio, which divides by the corpus odds a second time';

/**
 * Every source, read through `load`.
 *
 * `load` is injected rather than imported so the census can be built from fixtures in a test: a
 * module that reads the filesystem is a module whose arithmetic can only be checked on the artefacts
 * that happen to be committed.
 */
export function exchangeCensus(
  sources: readonly CensusSource[],
  load: (path: string) => unknown,
  resamples = RESAMPLES,
): ExchangeCensusSet {
  return {
    id: 'poc-exchange-census',
    registered: 'ROADMAP.md §R157',
    resamples,
    seed: 12345,
    rule: CENSUS_RULE,
    sources: sources.map((source) => {
      const rows: ExchangeRow[] = [];
      for (const path of source.paths) {
        const name = path.replace('eval/results/', '').replace('.json', '');
        const artefact = load(path);
        rows.push(...(source.kind === 'per_case' ? perCaseRows(artefact, name) : pairRows(artefact, name)));
      }
      return { ...exchangeCensusOf(source.name, rows, resamples), paths: source.paths };
    }),
  };
}
