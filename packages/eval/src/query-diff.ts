/**
 * Read the query diff as a covariate: does *what the pack did to the query* separate help from harm?
 *
 * `sql-diff.ts` describes each edited query. This module joins those descriptions to the outcome
 * and answers the only question the registration asks — whether the description predicts the sign of
 * the effect — and then answers a second question the first one raises, which is whether the answer
 * would survive being used. Both are arithmetic over a committed artefact: no model, no database, no
 * clock.
 *
 * ## Two tests, and why the second one is the one that survives scrutiny
 *
 * The natural test compares `helped` and `harmed` between the group that imported an ungrounded
 * name and the group that did not. It is easy to read and it carries a confound: the two groups
 * differ in how hard their questions are, and a harder question has more room to gain. Here the
 * confound runs *against* the finding — the importing group is the harder one and still loses —
 * but "the bias points the other way" is an argument, not a measurement, and the record has been
 * asked to accept too many of those.
 *
 * So the primary number is stratified on a variable that is fixed before the treatment exists:
 * whether the **no-memory** arm was already correct. Among questions the model already answered
 * without any memory, a treatment effect can only be damage; among questions it got wrong, a
 * treatment effect can only be repair. Splitting on that line removes the difficulty confound by
 * construction, because both cells are compared inside a stratum where the baseline outcome is
 * constant. `harmedPerCorrectPp` and `helpedPerWrongPp` are those two rates, and the first one is
 * where this round's result lives.
 *
 * ## What the gate estimate is and is not
 *
 * `counterfactual` answers: if a read-time filter had discarded every memory query that imports an
 * ungrounded name, and the no-pack query had been written instead, what would the paired delta have
 * been? It is exact rather than modelled, because the record already holds both queries — the
 * fallback is a column, not a prediction. What it is **not** is an out-of-sample estimate: the
 * filter was chosen by looking at these 1,534 questions, so the number it improves is in-sample and
 * is reported as an upper bound on what stage 2 can confirm.
 */
import { mulberry32 } from '@agentix-e/microglia-core';
import { clusterBootstrapCI, comparePaired } from './stats.js';
import { pairedWidths } from './power.js';
import type { QueryDelta, GroundingMode } from './sql-diff.js';

/** One question's contribution: what the two arms wrote, and how each of them scored. */
export type DiffCase = {
  readonly id: string;
  readonly dbId: string;
  readonly delta: QueryDelta;
  readonly correct: boolean;
  readonly withoutMemoryCorrect: boolean;
  /**
   * The rules the model was shown for this question, when the lane recorded them.
   *
   * Optional because a reading about what the pack *did to the query* does not need to know what
   * the pack *said*, and a corpus without it should be rejected by the reading that does rather
   * than by every reading. It is here rather than in a second type so the two kinds of reading
   * cannot end up over two different corpora.
   */
  readonly packIdList?: readonly string[];
  /** The question as the model read it, carried for readings about what it asked for. */
  readonly question?: string;
  /** The external-knowledge block, which a solver may read and which therefore grounds a name. */
  readonly evidence?: string;
  /** The reference query, carried for readings that need what the answer required. */
  readonly goldSql?: string;
  /** The benchmark's own difficulty label, which is the stratification variable the run supplies. */
  readonly difficulty?: string;
};

/**
 * One group's paired summary.
 *
 * The two conditional rates are the stratified reading: `harmedPerCorrectPp` is how often the pack
 * destroyed a correct query, `helpedPerWrongPp` is how often it repaired a wrong one. They are
 * reported as `null` rather than zero when the denominator is empty, for the same reason the
 * stratum buckets are: a rate over nothing is not zero, it is unmeasured.
 */
export type CellReading = {
  readonly n: number;
  readonly helped: number;
  readonly harmed: number;
  readonly deltaPp: number | null;
  readonly halfWidthPp: number | null;
  /**
   * The paired design's 80%-power resolution, or `null`.
   *
   * `null` has two causes and they are not the same: an empty group has no resolution at all, and a
   * group with **no discordant pair** has an infinite one — nothing can be detected from a
   * comparison in which nothing changed, and JSON writes infinity as `null`. The 692 questions this
   * pack left untouched are the second case. `helped + harmed === 0` tells them apart, which is why
   * that sum is in the artefact twice rather than behind a flag.
   */
  readonly minDetectablePp: number | null;
  readonly baselineCorrect: number;
  readonly baselineAccuracy: number;
  readonly harmedPerCorrectPp: number | null;
  readonly helpedPerWrongPp: number | null;
  /** Percentile interval of the delta with the database as the resampling unit. */
  readonly clusterLowPp: number | null;
  readonly clusterHighPp: number | null;
};

/** Summarise one group. `resamples` is explicit because the report quotes the interval. */
export function cellOf(cases: readonly DiffCase[], resamples = 10_000): CellReading {
  const n = cases.length;
  let helped = 0;
  let harmed = 0;
  let baselineCorrect = 0;
  const values: number[] = [];
  const clusters: string[] = [];
  for (const entry of cases) {
    if (entry.withoutMemoryCorrect) baselineCorrect += 1;
    const signed = (entry.correct ? 1 : 0) - (entry.withoutMemoryCorrect ? 1 : 0);
    values.push(signed);
    clusters.push(entry.dbId);
    if (signed > 0) helped += 1;
    if (signed < 0) harmed += 1;
  }
  const widths = pairedWidths(helped, harmed, n);
  const clustered = clusterBootstrapCI(values, clusters, resamples);
  const baselineWrong = n - baselineCorrect;
  return {
    n,
    helped,
    harmed,
    deltaPp: widths === null ? null : widths.deltaPp,
    halfWidthPp: widths === null ? null : widths.halfWidthPp,
    minDetectablePp: widths === null ? null : widths.minDetectablePp,
    baselineCorrect,
    baselineAccuracy: n === 0 ? 0 : baselineCorrect / n,
    harmedPerCorrectPp: baselineCorrect === 0 ? null : (harmed / baselineCorrect) * 100,
    helpedPerWrongPp: baselineWrong === 0 ? null : (helped / baselineWrong) * 100,
    clusterLowPp: n === 0 ? null : clustered.low * 100,
    clusterHighPp: n === 0 ? null : clustered.high * 100,
  };
}

/**
 * Log-gamma, Lanczos approximation, for arguments of at least one.
 *
 * Every call site passes `n + 1` or `k + 1` from a binomial coefficient, so the argument is never
 * below one and the reflection formula a general implementation needs is not here. It was written
 * first and could not be reached by any input, which is a branch that exists to satisfy a textbook
 * rather than a caller.
 */
function logGamma(x: number): number {
  const g = [
    676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  const z = x - 1;
  let a = 0.99999999999980993;
  for (const [at, coefficient] of g.entries()) a += coefficient / (z + at + 1);
  const t = z + g.length - 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}

/**
 * Log of the binomial coefficient, for `0 ≤ k ≤ n`.
 *
 * No guard on that range: `fisherExact` enumerates `x` between `low` and `high`, which are the
 * bounds of the hypergeometric support, so `k` and `n − k` are both non-negative at every call. A
 * range check here would be a branch no input can take, and the argument above is the reason rather
 * than an exception registered against it.
 */
function logChoose(n: number, k: number): number {
  return logGamma(n + 1) - logGamma(k + 1) - logGamma(n - k + 1);
}

/**
 * Fisher's exact test on a 2×2 table, two-sided.
 *
 * The table is `[[a, b], [c, d]]` in row-major order — present-group helped and harmed, then
 * absent-group helped and harmed. Two-sided means every table at least as extreme as the observed
 * one, with "at least as extreme" measured by probability, which is the definition R uses and the
 * one a reader can check against any statistics package.
 *
 * Paired data does not strictly license Fisher's test — the observations within a group are
 * discordant pairs, not independent draws — and the module does not rely on it: `Fisher` is
 * reported beside a difference-of-deltas interval and a clustered bootstrap, and the criterion it
 * feeds requires all three shapes to agree on the sign.
 */
export function fisherExact(a: number, b: number, c: number, d: number): number {
  const rows = a + b;
  const columns = a + c;
  const total = a + b + c + d;
  if (total === 0) return 1;
  const probability = (x: number) =>
    Math.exp(logChoose(rows, x) + logChoose(total - rows, columns - x) - logChoose(total, columns));
  const observed = probability(a);
  const low = Math.max(0, columns - (total - rows));
  const high = Math.min(rows, columns);
  let sum = 0;
  for (let x = low; x <= high; x += 1) {
    const p = probability(x);
    // A tolerance rather than a strict comparison: an equally extreme table can differ in the
    // fourteenth decimal place from rounding, and excluding it would understate the p-value.
    if (p <= observed * (1 + 1e-9)) sum += p;
  }
  return Math.min(1, sum);
}

/** One covariate and the two groups it splits the corpus into. */
export type FeatureReading = {
  readonly code: string;
  readonly feature: string;
  readonly present: CellReading;
  readonly absent: CellReading;
  /** `delta(present) − delta(absent)`, in percentage points. `null` when either side is empty. */
  readonly gapPp: number | null;
  /** `1.96 · sqrt(SE²(present) + SE²(absent))`: the width of a difference of two paired deltas. */
  readonly gapHalfWidthPp: number | null;
  /** Exact test on the discordant 2×2. Reported beside the interval, never instead of it. */
  readonly fisherP: number;
  /** Percentile interval of the same gap with the database as the resampling unit, or `null`. */
  readonly clusterLowPp: number | null;
  readonly clusterHighPp: number | null;
  /** Whether the gap exceeds its own 95% half-width. The bar every other round has had to clear. */
  readonly resolves: boolean;
};

/**
 * Build one feature reading from two groups that have already been separated.
 *
 * The split is taken as data rather than as a predicate so that a grouping the module cannot
 * express — the pack's text, which is not a property of the query diff — reuses this arithmetic
 * instead of restating it. `featureOf` is the predicate-shaped wrapper over this and nothing else,
 * which is what keeps the gap, its interval, the exact test and the clustered resample defined in
 * exactly one place.
 */
export function readingOf(
  code: string,
  feature: string,
  present: readonly DiffCase[],
  absent: readonly DiffCase[],
  resamples = 10_000,
): FeatureReading {
  const presentCell = cellOf(present, resamples);
  const absentCell = cellOf(absent, resamples);
  const gapPp =
    presentCell.deltaPp === null || absentCell.deltaPp === null
      ? null
      : presentCell.deltaPp - absentCell.deltaPp;
  // Called only under the guard that both groups are non-empty, so the empty case has no branch:
  // a normalisation for `n = 0` here would be a line no input can reach, and the guard two lines
  // down is the reason rather than an exemption registered against it.
  const standardError = (cell: CellReading): number =>
    (Math.sqrt(cell.helped + cell.harmed) / cell.n) * 100;
  const gapHalfWidthPp =
    presentCell.n === 0 || absentCell.n === 0
      ? null
      : 1.96 * Math.sqrt(standardError(presentCell) ** 2 + standardError(absentCell) ** 2);
  const clustered = clusteredGapOf(present, absent, resamples);
  return {
    code,
    feature,
    present: presentCell,
    absent: absentCell,
    gapPp,
    gapHalfWidthPp,
    fisherP: fisherExact(presentCell.helped, presentCell.harmed, absentCell.helped, absentCell.harmed),
    clusterLowPp: clustered === null ? null : clustered.lowPp,
    clusterHighPp: clustered === null ? null : clustered.highPp,
    resolves: gapPp !== null && gapHalfWidthPp !== null && Math.abs(gapPp) > gapHalfWidthPp,
  };
}

/** Build one feature reading from a predicate over the corpus. */
export function featureOf(
  code: string,
  feature: string,
  entries: readonly DiffCase[],
  predicate: (delta: QueryDelta) => boolean,
  resamples = 10_000,
): FeatureReading {
  return readingOf(
    code,
    feature,
    entries.filter((entry) => predicate(entry.delta)),
    entries.filter((entry) => !predicate(entry.delta)),
    resamples,
  );
}

/** What the corpus looks like with a gate installed, beside what it looks like without one. */
export type GateReading = {
  readonly mode: GroundingMode;
  /** Questions whose memory query the gate would discard. */
  readonly discarded: number;
  /** Share of the corpus the gate touches. */
  readonly discardedShare: number;
  readonly gated: CellReading;
  readonly measured: CellReading;
  /** `gated.deltaPp − measured.deltaPp`: what the filter would buy, in percentage points. */
  readonly improvementPp: number | null;
  /** Exact McNemar p-value of the gated comparison against the no-memory arm. */
  readonly p: number;
  /** Whether the gated delta beats its own 95% half-width. */
  readonly significant95: boolean;
  /** Whether the gated delta beats its own 80%-power minimum detectable difference. */
  readonly resolvable: boolean;
};

/**
 * Which questions a read-time gate would discard, by id.
 *
 * Identity is the case id and not the object, so a caller can hold the set across a re-read of the
 * corpus — the stability readings resample and re-partition, and a set of references would have to
 * be rebuilt for each partition. It follows that ids must be unique, which they are: the lane keys
 * a case `${db_id}#${question_id}` and a cross-fitted fold never evaluates one twice.
 */
export function discardSetOf(
  entries: readonly DiffCase[],
  mode: GroundingMode = 'strict',
): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const entry of entries) {
    if ((mode === 'strict' ? entry.delta.ungrounded : entry.delta.ungroundedLoose).length > 0) ids.add(entry.id);
  }
  return ids;
}

/**
 * What a discard set is worth, in percentage points of paired delta.
 *
 * Closed form rather than a second pass over the corpus. The fallback outcome is already a column,
 * so the change a gate causes is exactly the negative of the signed outcomes of the questions it
 * discards, divided by `n` — an identity, not an approximation. `gateReadingOf` reports the same
 * number through a full `cellOf`, and the two agree by construction; the reason this function
 * exists separately is that the permutation test in `gate-stability.ts` evaluates it 5,000 times,
 * and a `cellOf` per draw would run a 10,000-resample bootstrap inside every one of them.
 */
export function improvementOf(entries: readonly DiffCase[], discarded: ReadonlySet<string>): number {
  if (entries.length === 0) return 0;
  let signed = 0;
  for (const entry of entries) {
    if (!discarded.has(entry.id)) continue;
    signed += (entry.correct ? 1 : 0) - (entry.withoutMemoryCorrect ? 1 : 0);
  }
  return (-signed / entries.length) * 100;
}

/**
 * Score the corpus as if the gate had been installed.
 *
 * The fallback is not simulated. For a discarded question the record already holds the no-memory
 * query and its outcome, so the gated arm's correctness is `withoutMemoryCorrect` — a column, read
 * directly. That is what makes the estimate exact rather than modelled, and it is also why the
 * estimate cannot be extended past this corpus: a real deployment would have to *write* the
 * fallback query, and this corpus is the only place where that query already exists.
 */
export function gateReadingOf(
  entries: readonly DiffCase[],
  mode: GroundingMode = 'strict',
  resamples = 10_000,
): GateReading {
  const discarded = discardSetOf(entries, mode);
  const gatedCases = entries.map((entry) =>
    discarded.has(entry.id) ? { ...entry, correct: entry.withoutMemoryCorrect } : entry,
  );
  const paired = comparePaired(
    entries.map((entry) => entry.withoutMemoryCorrect),
    gatedCases.map((entry) => entry.correct),
    12345,
    2000,
  );
  const gated = cellOf(gatedCases, resamples);
  const measured = cellOf(entries, resamples);
  const deltaPp = gated.deltaPp;
  return {
    mode,
    discarded: discarded.size,
    discardedShare: entries.length === 0 ? 0 : discarded.size / entries.length,
    gated,
    measured,
    improvementPp: entries.length === 0 ? null : improvementOf(entries, discarded),
    p: paired.p,
    significant95: deltaPp !== null && gated.halfWidthPp !== null && Math.abs(deltaPp) > gated.halfWidthPp,
    resolvable:
      deltaPp !== null && gated.minDetectablePp !== null && Math.abs(deltaPp) > gated.minDetectablePp,
  };
}

/** One row of the descriptive table: how many questions the label covers, and how they went. */
export type KindReading = {
  readonly kind: string;
  readonly cell: CellReading;
  /** Share of the corpus, which is the number that says whether a label is a category or a curio. */
  readonly share: number;
};

/** What the discordant cases look like from the covariate's point of view. */
export type DiscordantReading = {
  /** Questions the two arms scored differently. */
  readonly total: number;
  /** Of those, the ones whose memory query imported an ungrounded name. */
  readonly importing: number;
  /** Of those, the ones the covariate cannot describe. The ceiling on a per-question account. */
  readonly unexplained: number;
  readonly unexplainedShare: number;
  /** The largest single discordant bucket by count, whichever it is. */
  readonly largestBucket: string;
  readonly largestCount: number;
};

export type DiffCriterion = {
  readonly code: string;
  readonly criterion: string;
  readonly actual: string;
  readonly ok: boolean;
};

export type QueryDiffReading = {
  readonly criteria: readonly DiffCriterion[];
  /** The registered refutation: the identifier covariate is flat, so the axis is not the query diff. */
  readonly refuted: boolean;
  /** Which registered predictions the reading confirms, by code. */
  readonly confirmed: readonly string[];
};

export type QueryDiffInput = {
  readonly cases: readonly DiffCase[];
  readonly kinds: readonly KindReading[];
  readonly features: readonly FeatureReading[];
  readonly discordant: DiscordantReading;
  readonly gates: readonly GateReading[];
};

/**
 * Turn the readings into the registered verdict.
 *
 * Five criteria, each traceable to a sentence in the registration. `Q1` is the prediction; `Q2` is
 * the second prediction, about how much a per-question account can ever attribute; `Q3` and `Q4`
 * are the two ways `Q1` could be an artefact of how the covariate was built — the grounding rule and
 * the difficulty of the two groups — and `Q5` is the estimate the registration says a positive stage
 * 1 would license. A reading that passed `Q1` and failed `Q4` would be a separation between a hard
 * group and an easy one, which is why the four travel together rather than as one headline.
 */
export function readQueryDiff(input: QueryDiffInput): QueryDiffReading {
  // One formatter rather than a `?.toFixed(2) ?? 'n/a'` per site: the null arm has to be reachable
  // from somewhere, and three separate optional chains mean three arms that each need their own
  // impossible input to cover.
  const pp = (value: number | null): string => (value === null ? 'n/a' : value.toFixed(2));
  const primary = input.features.find((entry) => entry.code === 'F1');
  const loose = input.features.find((entry) => entry.code === 'F2');
  const strictGate = input.gates.find((entry) => entry.mode === 'strict');
  const total = input.cases.length;

  const separating = primary !== undefined && primary.resolves && primary.fisherP < 0.05;
  const robust = loose !== undefined && loose.resolves;
  // Difficulty is the confound that would explain the finding without the mechanism: a group the
  // model already fails more often has more room to gain, so a *lower* delta there is evidence
  // against the difficulty story rather than for it. The criterion is stated on the stratified
  // rates, where the comparison is inside a fixed baseline outcome.
  const harmedPresent = primary?.present.harmedPerCorrectPp ?? null;
  const harmedAbsent = primary?.absent.harmedPerCorrectPp ?? null;
  const stratified =
    harmedPresent !== null && harmedAbsent !== null && harmedPresent > harmedAbsent;
  // Zero rather than `null` when there is no primary feature: the value is only printed on the
  // branch where the primary exists, and a reachable-looking `null` arm would be a branch no input
  // can take. The alternative — an impossible state represented in the type — is how a criterion
  // ends up reporting 'n/a' for a quantity it actually measured.
  const baseGap =
    primary === undefined
      ? 0
      : Math.abs(primary.present.baselineAccuracy - primary.absent.baselineAccuracy) * 100;

  const criteria: DiffCriterion[] = [
    {
      code: 'Q1',
      criterion: 'The identifier covariate separates help from harm: the gap exceeds its own 95% half-width and p < 0.05',
      actual:
        primary === undefined
          ? 'no primary feature'
          : `gap ${pp(primary.gapPp)}pp ±${pp(primary.gapHalfWidthPp)}, p=${primary.fisherP.toFixed(4)}`,
      ok: separating,
    },
    {
      code: 'Q2',
      criterion: 'Most discordant cases have no identifiable cause in the query diff',
      actual: `${input.discordant.unexplained} of ${input.discordant.total} flips unexplained (${(input.discordant.unexplainedShare * 100).toFixed(1)}%), largest bucket ${input.discordant.largestBucket} at ${input.discordant.largestCount}`,
      ok:
        input.discordant.unexplainedShare > 0.5 &&
        input.discordant.largestBucket === 'unexplained',
    },
    {
      code: 'Q3',
      criterion: 'The separation survives the looser grounding rule, so it is not an artefact of the tokeniser',
      actual:
        loose === undefined
          ? 'no secondary feature'
          : `gap ${pp(loose.gapPp)}pp ±${pp(loose.gapHalfWidthPp)} over ${loose.present.n} questions`,
      ok: robust,
    },
    {
      code: 'Q4',
      criterion: 'The separation is not a difficulty artefact: the memory arm destroys already-correct queries more often in the importing group',
      actual:
        harmedPresent === null || harmedAbsent === null
          ? 'a group has no correct baseline query'
          : `destroyed ${harmedPresent.toFixed(2)}% vs ${harmedAbsent.toFixed(2)}% of already-correct queries; baseline accuracies differ by ${baseGap.toFixed(2)}pp`,
      ok: stratified,
    },
    {
      code: 'Q5',
      criterion: 'A gate that discards every importing memory query would raise the paired delta',
      actual:
        strictGate === undefined || strictGate.improvementPp === null
          ? 'no gate reading'
          : `${pp(strictGate.measured.deltaPp)}pp → ${pp(strictGate.gated.deltaPp)}pp (+${strictGate.improvementPp.toFixed(2)}pp), discarding ${strictGate.discarded} of ${total}`,
      ok: strictGate !== undefined && strictGate.improvementPp !== null && strictGate.improvementPp > 0,
    },
  ];

  const confirmed = criteria.filter((entry) => entry.ok).map((entry) => entry.code);
  return { criteria, refuted: !separating, confirmed };
}

/**
 * Resample the gap itself, with the database as the unit.
 *
 * The analytic interval on `gapPp` treats every question as an independent draw, and in this corpus
 * they are not: eleven databases contribute questions in blocks, and a rule injected on one question
 * of a database is injected on many. Resampling questions would report an interval narrower than the
 * evidence supports, so both groups are resampled by database — redrawing the same database twice
 * keeps its questions together, which is what the correlation looks like.
 *
 * Reported beside `gapHalfWidthPp` rather than replacing it. The analytic interval is what every
 * other round's numbers were computed with; the clustered one says how much of it was the
 * independence assumption.
 */
export function clusteredGap(
  entries: readonly DiffCase[],
  predicate: (delta: QueryDelta) => boolean,
  resamples = 10_000,
  seed = 12345,
): { readonly lowPp: number; readonly highPp: number } | null {
  return clusteredGapOf(
    entries.filter((entry) => predicate(entry.delta)),
    entries.filter((entry) => !predicate(entry.delta)),
    resamples,
    seed,
  );
}

/**
 * The same interval for two groups that are already separated.
 *
 * `readingOf` needs this form because the grouping it reads — the pack's text — is not a function
 * of the query diff, and re-partitioning a concatenated list by reference would make the resample
 * depend on object identity rather than on the split the caller made.
 */
export function clusteredGapOf(
  present: readonly ScoredRow[],
  absent: readonly ScoredRow[],
  resamples = 10_000,
  seed = 12345,
): { readonly lowPp: number; readonly highPp: number } | null {
  if (present.length === 0 || absent.length === 0) return null;
  // One database resampled is the same database: every draw returns the same mean and the interval
  // collapses onto the point estimate, which reads as a resolved effect. `clusteredDeltaOf` refuses
  // that case and so must this one — the two are quoted side by side and must not disagree about
  // when a corpus has no interval to give.
  const clusters = new Set([...present, ...absent].map((entry) => entry.dbId));
  if (clusters.size < 2) return null;
  const draw = (buckets: Map<string, number[]>, random: () => number): number => {
    const groups = [...buckets.values()];
    let total = 0;
    let count = 0;
    for (let at = 0; at < groups.length; at += 1) {
      const bucket = groups[Math.floor(random() * groups.length)] as number[];
      for (const value of bucket) {
        total += value;
        count += 1;
      }
    }
    // `groups` is built from a non-empty list and every bucket in it holds at least one value, so
    // `count` is never zero and there is nothing to divide by zero here.
    return total / count;
  };
  const presentBuckets = group(present);
  const absentBuckets = group(absent);
  const random = mulberry32(seed);
  const samples: number[] = [];
  for (let at = 0; at < resamples; at += 1) {
    samples.push((draw(presentBuckets, random) - draw(absentBuckets, random)) * 100);
  }
  samples.sort((left, right) => left - right);
  return {
    lowPp: samples[Math.floor(0.025 * (samples.length - 1))] as number,
    highPp: samples[Math.ceil(0.975 * (samples.length - 1))] as number,
  };
}

/**
 * The three fields a clustered resample needs from an outcome.
 *
 * Structural rather than `DiffCase`, because a reading can hold outcomes whose queries were never
 * diffed — a validity check scores one query against a question, not two against each other — and
 * fabricating a `delta` to satisfy a type is how a reading ends up carrying a field it never read.
 */
export type ScoredRow = {
  readonly dbId: string;
  readonly correct: boolean;
  readonly withoutMemoryCorrect: boolean;
};

/** Bucket one group's signed outcomes by database, which is the unit the resample draws. */
function group(rows: readonly ScoredRow[]): Map<string, number[]> {
  const buckets = new Map<string, number[]>();
  for (const entry of rows) {
    const bucket = buckets.get(entry.dbId) ?? [];
    bucket.push((entry.correct ? 1 : 0) - (entry.withoutMemoryCorrect ? 1 : 0));
    buckets.set(entry.dbId, bucket);
  }
  return buckets;
}
