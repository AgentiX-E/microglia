import { describe, expect, it } from 'vitest';
import {
  OVERLAP_ROUTED_THRESHOLD,
  OVERLAP_THRESHOLD,
  crossFittedThresholds,
  packOverlapOf,
  overlapTerciles,
  overlapWordsOf,
  tercileVerdicts,
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

describe('tercileVerdicts', () => {
  // Nine questions, three per tercile, so the tercile boundaries are exact and the arithmetic can be
  // read off by hand rather than trusted.
  const rows: readonly OverlapRow[] = [
    { overlap: 0.01, gained: false, lost: true },
    { overlap: 0.02, gained: false, lost: true },
    { overlap: 0.03, gained: false, lost: true },
    { overlap: 0.5, gained: false, lost: false },
    { overlap: 0.51, gained: false, lost: false },
    { overlap: 0.52, gained: true, lost: false },
    { overlap: 0.9, gained: true, lost: false },
    { overlap: 0.91, gained: true, lost: false },
    { overlap: 0.92, gained: false, lost: false },
  ];

  it('reports the regime it would replace with the interval the branch condition names', () => {
    const verdicts = tercileVerdicts(rows, 0.4, { resamples: 500 });
    expect(verdicts.map((verdict) => verdict.name)).toEqual(['low', 'middle', 'high']);
    // The low tercile loses all three of its questions, and the interval has to say so.
    expect(verdicts[0]?.injected.net).toBe(-3);
    expect(verdicts[0]?.injected.low).toBeLessThan(0);
    // Three losses against no gains is p = 0.25 exactly: McNemar's floor needs six to clear 0.05, and
    // the low tercile in this fixture is deliberately small enough to show the floor rather than hide it.
    expect(verdicts[0]?.injected.p).toBeCloseTo(0.25, 6);
    // The high tercile gains two and loses none, which is a small enough sample to stay unproven.
    expect(verdicts[2]?.injected.net).toBe(2);
  });

  it('keeps what the threshold would inject and reverses what it would withhold', () => {
    const verdicts = tercileVerdicts(rows, 0.4, { resamples: 500 });
    // Nothing in the low tercile clears 0.4, so routing there is the negation of injecting.
    expect(verdicts[0]?.routed.net).toBe(3);
    // The middle tercile keeps its one gain and reverses nothing else into a loss.
    expect(verdicts[1]?.routed.net).toBe(1);
    // The high tercile clears the threshold entirely, so routing and injecting agree.
    expect(verdicts[2]?.routed.net).toBe(2);
  });

  it('prices the gate as a paired comparison rather than a difference of two counts', () => {
    const verdicts = tercileVerdicts(rows, 0.4, { resamples: 500 });
    // A withheld question whose sign was wrong contributes two flips against always-injecting.
    expect(verdicts[0]?.gain.net).toBe(6);
    expect(verdicts[0]?.gain.per100).toBeCloseTo(200, 5);
    // A question above the threshold contributes nothing, because both regimes agree on it.
    expect(verdicts[2]?.gain.net).toBe(0);
    expect(verdicts[2]?.gain.p).toBe(1);
  });

  it('treats a threshold above every overlap as withholding everything', () => {
    const verdicts = tercileVerdicts(rows, 5, { resamples: 200 });
    for (const verdict of verdicts) expect(verdict.routed.net).toBe(-verdict.injected.net);
  });

  it('runs on its own defaults, which is what every caller in the lane uses', () => {
    // The injected options are how the fixtures stay fast; a default that crashed or resampled zero
    // times would stay green behind them, and the lane takes this path on 1,534 questions.
    const verdicts = tercileVerdicts(rows, 0.4);
    expect(verdicts.map((verdict) => verdict.name)).toEqual(['low', 'middle', 'high']);
    expect(verdicts[0]?.injected.net).toBe(-3);
    expect(verdicts[0]?.injected.low).toBeLessThan(0);
  });

  it('survives an empty population rather than dividing by zero', () => {
    expect(tercileVerdicts([], 0.4, { resamples: 50 })).toEqual([]);
  });

  it('reports two empty terciles as empty rather than as zeros that read as measured', () => {
    // Floor(2 / 3) is zero, so the low and middle segments are [0,0) and [0,0). A cell printed as
    // `net 0` there would be indistinguishable from a segment that was measured and did not move, which
    // is the distinction `per100` already carries for a one-element segment.
    const two: readonly OverlapRow[] = [
      { overlap: 0.1, gained: true, lost: false },
      { overlap: 0.9, gained: false, lost: true },
    ];
    const verdicts = tercileVerdicts(two, 0.5, { resamples: 100 });
    expect(verdicts.map((verdict) => verdict.n)).toEqual([0, 0, 2]);
    expect(verdicts[0]?.mean).toBe(0);
    expect(verdicts[0]?.injected.per100).toBe(0);
    expect(verdicts[2]?.mean).toBe(0.5);
  });

  it('reports a zero-width interval when nothing moved, which is the tell and not the noise', () => {
    const flat: readonly OverlapRow[] = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6].map((overlap) => ({
      overlap,
      gained: false,
      lost: false,
    }));
    const verdicts = tercileVerdicts(flat, 0.4, { resamples: 200 });
    for (const verdict of verdicts) {
      expect(verdict.injected.net).toBe(0);
      expect(verdict.injected.low).toBe(0);
      expect(verdict.injected.high).toBe(0);
    }
  });
});
