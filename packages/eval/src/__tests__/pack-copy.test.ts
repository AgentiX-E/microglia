import { describe, expect, it } from 'vitest';
import {
  COMPOSITION_HEADER,
  COPY_HEADER,
  COPY_RULE,
  COPY_SOURCES,
  CONSTRUCTS,
  DENIAL_RULES,
  circulationStratumOf,
  compositionLine,
  constructsOf,
  copyCensusOf,
  copyLines,
  denialsOf,
  denialReadingOf,
  boilerplateShareOf,
  packCopyCensus,
  packCopyRowsOf,
  spreadOf,
  type PackCopyRow,
} from '../pack-copy.js';

/** One case with a pack and the query that answers it. */
function row(input: {
  readonly cluster?: string;
  readonly correct?: boolean;
  readonly without?: boolean;
  readonly statements?: readonly string[];
  readonly gold?: string;
}): PackCopyRow {
  return {
    cluster: input.cluster ?? 'db1',
    correct: input.correct ?? true,
    withoutMemoryCorrect: input.without ?? true,
    statements: input.statements ?? [],
    goldSql: input.gold ?? 'SELECT 1',
  };
}

/** A `per_case` artefact with the fields the reader needs, so a refusal can be provoked one field at a time. */
function artefact(cases: readonly Record<string, unknown>[]): unknown {
  return { per_case: cases };
}

const CASE = {
  dbId: 'db1',
  correct: true,
  withoutMemoryCorrect: false,
  goldSql: 'SELECT x FROM t',
  injected: ['A rule.'],
};

describe('the denial rules', () => {
  it('names one rule for every construct the census can read, and no rule for anything else', () => {
    // A construct added to `CONSTRUCTS` without a rule is a construct nothing can detect; a rule for a
    // construct that is not in `CONSTRUCTS` would report a hit the gold reader can never corroborate.
    expect(new Set(DENIAL_RULES.map((rule) => rule.construct))).toEqual(new Set(CONSTRUCTS));
    expect(DENIAL_RULES.length).toBe(CONSTRUCTS.length);
    expect(new Set(DENIAL_RULES.map((rule) => rule.form)).size).toBe(DENIAL_RULES.length);
    for (const rule of DENIAL_RULES) expect(rule.pattern.global).toBe(true);
  });

  it('reads a denial when the cue and the construct are in one phrase', () => {
    expect(denialsOf('The query filters by country without DISTINCT.')).toEqual([
      { construct: 'distinct', form: 'not/without DISTINCT', text: 'without distinct', conditional: false, warning: false },
    ]);
  });

  it('does not read a denial when the construct is the object of a different word', () => {
    // The failure the narrow patterns exist for: a window-based reader bound these to `join`.
    expect(denialsOf('There is no join problem here, and the joined result is fine.')).toEqual([]);
    expect(denialsOf('A join between two tables produces duplicate rows.')).toEqual([]);
  });

  it('reads the remaining families', () => {
    const constructs = (statement: string): string[] => denialsOf(statement).map((denial) => denial.construct);
    expect(constructs('The ratio must not be wrapped in a CAST to REAL.')).toEqual(['cast']);
    expect(constructs('Aggregate expressions are left unaliased.')).toEqual(['select-alias']);
    expect(constructs('Counting rows uses COUNT on the identifier rather than COUNT(*).')).toEqual(['count-star']);
    expect(constructs('The result is not ordered by the measure.')).toEqual(['order-by']);
    expect(constructs('Matching a prefix does not use LIKE.')).toEqual(['like']);
    expect(constructs('The value is reported without rounding.')).toEqual(['round']);
    expect(constructs('The count is computed without a subquery.')).toEqual(['subquery']);
    expect(constructs('The whole ranking is returned without LIMIT.')).toEqual(['limit']);
    expect(constructs('The answer is produced without joining the second table.')).toEqual(['join']);
    expect(constructs('The two grains are combined without UNION.')).toEqual(['union']);
    expect(constructs('Avoid an alias here.')).toEqual(['select-alias']);
    expect(constructs('There is no alias to keep.')).toEqual(['select-alias']);
  });

  it('marks a denial a warning when its sentence names a failure instead of a prescription', () => {
    const warning = denialsOf('Counting rows without joining and grouping by case does not measure how many officers were involved.');
    expect(warning.map((denial) => denial.warning)).toEqual([true]);
    const prescription = denialsOf('The result is returned without joining the second table.');
    expect(prescription.map((denial) => denial.warning)).toEqual([false]);
    expect(denialsOf('A join over both tables inflates the count without DISTINCT.').map((d) => d.warning)).toEqual([true]);
    expect(denialsOf('The rule fails to hold, so never DISTINCT.').map((d) => d.warning)).toEqual([true]);
  });

  it('counts every occurrence, because a sentence that denies twice denied twice', () => {
    expect(denialsOf('Never DISTINCT, and never DISTINCT again.').length).toBe(2);
  });

  it('marks a denial conditional when its own sentence carries a subordinator', () => {
    const conditional = denialsOf('The list is left unaliased when the question names no label.');
    expect(conditional.map((denial) => denial.conditional)).toEqual([true]);
    // A subordinator in the *next* sentence does not reach back into this one.
    const later = denialsOf('The list is left unaliased. It is a rule when nothing is named.');
    expect(later.map((denial) => denial.conditional)).toEqual([false]);
    // …and one in the previous sentence does not reach forward.
    const earlier = denialsOf('When nothing is named the aggregate appears. It is left unaliased.');
    expect(earlier.map((denial) => denial.conditional)).toEqual([false]);
    expect(denialsOf('It is never DISTINCT unless the question asks.').map((d) => d.conditional)).toEqual([true]);
    expect(denialsOf('Never DISTINCT whenever the grain is one row.').map((d) => d.conditional)).toEqual([true]);
    expect(denialsOf('Never DISTINCT if the grain is one row.').map((d) => d.conditional)).toEqual([true]);
  });
});

describe('the constructs a query uses', () => {
  it('reads each construct from the shape rather than from the text', () => {
    const used = (sql: string): string[] => [...constructsOf(sql)].sort();
    expect(used('SELECT DISTINCT a FROM t ORDER BY a LIMIT 3')).toEqual(['distinct', 'limit', 'order-by']);
    expect(used('SELECT a FROM t WHERE b LIKE \'x%\'')).toEqual(['like']);
    expect(used('SELECT COUNT(*) FROM t')).toEqual(['count-star']);
    expect(used('SELECT COUNT(a) FROM t')).toEqual([]);
    expect(used('SELECT ROUND(a) FROM t')).toEqual(['round']);
    expect(used('SELECT CAST(a AS REAL) FROM t')).toEqual(['cast']);
    expect(used('SELECT a FROM t WHERE a IN (SELECT b FROM u)')).toEqual(['subquery']);
    expect(used('SELECT a FROM t JOIN u ON t.a = u.a')).toEqual(['join']);
    expect(used('SELECT a FROM t UNION SELECT b FROM u')).toEqual(['union']);
    expect(used('SELECT 1 AS one')).toEqual(['select-alias']);
  });

  it('does not read a CAST type as an output alias', () => {
    expect([...constructsOf('SELECT CAST(a AS REAL) AS r FROM t')].sort()).toEqual(['cast', 'select-alias']);
  });

  it('does not read a table alias after FROM as a select-list alias', () => {
    expect(constructsOf('SELECT a FROM t AS x')).toEqual(new Set());
  });

  it('does not read a construct named inside a literal', () => {
    expect(constructsOf("SELECT a FROM t WHERE label = 'distinct'")).toEqual(new Set());
  });

  it('reads an empty set for a query whose select list has no alias and no construct', () => {
    expect(constructsOf('SELECT a, b FROM t')).toEqual(new Set());
  });
});

describe('one pack against one gold', () => {
  it('separates denials, hits and strict hits', () => {
    const reading = denialReadingOf(
      ['Never DISTINCT here.', 'The result is left unaliased when nothing is named.', 'Join nothing.'],
      'SELECT DISTINCT a FROM t',
    );
    expect(reading.denials).toBe(2);
    // Only the DISTINCT denial names a construct this gold uses; the alias denial does not.
    expect(reading.hits).toBe(1);
    // The aliasing denial is conditional; the DISTINCT one is not.
    expect(reading.strict).toBe(1);
    expect(reading.contradicted).toEqual([{ construct: 'distinct', form: 'not/without DISTINCT' }]);
  });

  it('counts a warning separately, and does not let it reach the hit count', () => {
    const reading = denialReadingOf(
      ['Counting rows without joining does not measure how many officers were involved.'],
      'SELECT a FROM t JOIN u ON t.a = u.a',
    );
    expect(reading.denials).toBe(1);
    expect(reading.warnings).toBe(1);
    expect(reading.hits).toBe(0);
    expect(reading.strict).toBe(0);
    expect(reading.contradicted).toEqual([]);
  });

  it('does not count a denial of a construct the gold does not use', () => {
    const reading = denialReadingOf(['Never DISTINCT here.'], 'SELECT a FROM t');
    expect(reading.denials).toBe(1);
    expect(reading.hits).toBe(0);
    expect(reading.contradicted).toEqual([]);
  });

  it('reports one entry per construct and form however often the pack denies it', () => {
    const reading = denialReadingOf(['Never DISTINCT, and never DISTINCT again.', 'Without DISTINCT.'], 'SELECT DISTINCT a FROM t');
    expect(reading.hits).toBe(3);
    expect(reading.contradicted).toEqual([{ construct: 'distinct', form: 'not/without DISTINCT' }]);
  });
});

describe('how far a statement travels', () => {
  it('counts cases and databases, deduplicating a statement repeated inside one case', () => {
    const spread = spreadOf([
      row({ cluster: 'a', statements: ['X.', 'X.'] }),
      row({ cluster: 'a', statements: ['X.'] }),
      row({ cluster: 'b', statements: ['X.', 'Y.'] }),
    ]);
    expect(spread.get('X.')).toEqual({ cases: 3, databases: 2 });
    expect(spread.get('Y.')).toEqual({ cases: 1, databases: 1 });
  });

  it('scores a case by the share of its statements that reached another database', () => {
    const rows = [row({ cluster: 'a', statements: ['X.', 'Y.'] }), row({ cluster: 'b', statements: ['X.'] })];
    const spread = spreadOf(rows);
    expect(boilerplateShareOf(['X.', 'Y.'], spread)).toBe(0.5);
    expect(boilerplateShareOf(['X.'], spread)).toBe(1);
    expect(boilerplateShareOf([], spread)).toBeNull();
    // A statement nobody else received cannot be found in the map, and counts as local.
    expect(boilerplateShareOf(['Z.'], spread)).toBe(0);
  });

  it('puts the share into one of three strata, and keeps an empty pack out of the clean one', () => {
    expect(circulationStratumOf(null)).toBe('none');
    expect(circulationStratumOf(0)).toBe('none');
    expect(circulationStratumOf(0.5)).toBe('mixed');
    expect(circulationStratumOf(1)).toBe('all');
  });
});

describe('the census of one source', () => {
  /** Four clusters, one of which loses a case to the memory and one of which gains one. */
  function fixture(): PackCopyRow[] {
    return [
      row({ cluster: 'a', correct: false, without: true, statements: ['Never DISTINCT here.'] }),
      row({ cluster: 'a', correct: true, without: true, statements: ['Rule about a.'] }),
      row({
        cluster: 'b',
        correct: true,
        without: false,
        statements: ['Never DISTINCT here.'],
        gold: 'SELECT DISTINCT a FROM t',
      }),
      row({ cluster: 'b', correct: true, without: true, statements: ['Rule about b.'], gold: 'SELECT a FROM t' }),
      row({ cluster: 'c', correct: true, without: true, statements: [], gold: 'SELECT a FROM t' }),
    ];
  }

  it('counts the composition before it reads any outcome', () => {
    const census = copyCensusOf('fixture', fixture());
    expect(census.n).toBe(5);
    expect(census.clusters).toBe(3);
    expect(census.statements).toBe(3);
    // `Never DISTINCT here.` travelled from a to b, so it circulates; `Local rule.` did not.
    expect(census.circulating).toBe(1);
    expect(census.withDenial).toBe(2);
    // Only the b case has a gold with DISTINCT, so only it is a hit.
    expect(census.withHit).toBe(1);
    expect(census.withStrict).toBe(1);
    expect(census.contradicted).toEqual([{ construct: 'distinct', cases: 1 }]);
  });

  it('reads the denial strata against each other and publishes the gap', () => {
    const census = copyCensusOf('fixture', fixture());
    expect(census.deniedDelta).toBe(100);
    expect(census.deniedInterval).not.toBeNull();
    // Three of four remaining cases kept their outcome and one lost it: −1 of 4.
    expect(census.cleanDelta).toBeCloseTo(-25, 12);
    expect(census.denialGap).not.toBeNull();
    expect(census.denialGap?.point).toBeCloseTo(125, 12);
  });

  it('drops the draws that lose a stratum and says how many', () => {
    const census = copyCensusOf('fixture', fixture(), 200);
    expect(census.denialGap?.dropped).toBeGreaterThan(0);
  });

  it('reads the circulation strata, with the empty pack in `none`', () => {
    // Each fixture case carries one statement: two circulate, two are local, one received nothing.
    const census = copyCensusOf('fixture', fixture());
    expect(census.circulation.map((entry) => [entry.stratum, entry.n])).toEqual([
      ['none', 3],
      ['mixed', 0],
      ['all', 2],
    ]);
    expect(census.circulationGap).not.toBeNull();
  });

  it('refuses a corpus with no cases, a case with no database, and an outcome that is not boolean', () => {
    expect(() => copyCensusOf('empty', [])).toThrow(/carries no cases/);
    expect(() => copyCensusOf('nodatabase', [row({ cluster: '' })])).toThrow(/without a database/);
    expect(() =>
      copyCensusOf('notbool', [row({ correct: 1 as unknown as boolean })]),
    ).toThrow(/both arms' outcomes/);
  });

  it('leaves a stratum that does not exist without a delta rather than with a zero', () => {
    const noHit = [row({ statements: ['Rule about a.'] }), row({ cluster: 'b', statements: ['Rule about b.'] })];
    const census = copyCensusOf('nohit', noHit);
    expect(census.withHit).toBe(0);
    expect(census.deniedDelta).toBeNull();
    expect(census.deniedInterval).toBeNull();
    expect(census.denialGap).toBeNull();
    expect(census.strictGap).toBeNull();
    expect(census.statement).toContain('no denial contrast');
  });

  it('leaves a circulation gap undefined when no case is entirely boilerplate', () => {
    const local = [row({ statements: ['A.'] }), row({ cluster: 'b', statements: ['B.'] })];
    const census = copyCensusOf('local', local);
    expect(census.circulationGap).toBeNull();
    expect(census.statement).toContain('no circulation contrast');
    // A gap needs both ends: a corpus that is entirely boilerplate has no singleton ends to compare.
    const boilerplate = [row({ statements: ['A.'] }), row({ cluster: 'b', statements: ['A.'] })];
    expect(copyCensusOf('all', boilerplate).circulationGap).toBeNull();
    const both = [...boilerplate, row({ cluster: 'c', statements: ['Local.'] })];
    expect(copyCensusOf('both', both).circulationGap).not.toBeNull();
  });

  it('publishes a sentence built only from the numbers it reports', () => {
    const census = copyCensusOf('fixture', fixture());
    expect(census.statement).toContain('1 of 5 cases carry a denial');
    expect(census.statement).toContain('the all-boilerplate stratum sits');
  });
});

describe('the table', () => {
  it('aligns every row to the header it is printed under', () => {
    // Two cases share a statement, so both a circulating stratum and a singleton one exist and every
    // gap row has a number in it; the em-dash path is checked by the test below.
    const census = copyCensusOf('fixture', [
      row({ cluster: 'a', correct: false, without: true, statements: ['Never DISTINCT here.'], gold: 'SELECT DISTINCT a FROM t' }),
      row({ cluster: 'b', statements: ['Never DISTINCT here.'] }),
      row({ cluster: 'c', statements: ['Local.'] }),
    ]);
    const lines = copyLines(census);
    // contradicted, else, denial-gap, strict-gap, none, mixed, all, circ-gap
    expect(lines.length).toBe(8);
    for (const line of [COPY_HEADER, ...lines]) expect(line.length).toBe(COPY_HEADER.length);
    expect(lines[0]).toContain('contradicted');
    expect(lines[7]).toContain('circ-gap');
    expect(compositionLine(census)).toHaveLength(COMPOSITION_HEADER.length);
  });

  it('draws an em dash where a stratum has no number', () => {
    const census = copyCensusOf('nohit', [row({ statements: ['Local rule.'] })]);
    const lines = copyLines(census);
    expect(lines[0]).toContain('—');
    // One case has no `else` stratum, no gaps at either end, and two empty circulation strata.
    expect(lines.filter((line) => line.includes('—')).length).toBe(6);
  });
});

describe('reading a committed artefact', () => {
  it('reads the four fields the census needs', () => {
    const rows = packCopyRowsOf(artefact([CASE]), 'arm');
    expect(rows).toEqual([
      { cluster: 'db1', correct: true, withoutMemoryCorrect: false, statements: ['A rule.'], goldSql: 'SELECT x FROM t' },
    ]);
  });

  it('refuses an artefact it cannot read rather than reading it as empty', () => {
    expect(() => packCopyRowsOf({}, 'arm')).toThrow(/carries no per_case array/);
    expect(() => packCopyRowsOf({ per_case: 'x' }, 'arm')).toThrow(/carries no per_case array/);
    expect(() => packCopyRowsOf(artefact(['x']), 'arm')).toThrow(/is not an object/);
    expect(() => packCopyRowsOf(artefact([{ ...CASE, dbId: undefined }]), 'arm')).toThrow(/no dbId/);
    expect(() => packCopyRowsOf(artefact([{ ...CASE, correct: undefined }]), 'arm')).toThrow(/both arms/);
    expect(() => packCopyRowsOf(artefact([{ ...CASE, goldSql: undefined }]), 'arm')).toThrow(/no goldSql/);
    expect(() => packCopyRowsOf(artefact([{ ...CASE, injected: undefined }]), 'arm')).toThrow(/no injected/);
    expect(() => packCopyRowsOf(artefact([{ ...CASE, injected: [1] }]), 'arm')).toThrow(/not text/);
  });

  it('builds every source through the loader it is given', () => {
    const loaded = new Map([
      ['a.json', artefact([CASE])],
      ['b.json', artefact([{ ...CASE, dbId: 'db2' }])],
    ]);
    const census = packCopyCensus(
      [
        { name: 'a', path: 'a.json' },
        { name: 'b', path: 'b.json' },
      ],
      (path) => loaded.get(path),
      0,
    );
    expect(census.id).toBe('poc-pack-copy');
    expect(census.rule).toBe(COPY_RULE);
    expect(census.resamples).toBe(0);
    expect(census.sources.map((source) => [source.source, source.path])).toEqual([
      ['a', 'a.json'],
      ['b', 'b.json'],
    ]);
  });

  it('names four arms, each of which is a file this repository commits', () => {
    expect(COPY_SOURCES.map((source) => source.name)).toEqual([
      'bird-train',
      'bird-dev',
      'bird-dev-lexicon',
      'bird-mini',
    ]);
    for (const source of COPY_SOURCES) expect(source.path).toMatch(/^eval\/results\/poc-sota-bird.*\.json$/);
  });
});
