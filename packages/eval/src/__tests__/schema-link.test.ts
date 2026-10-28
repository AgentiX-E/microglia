import { describe, expect, it } from 'vitest';
import { linkSchema, questionTokens, schemaBlocks } from '../schema-link.js';

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
