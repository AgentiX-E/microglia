/**
 * Statistics used by admission, consolidation, and the evaluation harness.
 *
 * Every function here is deterministic given its inputs: bootstrap takes an
 * explicit random source, and the exact tests compute rather than approximate.
 * The library reports intervals and p-values because a point estimate from a
 * handful of feedback events is not a result.
 */
import type { RandomSource } from './ids.js';

export function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
}

export function variance(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  let sum = 0;
  for (const value of values) sum += (value - m) ** 2;
  return sum / (values.length - 1);
}

export function stddev(values: readonly number[]): number {
  return Math.sqrt(variance(values));
}

/**
 * Wilson score lower bound for a binomial proportion.
 *
 * The lower bound is the right statistic for "may this knowledge be applied?":
 * two successes out of two is not evidence of 100% reliability, and a raw ratio
 * would admit it as if it were. `z = 1.96` is a 95% one-sided lower bound.
 */
export function wilsonLower(successes: number, total: number, z = 1.96): number {
  if (total <= 0) return 0;
  const p = Math.min(1, Math.max(0, successes / total));
  const z2 = z * z;
  const denominator = 1 + z2 / total;
  const centre = p + z2 / (2 * total);
  const spread = z * Math.sqrt((p * (1 - p)) / total + z2 / (4 * total * total));
  return Math.max(0, (centre - spread) / denominator);
}

export function logit(p: number): number {
  const clamped = Math.min(1 - 1e-9, Math.max(1e-9, p));
  return Math.log(clamped / (1 - clamped));
}

export function sigmoid(x: number): number {
  if (x >= 0) return 1 / (1 + Math.exp(-x));
  const e = Math.exp(x);
  return e / (1 + e);
}

export function logGamma(x: number): number {
  // Lanczos, g=7, n=9. Accurate to ~15 digits for x > 0.
  const coefficients = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];
  if (x < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  }
  const shifted = x - 1;
  let a = coefficients[0] as number;
  const t = shifted + 7.5;
  for (let i = 1; i < coefficients.length; i += 1) {
    a += (coefficients[i] as number) / (shifted + i);
  }
  return 0.5 * Math.log(2 * Math.PI) + (shifted + 0.5) * Math.log(t) - t + Math.log(a);
}

export function logBinomialPmf(n: number, k: number, p: number): number {
  if (k < 0 || k > n) return Number.NEGATIVE_INFINITY;
  if (p <= 0) return k === 0 ? 0 : Number.NEGATIVE_INFINITY;
  if (p >= 1) return k === n ? 0 : Number.NEGATIVE_INFINITY;
  return (
    logGamma(n + 1) -
    logGamma(k + 1) -
    logGamma(n - k + 1) +
    k * Math.log(p) +
    (n - k) * Math.log(1 - p)
  );
}

function logSumExp(values: readonly number[]): number {
  let max = Number.NEGATIVE_INFINITY;
  for (const value of values) if (value > max) max = value;
  if (max === Number.NEGATIVE_INFINITY) return max;
  let sum = 0;
  for (const value of values) sum += Math.exp(value - max);
  return max + Math.log(sum);
}

/**
 * Exact two-sided McNemar test.
 *
 * The paired design is the only honest one here: both arms answer the same
 * questions, so the unit of analysis is the discordant pair, not the accuracy
 * difference. `b` and `c` are the counts of questions only one arm got right.
 */
export function mcnemarExact(b: number, c: number): number {
  const n = b + c;
  if (n === 0) return 1;
  const tailTerms: number[] = [];
  const smaller = Math.min(b, c);
  for (let k = 0; k <= smaller; k += 1) {
    tailTerms.push(logBinomialPmf(n, k, 0.5));
  }
  const tail = Math.exp(logSumExp(tailTerms));
  return Math.min(1, 2 * tail);
}

export type Interval = { readonly low: number; readonly high: number; readonly point: number };

/**
 * Percentile bootstrap over a statistic. `resamples` is explicit so a report
 * can state it; the default of 2000 is enough for two-decimal stability.
 */
export function bootstrapCI(
  values: readonly number[],
  statistic: (sample: readonly number[]) => number = mean,
  resamples = 2000,
  random: RandomSource = Math.random,
  alpha = 0.05,
): Interval {
  if (values.length === 0) return { low: 0, high: 0, point: 0 };
  const point = statistic(values);
  if (values.length === 1) return { low: point, high: point, point };
  const samples: number[] = [];
  for (let i = 0; i < resamples; i += 1) {
    const draw: number[] = [];
    for (let j = 0; j < values.length; j += 1) {
      draw.push(values[Math.floor(random() * values.length)] as number);
    }
    samples.push(statistic(draw));
  }
  samples.sort((a, b) => a - b);
  const lowIndex = Math.floor((alpha / 2) * (samples.length - 1));
  const highIndex = Math.ceil((1 - alpha / 2) * (samples.length - 1));
  return {
    low: samples[lowIndex] as number,
    high: samples[highIndex] as number,
    point,
  };
}

/** Laplace-smoothed success rate; the prior keeps a 1-of-1 from reading as 1.0. */
export function smoothedRate(successes: number, total: number, prior = 0.5, strength = 2): number {
  return (successes + prior * strength) / (total + strength);
}

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
