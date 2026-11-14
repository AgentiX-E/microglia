import { describe, expect, it } from 'vitest';
import { POWER_Z, detectableDelta } from '../detectable.js';
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
