import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, describe, expect, it } from 'vitest';
import { executeQuery, resolveDatabase, rowsDiffer } from '../sql-exec.js';

const directory = mkdtempSync(join(tmpdir(), 'microglia-sql-'));
const database = join(directory, 'fixture.sqlite');
{
  const db = new DatabaseSync(database);
  db.exec(`
    CREATE TABLE t (id INTEGER, label TEXT, amount REAL);
    INSERT INTO t VALUES (1, 'a', 1.23456789), (1, 'a', 1.23456789), (2, NULL, 2.0), (3, 'a', 1.23456789);
  `);
  db.close();
}

afterAll(() => rmSync(directory, { recursive: true, force: true }));

describe('executeQuery', () => {
  it('returns the rows and the columns a caller needs', () => {
    const outcome = executeQuery(database, 'SELECT id, label FROM t ORDER BY id');
    expect(outcome.ok).toBe(true);
    expect(outcome.columns).toEqual(['id', 'label']);
    expect(outcome.tuples).toEqual([
      [1, 'a'],
      [1, 'a'],
      [2, null],
      [3, 'a'],
    ]);
    expect(outcome.error).toBeUndefined();
  });

  it('keeps select-list order in the tuples, which is what a position comparison sees', () => {
    // Reordering here would silently change which criterion a number came from: ROSE
    // compares tuples by position, this repository compares canonical rows by name.
    const outcome = executeQuery(database, 'SELECT label, id FROM t ORDER BY id LIMIT 1');
    expect(outcome.tuples).toEqual([['a', 1]]);
  });

  it('keeps duplicates and sorts columns in the canonical encoding', () => {
    const outcome = executeQuery(database, 'SELECT id, label FROM t ORDER BY id');
    // Rows 1 and 3 are identical, so the multiset reading must see three entries.
    expect(outcome.canonical).toHaveLength(4);
    // Columns are sorted by name, so `id` precedes `label` in the encoding.
    expect(outcome.canonical.filter((row) => row === '[1,"a"]')).toHaveLength(2);
  });

  it('rounds a float to six places in the canonical encoding but not in the tuple', () => {
    const outcome = executeQuery(database, 'SELECT amount FROM t WHERE id = 1 LIMIT 1');
    expect(outcome.canonical).toEqual(['[1.234568]']);
    expect(outcome.tuples).toEqual([[1.23456789]]);
  });

  it('returns an empty column list when the query matched nothing', () => {
    const outcome = executeQuery(database, 'SELECT id FROM t WHERE id > 99');
    expect(outcome.ok).toBe(true);
    expect(outcome.tuples).toEqual([]);
    expect(outcome.columns).toEqual([]);
  });

  it('reports a failed query as a value rather than throwing', () => {
    // A lane that stopped at the first broken prediction would report the model's
    // failure as its own.
    const outcome = executeQuery(database, 'SELECT missing_column FROM t');
    expect(outcome.ok).toBe(false);
    expect(outcome.tuples).toEqual([]);
    expect(outcome.canonical).toEqual([]);
    expect(outcome.columns).toEqual([]);
    expect(outcome.error).toMatch(/missing_column/);
  });

  it('reports a missing database as a failed query, not a crash', () => {
    const outcome = executeQuery(join(directory, 'absent.sqlite'), 'SELECT 1');
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toBeDefined();
  });

  it('refuses to write when opened read-only, which is the benchmark default', () => {
    const outcome = executeQuery(database, "INSERT INTO t VALUES (4, 'd', 4.0)");
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toBeDefined();
  });

  it('can open a file writable when a caller asks for it', () => {
    const scratch = join(directory, 'writable.sqlite');
    {
      const db = new DatabaseSync(scratch);
      db.exec('CREATE TABLE t (a INTEGER)');
      db.close();
    }
    const outcome = executeQuery(scratch, 'INSERT INTO t VALUES (1)', { readOnly: false });
    expect(outcome.ok).toBe(true);
  });
});

describe('rowsDiffer', () => {
  const same = executeQuery(database, 'SELECT id FROM t WHERE id = 1');
  const sameAgain = executeQuery(database, 'SELECT id FROM t WHERE id = 1');
  const other = executeQuery(database, 'SELECT id FROM t WHERE id = 2');

  it('is false when the two queries returned the same rows', () => {
    expect(rowsDiffer(same, sameAgain)).toBe(false);
  });

  it('is true when they returned different rows', () => {
    expect(rowsDiffer(same, other)).toBe(true);
  });

  it('is true when one result is a strict subset of the other', () => {
    // Different sizes take a different branch from different contents, and both have to
    // answer the same way: the queries can be told apart.
    const two = executeQuery(database, 'SELECT id FROM t WHERE id <= 2');
    const one = executeQuery(database, 'SELECT id FROM t WHERE id = 1');
    expect(rowsDiffer(two, one)).toBe(true);
    expect(rowsDiffer(one, two)).toBe(true);
  });

  it('is true when either query failed, because a failed query did not produce the other rows', () => {
    const broken = executeQuery(database, 'SELECT missing_column FROM t');
    expect(rowsDiffer(broken, same)).toBe(true);
    expect(rowsDiffer(same, broken)).toBe(true);
    expect(rowsDiffer(broken, broken)).toBe(true);
  });

  it('ignores row order and duplicates, because it asks a question about sets', () => {
    // The veto is about whether the two queries can be told apart, and a repeated row is
    // not a different answer to the question that was asked.
    const two = executeQuery(database, 'SELECT id FROM t WHERE id <= 3');
    const twoDuplicated = executeQuery(database, 'SELECT id FROM t WHERE id <= 3 UNION ALL SELECT 1');
    expect(rowsDiffer(two, twoDuplicated)).toBe(false);
  });
});

describe('resolveDatabase', () => {
  it('finds a flat extraction', () => {
    expect(resolveDatabase(directory, 'fixture')).toBe(database);
  });

  it('finds the nested layout the vendor archive ships', () => {
    // A database that exists only in the nested layout, because a flat copy would win
    // the precedence race and the test would then prove nothing about nesting.
    const nested = join(directory, 'minidev', 'MINIDEV', 'dev_databases', 'nested-only');
    mkdirSync(nested, { recursive: true });
    const placed = join(nested, 'nested-only.sqlite');
    writeFileSync(placed, '');
    expect(resolveDatabase(directory, 'nested-only')).toBe(placed);
  });

  it('finds the shallow nested layout too, because hand-extracted copies use it', () => {
    const shallowDir = join(directory, 'shallow');
    const nested = join(shallowDir, 'dev_databases', 'other');
    mkdirSync(nested, { recursive: true });
    const placed = join(nested, 'other.sqlite');
    writeFileSync(placed, '');
    expect(resolveDatabase(shallowDir, 'other')).toBe(placed);
  });

  it('returns the flat path when nothing exists, so the driver reports the path it tried', () => {
    expect(resolveDatabase(join(directory, 'absent-dir'), 'gone')).toBe(
      join(directory, 'absent-dir', 'gone.sqlite'),
    );
  });
});
