import { describe, expect, it } from 'vitest';
import {
  SIGNALS,
  shapeOf,
  execSignatureOf,
  scoreOf,
  type ExecOutcome,
  type ExecExecSignature,
} from '../exec-signature.js';

const outcome = (over: Partial<ExecOutcome>): ExecOutcome => ({
  rows: [],
  columns: ['c'],
  failed: false,
  ...over,
});

const signature = (over: Partial<ExecSignature>): ExecSignature => ({
  failed: false,
  empty: false,
  rowCount: 1,
  columnCount: 1,
  nullShare: 0,
  duplicateShare: 0,
  numericOnly: true,
  scalar: true,
  ...over,
});

describe('execSignatureOf', () => {
  it('marks a failed query as failed and nothing else', () => {
    // A candidate that did not run has no shape. Reading rows from it would make every
    // empty-result rule fire on a syntax error, and the two need different verdicts: one is
    // "wrong", the other is "not an answer at all".
    const sig = execSignatureOf(outcome({ failed: true, rows: [[1]] }));
    expect(sig.failed).toBe(true);
    expect(sig.rowCount).toBe(0);
    expect(sig.empty).toBe(true);
    expect(sig.scalar).toBe(false);
    expect(sig.numericOnly).toBe(false);
  });

  it('calls a query with no rows empty', () => {
    const sig = execSignatureOf(outcome({ rows: [], columns: ['a', 'b'] }));
    expect(sig.empty).toBe(true);
    expect(sig.rowCount).toBe(0);
    expect(sig.columnCount).toBe(2);
    expect(sig.scalar).toBe(false);
  });

  it('calls one row of one column a scalar', () => {
    const sig = execSignatureOf(outcome({ rows: [[42]] }));
    expect(sig.scalar).toBe(true);
    expect(sig.empty).toBe(false);
  });

  it('does not call a single row of two columns a scalar', () => {
    // The distinction is what separates "how many" from "list the name and the count". A
    // one-row, two-column answer is still a list of attributes.
    const sig = execSignatureOf(outcome({ rows: [[42, 'x']], columns: ['n', 'name'] }));
    expect(sig.scalar).toBe(false);
  });

  it('counts the share of cells that are null', () => {
    const sig = execSignatureOf(
      outcome({ rows: [[1, null], [null, null]], columns: ['a', 'b'] }),
    );
    expect(sig.rowCount).toBe(2);
    expect(sig.columnCount).toBe(2);
    expect(sig.nullShare).toBe(0.75);
  });

  it('counts the share of rows that repeat an earlier row', () => {
    // A join that multiplies rows shows up here before it shows up anywhere else, and unlike a
    // null it survives a projection that drops the joining column.
    const sig = execSignatureOf(
      outcome({ rows: [[1, 'a'], [1, 'a'], [1, 'a'], [2, 'b']], columns: ['id', 'name'] }),
    );
    // Three copies of one row and one of another: the first is the original, so two rows repeat.
    expect(sig.duplicateShare).toBe(0.5);
  });

  it('has no duplicates when every row is distinct', () => {
    const sig = execSignatureOf(outcome({ rows: [[1], [2], [3]] }));
    expect(sig.duplicateShare).toBe(0);
  });

  it('does not divide by zero when the result is empty', () => {
    // `nullShare` and `duplicateShare` are shares of cells that do not exist. A NaN here would
    // propagate into a score and silently rank every empty result as the best one.
    const sig = execSignatureOf(outcome({ rows: [], columns: [] }));
    expect(sig.nullShare).toBe(0);
    expect(sig.duplicateShare).toBe(0);
  });

  it('calls a result numeric only when every non-null cell is a number', () => {
    expect(execSignatureOf(outcome({ rows: [[1], [2.5], [null]] })).numericOnly).toBe(true);
    expect(execSignatureOf(outcome({ rows: [[1], ['x']] })).numericOnly).toBe(false);
  });

  it('does not call an all-null column numeric', () => {
    // "every non-null cell is a number" is vacuously true with no non-null cells, which would
    // make an all-NULL answer look like a count.
    expect(execSignatureOf(outcome({ rows: [[null], [null]] })).numericOnly).toBe(false);
  });

  it('treats a numeric string as text, not as a number', () => {
    // The scorer compares values after canonicalisation, and a value typed as text is a
    // different answer from the same digits typed as a number in this schema.
    expect(execSignatureOf(outcome({ rows: [['42']] })).numericOnly).toBe(false);
  });

  it('treats a bigint cell as a number', () => {
    expect(execSignatureOf(outcome({ rows: [[10n]] })).numericOnly).toBe(true);
  });
});

describe('shapeOf', () => {
  it('hears a plural request', () => {
    expect(shapeOf('List each player and their team', '').wantsMany).toBe(true);
    expect(shapeOf('What are the top 3 schools by enrollment', '').wantsMany).toBe(true);
    expect(shapeOf('How many players are there', '').wantsMany).toBe(false);
  });

  it('hears a count request', () => {
    expect(shapeOf('How many accounts are in the district', '').wantsCount).toBe(true);
    expect(shapeOf('What is the number of loans', '').wantsCount).toBe(true);
    expect(shapeOf('Count the rows per state', '').wantsCount).toBe(true);
  });

  it('hears an average request', () => {
    expect(shapeOf('What is the average salary', '').wantsAverage).toBe(true);
    expect(shapeOf('Give the ratio of male to female students', '').wantsAverage).toBe(true);
    expect(shapeOf('Show the percentage of loans repaid', '').wantsAverage).toBe(true);
  });

  it('reads the evidence as well as the question', () => {
    // BIRD's evidence carries half the intent in the questions that need it: "the ratio is
    // measured against the total number of accounts" decides the shape without the question
    // saying so.
    expect(shapeOf('What is the value for this district', 'the ratio to the total').wantsAverage)
      .toBe(true);
  });

  it('is case insensitive', () => {
    expect(shapeOf('HOW MANY ROWS', 'THE RATIO').wantsCount).toBe(true);
    expect(shapeOf('HOW MANY ROWS', 'THE RATIO').wantsAverage).toBe(true);
  });

  it('does not hear a count in a word that merely contains one', () => {
    // `discount` and `account` both contain `count`, and a count signal that fires on them
    // would down-rank every correct answer about a discount.
    expect(shapeOf('What is the total discount per account', '').wantsCount).toBe(false);
  });

  it('says nothing when the question says nothing', () => {
    const shape = shapeOf('Which district has the highest income', '');
    expect(shape).toEqual({
      wantsMany: false,
      wantsCount: false,
      wantsAverage: false,
      wantsMissing: false,
      wantsDistinct: false,
    });
  });

  it('hears a question that asks for the absent ones', () => {
    // The one shape that an empty result satisfies. It is marked rather than inferred from the
    // empty result itself, so a wrong empty answer to an ordinary question stays penalised.
    expect(shapeOf('Which schools have no students', '').wantsMissing).toBe(true);
    expect(shapeOf('List the accounts without a loan', '').wantsMissing).toBe(true);
    expect(shapeOf('Which students are not enrolled', '').wantsMissing).toBe(true);
    expect(shapeOf('List each school and its district', '').wantsMissing).toBe(false);
  });
});

describe('scoreOf', () => {
  it('penalises an empty result on every signal that can read one', () => {
    const sig = signature({ empty: true, rowCount: 0, scalar: false });
    for (const signal of SIGNALS) {
      if (signal === 'null-share' || signal === 'duplicate-share') continue;
      expect(scoreOf(sig, shapeOf('How many players are there', ''), signal)).toBeLessThan(0);
    }
  });

  it('does not penalise an empty result when the question asks for the missing ones', () => {
    // "Which schools have no students" is answered by an empty list on the students side, and
    // the model that returns nothing there is right. The exception is narrow and explicit.
    const sig = signature({ empty: true, rowCount: 0, scalar: false });
    expect(scoreOf(sig, shapeOf('Which schools do not have any student', ''), 'empty')).toBe(0);
  });

  it('penalises many columns for a count question', () => {
    const sig = signature({ rowCount: 1, columnCount: 2, scalar: false });
    expect(scoreOf(sig, shapeOf('How many players are there', ''), 'column-shape')).toBeLessThan(0);
  });

  it('penalises a scalar for a list question', () => {
    expect(scoreOf(signature({}), shapeOf('List each player name', ''), 'row-shape')).toBeLessThan(0);
  });

  it('has no opinion when the question has no shape', () => {
    // A signal that fires without evidence is a coin flip with a confidence, which is what the
    // previous selectors were.
    for (const signal of SIGNALS) {
      expect(scoreOf(signature({}), shapeOf('Which district has the highest income', ''), signal))
        .toBe(0);
    }
  });

  it('penalises a high null share', () => {
    expect(scoreOf(signature({ nullShare: 0.8 }), shapeOf('x', ''), 'null-share')).toBeLessThan(0);
    expect(scoreOf(signature({ nullShare: 0 }), shapeOf('x', ''), 'null-share')).toBe(0);
  });

  it('penalises duplicate rows only when the question did not ask for a distinct list', () => {
    expect(scoreOf(signature({ duplicateShare: 0.5 }), shapeOf('List each name', ''), 'duplicate-share'))
      .toBeLessThan(0);
    expect(scoreOf(signature({ duplicateShare: 0.5 }), shapeOf('List the distinct names', ''), 'duplicate-share'))
      .toBe(0);
  });

  it('penalises text where an average was asked for', () => {
    // An average, a ratio and a percentage are numbers; a name returned for them is a different
    // query, whatever it executes to.
    expect(
      scoreOf(signature({ numericOnly: false }), shapeOf('What is the average salary', ''), 'value-type'),
    ).toBeLessThan(0);
    expect(
      scoreOf(signature({ numericOnly: true }), shapeOf('What is the average salary', ''), 'value-type'),
    ).toBe(0);
  });

  it('gives a failed query the floor on every signal, so it can never win a tie', () => {
    const sig = signature({ failed: true, empty: true, rowCount: 0, scalar: false });
    const total = SIGNALS.reduce((sum, signal) => sum + scoreOf(sig, shapeOf('x', ''), signal), 0);
    expect(total).toBeLessThan(-1);
  });

  it('reports an unknown signal as no opinion rather than throwing', () => {
    // Kept total so an arm that names a signal it does not have is a zero rather than a crash in
    // the middle of a paid run.
    expect(scoreOf(signature({}), shapeOf('x', ''), 'all')).toBe(0);
  });
});
