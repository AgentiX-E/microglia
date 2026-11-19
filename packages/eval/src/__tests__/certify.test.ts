import { describe, expect, it } from 'vitest';
import { certificationLine, certificationOf, changePriceOf, passesToCertify, upperBoundOf } from '../certify.js';
import { tasksForDelta } from '../detectable.js';

/**
 * Two prices for one target.
 *
 * R155 produced `b* = 10.78%` — the break rate at which this store's repairs stop paying for its breaks —
 * and left two questions unpriced: how many passes it takes to *certify* a level under that bar, and how
 * many pairs it takes to *detect* a move from where the store is to where it needs to be. These tests pin
 * both, and pin the property that makes the first one more than arithmetic: a rate sitting at its own bar
 * cannot be certified below it at any sample size.
 */

describe('the interval a pass count can certify', () => {
  it('is the Wilson upper end the repository already computes', () => {
    // 8% over 167 passes: the interval's top is 13.1%, not the 12.1% a normal approximation would print —
    // which is the whole reason this reads `wilsonInterval` rather than re-deriving one.
    expect(upperBoundOf(0.08, 167)).toBeCloseTo(0.1312, 4);
    expect(upperBoundOf(0, 40)).toBeGreaterThan(0);
    expect(upperBoundOf(1, 40)).toBe(1);
  });

  it('shrinks as the sample grows, which is the assumption the search is built on', () => {
    // A bisection over a function that is not monotone returns a number that looks like an answer. This
    // checks the assumption over the grid the function is ever called on, rather than asserting it here
    // and relying on it three files away.
    for (let rate = 0.01; rate < 1; rate += 0.02) {
      let previous = Number.POSITIVE_INFINITY;
      for (let n = 1; n <= 600; n += 1) {
        const upper = upperBoundOf(rate, n);
        expect(upper).toBeLessThanOrEqual(previous + 1e-12);
        previous = upper;
      }
    }
  });

  it('refuses inputs that are not a rate over a count', () => {
    expect(() => upperBoundOf(1.2, 40)).toThrow(/rate must be a share in \[0, 1\]/);
    expect(() => upperBoundOf(-0.1, 40)).toThrow(/rate must be a share/);
    expect(() => upperBoundOf(0.1, 0)).toThrow(/n must be a positive whole number/);
    expect(() => upperBoundOf(0.1, 2.5)).toThrow(/n must be a positive whole number/);
  });
});

describe('the passes a bar costs', () => {
  it('returns the smallest count whose interval clears the bar', () => {
    const needed = passesToCertify(0.1078, 0.08);
    expect(needed).toBe(479);
    // The boundary invariant, checked here as well as inside the search: one pass fewer does not clear it.
    expect(upperBoundOf(0.08, needed as number)).toBeLessThanOrEqual(0.1078);
    expect(upperBoundOf(0.08, (needed as number) - 1)).toBeGreaterThan(0.1078);
  });

  it('costs more the closer the store sits to its own bar', () => {
    const low = passesToCertify(0.1078, 0.02) as number;
    const middle = passesToCertify(0.1078, 0.0539) as number;
    const high = passesToCertify(0.1078, 0.08) as number;
    expect(low).toBeLessThan(middle);
    expect(middle).toBeLessThan(high);
    expect(passesToCertify(0.1078, 0.0539)).toBe(128);
  });

  it('has no answer for a rate at or above its own bar', () => {
    // Not a failed search: the upper end is always above the estimate, so no sample certifies a store
    // sitting on the bar as being under it. This is the finding that says the target must be reached
    // rather than measured again, and it is why the next dispatch is a change rather than a fifth draw.
    expect(passesToCertify(0.1078, 0.1078)).toBeNull();
    expect(passesToCertify(0.1078, 0.1617)).toBeNull();
  });

  it('refuses a target it could not be asked about', () => {
    expect(() => passesToCertify(0, 0.01)).toThrow(/target must be positive/);
    expect(() => passesToCertify(1.5, 0.01)).toThrow(/target must be a share/);
    expect(() => passesToCertify(0.1, -0.5)).toThrow(/planned must be a share/);
  });
});

describe('the pairs a change costs', () => {
  it('converts a fall in the rate into the fall in the delta it causes', () => {
    // The rate is over passes; the delta is over every trial. `(16.17% − 10.78%) × 86.08% = 4.64pp` is
    // the effect the change would have on the headline number.
    const price = changePriceOf({ from: 0.1617, to: 0.1078, passShare: 0.8608, discordance: 0.232 });
    expect(price.effect).toBeCloseTo(0.0464, 4);
  });

  it('prices the two ends of what is knowable before the run', () => {
    const price = changePriceOf({ from: 0.1617, to: 0.1078, passShare: 0.8608, discordance: 0.232 });
    // Nested: every remaining break was already a break, so the discordance *is* the effect and
    // `tasksForDelta` collapses to `z²/effect` — 170 pairs.
    expect(price.nested).toBe(tasksForDelta(price.effect, price.effect));
    expect(price.nested).toBe(170);
    // Unrelated: the corpus's own discordance, which is what a reordering of the breaks would look like.
    expect(price.independent).toBe(tasksForDelta(price.effect, 0.232));
    expect(price.independent).toBe(847);
    expect(price.discordance).toBe(0.232);
  });

  it('never prices a change below its own nested floor', () => {
    // The corpus discordance is smaller than the effect in a large enough change, and taking the smaller
    // of the two would price a design that cannot see it. The ceiling is a maximum for that reason.
    const price = changePriceOf({ from: 0.6, to: 0.1, passShare: 0.9, discordance: 0.01 });
    expect(price.discordance).toBe(price.effect);
    expect(price.independent).toBe(price.nested);
  });

  it('prices no change at infinity rather than at zero', () => {
    const price = changePriceOf({ from: 0.1617, to: 0.1617, passShare: 0.86, discordance: 0.23 });
    expect(price.nested).toBe(Number.POSITIVE_INFINITY);
    expect(price.independent).toBe(Number.POSITIVE_INFINITY);
  });

  it('refuses a reduction that raises the rate, and inputs that are not shares', () => {
    expect(() => changePriceOf({ from: 0.1, to: 0.2, passShare: 0.9, discordance: 0.2 })).toThrow(
      /a reduction cannot raise the rate/,
    );
    expect(() => changePriceOf({ from: 1.4, to: 0.2, passShare: 0.9, discordance: 0.2 })).toThrow(/from must be a share/);
    expect(() => changePriceOf({ from: 0.4, to: -0.2, passShare: 0.9, discordance: 0.2 })).toThrow(/to must be a share/);
    expect(() => changePriceOf({ from: 0.4, to: 0.2, passShare: 1.9, discordance: 0.2 })).toThrow(
      /passShare must be a share/,
    );
    expect(() => changePriceOf({ from: 0.4, to: 0.2, passShare: 0.9, discordance: -1 })).toThrow(
      /discordance must be a share/,
    );
  });
});

describe('the reading and its sentence', () => {
  it('reports the bar a fold can certify and whether it reaches the target', () => {
    const reading = certificationOf({ target: 0.1078, planned: 0.0808, passes: 167 });
    expect(reading.upper).toBeCloseTo(0.1322, 4);
    expect(reading.certified).toBe(false);
    expect(reading.needed).toBe(507);
    const line = certificationLine(reading);
    expect(line).toContain('at 167 pass(es) a 8.08% break rate is certified only below 13.22%');
    expect(line).toContain('does not reach the 10.78% bar');
    expect(line).toContain('takes 507 pass(es)');
  });

  it('certifies a target above its own upper end', () => {
    const reading = certificationOf({ target: 0.2, planned: 0.0808, passes: 167 });
    expect(reading.certified).toBe(true);
    expect(certificationLine(reading)).toContain('which reaches the 20.00% bar');
  });

  it('says a rate at its own bar can never be certified', () => {
    const reading = certificationOf({ target: 0.1078, planned: 0.1078, passes: 167 });
    expect(reading.needed).toBeNull();
    expect(certificationLine(reading)).toContain('no sample certifies a rate at or above its own bar');
  });

  it('refuses a fold with no pass in it', () => {
    expect(() => certificationOf({ target: 0.1, planned: 0.02, passes: 0 })).toThrow(/passes must be a positive whole number/);
    expect(() => certificationOf({ target: 0.1, planned: 0.02, passes: 2.5 })).toThrow(/passes must be a positive/);
    expect(() => certificationOf({ target: 0, planned: 0.02, passes: 10 })).toThrow(/target must be positive/);
  });
});
