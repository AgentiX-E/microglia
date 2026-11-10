import { describe, expect, it } from 'vitest';
import {
  OVERLAP_ROUTED_THRESHOLD,
  OVERLAP_THRESHOLD,
  crossFittedThresholds,
  packOverlapOf,
  overlapTerciles,
  overlapWordsOf,
  type OverlapRow,
} from '../overlap.js';

describe('overlapWordsOf', () => {
  it('keeps content words and drops function words and one-character tokens', () => {
    expect(overlapWordsOf('What is the free rate for K-12 students?')).toEqual([
      'free',
      'rate',
      'students',
    ]);
  });

  it('drops bare numbers, which every pack and every question share', () => {
    // `2015` in a question and `2015` in a pack is not evidence that the pack is about the question.
    expect(overlapWordsOf('in 2015 the county rate was 12')).toEqual(['county', 'rate', 'was'].slice(0, 2));
  });

  it('does not stem, because the registered gradient was measured without stemming', () => {
    expect(overlapWordsOf('players player')).toEqual(['players', 'player']);
  });

  it('splits on identifiers, so a column name contributes its parts', () => {
    expect(overlapWordsOf('Free Meal Count (K-12)')).toEqual(['free', 'meal', 'count', 'k', '12'].slice(0, 3));
  });
});

describe('packOverlapOf', () => {
  it('measures the pack against the question and its evidence', () => {
    // BIRD's evidence is written in the corpus's vocabulary; a pack that repeats it is on topic.
    const pack = ['Eligible free rate is computed from Free Meal Count.'];
    // Question words: free, meal, count, rate. Evidence adds `enrollment`. The pack carries four of the
    // five; `enrollment` is the word only the evidence has, and missing it must cost exactly one fifth.
    expect(packOverlapOf(pack, 'What is the free meal count rate?', 'Enrollment (K-12)')).toBeCloseTo(4 / 5, 5);
  });

  it('is zero for an empty pack, which is what a router reads as "nothing was said about it"', () => {
    expect(packOverlapOf([''], 'What is the free rate?', null)).toBe(0);
  });

  it('is zero for a question with no content words rather than dividing by zero', () => {
    expect(packOverlapOf(['anything at all'], 'the a of', '')).toBe(0);
  });

  it('counts a shared word once even when the pack repeats it', () => {
    expect(packOverlapOf(['county county county', 'county'], 'county rate', null)).toBeCloseTo(0.5, 5);
  });
});

describe('overlapTerciles', () => {
  // The table R72 quoted: the low tercile loses questions and the high tercile gains them. The values
  // here are synthetic; the reproduction on R66's artefact is the bin's job, not the suite's.
  const rows: readonly OverlapRow[] = [
    { overlap: 0.0, gained: false, lost: true },
    { overlap: 0.1, gained: false, lost: true },
    { overlap: 0.2, gained: false, lost: false },
    { overlap: 0.3, gained: true, lost: false },
    { overlap: 0.6, gained: true, lost: false },
    { overlap: 0.9, gained: true, lost: false },
  ];

  it('orders the terciles by overlap and reports each one separately', () => {
    const reading = overlapTerciles(rows);
    expect(reading.terciles.map((entry) => entry.name)).toEqual(['low', 'middle', 'high']);
    // low: two losses out of two; middle: one gain, two questions; high: two gains out of two.
    expect(reading.terciles.map((entry) => entry.net)).toEqual([-2, 1, 2]);
  });

  it('reports the whole population beside the terciles, because the two are different claims', () => {
    const reading = overlapTerciles(rows);
    expect(reading.all).toEqual({ n: 6, net: 1, per100: (1 / 6) * 100 });
  });

  it('reports the share a gate would withhold at both registered thresholds', () => {
    // Three of six rows sit below 0.30 and four below 0.38 — the arithmetic behind R72's amendment:
    // the cross-fitted threshold withholds more than two thirds, the in-band one withholds half.
    const reading = overlapTerciles(rows);
    expect(reading.withheldShare).toEqual([
      { threshold: OVERLAP_ROUTED_THRESHOLD, share: 0.5 },
      { threshold: OVERLAP_THRESHOLD, share: 4 / 6 },
    ]);
  });

  it('does not divide by zero on an empty pool', () => {
    const reading = overlapTerciles([]);
    expect(reading.all).toEqual({ n: 0, net: 0, per100: 0 });
    expect(reading.withheldShare.every((entry) => entry.share === 0)).toBe(true);
    expect(reading.terciles.every((entry) => entry.mean === 0 && entry.per100 === 0)).toBe(true);
  });
});

describe('crossFittedThresholds', () => {
  it('chooses on the other folds and reads the held-out one', () => {
    // Overlap below 0.5 loses on every fold; the choice must be a threshold that withholds them.
    const rows = [0, 1, 2, 3].flatMap((fold) =>
      [0.1, 0.2, 0.7, 0.8].map((overlap, index) => ({
        fold,
        overlap,
        gained: overlap > 0.5,
        lost: index === 0 && overlap <= 0.5,
      })),
    );
    const choices = crossFittedThresholds(rows);
    expect(choices).toHaveLength(4);
    for (const choice of choices) {
      expect(choice.threshold).toBeGreaterThan(0.2);
      expect(choice.testNet).toBe(2);
      expect(choice.baselineTestNet).toBe(1);
    }
  });

  it('prefers the higher threshold when two thresholds are worth the same', () => {
    // A gate that withholds everything has a net of zero and so does the identity; the file prefers the
    // one that withholds less, so ties go upward.
    const rows = [0, 1].flatMap((fold) =>
      [0.05, 0.5].map((overlap) => ({ fold, overlap, gained: false, lost: false })),
    );
    expect(crossFittedThresholds(rows).every((choice) => choice.threshold === 0.8)).toBe(true);
  });
});
