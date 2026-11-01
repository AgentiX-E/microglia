/**
 * Whether memory is shown to the wrong population, and whether a gate can fix that.
 *
 * §147 measured the exchange rate — repairs over breaks — as a property of what the pack says, and
 * §148 closed the product on the assumption that a better *item* was the only way back. Both readings
 * shared an error that this module exists to make explicit: a repair can only happen on a question the
 * bare model got wrong, and a break only on one it got right, so the two rates sit on different bases
 * and the rate at which memory breaks even is not parity but the **odds of the bare model being
 * right**. Out of sample that odds is 1.393, and the measured exchange is 0.789. Memory is not 21%
 * short of useful; it is 43% short.
 *
 * The asymmetry is in the population rather than in the item. A question the bare model already
 * answered cannot be repaired and a question it got wrong cannot be broken, so a gate that admits only
 * the second kind has a break rate of zero **by construction** and receives the whole repair rate as
 * net gain. That converts the product question into an admission question with a bar that can be
 * computed before anything is measured:
 *
 *     q · r > (1 − q) · b      ⇔      q > b / (r + b)
 *
 * which on this corpus is 47.64% against a base rate of 41.79%. The gate does not have to be good. It
 * has to be six points better than random, evaluated on the question and the database's own history,
 * before generation rather than after.
 *
 * ## What the shapes of the two estimates are for
 *
 * `admissionGainOf` reports the net gain on the **whole corpus** — one number per question, admitted or
 * not — because a gain quoted on the admitted subset is a different quantity and reads as a hundred
 * times the product. The clustered interval resamples databases for the reason §143 established, so
 * `netPp`, `lowPp` and `highPp` are on the same scale as §146's −0.71pp and the oracle's +2.67pp.
 *
 * The module holds no thresholds and calls no model. Every gate it can score is a predicate over a
 * field the run already recorded, which is why an iteration that decides a product here costs nothing
 * to run on every push.
 */
import { clusterBootstrapCI } from './stats.js';

/** One question: what the two arms did, and the fields a gate is allowed to read. */
export type AdmissionCase = {
  readonly id: string;
  readonly dbId: string;
  readonly question: string;
  readonly correct: boolean;
  readonly withoutMemoryCorrect: boolean;
  /** The pack layer's own coverage of the question, in `[0, 1]`. */
  readonly coverage: number;
  readonly packIds: number;
};

/**
 * The exchange rate and the bar it has to clear.
 *
 * `hurdle` is the quantity §147 did not have: the ratio of questions that could only be broken to
 * questions that could only be repaired, which is what an exchange rate of 1.0 was being compared to
 * by mistake. `clearance` is the two divided, and a clearance below one is a memory that loses.
 */
export type ExchangeReading = {
  readonly n: number;
  /** Questions the bare model got wrong. Only these can be repaired. */
  readonly repairable: number;
  /** Questions it got right. Only these can be broken. */
  readonly breakable: number;
  readonly repaired: number;
  readonly broken: number;
  /** `null` when nothing could be repaired, which is not a rate of zero. */
  readonly repairRatePp: number | null;
  readonly breakRatePp: number | null;
  readonly net: number;
  readonly netPp: number | null;
  readonly helpPerHarm: number | null;
  readonly hurdle: number | null;
  readonly clearance: number | null;
  /** The repair rate that would break even at the measured break rate, and the mirror. */
  readonly requiredRepairRatePp: number | null;
  readonly requiredBreakRatePp: number | null;
};

const perHundred = (part: number, whole: number): number | null => (whole === 0 ? null : (part / whole) * 100);
const ratio = (part: number, whole: number): number | null => (whole === 0 ? null : part / whole);

export function exchangeOf(cases: readonly AdmissionCase[]): ExchangeReading {
  let repaired = 0;
  let broken = 0;
  let repairable = 0;
  let breakable = 0;
  for (const entry of cases) {
    if (entry.withoutMemoryCorrect) breakable += 1;
    else repairable += 1;
    if (entry.correct && !entry.withoutMemoryCorrect) repaired += 1;
    if (!entry.correct && entry.withoutMemoryCorrect) broken += 1;
  }
  const n = cases.length;
  const repairRatePp = perHundred(repaired, repairable);
  const breakRatePp = perHundred(broken, breakable);
  const hurdle = ratio(breakable, repairable);
  const helpPerHarm = ratio(repaired, broken);
  return {
    n,
    repairable,
    breakable,
    repaired,
    broken,
    repairRatePp,
    breakRatePp,
    net: repaired - broken,
    netPp: perHundred(repaired - broken, n),
    helpPerHarm,
    hurdle,
    clearance: helpPerHarm === null || hurdle === null || hurdle === 0 ? null : helpPerHarm / hurdle,
    requiredRepairRatePp: breakRatePp === null || hurdle === null ? null : breakRatePp * hurdle,
    requiredBreakRatePp: repairRatePp === null || hurdle === null || hurdle === 0 ? null : repairRatePp / hurdle,
  };
}

/**
 * The share of an admitted set that must be repairable for the admission to pay for itself.
 *
 * `b / (r + b)`, computed from the corpus rather than written down, because a bar that does not move
 * when the rates move is a bar that goes stale silently — which is how R33's P6 became unreachable
 * before it was ever evaluated.
 */
export function precisionBarOf(reading: ExchangeReading): number | null {
  const repair = reading.repairRatePp;
  const broken = reading.breakRatePp;
  if (repair === null || broken === null) return null;
  if (repair + broken === 0) return null;
  return broken / (repair + broken);
}

/**
 * How far above the bar a gate has to land before this file calls it a win.
 *
 * The bar is where the net gain is exactly zero, so a gate that sits on it has produced nothing. Five
 * thousandths of precision is about the smallest lift the confirmation half could distinguish from
 * the bar anyway, and putting it in the definition keeps the verdict from depending on a rounding.
 */
export const PRECISION_BAR_TOLERANCE = 0.005;

/** One admission's reading: the counts, the gain on the corpus, and the interval. */
export type AdmissionReading = {
  readonly admitted: number;
  readonly share: number;
  readonly databases: number;
  readonly repaired: number;
  readonly broken: number;
  readonly net: number;
  /** Net gain in percentage points of the **whole corpus**, so it compares with §146 and the oracle. */
  readonly netPp: number | null;
  /** The same gain per admitted question, which is a hundred times larger and a different claim. */
  readonly perAdmittedPp: number | null;
  /** Share of the admitted set the bare model got wrong: the quantity the bar is written against. */
  readonly precision: number | null;
  /** Share of all repairs the admission kept. */
  readonly recall: number | null;
  readonly lowPp: number | null;
  readonly highPp: number | null;
  readonly resolves: boolean;
  /** Positive and resolved. A gate that clears is one this file would ship. */
  readonly clears: boolean;
};

/**
 * Score one admission rule.
 *
 * The interval is over `(correct − withoutMemoryCorrect) · 1[admitted]`, so a question that was not
 * admitted contributes a zero rather than disappearing. That is what keeps the interval on the
 * corpus's scale and keeps a gate that admits 5% of the questions from producing an interval as wide
 * as a gate that admits all of them.
 */
export function admissionGainOf(
  cases: readonly AdmissionCase[],
  admit: (entry: AdmissionCase) => boolean,
  options: { readonly resamples?: number; readonly seed?: number } = {},
): AdmissionReading {
  const resamples = options.resamples ?? 10_000;
  const seed = options.seed ?? 12345;
  const n = cases.length;
  let admitted = 0;
  let repaired = 0;
  let broken = 0;
  let repairable = 0;
  const values: number[] = [];
  const clusters: string[] = [];
  const reached = new Set<string>();
  for (const entry of cases) {
    const take = admit(entry);
    const signed = (entry.correct ? 1 : 0) - (entry.withoutMemoryCorrect ? 1 : 0);
    values.push(take ? signed : 0);
    clusters.push(entry.dbId);
    if (!take) continue;
    admitted += 1;
    reached.add(entry.dbId);
    if (!entry.withoutMemoryCorrect) repairable += 1;
    if (signed > 0) repaired += 1;
    if (signed < 0) broken += 1;
  }
  const totalRepaired = cases.filter((entry) => entry.correct && !entry.withoutMemoryCorrect).length;
  const databases = reached.size;
  const net = repaired - broken;
  // A percentile interval taken over one cluster collapses to the point estimate and would read as a
  // resolved finding. The same refusal as §147's gap: two clusters or no interval.
  const interval = databases < 2 ? null : clusterBootstrapCI(values, clusters, resamples, seed);
  const lowPp = interval === null ? null : interval.low * 100;
  const highPp = interval === null ? null : interval.high * 100;
  const resolves = lowPp !== null && highPp !== null && (lowPp > 0 || highPp < 0);
  const netPp = perHundred(net, n);
  return {
    admitted,
    share: n === 0 ? 0 : admitted / n,
    databases,
    repaired,
    broken,
    net,
    netPp,
    perAdmittedPp: perHundred(net, admitted),
    precision: ratio(repairable, admitted),
    recall: ratio(repaired, totalRepaired),
    lowPp,
    highPp,
    resolves,
    clears: resolves && netPp !== null && netPp > 0,
  };
}

/**
 * Tokens a similarity can be measured on: lowercase, alphanumeric, three characters or more.
 *
 * The length floor is the whole of the stopword handling. A list would need a corpus to justify it and
 * would make two runs incomparable the moment it changed; a floor of three removes `a`, `of`, `is`,
 * `to` and `in`, which is what the measure needs and nothing else.
 */
export function tokensOf(question: string): ReadonlySet<string> {
  const tokens = new Set<string>();
  for (const raw of question.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length >= 3) tokens.add(raw);
  }
  return tokens;
}

/** Jaccard over two token sets. Two empty questions are not similar; they are unmeasured. */
export function similarityOf(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / (left.size + right.size - shared);
}

/** Total order on ids, so every tie-break in this file is the same tie-break. */
export function compareIds(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/**
 * SKR's kNN signal, in the cheapest form that preserves its meaning.
 *
 * For each question, the share of the `k` most similar questions **in the same database** that the
 * bare model got wrong. A question is never its own neighbour, so the score for question *i* is built
 * entirely from outcomes the system would have observed before *i* was asked. Ties break on id, which
 * makes the score a function of the corpus rather than of the order it was read in — the defect that
 * turns a leave-one-out estimate into a self-fulfilling one is usually an unspecified tie.
 *
 * `null` means the question has no neighbour at all, which is a fact about the database and is left
 * as missing rather than scored as zero: a gate that admits on "no evidence of failure" would admit
 * every question in a one-question schema.
 */
export function selfKnowledgeOf(
  cases: readonly AdmissionCase[],
  options: { readonly k?: number } = {},
): ReadonlyMap<string, number | null> {
  const k = options.k ?? 10;
  const byDatabase = new Map<string, AdmissionCase[]>();
  for (const entry of cases) {
    const bucket = byDatabase.get(entry.dbId) ?? [];
    bucket.push(entry);
    byDatabase.set(entry.dbId, bucket);
  }
  const tokens = new Map(cases.map((entry) => [entry.id, tokensOf(entry.question)]));
  const scores: { id: string; score: number | null }[] = [];
  for (const pool of byDatabase.values()) {
    for (const entry of pool) {
      const own = tokens.get(entry.id) as ReadonlySet<string>;
      const neighbours = pool
        .filter((other) => other.id !== entry.id)
        .map((other) => ({
          id: other.id,
          failed: !other.withoutMemoryCorrect,
          weight: similarityOf(own, tokens.get(other.id) as ReadonlySet<string>),
        }))
        .sort((left, right) => right.weight - left.weight || compareIds(left.id, right.id))
        .slice(0, k);
      if (neighbours.length === 0) {
        scores.push({ id: entry.id, score: null });
        continue;
      }
      const failed = neighbours.filter((other) => other.failed).length;
      scores.push({ id: entry.id, score: failed / neighbours.length });
    }
  }
  scores.sort((left, right) => compareIds(left.id, right.id));
  return new Map(scores.map((row) => [row.id, row.score]));
}

/** Nearest-rank quantiles, clamped to the range. The sorted copy is local, so the caller's array is safe. */
export function quantilesOf(values: readonly number[], percents: readonly number[]): readonly number[] {
  if (values.length === 0) return [];
  const sorted = [...values].sort((left, right) => left - right);
  return percents.map((percent) => {
    const rank = Math.ceil((percent / 100) * sorted.length) - 1;
    const at = Math.min(sorted.length - 1, Math.max(0, rank));
    return sorted[at] as number;
  });
}

/** FNV-1a over a database name. Any stable hash will do; what matters is that it does not change. */
function hashOf(text: string): number {
  let hash = 0x811c9dc5;
  for (let at = 0; at < text.length; at += 1) {
    hash ^= text.charCodeAt(at);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/**
 * Deal databases alternately into two halves.
 *
 * By database rather than by question, for two reasons that point the same way: a gate that admits one
 * question in a schema and not its neighbour is not a deployment anyone can run, and §143 established
 * that questions inside a database are not independent, so a question-level split would put the same
 * correlation on both sides of the wall.
 */
export function splitByDatabase(cases: readonly AdmissionCase[]): {
  readonly discovery: readonly AdmissionCase[];
  readonly confirmation: readonly AdmissionCase[];
} {
  // The hash is the ordering key and the id is appended to it, so two databases can never compare
  // equal and the deal cannot depend on the order the corpus was read in.
  const keyOf = (dbId: string): string => `${hashOf(dbId).toString(36).padStart(7, '0')}:${dbId}`;
  const databases = [...new Set(cases.map((entry) => entry.dbId))].sort((left, right) =>
    compareIds(keyOf(left), keyOf(right)),
  );
  const left = new Set<string>();
  for (const [at, dbId] of databases.entries()) if (at % 2 === 0) left.add(dbId);
  return {
    discovery: cases.filter((entry) => left.has(entry.dbId)),
    confirmation: cases.filter((entry) => !left.has(entry.dbId)),
  };
}

/** The six gates `prereg/R34.md` registers, in the order it names them. */
export type GateId = 'self-knowledge' | 'coverage-high' | 'coverage-low' | 'pack-two' | 'conjunction' | 'random';

/** A gate's cut, and for the conjunction the second cut it borrows from the coverage gate. */
export type GateThreshold = { readonly value: number; readonly coverageFloor?: number };

/**
 * Whether one question passes one gate.
 *
 * `failShare` is passed rather than looked up so that a gate can be scored on a half of the corpus
 * without its neighbours changing — the score is a property of the whole corpus, and a gate that
 * recomputed it per half would be measuring a different rule on each side of the wall.
 */
export function admitsOf(
  gate: GateId,
  threshold: GateThreshold,
  entry: AdmissionCase,
  failShare: number | null,
): boolean {
  switch (gate) {
    case 'self-knowledge':
      return failShare !== null && failShare >= threshold.value;
    case 'coverage-high':
      return entry.coverage >= threshold.value;
    case 'coverage-low':
      return entry.coverage <= threshold.value;
    case 'pack-two':
      return entry.packIds >= 2;
    case 'conjunction':
      return (
        failShare !== null && failShare >= threshold.value && entry.coverage >= (threshold.coverageFloor ?? 0)
      );
    case 'random':
      // The control is admitted by the caller's seeded draw; a predicate cannot be random and remain
      // a function, and an estimator whose control is not reproducible is not a control.
      return false;
  }
}

/** One half's shape, as P1 reads it. */
export type HalfShape = {
  readonly label: string;
  readonly n: number;
  readonly databases: number;
  readonly discordant: number;
};

/** The bars P1, P3, P6 and P7 are decided on. Constants so a test can name them. */
export const R34_BARS = {
  /** P1: each half has to hold this many questions. */
  halfQuestions: 2_500,
  /** P1: and this many databases, or the clustered interval is a point estimate. */
  halfDatabases: 25,
  /**
   * P1: and this many discordant questions, or the half has nothing to measure.
   *
   * The registration asked for 240 of 424, which two halves cannot hold between them; Amendment 3
   * records the arithmetic and this is the bar the run was evaluated against.
   */
  halfDiscordant: 150,
  /** P7: the confirmation gain is expected to be at most this share of the discovery gain. */
  shrinkage: 0.7,
  /** Minimum coverage a selected threshold may produce, so a gate cannot win by admitting six questions. */
  minimumShare: 0.2,
} as const;

export type R34Verdict = {
  readonly id: string;
  readonly claim: string;
  readonly observed: string;
  readonly holds: boolean;
};

export type R34Input = {
  readonly halves: readonly HalfShape[];
  readonly exchange: ExchangeReading;
  readonly precisionBar: number | null;
  readonly oracle: { readonly repairable: AdmissionReading; readonly breakable: AdmissionReading };
  readonly control: readonly {
    readonly share: number;
    readonly deviationPp: number;
    /** Half-width of the control reading's own clustered interval. */
    readonly halfWidthPp: number | null;
    /** Whether the expected value lies inside that interval. */
    readonly covers: boolean;
  }[];
  readonly primary: { readonly discovery: AdmissionReading; readonly confirmation: AdmissionReading };
  readonly relevance: readonly { readonly id: string; readonly reading: AdmissionReading }[];
};

const ppText = (value: number | null): string => (value === null ? 'n/a' : `${value.toFixed(2)}pp`);
const pctText = (value: number | null): string => (value === null ? 'n/a' : `${(value * 100).toFixed(2)}%`);
const numText = (value: number | null, digits = 4): string => (value === null ? 'n/a' : value.toFixed(digits));

/**
 * Adjudicate the seven registrations.
 *
 * Each verdict carries the number it was decided on. The sentences lived in `prereg/R34.md` before any
 * of these numbers existed, and `holds` is the registration's answer rather than the author's.
 */
export function adjudicateR34(input: R34Input): readonly R34Verdict[] {
  const { exchange, oracle, primary, precisionBar } = input;
  const instrument = input.halves.every(
    (half) =>
      half.n >= R34_BARS.halfQuestions &&
      half.databases >= R34_BARS.halfDatabases &&
      half.discordant >= R34_BARS.halfDiscordant,
  );
  const hurdleShort = exchange.helpPerHarm !== null && exchange.hurdle !== null && exchange.helpPerHarm < exchange.hurdle;
  // An empty control set would satisfy `every` and read as a passed prediction. The bars below are
  // written to require the evidence rather than the absence of contrary evidence — the same defect
  // as §31.2's unreachable threshold, arriving from the other direction.
  // Amendment 1 of `prereg/R34.md`: the tolerance is the reading's own half-width rather than the
  // fixed 0.15pp the file registered. A fixed absolute tolerance was below the sampling error at the
  // smallest share, and a nested seeded draw produces a random walk anchored at share 1, so the
  // deviations are correlated across the grid and cannot be averaged. The criterion is now the one
  // the rest of this repository uses: the expected value has to lie inside the measurement's interval.
  const controlHolds = input.control.length > 0 && input.control.every((point) => point.covers);
  const oracleHolds =
    exchange.repaired > 0 &&
    exchange.broken > 0 &&
    oracle.repairable.repaired === exchange.repaired &&
    oracle.repairable.broken === 0 &&
    oracle.repairable.net === oracle.repairable.repaired &&
    oracle.breakable.broken === exchange.broken &&
    oracle.breakable.repaired === 0 &&
    oracle.breakable.net === -oracle.breakable.broken;
  const confirmation = primary.confirmation;
  const barWithTolerance = precisionBar === null ? null : precisionBar + PRECISION_BAR_TOLERANCE;
  const primaryHolds =
    confirmation.clears &&
    confirmation.precision !== null &&
    barWithTolerance !== null &&
    confirmation.precision > barWithTolerance;
  // And the same defect once more: "neither gate cleared" is true of no gates at all, so P6 requires
  // both of them to have been measured before their silence counts as a result.
  const relevanceHolds =
    input.relevance.length > 0 &&
    input.relevance.every((gate) => gate.reading.netPp !== null) &&
    !input.relevance.some((gate) => gate.reading.clears);
  const shrinks =
    confirmation.netPp !== null &&
    primary.discovery.netPp !== null &&
    confirmation.netPp <= R34_BARS.shrinkage * primary.discovery.netPp;
  return [
    {
      id: 'P1',
      claim: `each half holds at least ${R34_BARS.halfQuestions} questions, ${R34_BARS.halfDatabases} databases and ${R34_BARS.halfDiscordant} discordant questions`,
      observed: input.halves
        .map((half) => `${half.label} ${half.n}/${half.databases}/${half.discordant}`)
        .join(', '),
      holds: instrument,
    },
    {
      id: 'P2',
      claim: 'the exchange rate is below the bare odds, recomputed from the corpus rather than transcribed',
      observed: `${numText(exchange.helpPerHarm)} against ${numText(exchange.hurdle)}`,
      holds: hurdleShort,
    },
    {
      id: 'P3',
      claim: 'random admission scales with coverage: the expected gain lies inside the reading\'s own clustered interval at every share',
      observed: input.control
        .map((point) => `${pctText(point.share)} ${point.deviationPp.toFixed(3)}pp of ${ppText(point.halfWidthPp)}`)
        .join(', '),
      holds: controlHolds,
    },
    {
      id: 'P4',
      claim: 'admitting the repairable questions yields every repair and no break, and the mirror does the opposite',
      observed: `${oracle.repairable.repaired} repaired / ${oracle.repairable.broken} broken, then ${oracle.breakable.repaired} / ${oracle.breakable.broken}`,
      holds: oracleHolds,
    },
    {
      id: 'P5',
      claim: 'the self-knowledge gate clears on the confirmation half, over the precision bar, on an interval that excludes zero',
      observed: `${pctText(confirmation.precision)} against ${pctText(barWithTolerance)}, ${ppText(confirmation.netPp)} [${ppText(confirmation.lowPp)}, ${ppText(confirmation.highPp)}]`,
      holds: primaryHolds,
    },
    {
      id: 'P6',
      claim: 'neither relevance gate clears on the confirmation half',
      observed: input.relevance
        .map((gate) => `${gate.id} ${ppText(gate.reading.netPp)}${gate.reading.clears ? ' clears' : ''}`)
        .join(', '),
      holds: relevanceHolds,
    },
    {
      id: 'P7',
      claim: `the confirmation gain is at most ${pctText(R34_BARS.shrinkage)} of the discovery gain`,
      observed: `${ppText(confirmation.netPp)} against ${ppText(primary.discovery.netPp)}`,
      holds: shrinks,
    },
  ];
}
