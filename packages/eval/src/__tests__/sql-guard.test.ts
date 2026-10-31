import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BoundedSql } from '../sql-guard.js';

/**
 * A database small enough to build in a millisecond and awkward enough to hang a statement.
 *
 * Two thousand rows is enough that a three-way cross join is 8×10^9 rows: SQLite will not finish
 * that in any deadline this suite uses, and it will not finish it in an hour either, which is the
 * situation the guard exists for.
 */
let root = '';
let small = '';
let guarded: BoundedSql | undefined;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'mg-sql-guard-'));
  small = join(root, 'small.db');
  const db = new DatabaseSync(small);
  db.exec('create table t(id integer, name text); create table u(id integer);');
  const insert = db.prepare('insert into t values (?, ?)');
  const other = db.prepare('insert into u values (?)');
  // One transaction, because four thousand autocommits are four thousand fsyncs and the fixture
  // would cost more than the subject.
  db.exec('begin');
  for (let i = 0; i < 2000; i += 1) {
    insert.run(i, `row-${i}`);
    other.run(i);
  }
  db.exec('commit');
  db.close();
});

afterAll(async () => {
  await guarded?.close();
  rmSync(root, { recursive: true, force: true });
});

function guard(options?: ConstructorParameters<typeof BoundedSql>[0]): BoundedSql {
  guarded = new BoundedSql(options);
  return guarded;
}

describe('a statement with a deadline', () => {
  it('returns the rows of a query that runs', async () => {
    const sql = guard();
    const result = await sql.run(small, 'select count(*) as n from t');
    expect(result.ok).toBe(true);
    expect(result.deadline).toBe(false);
    expect(result.rows).toEqual([{ n: 2000 }]);
    expect(sql.stats()).toEqual({ statements: 1, deadlines: 0, truncations: 0 });
  });

  it('accepts the trailing semicolon a model writes, and only one statement', async () => {
    const sql = guard();
    expect((await sql.run(small, 'select 1 as one;  ')).rows).toEqual([{ one: 1 }]);
    // Two statements cannot be wrapped in a subquery, so the second is refused rather than
    // executed half-way — a lane that ran the first and reported the second never happened would
    // be scoring a query nobody wrote.
    const two = await sql.run(small, 'select 1 as one; select 2 as two');
    expect(two.ok).toBe(false);
    expect(two.deadline).toBe(false);
  });

  it('refuses an empty statement without paying for a thread', async () => {
    const sql = guard();
    const result = await sql.run(small, '   ;  ');
    expect(result).toMatchObject({ ok: false, deadline: false, error: 'empty statement', ms: 0 });
    expect(sql.stats().statements).toBe(1);
  });

  it('reports a statement that does not prepare as an error, not as a deadline', async () => {
    const sql = guard();
    const result = await sql.run(small, 'select nothing_at_all from t');
    expect(result.ok).toBe(false);
    expect(result.deadline).toBe(false);
    expect(result.error).toContain('nothing_at_all');
    expect(sql.stats()).toMatchObject({ deadlines: 0 });
  });

  it('caps the rows and says it did', async () => {
    const sql = guard({ rowCap: 5 });
    const result = await sql.run(small, 'select id from t');
    expect(result.ok).toBe(true);
    expect(result.rows).toHaveLength(5);
    expect(result.truncated).toBe(true);
    expect(sql.stats().truncations).toBe(1);
  });

  it('does not call a result truncated when it is exactly at the cap', async () => {
    const sql = guard({ rowCap: 2000 });
    const result = await sql.run(small, 'select id from t');
    expect(result.rows).toHaveLength(2000);
    expect(result.truncated).toBe(false);
    expect(sql.stats().truncations).toBe(0);
  });

  it('kills a statement that outlives its deadline, and keeps working afterwards', async () => {
    const sql = guard({ deadlineMs: 250 });
    const started = Date.now();
    const result = await sql.run(small, 'select count(*) as n from t, u, t as t2');
    const elapsed = Date.now() - started;
    expect(result.deadline).toBe(true);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('deadline');
    // The point of the guard: the lane gets its turn back in about the deadline, not in hours.
    expect(elapsed).toBeLessThan(5_000);
    expect(sql.stats().deadlines).toBe(1);
    // The terminated worker is replaced, so the next statement is not queued behind a corpse.
    const after = await sql.run(small, 'select 7 as seven');
    expect(after.rows).toEqual([{ seven: 7 }]);
  });

  it('serves more statements than its width, and more than one at a time', async () => {
    const sql = guard({ workers: 2 });
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, index) => sql.run(small, `select ${index} as n`)),
    );
    expect(results.map((entry) => entry.rows)).toEqual([[{ n: 0 }], [{ n: 1 }], [{ n: 2 }], [{ n: 3 }], [{ n: 4 }]]);
    expect(sql.stats().statements).toBe(5);
  });

  it('hands the queue a replacement after a deadline while others wait', async () => {
    const sql = guard({ deadlineMs: 250, workers: 1 });
    const slow = sql.run(small, 'select count(*) as n from t, u, t as t2');
    const fast = sql.run(small, 'select 1 as one');
    const [killed, served] = await Promise.all([slow, fast]);
    expect(killed.deadline).toBe(true);
    expect(served.rows).toEqual([{ one: 1 }]);
  });

  it('reports a statement whose process died before answering', async () => {
    // Closing while a statement is in flight is the reachable version of "the child is gone": the
    // run is over, the work is not, and the promise must settle rather than wait for a reply that
    // will never come.
    const sql = new BoundedSql({ deadlineMs: 30_000, workers: 1 });
    const running = sql.run(small, 'select count(*) as n from t, u, t as t2');
    // Long enough that the statement has been written to the child and is running inside the driver:
    // the failure this covers is "the process is gone while the statement is in flight", not "the
    // message never left", and those two take different paths out of `#ask`.
    await new Promise((resolve) => setTimeout(resolve, 150));
    await sql.close();
    const result = await running;
    expect(result.ok).toBe(false);
    expect(result.deadline).toBe(false);
    expect(result.error).toBe('the statement process exited');
  });

  it('refuses to run after it is closed', async () => {
    const sql = new BoundedSql();
    expect((await sql.run(small, 'select 1 as one')).ok).toBe(true);
    await sql.close();
    await expect(sql.run(small, 'select 1 as one')).rejects.toThrow('BoundedSql is closed');
  });
});
