/**
 * The question reader, tested against the three shapes the dataset has shipped in.
 *
 * Every test here corresponds to a way this reader could silently return fewer rows than the file
 * holds — which is worse than throwing, because a run over a short question list reports an
 * accuracy on a corpus nobody chose.
 */
import { describe, expect, it } from 'vitest';
import { compareGold, normaliseRow, parseGoldLines, parseRows } from '../bird-rows.js';

const QUESTION = {
  question_id: 3,
  db_id: 'financial',
  question: 'How many accounts are there?',
  evidence: '',
  SQL: 'SELECT count(*) FROM account',
  difficulty: 'simple',
};

describe('parseRows', () => {
  it('reads a JSON array, which is what dev and train ship', () => {
    const rows = parseRows(JSON.stringify([QUESTION, { ...QUESTION, question_id: 4 }]));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual(QUESTION);
  });

  it('reads JSON Lines, which is what the Hugging Face mirror ships', () => {
    const text = `${JSON.stringify(QUESTION)}\n${JSON.stringify({ ...QUESTION, question_id: 5 })}\n`;
    expect(parseRows(text)).toHaveLength(2);
  });

  it('reads a {data: [...]} wrapper, which is what a converted export looks like', () => {
    expect(parseRows(JSON.stringify({ data: [QUESTION] }))).toHaveLength(1);
  });

  it('reads a file that holds one bare object instead of an array', () => {
    // Not a shape the benchmark ships, and the shape a hand-extracted one tends to have after
    // someone pipes a single record through an editor. The alternative to reading it is returning
    // zero rows from a file that contains a question.
    expect(parseRows(JSON.stringify(QUESTION))).toHaveLength(1);
  });

  it('drops records that are not questions rather than counting them', () => {
    const rows = parseRows(JSON.stringify([QUESTION, { question: 'no sql' }, null, 42, { ...QUESTION, SQL: '  ' }]));
    expect(rows).toHaveLength(1);
  });

  it('keeps the file order, because the folds are assigned from it', () => {
    const rows = parseRows(JSON.stringify([{ ...QUESTION, question_id: 9 }, { ...QUESTION, question_id: 1 }]));
    expect(rows.map((row) => row.question_id)).toEqual([9, 1]);
  });

  it('skips the blank lines a hand-edited JSON Lines file collects', () => {
    // Blank lines are not records, and a reader that pushed them would hand `null` to
    // `normaliseRow` for every one of them — harmless here, and a silent undercount in a reader
    // that counted records instead of questions.
    const text = `${JSON.stringify(QUESTION)}\n\n   \n${JSON.stringify({ ...QUESTION, question_id: 6 })}\n`;
    expect(parseRows(text)).toHaveLength(2);
  });

  it('survives a truncated final line without losing the lines before it', () => {
    // A download cut short leaves half a record at the end. Refusing the file loses every question
    // in it; reading the whole lines and stopping keeps the benchmark the operator already has.
    const text = `${JSON.stringify(QUESTION)}\n{"question_id": 2, "db_id": "x", "quest`;
    expect(parseRows(text)).toHaveLength(1);
  });
});

describe('normaliseRow', () => {
  it('accepts the field names the dataset has used for one concept', () => {
    const row = normaliseRow({ question: 'q', sql: 'SELECT 1', database: 'db' }, 0);
    expect(row).toMatchObject({ question: 'q', SQL: 'SELECT 1', db_id: 'db' });
  });

  it('defaults a missing question id to the row index', () => {
    // Two files, two conventions: `dev.json` numbers its rows, `train.json` does not. The fold
    // assignment is keyed by `db_id#question_id`, so an absent id has to become something stable
    // and unique — the position in the file is both.
    expect(normaliseRow({ question: 'q', SQL: 's', db_id: 'd' }, 7)?.question_id).toBe(7);
  });

  it('defaults a missing tier to the empty string, which is never filtered away', () => {
    expect(normaliseRow({ question: 'q', SQL: 's', db_id: 'd' }, 0)?.difficulty).toBe('');
  });
});

describe('parseGoldLines', () => {
  it('splits the tab-separated gold into a statement and its database', () => {
    const lines = parseGoldLines('SELECT 1\tmovie_platform\nSELECT 2\tmovie_3\n');
    expect(lines).toEqual([
      { sql: 'SELECT 1', dbId: 'movie_platform' },
      { sql: 'SELECT 2', dbId: 'movie_3' },
    ]);
  });

  it('splits at the last tab, so a statement containing one is not cut in half', () => {
    // The separator is the final tab, because the database id cannot contain one and the SQL might.
    const lines = parseGoldLines("SELECT 'a\tb' FROM t\tdb1\n");
    expect(lines[0]).toEqual({ sql: "SELECT 'a\tb' FROM t", dbId: 'db1' });
  });

  it('keeps a line with no tab, rather than dropping a statement it cannot attribute', () => {
    expect(parseGoldLines('SELECT 1\n')).toEqual([{ sql: 'SELECT 1', dbId: '' }]);
  });
});

describe('compareGold', () => {
  const row = (sql: string): { SQL: string } => ({ SQL: sql });

  it('reports agreement when the two copies match', () => {
    const reading = compareGold(
      [row('SELECT 1'), row('SELECT 2')] as never,
      [
        { sql: 'SELECT 1', dbId: 'a' },
        { sql: 'SELECT 2', dbId: 'b' },
      ],
    );
    expect(reading.compared).toBe(2);
    expect(reading.disagreeing).toEqual([]);
  });

  it('reports the first disagreement with both texts, so it can be read without the files', () => {
    const reading = compareGold(
      [row('SELECT 1'), row('SELECT 3')] as never,
      [
        { sql: 'SELECT 1', dbId: 'a' },
        { sql: 'SELECT 2', dbId: 'a' },
      ],
    );
    expect(reading.disagreeing).toHaveLength(1);
    expect(reading.disagreeing[0]?.index).toBe(1);
    expect(reading.disagreeing[0]?.question_sql).toBe('SELECT 3');
    expect(reading.disagreeing[0]?.gold_sql).toBe('SELECT 2');
  });

  it('compares only as many rows as both files have, and says how many that was', () => {
    // The counts are reported beside `compared` so a caller can refuse a file of the wrong length;
    // this function does not decide that, because a shorter gold is a fact about the file and not
    // an error in the comparison.
    const reading = compareGold([row('SELECT 1'), row('SELECT 2')] as never, [{ sql: 'SELECT 1', dbId: 'a' }]);
    expect(reading.compared).toBe(1);
    expect(reading.questions).toBe(2);
    expect(reading.gold).toBe(1);
    expect(reading.disagreeing).toEqual([]);
  });

  it('does not forgive whitespace inside the statement', () => {
    // Trimming the ends is necessary — the file separates with a tab — but collapsing the middle
    // would hide the one failure this check exists to catch: a gold rebuilt from another revision.
    const reading = compareGold([row('SELECT  1')] as never, [{ sql: 'SELECT 1', dbId: 'a' }]);
    expect(reading.disagreeing).toHaveLength(1);
  });

  it('caps the disagreement list rather than carrying a whole corpus of them', () => {
    const rows = Array.from({ length: 50 }, (_, at) => row(`SELECT ${at}`));
    const gold = Array.from({ length: 50 }, () => ({ sql: 'SELECT -1', dbId: 'a' }));
    expect(compareGold(rows as never, gold, 3).disagreeing).toHaveLength(3);
  });
});
