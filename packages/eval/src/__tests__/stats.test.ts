import { describe, expect, it } from 'vitest';
import { bootstrapCI } from '@agentix-e/microglia-core';
import { clusterBootstrapCI, comparePaired } from '../stats.js';

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
