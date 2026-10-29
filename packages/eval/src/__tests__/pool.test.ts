import { describe, expect, it } from 'vitest';
import { execSignatureOf, type ExecSignature } from '../exec-signature.js';
import { poolSummary, signalReading, signalReadings, type PoolCandidate, type PoolQuestion } from '../pool.js';
import type { QuestionShape } from '../exec-signature.js';

const NO_SHAPE: QuestionShape = {
  wantsMany: false,
  wantsCount: false,
  wantsAverage: false,
  wantsMissing: false,
  wantsDistinct: false,
};

const LIST_SHAPE: QuestionShape = { ...NO_SHAPE, wantsMany: true };

/** A signature for a result that ran and returned these many rows in one column. */
function ran(rows: number): ExecSignature {
  return execSignatureOf({
    rows: Array.from({ length: rows }, (_, index) => [`v${index}`]),
    columns: ['c'],
    failed: false,
  });
}

/** A signature for a result that ran and returned nothing. */
function emptyResult(): ExecSignature {
  return execSignatureOf({ rows: [], columns: ['c'], failed: false });
}

function candidate(draw: number, correct: boolean, resultKey: number, signature: ExecSignature | null): PoolCandidate {
  return { draw, correct, resultKey, signature };
}

function question(
  id: string,
  candidates: readonly PoolCandidate[],
  shape: QuestionShape = NO_SHAPE,
): PoolQuestion {
  return { id, shape, candidates };
}

describe('poolSummary', () => {
  it('reports zeros rather than NaN when nothing was recorded', () => {
    const summary = poolSummary([]);
    expect(summary.questions).toBe(0);
    expect(summary.candidates).toBe(0);
    expect(summary.signed).toBe(0);
    expect(summary.signatureShare).toBe(0);
    expect(summary.distinctMean).toBe(0);
    expect(summary.distinctMedian).toBe(0);
    expect(summary.oracle).toBe(0);
    expect(summary.first).toBe(0);
    expect(summary.ceilingOnly).toBe(0);
    expect(summary.noneRight).toBe(0);
  });

  it('counts a question whose five draws collapsed to one result as one distinct answer', () => {
    // The question this statistic exists to answer: five spellings of one query are one candidate,
    // and a selector has nothing to select. Counting draws instead of results would report five.
    const summary = poolSummary([
      question('q1', [
        candidate(0, true, 0, ran(3)),
        candidate(1, true, 0, ran(3)),
        candidate(2, true, 0, ran(3)),
        candidate(3, true, 0, ran(3)),
        candidate(4, true, 0, ran(3)),
      ]),
    ]);
    expect(summary.distinctMean).toBe(1);
    expect(summary.distinctHistogram).toEqual({ '1': 1 });
    expect(summary.oracle).toBe(1);
    expect(summary.first).toBe(1);
    // The ceiling is reachable and worth nothing: the first draw already had it.
    expect(summary.ceilingOnly).toBe(0);
    expect(summary.sharedCorrect).toBe(1);
    expect(summary.uniqueCorrect).toBe(0);
  });

  it('separates a question where only one draw was right from one where the first draw was right', () => {
    const summary = poolSummary([
      question('q1', [
        candidate(0, false, 0, ran(2)),
        candidate(1, false, 1, ran(4)),
        candidate(2, true, 2, ran(4)),
      ]),
      question('q2', [candidate(0, true, 0, ran(1)), candidate(1, false, 1, ran(9))]),
    ]);
    expect(summary.questions).toBe(2);
    expect(summary.oracle).toBe(2);
    expect(summary.first).toBe(1);
    // One question is worth choosing on and one is not: this is `oracle - first` decomposed.
    expect(summary.ceilingOnly).toBe(1);
    expect(summary.uniqueCorrect).toBe(2);
    expect(summary.sharedCorrect).toBe(0);
    expect(summary.distinctMean).toBe(2.5);
  });

  it('counts a question no candidate answered as noneRight, not as a zero ceiling', () => {
    const summary = poolSummary([
      question('q1', [candidate(0, false, 0, ran(2)), candidate(1, false, 1, ran(3))]),
    ]);
    expect(summary.noneRight).toBe(1);
    expect(summary.oracle).toBe(0);
    expect(summary.first).toBe(0);
    expect(summary.ceilingOnly).toBe(0);
  });

  it('reconciles the three correctness states to the question count', () => {
    const summary = poolSummary([
      question('a', [candidate(0, true, 0, ran(1)), candidate(1, true, 0, ran(1))]),
      question('b', [candidate(0, false, 0, ran(1)), candidate(1, true, 1, ran(2))]),
      question('c', [candidate(0, false, 0, ran(1)), candidate(1, false, 1, ran(2))]),
    ]);
    expect(summary.uniqueCorrect + summary.sharedCorrect + summary.noneRight).toBe(summary.questions);
    expect(summary.uniqueCorrect).toBe(1);
    expect(summary.sharedCorrect).toBe(1);
    expect(summary.noneRight).toBe(1);
  });

  it('reports the median as the mean of the middle two when the count is even', () => {
    const summary = poolSummary([
      question('a', [candidate(0, true, 0, ran(1))]),
      question('b', [candidate(0, true, 0, ran(1)), candidate(1, true, 1, ran(2))]),
      question('c', [
        candidate(0, true, 0, ran(1)),
        candidate(1, true, 1, ran(2)),
        candidate(2, true, 2, ran(3)),
      ]),
      question('d', [
        candidate(0, true, 0, ran(1)),
        candidate(1, true, 1, ran(2)),
        candidate(2, true, 2, ran(3)),
        candidate(3, true, 3, ran(4)),
      ]),
    ]);
    expect(summary.distinctMean).toBe(2.5);
    expect(summary.distinctMedian).toBe(2.5);
  });

  it('reports the median without averaging when the count is odd', () => {
    const summary = poolSummary([
      question('a', [candidate(0, true, 0, ran(1))]),
      question('b', [candidate(0, true, 0, ran(1)), candidate(1, true, 1, ran(2))]),
      question('c', [
        candidate(0, true, 0, ran(1)),
        candidate(1, true, 1, ran(2)),
        candidate(2, true, 2, ran(3)),
        candidate(3, true, 3, ran(4)),
        candidate(4, true, 4, ran(4)),
      ]),
    ]);
    expect(summary.distinctMedian).toBe(2);
  });

  it('separates a draw that produced no query from one that produced a query that did not run', () => {
    // Two different failures: the first has no shape at all, the second has the shape of a
    // statement that did not run. Merging them would hide how often the model simply refused.
    const summary = poolSummary([
      question('q1', [
        candidate(0, false, -1, null),
        candidate(1, false, -1, execSignatureOf({ rows: [], columns: [], failed: true })),
        candidate(2, true, 0, ran(1)),
      ]),
    ]);
    expect(summary.candidates).toBe(3);
    expect(summary.unsigned).toBe(1);
    expect(summary.signed).toBe(2);
    expect(summary.signatureShare).toBeCloseTo(2 / 3, 10);
    // Neither failure produced a result, so the question has one distinct answer among three draws.
    expect(summary.distinctMean).toBe(1);
  });

  it('keys the histogram by distinct count so a fat middle is visible', () => {
    const summary = poolSummary([
      question('a', [candidate(0, true, 0, ran(1))]),
      question('b', [candidate(0, true, 0, ran(1)), candidate(1, true, 1, ran(2))]),
      question('c', [candidate(0, false, 0, ran(1)), candidate(1, false, 1, ran(2))]),
    ]);
    expect(summary.distinctHistogram).toEqual({ '1': 1, '2': 2 });
  });
});

describe('signalReading', () => {
  it('reads the first draw as the baseline it is', () => {
    const questions = [
      question('q1', [candidate(0, true, 0, ran(3)), candidate(1, false, 1, ran(1))]),
      question('q2', [candidate(0, false, 0, ran(1)), candidate(1, true, 1, ran(3))]),
    ];
    const reading = signalReading(questions, 'draw-order');
    expect(reading.eligible).toBe(2);
    expect(reading.topPick).toBe(1);
    expect(reading.accuracy).toBe(0.5);
  });

  it('only counts questions where two different answers were produced', () => {
    // A question whose five draws agree has no choice in it. Counting it as a case the signal got
    // right would inflate every signal by the share of easy questions.
    const questions = [
      question('agreeing', [
        candidate(0, true, 0, ran(2)),
        candidate(1, true, 0, ran(2)),
        candidate(2, true, 0, ran(2)),
      ]),
      question('diverging', [candidate(0, false, 0, ran(1)), candidate(1, true, 1, ran(4))]),
    ];
    const reading = signalReading(questions, 'row-shape');
    expect(reading.eligible).toBe(1);
  });

  it('prefers a non-empty result to an empty one on a question that names no absence', () => {
    const questions = [
      question('q1', [
        candidate(0, false, 0, execSignatureOf({ rows: [], columns: ['c'], failed: false })),
        candidate(1, true, 1, ran(2)),
      ]),
    ];
    expect(signalReading(questions, 'empty').topPick).toBe(1);
    expect(signalReading(questions, 'draw-order').topPick).toBe(0);
  });

  it('does not penalise an empty result on a question that asks for what is missing', () => {
    const shape: QuestionShape = { ...NO_SHAPE, wantsMissing: true };
    const questions = [
      question(
        'q1',
        [
          candidate(0, true, 0, execSignatureOf({ rows: [], columns: ['c'], failed: false })),
          candidate(1, false, 1, ran(2)),
        ],
        shape,
      ),
    ];
    // Empty and non-empty tie, so the earlier draw holds and the correct one is kept. The
    // assertion is the count of correct picks: one question, one correct pick.
    expect(signalReading(questions, 'empty').topPick).toBe(1);
  });

  it('breaks a tie towards the earlier draw', () => {
    // A signal that has no opinion must not reorder the pool. If ties went to the last candidate,
    // every inert signal would be measuring "take the last draw".
    const questions = [
      question('q1', [candidate(0, true, 0, ran(3)), candidate(1, false, 1, ran(4))]),
    ];
    for (const signal of ['null-share', 'column-shape', 'value-type'] as const) {
      expect(signalReading(questions, signal).topPick).toBe(1);
    }
  });

  it('puts a candidate that did not run below one that did', () => {
    const questions = [
      question('q1', [
        candidate(0, false, -1, execSignatureOf({ rows: [], columns: [], failed: true })),
        candidate(1, true, 0, ran(1)),
      ]),
    ];
    expect(signalReading(questions, 'empty').topPick).toBe(1);
  });

  it('reports one half when a signal has no opinion, and counts the pairs it abstained on', () => {
    // Both results are duplicate-free, so duplicate-share scores them identically. Every
    // correct/incorrect pair is a tie, and an AUC of 0.5 is the honest reading of that: not "no
    // data", but "no discrimination on this pair".
    const questions = [
      question('q1', [candidate(0, false, 0, ran(1)), candidate(1, true, 1, ran(5))]),
      question('q2', [candidate(0, false, 0, ran(2)), candidate(1, true, 1, ran(6))]),
    ].map((item) => ({ ...item, shape: LIST_SHAPE }));
    const reading = signalReading(questions, 'duplicate-share');
    expect(reading.auc).toBe(0.5);
    // One correct against one incorrect candidate, on each of two questions.
    expect(reading.pairs).toBe(2);
  });

  it('scores an inverted signal below one half', () => {
    const questions = [
      question(
        'q1',
        [
          // The correct answer is the scalar and the question asked for a list: the signal is wrong.
          candidate(0, true, 0, execSignatureOf({ rows: [['x']], columns: ['c'], failed: false })),
          candidate(1, false, 1, ran(4)),
        ],
        LIST_SHAPE,
      ),
    ];
    const reading = signalReading(questions, 'row-shape');
    expect(reading.auc).toBe(0);
  });

  it('leaves the interval at the point estimate when every question agrees', () => {
    const questions = [
      question('q1', [candidate(0, false, 0, ran(1)), candidate(1, true, 1, ran(5))]),
      question('q2', [candidate(0, false, 0, ran(1)), candidate(1, true, 1, ran(6))]),
    ].map((item) => ({ ...item, shape: LIST_SHAPE }));
    // A list answered with one cell is penalised, so the correct non-scalar wins both questions.
    const reading = signalReading(questions, 'row-shape');
    expect(reading.auc).toBe(1);
    expect(reading.aucLow).toBe(1);
    expect(reading.aucHigh).toBe(1);
  });

  it('reports no pairs and a neutral AUC when nothing ran', () => {
    const questions = [question('q1', [candidate(0, false, -1, null), candidate(1, false, -1, null)])];
    const reading = signalReading(questions, 'empty');
    expect(reading.pairs).toBe(0);
    expect(reading.auc).toBe(0.5);
    expect(Number.isNaN(reading.aucLow)).toBe(false);
  });

  it('ranks only inside a question, because that is the only ordering a selector is asked to make', () => {
    // Two questions that a pooled AUC cannot tell apart from a perfect signal. In the first, the
    // correct candidate is non-empty and the wrong one is empty, which `empty` ranks perfectly. In
    // the second, one question asks for what is absent, so every candidate scores zero and the
    // signal has nothing to say: 25 pairs, all ties.
    //
    // Within questions the reading is (1 x 1 + 0.5 x 25) / 26 = 0.519. Pooled across the two lists
    // every correct candidate outranks every wrong one — 0 against -2, 36 pairs — and the same
    // signal reports 1.000. The old estimator reported the second number while `pairs` counted the
    // first, so a signal that abstains on a wide question was credited with winning the narrow one.
    const questions = [
      question('q1', [candidate(0, true, 0, ran(2)), candidate(1, false, 1, emptyResult())]),
      question(
        'q2',
        Array.from({ length: 10 }, (_, at) => candidate(at, at < 5, 0, emptyResult())),
        { ...NO_SHAPE, wantsMissing: true },
      ),
    ];
    const reading = signalReading(questions, 'empty');
    expect(reading.pairs).toBe(26);
    expect(reading.auc).toBeCloseTo(13.5 / 26, 6);
  });

  it('is deterministic for a given seed and moves the interval when the sample is resampled', () => {
    const questions = [
      question('q1', [candidate(0, false, 0, ran(1)), candidate(1, true, 1, ran(5))]),
      question('q2', [candidate(0, true, 0, ran(2)), candidate(1, false, 1, ran(6))]),
      question('q3', [candidate(0, false, 0, ran(3)), candidate(1, true, 1, ran(7))]),
      question('q4', [candidate(0, true, 0, ran(4)), candidate(1, false, 1, ran(8))]),
    ].map((item) => ({ ...item, shape: LIST_SHAPE }));
    const first = signalReading(questions, 'row-shape');
    const again = signalReading(questions, 'row-shape');
    expect(again.aucLow).toBe(first.aucLow);
    expect(again.aucHigh).toBe(first.aucHigh);
    expect(first.aucLow).toBeLessThanOrEqual(first.auc);
    expect(first.aucHigh).toBeGreaterThanOrEqual(first.auc);
  });

  it('reports the group sizes the AUC was computed over, not just their product', () => {
    // The gate that reads this number needs the size of the smaller group: the standard error of an
    // AUC at these counts is bounded by it, and a pair count alone cannot say how the pairs were
    // split between candidates that were right and candidates that were not.
    const questions = [
      question('q1', [candidate(0, true, 0, ran(1)), candidate(1, false, 1, ran(5)), candidate(2, false, 2, ran(6))]),
      question('q2', [candidate(0, true, 0, ran(2)), candidate(1, false, 1, ran(7)), candidate(2, false, 2, ran(8))]),
    ];
    const reading = signalReading(questions, 'empty', { resamples: 100 });
    expect(reading.positive).toBe(2);
    expect(reading.negative).toBe(4);
    // Pairs are counted inside each question, so two questions of one right against two wrong make
    // four comparisons and not `positive * negative`. The distinction matters: the gate's floor is
    // read from the group sizes, and a cross-question product would overstate how many independent
    // comparisons the pool contains.
    expect(reading.pairs).toBe(4);
  });

  it('reports a zero standard error when every question agreed, which the gate floors', () => {
    // The bootstrap cannot see inside a question, so a pool where every pair is concordant returns
    // the same AUC on every resample. Zero here is not certainty, and the gate that reads it is
    // responsible for saying so.
    const questions = [
      question('q1', [candidate(0, false, 0, ran(1)), candidate(1, true, 1, ran(5))]),
      question('q2', [candidate(0, false, 0, ran(1)), candidate(1, true, 1, ran(6))]),
    ].map((item) => ({ ...item, shape: LIST_SHAPE }));
    const reading = signalReading(questions, 'row-shape', { resamples: 100 });
    expect(reading.auc).toBe(1);
    expect(reading.aucSe).toBe(0);
  });

  it('reports a positive standard error when the questions disagreed', () => {
    const questions = [
      question('q1', [candidate(0, false, 0, ran(1)), candidate(1, true, 1, ran(5))]),
      question('q2', [candidate(0, true, 0, ran(2)), candidate(1, false, 1, ran(6))]),
      question('q3', [candidate(0, false, 0, ran(3)), candidate(1, true, 1, ran(7))]),
    ].map((item) => ({ ...item, shape: LIST_SHAPE }));
    const reading = signalReading(questions, 'row-shape', { resamples: 200 });
    expect(reading.aucSe).toBeGreaterThan(0);
    expect(reading.aucSe).toBeLessThan(0.5);
  });

  it('reports a zero standard error when there was only one question to resample', () => {
    const questions = [
      question('q1', [candidate(0, false, 0, ran(1)), candidate(1, true, 1, ran(5))]),
    ].map((item) => ({ ...item, shape: LIST_SHAPE }));
    const reading = signalReading(questions, 'row-shape', { resamples: 200 });
    expect(reading.aucSe).toBe(0);
  });
});

describe('signalReadings', () => {
  it('names the baseline first and then every signal, so a table cannot omit one', () => {
    const readings = signalReadings([]);
    expect(readings[0]?.signal).toBe('draw-order');
    expect(readings.map((reading) => reading.signal)).toEqual([
      'draw-order',
      'empty',
      'row-shape',
      'column-shape',
      'null-share',
      'duplicate-share',
      'value-type',
    ]);
  });

  it('gives every signal the same population', () => {
    const questions = [
      question('q1', [candidate(0, false, 0, ran(1)), candidate(1, true, 1, ran(5))]),
      question('q2', [candidate(0, true, 0, ran(2)), candidate(1, false, 1, ran(6))]),
    ];
    for (const reading of signalReadings(questions)) {
      expect(reading.eligible).toBe(2);
    }
  });
});
