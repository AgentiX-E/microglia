/**
 * The stratification has one job: decide whether the four buckets are a shape or noise.
 *
 * Every test below is written against a hand-built table rather than against the committed
 * artefact, because a test that reads `poc-harm-strata.json` and asserts its own output has
 * checked that JSON.parse works. The committed artefact is held by the workflow, which recomputes
 * it from the run and compares the bytes.
 */
import { describe, expect, it } from 'vitest';
import {
  STRATUM_EDGES,
  byDifficulty,
  charGrams,
  characterOverlapOf,
  discordantOf,
  overlapOf,
  readStrata,
  stratify,
  type DifficultyStrata,
  type Stratum,
  type StratumCase,
} from '../strata.js';

const entry = (
  question: string,
  injected: readonly string[],
  correct: boolean,
  withoutMemoryCorrect: boolean,
  difficulty = 'simple',
): StratumCase => ({ question, injected, correct, withoutMemoryCorrect, difficulty });

/** A bucket built by hand, with the arithmetic the module would produce for it. */
const bucket = (index: number, n: number, helped: number, harmed: number): Stratum => {
  const discordant = helped + harmed;
  const se = (Math.sqrt(discordant) / n) * 100;
  return {
    index,
    lower: index / 10,
    upper: index === 3 ? null : (index + 1) / 10,
    n,
    helped,
    harmed,
    deltaPp: ((helped - harmed) / n) * 100,
    halfWidthPp: 1.96 * se,
    minDetectablePp: 2.802 * se,
  };
};

const empty = (index: number): Stratum => ({
  index,
  lower: index / 10,
  upper: index === 3 ? null : (index + 1) / 10,
  n: 0,
  helped: 0,
  harmed: 0,
  deltaPp: null,
  halfWidthPp: null,
  minDetectablePp: null,
});

const fixedOverlap = (value: number) => () => value;

describe('overlapOf', () => {
  it('takes the strongest match in the pack, not the average', () => {
    // A pack where one rule is about the question and two are about the database has the overlap
    // of the one, and averaging would report a third of it.
    // `queryCoverage` drops `how` and `in` as stopwords, so the question carries four content
    // terms: many, students, enrolled, 2019.
    const question = 'how many students enrolled in 2019';
    expect(overlapOf(question, ['enrolled students', 'a', 'b'])).toBeCloseTo(0.5, 5);
    expect(overlapOf(question, ['a', 'b', 'enrolled'])).toBeCloseTo(0.25, 5);
  });

  it('is zero for a question with no rule at all, rather than undefined', () => {
    // A lane that injected nothing is a measurement of zero overlap, and `Math.max` of nothing is
    // −Infinity, which would poison every comparison downstream.
    expect(overlapOf('how many students', [])).toBe(0);
  });

  it('is zero when the question carries no content term', () => {
    // `queryCoverage` returns 0 for an empty query set rather than dividing by zero; this pins
    // that the wrapper inherits the behaviour instead of re-deriving it.
    expect(overlapOf('the of and', ['students enrolled'])).toBe(0);
  });

  it('saturates at one when a rule repeats the question', () => {
    expect(overlapOf('students enrolled 2019', ['students enrolled 2019'])).toBe(1);
  });
});

describe('charGrams', () => {
  it('keeps a word shorter than the window whole', () => {
    // Dropping it would make a question of short words have no grams at all, and the stability
    // criterion would then compare two empty shapes and always agree with itself.
    expect([...charGrams('cat', 4)]).toEqual(['cat']);
  });

  it('emits every window of a longer word', () => {
    expect([...charGrams('abcde', 3)].sort()).toEqual(['abc', 'bcd', 'cde']);
  });

  it('splits on punctuation and skips the run between two separators', () => {
    expect([...charGrams('ab,  cd', 2)].sort()).toEqual(['ab', 'cd']);
  });

  it('case-folds and keeps letters outside ASCII, so a non-English corpus is not erased', () => {
    expect([...charGrams('ÉTÉ', 2)]).toEqual(['ét', 'té']);
  });
});

describe('characterOverlapOf', () => {
  it('measures the same quantity under the second tokenisation', () => {
    expect(characterOverlapOf('abcdefgh', ['abcdefgh'])).toBe(1);
    expect(characterOverlapOf('abcdefgh', ['zzzzzzzz'])).toBe(0);
  });

  it('takes the strongest match over the pack, as the word tokenisation does', () => {
    expect(characterOverlapOf('abcdefgh', ['zzzzzzzz', 'abcdefgh'])).toBe(1);
  });

  it('is zero when the question carries no gram', () => {
    expect(characterOverlapOf('   ', ['abcdefgh'])).toBe(0);
  });
});

describe('stratify', () => {
  it('puts a value exactly on an edge in the bucket above it', () => {
    // Half-open intervals, decided once: a question at exactly 0.2 is in [0.2, 0.4) and not in
    // both. Two buckets that both claim it would double-count the corpus.
    const edges = STRATUM_EDGES;
    const cases = [0, 0.2, 0.4, 0.6, 0.99].map((value) =>
      entry('q', [], true, false),
    );
    const overlaps = [0, 0.2, 0.4, 0.6, 0.99];
    const buckets = stratify(cases, (item) => overlaps[cases.indexOf(item)] as number, edges);
    expect(buckets.map((item) => item.n)).toEqual([1, 1, 1, 2]);
  });

  it('counts only the discordant pairs and leaves the concordant ones out of the width', () => {
    const cases = [
      entry('q', [], true, false),
      entry('q', [], false, true),
      entry('q', [], true, true),
      entry('q', [], false, false),
    ];
    const [first] = stratify(cases, fixedOverlap(0.1));
    expect(first?.helped).toBe(1);
    expect(first?.harmed).toBe(1);
    expect(first?.deltaPp).toBe(0);
    // Two discordant pairs out of four: SE = sqrt(2)/4, which is what the width must reflect. A
    // width computed over all four would understate it by a factor of √2.
    expect(first?.halfWidthPp).toBeCloseTo(1.96 * (Math.sqrt(2) / 4) * 100, 10);
    expect(first?.minDetectablePp).toBeCloseTo(2.802 * (Math.sqrt(2) / 4) * 100, 10);
  });

  it('reports an empty bucket as absent rather than as a measured zero', () => {
    const buckets = stratify([entry('q', [], true, false)], fixedOverlap(0.1));
    expect(buckets[1]?.n).toBe(0);
    expect(buckets[1]?.deltaPp).toBeNull();
    expect(buckets[1]?.halfWidthPp).toBeNull();
    expect(buckets[1]?.minDetectablePp).toBeNull();
  });

  it('reports a bucket where nothing changed hands as unresolvable, not as exactly known', () => {
    // Every question right on both arms: the delta is 0 and the half-width is 0, which is true of
    // the sample and false of the design. The minimum detectable difference is where that shows,
    // and it is infinite because `detectableDelta` says so for a discordance of zero.
    const [first] = stratify([entry('q', [], true, true)], fixedOverlap(0.1));
    expect(first?.deltaPp).toBe(0);
    expect(first?.minDetectablePp).toBe(Number.POSITIVE_INFINITY);
  });

  it('honours a different edge set, so the bucketing is data rather than a constant', () => {
    const buckets = stratify([entry('q', [], true, false)], fixedOverlap(0.75), [0.5]);
    expect(buckets.map((item) => item.n)).toEqual([0, 1]);
    expect(buckets[1]?.upper).toBeNull();
  });

  it('gives the last bucket a null upper edge rather than a sentinel number', () => {
    // A sentinel of 1.01 would exclude the only value that can reach 1 exactly, which is a rule
    // that repeats its question word for word.
    const buckets = stratify([entry('q', [], true, false)], fixedOverlap(1));
    expect(buckets[3]?.upper).toBeNull();
    expect(buckets[3]?.n).toBe(1);
  });
});

describe('discordantOf', () => {
  it('is the pairs that changed hands', () => {
    expect(discordantOf(bucket(0, 100, 7, 5))).toBe(12);
  });
});

describe('byDifficulty', () => {
  it('groups by the band and sorts the bands, so the artefact is deterministic', () => {
    const cases = [
      entry('q', [], true, false, 'moderate'),
      entry('q', [], true, false, 'simple'),
      entry('q', [], true, false, 'simple'),
    ];
    const bands = byDifficulty(cases, fixedOverlap(0.1));
    expect(bands.map((band) => band.difficulty)).toEqual(['moderate', 'simple']);
    expect(bands.map((band) => band.buckets[0]?.n)).toEqual([1, 2]);
  });
});

describe('readStrata', () => {
  const bands = (...items: DifficultyStrata[]): readonly DifficultyStrata[] => items;
  const band = (difficulty: string, ...buckets: Stratum[]): DifficultyStrata => ({ difficulty, buckets });

  it('confirms the shape when the middle is the minimum by more than a point', () => {
    const primary = [bucket(0, 400, 20, 20), bucket(1, 400, 10, 40), bucket(2, 400, 20, 20), bucket(3, 400, 20, 20)];
    const reading = readStrata({
      primary,
      alternative: primary,
      byDifficulty: bands(band('simple', ...primary)),
    });
    expect(reading.minimum).toBe(1);
    expect(reading.maximum).toBe(0);
    expect(reading.criteria.find((item) => item.code === 'S1')?.ok).toBe(true);
    expect(reading.refuted).toBe(false);
  });

  it('refutes when the minimum sits at an end bucket, and says which end', () => {
    const primary = [bucket(0, 400, 10, 40), bucket(1, 400, 20, 20), bucket(2, 400, 20, 20), bucket(3, 400, 20, 20)];
    const reading = readStrata({ primary, alternative: primary, byDifficulty: bands(band('simple', ...primary)) });
    expect(reading.refuted).toBe(true);
    expect(reading.criteria.find((item) => item.code === 'S1')?.actual).toContain('bucket 0');
  });

  it('fails S1 without refuting when the middle is lowest but by under a point', () => {
    // The distinction the reading exists to keep: "the predicted shape is there and too small to
    // matter" is a different statement from "the shape is the opposite of the one predicted".
    const primary = [bucket(0, 400, 20, 20), bucket(1, 400, 19, 21), bucket(2, 400, 20, 20), bucket(3, 400, 20, 20)];
    const reading = readStrata({ primary, alternative: primary, byDifficulty: bands(band('simple', ...primary)) });
    expect(reading.criteria.find((item) => item.code === 'S1')?.ok).toBe(false);
    expect(reading.refuted).toBe(false);
  });

  it('reports that no bucket carries a delta rather than inventing a minimum of zero', () => {
    const primary = [empty(0), empty(1), empty(2), empty(3)];
    const reading = readStrata({ primary, alternative: primary, byDifficulty: bands(band('simple', ...primary)) });
    expect(reading.minimum).toBeNull();
    expect(reading.gapPp).toBeNull();
    expect(reading.gapMinDetectablePp).toBeNull();
    expect(reading.criteria.find((item) => item.code === 'S1')?.actual).toBe('no bucket carries a delta');
    expect(reading.criteria.find((item) => item.code === 'S5')?.actual).toBe('not estimable');
    expect(reading.refuted).toBe(false);
  });

  it('breaks a tie at the lowest index, so two runs of the same table agree', () => {
    const primary = [bucket(0, 400, 20, 20), bucket(1, 400, 20, 20), bucket(2, 400, 20, 20), bucket(3, 400, 20, 20)];
    const reading = readStrata({ primary, alternative: primary, byDifficulty: bands(band('simple', ...primary)) });
    expect(reading.minimum).toBe(0);
  });

  it('decides S2 only on bands that carry enough discordant pairs', () => {
    // The registered wording let a three-question cell decide the control. With the floor, a band
    // whose every bucket is thin is undecided, and the reading says so instead of counting it as
    // agreement.
    const good = [bucket(0, 400, 20, 20), bucket(1, 400, 10, 40), bucket(2, 400, 20, 20), bucket(3, 400, 20, 20)];
    const thin = [bucket(0, 3, 1, 0), bucket(1, 3, 0, 3), bucket(2, 3, 0, 0), bucket(3, 3, 0, 0)];
    const reading = readStrata({
      primary: good,
      alternative: good,
      byDifficulty: bands(band('simple', ...good), band('challenging', ...thin)),
    });
    const s2 = reading.criteria.find((item) => item.code === 'S2');
    expect(s2?.ok).toBe(true);
    expect(s2?.actual).toContain('undecided: challenging');
  });

  it('says when no band carries enough discordant pairs to decide S2 at all', () => {
    const thin = [bucket(0, 3, 1, 0), bucket(1, 3, 0, 0), bucket(2, 3, 0, 0), bucket(3, 3, 0, 0)];
    const primary = [bucket(0, 400, 20, 20), bucket(1, 400, 20, 20), bucket(2, 400, 20, 20), bucket(3, 400, 20, 20)];
    const reading = readStrata({ primary, alternative: primary, byDifficulty: bands(band('simple', ...thin)) });
    const s2 = reading.criteria.find((item) => item.code === 'S2');
    expect(s2?.ok).toBe(false);
    expect(s2?.actual).toContain('no band carries 10 discordant pairs');
  });

  it('fails S2 when a decided band puts its minimum at an end bucket', () => {
    const mixed = [bucket(0, 400, 10, 40), bucket(1, 400, 20, 20), bucket(2, 400, 20, 20), bucket(3, 400, 20, 20)];
    const primary = [bucket(0, 400, 20, 20), bucket(1, 400, 10, 40), bucket(2, 400, 20, 20), bucket(3, 400, 20, 20)];
    const reading = readStrata({ primary, alternative: primary, byDifficulty: bands(band('moderate', ...mixed)) });
    const s2 = reading.criteria.find((item) => item.code === 'S2');
    expect(s2?.ok).toBe(false);
    expect(s2?.actual).toContain('moderate: bucket 0');
  });

  it('fails S3 and names the thin bucket rather than reporting a count', () => {
    const primary = [bucket(0, 400, 20, 20), bucket(1, 400, 20, 20), bucket(2, 400, 20, 20), bucket(3, 18, 1, 3)];
    const reading = readStrata({ primary, alternative: primary, byDifficulty: bands() });
    const s3 = reading.criteria.find((item) => item.code === 'S3');
    expect(s3?.ok).toBe(false);
    expect(s3?.actual).toBe('bucket 3: 18 questions, 4 discordant');
  });

  it('passes S3 when every bucket is populated', () => {
    const primary = [bucket(0, 400, 20, 20), bucket(1, 400, 20, 20), bucket(2, 400, 20, 20), bucket(3, 400, 20, 20)];
    const reading = readStrata({ primary, alternative: primary, byDifficulty: bands() });
    expect(reading.criteria.find((item) => item.code === 'S3')?.actual).toBe('all 4 buckets are populated');
  });

  it('passes S4 only when the ordering survives the second tokenisation', () => {
    const primary = [bucket(0, 400, 20, 20), bucket(1, 400, 10, 40), bucket(2, 400, 20, 20), bucket(3, 400, 20, 20)];
    const same = readStrata({ primary, alternative: primary, byDifficulty: bands() });
    expect(same.criteria.find((item) => item.code === 'S4')?.ok).toBe(true);

    const moved = [bucket(0, 400, 10, 40), bucket(1, 400, 20, 20), bucket(2, 400, 20, 20), bucket(3, 400, 20, 20)];
    const differs = readStrata({ primary, alternative: moved, byDifficulty: bands() });
    const s4 = differs.criteria.find((item) => item.code === 'S4');
    expect(s4?.ok).toBe(false);
    expect(s4?.actual).toBe('1 < 0 < 2 < 3 under words; 0 < 1 < 2 < 3 under 4-grams');
  });

  it('fails S4 when the alternative tokenisation produces no shape at all', () => {
    const primary = [bucket(0, 400, 20, 20), bucket(1, 400, 20, 20), bucket(2, 400, 20, 20), bucket(3, 400, 20, 20)];
    const reading = readStrata({ primary, alternative: [empty(0), empty(1), empty(2), empty(3)], byDifficulty: bands() });
    expect(reading.criteria.find((item) => item.code === 'S4')?.ok).toBe(false);
  });

  it('passes S5 only when the gap beats its own resolution', () => {
    const wide = [bucket(0, 400, 40, 0), bucket(1, 400, 0, 40), bucket(2, 400, 20, 20), bucket(3, 400, 20, 20)];
    const wideReading = readStrata({ primary: wide, alternative: wide, byDifficulty: bands() });
    expect(wideReading.criteria.find((item) => item.code === 'S5')?.ok).toBe(true);

    const narrow = [bucket(0, 400, 21, 20), bucket(1, 400, 20, 21), bucket(2, 400, 20, 20), bucket(3, 400, 20, 20)];
    const narrowReading = readStrata({ primary: narrow, alternative: narrow, byDifficulty: bands() });
    expect(narrowReading.criteria.find((item) => item.code === 'S5')?.ok).toBe(false);
  });

  it('refuses to call an infinite resolution a pass', () => {
    // A bucket where nothing changed hands has an infinite minimum detectable difference, and
    // `gap > Infinity` is false for every gap — but only because the comparison is against a
    // number, and a NaN on either side would have made it false for the wrong reason.
    const flat: Stratum = {
      index: 0,
      lower: 0,
      upper: 0.2,
      n: 400,
      helped: 0,
      harmed: 0,
      deltaPp: 0,
      halfWidthPp: 0,
      minDetectablePp: Number.POSITIVE_INFINITY,
    };
    const primary = [flat, bucket(1, 400, 20, 20), bucket(2, 400, 20, 20), bucket(3, 400, 20, 20)];
    const reading = readStrata({ primary, alternative: primary, byDifficulty: bands() });
    const s5 = reading.criteria.find((item) => item.code === 'S5');
    expect(s5?.ok).toBe(false);
    expect(s5?.actual).toContain('not estimable');
  });

  it('prints every criterion, so a report cannot quote a subset', () => {
    const primary = [bucket(0, 400, 20, 20), bucket(1, 400, 20, 20), bucket(2, 400, 20, 20), bucket(3, 400, 20, 20)];
    const reading = readStrata({ primary, alternative: primary, byDifficulty: bands() });
    expect(reading.criteria.map((item) => item.code)).toEqual(['S1', 'S2', 'S3', 'S4', 'S5']);
  });

  it('takes the power floor as an input, so the artefact states the one it used', () => {
    const thin = [bucket(0, 400, 5, 0), bucket(1, 400, 0, 5), bucket(2, 400, 0, 0), bucket(3, 400, 0, 0)];
    const primary = [bucket(0, 400, 20, 20), bucket(1, 400, 20, 20), bucket(2, 400, 20, 20), bucket(3, 400, 20, 20)];
    const strict = readStrata({ primary, alternative: primary, byDifficulty: bands(band('simple', ...thin)), powerFloor: 12 });
    expect(strict.criteria.find((item) => item.code === 'S2')?.ok).toBe(false);
    const loose = readStrata({ primary, alternative: primary, byDifficulty: bands(band('simple', ...thin)), powerFloor: 4 });
    expect(loose.criteria.find((item) => item.code === 'S2')?.actual).toContain('simple: bucket 1');
  });
});
