import { describe, expect, it } from 'vitest';
import { POWER_Z, detectableDelta, tasksForDelta } from '../detectable.js';
import { pairedWidths } from '../power.js';

describe('detectableDelta', () => {
  it('is infinite for a sample of nothing, because no design detects anything with no pairs', () => {
    expect(detectableDelta(0, 0.5)).toBe(Number.POSITIVE_INFINITY);
    expect(detectableDelta(-4, 0.5)).toBe(Number.POSITIVE_INFINITY);
  });

  it('is infinite when no pair can disagree, which is the same statement as no sample', () => {
    expect(detectableDelta(100, 0)).toBe(Number.POSITIVE_INFINITY);
    expect(detectableDelta(100, -0.2)).toBe(Number.POSITIVE_INFINITY);
  });

  it('clamps discordance above one, because a share of pairs cannot exceed all of them', () => {
    expect(detectableDelta(80, 1)).toBe(detectableDelta(80, 4));
  });

  it('shrinks as the square root of the sample, which is why the lane is expensive', () => {
    // Four times the sample halves the floor. This is the only lever a lane has over its own
    // resolution, and it is the reason the τ² arm buys tasks rather than tuning anything.
    const small = detectableDelta(80, 0.4);
    const large = detectableDelta(320, 0.4);
    expect(large).toBeCloseTo(small / 2, 10);
  });

  it('is the same number the power audit reports in percentage points', () => {
    // One definition, two readers. If `protocol.ts` and `power.ts` had kept separate copies, this
    // is the assertion that would have caught them drifting.
    const widths = pairedWidths(14, 13, 68);
    expect(widths?.minDetectablePp).toBeCloseTo(detectableDelta(68, 27 / 68) * 100, 10);
  });

  it('states the constant it uses, so a reader does not have to infer the power from a comment', () => {
    expect(POWER_Z).toBe(2.802);
    expect(detectableDelta(100, 0.25, POWER_Z)).toBeCloseTo(Math.sqrt((POWER_Z ** 2 * 0.25) / 100), 12);
  });

  it('reads the τ² lane at complete discordance as the floor it actually has', () => {
    // The numbers a registration is refused on. 68 tasks cannot guarantee seeing anything smaller
    // than 33.98pp, and 40 cannot guarantee 44.30pp.
    expect(detectableDelta(68, 1) * 100).toBeCloseTo(33.98, 2);
    expect(detectableDelta(40, 1) * 100).toBeCloseTo(44.30, 2);
  });
});

describe('tasksForDelta', () => {
  it('prices this lane\'s own revert bar: −5pp needs 864 paired trials at the discordance it observes', () => {
    // 2.802² · 0.275 / 0.05² = 863.7, so 864. The largest fold this record has run is 194 pairs, and the
    // rule fires on the sign of a delta the sample cannot resolve until it is four times that size.
    expect(tasksForDelta(0.05, 0.275)).toBe(864);
    expect(tasksForDelta(0.03, 0.275)).toBe(2399);
    expect(tasksForDelta(0.1, 0.275)).toBe(216);
    expect(tasksForDelta(0.15, 0.275)).toBe(96);
  });

  it('is the exact inverse of detectableDelta, which is the only reason two files may hold it', () => {
    for (const [n, d] of [
      [40, 0.275],
      [114, 0.4],
      [164, 0.25],
    ] as const) {
      const effect = detectableDelta(n, d);
      // The inverse rounds up, so the sample it returns resolves *that* effect or better and never worse.
      expect(detectableDelta(tasksForDelta(effect, d), d)).toBeLessThanOrEqual(effect + 1e-12);
    }
  });

  it('answers the non-questions the way the forward direction does', () => {
    expect(tasksForDelta(0, 0.3)).toBe(Number.POSITIVE_INFINITY);
    expect(tasksForDelta(-0.02, 0.3)).toBe(Number.POSITIVE_INFINITY);
    expect(tasksForDelta(0.05, 0)).toBe(Number.POSITIVE_INFINITY);
    expect(tasksForDelta(0.05, 1)).toBe(tasksForDelta(0.05, 3));
  });
});
