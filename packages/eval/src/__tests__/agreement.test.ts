import { describe, expect, it } from 'vitest';
import {
  agreementReport,
  bootstrapCI,
  cohenKappa,
  confusionOf,
  mccOf,
  raterAgreement,
  type JudgedPair,
  type RaterLabels,
} from '../agreement.js';

const pairsOf = (reference: readonly boolean[], measured: readonly boolean[]): JudgedPair[] =>
  reference.map((value, index) => ({ reference: value, measured: measured[index] === true }));

describe('confusionOf', () => {
  it('files each item under the rater that said true', () => {
    const confusion = confusionOf(pairsOf([true, true, false, false], [true, false, true, false]));
    expect(confusion).toEqual({ both: 1, referenceOnly: 1, measuredOnly: 1, neither: 1 });
  });

  it('counts neither cell for an empty set', () => {
    expect(confusionOf([])).toEqual({ both: 0, measuredOnly: 0, referenceOnly: 0, neither: 0 });
  });
});

describe('cohenKappa', () => {
  it('is 1 when the raters agree on a set that is not constant', () => {
    expect(cohenKappa(pairsOf([true, true, false, false], [true, true, false, false]))).toBe(1);
  });

  it('is -1 when the raters are exact opposites', () => {
    expect(cohenKappa(pairsOf([true, true, false, false], [false, false, true, true]))).toBe(-1);
  });

  it('is not estimable on an empty set, rather than 0', () => {
    expect(cohenKappa([])).toBeUndefined();
  });

  it('is not estimable when both raters are constant and identical', () => {
    // Chance agreement is 1, so there is no denominator. Reporting 0 here would be
    // the opposite of the truth: the raters never disagreed at all.
    expect(cohenKappa(pairsOf([true, true, true], [true, true, true]))).toBeUndefined();
    expect(cohenKappa(pairsOf([false, false], [false, false]))).toBeUndefined();
  });

  it('is 0 when the measured rater follows chance exactly', () => {
    // Reference half positive, measured half positive, and independent of each other.
    const reference = [true, true, false, false];
    const measured = [true, false, true, false];
    expect(cohenKappa(pairsOf(reference, measured))).toBeCloseTo(0, 10);
  });
});

describe('mccOf', () => {
  it('is 1 on perfect agreement and -1 on perfect disagreement', () => {
    expect(mccOf({ both: 5, measuredOnly: 0, referenceOnly: 0, neither: 5 })).toBe(1);
    expect(mccOf({ both: 0, measuredOnly: 5, referenceOnly: 5, neither: 0 })).toBe(-1);
  });

  it('is not estimable when a whole row or column is empty', () => {
    // Every item positive on both sides: the negatives column is empty, so there is
    // no correlation to measure even though every verdict matched.
    expect(mccOf({ both: 5, measuredOnly: 0, referenceOnly: 0, neither: 0 })).toBeUndefined();
    expect(mccOf({ both: 0, measuredOnly: 0, referenceOnly: 0, neither: 5 })).toBeUndefined();
    expect(mccOf({ both: 0, measuredOnly: 0, referenceOnly: 5, neither: 0 })).toBeUndefined();
    expect(mccOf({ both: 0, measuredOnly: 5, referenceOnly: 0, neither: 0 })).toBeUndefined();
  });
});

describe('agreementReport', () => {
  it('names the reason an empty set cannot answer the question', () => {
    const report = agreementReport([]);
    expect(report.n).toBe(0);
    expect(report.kappa).toBeUndefined();
    expect(report.kappaCI).toBeUndefined();
    expect(report.notEstimable).toBe('no-items');
    expect(report.accuracy).toBe(0);
    // Both raters have zero marginals on an empty set, so chance agreement is total.
    expect(report.expected).toBe(1);
  });

  it('says chance agreement, not chance level, when both raters are constant', () => {
    const report = agreementReport(pairsOf([true, true, true], [true, true, true]));
    expect(report.notEstimable).toBe('chance-agreement-is-total');
    expect(report.expected).toBe(1);
    expect(report.accuracy).toBe(1);
  });

  it('brackets the point estimate with an interval over items', () => {
    const reference = Array.from({ length: 120 }, (_, index) => index % 3 !== 0);
    const measured = reference.map((value, index) => (index % 11 === 0 ? !value : value));
    const report = agreementReport(pairsOf(reference, measured), { seed: 7, resamples: 400 });
    expect(report.notEstimable).toBeUndefined();
    expect(report.kappa).toBeGreaterThan(0.5);
    const interval = report.kappaCI;
    expect(interval).toBeDefined();
    expect(interval!.low).toBeLessThanOrEqual(report.kappa as number);
    expect(interval!.high).toBeGreaterThanOrEqual(report.kappa as number);
    expect(interval!.point).toBe(report.kappa);
  });

  it('is deterministic for a given seed', () => {
    const reference = Array.from({ length: 60 }, (_, index) => index % 2 === 0);
    const measured = reference.map((value, index) => (index % 7 === 0 ? !value : value));
    const first = agreementReport(pairsOf(reference, measured), { seed: 99, resamples: 200 });
    const second = agreementReport(pairsOf(reference, measured), { seed: 99, resamples: 200 });
    expect(first.kappaCI).toEqual(second.kappaCI);
  });

  it('reports prevalence, because kappa depends on it', () => {
    const report = agreementReport(pairsOf([true, true, true, false], [true, true, false, false]));
    expect(report.prevalence.reference).toBeCloseTo(0.75, 10);
    expect(report.prevalence.measured).toBeCloseTo(0.5, 10);
    expect(report.confusion.both).toBe(2);
  });
});

describe('raterAgreement', () => {
  const labels = (entries: readonly (readonly [string, boolean])[]): RaterLabels => new Map(entries);

  it('pairs only the items two raters both saw', () => {
    const a = labels([
      ['1', true],
      ['2', false],
      ['3', true],
    ]);
    const b = labels([
      ['1', true],
      ['2', false],
    ]);
    const agreement = raterAgreement([a, b]);
    expect(agreement.raters).toBe(2);
    expect(agreement.sharedItems).toBe(2);
    expect(agreement.pairs).toHaveLength(1);
    expect(agreement.pairs[0]?.n).toBe(2);
    expect(agreement.pairs[0]?.kappa).toBe(1);
    expect(agreement.meanKappa).toBe(1);
  });

  it('reports every pair and the mean over the estimable ones', () => {
    const a = labels([
      ['1', true],
      ['2', false],
      ['3', true],
      ['4', false],
    ]);
    const b = labels([
      ['1', true],
      ['2', false],
      ['3', false],
      ['4', true],
    ]);
    // Third rater saw only two items and agreed with nobody.
    const c = labels([
      ['1', true],
      ['2', false],
    ]);
    const agreement = raterAgreement([a, b, c]);
    expect(agreement.pairs).toHaveLength(3);
    expect(agreement.sharedItems).toBe(4);
    expect(agreement.meanKappa).toBeLessThan(1);
    expect(agreement.meanKappa).toBeGreaterThan(-1);
  });

  it('leaves the mean undefined when no pair could be estimated', () => {
    const agreement = raterAgreement([labels([['1', true]]), labels([['1', true]])]);
    expect(agreement.pairs[0]?.kappa).toBeUndefined();
    expect(agreement.meanKappa).toBeUndefined();
    expect(agreement.sharedItems).toBe(1);
  });

  it('ignores raters that share nothing', () => {
    const agreement = raterAgreement([labels([['1', true]]), labels([['2', false]])]);
    expect(agreement.pairs[0]?.n).toBe(0);
    expect(agreement.sharedItems).toBe(0);
  });
});

describe('bootstrapCI', () => {
  it('is reachable through this module so a study can use one interval implementation', () => {
    const interval = bootstrapCI([1, 2, 3, 4], undefined, 200);
    expect(interval.point).toBeCloseTo(2.5, 10);
    expect(interval.low).toBeLessThanOrEqual(interval.point);
    expect(interval.high).toBeGreaterThanOrEqual(interval.point);
  });
});
