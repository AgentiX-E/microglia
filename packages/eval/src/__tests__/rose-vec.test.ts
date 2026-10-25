import { describe, expect, it } from 'vitest';
import { consensusOf, judgedPairs, labelDisputes, parseRater, parseRoseVec, RoseVecError, rowsEqual } from '../rose-vec.js';

const row = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  question_id: 0,
  db_id: 'california_schools',
  question: 'What is the highest eligible free rate for K-12 students in the schools in Alameda County?',
  predicted_sql: "SELECT `Free Meal Count (K-12)` / `Enrollment (K-12)` FROM frpm WHERE `County Name` = 'Alameda'",
  gold_sql: "SELECT `Free Meal Count (K-12)` / `Enrollment (K-12)` FROM frpm WHERE `County Name` = 'Alameda'",
  label: true,
  evidence: 'Eligible free rate = free meal count / enrollment',
  reason_1: undefined,
  ...overrides,
});

describe('parseRoseVec', () => {
  it('reads the fields a calibration needs and keeps the annotator reasoning', () => {
    const [parsed] = parseRoseVec([row({ reason_1: 'wrong filter condition' })]);
    expect(parsed?.questionId).toBe('0');
    expect(parsed?.dbId).toBe('california_schools');
    expect(parsed?.label).toBe(true);
    expect(parsed?.reason).toBe('wrong filter condition');
    expect(parsed?.evidence).toBe('Eligible free rate = free meal count / enrollment');
  });

  it('accepts a string question id, because the file mixes both', () => {
    const [parsed] = parseRoseVec([row({ question_id: '1534' })]);
    expect(parsed?.questionId).toBe('1534');
  });

  it('falls back to the single-rater reason field', () => {
    const [parsed] = parseRoseVec([row({ reason_1: undefined, reason: 'ambiguous schema' })]);
    expect(parsed?.reason).toBe('ambiguous schema');
  });

  it('drops blank optional text rather than carrying whitespace', () => {
    const [parsed] = parseRoseVec([row({ evidence: '   ', reason_1: '' })]);
    expect(parsed?.evidence).toBeUndefined();
    expect(parsed?.reason).toBeUndefined();
  });

  it('refuses a label that is not a boolean', () => {
    // Defaulting this to false would turn "unlabelled" into "wrong" and depress every
    // criterion measured on the set by exactly the number of broken rows.
    expect(() => parseRoseVec([row({ label: 'true' })])).toThrow(RoseVecError);
    try {
      parseRoseVec([row({ label: 1 })]);
    } catch (error) {
      expect((error as RoseVecError).reason).toBe('bad-label');
      expect((error as RoseVecError).index).toBe(0);
      expect((error as RoseVecError).message).toContain('label must be a boolean');
    }
  });

  it('refuses a row that is not an object', () => {
    expect(() => parseRoseVec([null])).toThrow(/bad-row/);
    expect(() => parseRoseVec([['x']])).toThrow(/bad-row/);
  });

  it('refuses a missing or empty required field', () => {
    expect(() => parseRoseVec([row({ db_id: '' })])).toThrow(/missing-field/);
    expect(() => parseRoseVec([row({ question: undefined })])).toThrow(/missing-field/);
    expect(() => parseRoseVec([row({ predicted_sql: '  ' })])).toThrow(/missing-field/);
    expect(() => parseRoseVec([row({ gold_sql: 7 })])).toThrow(/missing-field/);
  });

  it('refuses an id that is neither number nor string', () => {
    expect(() => parseRoseVec([row({ question_id: null })])).toThrow(/bad-question-id/);
  });

  it('refuses a payload that is not an array', () => {
    expect(() => parseRoseVec({ rows: [] })).toThrow(/not-an-array/);
    expect(() => parseRoseVec('[]')).toThrow(/not-an-array/);
  });
});

describe('parseRater', () => {
  it('keeps only the verdict, keyed by question id', () => {
    const verdicts = parseRater([row(), row({ question_id: 1, label: false })]);
    expect([...verdicts]).toEqual([
      ['0', true],
      ['1', false],
    ]);
  });

  it('applies the same refusals as the published file', () => {
    expect(() => parseRater({})).toThrow(/not-an-array/);
    expect(() => parseRater([3])).toThrow(/bad-row/);
    expect(() => parseRater([{ question_id: null, label: true }])).toThrow(/bad-question-id/);
    expect(() => parseRater([{ question_id: 0, label: null }])).toThrow(/bad-label/);
  });
});

describe('rowsEqual', () => {
  it('ignores row order and duplicate rows, because EX compares sets', () => {
    expect(rowsEqual([[1], [2]], [[2], [1]])).toBe(true);
    expect(rowsEqual([[1], [1], [2]], [[1], [2]])).toBe(true);
  });

  it('separates a mismatch in count from a mismatch in content', () => {
    expect(rowsEqual([[1]], [[1], [2]])).toBe(false);
    expect(rowsEqual([[1], [2]], [[1], [3]])).toBe(false);
  });

  it('keeps null, the string "null", and zero distinct', () => {
    // A comparison that folded them would pass a query returning the wrong column of
    // the right shape, which is the most common way execution accuracy lies.
    expect(rowsEqual([[null]], [['null']])).toBe(false);
    expect(rowsEqual([[null]], [[0]])).toBe(false);
    expect(rowsEqual([['null']], [[0]])).toBe(false);
    expect(rowsEqual([[null]], [[null]])).toBe(true);
  });

  it('treats two empty results as equal', () => {
    expect(rowsEqual([], [])).toBe(true);
  });

  it('keeps numeric and string cells apart', () => {
    expect(rowsEqual([[1]], [['1']])).toBe(false);
  });
});

describe('judgedPairs', () => {
  const rows = parseRoseVec([row(), row({ question_id: 1, label: false }), row({ question_id: 2 })]);

  it('pairs each scored row with the committee label', () => {
    const measured = new Map([
      ['0', true],
      ['1', true],
      ['2', false],
    ]);
    const { pairs, unscored } = judgedPairs(rows, measured);
    expect(pairs).toEqual([
      { reference: true, measured: true },
      { reference: false, measured: true },
      { reference: true, measured: false },
    ]);
    expect(unscored).toEqual([]);
  });

  it('lists a row the criterion could not score instead of counting it as a disagreement', () => {
    const { pairs, unscored } = judgedPairs(rows, new Map([['0', true]]));
    expect(pairs).toHaveLength(1);
    expect(unscored).toEqual(['1', '2']);
  });
});

describe('consensusOf', () => {
  const rater = (entries: readonly (readonly [string, boolean])[]): Map<string, boolean> => new Map(entries);

  it('keeps the items two annotators agreed on', () => {
    const consensus = consensusOf([rater([['0', true], ['1', false]]), rater([['0', true], ['1', true]])]);
    expect([...consensus]).toEqual([['0', true]]);
  });

  it('drops an item only one annotator saw', () => {
    const consensus = consensusOf([rater([['0', true]]), rater([['1', false]])]);
    expect(consensus.size).toBe(0);
  });

  it('drops a disagreement rather than taking the majority', () => {
    // Two votes against one is still a set the published file does not contain, and
    // inventing it would hide the discordance this rebuild exists to measure.
    const consensus = consensusOf([
      rater([['0', true]]),
      rater([['0', true]]),
      rater([['0', false]]),
    ]);
    expect(consensus.size).toBe(0);
  });
});

describe('labelDisputes', () => {
  it('is empty when the published label matches the rebuild', () => {
    const rows = parseRoseVec([row()]);
    expect(labelDisputes(rows, consensusOf([new Map([['0', true]]), new Map([['0', true]])]))).toEqual([]);
  });

  it('reports a row whose published label contradicts the rebuild', () => {
    const rows = parseRoseVec([row({ label: true })]);
    const disputed = labelDisputes(rows, consensusOf([new Map([['0', false]]), new Map([['0', false]])]));
    expect(disputed.map((entry) => entry.questionId)).toEqual(['0']);
  });

  it('says nothing about a row the rebuild does not cover', () => {
    const rows = parseRoseVec([row()]);
    expect(labelDisputes(rows, new Map())).toEqual([]);
  });
});
