import { describe, expect, it } from 'vitest';
import {
  endpointsAgree,
  pairedRateDelta,
  tasksForEffectPp,
  type TaskRate,
} from '../paired-rate.js';

const task = (id: string, successes: number, trials = 4): TaskRate => ({ id, successes, trials });

describe('pairedRateDelta', () => {
  it('reports a zero difference and no spread for two arms that scored the same', () => {
    const arm = [task('a', 4), task('b', 3), task('c', 0)];
    const delta = pairedRateDelta(arm, arm);
    expect(delta.pairs).toBe(3);
    expect(delta.deltaPp).toBe(0);
    expect(delta.sdPp).toBe(0);
    expect(delta.sePp).toBe(0);
    expect(delta.ciLowPp).toBe(0);
    expect(delta.ciHighPp).toBe(0);
    // A standard error of zero makes a ratio undefined rather than infinite: the arms did not
    // differ, and `z` of a difference that has no spread is not a large number, it is no number.
    expect(delta.z).toBeNull();
    expect(delta.up).toBe(0);
    expect(delta.down).toBe(0);
    expect(delta.tied).toBe(3);
  });

  it('prices a quarter of a trial as a quarter, which is what the binary endpoint cannot do', () => {
    // Four tasks, one of which went from three of four to four of four. `pass^4` sees one task
    // change hands; this sees +6.25pp with a standard error of exactly the same size.
    const first = [task('a', 4), task('b', 3), task('c', 3), task('d', 3)];
    const second = [task('a', 3), task('b', 3), task('c', 3), task('d', 3)];
    const delta = pairedRateDelta(first, second);
    expect(delta.deltaPp).toBeCloseTo(6.25, 10);
    expect(delta.sdPp).toBeCloseTo(12.5, 10);
    expect(delta.sePp).toBeCloseTo(6.25, 10);
    expect(delta.z).toBeCloseTo(1, 10);
    expect(delta.up).toBe(1);
    expect(delta.tied).toBe(3);
  });

  it('narrows the interval by keeping the trials the binary endpoint discards', () => {
    // The same sixteen observations read two ways. The binary endpoint counts the one task that
    // reached four of four as +1/4 of the sample; the rate endpoint counts every moved trial, so
    // its interval has to be the narrower of the two. This is the whole argument for a second
    // reading, stated as an inequality rather than as a claim about any arm.
    const first = [task('a', 4), task('b', 4), task('c', 2), task('d', 1)];
    const second = [task('a', 3), task('b', 4), task('c', 3), task('d', 2)];
    const rate = pairedRateDelta(first, second);
    const binaryPp = (100 * (1 - 0)) / 4;
    const binarySePp = 100 * Math.sqrt(1 / 4);
    expect(rate.deltaPp).toBeLessThan(binaryPp);
    expect(rate.sePp).not.toBeNull();
    expect(rate.sePp as number).toBeLessThan(binarySePp);
  });

  it('is symmetric: swapping the arms negates the delta and exchanges the directions', () => {
    const first = [task('a', 4), task('b', 1), task('c', 2), task('d', 3)];
    const second = [task('a', 2), task('b', 3), task('c', 2), task('d', 4)];
    const forward = pairedRateDelta(first, second);
    const backward = pairedRateDelta(second, first);
    expect(backward.deltaPp).toBeCloseTo(-forward.deltaPp, 10);
    expect(backward.up).toBe(forward.down);
    expect(backward.down).toBe(forward.up);
    expect(backward.tied).toBe(forward.tied);
    expect(backward.sePp).toBeCloseTo(forward.sePp as number, 10);
  });

  it('counts the tasks one arm scored and the other did not, and leaves them out of the mean', () => {
    const first = [task('a', 4), task('b', 1)];
    const second = [task('a', 2), task('c', 3)];
    const delta = pairedRateDelta(first, second);
    expect(delta.pairs).toBe(1);
    expect(delta.onlyFirst).toBe(1);
    expect(delta.onlySecond).toBe(1);
    // One pair: the mean is the one difference and the spread is unknown, so the interval is not
    // printed at all rather than printed as a point.
    expect(delta.deltaPp).toBeCloseTo(50, 10);
    expect(delta.sePp).toBeNull();
    expect(delta.ciLowPp).toBeNull();
    expect(delta.z).toBeNull();
    expect(delta.minDetectablePp).toBeNull();
  });

  it('drops a task with no trials instead of reading it as a total failure', () => {
    const first = [task('a', 4), task('b', 0, 0)];
    const second = [task('a', 4), task('b', 0, 0)];
    const delta = pairedRateDelta(first, second);
    expect(delta.pairs).toBe(1);
    expect(delta.onlyFirst).toBe(0);
    expect(delta.deltaPp).toBe(0);
  });

  it('reports a pair with no tasks in common as no pair rather than as no difference', () => {
    // Two arms scored on two disjoint halves. The delta is not zero because the arms agreed; there
    // is nothing to agree about, and the counts are what say so.
    const delta = pairedRateDelta([task('a', 4), task('b', 3)], [task('c', 4), task('d', 1)]);
    expect(delta.pairs).toBe(0);
    expect(delta.deltaPp).toBe(0);
    expect(delta.sePp).toBeNull();
    expect(delta.onlyFirst).toBe(2);
    expect(delta.onlySecond).toBe(2);
    expect(delta.up + delta.down + delta.tied).toBe(0);
  });

  it('puts the minimum detectable difference at 2.802 standard errors', () => {
    const first = [task('a', 4), task('b', 4), task('c', 4), task('d', 0)];
    const second = [task('a', 2), task('b', 2), task('c', 3), task('d', 2)];
    const delta = pairedRateDelta(first, second);
    expect(delta.sePp).not.toBeNull();
    expect(delta.minDetectablePp).toBeCloseTo(2.802 * (delta.sePp as number), 10);
  });
});

describe('tasksForEffectPp', () => {
  const first = [task('a', 4), task('b', 4), task('c', 4), task('d', 0)];
  const second = [task('a', 2), task('b', 2), task('c', 3), task('d', 2)];

  it('scales as the inverse square of the effect and the square of the spread', () => {
    const delta = pairedRateDelta(first, second);
    const three = tasksForEffectPp(delta, 3) as number;
    const six = tasksForEffectPp(delta, 6) as number;
    // Halving the effect quadruples the sample. The ratio is the check that the formula is the
    // one `power.ts` uses rather than a number that happens to look plausible.
    expect(three).toBeGreaterThan(0);
    expect(six).toBeGreaterThan(0);
    const asIf = Math.ceil(((2.802 * delta.sdPp) / 3) ** 2);
    expect(three).toBe(asIf);
    expect(six).toBeLessThan(three);
  });

  it('refuses a target it cannot price rather than returning a sample of one', () => {
    const onePair = pairedRateDelta([task('a', 4)], [task('a', 2)]);
    expect(tasksForEffectPp(onePair, 3)).toBeNull();
    expect(tasksForEffectPp(pairedRateDelta(first, second), 0)).toBeNull();
    expect(tasksForEffectPp(pairedRateDelta(first, second), -3)).toBeNull();
  });
});

describe('endpointsAgree', () => {
  it('reports a sign conflict, which is the reading that stops a report quoting one endpoint', () => {
    // R58's shape: ten tasks lifted to perfect against fourteen lowered by more than a quarter.
    const agreement = endpointsAgree(1.754, -1.32);
    expect(agreement.agree).toBe(false);
    expect(agreement.binaryPp).toBeCloseTo(1.754, 10);
    expect(agreement.ratePp).toBeCloseTo(-1.32, 10);
  });

  it('treats a tie on either endpoint as agreement', () => {
    expect(endpointsAgree(0, -4).agree).toBe(true);
    expect(endpointsAgree(3, 0).agree).toBe(true);
    expect(endpointsAgree(0, 0).agree).toBe(true);
    expect(endpointsAgree(2, 2).agree).toBe(true);
    expect(endpointsAgree(-2, -2).agree).toBe(true);
  });
});
