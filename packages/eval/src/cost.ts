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

/**
 * The price rows, one per model the card prices.
 *
 * Named so the default row can be **the same object** the card exposes as its headline rates rather
 * than a copy of it: two objects that happen to hold the same numbers are the arrangement in which
 * one of them is eventually edited, and a test asserts the identity rather than the equality.
 */
const PRICES = {
  'deepseek-flash': {
    peak: { miss: 0.3, hit: 0.006, out: 1.2 },
    off_peak: { miss: 0.15, hit: 0.003, out: 0.6 },
  },
  /**
   * The same host's stronger model, at the prices the host publishes beside the first one.
   *
   * It is here because a backbone comparison is the one experiment this record keeps promising and
   * the bill is part of the result: a run on the stronger model that reported the weaker model's
   * `usd` would understate its own cost by 4.4× on input and 3.3× on output, and the artefact would
   * be the only place the error could have been caught.
   */
  'deepseek-v4-pro': {
    peak: { miss: 1.32, hit: 0.044, out: 3.96 },
    off_peak: { miss: 0.66, hit: 0.022, out: 1.98 },
  },
} as const satisfies Readonly<Record<string, Readonly<Record<RateBand, BandRates>>>>;

/**
 * The rates every sentence about cost in this repository is computed with.
 *
 * One card per **provider**, one price row per **model**: the peak predicate is the provider's — it
 * doubles the same two windows for every model it serves — and the numbers are the model's. The card
 * used to hold a single `bands` pair plus an `appliesTo` list, which was the right idea expressed as a
 * claim it could not keep: it named one model and had nowhere to put a second model's prices, so the
 * first run on a stronger model would have been billed at the weaker model's rate with a note calling
 * itself an approximation. A note does not turn a four-fold error into a price.
 */
export const RATE_CARD: {
  readonly currency: string;
  readonly unit: string;
  /** The model a run is billed as when it names one the card does not price. */
  readonly defaultModel: string;
  /** Dollars per million tokens, one row per model the card prices, by band. */
  readonly prices: Readonly<Record<string, Readonly<Record<RateBand, BandRates>>>>;
  /** The default model's row, by reference, so the two cannot be equal and different. */
  readonly bands: Readonly<Record<RateBand, BandRates>>;
  readonly peakWindows: readonly PeakWindow[];
  readonly peakWeekdaysOnly: boolean;
  /** The card's own name, which the artefact quotes so a bill is never anonymous. */
  readonly name: string;
} = {
  name: 'deepseek-rate-card',
  defaultModel: 'deepseek-flash',
  currency: 'USD',
  unit: 'per_million_tokens',
  prices: PRICES,
  bands: PRICES['deepseek-flash'],
  peakWindows: [
    { fromHourUtc: 1, toHourUtc: 4 },
    { fromHourUtc: 6, toHourUtc: 10 },
  ],
  peakWeekdaysOnly: true,
};

/** The models this card prices, sorted, so an artefact can list them without re-deriving them. */
export function pricedModels(): readonly string[] {
  return Object.keys(RATE_CARD.prices).sort();
}

/**
 * The band rates for one model, or `undefined` when the card does not price it.
 *
 * `undefined` rather than the default row, because the caller has to decide what an unpriced model
 * means — bill it as an approximation and say so, or refuse — and a function that silently answered
 * with another model's prices would make that decision for it.
 */
export function bandsFor(model: string): Readonly<Record<RateBand, BandRates>> | undefined {
  return RATE_CARD.prices[model.trim()];
}

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

/** What one set of tokens cost at the moment they were spent, on the model that moved them. */
export function costOf(
  usage: TokenUsage,
  now: Date,
  model: string = RATE_CARD.defaultModel,
): CostReading {
  const band = bandOf(now);
  const other: RateBand = band === 'peak' ? 'off_peak' : 'peak';
  const priced = bandsFor(model) ?? RATE_CARD.bands;
  return {
    band,
    usd: bill(usage, priced[band]),
    usdInOtherBand: bill(usage, priced[other]),
    rates: priced[band],
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
export function billOf(banded: BandedUsage, model: string = RATE_CARD.defaultModel): BillReading {
  // An unpriced model is billed at the card's headline row and named as an approximation by
  // `pricingFor`; the fallback is a reference to that row, never a second copy of it.
  const priced = bandsFor(model) ?? RATE_CARD.bands;
  const peakRates = priced.peak;
  const offPeakRates = priced.off_peak;
  const peakUsd = bill(banded.peak, peakRates);
  const offPeakUsd = bill(banded.off_peak, offPeakRates);
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
export function usageLine(
  label: string,
  banded: BandedUsage,
  model: string = RATE_CARD.defaultModel,
): string {
  const total = billable(totalUsage(banded));
  const bill = billOf(banded, model);
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

/**
 * What a bill assumes about the model it prices.
 *
 * The card is DeepSeek's, and R68 spent real money on `glm-4.7-flashx` while `usage.model` said so and
 * the `usd` beside it was computed from DeepSeek's rates. Nothing in the artefact said which card the
 * number came from, so a reader comparing two backbones' costs was comparing a price to an assumption.
 *
 * A card that does not name a model is not refused — refusing would make the lane unusable on a second
 * backbone, which is the experiment R68 was — but the bill has to **say** it is an approximation and name
 * the model it approximated with. That is the difference between a number with an assumption and a number
 * presented as a fact.
 */
export type PricingBasis = {
  /** The card's own name, from the manifest rather than from this module. */
  readonly card: string;
  /** The model the rates belong to. */
  readonly pricedAs: string;
  /** Whether that model is the one the run actually called. */
  readonly matches: boolean;
};

/** Which card prices this model, and whether it is really that model's card. */
export function pricingFor(model: string): PricingBasis {
  const priced = bandsFor(model) !== undefined;
  return {
    card: RATE_CARD.name,
    pricedAs: priced ? model.trim() : RATE_CARD.defaultModel,
    matches: priced,
  };
}
