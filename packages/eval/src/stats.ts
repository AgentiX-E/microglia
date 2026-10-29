/**
 * Paired comparison.
 *
 * The unit is one question answered by both arms, so the test is McNemar's
 * exact test on the discordant pairs rather than a difference of proportions.
 * A confidence interval is bootstrapped over questions, because a delta without
 * an interval invites reading noise as progress.
 */
import { bootstrapCI, mcnemarExact, mulberry32, type Interval } from '@agentix-e/microglia-core';

export type PairedResult = {
  readonly n: number;
  readonly baselineCorrect: number;
  readonly treatmentCorrect: number;
  readonly baselineAccuracy: number;
  readonly treatmentAccuracy: number;
  readonly delta: number;
  /** Baseline right, treatment wrong. */
  readonly lost: number;
  /** Treatment right, baseline wrong. */
  readonly gained: number;
  /** Share of pairs on which the arms disagree, (lost + gained) / n. */
  readonly discordance: number;
  /** Two-sided exact McNemar p-value. */
  readonly p: number;
  readonly deltaCI: Interval;
};

/**
 * `resamples` is explicit because the protocol fixes it: the public-benchmark
 * lane is specified at 10,000 bootstrap resamples, and a default that silently
 * ran 2,000 would make two reports incomparable.
 */
export function comparePaired(
  baseline: readonly boolean[],
  treatment: readonly boolean[],
  seed = 12345,
  resamples = 2000,
): PairedResult {
  if (baseline.length !== treatment.length) {
    throw new Error('Paired comparison requires equal-length outcomes');
  }
  const n = baseline.length;
  let baseCorrect = 0;
  let treatCorrect = 0;
  let lost = 0;
  let gained = 0;
  for (let i = 0; i < n; i += 1) {
    const b = baseline[i] === true;
    const t = treatment[i] === true;
    if (b) baseCorrect += 1;
    if (t) treatCorrect += 1;
    if (b && !t) lost += 1;
    if (!b && t) gained += 1;
  }
  const deltas = baseline.map((b, i) => (treatment[i] === true ? 1 : 0) - (b ? 1 : 0));
  const deltaCI = bootstrapCI(deltas, undefined, resamples, mulberry32(seed));
  return {
    n,
    baselineCorrect: baseCorrect,
    treatmentCorrect: treatCorrect,
    baselineAccuracy: n === 0 ? 0 : baseCorrect / n,
    treatmentAccuracy: n === 0 ? 0 : treatCorrect / n,
    delta: n === 0 ? 0 : (treatCorrect - baseCorrect) / n,
    lost,
    gained,
    discordance: n === 0 ? 0 : (lost + gained) / n,
    p: mcnemarExact(lost, gained),
    deltaCI,
  };
}

/**
 * A confidence interval when the unit of observation is a cluster, not a value.
 *
 * `bootstrapCI` resamples single values, which is right when each one is an independent draw. A
 * rule shown on twenty questions is not: one question appears under every rule in its database, so
 * those twenty questions contribute twenty correlated observations per rule. Resampling them as if
 * they were independent would shrink the interval by roughly the square root of the cluster size —
 * an interval that says "measured" about a number that is not.
 *
 * The cluster is resampled, not the observation: draw C clusters with replacement and take every
 * value each drawn cluster carries. That is the standard cluster bootstrap, and it has a cost that
 * every caller has to state: the effective sample is the number of clusters, not the number of
 * values, so a design that adds rules without adding questions buys precision it does not have.
 *
 * A single cluster returns its own mean as both bounds, because a resample of one cluster is that
 * cluster and an interval that admitted it would be narrower than the data.
 */
export function clusterBootstrapCI(
  values: readonly number[],
  clusters: readonly string[],
  resamples = 10_000,
  seed = 12345,
): Interval {
  if (values.length !== clusters.length) {
    throw new Error('A clustered interval needs one cluster label per value');
  }
  if (values.length === 0) return { low: 0, high: 0, point: 0 };
  const byCluster = new Map<string, number[]>();
  for (const [at, label] of clusters.entries()) {
    const bucket = byCluster.get(label) ?? [];
    bucket.push(values[at] as number);
    byCluster.set(label, bucket);
  }
  const groups = [...byCluster.values()];
  const point = values.reduce((sum, value) => sum + value, 0) / values.length;
  if (groups.length === 1) return { low: point, high: point, point };
  const random = mulberry32(seed);
  const samples: number[] = [];
  for (let i = 0; i < resamples; i += 1) {
    let total = 0;
    let count = 0;
    for (let draw = 0; draw < groups.length; draw += 1) {
      const bucket = groups[Math.floor(random() * groups.length)] as number[];
      for (const value of bucket) {
        total += value;
        count += 1;
      }
    }
    samples.push(total / count);
  }
  samples.sort((left, right) => left - right);
  return {
    low: samples[Math.floor(0.025 * (samples.length - 1))] as number,
    high: samples[Math.ceil(0.975 * (samples.length - 1))] as number,
    point,
  };
}
