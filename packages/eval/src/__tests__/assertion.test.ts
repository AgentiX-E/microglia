import { describe, expect, it } from 'vitest';
import {
  ASSERTION_KINDS,
  ASSERTION_SIGNALS,
  MAX_ASSERTIONS_PER_KIND,
  NO_ASSERTIONS,
  assertAnything,
  assertionHitsOf,
  assertionPopulation,
  assertionReadings,
  assertionScoreOf,
  assertionSignalOf,
  parseAssertions,
  selectByAssertions,
  type Assertions,
} from '../assertion.js';
import type { ExecSignature } from '../exec-signature.js';
import { assertionPrompt } from '../selector.js';
import type { PoolCandidate, PoolQuestion } from '../pool.js';

const SHAPE = {
  wantsMany: false,
  wantsCount: false,
  wantsAverage: false,
  wantsMissing: false,
  wantsDistinct: false,
};

function signatureOf(rowCount: number): ExecSignature {
  return {
    failed: false,
    empty: rowCount === 0,
    rowCount,
    columnCount: 1,
    nullShare: 0,
    duplicateShare: 0,
    numericOnly: true,
    scalar: rowCount === 1,
  };
}

function candidate(
  draw: number,
  options: {
    readonly correct?: boolean;
    readonly sql?: string;
    readonly columns?: readonly string[];
    readonly rows?: number | null;
  } = {},
): PoolCandidate {
  return {
    draw,
    correct: options.correct ?? false,
    resultKey: draw,
    signature: options.rows === null ? null : signatureOf(options.rows ?? 1),
    sql: options.sql,
    columns: options.columns,
  };
}

const ASSERTIONS: Assertions = {
  columns: ['County'],
  values: ['CA'],
  rows: [1],
};

describe('the grammar a writer is held to', () => {
  it('reads the three kinds in the order they were written', () => {
    expect(parseAssertions('column:County\nvalue:CA\nrows:1')).toEqual(ASSERTIONS);
  });

  it('tolerates the decoration a model puts around a bare token', () => {
    // List markers, backticks and one layer of quotes, which is the whole of what four writers in
    // this project emitted. Anything more inventive would match an assertion nobody made.
    expect(parseAssertions('- column:`County`\n* value: "CA"\n+ rows: 1')).toEqual(ASSERTIONS);
  });

  it('is case-insensitive about the kind and keeps the value as written', () => {
    expect(parseAssertions('COLUMN:County')).toEqual({ ...NO_ASSERTIONS, columns: ['County'] });
  });

  it('drops a line that is not one of the three kinds', () => {
    // A model asked for three lines of grammar opens with a sentence of prose often enough that
    // refusing the whole reply would make the arm a measurement of obedience.
    const parsed = parseAssertions('Here are the assertions:\ncolumn:County\nbecause it asks per county');
    expect(parsed.columns).toEqual(['County']);
  });

  it('drops a row assertion that is not an integer rather than reading it as zero', () => {
    // Zero is an assertion the writer never made, and one every one-row candidate would fail.
    expect(parseAssertions('rows:several\nrows:0').rows).toEqual([0]);
    expect(parseAssertions('rows:several').rows).toEqual([]);
  });

  it('drops an empty value', () => {
    expect(parseAssertions('column:\nvalue:   \nrows:')).toEqual(NO_ASSERTIONS);
  });

  it('deduplicates and caps each kind, because the scorer counts satisfied assertions', () => {
    const parsed = parseAssertions(
      ['column:a', 'column:a', 'column:b', 'column:c', 'column:d', 'value:x', 'value:x'].join('\n'),
    );
    expect(parsed.columns).toEqual(['a', 'b', 'c']);
    expect(parsed.columns.length).toBe(MAX_ASSERTIONS_PER_KIND);
    expect(parsed.values).toEqual(['x']);
  });

  it('says whether a set asserts anything at all', () => {
    expect(assertAnything(ASSERTIONS)).toBe(true);
    expect(assertAnything(NO_ASSERTIONS)).toBe(false);
    expect(assertAnything({ columns: [], values: [], rows: [0] })).toBe(true);
  });
});

describe('the arithmetic a candidate is scored by', () => {
  it('satisfies a column assertion by token, across the plural', () => {
    expect(assertionHitsOf(candidate(0, { columns: ['County'] }), ASSERTIONS, 'column')).toBe(1);
    expect(assertionHitsOf(candidate(0, { columns: ['Counties'] }), { ...NO_ASSERTIONS, columns: ['county'] }, 'column')).toBe(1);
    expect(assertionHitsOf(candidate(0, { columns: ['count'] }), ASSERTIONS, 'column')).toBe(0);
  });

  it('does not satisfy a column assertion with a column the result does not carry', () => {
    expect(assertionHitsOf(candidate(0, { columns: [] }), ASSERTIONS, 'column')).toBe(0);
    expect(assertionHitsOf(candidate(0), ASSERTIONS, 'column')).toBe(0);
  });

  it('treats an assertion with no alphanumeric content as unsatisfied rather than satisfied by nobody', () => {
    // An empty token list would make `every` vacuously true and hand every candidate a free hit.
    expect(assertionHitsOf(candidate(0, { columns: ['County'] }), { ...NO_ASSERTIONS, columns: ['---'] }, 'column')).toBe(0);
  });

  it('satisfies a value assertion when the query writes the literal', () => {
    expect(assertionHitsOf(candidate(0, { sql: "select * from t where state = 'CA'" }), ASSERTIONS, 'value')).toBe(1);
    expect(assertionHitsOf(candidate(0, { sql: 'select * from t' }), ASSERTIONS, 'value')).toBe(0);
  });

  it('does not satisfy a value assertion on a candidate that recorded no query', () => {
    expect(assertionHitsOf(candidate(0), ASSERTIONS, 'value')).toBe(0);
    expect(assertionHitsOf(candidate(0, { sql: '' }), ASSERTIONS, 'value')).toBe(0);
  });

  it('satisfies a row assertion only on an exact count from a result that ran', () => {
    expect(assertionHitsOf(candidate(0, { rows: 1 }), ASSERTIONS, 'rows')).toBe(1);
    expect(assertionHitsOf(candidate(0, { rows: 2 }), ASSERTIONS, 'rows')).toBe(0);
    expect(assertionHitsOf(candidate(0, { rows: null }), ASSERTIONS, 'rows')).toBe(0);
  });

  it('counts every satisfied assertion of every kind for the selector', () => {
    const both = candidate(0, { sql: "select county from t where state = 'CA'", columns: ['County'], rows: 1 });
    expect(assertionScoreOf(both, ASSERTIONS)).toBe(3);
    expect(assertionScoreOf(candidate(0, { rows: 2 }), ASSERTIONS)).toBe(0);
  });

  it('names the three kinds and their sum, and nothing else', () => {
    const both = candidate(0, { sql: "select county from t where state = 'CA'", columns: ['County'], rows: 1 });
    expect(assertionSignalOf(both, ASSERTIONS, 'assertion-column')).toBe(1);
    expect(assertionSignalOf(both, ASSERTIONS, 'assertion-value')).toBe(1);
    expect(assertionSignalOf(both, ASSERTIONS, 'assertion-rows')).toBe(1);
    expect(assertionSignalOf(both, ASSERTIONS, 'assertion-hits')).toBe(3);
    expect(ASSERTION_KINDS).toEqual(['column', 'value', 'rows']);
  });
});

function questionOf(id: string, candidates: readonly PoolCandidate[], assertions?: Assertions): PoolQuestion & { assertions?: Assertions } {
  return { id, shape: SHAPE, candidates, assertions };
}

describe('the reading a written selector gets', () => {
  it('has nothing to say about a pool no writer wrote for', () => {
    expect(assertionReadings([questionOf('a', [candidate(0)])])).toEqual([]);
    expect(assertionPopulation([questionOf('a', [candidate(0)])])).toBe(0);
  });

  it('is exactly one half when the assertions cannot tell the draws apart', () => {
    // The pool's ties keep the earlier draw, so an assertion set every candidate satisfies ranks
    // nothing and the reading lands on the pool's own baseline rather than on "the last draw".
    const questions = [
      questionOf(
        'a',
        [candidate(0, { rows: 1, correct: true }), candidate(1, { rows: 1 })],
        { ...NO_ASSERTIONS, rows: [1] },
      ),
      questionOf(
        'b',
        [candidate(0, { rows: 1, correct: true }), candidate(1, { rows: 1 })],
        { ...NO_ASSERTIONS, rows: [1] },
      ),
    ];
    const byHits = assertionReadings(questions).find((reading) => reading.signal === 'assertion-hits');
    expect(byHits?.auc).toBe(0.5);
    expect(byHits?.pairs).toBe(2);
  });

  it('ranks a candidate that satisfies the writer above one that does not', () => {
    const questions = [
      questionOf(
        'a',
        [candidate(0, { rows: 2 }), candidate(1, { rows: 1, correct: true })],
        { ...NO_ASSERTIONS, rows: [1] },
      ),
      questionOf(
        'b',
        [candidate(0, { rows: 2 }), candidate(1, { rows: 1, correct: true })],
        { ...NO_ASSERTIONS, rows: [1] },
      ),
    ];
    const readings = assertionReadings(questions);
    const byHits = readings.find((reading) => reading.signal === 'assertion-hits');
    expect(byHits?.auc).toBe(1);
    expect(byHits?.topPick).toBe(2);
    expect(byHits?.accuracy).toBe(1);
  });

  it('reports each kind separately, because the registration is about which sentence carries it', () => {
    const questions = [
      questionOf(
        'a',
        [candidate(0, { columns: ['state'], rows: 1 }), candidate(1, { columns: ['County'], rows: 1, correct: true })],
        ASSERTIONS,
      ),
      questionOf(
        'b',
        [candidate(0, { columns: ['state'], rows: 1 }), candidate(1, { columns: ['County'], rows: 1, correct: true })],
        ASSERTIONS,
      ),
    ];
    const byKind = assertionReadings(questions).map((reading) => [reading.signal, reading.auc] as const);
    expect(byKind).toEqual([
      ['assertion-column', 1],
      ['assertion-value', 0.5],
      ['assertion-rows', 0.5],
      ['assertion-hits', 1],
    ]);
  });

  it('counts the questions a writer wrote for and not the ones it skipped', () => {
    const questions = [
      questionOf('a', [candidate(0)], ASSERTIONS),
      questionOf('b', [candidate(0)], { ...NO_ASSERTIONS, rows: [1] }),
      questionOf('c', [candidate(0)]),
    ];
    expect(assertionPopulation(questions)).toBe(2);
    expect(ASSERTION_SIGNALS).toEqual([
      'assertion-column',
      'assertion-value',
      'assertion-rows',
      'assertion-hits',
    ]);
  });
});

describe('the selection a written selector makes', () => {
  it('reports an empty pool as empty rather than as an abstention', () => {
    expect(selectByAssertions([], ASSERTIONS)).toEqual({
      chosen: 0,
      votes: 0,
      groups: 0,
      reason: 'empty',
      emptyResult: false,
    });
  });

  it('falls back to the first draw when the writer wrote nothing', () => {
    // The writer's failure, not the pool's: reported as the baseline so an arm whose writer missed a
    // question cannot claim that question's accuracy as its own mechanism.
    expect(selectByAssertions([candidate(0), candidate(1)], undefined)).toEqual({
      chosen: 0,
      votes: 1,
      groups: 0,
      reason: 'no-agreement',
      emptyResult: false,
    });
    expect(selectByAssertions([candidate(0)], NO_ASSERTIONS).reason).toBe('no-agreement');
  });

  it('chooses the draw that satisfies the most assertions', () => {
    const candidates = [
      candidate(0, { columns: ['state'], rows: 1 }),
      candidate(1, { columns: ['County'], rows: 1, correct: true }),
    ];
    const selection = selectByAssertions(candidates, ASSERTIONS);
    expect(selection.chosen).toBe(1);
    expect(selection.reason).toBe('assertion');
    expect(selection.groups).toBe(2);
    expect(selection.votes).toBe(1);
  });

  it('breaks a tie toward the earlier draw and counts the tie', () => {
    const candidates = [candidate(0, { rows: 1 }), candidate(1, { rows: 1 }), candidate(2, { rows: 2 })];
    const selection = selectByAssertions(candidates, { ...NO_ASSERTIONS, rows: [1] });
    expect(selection.chosen).toBe(0);
    expect(selection.votes).toBe(2);
    expect(selection.groups).toBe(2);
  });

  it('says the assertions ordered nothing when every draw scores the same', () => {
    // `groups` is the number that says whether the writer's sentences ranked anything at all; on a
    // question where all five satisfy the same two sentences the choice is the first draw by
    // construction and the arm is `sample-5-first` for that question.
    const candidates = [candidate(0, { rows: 1 }), candidate(1, { rows: 1 })];
    const selection = selectByAssertions(candidates, { ...NO_ASSERTIONS, rows: [1] });
    expect(selection.groups).toBe(1);
    expect(selection.chosen).toBe(0);
    expect(selection.votes).toBe(2);
  });

  it('reports that it chose an empty result, because an empty group is the failure it amplifies', () => {
    const candidates = [candidate(0, { rows: 3 }), candidate(1, { rows: 0 })];
    const selection = selectByAssertions(candidates, { ...NO_ASSERTIONS, rows: [0] });
    expect(selection.chosen).toBe(1);
    expect(selection.emptyResult).toBe(true);
  });
});

describe('the prompt the writer is held to', () => {
  const SHAPES = [
    { columns: ['County', 'Population'], rows: 3, ran: true },
    { columns: null, rows: 0, ran: false },
  ];

  it('passes the task through verbatim, so the writer saw the schema the generator saw', () => {
    const prompt = assertionPrompt('SCHEMA: county(name, population)\nQ: how many?', SHAPES);
    expect(prompt.startsWith('SCHEMA: county(name, population)\nQ: how many?')).toBe(true);
  });

  it('describes each result by its columns and its row count, and says plural', () => {
    const prompt = assertionPrompt('task', SHAPES);
    expect(prompt).toContain('[1] columns (County, Population) — 3 rows');
    expect(prompt).toContain('2 queries were written');
  });

  it('says a query did not run rather than reporting an empty result', () => {
    // The two most confusable outcomes in this lane: a wrong join returns nothing and a broken query
    // returns nothing. A writer told "0 rows" would assert a row count the query never produced.
    expect(assertionPrompt('task', SHAPES)).toContain('[2] the query did not run');
  });

  it('names an unnamed result rather than printing an empty bracket', () => {
    expect(assertionPrompt('task', [{ columns: [], rows: 1, ran: true }])).toContain('columns (none) — 1 row');
  });

  it('asks for exactly the three kinds and forbids SQL and prose', () => {
    const prompt = assertionPrompt('task', [{ columns: null, rows: 0, ran: true }]);
    for (const line of ['column:<', 'value:<', 'rows:<']) expect(prompt).toContain(line);
    expect(prompt).toContain('Do not write SQL');
    expect(prompt).toContain('Do not explain');
  });

  it('says one query was written when there is one', () => {
    expect(assertionPrompt('task', [{ columns: ['a'], rows: 1, ran: true }])).toContain('1 query was written');
  });
});

describe('the quote a writer may put around a value', () => {
  it('strips one layer of single quotes', () => {
    expect(parseAssertions("value:'CA'").values).toEqual(['CA']);
  });

  it('leaves an unbalanced quote alone rather than cutting a character off', () => {
    // A parser that trims on the strength of one quote turns a malformed line into a different
    // assertion, and every match it invents is counted as agreement.
    expect(parseAssertions("value:'CA").values).toEqual(["'CA"]);
    expect(parseAssertions("value:C'A").values).toEqual(["C'A"]);
  });
});
