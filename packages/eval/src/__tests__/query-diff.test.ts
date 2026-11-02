/**
 * The reading layer's own tests.
 *
 * Every number in R30's artefact is produced by the functions below, so the tests are written
 * against the shapes that decide a verdict rather than against round numbers: an empty group, a
 * group where nothing was ever correct to begin with, a corpus whose discordant cases all have an
 * imported name, and a gate with nothing to discard. Those are the inputs that turn a criterion into
 * a `null`, and a `null` that reads as zero is how a measurement becomes a claim.
 */
import { describe, expect, it } from 'vitest';
import {
  cellOf,
  clusteredGap,
  clusteredGapOf,
  discardSetOf,
  featureOf,
  fisherExact,
  gateReadingOf,
  improvementOf,
  readQueryDiff,
  readingOf,
  type DiffCase,
  type FeatureReading,
  type GateReading,
  type KindReading,
} from '../query-diff.js';
import { diffQueries } from '@agentix-e/microglia-sql';

/** A case whose two queries were given, scored as asked. */
function makeCase(
  id: string,
  dbId: string,
  baselineSql: string,
  predictedSql: string,
  correct: boolean,
  withoutMemoryCorrect: boolean,
  question = 'how many a b c',
): DiffCase {
  return {
    id,
    dbId,
    delta: diffQueries(baselineSql, predictedSql, question, null),
    correct,
    withoutMemoryCorrect,
  };
}

/** A clean pair: the pack changed nothing. */
const still = (id: string, correct: boolean, baseline: boolean, dbId = 'db'): DiffCase =>
  makeCase(id, dbId, 'SELECT a FROM t', 'SELECT a FROM t', correct, baseline);

/** An importing pair: the memory query names a table the question does not. */
const importing = (id: string, correct: boolean, baseline: boolean, dbId = 'db'): DiffCase =>
  makeCase(id, dbId, 'SELECT a FROM t', 'SELECT a FROM t JOIN zzz ON t.a = zzz.a', correct, baseline);

describe('cellOf', () => {
  it('reports an empty group as unmeasured rather than as zero', () => {
    const cell = cellOf([]);
    expect(cell.n).toBe(0);
    expect(cell.deltaPp).toBeNull();
    expect(cell.halfWidthPp).toBeNull();
    expect(cell.minDetectablePp).toBeNull();
    expect(cell.harmedPerCorrectPp).toBeNull();
    expect(cell.helpedPerWrongPp).toBeNull();
    expect(cell.clusterLowPp).toBeNull();
    expect(cell.clusterHighPp).toBeNull();
  });

  it('counts helped and harmed in the paired direction', () => {
    const cell = cellOf([still('1', true, false), still('2', false, true), still('3', true, true)]);
    expect(cell.n).toBe(3);
    expect(cell.helped).toBe(1);
    expect(cell.harmed).toBe(1);
    expect(cell.deltaPp).toBe(0);
    expect(cell.baselineCorrect).toBe(2);
    expect(cell.baselineAccuracy).toBeCloseTo(2 / 3, 10);
    expect(cell.harmedPerCorrectPp).toBeCloseTo(50, 10);
    expect(cell.helpedPerWrongPp).toBeCloseTo(100, 10);
  });

  it('leaves the damage rate unmeasured when the arm was never correct', () => {
    const cell = cellOf([still('1', true, false), still('2', false, false)]);
    expect(cell.harmedPerCorrectPp).toBeNull();
    expect(cell.helpedPerWrongPp).toBeCloseTo(50, 10);
  });

  it('leaves the repair rate unmeasured when the arm was always correct', () => {
    const cell = cellOf([still('1', true, true), still('2', false, true)]);
    expect(cell.helpedPerWrongPp).toBeNull();
    expect(cell.harmedPerCorrectPp).toBeCloseTo(50, 10);
  });

  it('carries a clustered interval that contains the point estimate', () => {
    const cases = [
      still('1', true, false, 'a'),
      still('2', false, true, 'b'),
      still('3', true, true, 'c'),
      still('4', false, false, 'd'),
    ];
    const cell = cellOf(cases);
    expect(cell.clusterLowPp).not.toBeNull();
    expect(cell.clusterHighPp).not.toBeNull();
    expect(cell.clusterLowPp as number).toBeLessThanOrEqual(cell.deltaPp as number);
    expect(cell.clusterHighPp as number).toBeGreaterThanOrEqual(cell.deltaPp as number);
  });
});

describe('fisherExact', () => {
  it('reproduces the tea-tasting table', () => {
    expect(fisherExact(3, 1, 1, 3)).toBeCloseTo(0.4857, 3);
  });

  it('reports certainty for an empty table and a large p for a balanced one', () => {
    expect(fisherExact(0, 0, 0, 0)).toBe(1);
    expect(fisherExact(10, 10, 10, 10)).toBeCloseTo(1, 6);
  });

  it('gives a small p-value for a table that is extreme in both rows', () => {
    expect(fisherExact(0, 20, 20, 0)).toBeLessThan(1e-6);
  });
});

describe('featureOf', () => {
  it('splits the corpus and reports the gap with its own width', () => {
    const cases = [
      importing('1', false, true),
      importing('2', false, true),
      importing('3', false, true),
      still('4', true, false),
      still('5', true, false),
      still('6', true, false),
    ];
    const feature = featureOf('F1', 'imports a name', cases, (delta) => delta.ungrounded.length > 0, 200);
    expect(feature.present.n).toBe(3);
    expect(feature.absent.n).toBe(3);
    expect(feature.present.deltaPp).toBe(-100);
    expect(feature.absent.deltaPp).toBeCloseTo(100, 6);
    expect(feature.gapPp).toBeCloseTo(-200, 6);
    expect(feature.resolves).toBe(true);
    expect(feature.fisherP).toBeLessThan(0.1);
  });

  it('refuses to state a gap when one side is empty', () => {
    const feature = featureOf('F1', 'always', [still('1', true, false)], () => true, 100);
    expect(feature.present.n).toBe(1);
    expect(feature.absent.n).toBe(0);
    expect(feature.gapPp).toBeNull();
    expect(feature.gapHalfWidthPp).toBeNull();
    expect(feature.clusterLowPp).toBeNull();
    expect(feature.resolves).toBe(false);
  });

  it('does not call a gap that sits inside its own width a separation', () => {
    const cases = [
      importing('1', false, true),
      still('2', true, false),
      still('3', false, true),
      still('4', true, false),
    ];
    const feature = featureOf('F1', 'imports a name', cases, (delta) => delta.ungrounded.length > 0, 200);
    expect(feature.resolves).toBe(false);
  });
});

describe('gateReadingOf', () => {
  it('falls back to the no-memory outcome for every discarded question', () => {
    const cases = [
      importing('1', false, true),
      importing('2', true, false),
      still('3', true, false),
      still('4', false, true),
    ];
    const gate = gateReadingOf(cases, 'strict', 200);
    expect(gate.discarded).toBe(2);
    expect(gate.discardedShare).toBeCloseTo(0.5, 10);
    // Both imported questions fall back to their no-memory outcome, so the gated arm agrees with
    // the baseline on them and the paired delta comes entirely from the two untouched questions.
    expect(gate.gated.helped).toBe(1);
    expect(gate.gated.harmed).toBe(1);
    expect(gate.measured.helped).toBe(2);
    expect(gate.measured.harmed).toBe(2);
    expect(gate.improvementPp).toBeCloseTo(0, 10);
  });

  it('reports an unmeasured improvement when there is nothing to measure', () => {
    const gate = gateReadingOf([], 'strict', 100);
    expect(gate.discarded).toBe(0);
    expect(gate.discardedShare).toBe(0);
    expect(gate.gated.deltaPp).toBeNull();
    expect(gate.improvementPp).toBeNull();
    expect(gate.significant95).toBe(false);
    expect(gate.resolvable).toBe(false);
  });

  it('discards less under the looser rule than under the strict one', () => {
    const cases = [
      makeCase('1', 'db', 'SELECT a FROM t', 'SELECT a FROM t JOIN races r ON t.a = r.raceid', false, true, 'race 903'),
      still('2', true, false),
    ];
    expect(gateReadingOf(cases, 'strict', 100).discarded).toBe(1);
    expect(gateReadingOf(cases, 'morphological', 100).discarded).toBe(0);
  });
});

describe('clusteredGap', () => {
  it('returns nothing when one side of the split is empty', () => {
    expect(clusteredGap([still('1', true, false)], () => true, 100)).toBeNull();
  });

  it('treats a single-cluster group as a point rather than as a distribution', () => {
    const cases = [
      importing('1', false, true, 'a'),
      importing('2', false, true, 'a'),
      still('3', true, false, 'b'),
      still('4', true, false, 'b'),
    ];
    const gap = clusteredGap(cases, (delta) => delta.ungrounded.length > 0, 200);
    expect(gap).not.toBeNull();
    expect(gap?.lowPp).toBeCloseTo(-200, 6);
    expect(gap?.highPp).toBeCloseTo(-200, 6);
  });
});

describe('readQueryDiff', () => {
  /**
   * A corpus with the shape the registration predicts, at a size that can resolve it.
   *
   * Twenty questions where the pack imports a name and destroys a correct query; twenty it repairs;
   * twenty it leaves alone. The small hand-written case lists elsewhere in this file are for the
   * `null` arms; the verdict needs enough discordant pairs for a gap to exceed its own width, which
   * is the whole point of the criterion.
   */
  const corpus = (): DiffCase[] => [
    ...Array.from({ length: 20 }, (_, at) => importing(`i${at}`, false, true)),
    ...Array.from({ length: 20 }, (_, at) => still(`s${at}`, true, false)),
    ...Array.from({ length: 20 }, (_, at) => still(`k${at}`, true, true)),
  ];
  const cases: DiffCase[] = corpus();
  const features: FeatureReading[] = [
    featureOf('F1', 'imports', cases, (delta) => delta.ungrounded.length > 0, 200),
    featureOf('F2', 'imports loosely', cases, (delta) => delta.ungroundedLoose.length > 0, 200),
  ];
  const gates: GateReading[] = [gateReadingOf(cases, 'strict', 200)];
  const kinds: KindReading[] = [];
  const discordant = {
    total: 5,
    importing: 3,
    unexplained: 2,
    unexplainedShare: 0.4,
    largestBucket: 'imported-name',
    largestCount: 3,
  };

  it('confirms every criterion when the covariate separates and the gate pays', () => {
    const reading = readQueryDiff({ cases, kinds, features, discordant: { ...discordant, unexplainedShare: 0.9, largestBucket: 'unexplained' }, gates });
    expect(reading.criteria.map((entry) => entry.ok)).toEqual([true, true, true, true, true]);
    expect(reading.confirmed).toEqual(['Q1', 'Q2', 'Q3', 'Q4', 'Q5']);
    expect(reading.refuted).toBe(false);
  });

  it('refutes the registration when the covariate does not separate', () => {
    const flat = [still('1', true, false), still('2', false, true)];
    const reading = readQueryDiff({
      cases: flat,
      kinds,
      features: [featureOf('F1', 'imports', flat, (delta) => delta.ungrounded.length > 0, 100)],
      discordant: { total: 2, importing: 0, unexplained: 2, unexplainedShare: 1, largestBucket: 'unexplained', largestCount: 2 },
      gates: [gateReadingOf(flat, 'strict', 100)],
    });
    expect(reading.refuted).toBe(true);
    expect(reading.criteria.find((entry) => entry.code === 'Q1')?.ok).toBe(false);
  });

  it('fails Q2 when the largest discordant bucket is not the unexplained one', () => {
    const reading = readQueryDiff({ cases, kinds, features, discordant, gates });
    const q2 = reading.criteria.find((entry) => entry.code === 'Q2');
    expect(q2?.ok).toBe(false);
    expect(q2?.actual).toContain('imported-name');
  });

  it('states the absence of a primary feature rather than inventing a verdict', () => {
    const reading = readQueryDiff({
      cases: [],
      kinds: [],
      features: [],
      discordant: { total: 0, importing: 0, unexplained: 0, unexplainedShare: 0, largestBucket: 'unexplained', largestCount: 0 },
      gates: [],
    });
    const byCode = new Map(reading.criteria.map((entry) => [entry.code, entry]));
    expect(byCode.get('Q1')?.actual).toBe('no primary feature');
    expect(byCode.get('Q3')?.actual).toBe('no secondary feature');
    expect(byCode.get('Q5')?.actual).toBe('no gate reading');
    expect(byCode.get('Q4')?.actual).toBe('a group has no correct baseline query');
    expect(reading.confirmed).toEqual([]);
    expect(reading.refuted).toBe(true);
  });

  it('prints an absent gap as n/a rather than skipping the criterion', () => {
    const reading = readQueryDiff({
      cases,
      kinds,
      features: [
        featureOf('F1', 'imports', cases, (delta) => delta.ungrounded.length > 0, 200),
        // A secondary feature that holds for every case has no comparison group, so its gap is
        // unmeasured and Q3 has to say so instead of reporting a zero.
        featureOf('F2', 'always', cases, () => true, 200),
      ],
      discordant,
      gates,
    });
    expect(reading.criteria.find((entry) => entry.code === 'Q3')?.actual).toContain('n/a');
  });

  it('reports a gate with nothing to discard as no improvement', () => {
    const clean = [still('1', true, false), still('2', false, true)];
    const reading = readQueryDiff({
      cases: clean,
      kinds,
      features: [featureOf('F1', 'imports', clean, (delta) => delta.ungrounded.length > 0, 100)],
      discordant: { total: 2, importing: 0, unexplained: 2, unexplainedShare: 1, largestBucket: 'unexplained', largestCount: 2 },
      gates: [gateReadingOf(clean, 'strict', 100)],
    });
    expect(reading.criteria.find((entry) => entry.code === 'Q5')?.ok).toBe(false);
  });
});

/**
 * The three helpers the R31 readings are built on.
 *
 * They exist so that a grouping which is *not* a function of the query diff — the pack's text — can
 * reuse the same arithmetic. The tests therefore compare each one against the predicate-shaped
 * function it was extracted from: two implementations of a gap are two answers to one question, and
 * the only way to know they agree is to assert it on a corpus where the answer is not zero.
 */
describe('readingOf', () => {
  it('produces the same reading as featureOf for the split it was handed', () => {
    const cases = [
      importing('1', false, true, 'a'),
      importing('2', false, true, 'a'),
      importing('3', true, true, 'b'),
      still('4', true, true, 'b'),
      still('5', false, false, 'c'),
    ];
    const predicate = (delta: { ungrounded: readonly string[] }): boolean => delta.ungrounded.length > 0;
    const viaPredicate = featureOf('F1', 'imports', cases, predicate, 200);
    const viaGroups = readingOf('F1', 'imports', cases.filter((c) => predicate(c.delta)), cases.filter((c) => !predicate(c.delta)), 200);
    expect(viaGroups).toEqual(viaPredicate);
  });

  it('reports no gap when one of the two groups is empty', () => {
    const cases = [still('1', true, false)];
    const reading = readingOf('X', 'empty side', cases, [], 100);
    expect(reading.present.n).toBe(1);
    expect(reading.absent.n).toBe(0);
    expect(reading.gapPp).toBeNull();
    expect(reading.gapHalfWidthPp).toBeNull();
    expect(reading.clusterLowPp).toBeNull();
    expect(reading.resolves).toBe(false);
  });

  it('still reports an exact test when the gap itself is unmeasurable', () => {
    // Fisher's test reads a 2×2 table of discordant counts, and an empty comparison group makes it
    // 2×0 — a table with a zero column, whose p-value is 1 rather than undefined.
    const reading = readingOf('X', 'one side', [importing('1', false, true)], [], 100);
    expect(reading.fisherP).toBe(1);
  });
});

describe('clusteredGapOf', () => {
  it('agrees with the predicate form on the same split', () => {
    const cases = [
      importing('1', false, true, 'a'),
      importing('2', false, true, 'b'),
      still('3', true, false, 'a'),
      still('4', true, false, 'b'),
    ];
    const predicate = (delta: { ungrounded: readonly string[] }): boolean => delta.ungrounded.length > 0;
    expect(clusteredGapOf(cases.filter((c) => predicate(c.delta)), cases.filter((c) => !predicate(c.delta)), 200)).toEqual(
      clusteredGap(cases, predicate, 200),
    );
  });

  it('returns nothing when either side is empty', () => {
    expect(clusteredGapOf([], [still('1', true, false)], 100)).toBeNull();
    expect(clusteredGapOf([still('1', true, false)], [], 100)).toBeNull();
  });
});

describe('discardSetOf and improvementOf', () => {
  const corpus = [
    importing('1', false, true, 'a'),
    importing('2', false, true, 'a'),
    importing('3', true, true, 'b'),
    still('4', true, false, 'b'),
  ];

  it('selects by the grounding rule the gate would use', () => {
    expect([...discardSetOf(corpus, 'strict')].sort()).toEqual(['1', '2', '3']);
    expect([...discardSetOf(corpus)].sort()).toEqual(['1', '2', '3']);
  });

  it('is worth the negative of the discarded signed outcomes over n', () => {
    // Cases 1 and 2 are correct queries the pack destroyed — signed −1 each — and case 3 is a
    // correct query the pack left correct, which is signed 0. Discarding all three gives back the
    // two points over a corpus of four: +50pp, the direction a filter is paid for.
    expect(improvementOf(corpus, new Set(['1', '2', '3']))).toBeCloseTo(50, 10);
    expect(improvementOf(corpus, new Set())).toBeCloseTo(0, 10);
    // A gate that discards only the question the pack left alone buys nothing at all.
    expect(improvementOf(corpus, new Set(['3']))).toBeCloseTo(0, 10);
  });

  it('agrees with the full reading it is an identity of', () => {
    for (const mode of ['strict', 'morphological'] as const) {
      const gate = gateReadingOf(corpus, mode, 200);
      const set = discardSetOf(corpus, mode);
      expect(gate.improvementPp).toBeCloseTo(improvementOf(corpus, set), 10);
    }
  });

  it('reports an empty corpus as no improvement rather than as a division by zero', () => {
    // Zero rather than `null`: there is no denominator, so there is nothing a gate could be worth,
    // and `gateReadingOf` is what turns this into `improvementPp: null` for an empty corpus.
    expect(improvementOf([], new Set(['anything']))).toBe(0);
    expect(improvementOf([], new Set())).toBe(0);
  });
});
