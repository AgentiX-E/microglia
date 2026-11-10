import { describe, expect, it } from 'vitest';
import { relabelReading, relabelVerdict, type RelabelCase } from '../relabel.js';

const graded = (original: boolean, corrected: boolean) => ({ original, corrected });

/** Six questions, each a different relationship between the two gradings. */
const cases: readonly RelabelCase[] = [
  // Untouched: right under both.
  { id: 'a', treatment: graded(true, true), baseline: graded(true, true) },
  // The correction rescues the treatment arm alone — a gain that exists only under new gold.
  { id: 'b', treatment: graded(false, true), baseline: graded(false, false) },
  // The correction rescues the baseline arm alone — a gain the original grading reported and the
  // corrected one does not.
  { id: 'c', treatment: graded(true, true), baseline: graded(false, true) },
  // Both arms wrong, both now right: two flips, no change to the pair.
  { id: 'd', treatment: graded(false, true), baseline: graded(false, true) },
  // The correction takes a correct answer away from the treatment arm.
  { id: 'e', treatment: graded(true, false), baseline: graded(false, false) },
  // Wrong under both, for both arms.
  { id: 'f', treatment: graded(false, false), baseline: graded(false, false) },
];

describe('relabelReading', () => {
  it('counts each arm under both gradings rather than only the one it is reported in', () => {
    const reading = relabelReading(cases);
    expect(reading.n).toBe(6);
    expect(reading.treatment.original.correct).toBe(3);
    expect(reading.treatment.corrected.correct).toBe(4);
    expect(reading.baseline.original.correct).toBe(1);
    expect(reading.baseline.corrected.correct).toBe(3);
  });

  it('reports the delta in percentage points, which is the number the experiment is about', () => {
    const reading = relabelReading(cases);
    // Original: 3/6 − 1/6 = 33.33pp. Corrected: 4/6 − 3/6 = 16.67pp — the correction lifts both
    // arms and it lifts the baseline more, so the advantage the original grading reported shrinks.
    expect(reading.delta.original).toBeCloseTo(33.333, 2);
    expect(reading.delta.corrected).toBeCloseTo(16.667, 2);
  });

  it('separates a correction that moves both arms from one that moves only one', () => {
    // This is the case the whole exercise exists for: a benchmark can be wrong and the comparison
    // still valid. Four questions, both arms rescued on the same two, so every accuracy rises and the
    // difference does not move at all.
    const even: readonly RelabelCase[] = [
      { id: 'a', treatment: graded(false, true), baseline: graded(false, true) },
      { id: 'b', treatment: graded(false, true), baseline: graded(false, true) },
      { id: 'c', treatment: graded(true, true), baseline: graded(false, false) },
      { id: 'd', treatment: graded(false, false), baseline: graded(true, true) },
    ];
    const reading = relabelReading(even);
    expect(reading.treatment.corrected.percent - reading.treatment.original.percent).toBeCloseTo(50, 6);
    expect(reading.baseline.corrected.percent - reading.baseline.original.percent).toBeCloseTo(50, 6);
    expect(reading.delta.corrected).toBeCloseTo(reading.delta.original, 6);
    // Two questions moved verdict in the treatment arm, and not one of them moved the pair.
    expect(reading.flips.up).toBe(2);
    expect(reading.pairChanged).toBe(0);
  });

  it('counts the treatment arm\'s flips in both directions', () => {
    const reading = relabelReading(cases);
    expect(reading.flips.up).toBe(2);
    expect(reading.flips.down).toBe(1);
  });

  it('counts a pair as changed only when the comparison changes shape', () => {
    const reading = relabelReading(cases);
    // b: baseline wrong both ways, treatment gained — a new gain. c: a gain that disappears.
    // e: a gain that becomes a loss. d is the deliberate omission: both arms gained, so the pair was
    // "both wrong" and is now "both right", which moves two verdicts and changes nothing about who is
    // ahead.
    expect(reading.pairChanged).toBe(3);
  });

  it('survives an empty population without dividing by zero', () => {
    const reading = relabelReading([]);
    expect(reading.n).toBe(0);
    expect(reading.treatment.original.percent).toBe(0);
    expect(reading.delta.original).toBe(0);
    expect(reading.pairChanged).toBe(0);
  });

  it('is symmetric in the sense a paired comparison must be', () => {
    const swapped = cases.map((item) => ({ id: item.id, treatment: item.baseline, baseline: item.treatment }));
    const forward = relabelReading(cases);
    const reverse = relabelReading(swapped);
    expect(reverse.delta.original).toBeCloseTo(-forward.delta.original, 6);
    expect(reverse.delta.corrected).toBeCloseTo(-forward.delta.corrected, 6);
    expect(reverse.pairChanged).toBe(forward.pairChanged);
  });
});

describe('relabelVerdict', () => {
  const excluded = { low: 0.5, high: 4.2 };
  const straddles = { low: -0.4, high: 3.1 };

  it('calls a verdict stable when the correction leaves it significant and same-signed', () => {
    expect(relabelVerdict({ original: 2.3, corrected: 1.9 }, { original: excluded, corrected: excluded })).toBe(
      'stable',
    );
  });

  it('calls it fragile when it keeps its sign but loses its interval', () => {
    expect(
      relabelVerdict({ original: 2.3, corrected: 1.7 }, { original: excluded, corrected: straddles }),
    ).toBe('fragile');
  });

  it('calls it reversed when the sign flips, interval or not', () => {
    // A sign flip is the one outcome that retracts the prior conclusion rather than weakening it.
    expect(relabelVerdict({ original: 1.2, corrected: -0.8 }, { original: excluded, corrected: excluded })).toBe(
      'reversed',
    );
  });

  it('calls it absent when the original grading never separated the arms', () => {
    expect(relabelVerdict({ original: 0.4, corrected: 3.0 }, { original: straddles, corrected: excluded })).toBe(
      'absent',
    );
  });

  it('refuses to classify against an interval it was not given', () => {
    // Treating a missing interval as "includes zero" would silently downgrade every run whose
    // resampling was skipped, and the number printed beside it would look like a measurement.
    expect(relabelVerdict({ original: 2, corrected: 2 }, { original: null, corrected: excluded })).toBe(
      'undecidable',
    );
    expect(relabelVerdict({ original: 2, corrected: 2 }, { original: excluded, corrected: null })).toBe(
      'undecidable',
    );
  });

  it('refuses to reverse a null, which is what the first version got wrong', () => {
    // The defect the reading found: +0.86pp with p 0.70 becomes −0.57pp with p 0.86, and the
    // classifier said `reversed` — the word for withdrawing a published verdict, applied to a pair of
    // results that never published one. Nothing was established, so nothing can be retracted; the flip
    // is a fact about the sign's instability, and it is reported in `flips` rather than in this word.
    expect(
      relabelVerdict({ original: 0.86, corrected: -0.57 }, { original: straddles, corrected: straddles }),
    ).toBe('absent');
  });

  it('treats a zero delta as no sign at all', () => {
    // 0 → 0 has no sign to preserve, and calling it "stable" would report a null as a replicate.
    expect(relabelVerdict({ original: 0, corrected: 0 }, { original: excluded, corrected: excluded })).toBe(
      'absent',
    );
  });
});
