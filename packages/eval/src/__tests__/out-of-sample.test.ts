/**
 * Whether the out-of-sample verdict is arithmetic or assertion.
 *
 * Three things are tested here and each is tested against a corpus built to make it fail: a
 * clustered interval that must widen when one database carries the effect, a fold sign test whose
 * exact p-value is known by hand, and the five registrations, each run against a reading that
 * satisfies it and one that does not. A registration that cannot fail is not a test of anything.
 */
import { describe, expect, it } from 'vitest';
import {
  OUT_OF_SAMPLE_PREDICTIONS,
  adjudicateOutOfSample,
  clusteredDeltaOf,
  foldSignTestOf,
  memoryDiscordanceOf,
  outOfSampleReadingOf,
  powerVerdictOf,
  sideBySideOf,
  type ClusteredDelta,
  type OutOfSampleReading,
} from '../out-of-sample.js';
import { gateReadingOf } from '../query-diff.js';
import { diffQueries } from '@agentix-e/microglia-sql';
import type { DiffCase } from '../query-diff.js';

/** A case the pack left alone, which the imported-name feature must not claim. */
function clean(id: string, dbId: string, correct: boolean, baselineOk: boolean): DiffCase {
  return {
    id,
    dbId,
    delta: diffQueries('SELECT count(*) FROM race', 'SELECT count(*) FROM race', 'how many races', null),
    correct,
    withoutMemoryCorrect: baselineOk,
  };
}

/** A case whose memory query imports a table the question never names. */
function importing(id: string, dbId: string, correct: boolean, baselineOk: boolean): DiffCase {
  return {
    id,
    dbId,
    delta: diffQueries('SELECT count(*) FROM race', 'SELECT count(*) FROM rival', 'how many races', null),
    correct,
    withoutMemoryCorrect: baselineOk,
  };
}

describe('clusteredDeltaOf', () => {
  it('computes the point estimate over questions and the interval over databases', () => {
    // Four questions, two databases, one help and one harm: the point estimate is zero and the
    // interval has to straddle it.
    const cases = [
      clean('a', 'one', true, false),
      clean('b', 'one', false, true),
      clean('c', 'two', true, false),
      clean('d', 'two', false, true),
    ];
    const read = clusteredDeltaOf(cases, { resamples: 2_000 });
    expect(read.questions).toBe(4);
    expect(read.clusters).toBe(2);
    expect(read.pointPp).toBeCloseTo(0, 8);
    expect(read.resolved).toBe(false);
  });

  it('widens when one database carries the whole effect', () => {
    // `big` holds nine questions that all improve; `small` holds one that does not. A question-level
    // bootstrap would call that resolved. Resampling databases has to keep the possibility that the
    // draw is mostly `small`.
    const cases = [
      ...Array.from({ length: 9 }, (_, at) => clean(`big-${at}`, 'big', true, false)),
      clean('small', 'small', false, true),
    ];
    const read = clusteredDeltaOf(cases, { resamples: 5_000 });
    expect(read.pointPp).toBeCloseTo(80, 6);
    expect(read.clusters).toBe(2);
    // The cluster draw can select `small` twice, which puts the estimate at -100pp, so the lower
    // bound has to sit far below the point estimate.
    expect(read.lowPp as number).toBeLessThan(0);
  });

  it('refuses an interval for a single database rather than reporting zero width', () => {
    // Every draw of one cluster is the same cluster, so a bootstrap would return [x, x] and call
    // every effect resolved. The honest answer is that this corpus cannot say.
    const cases = [clean('a', 'only', true, false), clean('b', 'only', true, false)];
    const read = clusteredDeltaOf(cases);
    expect(read.clusters).toBe(1);
    expect(read.pointPp).toBeCloseTo(100, 6);
    expect(read.lowPp).toBeNull();
    expect(read.highPp).toBeNull();
    expect(read.resolved).toBe(false);
  });

  it('reports an empty corpus as unmeasured rather than as no effect', () => {
    const read = clusteredDeltaOf([]);
    expect(read.pointPp).toBeNull();
    expect(read.questions).toBe(0);
    expect(read.resolved).toBe(false);
  });

  it('reproduces itself across seeds, because the verdict may not depend on the draw', () => {
    const cases = Array.from({ length: 40 }, (_, at) =>
      clean(`q-${at}`, at % 4 === 0 ? 'big' : `db-${at % 4}`, at % 3 === 0, false),
    );
    const first = clusteredDeltaOf(cases, { resamples: 4_000, seed: 1 });
    const second = clusteredDeltaOf(cases, { resamples: 4_000, seed: 2 });
    expect(Math.abs((first.lowPp as number) - (second.lowPp as number))).toBeLessThan(1);
    expect(first.resolved).toBe(second.resolved);
  });
});

describe('foldSignTestOf', () => {
  it('counts five negatives and reports the exact two-sided p-value', () => {
    // 2 · P(X = 5 | n = 5) = 2/32 = 0.0625. This is the floor of the test: five folds cannot reach
    // 0.05 however unanimous they are, and the reading says so rather than rounding down.
    const test = foldSignTestOf([-1.21, -0.93, -0.5, -0.71, -0.21]);
    expect(test.negative).toBe(5);
    expect(test.positive).toBe(0);
    expect(test.p).toBeCloseTo(0.0625, 10);
  });

  it('gives a coin-flip p-value to a split vote', () => {
    expect(foldSignTestOf([-1, -1, 1, 1]).p).toBeCloseTo(1, 10);
    expect(foldSignTestOf([-1, -1, -1, 1]).p).toBeCloseTo(0.625, 10);
  });

  it('counts ties separately and decides over the folds that are not ties', () => {
    const test = foldSignTestOf([-1, -1, 0, 0]);
    expect(test.ties).toBe(2);
    expect(test.negative).toBe(2);
    expect(test.p).toBeCloseTo(0.5, 10);
  });

  it('reports no evidence rather than certainty when every fold is a tie', () => {
    // The alternative — returning 1 by accident of a zero-length loop, or 0 because nothing
    // disagreed — would both be read as a result.
    const test = foldSignTestOf([0, 0, 0]);
    expect(test.p).toBe(1);
    expect(foldSignTestOf([])).toEqual({ negative: 0, positive: 0, ties: 0, p: 1 });
  });
});

const MEASURED = { runsMeasured: true };

/** A reading that satisfies every registration, so each test can break exactly one. */
function satisfying(overrides: Partial<OutOfSampleReading> = {}): OutOfSampleReading {
  const cases = [
    importing('i1', 'db_a', false, true),
    importing('i2', 'db_b', false, true),
    clean('c1', 'db_a', true, true),
    clean('c2', 'db_b', true, true),
  ];
  return {
    deltaPp: -0.5,
    // P2 asks for a negative arm that the interval does not resolve, so the satisfying reading has
    // to be exactly that: an interval straddling zero.
    clustered: { questions: 4, clusters: 2, pointPp: -0.5, lowPp: -1.1, highPp: 0.1, resolved: false },
    folds: { negative: 4, positive: 1, ties: 0, p: 0.375 },
    gate: {
      mode: 'strict',
      discarded: 1,
      discardedShare: 0.25,
      gated: { n: 4, deltaPp: 0.6 } as never,
      measured: { n: 4 } as never,
      improvementPp: 0.6,
      p: 0.5,
      significant95: false,
      resolvable: false,
    },
    imported: {
      code: 'F1',
      feature: 'imported name',
      present: { n: 2, deltaPp: -6.5 } as never,
      absent: { n: 2, deltaPp: -0.2 } as never,
      gapPp: -6.3,
      gapHalfWidthPp: 3.9,
      fisherP: 0.01,
      clusterLowPp: -11,
      clusterHighPp: -1.9,
      resolves: true,
    },
    runsMeasured: true,
    measured: {
      n: 4,
      helped: 1,
      harmed: 0,
      deltaPp: -0.5,
      halfWidthPp: 0.6,
      minDetectablePp: 0.9,
      baselineCorrect: 2,
      baselineAccuracy: 0.5,
      harmedPerCorrectPp: 0,
      helpedPerWrongPp: 50,
      clusterLowPp: -1.1,
      clusterHighPp: 0.1,
    } as never,
    ...overrides,
  } as OutOfSampleReading;
}

describe('adjudicateOutOfSample', () => {
  it('holds every registration on a reading built to satisfy them', () => {
    const verdicts = adjudicateOutOfSample(satisfying());
    expect(verdicts.map((verdict) => verdict.id)).toEqual(['P1', 'P2', 'P3', 'P4', 'P5']);
    expect(verdicts.every((verdict) => verdict.holds)).toBe(true);
  });

  it('refutes P2 when the arm is negative and the interval excludes zero', () => {
    // P2's second clause is "not significantly different from the none arm". A resolved negative
    // gap breaks it, and the registration said so before the number existed — which is the only
    // reason the result counts as a result rather than as a reinterpretation.
    const reading = satisfying({
      deltaPp: -0.71,
      clustered: { questions: 7000, clusters: 58, pointPp: -0.71, lowPp: -1.27, highPp: -0.18, resolved: true },
    });
    const p2 = adjudicateOutOfSample(reading).find((verdict) => verdict.id === 'P2');
    expect(p2?.holds).toBe(false);
    expect(p2?.observed).toContain('-0.71pp');
  });

  it('refutes P4 when the gate keeps more than the registered band allows', () => {
    const reading = satisfying({ gate: { ...satisfying().gate, improvementPp: 1.2 } });
    const p4 = adjudicateOutOfSample(reading).find((verdict) => verdict.id === 'P4');
    expect(p4?.holds).toBe(false);
    // P3 still holds at 1.2pp, which is the point of registering two bands: the wide one and the
    // narrow one are different claims and only one of them was about shrinkage.
    expect(adjudicateOutOfSample(reading).find((verdict) => verdict.id === 'P3')?.holds).toBe(true);
  });

  it('refutes P3 and P4 together when the gate turns negative', () => {
    const reading = satisfying({ gate: { ...satisfying().gate, improvementPp: -0.4 } });
    const verdicts = adjudicateOutOfSample(reading);
    expect(verdicts.find((verdict) => verdict.id === 'P3')?.holds).toBe(false);
    expect(verdicts.find((verdict) => verdict.id === 'P4')?.holds).toBe(false);
  });

  it('refutes P5 when the imported name stops being negative', () => {
    const reading = satisfying({
      imported: { ...satisfying().imported, present: { n: 2, deltaPp: 1.5 } as never },
    });
    const p5 = adjudicateOutOfSample(reading).find((verdict) => verdict.id === 'P5');
    expect(p5?.holds).toBe(false);
    expect(p5?.observed).toContain('1.50pp');
  });

  it('refutes P1 when a gate failed, whatever the numbers say', () => {
    // A failed gate makes every number downstream a measurement of the harness, so P1 cannot be
    // satisfied by the readings being convenient.
    const verdicts = adjudicateOutOfSample(satisfying({ runsMeasured: false }));
    expect(verdicts.find((verdict) => verdict.id === 'P1')?.holds).toBe(false);
    expect(verdicts.find((verdict) => verdict.id === 'P1')?.observed).toContain('gate failed');
  });

  it('reports a gate improvement of null as n/a rather than as zero', () => {
    const reading = satisfying({ gate: { ...satisfying().gate, improvementPp: null } });
    const p3 = adjudicateOutOfSample(reading).find((verdict) => verdict.id === 'P3');
    expect(p3?.observed).toBe('n/a');
    expect(p3?.holds).toBe(false);
  });

  it('refutes P5 rather than assuming zero when the cohort is empty', () => {
    // A corpus where nothing imports a name has no present group, so the delta is null. Reading
    // null as zero would make the cohort negative-or-zero and let the registration stand on an
    // absence.
    const reading = satisfying({ imported: { ...satisfying().imported, present: { n: 0, deltaPp: null } as never } });
    const p5 = adjudicateOutOfSample(reading).find((verdict) => verdict.id === 'P5');
    expect(p5?.holds).toBe(false);
    expect(p5?.observed).toBe('n/a against -0.20pp');
  });

  it('keeps the registered sentence with the verdict it produced', () => {
    // The documentation quotes these strings. A paraphrase would let the registration drift away
    // from the number it was falsified by.
    expect(OUT_OF_SAMPLE_PREDICTIONS).toHaveLength(5);
    for (const prediction of OUT_OF_SAMPLE_PREDICTIONS) {
      expect(prediction.registered.length).toBeGreaterThan(20);
    }
  });
});

describe('outOfSampleReadingOf', () => {
  it('reads the arm contrast, the gate and the imported cohort from one corpus', () => {
    const cases = [
      importing('i1', 'db_a', false, true),
      importing('i2', 'db_b', false, true),
      clean('c1', 'db_a', true, false),
      clean('c2', 'db_b', true, false),
    ];
    const reading = outOfSampleReadingOf(cases, [-1, -0.5], MEASURED);
    expect(reading.deltaPp).toBeCloseTo(0, 8);
    expect(reading.imported.present.n).toBe(2);
    expect(reading.gate.discarded).toBe(2);
    expect(reading.folds.negative).toBe(2);
    expect(reading.runsMeasured).toBe(true);
  });

  it('reports an empty corpus as a zero delta without pretending it is measured', () => {
    const reading = outOfSampleReadingOf([], [], { runsMeasured: false });
    expect(reading.deltaPp).toBe(0);
    expect(reading.clustered.pointPp).toBeNull();
    expect(reading.folds.p).toBe(1);
    expect(reading.runsMeasured).toBe(false);
  });
});

describe('sideBySideOf', () => {
  const interval = (point: number | null, low: number | null, high: number | null): ClusteredDelta => ({
    questions: point === null ? 0 : 10,
    clusters: point === null ? 0 : 2,
    pointPp: point,
    lowPp: low,
    highPp: high,
    resolved: false,
  });

  it('prints the two corpora beside each other without comparing their accuracies', () => {
    const dev = satisfying();
    const train = satisfying();
    const table = sideBySideOf({
      dev: { ...dev, clustered: interval(0.33, -0.63, 1.36) },
      train: { ...train, clustered: interval(-0.71, -1.27, -0.18) },
    });
    const labels = table.map((row) => row.label);
    expect(labels).toContain('arm delta, clustered');
    // Nothing in the table is an accuracy: dev and train share no database, so an accuracy column
    // would invite a comparison that is not the same quantity.
    expect(labels.some((label) => /accuracy/i.test(label))).toBe(false);
  });

  it('says n/a for a corpus with no interval', () => {
    const reading = satisfying();
    const table = sideBySideOf({
      dev: { ...reading, clustered: interval(null, null, null) },
      train: reading,
    });
    const row = table.find((entry) => entry.label === 'arm delta, clustered');
    expect(row?.dev).toBe('n/a');
  });

  it('says a one-database corpus has no interval instead of printing a zero-width one', () => {
    // `clusteredDeltaOf` returns a point estimate and no interval for one cluster; the table must
    // not turn that into `[0.00, 0.00]`, which reads as a resolved zero.
    const reading = satisfying();
    const table = sideBySideOf({
      dev: { ...reading, clustered: interval(100, null, null) },
      train: reading,
    });
    expect(table.find((row) => row.label === 'arm delta, clustered')?.dev).toBe('100.00pp (no interval)');
  });

  it('says dev has no folds rather than printing a sign test it cannot run', () => {
    const reading = satisfying();
    const table = sideBySideOf({ dev: reading, train: reading });
    expect(table.find((row) => row.label.startsWith('folds'))?.dev).toBe('n/a (no folds)');
  });
});


describe('memoryDiscordanceOf', () => {
  // Four outcomes, each with a flagged and an unflagged case, so a test can move one cell at a time
  // and the filter's precision is controlled independently of what memory did.
  const repairedFlagged = (id: string, dbId = 'db_a') => importing(id, dbId, true, false);
  const repairedKept = (id: string, dbId = 'db_a') => clean(id, dbId, true, false);
  const brokenFlagged = (id: string, dbId = 'db_b') => importing(id, dbId, false, true);
  const brokenKept = (id: string, dbId = 'db_b') => clean(id, dbId, false, true);
  const untouchedRight = (id: string, dbId = 'db_a') => clean(id, dbId, true, true);
  const untouchedWrong = (id: string, dbId = 'db_b') => clean(id, dbId, false, false);

  it('splits the corpus by what memory did rather than by what it is worth', () => {
    const reading = memoryDiscordanceOf([
      repairedKept('r2'),
      untouchedWrong('w1'),
      brokenKept('b2'),
      untouchedRight('c1'),
    ]);
    // Two questions were wrong without memory and one of them is now right: the repair rate is over
    // the questions memory *could* help, not over the corpus.
    expect(reading.attempted).toEqual({ n: 2, repaired: 1, ratePp: 50 });
    expect(reading.correct).toEqual({ n: 2, broken: 1, ratePp: 50 });
    expect(reading.net).toBe(0);
    // One repair per break. Both rates at 50% and a net of zero is the point of the reading: the arm
    // can be harmful in aggregate while the pack is doing as much good as harm.
    expect(reading.helpPerHarm).toBe(1);
    expect(reading.ceilingPp).toBeCloseTo(25, 8);
    expect(reading.realisedPp).toBe(0);
    expect(reading.shareOfCeiling).toBe(0);
  });

  it('reads a filter that sees every break and no repair as realising the whole ceiling', () => {
    const reading = memoryDiscordanceOf([
      brokenFlagged('b1'),
      brokenFlagged('b2'),
      repairedKept('r1'),
      repairedKept('r2'),
    ]);
    expect(reading.filter).toEqual({
      discarded: 2,
      discardedShare: 0.5,
      caughtOfBroken: 2,
      caughtOfRepaired: 0,
      caughtShareOfBroken: 1,
      caughtShareOfRepaired: 0,
      netRemoved: 2,
      // Two questions thrown away for two net errors prevented.
      discardedPerNetError: 1,
    });
    expect(reading.shareOfCeiling).toBe(1);
  });

  it('lets the share of the ceiling go negative when the filter only sees repairs', () => {
    // The failure mode a precision number alone hides: a filter can be worth less than nothing while
    // still removing mostly-bad-looking queries.
    const reading = memoryDiscordanceOf([brokenKept('b1'), brokenKept('b2'), repairedFlagged('r1')]);
    expect(reading.filter.netRemoved).toBe(-1);
    expect(reading.realisedPp).toBeCloseTo(-33.333333, 5);
    expect(reading.ceilingPp).toBeCloseTo(66.666666, 5);
    expect(reading.helpPerHarm).toBe(0.5);
    expect(reading.shareOfCeiling).toBeCloseTo(-0.5, 8);
    expect(reading.filter.discardedPerNetError).toBe(-1);
  });

  it('reports no ratio when the filter removes nothing net, rather than an infinite one', () => {
    // One break caught and one repair discarded. The filter is worthless here, and `Infinity` would
    // be read as the strongest possible signal.
    const reading = memoryDiscordanceOf([
      brokenFlagged('b1'),
      repairedFlagged('r1'),
      untouchedRight('c1'),
      untouchedWrong('w1'),
    ]);
    expect(reading.filter.netRemoved).toBe(0);
    expect(reading.filter.discardedPerNetError).toBeNull();
    expect(reading.realisedPp).toBe(0);
  });

  it('reports a null share when there is no ceiling to share', () => {
    // Nothing was broken, so a perfect filter would be worth zero and the share of zero is not a
    // number. The alternative — 0 or 1 — would both be read as a verdict on the filter.
    const reading = memoryDiscordanceOf([repairedKept('r1'), untouchedRight('c1')]);
    expect(reading.correct.broken).toBe(0);
    expect(reading.ceilingPp).toBe(0);
    expect(reading.shareOfCeiling).toBeNull();
    // Nothing broken means no exchange rate to quote, which is not the same as an infinite one.
    expect(reading.helpPerHarm).toBeNull();
    // No breaks also means no denominator for the capture rate, which is a different null from the
    // rate being zero: this corpus does have one repair and the filter missed it.
    expect(reading.filter.caughtShareOfBroken).toBeNull();
    expect(reading.filter.caughtOfRepaired).toBe(0);
    expect(reading.filter.caughtShareOfRepaired).toBe(0);
  });

  it('reports the corpus with nothing to repair as unmeasured on that side', () => {
    const reading = memoryDiscordanceOf([brokenKept('b1'), untouchedRight('c1')]);
    expect(reading.attempted.n).toBe(0);
    expect(reading.attempted.ratePp).toBeNull();
    expect(reading.correct.ratePp).toBe(50);
  });

  it('reports an empty corpus as unmeasured in every ratio and zero in every count', () => {
    const reading = memoryDiscordanceOf([]);
    expect(reading.attempted).toEqual({ n: 0, repaired: 0, ratePp: null });
    expect(reading.correct).toEqual({ n: 0, broken: 0, ratePp: null });
    expect(reading.net).toBe(0);
    expect(reading.helpPerHarm).toBeNull();
    expect(reading.filter.discarded).toBe(0);
    expect(reading.filter.discardedShare).toBeNull();
    expect(reading.ceilingPp).toBeNull();
    expect(reading.realisedPp).toBeNull();
    expect(reading.shareOfCeiling).toBeNull();
  });

  it('agrees with the gate reading on what the filter is worth', () => {
    // Two computations of one quantity: this one counts the two ways a discarded question can move,
    // `gateReadingOf` re-reads the corpus with the fallback substituted. They must be equal, and the
    // day one of them changes the other has to be shown to still agree.
    const cases = [
      brokenFlagged('b1'),
      brokenKept('b2'),
      repairedFlagged('r1'),
      repairedKept('r2'),
      untouchedRight('c1'),
      untouchedWrong('w1'),
      importing('i9', 'db_c', false, true),
    ];
    const reading = memoryDiscordanceOf(cases);
    expect(reading.realisedPp).toBeCloseTo(gateReadingOf(cases, 'strict', 200).improvementPp as number, 10);
  });
});

describe('powerVerdictOf', () => {
  const cell = (input: Partial<Record<string, number | null>>) =>
    ({
      n: 7000,
      helped: 187,
      harmed: 237,
      deltaPp: -0.7142857142857143,
      halfWidthPp: 0.576555287895272,
      minDetectablePp: 0.8242387330013021,
      baselineCorrect: 0,
      baselineAccuracy: 0,
      harmedPerCorrectPp: 0,
      helpedPerWrongPp: 0,
      clusterLowPp: null,
      clusterHighPp: null,
      ...input,
    }) as never;

  it('files the out-of-sample arm under the category the power audit prints', () => {
    // -0.71pp against a 0.58pp half-width and a 0.82pp resolution: it clears the interval and misses
    // the bar the design was sized for. Reporting only the interval would upgrade this round relative
    // to every other artefact in the repository.
    const verdict = powerVerdictOf(cell({}));
    expect(verdict.significant95).toBe(true);
    expect(verdict.resolvable).toBe(false);
    expect(verdict.label).toBe('within 95% but under 80% power');
  });

  it('calls an effect above both bars resolvable', () => {
    const verdict = powerVerdictOf(cell({ deltaPp: -1.5 }));
    expect(verdict.resolvable).toBe(true);
    expect(verdict.label).toBe('resolvable');
  });

  it('calls an effect under both bars underpowered', () => {
    const verdict = powerVerdictOf(cell({ deltaPp: -0.2 }));
    expect(verdict.significant95).toBe(false);
    expect(verdict.label).toBe('underpowered');
  });

  it('distinguishes no discordant pair from no measurement', () => {
    // `helped + harmed === 0` means nothing changed, so the delta carries no information however
    // small it is. An empty group is a different case and JSON writes both as null.
    const none = powerVerdictOf(cell({ helped: 0, harmed: 0, halfWidthPp: null, minDetectablePp: null }));
    expect(none.label).toBe('no discordant pair');
    expect(none.resolvable).toBe(false);
  });

  it('never calls an infinity-resolution group resolvable', () => {
    const infinite = powerVerdictOf(cell({ minDetectablePp: null, helped: 10, harmed: 4 }));
    expect(infinite.resolvable).toBe(false);
    expect(infinite.significant95).toBe(true);
  });
});
