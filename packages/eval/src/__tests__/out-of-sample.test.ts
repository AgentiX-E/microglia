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
  outOfSampleReadingOf,
  sideBySideOf,
  type ClusteredDelta,
  type OutOfSampleReading,
} from '../out-of-sample.js';
import { diffQueries } from '../sql-diff.js';
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
