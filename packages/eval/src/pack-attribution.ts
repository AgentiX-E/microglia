/**
 * Which statement, if any, is the harm in?
 *
 * Three rounds of content axes have come back null — coverage (AM.15), imported identifiers (R31),
 * denial (R158) — and each time the record explained the null by saying the axis does not carry the
 * effect. That is an explanation a corpus can be asked to confirm, because a corpus that loses
 * 0.7pp to its pack must lose it *somewhere*: either in particular statements, or in the interaction
 * between them, or not at all. This module tests the first possibility directly, and the answer it
 * gives is quantitative rather than directional.
 *
 * **The unit is a statement, and the contrast is inside a database.** A statement's harm cannot be
 * read from "cases that received it" against "cases that did not", because the store delivers a
 * statement where it looks relevant, so the receiving cases differ from the rest by construction.
 * Nearly all of that difference is the schema — a lesson distilled from `hockey` arrives in other
 * ice-hockey databases and arrives nowhere else — and it is exactly the difference the database
 * removes. So every contrast here compares, within one database, the cases whose pack carried the
 * statement against the cases whose pack did not, and a statement is screened only when at least
 * `MIN_COMPARABLE` databases can make that comparison at all.
 *
 * **The outcome is paired, so difficulty is differenced out.** The reading is the case's own gain —
 * `correct` minus `withoutMemoryCorrect` — not its accuracy. A statement that is delivered to hard
 * questions is not thereby blamed for them.
 *
 * **What the design cannot rule out is stated where it matters.** Receipt is chosen by retrieval, so
 * within a database the exposed cases are still the ones the statement looked relevant to. A
 * statement can therefore look harmful because it is retrieved for the cases memory cannot help,
 * which is a fact about retrieval rather than about the sentence. Nothing in a committed artefact
 * can separate those two readings, and this module does not pretend otherwise: it measures
 * association within a database, and the multi-hypothesis ledger below is what keeps 210 associations
 * from being read as 210 findings.
 */
import { mulberry32 } from '@agentix-e/microglia-core';
import {
  CIRCULATION_STRATA,
  boilerplateShareOf,
  constructsOf,
  spreadOf,
  type CirculationStratum,
  type ConstructName,
  type PackCopyRow,
} from './pack-copy.js';
import { clusterBootstrapRatio, type RatioUnit, type ResampledInterval } from './stats.js';

/**
 * How many databases must be able to compare a statement before it is screened.
 *
 * Two would give an interval over two clusters, which is a number and not an estimate; the floor is
 * five so that a screen's interval rests on a resampling of at least five units. Statements below
 * the floor are counted and reported rather than silently dropped, because their absence is the
 * reason the ledger's denominator is 39 and not 210.
 */
export const MIN_COMPARABLE = 5;

/** Where a case sits on the paired reading: +1 the pack fixed it, −1 it broke it, 0 no change. */
export function gainOf(row: PackCopyRow): number {
  const withMemory = row.correct ? 1 : 0;
  const without = row.withoutMemoryCorrect ? 1 : 0;
  return withMemory - without;
}

/** Clusters with the exposure counts a contrast needs, built once per call. */
type Bucket = { readonly exposed: readonly PackCopyRow[]; readonly rest: readonly PackCopyRow[] };

function bucketsOf(rows: readonly PackCopyRow[], isExposed: (row: PackCopyRow) => boolean): Map<string, Bucket> {
  const exposed = new Map<string, PackCopyRow[]>();
  const rest = new Map<string, PackCopyRow[]>();
  for (const row of rows) {
    const target = isExposed(row) ? exposed : rest;
    const bucket = target.get(row.cluster) ?? [];
    bucket.push(row);
    target.set(row.cluster, bucket);
  }
  const buckets = new Map<string, Bucket>();
  for (const [cluster, group] of exposed) {
    const other = rest.get(cluster);
    if (other === undefined) continue;
    buckets.set(cluster, { exposed: group, rest: other });
  }
  return buckets;
}

/** One side's paired total, which is all a contrast needs from a set of rows. */
function sums(rows: readonly PackCopyRow[]): { readonly cases: number; readonly gain: number } {
  let gain = 0;
  for (const row of rows) gain += gainOf(row);
  return { cases: rows.length, gain };
}

/**
 * A stratum's contrast against the rest of its database, in percentage points of paired gain.
 *
 * The estimator is the average treatment effect on the treated: each database contributes its own
 * exposed-minus-rest difference, and databases are weighted by how many exposed cases they hold. A
 * database that cannot form both sides contributes nothing — it is not evidence of no effect, it is
 * absence of evidence, and the count of contributing databases is published beside the estimate.
 *
 * `null` when no database can form both sides. The point estimate is in pp, so a corpus whose pack
 * is neutral reads 0 and a corpus whose pack costs one case in a hundred reads −1.00.
 */
export function contrastOf(
  rows: readonly PackCopyRow[],
  isExposed: (row: PackCopyRow) => boolean,
  resamples = 4_000,
  seed = 12345,
): { readonly exposed: number; readonly comparable: number; readonly att: number; readonly contrast: ResampledInterval } | null {
  const buckets = bucketsOf(rows, isExposed);
  if (buckets.size === 0) return null;
  const units: RatioUnit[] = [];
  // Total exposure is every case whose pack carried the property, including the clusters that cannot
  // form the contrast: a database that cannot be compared is not a case that did not receive it.
  const exposed = rows.filter(isExposed).length;
  for (const [cluster, bucket] of buckets) {
    const group = sums(bucket.exposed);
    const other = sums(bucket.rest);
    // Weighting by the exposed count and differencing two means is one ratio of sums:
    //   n_e · (ȳ_e − ȳ_u) = Σ_e y − (n_e / n_u) · Σ_u y,  over a denominator of n_e.
    units.push({
      cluster,
      numerator: group.gain - (group.cases / other.cases) * other.gain,
      denominator: group.cases,
    });
  }
  // Every unit carries at least one exposed case, so no draw can have a zero denominator and the
  // ratio cannot refuse; `buckets.size > 0` above is what makes that true.
  const raw = clusterBootstrapRatio(units, resamples, seed) as ResampledInterval;
  // The ratio is in gain units; the record reads every effect in percentage points, so it is scaled
  // once here rather than at each call site. A scalar multiple commutes with the percentile.
  return {
    exposed,
    comparable: buckets.size,
    att: units.reduce((total, unit) => total + unit.denominator, 0),
    contrast: { low: raw.low * 100, high: raw.high * 100, point: raw.point * 100, dropped: raw.dropped },
  };
}

/** One statement, with the contrast that a within-database comparison can give it. */
export type StatementScreen = {
  readonly statement: string;
  /** Cases whose pack carried it. */
  readonly cases: number;
  /** Databases whose cases received it, which is its circulation. */
  readonly databases: number;
  /** Databases that could form both sides; below `MIN_COMPARABLE` this is why it was not screened. */
  readonly comparable: number;
  /** Exposed cases in the comparable databases — the weight the point estimate rests on. */
  readonly att: number;
  readonly contrast: ResampledInterval | null;
  readonly resolved: boolean;
};

/**
 * Every statement in a pack, with its own within-database contrast.
 *
 * Statements are read by iterating cases once and adding each case to the tally of each statement it
 * carried; the per-cluster totals of the whole corpus give the "rest" side by subtraction, so a
 * statement costs its own exposures rather than a pass over the corpus. With 210 statements and
 * 7,000 cases the difference is between a screen and a stall.
 *
 * A statement whose comparable databases fall below `MIN_COMPARABLE` keeps its point estimate — it
 * is arithmetic, and hiding it would make the corpus look cleaner than it is — and gets no interval,
 * because an interval resampled from four clusters is a description of four clusters.
 */
export function statementScreen(
  rows: readonly PackCopyRow[],
  options: { readonly resamples?: number; readonly seed?: number } = {},
): readonly StatementScreen[] {
  const resamples = options.resamples ?? 4_000;
  const seed = options.seed ?? 12345;
  const total = new Map<string, { cases: number; gain: number }>();
  const tally = new Map<string, Map<string, { cases: number; gain: number }>>();
  const databases = new Map<string, Set<string>>();
  for (const row of rows) {
    const bucket = total.get(row.cluster) ?? { cases: 0, gain: 0 };
    bucket.cases += 1;
    bucket.gain += gainOf(row);
    total.set(row.cluster, bucket);
    for (const statement of new Set(row.statements)) {
      const perCluster = tally.get(statement) ?? new Map<string, { cases: number; gain: number }>();
      const entry = perCluster.get(row.cluster) ?? { cases: 0, gain: 0 };
      entry.cases += 1;
      entry.gain += gainOf(row);
      perCluster.set(row.cluster, entry);
      tally.set(statement, perCluster);
      const spread = databases.get(statement) ?? new Set<string>();
      spread.add(row.cluster);
      databases.set(statement, spread);
    }
  }

  const screens: StatementScreen[] = [];
  for (const [statement, perCluster] of tally) {
    const units: RatioUnit[] = [];
    // Exposure counts every case that carried the statement, including the databases that cannot be
    // compared. `att` counts only the weight the estimate rests on, and the two differ whenever a
    // statement reaches a database in which every case received it.
    let exposed = 0;
    for (const entry of perCluster.values()) exposed += entry.cases;
    let att = 0;
    for (const [cluster, entry] of perCluster) {
      // `total` holds every cluster `tally` can name, because both are built in the same pass.
      const whole = total.get(cluster) as { cases: number; gain: number };
      const restCases = whole.cases - entry.cases;
      if (restCases <= 0) continue;
      att += entry.cases;
      units.push({
        cluster,
        numerator: entry.gain - (entry.cases / restCases) * (whole.gain - entry.gain),
        denominator: entry.cases,
      });
    }
    const raw = units.length >= MIN_COMPARABLE ? clusterBootstrapRatio(units, resamples, seed) : null;
    const interval =
      raw === null ? null : { low: raw.low * 100, high: raw.high * 100, point: raw.point * 100, dropped: raw.dropped };
    screens.push({
      statement,
      cases: exposed,
      databases: (databases.get(statement) as Set<string>).size,
      comparable: units.length,
      att,
      contrast: interval,
      resolved: interval !== null && (interval.low > 0 || interval.high < 0),
    });
  }
  const order = (entry: StatementScreen): number => {
    // A statement with no interval sorts last whatever its exposure: it has no estimate to rank, and
    // putting it first because its point is undefined would bury the screened rows.
    if (entry.contrast === null) return Number.POSITIVE_INFINITY;
    return entry.contrast.point;
  };
  screens.sort((left, right) => {
    const a = order(left);
    const b = order(right);
    if (a !== b) return a - b;
    return right.cases - left.cases || (left.statement < right.statement ? -1 : 1);
  });
  return screens;
}

/**
 * The ledger that keeps 210 associations from being read as 210 findings.
 *
 * `resolved` counts intervals that exclude zero. Under a global null five per cent of them would, so
 * the count is only interesting against `expected`. `massAtRisk` is the sum, over the statements
 * whose interval excludes zero *below* zero, of `|point| × cases / corpus`: the share of the corpus's
 * paired gain that removing those statements could recover if each were delivered to exactly the
 * cases it now reaches and nothing else changed. It is a bound on the mass at risk rather than a
 * prediction, because a case can carry several of them at once.
 */
export type ScreenLedger = {
  readonly statements: number;
  readonly screened: number;
  readonly resolved: number;
  readonly expected: number;
  readonly negative: number;
  readonly positive: number;
  readonly massAtRiskPp: number;
};

export function ledgerOf(screens: readonly StatementScreen[], cases: number): ScreenLedger {
  const screened = screens.filter((entry) => entry.contrast !== null);
  const negative = screened.filter((entry) => entry.resolved && (entry.contrast as ResampledInterval).high < 0);
  let mass = 0;
  for (const entry of negative) {
    const point = (entry.contrast as ResampledInterval).point;
    mass += (Math.abs(point) * entry.cases) / cases;
  }
  return {
    statements: screens.length,
    screened: screened.length,
    resolved: screened.filter((entry) => entry.resolved).length,
    expected: (screened.length * 5) / 100,
    negative: negative.length,
    positive: screened.filter((entry) => entry.resolved).length - negative.length,
    massAtRiskPp: mass,
  };
}

/** A fitted coefficient: how much paired gain one more statement of a kind is worth. */
export type DoseFit = {
  readonly predictors: readonly string[];
  readonly cases: number;
  readonly clusters: number;
  /** pp per delivered statement, in the order the predictors were given. */
  readonly coefficients: readonly number[];
  readonly intervals: readonly (ResampledInterval | null)[];
};

/**
 * The exposure-response curve: paired gain against how much of each kind of statement the pack held.
 *
 * A stratum test asks whether the cases carrying a property did worse. This asks whether *more* of
 * it was worse still, which is a different question and a more demanding one: a property that marks
 * hard cases gives a stratum difference and a flat slope, while a property that causes harm gives
 * both. The database enters as a fixed effect — every variable is demeaned inside its cluster — so
 * the slope is identified from variation between cases that share a schema.
 *
 * The normal equations are accumulated per cluster rather than over the corpus. Demeaning a cluster
 * that a resample draws twice is the same as demeaning it once, and both cross-products scale by the
 * multiplicity, so a draw's coefficient is a two-by-two solve over cluster totals rather than a pass
 * over 7,000 rows. The equality with the naive recomputation is asserted in the tests.
 *
 * `null` when the within-cluster cross-product is singular — a predictor that is constant inside
 * every cluster has no slope to estimate, and a zero means the data refused rather than that the
 * effect is zero. `resamples: 0` asks for the point estimate alone, and the intervals come back
 * `null` rather than as a zero-width claim.
 */
export function doseOf(
  rows: readonly PackCopyRow[],
  predictors: readonly { readonly name: string; readonly of: (row: PackCopyRow) => number }[],
  resamples = 2_000,
  seed = 12345,
): DoseFit | null {
  if (rows.length === 0 || predictors.length === 0) return null;
  const width = predictors.length;
  const byCluster = new Map<string, PackCopyRow[]>();
  for (const row of rows) {
    const bucket = byCluster.get(row.cluster) ?? [];
    bucket.push(row);
    byCluster.set(row.cluster, bucket);
  }
  const groups = [...byCluster.values()];
  // Per-cluster cross-products of the demeaned design: A_d = X̃'X̃ and b_d = X̃'ỹ.
  const matrices: number[][][] = [];
  const vectors: number[][] = [];
  for (const group of groups) {
    const design = group.map((row) => predictors.map((predictor) => predictor.of(row)));
    const outcome = group.map((row) => gainOf(row));
    const means = new Array<number>(width).fill(0);
    for (const point of design) for (let column = 0; column < width; column += 1) means[column] = (means[column] as number) + (point[column] as number);
    for (let column = 0; column < width; column += 1) means[column] = (means[column] as number) / group.length;
    const outcomeMean = outcome.reduce((total, value) => total + value, 0) / group.length;
    const matrix = Array.from({ length: width }, () => new Array<number>(width).fill(0));
    const vector = new Array<number>(width).fill(0);
    for (let at = 0; at < group.length; at += 1) {
      const point = design[at] as number[];
      const centred = point.map((value, column) => value - (means[column] as number));
      const residual = (outcome[at] as number) - outcomeMean;
      for (let row = 0; row < width; row += 1) {
        vector[row] = (vector[row] as number) + (centred[row] as number) * residual;
        for (let column = 0; column < width; column += 1) {
          matrix[row]![column] = (matrix[row]?.[column] as number) + (centred[row] as number) * (centred[column] as number);
        }
      }
    }
    matrices.push(matrix);
    vectors.push(vector);
  }
  const solve = (matrix: number[][], vector: number[]): number[] | null => {
    const size = matrix.length;
    const work = matrix.map((line, at) => [...line, vector[at] as number]);
    for (let pivot = 0; pivot < size; pivot += 1) {
      let best = pivot;
      // Partial pivoting: the largest remaining entry in this column leads, so a small lead does not
      // amplify rounding error through the elimination below.
      for (let row = pivot + 1; row < size; row += 1) {
        const candidate = Math.abs((work[row] as number[])[pivot] as number);
        if (candidate > Math.abs((work[best] as number[])[pivot] as number)) best = row;
      }
      const lead = (work[best] as number[])[pivot] as number;
      if (!Number.isFinite(lead) || Math.abs(lead) < 1e-12) return null;
      const swap = work[pivot] as number[];
      work[pivot] = work[best] as number[];
      work[best] = swap;
      for (let row = 0; row < size; row += 1) {
        if (row === pivot) continue;
        const line = work[row] as number[];
        const factor = (line[pivot] as number) / lead;
        for (let column = pivot; column <= size; column += 1) {
          line[column] = (line[column] as number) - factor * ((work[pivot] as number[])[column] as number);
        }
      }
    }
    return work.map((line, at) => (line[size] as number) / (line[at] as number));
  };
  const combine = (weights: (at: number) => number): number[] | null => {
    const matrix = Array.from({ length: width }, () => new Array<number>(width).fill(0));
    const vector = new Array<number>(width).fill(0);
    for (let group = 0; group < groups.length; group += 1) {
      const weight = weights(group);
      if (weight === 0) continue;
      for (let row = 0; row < width; row += 1) {
        vector[row] = (vector[row] as number) + weight * (vectors[group]?.[row] as number);
        for (let column = 0; column < width; column += 1) {
          matrix[row]![column] = (matrix[row]?.[column] as number) + weight * (matrices[group]?.[row]?.[column] as number);
        }
      }
    }
    return solve(matrix, vector);
  };
  const point = combine(() => 1);
  if (point === null) return null;
  const intervals: (ResampledInterval | null)[] = [];
  if (groups.length < 2) {
    for (let column = 0; column < width; column += 1) {
      const value = (point[column] as number) * 100;
      intervals.push({ low: value, high: value, point: value, dropped: 0 });
    }
  } else {
    const random = mulberry32(seed);
    const multiplicity = new Int32Array(groups.length);
    const samples: number[][] = Array.from({ length: width }, () => []);
    let dropped = 0;
    for (let draw = 0; draw < resamples; draw += 1) {
      multiplicity.fill(0);
      for (let at = 0; at < groups.length; at += 1) {
        const picked = Math.floor(random() * groups.length);
        multiplicity[picked] = (multiplicity[picked] as number) + 1;
      }
      const drawn = combine((at) => multiplicity[at] as number);
      if (drawn === null) {
        dropped += 1;
        continue;
      }
      for (let column = 0; column < width; column += 1) samples[column]?.push(drawn[column] as number);
    }
    for (let column = 0; column < width; column += 1) {
      const values = samples[column] as number[];
      if (values.length === 0) {
        intervals.push(null);
        continue;
      }
      values.sort((left, right) => left - right);
      intervals.push({
        low: (values[Math.floor(0.025 * (values.length - 1))] as number) * 100,
        high: (values[Math.ceil(0.975 * (values.length - 1))] as number) * 100,
        point: (point[column] as number) * 100,
        dropped,
      });
    }
  }
  return {
    predictors: predictors.map((predictor) => predictor.name),
    cases: rows.length,
    clusters: groups.length,
    coefficients: point.map((value) => value * 100),
    intervals,
  };
}

/**
 * The constructs a statement *names*, whatever it says about them.
 *
 * The denial reader in `pack-copy` asks a narrower question — does the sentence forbid a construct
 * the gold uses — and it is deliberately narrow because a bare mention is not a prohibition. But a
 * store of *rules* is a store of prescriptions, and "aggregate expressions are left unaliased unless
 * the question asks for a name" is a claim about aliasing that a gold query returning a bare
 * `COUNT(*)` does not honour. Reading mentions rather than denials is what lets this module ask
 * whether the pack is naming machinery the answer does not use.
 *
 * The reader is the shared tokeniser's view of the text, so a construct named inside a string literal
 * is still a mention: the sentence says the word, and the executor reads the sentence.
 */
export function mentionsOf(statement: string): ReadonlySet<ConstructName> {
  const found = new Set<ConstructName>();
  const text = statement.toLowerCase();
  if (/\bdistinct\b/.test(text)) found.add('distinct');
  if (/\bcast\b/.test(text)) found.add('cast');
  if (/\balias(?:es|ed)?\b|\bunaliased\b/.test(text)) found.add('select-alias');
  if (/count\s*\(\s*\*/.test(text)) found.add('count-star');
  if (/\border(?:s|ed|ing)?\s+by\b/.test(text)) found.add('order-by');
  if (/\blike\b/.test(text)) found.add('like');
  if (/\bround(?:ed|ing|s)?\b/.test(text)) found.add('round');
  if (/\bsubquer(?:y|ies)\b/.test(text)) found.add('subquery');
  if (/\blimit\b/.test(text)) found.add('limit');
  if (/\bjoin(?:s|ed|ing)?\b/.test(text)) found.add('join');
  if (/\bunion\b/.test(text)) found.add('union');
  return found;
}

/**
 * How many of a case's statements name a construct its gold query does not use.
 *
 * The complement is `supported`, and the two never overlap, so a regression can carry both without
 * the collinearity that "unsupported" and "statements delivered" would have. A statement naming no
 * construct at all counts as supported: it makes no claim this reading can refute, and scoring it as
 * unsupported would put every procedural sentence in the harmful column by default.
 */
export function unsupportedOf(row: PackCopyRow): number {
  const used = constructsOf(row.goldSql);
  let unsupported = 0;
  for (const statement of new Set(row.statements)) {
    const mentioned = mentionsOf(statement);
    if (mentioned.size === 0) continue;
    for (const construct of mentioned) {
      if (!used.has(construct)) {
        unsupported += 1;
        break;
      }
    }
  }
  return unsupported;
}

/**
 * Which constructs a case's pack names and its gold does not use, as a set.
 *
 * The census publishes the breakdown because "unsupported" can be one construct wearing a coat: if
 * nine cases in ten are flagged by `select-alias` alone, the reading is a finding about aliasing and
 * not about prescription in general, and a table that only counted the flag would hide that.
 */
export function unusedConstructsOf(row: PackCopyRow): ReadonlySet<ConstructName> {
  const used = constructsOf(row.goldSql);
  const unused = new Set<ConstructName>();
  for (const statement of new Set(row.statements)) {
    for (const construct of mentionsOf(statement)) {
      if (!used.has(construct)) unused.add(construct);
    }
  }
  return unused;
}

/**
 * What a serve-time version of the reading would cost, measured rather than assumed.
 *
 * The reading above needs the case's gold, which does not exist at serve time. The deployable
 * analogue is a **database profile**: for each database, the constructs its questions actually use,
 * built offline and shipped with the store. A statement is then dropped when it names constructs and
 * every one of them is absent from the case's profile.
 *
 * This is deliberately the same rule at a coarser grain, and the gap between the two grains is the
 * point of measuring it: a profile is the union over hundreds of questions, so it is far more
 * permissive than one gold, and the filter can only be weaker than the reading. Publishing the
 * delivered-statement count before and after says how much weaker, in the unit the next arm pays for.
 */
export type FilterPrice = {
  readonly share: number;
  readonly deliveredBefore: number;
  readonly deliveredAfter: number;
  readonly casesEmptied: number;
  readonly profiles: number;
};

export function filterPriceOf(rows: readonly PackCopyRow[], share = 0.05): FilterPrice {
  const byCluster = new Map<string, PackCopyRow[]>();
  for (const row of rows) {
    const bucket = byCluster.get(row.cluster) ?? [];
    bucket.push(row);
    byCluster.set(row.cluster, bucket);
  }
  const profiles = new Map<string, Set<ConstructName>>();
  for (const [cluster, group] of byCluster) {
    const counts = new Map<ConstructName, number>();
    for (const row of group) for (const construct of constructsOf(row.goldSql)) counts.set(construct, (counts.get(construct) ?? 0) + 1);
    const available = new Set<ConstructName>();
    for (const [construct, count] of counts) if (count / group.length >= share) available.add(construct);
    profiles.set(cluster, available);
  }
  let before = 0;
  let after = 0;
  let emptied = 0;
  for (const row of rows) {
    const available = profiles.get(row.cluster) as Set<ConstructName>;
    const statements = [...new Set(row.statements)];
    before += statements.length;
    let kept = 0;
    for (const statement of statements) {
      const named = mentionsOf(statement);
      if (named.size === 0) {
        kept += 1;
        continue;
      }
      let usable = false;
      for (const construct of named) if (available.has(construct)) usable = true;
      if (usable) kept += 1;
    }
    after += kept;
    if (statements.length > 0 && kept === 0) emptied += 1;
  }
  return { share, deliveredBefore: before, deliveredAfter: after, casesEmptied: emptied, profiles: profiles.size };
}

/** The circulation strata, re-tested inside a database rather than across the corpus. */
export function circulationContrasts(
  rows: readonly PackCopyRow[],
  resamples = 4_000,
  seed = 12345,
): readonly { readonly stratum: CirculationStratum; readonly result: ReturnType<typeof contrastOf> }[] {
  const spread = spreadOf(rows);
  // Positional rather than keyed: `spreadOf` sees the same rows, so a share exists for every one of
  // them, and a map lookup with a missing-key branch would be a branch no input can reach.
  const positions = new Map<PackCopyRow, number>();
  const shares: (number | null)[] = [];
  for (const row of rows) {
    positions.set(row, shares.length);
    shares.push(boilerplateShareOf(row.statements, spread));
  }
  return CIRCULATION_STRATA.map((stratum) => ({
    stratum,
    result: contrastOf(
      rows,
      (row) => {
        const share = shares[positions.get(row) as number];
        if (share === null || share === 0) return stratum === 'none';
        if (share === 1) return stratum === 'all';
        return stratum === 'mixed';
      },
      resamples,
      seed,
    ),
  }));
}

/** One arm of the attribution census: where its rows come from. */
export type AttributionSource = {
  readonly name: string;
  readonly path: string;
};

/**
 * The arms this round reads. Same four as the copy census, for one reason: a finding that appears in
 * one arm and not the others is a finding about an arm, and these are the four the record has spent
 * its dispatches on.
 */
export const ATTRIBUTION_SOURCES: readonly AttributionSource[] = [
  { name: 'bird-train', path: 'eval/results/poc-sota-bird-train.json' },
  { name: 'bird-dev', path: 'eval/results/poc-sota-bird-dev-R26-channels.json' },
  { name: 'bird-dev-lexicon', path: 'eval/results/poc-sota-bird-dev-R37-lexicon-grain.json' },
  { name: 'bird-mini', path: 'eval/results/poc-sota-bird-R63-recall-order.json' },
];

/** One arm's attribution: the composition, the screen, the ledger, the strata and the dose. */
export type AttributionEntry = {
  readonly source: string;
  readonly path: string;
  readonly n: number;
  readonly clusters: number;
  readonly statements: number;
  readonly unscreened: number;
  readonly ledger: ScreenLedger;
  /** Statements whose contrast could be estimated, worst first. The full list, not a digest. */
  readonly screen: readonly StatementScreen[];
  /** The converse reading: cases whose pack names a construct their gold does not use. */
  readonly unsupported: {
    readonly any: ReturnType<typeof contrastOf>;
    readonly all: ReturnType<typeof contrastOf>;
    readonly none: ReturnType<typeof contrastOf>;
    readonly casesAny: number;
    readonly casesAll: number;
    /** Unsupported statements per case over the whole arm, so the binary and the dose can be compared. */
    readonly meanPerCase: number;
    /** Cases flagged by each construct, most first. */
    readonly byConstruct: readonly { readonly construct: string; readonly cases: number }[];
  };
  /** R158's circulation strata, re-tested inside a database. */
  readonly circulation: readonly { readonly stratum: CirculationStratum; readonly result: ReturnType<typeof contrastOf> }[];
  readonly dose: DoseFit | null;
  /** What a serve-time version of the reading would drop, in the unit the next arm pays for. */
  readonly filter: FilterPrice;
};

export type AttributionCensus = {
  readonly id: string;
  readonly registered: string;
  readonly resamples: number;
  readonly seed: number;
  readonly rule: string;
  readonly sources: readonly AttributionEntry[];
};

/**
 * The rule, in the artefact rather than in a report.
 *
 * Every number in this census follows from these four sentences, and a reader who disagrees with one
 * of them can recompute the file and see which numbers move.
 */
export const ATTRIBUTION_RULE =
  'gain: correct minus without-memory correct, per case; contrast: within a database, exposed cases against the rest, weighted by exposed cases, interval by resampling databases; screen: a statement is screened when at least five databases can form both sides; unsupported: a delivered statement names a construct the case gold does not use';

/** Cases flagged by each construct, so the flag cannot be one construct wearing a coat. */
function constructTally(rows: readonly PackCopyRow[]): readonly { readonly construct: string; readonly cases: number }[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    for (const construct of unusedConstructsOf(row)) counts.set(construct, (counts.get(construct) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([construct, cases]) => ({ construct, cases }))
    .sort((left, right) => right.cases - left.cases || (left.construct < right.construct ? -1 : 1));
}

/** Read one arm's rows into the four readings. */
function entryOf(source: AttributionSource, rows: readonly PackCopyRow[], resamples: number, seed: number): AttributionEntry {
  const screen = statementScreen(rows, { resamples, seed });
  const screened = screen.filter((entry) => entry.contrast !== null);
  const unsupported = rows.map((row) => unsupportedOf(row));
  const total = rows.map((row) => new Set(row.statements).size);
  const at = new Map<PackCopyRow, number>();
  rows.forEach((row, index) => at.set(row, index));
  const index = (row: PackCopyRow): number => at.get(row) as number;
  const isAny = (row: PackCopyRow): boolean => (unsupported[index(row)] as number) > 0;
  const isAll = (row: PackCopyRow): boolean =>
    (unsupported[index(row)] as number) > 0 && (unsupported[index(row)] as number) === (total[index(row)] as number);
  const isNone = (row: PackCopyRow): boolean => (unsupported[index(row)] as number) === 0;
  const any = contrastOf(rows, isAny, resamples, seed);
  return {
    source: source.name,
    path: source.path,
    n: rows.length,
    clusters: new Set(rows.map((row) => row.cluster)).size,
    statements: screen.length,
    unscreened: screen.length - screened.length,
    ledger: ledgerOf(screen, rows.length),
    screen: screened,
    unsupported: {
      any,
      all: contrastOf(rows, isAll, resamples, seed),
      none: contrastOf(rows, isNone, resamples, seed),
      casesAny: rows.filter(isAny).length,
      casesAll: rows.filter(isAll).length,
      meanPerCase: unsupported.reduce((total, count) => total + count, 0) / rows.length,
      byConstruct: constructTally(rows),
    },
    circulation: circulationContrasts(rows, resamples, seed),
    dose: doseOf(
      rows,
      [
        { name: 'statements', of: (row) => total[index(row)] as number },
        { name: 'unsupported', of: (row) => unsupported[index(row)] as number },
        { name: 'gold-constructs', of: (row) => constructsOf(row.goldSql).size },
      ],
      resamples,
      seed,
    ),
    filter: filterPriceOf(rows),
  };
}

/**
 * Every source, read through `load`.
 *
 * `load` is injected for the reason the other censuses inject it: a module that opens files can only
 * be checked against whatever happens to be committed, and the refusals are most of what needs
 * checking.
 */
export function attributionCensus(
  sources: readonly AttributionSource[],
  load: (path: string) => readonly PackCopyRow[],
  resamples = 2_000,
  seed = 12345,
): AttributionCensus {
  return {
    id: 'poc-pack-attribution',
    registered: 'ROADMAP.md §R159',
    resamples,
    seed,
    rule: ATTRIBUTION_RULE,
    sources: sources.map((source) => entryOf(source, load(source.path), resamples, seed)),
  };
}

/** A cell padded to its column, left for text and right for numbers. */
function pad(value: string, width: number, left = false): string {
  return left ? value.padEnd(width) : value.padStart(width);
}

/**
 * One table, built from a single width list.
 *
 * Header and rows go through the same function, which is the only way two of them cannot disagree
 * about a column: the previous round shipped a header whose `odds` pair was one space narrower than
 * its rows, and the fix was to stop writing headers by hand.
 */
function tableOf(widths: readonly number[], header: readonly string[], rows: readonly (readonly string[])[]): readonly string[] {
  const draw = (cells: readonly string[]): string =>
    cells.map((value, at) => pad(value, widths[at] as number, at === 0)).join(' ');
  return [draw(header), ...rows.map((cells) => draw(cells))];
}

function ppText(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(2)}pp`;
}

function shortText(statement: string, width: number): string {
  if (statement.length <= width) return statement;
  return `${statement.slice(0, width - 1)}…`;
}

/** The ledger: how many statements were screened, how many resolved, and what that is worth. */
export function ledgerLines(entry: AttributionEntry): readonly string[] {
  const rows = [
    [
      entry.source,
      String(entry.n),
      String(entry.clusters),
      String(entry.statements),
      String(entry.ledger.screened),
      String(entry.ledger.resolved),
      entry.ledger.expected.toFixed(1),
      `${String(entry.ledger.negative)}/${String(entry.ledger.positive)}`,
      ppText(-entry.ledger.massAtRiskPp),
    ],
  ];
  return tableOf([22, 6, 5, 6, 7, 7, 7, 7, 10], ['source', 'n', 'clus', 'stmts', 'keep', 'resolv', 'expect', 'neg/pos', 'mass'], rows);
}

/** The screen itself: every statement a within-database contrast could estimate. */
export function screenLines(entry: AttributionEntry, width = 54): readonly string[] {
  const rows = entry.screen.map((screen) => [
    entry.source,
    shortText(screen.statement, width),
    String(screen.cases),
    String(screen.databases),
    String(screen.comparable),
    ppText(screen.contrast?.point),
    ppText(screen.contrast?.low),
    ppText(screen.contrast?.high),
    screen.resolved ? 'yes' : '',
  ]);
  return tableOf([22, width, 6, 4, 4, 10, 10, 10, 4], ['source', 'statement', 'cases', 'dbs', 'cmp', 'delta', 'low', 'high', 'sig'], rows);
}

/** The strata: the converse reading and R158's circulation, both re-estimated inside a database. */
export function stratumLines(entry: AttributionEntry): readonly string[] {
  const rows: string[][] = [];
  const push = (name: string, result: ReturnType<typeof contrastOf>): void => {
    rows.push([
      entry.source,
      name,
      result === null ? '—' : String(result.exposed),
      result === null ? '—' : String(result.comparable),
      ppText(result?.contrast.point),
      ppText(result?.contrast.low),
      ppText(result?.contrast.high),
    ]);
  };
  push('unsupported-any', entry.unsupported.any);
  push('unsupported-all', entry.unsupported.all);
  push('unsupported-none', entry.unsupported.none);
  for (const { stratum, result } of entry.circulation) push(`circ-${stratum}`, result);
  return tableOf([22, 17, 6, 5, 10, 10, 10], ['source', 'stratum', 'n', 'clus', 'delta', 'low', 'high'], rows);
}

/** The price of serving the reading: statements delivered before and after the profile filter. */
export function filterLines(entry: AttributionEntry): readonly string[] {
  const price = entry.filter;
  const kept = price.deliveredBefore === 0 ? 0 : (price.deliveredAfter / price.deliveredBefore) * 100;
  return tableOf([22, 8, 8, 8, 8, 9, 10], ['source', 'before', 'after', 'kept', 'empty', 'profiles', 'min share'], [
    [
      entry.source,
      String(price.deliveredBefore),
      String(price.deliveredAfter),
      `${kept.toFixed(1)}%`,
      String(price.casesEmptied),
      String(price.profiles),
      price.share.toFixed(2),
    ],
  ]);
}

/** The dose: paired gain per additional statement, split by whether the gold honours it. */
export function doseLines(entry: AttributionEntry): readonly string[] {
  const fit = entry.dose;
  if (fit === null) return [];
  const rows = fit.coefficients.map((value, at) => {
    const interval = fit.intervals[at] ?? null;
    const resolved = interval !== null && (interval.low > 0 || interval.high < 0);
    return [
      entry.source,
      fit.predictors[at] ?? `x${String(at)}`,
      ppText(value),
      ppText(interval?.low),
      ppText(interval?.high),
      resolved ? 'yes' : '',
    ];
  });
  return tableOf([22, 16, 10, 10, 10, 4], ['source', 'predictor', 'per stmt', 'low', 'high', 'sig'], rows);
}
