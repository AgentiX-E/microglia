/**
 * Where is the harm? A stratification of the paired record by query–rule overlap.
 *
 * The project's longest-running unexplained number is the size of the memory effect: **+1.17pp**
 * on the terrain most favourable to it, over twenty-six iterations, with individual arms ranging
 * from +8pp to −9.26pp. The standing hypothesis has been that the defect is not in the model's
 * willingness to follow a rule but in *what is stored and how it is used*.
 *
 * Four published designs name four different defects, and one of them makes a sharp prediction
 * about a dataset this repository already holds. MEMTRIM (arXiv 2610.07311) reports that memory
 * helps when experience transfers whole and misleads when **only part** of it transfers, with the
 * harm largest at *intermediate* query–memory overlap and small at both extremes. If that is this
 * system's failure mode, then stratifying `correct − withoutMemoryCorrect` by an outcome-blind
 * overlap statistic should put the minimum of the four buckets in the middle.
 *
 * Three properties make this a measurement rather than a story:
 *
 *  - **Outcome-blind by construction.** The stratifier reads the question and the injected rule
 *    text, never a result. A stratum built from the outcome it is used to explain would find
 *    whatever it was asked to find.
 *  - **The store's own number.** Overlap is `queryCoverage`, the function behind `minCoverage`, and
 *    not a second definition of the same quantity: a probe that measured coverage with a different
 *    tokeniser would report a number no caller could reproduce, and the threshold it suggested
 *    could not be installed.
 *  - **The buckets were fixed before the run**, in `ROADMAP.md` §R28, together with the four
 *    criteria and the refutation. This module implements that registration and adds one criterion
 *    it did not have, disclosed as an amendment (see `readStrata`).
 *
 * Nothing here calls a model. The whole stratification is arithmetic over a committed artefact.
 */
import { queryCoverage } from '@agentix-e/microglia-core';
import { pairedWidths } from './power.js';

/**
 * The bucket edges, fixed by the registration: `[0, .2)`, `[.2, .4)`, `[.4, .6)`, `[.6, 1]`.
 *
 * Untuned on purpose. Overlap between a question and an abstract rule is low in this corpus —
 * the median is 0.20 — so four equal-quarters buckets would have put five questions in the top
 * one. The edges were chosen to put roughly a tenth of the corpus above 0.4 and to still resolve
 * the middle, which is the region MEMTRIM's mechanism occupies.
 */
export const STRATUM_EDGES: readonly number[] = [0.2, 0.4, 0.6];

/** One question's contribution: what it was asked, what it was shown, and how it went. */
export type StratumCase = {
  readonly question: string;
  readonly injected: readonly string[];
  readonly correct: boolean;
  readonly withoutMemoryCorrect: boolean;
  readonly difficulty: string;
};

/**
 * One bucket of the stratification.
 *
 * The three width fields are `null` for an empty bucket rather than zero: a bucket with no
 * questions has no effect and no resolution, and a zero would read as "measured, and exactly
 * zero" to every consumer that does not check `n` first. The same distinction the gate layer
 * makes between an absent gate and a green one.
 */
export type Stratum = {
  readonly index: number;
  readonly lower: number;
  /** Exclusive upper edge, or `null` for the top bucket. */
  readonly upper: number | null;
  readonly n: number;
  readonly helped: number;
  readonly harmed: number;
  /** `(helped − harmed) / n`, in percentage points. */
  readonly deltaPp: number | null;
  /** `1.96 · SE` of that delta, in percentage points. */
  readonly halfWidthPp: number | null;
  /** The paired design's minimum detectable difference at 80% power, in percentage points. */
  readonly minDetectablePp: number | null;
};

export type StratumCriterion = {
  readonly code: string;
  readonly criterion: string;
  readonly actual: string;
  readonly ok: boolean;
};

export type DifficultyStrata = {
  readonly difficulty: string;
  readonly buckets: readonly Stratum[];
};

export type StratumReading = {
  readonly buckets: readonly Stratum[];
  /** Index of the lowest bucket delta, or `null` when no bucket carries a delta. */
  readonly minimum: number | null;
  readonly maximum: number | null;
  readonly gapPp: number | null;
  /** The minimum detectable difference of that gap, which is what decides whether it is a gap. */
  readonly gapMinDetectablePp: number | null;
  readonly criteria: readonly StratumCriterion[];
  /** The registered refutation: the minimum sits at an end bucket, so the shape is not the one predicted. */
  readonly refuted: boolean;
};

/**
 * Overlap between a question and the rules it was actually shown: the strongest match wins.
 *
 * `max` rather than `mean` because a pack is several rules and the question meets the closest of
 * them. A pack of five rules where one is about the question and four are about the database has
 * an overlap of one rule with that question, and averaging would report a fifth of it.
 */
export function overlapOf(question: string, injected: readonly string[]): number {
  let best = 0;
  for (const rule of injected) {
    const value = queryCoverage(question, rule);
    if (value > best) best = value;
  }
  return best;
}

/**
 * Character n-grams, for the stability criterion only.
 *
 * This is deliberately **not** a relevance signal and must not be wired to one. It exists so that
 * a bucket shape produced by one tokeniser can be asked whether it survives another: a pattern
 * that moves when the tokeniser changes is a property of the tokeniser, and the four-bucket
 * reading is one comparison away from being exactly that.
 */
export function charGrams(text: string, width: number): Set<string> {
  const grams = new Set<string>();
  const words = text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').split(' ');
  for (const word of words) {
    if (word === '') continue;
    if (word.length <= width) {
      grams.add(word);
      continue;
    }
    for (let at = 0; at + width <= word.length; at += 1) grams.add(word.slice(at, at + width));
  }
  return grams;
}

/** The same overlap statistic under a character n-gram tokenisation. */
export function characterOverlapOf(question: string, injected: readonly string[], width = 4): number {
  const wanted = charGrams(question, width);
  if (wanted.size === 0) return 0;
  let best = 0;
  for (const rule of injected) {
    const present = charGrams(rule, width);
    let shared = 0;
    for (const gram of wanted) if (present.has(gram)) shared += 1;
    const value = shared / wanted.size;
    if (value > best) best = value;
  }
  return best;
}

/** Discordant pairs in a bucket: the only pairs that carry information about a paired delta. */
export function discordantOf(bucket: Stratum): number {
  return bucket.helped + bucket.harmed;
}

/**
 * Bucket the cases by an outcome-blind overlap function.
 *
 * The overlap function is a parameter so that the second tokenisation reuses this bucketing
 * rather than a copy of it: two bucketings that could disagree about an edge would make the
 * stability criterion a comparison of two implementations instead of two tokenisations.
 */
export function stratify(
  cases: readonly StratumCase[],
  overlap: (entry: StratumCase) => number,
  edges: readonly number[] = STRATUM_EDGES,
): readonly Stratum[] {
  const buckets: Stratum[] = [];
  for (let index = 0; index <= edges.length; index += 1) {
    const lower = index === 0 ? 0 : (edges[index - 1] as number);
    const upper = index < edges.length ? (edges[index] as number) : null;
    let n = 0;
    let helped = 0;
    let harmed = 0;
    for (const entry of cases) {
      const value = overlap(entry);
      if (value < lower) continue;
      if (upper !== null && value >= upper) continue;
      n += 1;
      if (entry.correct && !entry.withoutMemoryCorrect) helped += 1;
      else if (entry.withoutMemoryCorrect && !entry.correct) harmed += 1;
    }
    // One definition of the widths, shared with the power audit: a bucket that computed its own
    // standard error could disagree with the audit about the same forty questions.
    const widths = pairedWidths(helped, harmed, n);
    buckets.push({
      index,
      lower,
      upper,
      n,
      helped,
      harmed,
      deltaPp: widths?.deltaPp ?? null,
      halfWidthPp: widths?.halfWidthPp ?? null,
      minDetectablePp: widths?.minDetectablePp ?? null,
    });
  }
  return buckets;
}

function isMiddle(index: number, buckets: readonly Stratum[]): boolean {
  return index > 0 && index < buckets.length - 1;
}

function lowestAndHighest(buckets: readonly Stratum[]): {
  readonly minimum: Stratum | undefined;
  readonly maximum: Stratum | undefined;
} {
  let minimum: Stratum | undefined;
  let maximum: Stratum | undefined;
  for (const bucket of buckets) {
    if (bucket.deltaPp === null) continue;
    if (minimum === undefined || bucket.deltaPp < (minimum.deltaPp as number)) minimum = bucket;
    if (maximum === undefined || bucket.deltaPp > (maximum.deltaPp as number)) maximum = bucket;
  }
  return { minimum, maximum };
}

/** Bucket indices ordered by delta, which is the shape the stability criterion compares. */
function shapeOf(buckets: readonly Stratum[]): readonly number[] {
  return buckets
    .filter((bucket) => bucket.deltaPp !== null)
    .slice()
    .sort((left, right) => (left.deltaPp as number) - (right.deltaPp as number) || left.index - right.index)
    .map((bucket) => bucket.index);
}

/**
 * Percentage points, or the sentence for a number that does not exist.
 *
 * A bucket in which no question changed hands has no standard error to estimate and its minimum
 * detectable difference is infinite — `detectableDelta` returns that rather than a zero, because a
 * zero would read as "resolves everything". Printing `Infinitypp` here would look like a bug in the
 * arithmetic, so the same rule the gate layer uses applies: say what it means.
 */
const fixed = (value: number): string => (Number.isFinite(value) ? `${value.toFixed(2)}pp` : 'not estimable');

/**
 * Read the stratification against the registered criteria, and add the one it was missing.
 *
 * The four registered criteria ask whether the minimum is in the middle, whether it survives the
 * difficulty control, whether the buckets are populated, and whether the shape survives a second
 * tokeniser. Running them produced a fifth that the registration should have carried: **a minimum
 * is only a minimum if the gap around it exceeds its own resolution.** Without it, a bucket with
 * four discordant pairs can be reported as the minimum of four and read as a shape, when its own
 * interval is six times the gap it is supposed to be below. `S5` is that check, it is marked as an
 * amendment in the artefact, and it is the criterion that decides whether `S1` said anything.
 *
 * `S2` is applied with a power floor for the same reason: the registered wording lets a
 * three-question cell decide whether a difficulty band keeps its minimum in the middle, which is
 * a coin flip wearing the costume of a control. Bands with no bucket above the floor are reported
 * as undecided rather than as agreeing.
 */
export function readStrata(input: {
  readonly primary: readonly Stratum[];
  readonly alternative: readonly Stratum[];
  readonly byDifficulty: readonly DifficultyStrata[];
  readonly powerFloor?: number;
}): StratumReading {
  const { primary, alternative, byDifficulty } = input;
  const powerFloor = input.powerFloor ?? 10;
  const { minimum, maximum } = lowestAndHighest(primary);
  const gapPp = minimum === undefined || maximum === undefined ? null : (maximum.deltaPp as number) - (minimum.deltaPp as number);
  const gapMinDetectablePp =
    minimum === undefined || maximum === undefined
      ? null
      : Math.hypot(minimum.minDetectablePp as number, maximum.minDetectablePp as number);

  const criteria: StratumCriterion[] = [];

  criteria.push({
    code: 'S1',
    criterion: 'the minimum of the four buckets sits in a middle bucket, by at least 1pp',
    actual:
      minimum === undefined
        ? 'no bucket carries a delta'
        : `minimum ${fixed(minimum.deltaPp as number)} at bucket ${minimum.index}, maximum ${fixed(
            (maximum as Stratum).deltaPp as number,
          )} at bucket ${(maximum as Stratum).index}, gap ${fixed(gapPp as number)}`,
    ok: minimum !== undefined && isMiddle(minimum.index, primary) && Number.isFinite(gapPp as number) && (gapPp as number) >= 1,
  });

  const decided: { readonly difficulty: string; readonly index: number }[] = [];
  const undecided: string[] = [];
  for (const band of byDifficulty) {
    const powered = band.buckets.filter((bucket) => discordantOf(bucket) >= powerFloor && bucket.deltaPp !== null);
    if (powered.length === 0) {
      undecided.push(band.difficulty);
      continue;
    }
    const lowest = powered.reduce((left, right) => ((right.deltaPp as number) < (left.deltaPp as number) ? right : left));
    decided.push({ difficulty: band.difficulty, index: lowest.index });
  }
  const misplaced = decided.filter((entry) => !isMiddle(entry.index, primary));
  criteria.push({
    code: 'S2',
    criterion: `the minimum stays in a middle bucket within each difficulty band (floor ${powerFloor} discordant pairs)`,
    actual:
      decided.length === 0
        ? `no band carries ${powerFloor} discordant pairs in any bucket`
        : `${decided.map((entry) => `${entry.difficulty}: bucket ${entry.index}`).join(', ')}${
            undecided.length > 0 ? `; undecided: ${undecided.join(', ')}` : ''
          }`,
    ok: decided.length > 0 && misplaced.length === 0,
  });

  const thin = primary.filter((bucket) => bucket.n < 100 || discordantOf(bucket) < 10);
  criteria.push({
    code: 'S3',
    criterion: 'every bucket carries at least 100 questions and 10 discordant pairs',
    actual:
      thin.length === 0
        ? `all ${primary.length} buckets are populated`
        : thin.map((bucket) => `bucket ${bucket.index}: ${bucket.n} questions, ${discordantOf(bucket)} discordant`).join('; '),
    ok: thin.length === 0,
  });

  const primaryShape = shapeOf(primary);
  const alternativeShape = shapeOf(alternative);
  criteria.push({
    code: 'S4',
    criterion: 'the ordering of the buckets is unchanged under a character 4-gram tokenisation',
    actual: `${primaryShape.join(' < ')} under words; ${alternativeShape.join(' < ')} under 4-grams`,
    ok: primaryShape.length > 0 && primaryShape.join(',') === alternativeShape.join(','),
  });

  criteria.push({
    code: 'S5',
    criterion: 'the gap around the minimum exceeds its own minimum detectable difference',
    actual:
      gapPp === null || gapMinDetectablePp === null
        ? 'not estimable'
        : `gap ${fixed(gapPp)} against a minimum detectable ${fixed(gapMinDetectablePp)}`,
    ok:
      gapPp !== null &&
      gapMinDetectablePp !== null &&
      Number.isFinite(gapMinDetectablePp) &&
      gapPp > gapMinDetectablePp,
  });

  return {
    buckets: primary,
    minimum: minimum?.index ?? null,
    maximum: maximum?.index ?? null,
    gapPp,
    gapMinDetectablePp,
    criteria,
    // Exactly the condition the registration wrote down, and not a compound of the criteria: the
    // reading has to be able to say "refuted" while three other criteria pass, and "not refuted"
    // while they all fail.
    refuted: minimum !== undefined && !isMiddle(minimum.index, primary),
  };
}

/** Group cases by difficulty, so the control reuses the same bucketing as the headline reading. */
export function byDifficulty(
  cases: readonly StratumCase[],
  overlap: (entry: StratumCase) => number,
  edges: readonly number[] = STRATUM_EDGES,
): readonly DifficultyStrata[] {
  const names = [...new Set(cases.map((entry) => entry.difficulty))].sort();
  return names.map((difficulty) => ({
    difficulty,
    buckets: stratify(
      cases.filter((entry) => entry.difficulty === difficulty),
      overlap,
      edges,
    ),
  }));
}
