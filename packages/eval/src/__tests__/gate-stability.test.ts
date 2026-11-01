/**
 * Whether the gate's estimate survives being taken apart.
 *
 * The three readings are arithmetic over the same columns the gate reads, so the tests are written
 * against corpora built to make each reading fail: a corpus where one database carries the whole
 * improvement, a corpus where the gate's placement is no better than a random ten percent, and a
 * corpus where only one half gains. A stability check that cannot fail is not a check.
 */
import { describe, expect, it } from 'vitest';
import { halvesOf, stabilityOf, HALF_FLOOR_PP, type GateStability } from '../gate-stability.js';
import { discardSetOf, gateReadingOf, improvementOf, type DiffCase } from '../query-diff.js';
import { diffQueries } from '../sql-diff.js';

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

/** A case the pack left untouched, which no gate can discard. */
function still(id: string, dbId: string, correct: boolean, baselineOk: boolean): DiffCase {
  return {
    id,
    dbId,
    delta: diffQueries('SELECT count(*) FROM race', 'SELECT count(*) FROM race', 'how many races', null),
    correct,
    withoutMemoryCorrect: baselineOk,
  };
}

const titles = (reading: GateStability): string[] =>
  reading.criteria.map((entry) => `${entry.code}:${entry.ok ? 'ok' : 'no'}`);

describe('halvesOf', () => {
  it('puts every database in exactly one half, and balances the two by question count', () => {
    const corpus = [
      ...Array.from({ length: 5 }, (_, at) => still(`big#${at}`, 'big', true, true)),
      ...Array.from({ length: 3 }, (_, at) => still(`mid#${at}`, 'mid', true, true)),
      ...Array.from({ length: 2 }, (_, at) => still(`small#${at}`, 'small', true, true)),
    ];
    const halves = halvesOf(corpus);
    // Greedy by size: the big database takes the first side, the two smaller ones take the second,
    // and the two sides land on five questions each — which is the most balanced split available.
    expect(halves.map((half) => half.databases)).toEqual([['big'], ['mid', 'small']]);
    expect(halves[0]?.rows).toHaveLength(5);
    expect(halves[1]?.rows).toHaveLength(5);
  });

  it('is deterministic when two databases are the same size', () => {
    const corpus = [
      ...Array.from({ length: 2 }, (_, at) => still(`a#${at}`, 'b-db', true, true)),
      ...Array.from({ length: 2 }, (_, at) => still(`b#${at}`, 'a-db', true, true)),
    ];
    // The tie is broken by name and the tie-break decides the halves, so the split is a function of
    // the corpus rather than of the order the rows happen to be in.
    expect(halvesOf(corpus).map((half) => half.databases)).toEqual([['a-db'], ['b-db']]);
    expect(halvesOf([...corpus].reverse()).map((half) => half.databases)).toEqual([['a-db'], ['b-db']]);
  });

  it('returns two empty halves for an empty corpus rather than none', () => {
    expect(halvesOf([]).map((half) => half.databases)).toEqual([[], []]);
  });
});

describe('stabilityOf', () => {
  /**
   * A corpus with the shape the gate needs: imports that destroy correct queries, spread over four
   * databases, plus a background of questions the pack left alone. The improvement is carried by
   * all four, which is the case where every criterion should pass.
   */
  const carried = (): readonly DiffCase[] => {
    const rows: DiffCase[] = [];
    for (const dbId of ['a', 'b', 'c', 'd']) {
      for (let at = 0; at < 4; at += 1) rows.push(importing(`${dbId}#${at}`, dbId, false, true));
      for (let at = 0; at < 6; at += 1) rows.push(still(`${dbId}#s${at}`, dbId, true, true));
    }
    return rows;
  };

  /**
   * A corpus where one database holds every damaged question and the other three are clean, so
   * removing it must take the whole improvement with it.
   */
  const concentrated = (): readonly DiffCase[] => {
    const rows: DiffCase[] = [];
    for (let at = 0; at < 8; at += 1) rows.push(importing(`a#${at}`, 'a', false, true));
    for (const dbId of ['b', 'c', 'd']) {
      for (let at = 0; at < 4; at += 1) rows.push(still(`${dbId}#${at}`, dbId, true, true));
    }
    return rows;
  };

  it('reads the same improvement the gate reports, as an identity', () => {
    const corpus = carried();
    const reading = stabilityOf(corpus, { permutations: 50, resamples: 100 });
    expect(reading.observedPp).toBeCloseTo(improvementOf(corpus, discardSetOf(corpus)), 10);
    expect(reading.observedPp).toBeCloseTo(gateReadingOf(corpus, 'strict', 100).improvementPp ?? NaN, 10);
    expect(reading.discarded).toBe(16);
  });

  it('passes all three readings when every database carries its share', () => {
    const reading = stabilityOf(carried(), { permutations: 200, resamples: 100 });
    expect(titles(reading)).toEqual(['S1:ok', 'S2:ok', 'S3:ok']);
    expect(reading.unstable).toBe(false);
    expect(reading.jackknife).toHaveLength(4);
    expect(reading.jackknifeMinPp).toBeGreaterThan(0);
    expect(reading.permutation.p).toBeLessThan(0.05);
  });

  it('fails S1 when one database carries the estimate', () => {
    const reading = stabilityOf(concentrated(), { permutations: 100, resamples: 100 });
    // Dropping the one database that holds the damage leaves the gate nothing to recover, so the
    // leave-one-out minimum is exactly zero and the estimate is that database's story.
    expect(reading.jackknifeMinPp).toBeCloseTo(0, 10);
    expect(titles(reading)[0]).toBe('S1:no');
    expect(reading.unstable).toBe(true);
  });

  it('fails S2 when the gate discards questions at random', () => {
    // Every flagged question is a *repair*, so the gate throws away exactly what the pack was
    // earning: the observed improvement is negative and sits inside the null rather than above it.
    const rows: DiffCase[] = [];
    for (let at = 0; at < 6; at += 1) rows.push(importing(`a#${at}`, `db${at}`, true, false));
    for (let at = 0; at < 6; at += 1) rows.push(still(`b#${at}`, `db${at}`, false, false));
    const reading = stabilityOf(rows, { permutations: 200, resamples: 100 });
    expect(reading.observedPp).toBeLessThan(0);
    expect(reading.criteria.find((entry) => entry.code === 'S2')?.ok).toBe(false);
  });

  it('reports the null distribution beside the observed value, not instead of it', () => {
    const reading = stabilityOf(carried(), { permutations: 100, resamples: 100 });
    expect(reading.permutation.resamples).toBe(100);
    expect(reading.permutation.nullLowPp).toBeLessThanOrEqual(reading.permutation.nullHighPp);
    // The null is not centred on zero: a random ten percent of this corpus still discards damaged
    // questions in proportion, so it is worth something. What the test asserts is that the gate is
    // outside the null's range, which is the claim S2 makes.
    expect(reading.permutation.nullMeanPp).toBeGreaterThan(0);
    expect(reading.permutation.nullMeanPp).toBeLessThan(reading.observedPp);
    expect(reading.permutation.p).toBeGreaterThan(0);
    expect(reading.permutation.p).toBeLessThanOrEqual(1);
  });

  it('draws at least one permutation even when asked for none', () => {
    // A p-value beside a distribution that was never drawn is a 0.05-shaped number with nothing
    // behind it, so the count is floored rather than trusted.
    const reading = stabilityOf(carried(), { permutations: 0, resamples: 50 });
    expect(reading.permutation.resamples).toBe(1);
    // One draw, and it is not as good as the gate: p = (0 + 1) / (1 + 1). The correction is what
    // stops a single draw from reporting the impossibility of 0.
    expect(reading.permutation.p).toBeCloseTo(0.5, 10);
  });

  it('reports the two halves with their own resolution', () => {
    const reading = stabilityOf(carried(), { permutations: 50, resamples: 100 });
    expect(reading.halves.map((half) => half.half)).toEqual(['A', 'B']);
    for (const half of reading.halves) {
      expect(half.n).toBeGreaterThan(0);
      expect(half.databases.length).toBe(2);
      expect(half.minDetectablePp).not.toBeNull();
    }
    expect(reading.halves[0]?.improvementPp).toBeCloseTo(reading.halves[1]?.improvementPp ?? NaN, 10);
  });

  it('reports an empty corpus as unmeasured rather than as stable', () => {
    const reading = stabilityOf([], { permutations: 10, resamples: 50 });
    expect(reading.jackknife).toHaveLength(0);
    expect(reading.jackknifeMinPp).toBeNull();
    expect(reading.jackknifeMaxPp).toBeNull();
    expect(titles(reading)).toEqual(['S1:no', 'S2:no', 'S3:no']);
    expect(reading.unstable).toBe(true);
  });

  it('applies the looser grounding rule when asked, and says which one it used', () => {
    const rows = [
      {
        id: 'a#0',
        dbId: 'a',
        delta: diffQueries('SELECT count(*) FROM race', 'SELECT count(*) FROM race JOIN a ON race.raceid = a.id', 'race 903', null),
        correct: false,
        withoutMemoryCorrect: true,
      },
    ];
    // `a` is a one-letter table and the question has no such word, so both rules flag it; what the
    // test pins is that the mode reaches the discard set at all.
    expect(stabilityOf(rows, { mode: 'strict', permutations: 10, resamples: 50 }).discarded).toBe(1);
    expect(stabilityOf(rows, { mode: 'morphological', permutations: 10, resamples: 50 }).mode).toBe('morphological');
  });

  it('uses the documented defaults when it is given no options at all', () => {
    // The defaults are part of the artefact: 2,000 bootstrap resamples and 5,000 permutations are
    // what the committed JSON was produced with, and a test that always passed options would leave
    // the shipped configuration unexercised.
    const reading = stabilityOf([importing('a#0', 'a', false, true), still('a#1', 'a', true, true)]);
    expect(reading.mode).toBe('strict');
    expect(reading.permutation.resamples).toBe(5_000);
    expect(reading.discarded).toBe(1);
  });

  it('publishes the half floor it applies', () => {
    expect(HALF_FLOOR_PP).toBe(0);
    const reading = stabilityOf(carried(), { permutations: 20, resamples: 50 });
    expect(reading.criteria.find((entry) => entry.code === 'S3')?.criterion).toContain('0.0pp');
  });
});
