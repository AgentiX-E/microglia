import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { collectMschema, renderMschema, type MschemaTable } from '../m-schema.js';

const column = (over: Partial<MschemaTable['columns'][number]>): MschemaTable['columns'][number] => ({
  name: 'c',
  type: 'TEXT',
  primaryKey: false,
  notNull: false,
  samples: [],
  description: '',
  ...over,
});

const table = (over: Partial<MschemaTable>): MschemaTable => ({
  name: 't',
  columns: [],
  foreignKeys: [],
  ...over,
});

describe('renderMschema', () => {
  it('names the database before the tables', () => {
    // The M-Schema form opens with the database id because BIRD questions are answered one
    // database at a time and the id carries the domain. XiYan's ablation puts the whole
    // representation at +1.63 EX for this model (53.52 DDL against 55.15 M-Schema), which is the
    // largest free gain available on this benchmark without training anything.
    const text = renderMschema('financial', [table({ name: 'account', columns: [column({ name: 'id' })] })]);
    expect(text.startsWith('【DB_ID】 financial')).toBe(true);
    expect(text).toContain('# Table: account');
  });

  it('writes a column as name, type and its constraints on one line', () => {
    const text = renderMschema('d', [
      table({
        name: 'account',
        columns: [
          column({ name: 'account_id', type: 'INTEGER', primaryKey: true }),
          column({ name: 'district_id', type: 'INTEGER', notNull: true }),
        ],
      }),
    ]);
    expect(text).toContain('(account_id: INTEGER, primary key)');
    expect(text).toContain('(district_id: INTEGER, not null)');
  });

  it('puts the values inside the column, not in a comment above it', () => {
    // This is the difference between iteration 95's treatment and this one. That arm appended
    // value annotations to the DDL and measured +0.29pp; the values were in the prompt and the
    // model still could not use them, because a comment above a column reads as prose about the
    // schema rather than as part of it. Here the value is a property of the column, in the same
    // parenthesis as its type.
    const text = renderMschema('d', [
      table({ name: 't', columns: [column({ name: 'status', samples: ['A', 'B'] })] }),
    ]);
    expect(text).toContain("(status: TEXT, value: 'A' | 'B')");
  });

  it('quotes values so a value cannot be read as a column', () => {
    const text = renderMschema('d', [
      table({ name: 't', columns: [column({ name: 'c', samples: ['POPLATEK MESICNE'] })] }),
    ]);
    expect(text).toContain("value: 'POPLATEK MESICNE'");
  });

  it('escapes a quote inside a value by doubling it', () => {
    // SQL's own convention, so the rendering cannot be mistaken for a broken literal.
    const text = renderMschema('d', [
      table({ name: 't', columns: [column({ name: 'c', samples: ["O'Hare"] })] }),
    ]);
    expect(text).toContain("'O''Hare'");
  });

  it('flattens a value that contains a newline', () => {
    // A newline in a sample would split one column across two lines of the rendering and make the
    // parenthesised form unreadable at exactly the point where it matters.
    const text = renderMschema('d', [
      table({ name: 't', columns: [column({ name: 'c', samples: ['a\nb'] })] }),
    ]);
    expect(text).toContain("'a b'");
    expect(text.split('\n').filter((line) => line.includes("'a b'")).length).toBe(1);
  });

  it('writes TEXT for a column whose type the database left empty', () => {
    // SQLite allows a column with no declared type. Printing the empty string would render
    // `(c: , ...)`, which reads as a parsing artefact rather than as an untyped column.
    const text = renderMschema('d', [
      table({ name: 't', columns: [column({ name: 'c', type: '' })] }),
    ]);
    expect(text).toContain('(c: TEXT)');
  });

  it('turns a double quote inside a description into a single one', () => {
    // The description is rendered inside double quotes, so an unescaped one would close the
    // string early and turn the rest of the column into syntax.
    const text = renderMschema('d', [
      table({ name: 't', columns: [column({ name: 'c', description: 'the "audited" revenue' })] }),
    ]);
    expect(text).toContain('"the \'audited\' revenue"');
  });

  it('keeps the description beside the type', () => {
    const text = renderMschema('d', [
      table({ name: 't', columns: [column({ name: 'c', description: 'the account holder' })] }),
    ]);
    expect(text).toContain('"the account holder"');
  });

  it('drops an empty description rather than writing empty quotes', () => {
    const text = renderMschema('d', [table({ name: 't', columns: [column({ name: 'c' })] })]);
    expect(text).not.toContain('""');
  });

  it('drops an empty sample list rather than writing an empty value clause', () => {
    const text = renderMschema('d', [table({ name: 't', columns: [column({ name: 'c' })] })]);
    expect(text).not.toContain('value:');
  });

  it('omits the foreign key section when there is no foreign key', () => {
    // A section header with nothing under it reads as "this schema has no relations", which is a
    // different claim from "this schema's relations are not listed here".
    const text = renderMschema('d', [table({ name: 't', columns: [column({})] })]);
    expect(text).not.toContain('Foreign Keys');
  });

  it('writes foreign keys as a join equation, one per line', () => {
    const text = renderMschema('d', [
      table({
        name: 'account',
        columns: [column({ name: 'district_id' })],
        foreignKeys: [{ from: 'district_id', toTable: 'district', toColumn: 'district_id' }],
      }),
      table({ name: 'district', columns: [column({ name: 'district_id' })] }),
    ]);
    expect(text).toContain('【Foreign Keys】');
    expect(text).toContain('account.district_id = district.district_id');
  });

  it('lists the tables in the order they were given', () => {
    const text = renderMschema('d', [
      table({ name: 'b', columns: [column({})] }),
      table({ name: 'a', columns: [column({})] }),
    ]);
    expect(text.indexOf('# Table: b')).toBeLessThan(text.indexOf('# Table: a'));
  });

  it('renders a table with no columns without an empty bracket', () => {
    const text = renderMschema('d', [table({ name: 't' })]);
    expect(text).toContain('# Table: t');
    expect(text).not.toContain('[\n]');
  });

  it('renders a database with no tables as just the id', () => {
    const text = renderMschema('d', []);
    expect(text).toBe('【DB_ID】 d');
  });

  it('stops adding samples once the budget is spent', () => {
    // The rendering competes with the question for one context window. A database with 600 columns
    // and three samples each is 1,800 literals, which is more prompt than schema; the budget keeps
    // the form usable on the databases where it matters most.
    const wide = Array.from({ length: 40 }, (_, index) =>
      column({ name: `c${index}`, samples: ['aaaaaaaaaa', 'bbbbbbbbbb', 'cccccccccc'] }),
    );
    const text = renderMschema('d', [table({ name: 't', columns: wide })], { budget: 300 });
    expect(text.length).toBeLessThan(1_000);
    expect(text).toContain('…');
  });

  it('keeps every column when the budget is not reached', () => {
    const columns = Array.from({ length: 5 }, (_, index) => column({ name: `c${index}` }));
    const text = renderMschema('d', [table({ name: 't', columns })] , { budget: 5_000 });
    for (let index = 0; index < 5; index += 1) expect(text).toContain(`(c${index}:`);
    expect(text).not.toContain('…');
  });

  it('keeps the foreign key section even when samples were cut', () => {
    // The relations are the part that a truncated sample cannot replace: a join is either stated
    // or guessed, and guessing is what the wrong-answer analysis in iteration 96 found.
    const wide = Array.from({ length: 40 }, (_, index) =>
      column({ name: `c${index}`, samples: ['aaaaaaaaaa', 'bbbbbbbbbb', 'cccccccccc'] }),
    );
    const text = renderMschema(
      'd',
      [
        table({
          name: 't',
          columns: wide,
          foreignKeys: [{ from: 'c0', toTable: 'u', toColumn: 'id' }],
        }),
        table({ name: 'u', columns: [column({ name: 'id' })] }),
      ],
      { budget: 300 },
    );
    expect(text).toContain('t.c0 = u.id');
  });
});

describe('collectMschema', () => {
  it('reads types, keys and relations out of a database', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(
      'create table district (district_id integer primary key, name text not null);' +
        'create table account (account_id integer primary key, district_id integer not null, ' +
        '  foreign key (district_id) references district(district_id));',
    );
    const tables = collectMschema(db, { samples: 2 });
    const district = tables.find((entry) => entry.name === 'district');
    expect(district?.columns.map((column) => column.name)).toEqual(['district_id', 'name']);
    expect(district?.columns[0]?.primaryKey).toBe(true);
    expect(district?.columns[1]?.notNull).toBe(true);
    const account = tables.find((entry) => entry.name === 'account');
    expect(account?.foreignKeys).toEqual([
      { from: 'district_id', toTable: 'district', toColumn: 'district_id' },
    ]);
  });

  it('skips the sqlite internal tables', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('create table t (id integer primary key);');
    expect(collectMschema(db, { samples: 1 }).map((entry) => entry.name)).toEqual(['t']);
  });

  it('samples distinct non-null values', () => {
    const db = new DatabaseSync(':memory:');
    db.exec("create table t (s text); insert into t values ('a'), ('a'), ('b'), (null);");
    const [only] = collectMschema(db, { samples: 3 });
    expect(only?.columns[0]?.samples).toEqual(['a', 'b']);
  });

  it('takes no samples when the sample count is zero', () => {
    // R4's finding in one option: the values are not free, and an arm that wants the form without
    // them must be able to ask for that.
    const db = new DatabaseSync(':memory:');
    db.exec("create table t (s text); insert into t values ('a');");
    const [only] = collectMschema(db, { samples: 0 });
    expect(only?.columns[0]?.samples).toEqual([]);
  });

  it('reads the column descriptions the corpus ships alongside the database', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('create table t (s text);');
    const [only] = collectMschema(db, { samples: 0, descriptions: { 't.s': 'the holder' } });
    expect(only?.columns[0]?.description).toBe('the holder');
  });

  it('treats a table with no description as having none, not as an error', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('create table t (s text);');
    const [only] = collectMschema(db, { samples: 0, descriptions: { 'other.c': 'x' } });
    expect(only?.columns[0]?.description).toBe('');
  });
});
