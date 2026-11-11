import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  EMPTY_BANDED,
  EMPTY_USAGE,
  RATE_CARD,
  addToBand,
  addUsage,
  bandOf,
  bandsUsed,
  billOf,
  cacheHitRate,
  costOf,
  isPeak,
  nextOffPeak,
  totalUsage,
  usageLine,
  type BandedUsage,
  pricingFor,
  type TokenUsage,
} from '../cost.js';

/** A fixed UTC moment, so the peak predicate is a fact and not a function of the clock. */
function at(year: number, month: number, day: number, hour: number, minute = 0): Date {
  return new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0));
}

// 2026-11-09 is a Monday. Every weekday boundary below is stated against it.
const MONDAY = 9;

const usage = (promptTokens: number, cachedTokens: number, completionTokens: number): TokenUsage => ({
  promptTokens,
  cachedTokens,
  completionTokens,
});

/** One record attributed to the band the moment falls in. */
const spentAt = (tokens: TokenUsage, moment: Date): BandedUsage => addToBand(EMPTY_BANDED, moment, tokens);

describe('RATE_CARD', () => {
  const manifest = JSON.parse(
    readFileSync(new URL('../../../../eval/manifests/model-rates.json', import.meta.url), 'utf8'),
  ) as {
    readonly currency: string;
    readonly unit: string;
    readonly bands: Record<string, { miss: number; hit: number; out: number }>;
    readonly peakWindows: readonly { fromHourUtc: number; toHourUtc: number }[];
    readonly peakWeekdaysOnly: boolean;
  };

  it('matches the manifest both lanes load, so the two readers cannot drift apart', () => {
    expect(RATE_CARD.currency).toBe(manifest.currency);
    expect(RATE_CARD.unit).toBe(manifest.unit);
    expect(RATE_CARD.peakWeekdaysOnly).toBe(manifest.peakWeekdaysOnly);
    expect(RATE_CARD.bands).toEqual(manifest.bands);
    expect(RATE_CARD.peakWindows).toEqual(manifest.peakWindows);
  });

  it('states peak as exactly twice every rate, which is the whole reason it matters', () => {
    const { peak, off_peak: offPeak } = RATE_CARD.bands;
    expect(peak.miss).toBeCloseTo(offPeak.miss * 2, 12);
    expect(peak.hit).toBeCloseTo(offPeak.hit * 2, 12);
    expect(peak.out).toBeCloseTo(offPeak.out * 2, 12);
  });

  it('prices a cached token fifty times below an uncached one', () => {
    expect(RATE_CARD.bands.peak.miss / RATE_CARD.bands.peak.hit).toBeCloseTo(50, 12);
    expect(RATE_CARD.bands.off_peak.miss / RATE_CARD.bands.off_peak.hit).toBeCloseTo(50, 12);
  });

  it('prices an output token above an uncached input token, which is what makes thinking expensive', () => {
    // The rate card does not distinguish a useful token from a reasoning token: both arrive as
    // `completion_tokens`. The only control over that cost is not asking for it, which is why
    // every lane passes the thinking switch explicitly instead of relying on a default.
    expect(RATE_CARD.bands.peak.out / RATE_CARD.bands.peak.miss).toBeCloseTo(4, 12);
  });
});

describe('isPeak', () => {
  it('covers 01:00 inclusive to 04:00 exclusive and 06:00 inclusive to 10:00 exclusive', () => {
    const cases: readonly (readonly [number, number, boolean])[] = [
      [0, 59, false],
      [1, 0, true],
      [3, 59, true],
      [4, 0, false],
      [5, 59, false],
      [6, 0, true],
      [9, 59, true],
      [10, 0, false],
      [12, 0, false],
      [23, 59, false],
    ];
    for (const [hour, minute, expected] of cases) {
      expect(isPeak(at(2026, 11, MONDAY, hour, minute)), `${hour}:${minute}`).toBe(expected);
    }
  });

  it('is off-peak all weekend, because the card says weekdays only', () => {
    // Saturday and Sunday, at an hour that is peak on a Monday.
    expect(isPeak(at(2026, 11, 7, 2))).toBe(false);
    expect(isPeak(at(2026, 11, 8, 2))).toBe(false);
    expect(isPeak(at(2026, 11, MONDAY, 2))).toBe(true);
  });

  it('reads the windows it is given rather than only its own', () => {
    expect(isPeak(at(2026, 11, MONDAY, 12), [{ fromHourUtc: 12, toHourUtc: 13 }])).toBe(true);
    expect(isPeak(at(2026, 11, MONDAY, 12), [{ fromHourUtc: 13, toHourUtc: 14 }])).toBe(false);
  });
});

describe('nextOffPeak', () => {
  it('names the close of the window a moment sits inside', () => {
    expect(nextOffPeak(at(2026, 11, MONDAY, 1, 18)).toISOString()).toBe('2026-11-09T04:00:00.000Z');
    expect(nextOffPeak(at(2026, 11, MONDAY, 6, 0)).toISOString()).toBe('2026-11-09T10:00:00.000Z');
    expect(nextOffPeak(at(2026, 11, MONDAY, 9, 59)).toISOString()).toBe('2026-11-09T10:00:00.000Z');
  });

  it('returns the moment itself when there is nothing to wait for', () => {
    const moment = at(2026, 11, MONDAY, 12, 30);
    expect(nextOffPeak(moment).toISOString()).toBe(moment.toISOString());
  });

  it('returns a weekend moment unchanged, since the wait would be zero', () => {
    const saturday = at(2026, 11, 7, 2, 0);
    expect(nextOffPeak(saturday).toISOString()).toBe(saturday.toISOString());
  });

  it('always lands strictly after the moment it was given', () => {
    for (const hour of [1, 2, 3, 6, 7, 8, 9]) {
      const moment = at(2026, 11, MONDAY, hour, 0);
      expect(nextOffPeak(moment).getTime()).toBeGreaterThan(moment.getTime());
    }
  });

  it('refuses a card that leaves no off-peak hour rather than sending the caller inside it', () => {
    // The alternative -- returning `now` -- is a guard that answers "not yet" with the moment it was
    // asked about, which is how a dispatch lands inside the window it was told to avoid.
    const covered = [{ fromHourUtc: 0, toHourUtc: 24 }];
    expect(() => nextOffPeak(at(2026, 11, MONDAY, 12), covered, false)).toThrow(/no off-peak hour/);
    // With the weekend still free, the same card has an off-peak moment and the wait is the weekend.
    expect(nextOffPeak(at(2026, 11, MONDAY, 12), covered, true).toISOString()).toBe(
      '2026-11-14T00:00:00.000Z',
    );
  });
});

describe('costOf', () => {
  it('bills a million uncached prompt tokens and a million output tokens at $1.50 peak, $0.75 off-peak', () => {
    const tokens = usage(1_000_000, 0, 1_000_000);
    const peak = costOf(tokens, at(2026, 11, MONDAY, 2));
    const offPeak = costOf(tokens, at(2026, 11, MONDAY, 12));
    expect(peak.band).toBe('peak');
    expect(peak.usd).toBeCloseTo(1.5, 4);
    expect(offPeak.band).toBe('off_peak');
    expect(offPeak.usd).toBeCloseTo(0.75, 4);
    expect(peak.usd / offPeak.usd).toBeCloseTo(2, 12);
  });

  it('reports what the same tokens would have cost in the other band', () => {
    const tokens = usage(1_000_000, 0, 1_000_000);
    const peak = costOf(tokens, at(2026, 11, MONDAY, 2));
    const offPeak = costOf(tokens, at(2026, 11, MONDAY, 12));
    expect(peak.usdInOtherBand).toBeCloseTo(offPeak.usd, 4);
    expect(offPeak.usdInOtherBand).toBeCloseTo(peak.usd, 4);
  });

  it('charges a cached token at the hit rate, which is the difference between two bills', () => {
    const allMiss = costOf(usage(1_000_000, 0, 0), at(2026, 11, MONDAY, 2));
    const allHit = costOf(usage(1_000_000, 1_000_000, 0), at(2026, 11, MONDAY, 2));
    expect(allMiss.usd).toBeCloseTo(0.3, 4);
    expect(allHit.usd).toBeCloseTo(0.006, 4);
  });

  it('carries the rates it used, so a bill can be re-derived from the artefact', () => {
    const reading = costOf(usage(1, 0, 1), at(2026, 11, MONDAY, 2));
    expect(reading.rates).toEqual(RATE_CARD.bands.peak);
  });

  it('bills an empty run at zero rather than at a floor', () => {
    expect(costOf(EMPTY_USAGE, at(2026, 11, MONDAY, 2)).usd).toBe(0);
  });

  it('refuses to produce a negative bill from a provider that reports nonsense', () => {
    const nonsense = costOf(usage(-1_000, -5, -7), at(2026, 11, MONDAY, 2));
    expect(nonsense.usd).toBe(0);
  });

  it('clamps a cache-hit count larger than the prompt it belongs to', () => {
    const reading = costOf(usage(1_000_000, 9_000_000, 0), at(2026, 11, MONDAY, 2));
    expect(reading.usd).toBeCloseTo(0.006, 4);
  });

  it('truncates fractional token counts rather than billing half a token', () => {
    const reading = costOf(usage(1_000_000.9, 0, 0), at(2026, 11, MONDAY, 2));
    expect(reading.usd).toBeCloseTo(0.3, 4);
  });
});

describe('cacheHitRate', () => {
  it('is zero for a run that moved no prompt tokens', () => {
    expect(cacheHitRate(EMPTY_USAGE)).toBe(0);
  });

  it('is the share of the prompt the provider answered from cache', () => {
    expect(cacheHitRate(usage(1_000, 250, 0))).toBeCloseTo(0.25, 12);
    expect(cacheHitRate(usage(1_000, 1_000, 0))).toBe(1);
  });

  it('cannot exceed one, even when the provider says it can', () => {
    expect(cacheHitRate(usage(10, 99, 0))).toBe(1);
  });
});

describe('bandOf', () => {
  it('names the band a moment is billed in', () => {
    expect(bandOf(at(2026, 11, MONDAY, 2))).toBe('peak');
    expect(bandOf(at(2026, 11, MONDAY, 12))).toBe('off_peak');
    expect(bandOf(at(2026, 11, 7, 2))).toBe('off_peak');
  });
});

describe('addToBand', () => {
  it('attributes a record to the band its moment falls in and leaves the other alone', () => {
    const peak = addToBand(EMPTY_BANDED, at(2026, 11, MONDAY, 2), usage(10, 4, 6));
    expect(peak.peak).toEqual(usage(10, 4, 6));
    expect(peak.off_peak).toEqual(EMPTY_USAGE);

    const both = addToBand(peak, at(2026, 11, MONDAY, 12), usage(5, 1, 2));
    expect(both.peak).toEqual(usage(10, 4, 6));
    expect(both.off_peak).toEqual(usage(5, 1, 2));
  });

  it('accumulates within a band across many records', () => {
    const first = addToBand(EMPTY_BANDED, at(2026, 11, MONDAY, 7), usage(10, 4, 6));
    const second = addToBand(first, at(2026, 11, MONDAY, 8), usage(1, 0, 1));
    expect(second.peak).toEqual(usage(11, 4, 7));
  });
});

describe('billOf', () => {
  it('prices each band at its own rate, which is what makes a straddling bill exact', () => {
    const banded: BandedUsage = {
      peak: usage(1_000_000, 0, 0),
      off_peak: usage(1_000_000, 0, 0),
    };
    const bill = billOf(banded);
    expect(bill.peakUsd).toBeCloseTo(0.3, 4);
    expect(bill.offPeakUsd).toBeCloseTo(0.15, 4);
    expect(bill.usd).toBeCloseTo(0.45, 4);
  });

  it('says what the same tokens would have cost under either single band', () => {
    const banded: BandedUsage = {
      peak: usage(1_000_000, 0, 0),
      off_peak: usage(1_000_000, 0, 0),
    };
    const bill = billOf(banded);
    expect(bill.usdIfAllOffPeak).toBeCloseTo(0.3, 4);
    expect(bill.usdIfAllPeak).toBeCloseTo(0.6, 4);
  });

  it('is zero for a run that never called the model', () => {
    const bill = billOf(EMPTY_BANDED);
    expect(bill).toEqual({ usd: 0, peakUsd: 0, offPeakUsd: 0, usdIfAllOffPeak: 0, usdIfAllPeak: 0 });
  });

  it('does not assume a run halves when it moves, because a part-peak run cannot', () => {
    const mostlyPeak: BandedUsage = { peak: usage(9_000_000, 0, 0), off_peak: usage(1_000_000, 0, 0) };
    const bill = billOf(mostlyPeak);
    expect(bill.usd).toBeCloseTo(2.85, 4);
    expect(bill.usdIfAllOffPeak).toBeCloseTo(1.5, 4);
    expect(bill.usd / 2).not.toBeCloseTo(bill.usdIfAllOffPeak, 4);
  });
});

describe('totalUsage', () => {
  it('adds the two bands, so a token total is the run rather than half of it', () => {
    expect(totalUsage({ peak: usage(10, 1, 2), off_peak: usage(5, 0, 3) })).toEqual(usage(15, 1, 5));
  });
});

describe('bandsUsed', () => {
  it('names the bands a run actually put tokens through', () => {
    expect(bandsUsed(EMPTY_BANDED)).toEqual([]);
    expect(bandsUsed(spentAt(usage(10, 0, 1), at(2026, 11, MONDAY, 2)))).toEqual(['peak']);
    expect(bandsUsed(spentAt(usage(10, 0, 0), at(2026, 11, MONDAY, 2)))).toEqual(['peak']);
    expect(bandsUsed(spentAt(usage(0, 0, 5), at(2026, 11, MONDAY, 12)))).toEqual(['off_peak']);
  });
});

describe('usageLine', () => {
  it('prints the cache split, the peak share and what an all-off-peak run would have cost', () => {
    const line = usageLine('sota', spentAt(usage(2_000_000, 1_500_000, 400_000), at(2026, 11, MONDAY, 2)));
    expect(line).toContain('[sota] usage:');
    expect(line).toContain('prompt=2,000,000');
    expect(line).toContain('cached=1,500,000, 75.0%');
    expect(line).toContain('completion=400,000');
    expect(line).toContain('(peak 100.0%)');
    expect(line).toContain('all-off-peak would be');
  });

  it('names the same figure twice when the run was already off-peak', () => {
    const line = usageLine('bird', spentAt(usage(1_000_000, 0, 0), at(2026, 11, MONDAY, 12)));
    expect(line).toContain('bill=$0.1500 (peak 0.0%)');
    expect(line).toContain('all-off-peak would be $0.1500');
  });

  it('prices a straddling run band by band instead of at the band it ended in', () => {
    // Ten minutes of peak and the rest off it. Billing the whole run at the ending band would be
    // wrong by the peak share, and that share is exactly what the line exists to show.
    const start = spentAt(usage(1_000_000, 0, 0), at(2026, 11, MONDAY, 3));
    const rest = addToBand(start, at(2026, 11, MONDAY, 12), usage(1_000_000, 0, 0));
    const line = usageLine('bird', rest);
    expect(line).toContain('bill=$0.4500 (peak 66.7%)');
    expect(line).toContain('all-off-peak would be $0.3000');
  });

  it('reports a run that moved nothing without dividing by zero', () => {
    const line = usageLine('bird', EMPTY_BANDED);
    expect(line).toContain('prompt=0 (cached=0, 0.0%)');
    expect(line).toContain('bill=$0.0000');
    expect(line).toContain('(peak 0.0%)');
  });
});

describe('addUsage', () => {
  it('sums the three components independently', () => {
    expect(addUsage(usage(10, 4, 2), usage(5, 1, 3))).toEqual({
      promptTokens: 15,
      cachedTokens: 5,
      completionTokens: 5,
    });
  });

  it('is additive from the empty record', () => {
    expect(addUsage(EMPTY_USAGE, usage(7, 3, 1))).toEqual(usage(7, 3, 1));
  });
});

describe('pricingFor', () => {
  it('says the card is the model', () => {
    expect(pricingFor('deepseek-flash')).toEqual({
      card: 'deepseek-rate-card',
      pricedAs: 'deepseek-flash',
      matches: true,
    });
  });

  it('names the model it approximated with, rather than pretending', () => {
    // R68 spent real money on glm-4.7-flashx and its `usd` was DeepSeek's rates with nothing in the
    // artefact to say so. A reader comparing two backbones' costs was comparing a price to an assumption.
    expect(pricingFor('glm-4.7-flashx')).toEqual({
      card: 'deepseek-rate-card',
      pricedAs: 'deepseek-flash',
      matches: false,
    });
  });

  it('uses the card’s own name and model list, not a copy of them', () => {
    // The manifest is the single source: a second hardcoded table is what this module's header calls
    // the arrangement in which one of the two is eventually wrong.
    expect(pricingFor(RATE_CARD.appliesTo[0] as string).card).toBe(RATE_CARD.name);
    expect(RATE_CARD.appliesTo).toContain('deepseek-flash');
  });
});
