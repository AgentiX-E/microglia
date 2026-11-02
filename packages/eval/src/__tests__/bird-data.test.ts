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
  unreachableDatabases,
  parseManifest,
  poolOf,
  populationOf,
  requirePopulated,
  dedupeQuestions,
  sha256OfFile,
  isSimple,
  splitFrom,
  SPLITS,
  withinDatabases,
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
    expect(manifest.questions).toBe('mini_dev_sqlite.json');
    expect(manifest.databases).toHaveLength(11);
  });

  it('ships a second manifest for the full dev split, pinned to its own archive', () => {
    const devPath = new URL('../../../../eval/manifests/bird-dev.json', import.meta.url);
    const dev = parseManifest(JSON.parse(readFileSync(devPath, 'utf8')));
    // Two archives, two digests. A manifest that reused the Mini-Dev digest would
    // accept a truncated dev download as long as the size happened to match.
    expect(dev.name).toBe('bird-dev');
    expect(dev.sha256).not.toBe(manifest.sha256);
    expect(dev.bytes).toBe(346_207_293);
    expect(dev.questions).toBe('dev.json');
    expect(dev.root).toBe('dev_20240627');
    // The same eleven databases: dev and Mini-Dev share them, and a dev run costs
    // one download, not a second copy of the data.
    expect(dev.databases).toEqual(manifest.databases);
    // And the databases arrive in a second archive, which is a fact about `dev.zip` and not about
    // the extractor. An artefact of omitting it: the run downloads 346 MB, verifies the digest,
    // unpacks a directory that holds only a zip, and fails on the first question with "No database
    // file" — which is what a dispatch did before this field existed.
    expect(dev.nested).toBe('dev_databases.zip');
    expect(dev.nestedRoot).toBe('dev_databases');
  });

  it('declares the archive layout of every split, because nothing else can', () => {
    // Pinned as data rather than derived from the code: a manifest is the only description of an
    // archive's shape, so a split that gains or loses a nested archive has to be a visible edit here
    // and not a field that quietly stopped being read.
    const layouts = [
      { file: 'bird-minidev.json', nested: undefined, nestedRoot: undefined },
      { file: 'bird-dev.json', nested: 'dev_databases.zip', nestedRoot: 'dev_databases' },
      { file: 'bird-train.json', nested: 'train_databases.zip', nestedRoot: 'train_databases' },
    ];
    for (const layout of layouts) {
      const path = new URL(`../../../../eval/manifests/${layout.file}`, import.meta.url);
      const parsed = parseManifest(JSON.parse(readFileSync(path, 'utf8')));
      expect({ file: layout.file, nested: parsed.nested, root: parsed.nestedRoot }).toEqual({
        file: layout.file,
        nested: layout.nested,
        root: layout.nestedRoot,
      });
    }
  });

  it('names the databases an extraction cannot produce', () => {
    const dev = parseManifest(
      JSON.parse(readFileSync(new URL('../../../../eval/manifests/bird-dev.json', import.meta.url), 'utf8')),
    );
    expect(unreachableDatabases(dev, () => true)).toEqual([]);
    expect(unreachableDatabases(dev, (dbId) => dbId !== 'toxicology')).toEqual(['toxicology']);
  });

  it('lists the databases the archive holds, alphabetically, with no duplicates', () => {
    expect(manifest.databases).toEqual([...manifest.databases].sort());
    expect(new Set(manifest.databases).size).toBe(manifest.databases.length);
    expect(manifest.databases).toContain('financial');
  });
});

describe('the nested archive a split ships', () => {
  const base = {
    name: 'example',
    version: 'v1',
    url: 'https://example.invalid/a.zip',
    bytes: 10,
    sha256: 'a'.repeat(64),
    licence: 'CC-BY-SA-4.0',
    attribution: 'nobody',
    root: 'root',
    questions: 'questions.json',
    databases: ['db'],
    retrievedAt: '2026-11-01',
  };

  it('reads the archive and the directory it extracts to as one declaration', () => {
    const parsed = parseManifest({ ...base, nested: 'x_databases.zip', nestedRoot: 'x_databases' });
    expect(parsed.nested).toBe('x_databases.zip');
    expect(parsed.nestedRoot).toBe('x_databases');
  });

  it('leaves both absent for an archive that does not nest', () => {
    const parsed = parseManifest(base);
    expect(parsed.nested).toBeUndefined();
    expect(parsed.nestedRoot).toBeUndefined();
  });

  it('refuses half a declaration, because half of it extracts where nothing looks', () => {
    // Naming the archive and not the directory unpacks the databases to a path the lane never
    // opens, which is the same outcome as not unpacking them, one step later and harder to see.
    expect(() => parseManifest({ ...base, nested: 'x_databases.zip' })).toThrow(/nestedRoot/);
    expect(() => parseManifest({ ...base, nestedRoot: 'x_databases' })).toThrow();
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
    // The question file is part of the manifest: a lane that hard-coded its name
    // could not measure a second split, and a default would silently read the wrong
    // file for whichever split forgot to declare one.
    expect(reasonOf(() => parseManifest({ ...manifest, questions: undefined }))).toBe('manifest-field');
    expect(reasonOf(() => parseManifest({ ...manifest, questions: '' }))).toBe('manifest-field');
  });

  it('refuses a digest that is not a digest', () => {
    // A short string would compare unequal to everything and look like a mismatch,
    // which is a worse failure than a refusal at read time.
    expect(reasonOf(() => parseManifest({ ...manifest, sha256: 'cc48ba16' }))).toBe('manifest-field');
    expect(reasonOf(() => parseManifest({ ...manifest, sha256: 'C'.repeat(64) }))).toBe('manifest-field');
  });
});

describe('which split a run measures', () => {
  it('reads the three known splits, case and padding included', () => {
    expect(splitFrom(undefined)).toBe('minidev');
    expect(splitFrom('')).toBe('minidev');
    expect(splitFrom('  MINIDEV ')).toBe('minidev');
    expect(splitFrom('dev')).toBe('dev');
    expect(splitFrom('DEV')).toBe('dev');
    expect(splitFrom('train')).toBe('train');
    expect(splitFrom(' Train ')).toBe('train');
  });

  it('refuses a split it does not have, rather than falling back', () => {
    // A typo that silently measured Mini-Dev while the dispatch said `dev` would
    // produce a 350-question number filed as a 1,534-question reproduction.
    expect(() => splitFrom('test')).toThrow(/Unknown split/);
    expect(() => splitFrom('mini')).toThrow(/known splits are minidev, dev, train/);
    // `test` is a real BIRD split, and refusing it is the point: its gold labels are not published,
    // so a run under that name could only ever report a number nobody can check.
    expect(() => splitFrom('test')).toThrow(/known splits are/);
  });

  it('lists every split it accepts, so the message and the parser cannot drift', () => {
    for (const split of SPLITS) expect(splitFrom(split)).toBe(split);
    expect(SPLITS).toEqual(['minidev', 'dev', 'train']);
  });
});

describe('which questions a split scores', () => {
  const rows = [
    { difficulty: 'simple', id: 'a' },
    { difficulty: 'moderate', id: 'b' },
    { difficulty: 'challenging', id: 'c' },
  ];

  it('drops the easiest third on mini-dev, where the question is transfer', () => {
    expect(poolOf(rows, 'minidev').map((row) => row.id)).toEqual(['b', 'c']);
  });

  it('keeps every question on dev, where the question is sample size', () => {
    // 925 of dev's 1,534 questions are marked `simple`. Filtering them leaves 609,
    // and a run on 609 is not a reproduction of a cell measured on 1,534.
    expect(poolOf(rows, 'dev').map((row) => row.id)).toEqual(['a', 'b', 'c']);
  });

  it('keeps everything when every question is easy, rather than measuring nothing', () => {
    const easy = [{ difficulty: 'simple', id: 'a' }];
    expect(poolOf(easy, 'minidev')).toEqual(easy);
  });

  it('matches difficulty case-insensitively', () => {
    const odd = [{ difficulty: 'Simple', id: 'a' }, { difficulty: 'MODERATE', id: 'b' }];
    expect(poolOf(odd, 'minidev').map((row) => row.id)).toEqual(['b']);
  });

  it('keeps every train question, including the ones with no tier at all', () => {
    // `train.json` carries `SQL`, `db_id`, `question` and `evidence` and no `difficulty` on any of
    // its 9,428 rows (measured 2026-11-01). Reading the tier unconditionally throws a TypeError,
    // and the throw lands after an 8.9 GB download and an unpack — a dispatch that dies at startup
    // having already paid for everything. This test is that dispatch, in one line.
    const untiered = [{ id: 'a' }, { id: 'b' }];
    expect(poolOf(untiered, 'train').map((row) => row.id)).toEqual(['a', 'b']);
    expect(poolOf(rows, 'train').map((row) => row.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('the selection a manifest declares', () => {
  const rows = [
    { db_id: 'a', id: 1 },
    { db_id: 'a', id: 2 },
    { db_id: 'b', id: 3 },
    { db_id: 'c', id: 4 },
  ];

  it('keeps the questions whose database the manifest names', () => {
    const scoped = withinDatabases(rows, ['a', 'b']);
    expect(scoped.rows.map((row) => row.id)).toEqual([1, 2, 3]);
    expect(scoped.dropped).toBe(1);
  });

  it('counts what the selection costs, so a smaller n is explained rather than discovered', () => {
    // The number a train run reports is 7,829 where the file holds 9,428, and the difference is a
    // choice about bytes per question — 30 GB of databases for 1,599 questions. A run that showed
    // only the smaller figure would leave a reader to guess whether the data or the design shrank.
    const scoped = withinDatabases(rows, ['c']);
    expect(scoped.dropped).toBe(3);
    expect(scoped.rows).toHaveLength(1);
  });

  it('reports a declared database with no questions, which is a cost to revisit', () => {
    expect(withinDatabases(rows, ['a', 'b', 'ghost']).unused).toEqual(['ghost']);
    expect(withinDatabases(rows, ['a', 'b', 'c']).unused).toEqual([]);
  });

  it('drops everything when the manifest names nothing, rather than keeping everything', () => {
    // The opposite default would make an empty list mean "no selection", and an empty list is what
    // a manifest with a typo in the key produces.
    const scoped = withinDatabases(rows, []);
    expect(scoped.rows).toEqual([]);
    expect(scoped.dropped).toBe(4);
  });
});

describe('isSimple', () => {
  it('answers no for a row that carries no tier, rather than throwing', () => {
    expect(isSimple('simple')).toBe(true);
    expect(isSimple('Simple')).toBe(true);
    expect(isSimple('moderate')).toBe(false);
    expect(isSimple(undefined)).toBe(false);
    expect(isSimple(null)).toBe(false);
    // The field is read from JSON that this repository did not write. A number there is not a
    // difficulty and must not crash a run that only wanted to know whether to drop the question.
    expect(isSimple(3)).toBe(false);
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
