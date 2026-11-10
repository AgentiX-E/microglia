import { describe, expect, it } from 'vitest';
import {
  GoldRevisionError,
  parseGoldRevision,
  reviseGold,
  revisionDigest,
} from '../gold-revision.js';
import type { BirdRow } from '../bird-rows.js';

const row = (over: Partial<BirdRow> = {}): BirdRow => ({
  question_id: 1471,
  db_id: 'debit_card_specializing',
  question: 'What is the ratio of customers who pay in EUR against customers who pay in CZK?',
  evidence: 'ratio = count(EUR) / count(CZK)',
  SQL: 'SELECT 1',
  difficulty: 'simple',
  ...over,
});

const file = (rows: readonly Record<string, unknown>[]): string => JSON.stringify(rows);

const entry = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  question_id: '1471',
  db_id: 'debit_card_specializing',
  question: 'What is the ratio of customers who pay in EUR against customers who pay in CZK?',
  SQL: 'SELECT 2',
  ...over,
});

describe('parseGoldRevision', () => {
  it('reads the published shape, whose ids are strings', () => {
    const entries = parseGoldRevision(file([entry()]), 'arcwise.json');
    expect(entries).toHaveLength(1);
    expect(entries[0]?.questionId).toBe(1471);
    expect(entries[0]?.dbId).toBe('debit_card_specializing');
    expect(entries[0]?.sql).toBe('SELECT 2');
  });

  it('refuses a file that is not a list, rather than reading zero rows from it', () => {
    // A revision that reads as empty applies nothing and reports `applied: 0`, which is
    // indistinguishable from a revision that agreed with every label.
    expect(() => parseGoldRevision('{"data": []}', 'arcwise.json')).toThrow(GoldRevisionError);
  });

  it('refuses a row without the four fields it needs', () => {
    expect(() => parseGoldRevision(file([entry({ SQL: undefined })]), 'arcwise.json')).toThrow(
      /needs question_id/,
    );
    expect(() => parseGoldRevision(file([entry({ question_id: null })]), 'arcwise.json')).toThrow(
      /needs question_id/,
    );
  });

  it('refuses a file that corrects one question twice', () => {
    // Two golds for one key is the file disagreeing with itself, and there is no defensible pick.
    expect(() => parseGoldRevision(file([entry(), entry()]), 'arcwise.json')).toThrow(
      /corrected twice/,
    );
  });

  it('does not treat a repeated id across two databases as one question', () => {
    const entries = parseGoldRevision(
      file([entry(), entry({ db_id: 'financial', SQL: 'SELECT 3' })]),
      'arcwise.json',
    );
    expect(entries).toHaveLength(2);
  });
});

describe('reviseGold', () => {
  const entries = parseGoldRevision(file([entry()]), 'arcwise.json');
  const digest = revisionDigest(file([entry()]));

  it('replaces the gold of a row whose question the two files agree on', () => {
    const result = reviseGold([row()], entries, 'arcwise.json', digest);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.SQL).toBe('SELECT 2');
    expect(result.reading.applied).toBe(1);
    expect(result.reading.unchanged).toBe(0);
    expect(result.reading.dropped).toEqual([]);
  });

  it('counts a row the correction agrees with rather than calling it an application', () => {
    const result = reviseGold([row({ SQL: 'SELECT 1' })], parseGoldRevision(file([entry({ SQL: 'SELECT 1' })]), 'a'), 'a', digest);
    expect(result.reading.applied).toBe(0);
    expect(result.reading.unchanged).toBe(1);
  });

  it('drops a row whose question the corrected release rewrote, and names both texts', () => {
    // The 44 rows in the transfer slice where question and gold both moved. Scoring an answer to the
    // pinned question against the corrected label is a corpus revision reported as a relabelling.
    const result = reviseGold(
      [row()],
      parseGoldRevision(file([entry({ question: 'Which segment grew fastest?' })]), 'a'),
      'a',
      digest,
    );
    expect(result.rows).toEqual([]);
    expect(result.dropped).toHaveLength(1);
    expect(result.reading.dropped).toEqual([
      {
        id: 'debit_card_specializing#1471',
        pinnedQuestion: row().question,
        correctedQuestion: 'Which segment grew fastest?',
      },
    ]);
    expect(result.reading.applied).toBe(0);
  });

  it('leaves a row the revision does not name on its pinned gold', () => {
    const untouched = row({ question_id: 9 });
    const result = reviseGold([untouched], entries, 'a', digest);
    expect(result.rows[0]?.SQL).toBe('SELECT 1');
    expect(result.reading.unmatched).toBe(1);
  });

  it('ignores whitespace at the edges of a question and nothing else', () => {
    const padded = row({ question: `  ${row().question}  ` });
    expect(reviseGold([padded], entries, 'a', digest).rows).toHaveLength(1);
    const punctuated = row({ question: `${row().question}?` });
    expect(reviseGold([punctuated], entries, 'a', digest).rows).toEqual([]);
  });

  it('reports how many entries name no row in this corpus', () => {
    // On a slice this is expected; on the whole of Mini-Dev it means the revision was built on a
    // different release, and the count is the only thing that says so.
    const result = reviseGold([], entries, 'a', digest);
    expect(result.reading.unmatched).toBe(1);
    expect(result.reading.entries).toBe(1);
    expect(result.rows).toEqual([]);
  });

  it('keeps the row order it was given, so a fold assignment does not move', () => {
    const rows = [row({ question_id: 1 }), row(), row({ question_id: 2 })];
    const result = reviseGold(rows, entries, 'a', digest);
    expect(result.rows.map((item) => item.question_id)).toEqual([1, 1471, 2]);
  });

  it('does not mutate the rows it was handed', () => {
    const original = row();
    reviseGold([original], entries, 'a', digest);
    expect(original.SQL).toBe('SELECT 1');
  });
});

describe('revisionDigest', () => {
  it('separates two revisions that differ by one statement', () => {
    const left = revisionDigest(file([entry({ SQL: 'SELECT 2' })]));
    const right = revisionDigest(file([entry({ SQL: 'SELECT 3' })]));
    expect(left).not.toBe(right);
    expect(left).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('a malformed revision file', () => {
  it('refuses a row that is not an object', () => {
    expect(() => parseGoldRevision('[null]', 'arcwise.json')).toThrow(/row 0 is not an object/);
  });
});
