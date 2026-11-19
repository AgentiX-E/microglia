import { describe, expect, it } from 'vitest';
import { bootstrapCI } from '@agentix-e/microglia-core';
import { clusterBootstrapCI, clusterBootstrapStatistic, comparePaired } from '../stats.js';

describe('clusterBootstrapCI', () => {
  it('refuses a value that carries no cluster label', () => {
    expect(() => clusterBootstrapCI([1, 0], ['a'])).toThrow(/one cluster label per value/);
  });

  it('returns a degenerate interval when there is nothing to resample', () => {
    expect(clusterBootstrapCI([], [])).toEqual({ low: 0, high: 0, point: 0 });
  });

  it('reports a single cluster at its own mean, not at a narrower interval', () => {
    expect(clusterBootstrapCI([0, 1, 0, 1], ['a', 'a', 'a', 'a'])).toEqual({
      low: 0.5,
      high: 0.5,
      point: 0.5,
    });
  });

  it('is wider than the unclustered interval on values that are not independent', () => {
    // Two questions, four rules each, and the questions disagree: every rule on `b` is wrong and
    // every rule on `a` is right. The unclustered interval treats those eight observations as eight
    // independent draws and calls the mean precise; the question is what the data varies over.
    const values = [1, 1, 1, 1, 0, 0, 0, 0];
    const clusters = ['a', 'a', 'a', 'a', 'b', 'b', 'b', 'b'];
    const clustered = clusterBootstrapCI(values, clusters, 2000, 7);
    const independent = bootstrapCI(values, undefined, 2000, undefined);
    expect(clustered.high - clustered.low).toBeGreaterThan(independent.high - independent.low);
    expect(clustered.point).toBeCloseTo(0.5, 10);
  });

  it('collapses to the shared value when every cluster agrees', () => {
    const interval = clusterBootstrapCI([0, 0, 0, 0], ['a', 'a', 'b', 'b'], 500, 7);
    expect(interval).toEqual({ low: 0, high: 0, point: 0 });
  });

  it('carries the mean of the values it was given as its point estimate', () => {
    const interval = clusterBootstrapCI([0.5, 0, 0.5, 0], ['a', 'a', 'b', 'b'], 500, 3);
    expect(interval.point).toBeCloseTo(0.25, 10);
  });
});

describe('comparePaired', () => {
  it('counts a pair where the arms agree as no discordance', () => {
    const result = comparePaired([true, false], [true, false], 7, 500);
    expect(result.discordance).toBe(0);
    expect(result.gained).toBe(0);
    expect(result.lost).toBe(0);
  });
});

describe('clusterBootstrapStatistic', () => {
  type Row = { readonly cluster: string; readonly value: number };
  const rows = (values: readonly number[], clusters: readonly string[]): Row[] =>
    values.map((value, at) => ({ cluster: clusters[at] as string, value }));

  it('reproduces the mean interval it generalises, to the last digit', () => {
    // `clusterBootstrapCI` is this function with `mean` as its statistic, and it was rewritten that way
    // rather than left beside it: two resampling loops are two definitions of the 2.5 / 97.5 percentile,
    // and a repository that computes the same interval twice will eventually publish two of them.
    const values = [1, 1, 1, 1, 0, 0, 0, 0];
    const clusters = ['a', 'a', 'a', 'a', 'b', 'b', 'b', 'b'];
    const generic = clusterBootstrapStatistic(
      rows(values, clusters),
      (row) => row.cluster,
      (drawn) => drawn.reduce((sum, row) => sum + row.value, 0) / drawn.length,
      2000,
      7,
    );
    expect(generic).not.toBeNull();
    const { low, high, point } = generic as { low: number; high: number; point: number };
    expect({ low, high, point }).toEqual(clusterBootstrapCI(values, clusters, 2000, 7));
    expect((generic as { dropped: number }).dropped).toBe(0);
  });

  it('intervals a statistic that is not a mean', () => {
    // A ratio: repairs over breaks. The two clusters disagree completely, so the ratio drawn from a
    // resample of them is 0, 1 or infinite; the infinite draw is dropped and counted.
    const drawn = [
      { cluster: 'a', repaired: 3, broken: 0 },
      { cluster: 'b', repaired: 0, broken: 3 },
    ];
    const interval = clusterBootstrapStatistic(
      drawn,
      (row) => row.cluster,
      (sample) => {
        const broken = sample.reduce((sum, row) => sum + row.broken, 0);
        const repaired = sample.reduce((sum, row) => sum + row.repaired, 0);
        return broken === 0 ? null : repaired / broken;
      },
      400,
      11,
    );
    const measured = interval as { low: number; high: number; point: number; dropped: number };
    expect(measured.point).toBe(1);
    expect(measured.low).toBe(0);
    expect(measured.dropped).toBeGreaterThan(0);
  });

  it('returns nothing when the statistic has no value on the sample it was given', () => {
    expect(
      clusterBootstrapStatistic(rows([1, 2], ['a', 'b']), (row) => row.cluster, () => null),
    ).toBeNull();
    expect(clusterBootstrapStatistic([], () => 'a', () => 1)).toBeNull();
  });

  it('returns nothing when every resample refuses to evaluate', () => {
    // One cluster is the whole sample, so this cannot happen by resampling; the guard is reachable only
    // through a statistic that fails on the full sample, which the branch above already returns on.
    // What is left is a resample set that is empty for another reason, and it is asserted here so the
    // code path is not dead: a statistic that returns a non-finite value on every draw.
    expect(
      clusterBootstrapStatistic(
        rows([0, 0, 1, 1], ['a', 'a', 'b', 'b']),
        (row) => row.cluster,
        (sample) => (sample.length > 0 ? Number.POSITIVE_INFINITY : 0),
        100,
        3,
      ),
    ).toBeNull();
  });

  it('collapses to the statistic itself when there is one cluster', () => {
    const interval = clusterBootstrapStatistic(
      rows([1, 2, 3], ['a', 'a', 'a']),
      (row) => row.cluster,
      (drawn) => drawn.reduce((sum, row) => sum + row.value, 0),
      100,
      3,
    );
    expect(interval).toEqual({ low: 6, high: 6, point: 6, dropped: 0 });
  });
});
