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
