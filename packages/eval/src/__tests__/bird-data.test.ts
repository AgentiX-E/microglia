import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, describe, expect, it } from 'vitest';
import {
  BirdDataError,
  archiveVerdict,
  missingDatabases,
  parseManifest,
  populationOf,
  requirePopulated,
  dedupeQuestions,
  sha256OfFile,
  type BirdDataErrorReason,
} from '../bird-data.js';

const manifestPath = new URL('../../../../eval/manifests/bird-minidev.json', import.meta.url);
const raw: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'));
const manifest = parseManifest(raw);

const workdir = mkdtempSync(join(tmpdir(), 'bird-data-'));
afterAll(() => rmSync(workdir, { recursive: true, force: true }));

function database(name: string, statements: readonly string[]): string {
  const path = join(workdir, `${name}.sqlite`);
  const db = new DatabaseSync(path);
  for (const sql of statements) db.exec(sql);
  db.close();
  return path;
}

function reasonOf(run: () => unknown): BirdDataErrorReason {
  try {
    run();
  } catch (error) {
    if (error instanceof BirdDataError) return error.reason;
    throw error;
  }
  throw new Error('the call did not throw');
}

describe('the shipped manifest', () => {
  it('parses, and pins the archive that was actually measured', () => {
    expect(manifest.name).toBe('bird-mini-dev');
    expect(manifest.bytes).toBe(800_943_648);
    expect(manifest.sha256).toBe('cc48ba16838204e4e214512030cb572eeb5f7bcdd999bae4b9b6ff12ec13b92f');
    expect(manifest.licence).toBe('CC-BY-SA-4.0');
    expect(manifest.root).toBe('minidev/MINIDEV');
    expect(manifest.databases).toHaveLength(11);
  });

  it('lists the databases the archive holds, alphabetically, with no duplicates', () => {
    expect(manifest.databases).toEqual([...manifest.databases].sort());
    expect(new Set(manifest.databases).size).toBe(manifest.databases.length);
    expect(manifest.databases).toContain('financial');
  });
});

describe('what a manifest refuses', () => {
  it('refuses a document that is not an object', () => {
    expect(reasonOf(() => parseManifest([]))).toBe('manifest-shape');
    expect(reasonOf(() => parseManifest(null))).toBe('manifest-shape');
  });

  it('refuses a missing or mistyped field', () => {
    expect(reasonOf(() => parseManifest({ ...manifest, sha256: undefined }))).toBe('manifest-field');
    expect(reasonOf(() => parseManifest({ ...manifest, bytes: 0 }))).toBe('manifest-field');
    expect(reasonOf(() => parseManifest({ ...manifest, bytes: 1.5 }))).toBe('manifest-field');
    expect(reasonOf(() => parseManifest({ ...manifest, url: '' }))).toBe('manifest-field');
    expect(reasonOf(() => parseManifest({ ...manifest, databases: [] }))).toBe('manifest-field');
    expect(reasonOf(() => parseManifest({ ...manifest, databases: [''] }))).toBe('manifest-field');
  });

  it('refuses a digest that is not a digest', () => {
    // A short string would compare unequal to everything and look like a mismatch,
    // which is a worse failure than a refusal at read time.
    expect(reasonOf(() => parseManifest({ ...manifest, sha256: 'cc48ba16' }))).toBe('manifest-field');
    expect(reasonOf(() => parseManifest({ ...manifest, sha256: 'C'.repeat(64) }))).toBe('manifest-field');
  });
});

describe('what arrived against what was promised', () => {
  it('accepts the measured file', () => {
    expect(archiveVerdict(manifest, { bytes: manifest.bytes, sha256: manifest.sha256 })).toEqual({
      ok: true,
      reason: 'ok',
    });
  });

  it('reports a truncated download as a size mismatch before hashing', () => {
    expect(archiveVerdict(manifest, { bytes: manifest.bytes - 1, sha256: manifest.sha256 }).reason).toBe('size');
  });

  it('reports a same-size file with different bytes as a digest mismatch', () => {
    expect(archiveVerdict(manifest, { bytes: manifest.bytes, sha256: 'a'.repeat(64) }).reason).toBe('digest');
  });

  it('names the databases the questions use but the archive lacks', () => {
    expect(missingDatabases(manifest, ['financial', 'financial'])).toEqual([]);
    expect(missingDatabases(manifest, ['financial', 'not_a_db', 'also_missing'])).toEqual([
      'also_missing',
      'not_a_db',
    ]);
  });
});

describe('hashing the archive', () => {
  it('matches node:crypto on a multi-chunk file', async () => {
    const path = join(workdir, 'payload.bin');
    // Larger than one read chunk, so the stream path is exercised rather than a
    // single-shot hash that would pass on any implementation.
    const bytes = Buffer.alloc(300_000, 7);
    writeFileSync(path, bytes);
    const expected = createHash('sha256').update(bytes).digest('hex');
    await expect(sha256OfFile(path)).resolves.toBe(expected);
  });

  it('rejects a file that is not there', async () => {
    await expect(sha256OfFile(join(workdir, 'absent.bin'))).rejects.toThrow(/ENOENT/);
  });
});

describe('what a database actually holds', () => {
  it('counts tables and rows in a real database', () => {
    const path = database('populated', [
      'CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT)',
      "INSERT INTO customers (name) VALUES ('a'), ('b'), ('c')",
      'CREATE TABLE orders (id INTEGER PRIMARY KEY)',
      'INSERT INTO orders DEFAULT VALUES',
    ]);
    expect(populationOf(path)).toEqual({ tables: 2, rows: 4 });
  });

  it('reports a schema-only template as tables without rows', () => {
    const path = database('template', ['CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT)']);
    expect(populationOf(path)).toEqual({ tables: 1, rows: 0 });
    // The point of the function: this is the state that must stop a run, because an
    // accuracy measured against it belongs to an empty table.
    expect(reasonOf(() => requirePopulated(path, 'template'))).toBe('empty-database');
  });

  it('refuses a database with no tables at all', () => {
    const path = database('blank', []);
    expect(reasonOf(() => requirePopulated(path, 'blank'))).toBe('empty-database');
  });

  it('refuses a file that is not a database', () => {
    expect(reasonOf(() => populationOf(join(workdir, 'missing.sqlite')))).toBe('unreadable-database');
  });

  it('accepts a populated database and says how much it found', () => {
    const path = database('ok', [
      'CREATE TABLE t (id INTEGER PRIMARY KEY)',
      'INSERT INTO t DEFAULT VALUES',
    ]);
    expect(requirePopulated(path, 'ok')).toEqual({ tables: 1, rows: 1 });
  });
});

describe('the questions the archive repeats', () => {
  const question = (id: number, text: string, sql = 'SELECT 1') => ({
    db_id: 'financial',
    question_id: id,
    question: text,
    SQL: sql,
  });

  it('drops a byte-identical repeat and counts it', () => {
    // The pinned Mini-Dev file really does this: `financial#137` and `#138` appear
    // twice, verbatim, so 500 records describe 498 questions. Counting the question
    // twice would give it two votes in a paired test.
    const result = dedupeQuestions([
      question(1, 'How many accounts?'),
      question(2, 'How many clients?'),
      question(1, 'How many accounts?'),
    ]);
    expect(result.rows.map((row) => row.question_id)).toEqual([1, 2]);
    expect(result.duplicates).toBe(1);
  });

  it('refuses an id that names two different questions', () => {
    // One id, two questions is a different situation from a repeated row, and there
    // is no defensible way to choose between them: the run has to stop.
    expect(() =>
      dedupeQuestions([question(1, 'How many accounts?'), question(1, 'How many clients?')]),
    ).toThrow(/question-id-collision/);
  });

  it('keeps the same id in two databases, because the key is the pair', () => {
    const other = { ...question(1, 'A different question'), db_id: 'superhero' };
    const result = dedupeQuestions([question(1, 'How many accounts?'), other]);
    expect(result.rows).toHaveLength(2);
    expect(result.duplicates).toBe(0);
  });
});
