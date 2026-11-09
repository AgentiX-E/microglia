/**
 * What a run cost, computed from the tokens it actually moved.
 *
 * This module exists because of a specific failure, and the failure is worth stating
 * precisely: the τ² lane once reported `calls: 0` for two months. The counter it read was
 * never incremented, so every bill in the progress log was arithmetic over nothing, and
 * four separate defects — a cache that never hit, a retired model id, thinking tokens
 * billed at the output rate, and a schedule set by the operator's time zone — were each
 * invisible for as long as the instrument was blind. The BIRD lane then reproduced the same
 * blindness in a different shape: it read `usage.total_tokens` and discarded
 * `prompt_tokens`, `completion_tokens` and the cache split, which are the only three
 * numbers that can explain a bill.
 *
 * So the rule this file enforces is: a lane that spends money prints a bill, and the bill
 * is computed from a rate card that is data rather than source. `eval/manifests/model-rates.json`
 * is the card; this file is one of its two readers (the tau2 driver is the other), and a
 * test asserts the constant below matches the file, so the two readers cannot drift apart
 * the way two hardcoded tables always do.
 *
 * Two decisions are load-bearing and easy to get wrong:
 *
 *  1. **The peak predicate takes `now` as an argument** rather than reading the clock. A
 *     function that reads the clock cannot be tested for the thing that matters — the first
 *     version of this arithmetic passed its self-check between 01:00 and 10:00 UTC and failed
 *     the same check at 09:47, and the test that "passed" had only ever been run inside the
 *     window it was supposed to detect.
 *  2. **Usage is accumulated per band, not per run.** A run that starts at 03:50 and ends at
 *     04:20 was billed peak for ten minutes and off-peak after that. Pricing the whole run at
 *     the band in force when it *ended* is not an approximation, it is a different number, and
 *     it is a number the clock decides. Hence `BandedUsage` and `billOf`.
 */

/** The two bands the provider bills in. Peak is exactly double. */
export type RateBand = 'peak' | 'off_peak';

const BANDS: readonly RateBand[] = ['peak', 'off_peak'];

/** Dollars per million tokens, by how the token was billed. */
export type BandRates = {
  /** Prompt tokens the provider had to read: the expensive half. */
  readonly miss: number;
  /** Prompt tokens served from the provider's prefix cache. */
  readonly hit: number;
  /** Completion tokens, which on a thinking model include the thinking. */
  readonly out: number;
};

export type PeakWindow = {
  /** Inclusive, in UTC hours. */
  readonly fromHourUtc: number;
  /** Exclusive, in UTC hours. */
  readonly toHourUtc: number;
};

/** The rates every sentence about cost in this repository is computed with. */
export const RATE_CARD: {
  readonly currency: string;
  readonly unit: string;
  readonly bands: Readonly<Record<RateBand, BandRates>>;
  readonly peakWindows: readonly PeakWindow[];
  readonly peakWeekdaysOnly: boolean;
} = {
  currency: 'USD',
  unit: 'per_million_tokens',
  bands: {
    peak: { miss: 0.3, hit: 0.006, out: 1.2 },
    off_peak: { miss: 0.15, hit: 0.003, out: 0.6 },
  },
  peakWindows: [
    { fromHourUtc: 1, toHourUtc: 4 },
    { fromHourUtc: 6, toHourUtc: 10 },
  ],
  peakWeekdaysOnly: true,
};

/**
 * The tokens one run moved, split the way the provider bills them.
 *
 * `promptTokens` is the whole prompt, `cachedTokens` is the part the provider answered from
 * its cache, and the uncached remainder is what the expensive rate applies to. Keeping the
 * three separate is the point: a run with a 90% cache hit rate and a run with none can have
 * identical `total_tokens` and bills that differ by a factor of fifty.
 */
export type TokenUsage = {
  readonly promptTokens: number;
  readonly cachedTokens: number;
  readonly completionTokens: number;
};

/** Tokens by the band they were spent in, which is the only shape a bill can be exact in. */
export type BandedUsage = Readonly<Record<RateBand, TokenUsage>>;

export const EMPTY_USAGE: TokenUsage = { promptTokens: 0, cachedTokens: 0, completionTokens: 0 };

export const EMPTY_BANDED: BandedUsage = { peak: EMPTY_USAGE, off_peak: EMPTY_USAGE };

/** Whether a moment falls in a band that bills double. */
export function isPeak(
  now: Date,
  windows: readonly PeakWindow[] = RATE_CARD.peakWindows,
  weekdaysOnly: boolean = RATE_CARD.peakWeekdaysOnly,
): boolean {
  if (weekdaysOnly) {
    const weekday = now.getUTCDay();
    if (weekday === 0 || weekday === 6) return false;
  }
  const hour = now.getUTCHours();
  return windows.some((window) => hour >= window.fromHourUtc && hour < window.toHourUtc);
}

/** Which band a moment is billed in. */
export function bandOf(now: Date): RateBand {
  return isPeak(now) ? 'peak' : 'off_peak';
}

/**
 * When the current peak window closes, so a refusal can name the hour it is waiting for.
 *
 * A guard that says "not now" and not "at 10:00 UTC" is a guard an operator overrides, and
 * overriding it is how a run gets dispatched at double price a second time. Returns `now`
 * unchanged when the moment is already off-peak, because a caller that has to special-case
 * "there is nothing to wait for" will get that case wrong.
 */
export function nextOffPeak(
  now: Date,
  windows: readonly PeakWindow[] = RATE_CARD.peakWindows,
  weekdaysOnly: boolean = RATE_CARD.peakWeekdaysOnly,
): Date {
  if (!isPeak(now, windows, weekdaysOnly)) return new Date(now.getTime());
  for (let hours = 0; hours <= 24 * 7; hours += 1) {
    const candidate = new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate(),
        now.getUTCHours() + hours,
        0,
        0,
        0,
      ),
    );
    if (candidate.getTime() <= now.getTime()) continue;
    if (!isPeak(candidate, windows, weekdaysOnly)) return candidate;
  }
  // A card whose windows cover every hour of every day has no off-peak moment to wait for, and the
  // honest answer to "when is it cheap" is that it never is. The alternative -- returning `now` --
  // would send a caller to dispatch inside the window it just asked to avoid.
  throw new Error('the rate card leaves no off-peak hour to wait for');
}

/**
 * Clamp a usage record to something billable.
 *
 * Providers do return nonsense: a cache-hit count larger than the prompt it is a part of,
 * or a negative completion count for a truncated stream. The clamp is not defensive
 * decoration — an unclamped `prompt - cached` is how a bill goes negative, and a negative
 * bill in a report reads as a credit that was never issued.
 */
function billable(usage: TokenUsage): TokenUsage {
  const promptTokens = Math.max(0, Math.trunc(usage.promptTokens));
  const cachedTokens = Math.min(promptTokens, Math.max(0, Math.trunc(usage.cachedTokens)));
  return {
    promptTokens,
    cachedTokens,
    completionTokens: Math.max(0, Math.trunc(usage.completionTokens)),
  };
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function bill(usage: TokenUsage, rates: BandRates): number {
  const clean = billable(usage);
  const uncached = clean.promptTokens - clean.cachedTokens;
  return round4(
    (clean.cachedTokens / 1_000_000) * rates.hit
      + (uncached / 1_000_000) * rates.miss
      + (clean.completionTokens / 1_000_000) * rates.out,
  );
}

/** Share of the prompt the provider answered from cache, in [0, 1]. Zero for an empty prompt. */
export function cacheHitRate(usage: TokenUsage): number {
  const clean = billable(usage);
  if (clean.promptTokens === 0) return 0;
  return clean.cachedTokens / clean.promptTokens;
}

export type CostReading = {
  readonly band: RateBand;
  readonly usd: number;
  /**
   * What the same tokens would have cost in the other band.
   *
   * A run that reports only its own band cannot be scheduled: the reader needs to know what
   * moving it would have saved, and the answer is exactly the number this field holds.
   */
  readonly usdInOtherBand: number;
  readonly rates: BandRates;
};

/** What one set of tokens cost at the moment they were spent. */
export function costOf(usage: TokenUsage, now: Date): CostReading {
  const band = bandOf(now);
  const other: RateBand = band === 'peak' ? 'off_peak' : 'peak';
  return {
    band,
    usd: bill(usage, RATE_CARD.bands[band]),
    usdInOtherBand: bill(usage, RATE_CARD.bands[other]),
    rates: RATE_CARD.bands[band],
  };
}

export type BillReading = {
  /** What the run was actually billed. Exact, because each band is priced at its own rate. */
  readonly usd: number;
  /** The part of the bill incurred inside a peak window. */
  readonly peakUsd: number;
  readonly offPeakUsd: number;
  /** What the same tokens would have cost had the whole run been off-peak. */
  readonly usdIfAllOffPeak: number;
  /** What they would have cost had the whole run been peak, which is the worst case to avoid. */
  readonly usdIfAllPeak: number;
};

/**
 * The bill for a run, priced band by band.
 *
 * `usdIfAllOffPeak` is the number a schedule is chosen against, and it is not `usd / 2`
 * unless the run never touched a peak window: a run that spent a third of its tokens at
 * peak does not halve when it moves, it drops by the peak share of its own bill.
 */
export function billOf(banded: BandedUsage): BillReading {
  const peakUsd = bill(banded.peak, RATE_CARD.bands.peak);
  const offPeakUsd = bill(banded.off_peak, RATE_CARD.bands.off_peak);
  const peakRates = RATE_CARD.bands.peak;
  const offPeakRates = RATE_CARD.bands.off_peak;
  return {
    usd: round4(peakUsd + offPeakUsd),
    peakUsd,
    offPeakUsd,
    usdIfAllOffPeak: bill(addUsage(banded.peak, banded.off_peak), offPeakRates),
    // Every token at the peak rate, which is the figure a schedule is moving away from.
    usdIfAllPeak: bill(addUsage(banded.peak, banded.off_peak), peakRates),
  };
}

/** Sum two usage records. Additive, so a per-fold total is the fold's own sum. */
export function addUsage(left: TokenUsage, right: TokenUsage): TokenUsage {
  return {
    promptTokens: left.promptTokens + right.promptTokens,
    cachedTokens: left.cachedTokens + right.cachedTokens,
    completionTokens: left.completionTokens + right.completionTokens,
  };
}

/** Attribute one record to the band it was spent in. The accumulator a client keeps. */
export function addToBand(banded: BandedUsage, now: Date, usage: TokenUsage): BandedUsage {
  const band = bandOf(now);
  return {
    peak: band === 'peak' ? addUsage(banded.peak, usage) : banded.peak,
    off_peak: band === 'off_peak' ? addUsage(banded.off_peak, usage) : banded.off_peak,
  };
}

/** Both bands together, which is what a reader wants for the token totals. */
export function totalUsage(banded: BandedUsage): TokenUsage {
  return addUsage(banded.peak, banded.off_peak);
}

function thousands(value: number): string {
  return Math.trunc(value).toLocaleString('en-US');
}

/**
 * The one line a lane prints, and the reason it is a function rather than four template
 * literals: a report assembled at each call site is a report that eventually omits the
 * cache split at one of them.
 *
 * It names both figures — what was billed and what an all-off-peak run would have billed —
 * because a report that omits the second cannot be acted on, and the action (move the
 * schedule) is the entire point of measuring the first.
 */
export function usageLine(label: string, banded: BandedUsage): string {
  const total = billable(totalUsage(banded));
  const bill = billOf(banded);
  const cached = billable(banded.peak).cachedTokens + billable(banded.off_peak).cachedTokens;
  const hit = (cacheHitRate({ ...total, cachedTokens: cached }) * 100).toFixed(1);
  const peakShare = bill.usd === 0 ? 0 : (bill.peakUsd / bill.usd) * 100;
  return (
    `[${label}] usage: prompt=${thousands(total.promptTokens)} `
    + `(cached=${thousands(cached)}, ${hit}%) `
    + `completion=${thousands(total.completionTokens)} `
    + `bill=$${bill.usd.toFixed(4)} (peak ${peakShare.toFixed(1)}%) `
    + `all-off-peak would be $${bill.usdIfAllOffPeak.toFixed(4)}`
  );
}

/** Which bands a run actually put tokens through. A run that straddles a window reports both. */
export function bandsUsed(banded: BandedUsage): readonly RateBand[] {
  return BANDS.filter(
    (band) => banded[band].promptTokens > 0 || banded[band].completionTokens > 0,
  );
}
