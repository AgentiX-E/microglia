import { describe, expect, it } from 'vitest';
import { renderValue, schemaWithValues, type ValueSample } from '../value-samples.js';

const none = (): readonly ValueSample[] => [];

describe('renderValue', () => {
  it('quotes text and leaves numbers bare', () => {
    // The distinction is load-bearing: a TEXT column holding '2020' does not equal 2020, and an
    // annotation that prints both the same way teaches nothing.
    expect(renderValue('Male')).toBe("'Male'");
    expect(renderValue(2020)).toBe('2020');
    expect(renderValue(1.5)).toBe('1.5');
    expect(renderValue(10n)).toBe('10');
  });

  it('escapes a quote rather than truncating there', () => {
    expect(renderValue("O'Brien")).toBe("'O''Brien'");
  });

  it('collapses whitespace so a value stays on one line', () => {
    expect(renderValue('two\nlines')).toBe("'two lines'");
  });

  it('cuts a long value and says it did', () => {
    const rendered = renderValue('x'.repeat(40));
    expect(rendered).toBe(`'${'x'.repeat(24)}…'`);
  });

  it('names null instead of printing nothing', () => {
    // An empty slot between two commas reads as an empty string; NULL and '' take different paths
    // through `is null` and `= ''`, and the whole point of the annotation is that distinction.
    expect(renderValue(null)).toBe('NULL');
    expect(renderValue(undefined)).toBe('NULL');
  });
});

describe('schemaWithValues', () => {
  const ddl = 'CREATE TABLE singer (Singer_ID INTEGER, Name TEXT)\nCREATE TABLE album (Album_ID INTEGER)';

  it('annotates each table with its own columns', () => {
    const values = (table: string): readonly ValueSample[] =>
      table === 'singer'
        ? [
            { column: 'Singer_ID', values: ['1', '2'] },
            { column: 'Name', values: ["'Joe'"] },
          ]
        : [];
    const out = schemaWithValues(ddl, values);
    expect(out).toContain('-- values: Singer_ID: 1, 2; Name: \'Joe\'');
    expect(out).toContain('CREATE TABLE album (Album_ID INTEGER)');
  });

  it('leaves a table it could not sample byte-identical', () => {
    // A table with no annotation must not gain a stray comment line: the arm's delta would then be
    // measuring a whitespace change on the tables it did not touch.
    const out = schemaWithValues(ddl, none);
    expect(out).toBe(ddl);
  });

  it('keeps the DDL itself copyable, appending the annotation after it', () => {
    const out = schemaWithValues('CREATE TABLE t (a INTEGER)', () => [
      { column: 'a', values: ['7'] },
    ]);
    expect(out.startsWith('CREATE TABLE t (a INTEGER)')).toBe(true);
    expect(out.split('\n')[1]).toBe('-- values: a: 7');
  });

  it('reads a quoted table name', () => {
    const out = schemaWithValues('CREATE TABLE "my table" (a INTEGER)', (name) => [
      { column: 'a', values: name === 'my table' ? ['1'] : [] },
    ]);
    expect(out).toContain('-- values: a: 1');
  });

  it('reads CREATE TABLE IF NOT EXISTS', () => {
    const out = schemaWithValues('CREATE TABLE IF NOT EXISTS t (a INTEGER)', () => [
      { column: 'a', values: ['1'] },
    ]);
    expect(out).toContain('-- values: a: 1');
  });

  it('returns the input when there is no schema to annotate', () => {
    expect(schemaWithValues('', none)).toBe('');
    expect(schemaWithValues('SELECT 1', none)).toBe('SELECT 1');
  });

  it('stops at sixteen columns so a wide table does not crowd out its own schema', () => {
    const wide = Array.from({ length: 20 }, (_, index) => ({
      column: `c${index}`,
      values: [`${index}`],
    }));
    const out = schemaWithValues('CREATE TABLE t (a INTEGER)', () => wide);
    expect(out).toContain('c15: 15');
    expect(out).not.toContain('c16');
  });

  it('does not annotate a column with no sample', () => {
    const out = schemaWithValues(ddl, (table) =>
      table === 'singer' ? [{ column: 'Name', values: [] }] : [],
    );
    expect(out).toBe(ddl);
  });
});
