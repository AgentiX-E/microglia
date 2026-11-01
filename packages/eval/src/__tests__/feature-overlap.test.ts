/**
 * The overlap reading, tested on corpora whose answer is known by construction.
 *
 * The function decides whether a second covariate is a second cause, and the way it can be wrong is
 * the way all arithmetic here is wrong: by agreeing with itself. So the fixtures below do not check
 * that the sums add up — they check the three cases a reader has to be able to tell apart, each with
 * a hand-built corpus where the intended answer is the only possible one.
 */
import { describe, expect, it } from 'vitest';
import { featureOverlapOf } from '../feature-overlap.js';
import type { DiffCase } from '../query-diff.js';
import type { QueryDelta } from '../sql-diff.js';

/** A case whose two features are given, and whose outcome is given too. */
function entry(
  id: string,
  options: { left: boolean; right: boolean; correct: boolean; withoutMemoryCorrect: boolean; dbId?: string },
): DiffCase {
  return {
    id,
    dbId: options.dbId ?? 'db',
    correct: options.correct,
    withoutMemoryCorrect: options.withoutMemoryCorrect,
    // Only the two fields the predicates read are populated; the rest of a `QueryDelta` is noise
    // here, and building a real one would test the tokeniser instead of the contingency table.
    delta: {
      ungrounded: options.left ? ['x'] : [],
      tablesAdded: options.right ? ['t'] : [],
    } as unknown as QueryDelta,
  };
}

const LEFT = (delta: QueryDelta): boolean => delta.ungrounded.length > 0;
const RIGHT = (delta: QueryDelta): boolean => delta.tablesAdded.length > 0;

describe('the contingency table', () => {
  const cases = [
    entry('both', { left: true, right: true, correct: false, withoutMemoryCorrect: true }),
    entry('left', { left: true, right: false, correct: false, withoutMemoryCorrect: true }),
    entry('right', { left: false, right: true, correct: true, withoutMemoryCorrect: true }),
    entry('neither', { left: false, right: false, correct: true, withoutMemoryCorrect: false }),
  ];

  it('sorts every question into exactly one cell', () => {
    const reading = featureOverlapOf('F1', 'F4', cases, LEFT, RIGHT, 200);
    expect([reading.both, reading.leftOnly, reading.rightOnly, reading.neither]).toEqual([1, 1, 1, 1]);
  });

  it('measures the overlap against the left feature, which is the registered denominator', () => {
    // `both / (both + leftOnly)` = 1/2. The denominator is the left feature because the question is
    // "how much of the finding this project already has does the new one explain", and a share of
    // the union would answer a different question with the same word.
    const reading = featureOverlapOf('F1', 'F4', cases, LEFT, RIGHT, 200);
    expect(reading.overlapShare).toBeCloseTo(0.5, 10);
    expect(reading.jaccard).toBeCloseTo(1 / 3, 10);
  });

  it('scores the left feature on the questions the right one does not cover', () => {
    // Not the same as the marginal: `leftOutsideRight` here is one case that destroyed an answer.
    const reading = featureOverlapOf('F1', 'F4', cases, LEFT, RIGHT, 200);
    expect(reading.leftOutsideRight.n).toBe(1);
    expect(reading.leftOutsideRight.deltaPp).toBeCloseTo(-100, 6);
  });
});

describe('the reading that decides whether there are two causes', () => {
  it('reports nothing outside the overlap when every harmed question is in it', () => {
    // The shadow case. Both harmed questions carry both features, so removing the overlap removes
    // the entire effect: the second feature is the first one counted twice.
    const cases = [
      entry('a', { left: true, right: true, correct: false, withoutMemoryCorrect: true }),
      entry('b', { left: true, right: true, correct: false, withoutMemoryCorrect: true }),
      entry('c', { left: true, right: false, correct: true, withoutMemoryCorrect: true }),
      entry('d', { left: false, right: false, correct: true, withoutMemoryCorrect: true }),
    ];
    const reading = featureOverlapOf('F1', 'F4', cases, LEFT, RIGHT, 200);
    expect(reading.rightOnly).toBe(0);
    expect(reading.rightOutsideLeft.n).toBe(0);
    expect(reading.rightOutsideLeft.deltaPp).toBeNull();
    // And the marginal reading still says the right feature is harmful, which is what makes the
    // outside reading necessary rather than redundant.
    expect(reading.right.deltaPp).toBeLessThan(0);
  });

  it('finds a second cause when the harm survives outside the overlap', () => {
    const cases = [
      entry('a', { left: true, right: true, correct: false, withoutMemoryCorrect: true }),
      entry('b', { left: false, right: true, correct: false, withoutMemoryCorrect: true }),
      entry('c', { left: false, right: true, correct: false, withoutMemoryCorrect: true }),
      entry('d', { left: false, right: false, correct: true, withoutMemoryCorrect: true }),
    ];
    const reading = featureOverlapOf('F1', 'F4', cases, LEFT, RIGHT, 200);
    expect(reading.rightOutsideLeft.n).toBe(2);
    expect(reading.rightOutsideLeft.deltaPp).toBeCloseTo(-100, 6);
  });

  it('reports a share of zero for a left feature that no question carries', () => {
    // A share of 0 rather than a NaN: "no question carries the left feature" means the overlap
    // question does not arise, and the criterion is then not met because there is nothing to meet it
    // about — which the caller must not read as "the features are distinct".
    const reading = featureOverlapOf('F1', 'F4', [entry('a', { left: false, right: true, correct: true, withoutMemoryCorrect: true })], LEFT, RIGHT, 100);
    expect(reading.overlapShare).toBe(0);
    expect(reading.criterionMet).toBe(false);
  });
});

describe('the criterion', () => {
  it('publishes the bar it applies, so it cannot be changed quietly', () => {
    const reading = featureOverlapOf('F1', 'F4', [], LEFT, RIGHT, 100);
    expect(reading.criterion).toBe("fewer than 50% of the left feature's questions also carry the right (both / left)");
    expect(reading.criterionMet).toBe(false);
  });

  it('is met at forty-nine percent and not at fifty', () => {
    // The boundary is where a reader would look. 49 questions carrying both and 51 carrying only the
    // left is met; 50 and 50 is not, because the bar is "fewer than half".
    const build = (both: number, leftOnly: number): DiffCase[] => [
      ...Array.from({ length: both }, (_, at) => entry(`b${at}`, { left: true, right: true, correct: true, withoutMemoryCorrect: true })),
      ...Array.from({ length: leftOnly }, (_, at) => entry(`l${at}`, { left: true, right: false, correct: true, withoutMemoryCorrect: true })),
    ];
    expect(featureOverlapOf('F1', 'F4', build(49, 51), LEFT, RIGHT, 50).criterionMet).toBe(true);
    expect(featureOverlapOf('F1', 'F4', build(50, 50), LEFT, RIGHT, 50).criterionMet).toBe(false);
  });
});
