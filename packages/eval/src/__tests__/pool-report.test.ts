import { describe, expect, it } from 'vitest';
import { execSignatureOf } from '../exec-signature.js';
import { poolReport, type PoolReportQuestion } from '../pool-report.js';

const SHAPE = {
  wantsMany: false,
  wantsCount: false,
  wantsAverage: false,
  wantsMissing: false,
  wantsDistinct: false,
};

function ran(rows: number) {
  return execSignatureOf({
    rows: Array.from({ length: rows }, (_, index) => [`v${index}`]),
    columns: ['c'],
    failed: false,
  });
}

function question(id: string, keys: readonly number[], correct: readonly boolean[]): PoolReportQuestion {
  return {
    id,
    shape: SHAPE,
    candidates: keys.map((resultKey, draw) => ({
      draw,
      correct: correct[draw] === true,
      resultKey,
      signature: resultKey < 0 ? null : ran(resultKey + 1),
    })),
  };
}

describe('poolReport', () => {
  it('calls a pool where the draws collapsed narrow, whatever the selector does', () => {
    // Five draws, one answer, five spellings: the ceiling cannot be reached because it is already
    // held. This is the R7.1 refutation condition, and it is read before any selector is built.
    const report = poolReport(
      [question('q1', [0, 0, 0, 0, 0], [false, false, false, false, false])],
      5,
    );
    expect(report.summary.distinctMedian).toBe(1);
    expect(report.verdict).toBe('narrow');
  });

  it('calls a pool wide when most draws produced a different answer', () => {
    const report = poolReport(
      [
        question('q1', [0, 1, 2, 3, 4], [false, false, true, false, false]),
        question('q2', [0, 1, 2, 3, 3], [false, true, false, false, false]),
        question('q3', [0, 1, 2, 2, 1], [true, false, false, false, false]),
      ],
      5,
    );
    expect(report.summary.distinctMedian).toBe(4);
    expect(report.verdict).toBe('wide');
  });

  it('refuses to call it either way in between, rather than rounding to a finding', () => {
    // Two distinct answers from five draws is 0.4 of the draws: above the collapse bar and below
    // the diversity bar, and the honest reading of that is "we do not know yet".
    const report = poolReport(
      [question('q1', [0, 0, 1, 1, 1], [false, false, true, false, false])],
      5,
    );
    expect(report.summary.distinctMedian).toBe(2);
    expect(report.verdict).toBe('between');
  });

  it('computes the median against the draws actually taken, not against five', () => {
    // A three-draw run that collapses to two answers is not the same pool as a five-draw run that
    // does, and reading the median against a constant five would call it narrow.
    const three = poolReport([question('q1', [0, 1, 2], [false, true, false])], 3);
    expect(three.verdict).toBe('wide');
  });

  it('prices every signal and licenses none of them', () => {
    // The decision of which signal may rank anything belongs to `signal-gate.ts`, which corrects for
    // the family and floors the standard error. A second verdict here would be a second rule, and the
    // artefact would carry two answers to one question.
    const questions = [
      question('q1', [0, 1], [false, true]),
      question('q2', [0, 1], [false, true]),
      question('q3', [0, 1], [false, true]),
      question('q4', [0, 1], [false, true]),
    ];
    const report = poolReport(questions, 2);
    expect(report.signals.map((entry) => entry.signal)).toEqual([
      'draw-order',
      'empty',
      'row-shape',
      'column-shape',
      'null-share',
      'duplicate-share',
      'value-type',
    ]);
    expect('shortlist' in report).toBe(false);
  });

  it('reports the ceiling the pool offers, in points, as the share of questions it could move', () => {
    const report = poolReport(
      [
        question('q1', [0, 1], [false, true]),
        question('q2', [0, 1], [true, false]),
        question('q3', [0, 1], [false, false]),
        question('q4', [0, 1], [false, false]),
      ],
      2,
    );
    expect(report.summary.oracle).toBe(2);
    expect(report.summary.ceilingOnly).toBe(1);
    expect(report.ceilingPp).toBe(25);
  });

  it('treats a run with no recorded draw count as one draw rather than dividing by zero', () => {
    const report = poolReport([question('q1', [0, 0], [false, false])], 0);
    expect(Number.isFinite(report.distinctShare)).toBe(true);
    expect(report.distinctShare).toBe(1);
    expect(report.verdict).toBe('wide');
  });

  it('reports zero ceiling rather than NaN when there were no questions', () => {
    const report = poolReport([], 5);
    expect(report.ceilingPp).toBe(0);
    expect(report.verdict).toBe('narrow');
    expect(Number.isNaN(report.summary.distinctMean)).toBe(false);
  });
});
