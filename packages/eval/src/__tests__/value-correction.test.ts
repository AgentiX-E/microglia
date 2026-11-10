import { describe, expect, it } from 'vitest';
import {
  VALUE_BLOCK_BUDGET,
  VALUE_FLOOR,
  editDistance,
  nearestValues,
  sqlLiterals,
  summariseValues,
  valueCorrections,
  valueGate,
  type ColumnValues,
  type ValueRow,
} from '../value-correction.js';

function row(reason: 'no-query' | 'error' | 'empty', lines: number, chars = 0, dropped = 0): ValueRow {
  return { reason, lines, chars, dropped };
}

function column(table: string, name: string, values: readonly string[]): ColumnValues {
  return { table, column: name, values };
}

describe('sqlLiterals', () => {
  it('reads the literals a statement used, strings before numbers', () => {
    expect(sqlLiterals("select * from schools where County = 'Alameda' and Rank < 55")).toEqual([
      'Alameda',
      '55',
    ]);
  });

  it('unescapes a doubled quote rather than ending the literal early', () => {
    expect(sqlLiterals("select * from t where name = 'O''Brien'")).toEqual(["O'Brien"]);
  });

  it('ignores a commented-out condition, which the query did not do', () => {
    expect(sqlLiterals("select 12 from t -- where c = 'Alameda'\n")).toEqual(['12']);
  });

  it('does not read a date inside a string as three numbers', () => {
    expect(sqlLiterals("select 12 from t where Born = '1970-01-01'")).toEqual([
      '1970-01-01',
      '12',
    ]);
  });

  it('drops paging, because a page size is a property of the query not a value in the column', () => {
    expect(sqlLiterals("select * from t where c = 'x' limit 10 offset 20")).toEqual(['x']);
  });

  it('drops a single digit, which is a threshold far more often than a typo', () => {
    expect(sqlLiterals('select * from t where Rank > 3')).toEqual([]);
  });

  it('reports each literal once, however often it appears', () => {
    expect(sqlLiterals("select 'a' from t where c = 'a' or d = 'a'")).toEqual(['a']);
  });

  it('finds nothing in a statement with no literals', () => {
    expect(sqlLiterals('select count(*) from schools')).toEqual([]);
  });
});

describe('editDistance', () => {
  it('is zero for the same spelling under different case', () => {
    expect(editDistance('Male', 'male')).toBe(0);
  });

  it('counts the letters that have to change', () => {
    expect(editDistance('Alameda County', 'Alameda')).toBe(7);
  });

  it('handles an empty side as the other one\u2019s length', () => {
    expect(editDistance('', 'abc')).toBe(3);
    expect(editDistance('abc', '')).toBe(3);
  });
});

describe('nearestValues', () => {
  it('orders by distance and stops at the requested width', () => {
    expect(nearestValues('Alameda County', ['Alameda', 'Contra Costa', 'Alameda County '], 2)).toEqual([
      'Alameda County ',
      'Alameda',
    ]);
  });

  it('breaks a distance tie on length, so the shorter spelling leads', () => {
    expect(nearestValues('ca', ['cb', 'c'], 2)).toEqual(['c', 'cb']);
  });
});

describe('valueCorrections', () => {
  it('names the spelling the column holds when the literal is a near miss', () => {
    const correction = valueCorrections({
      sql: "select * from schools where County = 'Alameda County'",
      columns: [column('schools', 'County', ['Alameda', 'Contra Costa', 'Santa Clara'])],
    });

    expect(correction.lines).toBe(1);
    expect(correction.text).toContain("you wrote 'Alameda County'");
    expect(correction.text).toContain("the column schools.County holds 'Alameda'");
    expect(correction.literals).toBe(1);
    expect(correction.dropped).toBe(0);
  });

  it('says nothing when the literal is the spelling the column holds', () => {
    const correction = valueCorrections({
      sql: "select * from schools where County = 'Alameda'",
      columns: [column('schools', 'County', ['Alameda', 'Contra Costa'])],
    });

    expect(correction.text).toBe('');
    expect(correction.lines).toBe(0);
  });

  it('reports a case-only miss, because SQLite returns no rows for one', () => {
    const correction = valueCorrections({
      sql: "select * from singer where Gender = 'male'",
      columns: [column('singer', 'Gender', ['Male', 'Female'])],
    });

    expect(correction.text).toContain("the column singer.Gender holds 'Male'");
  });

  it('picks the column whose closest value is closest', () => {
    const correction = valueCorrections({
      sql: "select * from schools where County = 'Alameda County'",
      columns: [
        column('schools', 'Mascot', ['Pandas', 'Eagles']),
        column('schools', 'County', ['Alameda', 'Contra Costa']),
      ],
    });

    expect(correction.text).toContain('schools.County');
    expect(correction.text).not.toContain('schools.Mascot');
  });

  it('carries the next two spellings in the same line, so three values cost one line', () => {
    const correction = valueCorrections({
      sql: "select * from t where c = 'alphaa'",
      columns: [column('t', 'c', ['alpha', 'alphab', 'alphac', 'zulu'])],
    });

    expect(correction.lines).toBe(1);
    expect(correction.text).toContain("(also 'alphab', 'alphac')");
  });

  it('does not compare a string literal against a numeric column', () => {
    const correction = valueCorrections({
      sql: "select * from t where c = 'singapore'",
      columns: [column('t', 'n', ['1', '2', '3'])],
    });

    expect(correction.text).toBe('');
  });

  it('does not compare a numeric literal against a text column', () => {
    const correction = valueCorrections({
      sql: 'select * from t where c = 2019',
      columns: [column('t', 'c', ['alpha', 'beta'])],
    });

    expect(correction.text).toBe('');
  });

  it('compares a numeric literal against a numeric column, which is where a year can be wrong', () => {
    const correction = valueCorrections({
      sql: 'select * from t where born = 2019',
      columns: [column('t', 'born', ['2018', '2017'])],
    });

    expect(correction.text).toContain("you wrote '2019'");
    expect(correction.text).toContain("the column t.born holds '2018'");
  });

  it('drops the whole line rather than truncating it when the budget is reached', () => {
    const correction = valueCorrections(
      {
        sql: "select * from t where a = 'aaaa0' and b = 'bbbb0' and c = 'cccc0'",
        columns: [column('t', 'a', ['aaaa1']), column('t', 'b', ['bbbb1']), column('t', 'c', ['cccc1'])],
      },
      { budget: 50 },
    );

    // Every literal is offered a line and every line is either whole or absent: the count of the
    // two has to be the number of literals, and the text has to fit the budget that was named.
    expect(correction.lines + correction.dropped).toBe(3);
    expect(correction.lines).toBe(1);
    expect(correction.text.length).toBeLessThanOrEqual(50);
    expect(correction.text.endsWith("'")).toBe(true);
  });

  it('stops after eight literals, because a ninth line is not an explanation', () => {
    const literals = ['a1', 'b1', 'c1', 'd1', 'e1', 'f1', 'g1', 'h1', 'i1'];
    const sql = `select * from t where ${literals.map((text) => `x = '${text}'`).join(' and ')}`;
    const correction = valueCorrections({
      sql,
      columns: [column('t', 'x', literals.map((text) => `${text}x`))],
    });

    expect(correction.lines).toBe(8);
    expect(correction.dropped).toBe(1);
  });

  it('treats a zero-width nearest as no comparison rather than as a match', () => {
    const correction = valueCorrections(
      { sql: "select * from t where c = 'alphaa'", columns: [column('t', 'c', ['alpha'])] },
      { nearest: 0 },
    );

    expect(correction.lines).toBe(0);
    expect(correction.text).toBe('');
  });

  it('is bounded by the registered budget', () => {
    const correction = valueCorrections({
      sql: "select * from t where a = 'x1' and b = 'y1' and c = 'z1' and d = 'w1'",
      columns: [
        column('t', 'a', ['x2']),
        column('t', 'b', ['y2']),
        column('t', 'c', ['z2']),
        column('t', 'd', ['w2']),
      ],
    });

    expect(correction.text.length).toBeLessThanOrEqual(VALUE_BLOCK_BUDGET);
  });

  it('says nothing when no column was offered, and counts what it could not check', () => {
    const correction = valueCorrections({ sql: "select * from t where c = 'x'", columns: [] });

    expect(correction.text).toBe('');
    expect(correction.literals).toBe(1);
    expect(correction.dropped).toBe(0);
  });

  it('says one line for a literal that appears twice, because it is one literal', () => {
    const correction = valueCorrections({
      sql: "select * from t where a = 'alp' and b = 'alp'",
      columns: [column('t', 'a', ['alpha'])],
    });

    expect(correction.lines).toBe(1);
    expect(correction.literals).toBe(1);
  });
});

describe('summariseValues', () => {
  it('counts the empty retries as the population and the fired ones as the treatment', () => {
    const summary = summariseValues([row('empty', 2, 100), row('empty', 0), row('error', 1, 50)]);

    expect(summary.asked).toBe(2);
    expect(summary.fired).toBe(1);
    expect(summary.firedShare).toBe(0.5);
    expect(summary.meanChars).toBe(100);
    expect(summary.lines).toBe(3);
  });

  it('reports the error retries beside the population rather than inside it', () => {
    const summary = summariseValues([row('error', 1, 60), row('error', 0), row('no-query', 0)]);

    expect(summary.asked).toBe(0);
    expect(summary.errors).toBe(2);
    expect(summary.firedOnErrors).toBe(1);
  });

  it('reports a share of zero rather than a not-a-number when nothing was asked', () => {
    const summary = summariseValues([]);

    expect(summary.firedShare).toBe(0);
    expect(summary.meanChars).toBe(0);
    expect(Number.isNaN(summary.firedShare)).toBe(false);
  });

  it('adds the dropped lines, which is how a block that never fits is visible', () => {
    expect(summariseValues([row('empty', 1, 40, 3)]).droppedLines).toBe(3);
  });
});

describe('valueGate', () => {
  it('passes at the floor and fails under it', () => {
    const pass = valueGate(summariseValues([row('empty', 1, 40), row('empty', 0), row('empty', 0)]));
    const fail = valueGate(
      summariseValues([row('empty', 1, 40), row('empty', 0), row('empty', 0), row('empty', 0)]),
    );

    expect(pass.pass).toBe(true);
    expect(fail.pass).toBe(false);
    expect(pass.id).toBe('V76-values-delivered');
  });

  it('fails when the arm retried nothing, because that is a wiring defect and not a vacuous pass', () => {
    expect(valueGate(summariseValues([])).pass).toBe(false);
  });

  it('names the numbers it decided on, so the artefact can be read without the code', () => {
    const actual = valueGate(summariseValues([row('empty', 2, 80), row('error', 1, 40)])).actual;

    expect(actual).toContain('asked=1');
    expect(actual).toContain('fired=1');
    expect(actual).toContain('errors=1/1');
  });
});
