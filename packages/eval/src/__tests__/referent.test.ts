/**
 * Whether a question says which columns it needs, and whether the pack's damage follows that.
 *
 * Three things are pinned here. The band cut points, because a coverage of exactly one half is the
 * boundary the two middle bands share and an off-by-one there would move questions between strata
 * silently. The star-projection rule, because counting `SELECT *` as a column requirement would
 * report a question as silent about something it never had to say. And the four buckets coming back
 * in a fixed order even when three of them are empty, because a reading whose shape depends on the
 * data cannot be compared against the previous round's.
 */
import { describe, expect, it } from 'vitest';
import { bucketOf, referentOf, referentSplitOf } from '../referent.js';
import type { DiffCase } from '../query-diff.js';

describe('bucketOf', () => {
  it('puts the boundaries where the documentation says they are', () => {
    expect(bucketOf(0)).toBe('none');
    expect(bucketOf(0.34)).toBe('few');
    expect(bucketOf(0.5)).toBe('most');
    expect(bucketOf(0.99)).toBe('most');
    expect(bucketOf(1)).toBe('all');
  });

  it('treats a coverage below zero as none rather than throwing', () => {
    // Not reachable from `referentOf`, and stated so a caller computing a coverage elsewhere gets
    // a band rather than a crash.
    expect(bucketOf(-0.5)).toBe('none');
  });
});

describe('referentOf', () => {
  it('finds an answer that names everything the question named', () => {
    const reading = referentOf('SELECT T1.name FROM student AS T1', 'What is the name of each student?');
    expect(reading).toMatchObject({ columns: 1, mentioned: 1, coverage: 1, bucket: 'all' });
  });

  it('finds an answer whose columns the question never mentions', () => {
    const reading = referentOf('SELECT T1.advisor FROM student AS T1', 'List the students.');
    expect(reading).toMatchObject({ columns: 1, mentioned: 0, coverage: 0, bucket: 'none' });
  });

  it('counts a column the evidence names, because a solver may read the evidence', () => {
    const withEvidence = referentOf(
      'SELECT T1.advisor FROM student AS T1',
      'List the students.',
      'advisor is the faculty member assigned to the student',
    );
    expect(withEvidence.mentioned).toBe(1);
    expect(withEvidence.bucket).toBe('all');
  });

  it('drops a star projection instead of crediting it to the question', () => {
    // `SELECT count(*)` requires no column, so a question that names nothing has omitted nothing.
    const reading = referentOf('SELECT count(*) FROM student', 'How many students are there?');
    expect(reading.columns).toBe(0);
    expect(reading.coverage).toBe(1);
    expect(reading.bucket).toBe('all');
  });

  it('counts a distinct column once, so a self-join cannot outvote the question', () => {
    // `name` appears on both sides of the join and `id` in the predicate. Three occurrences, two
    // columns: a count that did not deduplicate would report a coverage of two thirds instead of
    // one and move the question into the wrong band.
    const reading = referentOf(
      'SELECT T1.name FROM student AS T1 JOIN student AS T2 ON T1.id = T2.id WHERE T2.name = 1',
      'What is the name and id of each student?',
    );
    expect(reading.columns).toBe(2);
    expect(reading.mentioned).toBe(2);
    expect(reading.bucket).toBe('all');
  });

  it('lands between the bands when the question names some columns but not all', () => {
    const reading = referentOf(
      'SELECT T1.name, T1.advisor, T1.age FROM student AS T1',
      'What is the name of each student?',
    );
    expect(reading.columns).toBe(3);
    expect(reading.mentioned).toBe(1);
    expect(reading.bucket).toBe('few');
  });
});

describe('referentSplitOf', () => {
  const entry = (id: string, goldSql: string, question: string, difficulty = 'simple'): DiffCase => ({
    id,
    dbId: 'db_one',
    delta: { ungrounded: [] } as never,
    correct: true,
    withoutMemoryCorrect: false,
    goldSql,
    question,
    difficulty,
  });

  it('returns all four bands in a fixed order, including the empty ones', () => {
    const strata = referentSplitOf([entry('a', 'SELECT T1.name FROM s AS T1', 'the name')], { resamples: 100 });
    expect(strata.map((stratum) => stratum.bucket)).toEqual(['none', 'few', 'most', 'all']);
    expect(strata.find((stratum) => stratum.bucket === 'all')?.cell.n).toBe(1);
    expect(strata.find((stratum) => stratum.bucket === 'none')?.cell.n).toBe(0);
  });

  it('leaves an empty band null rather than zero', () => {
    const strata = referentSplitOf([entry('a', 'SELECT T1.advisor FROM s AS T1', 'List the students.')], {
      resamples: 100,
    });
    const empty = strata.find((stratum) => stratum.bucket === 'all');
    expect(empty?.cell.deltaPp).toBeNull();
  });

  it('scopes to a difficulty label when one is asked for', () => {
    const cases = [
      entry('a', 'SELECT T1.name FROM s AS T1', 'the name', 'simple'),
      entry('b', 'SELECT T1.name FROM s AS T1', 'the name', 'challenging'),
    ];
    const simple = referentSplitOf(cases, { difficulty: 'simple', resamples: 100 });
    expect(simple.find((stratum) => stratum.bucket === 'all')?.cell.n).toBe(1);
    const missing = referentSplitOf(cases, { difficulty: 'moderate', resamples: 100 });
    expect(missing.every((stratum) => stratum.cell.n === 0)).toBe(true);
  });

  it('skips a case with no reference query rather than counting it as silent', () => {
    // The absence of a reference query is not evidence that the question said nothing; it is
    // evidence that this corpus cannot answer the question for that row.
    const bare: DiffCase = { id: 'x', dbId: 'db_one', delta: { ungrounded: [] } as never, correct: true, withoutMemoryCorrect: false };
    const strata = referentSplitOf([bare, entry('a', 'SELECT T1.name FROM s AS T1', 'the name')], { resamples: 100 });
    const total = strata.reduce((sum, stratum) => sum + stratum.cell.n, 0);
    expect(total).toBe(1);
  });

  it('defaults the resample count rather than requiring it', () => {
    const strata = referentSplitOf([entry('a', 'SELECT T1.name FROM s AS T1', 'the name')]);
    expect(strata.find((stratum) => stratum.bucket === 'all')?.cell.n).toBe(1);
  });

  it('treats a case with no question text as naming nothing', () => {
    // A run that stored its gold query but not its question can still be classified, and the honest
    // reading is that a question nobody recorded named no column.
    const noText: DiffCase = {
      id: 'y',
      dbId: 'db_one',
      delta: { ungrounded: [] } as never,
      correct: true,
      withoutMemoryCorrect: false,
      goldSql: 'SELECT T1.name FROM s AS T1',
    };
    const strata = referentSplitOf([noText], { resamples: 100 });
    expect(strata.find((stratum) => stratum.bucket === 'none')?.cell.n).toBe(1);
  });
});
