/**
 * One SQL query against one database, with both encodings the criteria need.
 *
 * This lived inside a lane, which meant the two functions that decide what a result
 * *is* — the tuple order a Python comparison would see, and the canonical encoding this
 * repository compares — were reachable only by running a benchmark. They are the part
 * that can be wrong, so they are here, where a memory database can exercise them.
 *
 * `tuples` keeps select-list order and duplicate rows: that is the shape ROSE's baseline
 * compares, and reordering it would silently change which criterion a number came from.
 * `canonical` sorts column names, rounds floats and keeps duplicates, which is what the
 * S2 lane has always compared. Both come from one execution because executing twice is
 * how two criteria end up describing two different runs.
 *
 * A failed query is a value, not an exception: unexecutable predictions are data — the
 * share of them is a property of the model — and throwing would make a lane stop at the
 * first one instead of counting it.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { canonicalRows } from './sota.js';

export type QueryOutcome = {
  readonly ok: boolean;
  /** Cells in select-list order, duplicates kept: the shape a Python tuple comparison sees. */
  readonly tuples: readonly (readonly unknown[])[];
  /** Column names sorted, numbers rounded, duplicates kept: this repository's encoding. */
  readonly canonical: readonly string[];
  /** Column names in select-list order, empty when the query could not run. */
  readonly columns: readonly string[];
  /** Why the query failed, or undefined when it ran. */
  readonly error: string | undefined;
};

export type ExecuteOptions = {
  /** A file under test can be opened writable; a benchmark database never is. */
  readonly readOnly?: boolean;
};

export function executeQuery(dbPath: string, sql: string, options: ExecuteOptions = {}): QueryOutcome {
  const readOnly = options.readOnly ?? true;
  const failed = (error: unknown): QueryOutcome => ({
    ok: false,
    tuples: [],
    canonical: [],
    columns: [],
    // The driver's own words, including its `Error:` prefix. Rewriting the text would put
    // a branch in the error path, and an error path with an untested branch is where a
    // lane finds out at three in the morning that it reported nothing.
    error: `${error}`,
  });

  // Opening is separated from querying because the two failures mean different things: a
  // database that will not open is a broken run, a statement that will not prepare is one
  // wrong prediction. Collapsing them into one `try` also collapses them into one message.
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(dbPath, { readOnly });
  } catch (error) {
    return failed(error);
  }
  try {
    const rows = db.prepare(sql).all() as Record<string, unknown>[];
    const outcome: QueryOutcome = {
      ok: true,
      tuples: rows.map((row) => Object.values(row)),
      canonical: canonicalRows(rows),
      columns: rows.length === 0 ? [] : Object.keys(rows[0] as Record<string, unknown>),
      error: undefined,
    };
    db.close();
    return outcome;
  } catch (error) {
    db.close();
    return failed(error);
  }
}

/**
 * Whether two outcomes can be told apart by their rows.
 *
 * `true` means execution has something to say: the two queries returned different sets,
 * so they are not logically equivalent. `false` means it has nothing to say — equal rows
 * are consistent with equivalence without proving it. Nothing here returns `undefined`:
 * a query that failed to run still gives an answer ("this one did not produce the other's
 * rows"), and treating it as unknown would let a broken prediction escape the veto.
 */
export function rowsDiffer(left: QueryOutcome, right: QueryOutcome): boolean {
  if (!left.ok || !right.ok) return true;
  const leftSet = new Set(left.tuples.map((row) => JSON.stringify(row)));
  const rightSet = new Set(right.tuples.map((row) => JSON.stringify(row)));
  if (leftSet.size !== rightSet.size) return true;
  for (const key of leftSet) if (!rightSet.has(key)) return true;
  return false;
}

/**
 * Where a benchmark database actually is, under the layouts BIRD has shipped.
 *
 * The vendor's archive nests `dev_databases/<db>/<db>.sqlite`; an extracted copy made by
 * hand is usually flat. Guessing one layout produces a lane that "cannot find the
 * database" for a directory the operator extracted correctly, so both are tried and the
 * caller never sees the difference. The first candidate is returned even when nothing
 * exists, so the failure surfaces as the driver's message about that path rather than as
 * a second, less specific error about a missing file.
 */
export function resolveDatabase(directory: string, dbId: string): string {
  const candidates = [
    join(directory, `${dbId}.sqlite`),
    join(directory, 'dev_databases', dbId, `${dbId}.sqlite`),
    join(directory, 'MINIDEV', 'dev_databases', dbId, `${dbId}.sqlite`),
    join(directory, 'minidev', 'MINIDEV', 'dev_databases', dbId, `${dbId}.sqlite`),
    // The vendor archive unpacks to `minidev/MINIDEV/...`; a directory the extractor
    // already named `minidev` therefore ends up with two of them. Guessing which one the
    // operator has produces a lane that cannot find databases it extracted correctly.
    join(directory, 'minidev', 'minidev', 'MINIDEV', 'dev_databases', dbId, `${dbId}.sqlite`),
  ];
  for (const candidate of candidates) if (existsSync(candidate)) return candidate;
  return candidates[0] as string;
}
