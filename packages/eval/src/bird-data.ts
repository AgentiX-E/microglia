/**
 * The S2 dataset, pinned.
 *
 * BIRD Mini-Dev is not one artefact from one place. The question bank lives in
 * `birdsql/bird_mini_dev` and in `bird-bench/mini_dev`; the SQLite databases the
 * questions actually reference are distributed as an archive from the vendor's own
 * CDN. A lane that fetches "whatever the dataset API lists" gets questions and no
 * databases — which is exactly what happened in iteration 3, and why the lane
 * could not produce an accuracy number.
 *
 * The archive was measured rather than assumed (2026-10-23):
 *
 *   url          https://bird-bench.oss-cn-beijing.aliyuncs.com/minidev.zip
 *   bytes        800,943,648
 *   sha256       cc48ba16838204e4e214512030cb572eeb5f7bcdd999bae4b9b6ff12ec13b92f
 *   last-modified 2024-06-20
 *   contents     122 files: 11 SQLite databases, `mini_dev_sqlite.json`, gold SQL
 *   licence      CC BY-SA 4.0, per the vendor's site (modified 2024-04-27)
 *
 * Pinning the URL and the digest is what makes the lane reproducible without
 * re-hosting someone else's 764 MiB: the file is fetched from the vendor, and a
 * changed byte anywhere in it fails the run instead of quietly moving the number.
 *
 * ## The check that matters more than the digest
 *
 * A digest proves *which* file arrived, not that the file contains data. The
 * databases circulating next to this benchmark include schema-only templates, and a
 * lane that executes SQL against an empty database reports an accuracy of about
 * zero for both arms — a plausible-looking result produced by an empty table. So
 * every database is opened and counted before the first model call.
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

export type BirdManifest = {
  readonly name: string;
  readonly version: string;
  readonly url: string;
  readonly bytes: number;
  readonly sha256: string;
  /** SPDX identifier, as the vendor states it. */
  readonly licence: string;
  readonly attribution: string;
  /** Directory the archive extracts to, relative to the extraction root. */
  readonly root: string;
  readonly databases: readonly string[];
  readonly retrievedAt: string;
};

export type BirdDataErrorReason =
  | 'manifest-field'
  | 'manifest-shape'
  | 'size-mismatch'
  | 'digest-mismatch'
  | 'missing-databases'
  | 'empty-database'
  | 'unreadable-database';

export class BirdDataError extends Error {
  public readonly reason: BirdDataErrorReason;

  public constructor(reason: BirdDataErrorReason, message: string) {
    super(`${reason}: ${message}`);
    this.name = 'BirdDataError';
    this.reason = reason;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function text(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  if (typeof value !== 'string' || value.length === 0) {
    throw new BirdDataError('manifest-field', `\`${field}\` must be a non-empty string`);
  }
  return value;
}

/**
 * Read a manifest, refusing anything incomplete.
 *
 * A manifest with a missing digest is worse than no manifest: it looks like
 * integrity is checked while the comparison silently falls back to "whatever
 * arrived".
 */
export function parseManifest(value: unknown): BirdManifest {
  const record = asRecord(value);
  if (record === undefined) throw new BirdDataError('manifest-shape', 'the manifest is not an object');
  const bytes = record['bytes'];
  if (typeof bytes !== 'number' || !Number.isInteger(bytes) || bytes <= 0) {
    throw new BirdDataError('manifest-field', '`bytes` must be a positive integer');
  }
  const sha256 = text(record, 'sha256');
  if (!/^[0-9a-f]{64}$/.test(sha256)) {
    throw new BirdDataError('manifest-field', '`sha256` must be 64 lowercase hex characters');
  }
  const databases = record['databases'];
  if (!Array.isArray(databases) || databases.length === 0) {
    throw new BirdDataError('manifest-field', '`databases` must be a non-empty array');
  }
  const ids = databases.map((entry) => {
    if (typeof entry !== 'string' || entry.length === 0) {
      throw new BirdDataError('manifest-field', 'every database id must be a non-empty string');
    }
    return entry;
  });
  return {
    name: text(record, 'name'),
    version: text(record, 'version'),
    url: text(record, 'url'),
    bytes,
    sha256,
    licence: text(record, 'licence'),
    attribution: text(record, 'attribution'),
    root: text(record, 'root'),
    databases: ids,
    retrievedAt: text(record, 'retrievedAt'),
  };
}

/** What arrived, against what was promised. */
export function archiveVerdict(
  manifest: BirdManifest,
  observed: { readonly bytes: number; readonly sha256: string },
): { readonly ok: boolean; readonly reason: 'ok' | 'size' | 'digest' } {
  if (observed.bytes !== manifest.bytes) return { ok: false, reason: 'size' };
  if (observed.sha256 !== manifest.sha256) return { ok: false, reason: 'digest' };
  return { ok: true, reason: 'ok' };
}

/** Database ids the questions use that the archive does not carry. */
export function missingDatabases(
  manifest: BirdManifest,
  used: readonly string[],
): readonly string[] {
  const present = new Set(manifest.databases);
  return [...new Set(used)].filter((id) => !present.has(id)).sort();
}

/**
 * Count what a database actually holds.
 *
 * `rows` is the sum of `COUNT(*)` over the user tables. A schema-only template
 * reports `tables > 0, rows === 0`, which is the state this function exists to
 * make visible: the lane must refuse to measure against it rather than report an
 * accuracy that belongs to an empty table.
 */
export function populationOf(path: string): { readonly tables: number; readonly rows: number } {
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(path, { readOnly: true });
  } catch (error) {
    throw new BirdDataError('unreadable-database', `${path}: ${String(error).slice(0, 160)}`);
  }
  try {
    const names = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all() as { name: string }[];
    let rows = 0;
    for (const table of names) {
      const counted = db.prepare(`SELECT COUNT(*) AS n FROM "${table.name.replace(/"/g, '""')}"`).get() as
        | { n: number }
        | undefined;
      rows += counted?.n ?? 0;
    }
    return { tables: names.length, rows };
  } finally {
    db.close();
  }
}

/** Refuse a database that cannot support an execution-accuracy measurement. */
export function requirePopulated(path: string, dbId: string): { readonly tables: number; readonly rows: number } {
  const counted = populationOf(path);
  if (counted.tables === 0) {
    throw new BirdDataError('empty-database', `${dbId}: no tables in ${path}`);
  }
  if (counted.rows === 0) {
    throw new BirdDataError(
      'empty-database',
      `${dbId}: ${counted.tables} table(s) and no rows in ${path} — a schema-only template cannot score execution`,
    );
  }
  return counted;
}

/**
 * SHA-256 of a file, streamed.
 *
 * The archive is 764 MiB: reading it into memory to hash it would work and would
 * also be the largest allocation in the process. A stream keeps the cost flat.
 */
export function sha256OfFile(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(path);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}
