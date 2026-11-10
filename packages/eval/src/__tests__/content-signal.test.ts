import { describe, expect, it } from 'vitest';
import type { QuestionShape } from '../exec-signature.js';
import type { PoolQuestion } from '../pool.js';
import {
  CONTENT_SIGNALS,
  contentPopulation,
  contentReadings,
  contentScoreOf,
  contentWordsOf,
  literalTokensOf,
} from '../content-signal.js';

const SHAPE: QuestionShape = {
  wantsMany: false,
  wantsCount: false,
  wantsAverage: false,
  wantsMissing: false,
  wantsDistinct: false,
};

/** A question whose pool is complete, with the words and literals its content signals read. */
function question(
  id: string,
  candidates: readonly { readonly correct: boolean; readonly sql: string; readonly columns: readonly string[] }[],
  text = 'Which county had the most students in 2015/2016?',
): PoolQuestion {
  return {
    id,
    shape: SHAPE,
    question: text,
    candidates: candidates.map((candidate, draw) => ({
      draw,
      correct: candidate.correct,
      resultKey: draw,
      signature: null,
      sql: candidate.sql,
      columns: candidate.columns,
    })),
  };
}

describe('contentWordsOf', () => {
  it('keeps the words a question is about and drops the grammar', () => {
    // `most`, `had` and `the` are in every other BIRD question, and a column called `name` matches
    // the word "name" for no reason at all — which is why that one is in the stop list rather than
    // being counted as evidence.
    expect(contentWordsOf('What is the name of the county with the most students?')).toEqual([
      'county',
      'students',
    ]);
  });

  it('drops tokens shorter than four characters, which are identifiers rather than subjects', () => {
    expect(contentWordsOf('the make and model of a car')).toEqual(['make', 'model']);
  });

  it('returns nothing for a question made only of grammar', () => {
    expect(contentWordsOf('How many are there?')).toEqual([]);
  });
});

describe('literalTokensOf', () => {
  it('finds the numbers and quoted strings a query has to carry', () => {
    expect(literalTokensOf("In 2015/2016, which 'Rock' band sold 12 records?")).toEqual([
      "'rock'",
      '12',
      '2015/2016',
    ]);
  });

  it('finds nothing in a question that states no literal', () => {
    expect(literalTokensOf('Which county has the most students?')).toEqual([]);
  });
});

describe('contentScoreOf', () => {
  const words = contentWordsOf('Which county had the most students in 2015/2016?');
  const literals = literalTokensOf('Which county had the most students in 2015/2016?');

  it('rewards a result whose columns name what the question names', () => {
    const right = { draw: 0, correct: true, resultKey: 0, signature: null, sql: "select county from t where season = '2015/2016'", columns: ['County'] };
    const wrong = { draw: 1, correct: false, resultKey: 1, signature: null, sql: 'select count(*) from t', columns: ['count'] };
    expect(contentScoreOf(right, words, literals, 'column-mention')).toBeGreaterThan(
      contentScoreOf(wrong, words, literals, 'column-mention'),
    );
    expect(contentScoreOf(right, words, literals, 'column-mention')).toBeCloseTo(0.5, 6);
  });

  it('rewards a query that writes the literal the question states', () => {
    const withLiteral = { draw: 0, correct: true, resultKey: 0, signature: null, sql: "select county from frpm where season = '2015/2016'", columns: [] };
    const without = { draw: 1, correct: false, resultKey: 1, signature: null, sql: 'select county from frpm', columns: [] };
    expect(contentScoreOf(withLiteral, words, literals, 'literal-match')).toBe(1);
    expect(contentScoreOf(without, words, literals, 'literal-match')).toBe(0);
  });

  it('means only over the parts the question actually states', () => {
    // A question with no literal in it must not be scored as if it had failed one: the mean is over
    // `column-mention` alone, so a perfect column match still reads as one.
    const candidate = { draw: 0, correct: true, resultKey: 0, signature: null, sql: 'select county, students from t', columns: ['County', 'Students'] };
    expect(contentScoreOf(candidate, words, [], 'content-mean')).toBe(1);
    expect(contentScoreOf(candidate, [], [], 'content-mean')).toBe(0);
  });

  it('scores a draw that produced no query at zero rather than at chance', () => {
    const empty = { draw: 0, correct: false, resultKey: -1, signature: null, sql: '', columns: null };
    for (const signal of CONTENT_SIGNALS) {
      expect(contentScoreOf(empty, words, literals, signal)).toBe(0);
    }
  });
});

describe('contentReadings', () => {
  const pool = (count: number): readonly PoolQuestion[] =>
    Array.from({ length: count }, (_, index) =>
      question(`q${index}`, [
        { correct: true, sql: "select county from t where season = '2015/2016'", columns: ['County'] },
        { correct: false, sql: 'select count(*) from t', columns: ['n'] },
      ]),
    );

  it('reads a pool whose content separates the candidates, on the same axis as the shape signals', () => {
    const readings = contentReadings(pool(20), { resamples: 200, seed: 3 });
    expect(readings.map((reading) => reading.signal)).toEqual([...CONTENT_SIGNALS]);
    const column = readings.find((reading) => reading.signal === 'column-mention');
    expect(column?.auc).toBe(1);
    expect(column?.aucLow).toBe(1);
    expect(column?.pairs).toBe(20);
  });

  it('reads nothing when no candidate carries a query, rather than reading chance', () => {
    // Every artefact written before R69's successor is this case. "No population" and "the signals
    // were at chance" are different findings and merging them would turn an absent instrument into
    // a result.
    const legacy: readonly PoolQuestion[] = [
      {
        id: 'q0',
        shape: SHAPE,
        question: 'Which county?',
        candidates: [
          { draw: 0, correct: true, resultKey: 0, signature: null },
          { draw: 1, correct: false, resultKey: 1, signature: null },
        ],
      },
    ];
    expect(contentReadings(legacy)).toEqual([]);
    expect(contentPopulation(legacy)).toBe(0);
  });

  it('drops a question whose pool is only half recorded, and says so in the population', () => {
    const half: readonly PoolQuestion[] = [
      question('q0', [
        { correct: true, sql: 'select county from t', columns: ['County'] },
        { correct: false, sql: 'select count(*) from t', columns: ['n'] },
      ]),
      {
        id: 'q1',
        shape: SHAPE,
        question: 'Which county?',
        candidates: [
          { draw: 0, correct: true, resultKey: 0, signature: null, sql: 'select county from t' },
          { draw: 1, correct: false, resultKey: 1, signature: null },
        ],
      },
    ];
    expect(contentPopulation(half)).toBe(1);
    expect(contentReadings(half, { resamples: 50, seed: 1 }).every((reading) => reading.pairs === 1)).toBe(true);
  });

  it('drops a question whose text was not recorded', () => {
    const unasked: readonly PoolQuestion[] = [
      {
        id: 'q0',
        shape: SHAPE,
        candidates: [
          { draw: 0, correct: true, resultKey: 0, signature: null, sql: 'select 1', columns: ['a'] },
          { draw: 1, correct: false, resultKey: 1, signature: null, sql: 'select 2', columns: ['b'] },
        ],
      },
    ];
    expect(contentReadings(unasked)).toEqual([]);
  });
});

describe('a candidate the artefact could not record', () => {
  it('scores zero when the query field is absent rather than reading an empty string', () => {
    // An artefact written by a run mid-rollout can carry `columns` and no `sql`; the branch that
    // reads `?? ''` is the one that must not be a dead guard, because it is the difference between
    // "no query" and "a query that is the empty string".
    const noQuery = { draw: 0, correct: false, resultKey: -1, signature: null };
    expect(contentScoreOf(noQuery, ['county'], ['2016'], 'literal-match')).toBe(0);
    expect(contentScoreOf(noQuery, ['county'], ['2016'], 'column-mention')).toBe(0);
  });
});
