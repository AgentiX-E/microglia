import { describe, expect, it } from 'vitest';
import { annotateSchema, linkSchema, questionTokens, schemaBlocks } from '@agentix-e/microglia-sql';

/** BIRD's SQLite dumps: one CREATE per table, every name quoted, from `sqlite_master.sql`. */
const RACES = `CREATE TABLE "races" ("raceId" INTEGER PRIMARY KEY, "year" INTEGER, "circuitId" INTEGER, "name" TEXT)`;
const RESULTS = `CREATE TABLE "results" ("resultId" INTEGER PRIMARY KEY, "raceId" INTEGER, "driverId" INTEGER, "positionOrder" INTEGER)`;
const DRIVERS = `CREATE TABLE "drivers" ("driverId" INTEGER PRIMARY KEY, "forename" TEXT, "surname" TEXT)`;
const CIRCUITS = `CREATE TABLE "circuits" ("circuitId" INTEGER PRIMARY KEY, "name" TEXT, "country" TEXT)`;
const LAP_TIMES = `CREATE TABLE "lapTimes" ("raceId" INTEGER, "driverId" INTEGER, "lap" INTEGER, "milliseconds" INTEGER)`;
const PIT_STOPS = `CREATE TABLE "pitStops" ("raceId" INTEGER, "driverId" INTEGER, "duration" TEXT)`;
const FORMULA_1 = [RACES, RESULTS, DRIVERS, CIRCUITS, LAP_TIMES, PIT_STOPS].join('\n');

describe('schemaBlocks', () => {
  it('splits one statement per table, names and columns in order', () => {
    const blocks = schemaBlocks(FORMULA_1);
    expect(blocks).toHaveLength(6);
    expect(blocks[0]?.table).toBe('races');
    expect(blocks[0]?.columns).toEqual(['raceId', 'year', 'circuitId', 'name']);
    expect(blocks[5]?.table).toBe('pitStops');
  });

  it('reads an unquoted statement too', () => {
    // Not every dump quotes. Falling back to `name TYPE` pairs is what keeps a second-format
    // database from pruning to nothing — an empty pruner is a wrong answer, not a safe one.
    const blocks = schemaBlocks('CREATE TABLE atoms (atom_id INTEGER, element TEXT, mass REAL)');
    expect(blocks[0]?.table).toBe('atoms');
    expect(blocks[0]?.columns).toEqual(['atom_id', 'element', 'mass']);
  });

  it('ignores a constraint clause rather than reading it as a column', () => {
    const blocks = schemaBlocks(
      'CREATE TABLE t (a INTEGER, b INTEGER, PRIMARY KEY (a), FOREIGN KEY (b) REFERENCES u (id))',
    );
    expect(blocks[0]?.columns).toEqual(['a', 'b']);
  });

  it('returns nothing for a schema that declares no table', () => {
    expect(schemaBlocks('')).toEqual([]);
  });
});

describe('questionTokens', () => {
  it('offers the plural and the singular, because the question and the schema disagree', () => {
    const tokens = questionTokens('How many races did the drivers win?');
    expect(tokens.has('races')).toBe(true);
    expect(tokens.has('race')).toBe(true);
    expect(tokens.has('drivers')).toBe(true);
    expect(tokens.has('driver')).toBe(true);
  });

  it('leaves a short word alone rather than stripping its last letter', () => {
    // `gas` must not become `ga`: a stemmer that invents tokens invents anchors.
    const tokens = questionTokens('the gas laws');
    expect(tokens.has('gas')).toBe(true);
    expect(tokens.has('ga')).toBe(false);
  });

  it('handles the -es form', () => {
    expect(questionTokens('which boxes').has('box')).toBe(true);
  });
});

describe('linkSchema', () => {
  it('keeps only what the question names, and says so', () => {
    const linked = linkSchema(FORMULA_1, 'How many drivers are there?', '');
    expect(linked.reason).toBe('linked');
    // `drivers` is named; nothing shares a key-like column with it in this fixture except
    // `results`, `lapTimes` and `pitStops`, which is what the closure is for.
    expect(linked.kept).toContain('drivers');
    expect(linked.kept).not.toContain('circuits');
    expect(linked.total).toBe(6);
    expect(linked.ddl).not.toContain('circuits');
    expect(linked.ddl).toContain('drivers');
  });

  it('keeps the tables a named table joins to through a key column', () => {
    // A pruned schema that cannot express the join is worse than no pruning: the model writes a
    // query over what it can see instead of asking for the rest.
    const linked = linkSchema(FORMULA_1, 'What is the name of the circuit?', '');
    // `circuit` is a column of `races`, so `races` is kept and `circuits` arrives through the
    // closure on `circuitId`.
    expect(linked.kept).toContain('circuits');
    expect(linked.kept).toContain('races');
  });

  it('returns the whole schema when nothing is named', () => {
    const linked = linkSchema(FORMULA_1, 'What is the answer?', '');
    expect(linked.reason).toBe('nothing-matched');
    expect(linked.ddl).toBe(FORMULA_1);
    expect(linked.dropped).toBe(0);
  });

  it('returns the whole schema when everything is named', () => {
    const linked = linkSchema(
      FORMULA_1,
      'Join races, results, drivers, circuits, lapTimes and pitStops',
      '',
    );
    expect(linked.reason).toBe('all-matched');
    expect(linked.ddl).toBe(FORMULA_1);
  });

  it('declines to prune when the closure covers most of the database', () => {
    // Six tables, five of them reached: dropping one saves little and risks a join. The guard
    // exists so that the arm measures pruning, not the absence of it.
    const linked = linkSchema(FORMULA_1, 'races results drivers circuits lapTimes', '');
    expect(['all-matched', 'linked']).toContain(linked.reason);
    if (linked.reason === 'linked') expect(linked.kept.length / linked.total).toBeLessThanOrEqual(0.6);
  });

  it('passes a one-table database through untouched', () => {
    const single = 'CREATE TABLE "atoms" ("atom_id" INTEGER, "element" TEXT)';
    const linked = linkSchema(single, 'how many atoms', '');
    expect(linked.reason).toBe('single-table');
    expect(linked.ddl).toBe(single);
  });

  it('uses the evidence as well as the question', () => {
    // BIRD supplies external knowledge that names the table the question only implies.
    const linked = linkSchema(FORMULA_1, 'How long was the stop?', 'pitStops records each stop');
    expect(linked.kept).toContain('pitStops');
  });

  it('never returns a schema that lost everything', () => {
    for (const question of ['', 'zzz', 'What?', '12345']) {
      const linked = linkSchema(FORMULA_1, question, '');
      expect(linked.ddl.trim()).not.toBe('');
      expect(linked.kept.length).toBeGreaterThan(0);
    }
  });
});

describe('the shapes a dump can take', () => {
  it('reads a statement that declares no columns at all', () => {
    expect(schemaBlocks('CREATE TABLE atoms')).toEqual([
      { table: 'atoms', sql: 'CREATE TABLE atoms', columns: [] },
    ]);
  });

  it('skips an empty clause rather than reading it as a column', () => {
    // Trailing commas and double commas survive dumps, and an empty clause's first token is
    // `undefined` — which must not become a column called "undefined".
    const blocks = schemaBlocks('CREATE TABLE t (a INTEGER, , b TEXT)');
    expect(blocks[0]?.columns).toEqual(['a', 'b']);
  });

  it('drops a statement whose table name cannot be read at all', () => {
    expect(schemaBlocks('CREATE TABLE (a INTEGER)')).toEqual([]);
  });

  it('leaves a database alone when the kept table has no key column', () => {
    // Nothing to join on means nothing to add: `letters` is named, `numbers` is not, and the
    // closure has no key to follow.
    const ddl = [
      'CREATE TABLE "letters" ("grapheme" TEXT, "codepoint" INTEGER)',
      'CREATE TABLE "numbers" ("value" INTEGER, "word" TEXT)',
      'CREATE TABLE "colours" ("hue" TEXT, "lightness" REAL)',
    ].join('\n');
    const linked = linkSchema(ddl, 'how many letters in the alphabet', '');
    expect(linked.reason).toBe('linked');
    expect(linked.kept).toEqual(['letters']);
    expect(linked.dropped).toBe(2);
  });
});

/**
 * The pruned names, which exist so that a later reading can ask a question this one cannot.
 *
 * `dropped` says whether the pruner fired. The registration asks *did the pack name a table or
 * column the pruning removed*, and that is a question about which names left the prompt — three
 * counts cannot answer it, and a run that stores only counts cannot be re-read to answer it later.
 */
describe('pruned names', () => {
  it('records the tables and columns the pruner removed', () => {
    const linked = linkSchema(FORMULA_1, 'How many drivers are there?', '');
    expect(linked.reason).toBe('linked');
    expect(linked.prunedTables.length).toBe(linked.dropped);
    expect(linked.prunedTables).not.toContain(linked.kept[0]);
    expect(linked.prunedColumns.length).toBeGreaterThan(0);
    // Every pruned column belongs to a pruned table, and the DDL no longer declares either.
    for (const table of linked.prunedTables) expect(linked.ddl).not.toContain(`"${table}"`);
  });

  it('reports no pruned names when it declined to prune', () => {
    for (const [ddl, question, evidence] of [
      [FORMULA_1, 'What is the answer?', ''],
      [FORMULA_1, 'Join races, results, drivers, circuits, lapTimes and pitStops', ''],
      [FORMULA_1, 'races results drivers circuits lapTimes', ''],
    ] as const) {
      const linked = linkSchema(ddl, question, evidence);
      expect(linked.reason).not.toBe('linked');
      expect(linked.prunedTables).toEqual([]);
      expect(linked.prunedColumns).toEqual([]);
    }
  });

  it('reports no pruned names for a single-table database', () => {
    const single = 'CREATE TABLE "atoms" ("atom_id" INTEGER, "element" TEXT);';
    expect(linkSchema(single, 'how many atoms', '').prunedTables).toEqual([]);
  });
});

describe('annotateSchema', () => {
  it('keeps every table, because that is the whole reason it exists', () => {
    // The reductive form measured -9.58pp at p=6.4e-21 and its error taxonomy says why: 291 errors
    // where a gold table was absent, against 107 before. This form cannot produce that error.
    const annotated = annotateSchema(FORMULA_1, 'How many drivers are there?', '');
    expect(annotated.total).toBe(6);
    expect((annotated.ddl.match(/CREATE TABLE/g) ?? [])).toHaveLength(6);
    for (const block of schemaBlocks(FORMULA_1)) {
      expect(annotated.ddl).toContain(block.sql);
    }
  });

  it('puts the named tables first and says how many there are', () => {
    const annotated = annotateSchema(FORMULA_1, 'How many drivers are there?', '');
    expect(annotated.reason).toBe('annotated');
    expect(annotated.anchors).toEqual(['drivers']);
    expect(annotated.ddl.startsWith('-- 1 of 6 tables are named')).toBe(true);
    // `drivers` was declared third and now comes first; the rest keep their declaration order.
    expect(annotated.ddl.indexOf(DRIVERS)).toBeLessThan(annotated.ddl.indexOf(RACES));
    expect(annotated.ddl.indexOf(RACES)).toBeLessThan(annotated.ddl.indexOf(RESULTS));
  });

  it('takes its anchors from the evidence as well as the question', () => {
    const annotated = annotateSchema(FORMULA_1, 'How many are there?', 'count the rows in circuits');
    expect(annotated.anchors).toEqual(['circuits']);
  });

  it('leaves the schema alone when nothing is named, and says so', () => {
    // An empty header and an absent header have to be different states: one is a linker that found
    // no anchor, the other is a linker that found one and was wrong.
    const annotated = annotateSchema(FORMULA_1, 'What is the answer?', '');
    expect(annotated.reason).toBe('no-anchor');
    expect(annotated.ddl).toBe(FORMULA_1);
    expect(annotated.anchors).toEqual([]);
  });

  it('does not add a header to a single-table database', () => {
    const single = 'CREATE TABLE "atoms" ("atom_id" INTEGER, "element" TEXT);';
    const annotated = annotateSchema(single, 'how many atoms', '');
    expect(annotated.reason).toBe('single-table');
    expect(annotated.ddl).toBe(single);
  });

  it('keeps a table whose columns are the only thing named', () => {
    // A question that names a column and not its table is the case a lexical pruner gets wrong and
    // an additive one cannot: `duration` appears in no question, `miliseconds` in this one.
    const annotated = annotateSchema(FORMULA_1, 'longest milliseconds total', '');
    expect(annotated.anchors).toEqual(['lapTimes']);
    expect((annotated.ddl.match(/CREATE TABLE/g) ?? [])).toHaveLength(6);
  });
});
