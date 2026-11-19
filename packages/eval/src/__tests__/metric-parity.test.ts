import { describe, expect, it } from 'vitest';
import { metricParityLine, metricParityOf, restateAtLevel } from '../metric-parity.js';

/**
 * The gate that would have caught R152c.
 *
 * Its arm carried `metrics.k = 1` beside a field named `pass4`, the pairing step handed the protocol a
 * default of four, and nothing in the artefact could be read to see the mismatch. These tests are about
 * the three states the artefact can now be in — agreed, disagreed, and unstated — and about the fourth
 * fact that is not the gate's: whether the level the pair shares is the level the bar was measured at.
 */

describe('the metric a pair was scored at', () => {
  it('passes when both arms state the same level, and names the bar when it matches', () => {
    const parity = metricParityOf({ kFirst: 4, kSecond: 4, barK: 4 });
    expect(parity.k).toBe(4);
    expect(parity.barKMismatch).toBe(false);
    expect(parity.gate).toMatchObject({ id: 'l4-same-k', pass: true, blocking: true });
    expect(parity.gate?.actual).toContain('both arms at k = 4');
    expect(parity.gate?.actual).toContain("which is the bar's k = 4");
    expect(parity.absent).toBeNull();
  });

  it('passes the pair and fails the bar when the arms agree at a level the bar does not use', () => {
    // This is R152c's shape: a `k = 1` dispatch is internally consistent, so the pair may be read — and a
    // delta against `57.5% pass^4` is a comparison of two statistics, which the protocol block states.
    const parity = metricParityOf({ kFirst: 1, kSecond: 1, barK: 4 });
    expect(parity.gate?.pass).toBe(true);
    expect(parity.k).toBe(1);
    expect(parity.barKMismatch).toBe(true);
    expect(parity.gate?.actual).toContain('the bar is k = 4 — the delta is a different statistic');
  });

  it('fails and blocks when the two arms were scored at different levels', () => {
    const parity = metricParityOf({ kFirst: 1, kSecond: 4, barK: 4 });
    expect(parity.k).toBeNull();
    expect(parity.gate?.pass).toBe(false);
    expect(parity.gate?.blocking).toBe(true);
    expect(parity.gate?.actual).toBe('first at k = 1, second at k = 4');
    // A pair with no shared level has no level to compare against a bar, and the field says so rather
    // than reporting "matches" off a null.
    expect(parity.barKMismatch).toBeNull();
    expect(parity.gate?.criterion).toContain('pass^1 and pass^4 are not one measurement');
  });

  it('is absent, not green, when an arm never stated a level', () => {
    const parity = metricParityOf({ kFirst: null, kSecond: 4, barK: 4, firstArm: 'the reference arm' });
    expect(parity.gate).toBeNull();
    expect(parity.k).toBeNull();
    expect(parity.kFirst).toBeNull();
    expect(parity.kSecond).toBe(4);
    expect(parity.absent).toContain('the reference arm stated no `metrics.k`');
    expect(parity.absent).toContain('every artefact written since R120 carries the field');
  });

  it('names the second arm when it is the only silent one', () => {
    const parity = metricParityOf({ kFirst: 4, kSecond: null, secondArm: 'the memory arm' });
    expect(parity.gate).toBeNull();
    expect(parity.absent).toContain('the memory arm stated no `metrics.k`');
    expect(parity.kFirst).toBe(4);
    expect(parity.kSecond).toBeNull();
  });

  it('names every silent arm, so a reader knows which file to open', () => {
    const parity = metricParityOf({ kFirst: undefined, kSecond: null });
    expect(parity.gate).toBeNull();
    expect(parity.absent).toContain('first and second stated no `metrics.k`');
    expect(parity.barKMismatch).toBeNull();
  });

  it('says no bar applies rather than reporting a mismatch against nothing', () => {
    const parity = metricParityOf({ kFirst: 4, kSecond: 4, barK: null });
    expect(parity.gate?.pass).toBe(true);
    expect(parity.barK).toBeNull();
    expect(parity.barKMismatch).toBeNull();
    expect(parity.gate?.actual).toContain('no published bar applies to this scenario');
  });

  it('refuses a level that is not a count of trials', () => {
    // A `k` of zero or a fractional `k` is a driver defect, and reading it as a level would grade a pair
    // against a statistic that does not exist.
    expect(() => metricParityOf({ kFirst: 0, kSecond: 4 })).toThrow(/kFirst must be a positive integer/);
    expect(() => metricParityOf({ kFirst: 4, kSecond: 1.5 })).toThrow(/kSecond must be a positive integer/);
    expect(() => metricParityOf({ kFirst: 4, kSecond: 4, barK: -2 })).toThrow(/barK must be a positive integer/);
    expect(() => metricParityOf({ kFirst: Number.NaN, kSecond: 4 })).toThrow(/positive integer/);
  });
});

describe('the line a readback prints', () => {
  it('prints the shared level and the bar in one sentence', () => {
    const line = metricParityLine(metricParityOf({ kFirst: 4, kSecond: 4, barK: 4 }));
    expect(line).toBe('metric: k = 4; the bar\'s k = 4 matches');
  });

  it('prints the disagreement without inventing a level', () => {
    const line = metricParityLine(metricParityOf({ kFirst: 2, kSecond: 3 }));
    expect(line).toBe('metric: the arms disagree');
  });

  it('prints the omission when there is no level to print', () => {
    const line = metricParityLine(metricParityOf({ kFirst: null, kSecond: null }));
    expect(line.startsWith('metric: first and second stated no')).toBe(true);
  });

  it('prints the cross-metric warning when the pair and the bar differ', () => {
    const line = metricParityLine(metricParityOf({ kFirst: 1, kSecond: 1, barK: 4 }));
    expect(line).toContain('cross-metric as well as cross-sample');
  });
});

describe('restating a rate at the bar\u2019s level', () => {
  it('raises a per-trial rate to the power the bar is written in', () => {
    // The four registrations behind `poc-l4-pair-*` all declare `trials: 1`, so 0.925 is the share of tasks
    // that passed their one trial. At `pass^4` — the level of both published bars — the same per-trial rate
    // reads 0.925⁴ = 0.7321, not 0.925.
    expect(restateAtLevel(0.925, 1, 4)).toBeCloseTo(0.7321, 4);
    expect(restateAtLevel(0.85, 1, 4)).toBeCloseTo(0.522, 4);
    // Downward is the inverse, and round-tripping returns the original rate.
    expect(restateAtLevel(restateAtLevel(0.85, 1, 4), 4, 1)).toBeCloseTo(0.85, 12);
    expect(restateAtLevel(0.5, 2, 2)).toBe(0.5);
  });

  it('keeps the two endpoints where they belong', () => {
    expect(restateAtLevel(0, 1, 4)).toBe(0);
    expect(restateAtLevel(1, 1, 4)).toBe(1);
  });

  it('refuses a rate that is not a share, and a level that is not a trial count', () => {
    expect(() => restateAtLevel(1.2, 1, 4)).toThrow(/rate must be a share/);
    expect(() => restateAtLevel(-0.1, 1, 4)).toThrow(/rate must be a share/);
    expect(() => restateAtLevel(0.5, 0, 4)).toThrow(/fromK must be a positive integer/);
    expect(() => restateAtLevel(0.5, 1, 2.5)).toThrow(/toK must be a positive integer/);
  });
});
