/**
 * The classifier's own tests.
 *
 * A covariate is only worth what its tokeniser is worth: every number in R30's artefact is a count
 * over the output of the functions below, and a `from` misread inside a string literal or an alias
 * counted as a column would move the result without anyone noticing. So the tests are written
 * against the constructs BIRD's gold queries actually contain — quoted identifiers with spaces,
 * CTEs, comma-joined tables, derived tables, `UNION` — rather than against a happy path.
 */
import { describe, expect, it } from 'vitest';
import {
  SQL_KEYWORDS,
  contextTokens,
  diffQueries,
  gateKeepsMemoryQuery,
  isGrounded,
  kindOf,
  sqlShapeOf,
  tokenizeSql,
  type QueryDelta,
} from '../sql-diff.js';

describe('tokenizeSql', () => {
  it('drops line and block comments but keeps the literal around them', () => {
    const tokens = tokenizeSql("SELECT a -- note\nFROM t /* gone */ WHERE b = 1");
    expect(tokens.map((token) => token.text)).toEqual([
      'select', 'a', 'from', 't', 'where', 'b', '=', '1',
    ]);
  });

  it('keeps SQL words inside a string literal as one string token', () => {
    const tokens = tokenizeSql("WHERE note = 'from where join'");
    expect(tokens.filter((token) => token.kind === 'string').map((token) => token.text)).toEqual([
      'from where join',
    ]);
  });

  it('unescapes a doubled quote in both string and identifier position', () => {
    const tokens = tokenizeSql(`SELECT 'it''s', "a""b" FROM t`);
    expect(tokens.filter((token) => token.kind === 'string').map((token) => token.text)).toEqual(["it's"]);
    expect(tokens.filter((token) => token.kind === 'word').map((token) => token.text)).toContain('a"b');
  });

  it('reads a backticked identifier as a name and lower-cases it', () => {
    const tokens = tokenizeSql('SELECT `Weird Col` FROM t');
    expect(tokens.some((token) => token.kind === 'word' && token.text === 'weird col')).toBe(true);
  });

  it('tracks depth so that a subquery is not read as top level', () => {
    const tokens = tokenizeSql('SELECT a FROM (SELECT b FROM t)');
    const inner = tokens.find((token) => token.text === 'select' && token.depth === 1);
    expect(inner).toBeDefined();
  });

  it('consumes an unterminated literal or comment to the end rather than throwing', () => {
    expect(tokenizeSql("SELECT 'abc").some((token) => token.text === 'abc')).toBe(true);
    expect(tokenizeSql('SELECT a /* never closed').map((token) => token.text)).toEqual(['select', 'a']);
    expect(tokenizeSql('SELECT a -- trailing').map((token) => token.text)).toEqual(['select', 'a']);
  });

  it('keeps a decimal number in one token and skips whitespace and unknowns', () => {
    const tokens = tokenizeSql('a = 1.5 @ b$c');
    expect(tokens.map((token) => token.text)).toEqual(['a', '=', '1.5', '@', 'b$c']);
  });
});

describe('sqlShapeOf', () => {
  it('separates tables from columns when the query aliases them', () => {
    const shape = sqlShapeOf(
      'SELECT h.Reputation FROM users h JOIN users j ON h.Id = j.Id WHERE h.Name = j.Name',
    );
    expect(shape.tables).toEqual(['users']);
    expect(shape.columns).toContain('reputation');
    expect(shape.columns).toContain('name');
    expect(shape.columns).not.toContain('h');
    expect(shape.columns).not.toContain('users');
  });

  it('reads every element of a comma-joined FROM clause, with or without AS', () => {
    const shape = sqlShapeOf('SELECT a FROM users AS u, posts p, tags');
    expect(shape.tables).toEqual(['posts', 'tags', 'users']);
    expect(shape.columns).not.toContain('u');
    expect(shape.columns).not.toContain('p');
  });

  it('registers a derived table alias so it is not counted as a column', () => {
    const shape = sqlShapeOf('SELECT s.a FROM (SELECT a FROM t) AS s');
    expect(shape.tables).toEqual(['t']);
    expect(shape.columns).toEqual(['a']);
  });

  it('registers a derived table alias written without AS', () => {
    const shape = sqlShapeOf('SELECT s.a FROM (SELECT a FROM t) s');
    expect(shape.columns).toEqual(['a']);
  });

  it('reads every CTE name, including after a comma and behind RECURSIVE', () => {
    const shape = sqlShapeOf(
      'WITH RECURSIVE a AS (SELECT x FROM t1), b AS (SELECT y FROM t2) SELECT a.x FROM a, b',
    );
    expect(shape.columns).not.toContain('a');
    expect(shape.columns).not.toContain('b');
    expect(shape.clauses).toContain('with');
  });

  it('survives a CTE that is not a CTE', () => {
    // Three shapes a truncated reply produces: `WITH` and nothing, `WITH x` and no body, and a
    // `WITH` whose first element is not a name at all.
    expect(sqlShapeOf('WITH').columns).toEqual([]);
    expect(sqlShapeOf('WITH x SELECT x FROM t').tables).toEqual(['t']);
    expect(sqlShapeOf('WITH 1 AS (SELECT a FROM t) SELECT a FROM t').tables).toEqual(['t']);
  });

  it('excludes function names and aggregate calls from the column set', () => {
    const shape = sqlShapeOf("SELECT strftime('%Y', d), COUNT(Id) FROM t");
    expect(shape.columns).toEqual(['d', 'id']);
    expect(shape.aggregates).toEqual(['count']);
    expect(shape.literals).toEqual(['%y']);
  });

  it('excludes an output label from the column set, because execution ignores it', () => {
    const shape = sqlShapeOf('SELECT Reputation AS score FROM users');
    expect(shape.columns).toEqual(['reputation']);
  });

  it('measures arity at the first top-level SELECT, so a UNION does not report the last branch', () => {
    expect(sqlShapeOf('SELECT a, b, c FROM t UNION SELECT d, e FROM u').arity).toBe(3);
  });

  it('reports zero arity when there is no top-level SELECT', () => {
    expect(sqlShapeOf("UPDATE t SET a = 'x'").arity).toBe(0);
    expect(sqlShapeOf('').arity).toBe(0);
    expect(sqlShapeOf('SELECT').arity).toBe(0);
  });

  it('counts nesting rather than parentheses', () => {
    expect(sqlShapeOf('SELECT (SELECT COUNT(*) FROM t) FROM u').subqueries).toBe(1);
    expect(sqlShapeOf('SELECT (a + b) FROM t').subqueries).toBe(0);
  });

  it('counts conjunctions and clause words', () => {
    const shape = sqlShapeOf('SELECT DISTINCT a FROM t GROUP BY a HAVING COUNT(*) > 1 AND a > 2');
    expect(shape.conjunctions).toBe(1);
    expect(shape.clauses).toEqual(['distinct', 'group', 'having']);
  });

  it('keeps a type name out of the column set', () => {
    expect(sqlShapeOf('SELECT CAST(a AS INTEGER) FROM t').columns).toEqual(['a']);
  });

  it('survives a malformed FROM clause, because a model reply is not always parseable', () => {
    // `FROM , t` and `FROM` at the end of the statement are both things a truncated reply produces.
    // A classifier that threw here would drop exactly the cases where the pack did the most damage.
    expect(() => sqlShapeOf('SELECT a FROM , t')).not.toThrow();
    expect(sqlShapeOf('SELECT a FROM , t').tables).toEqual([]);
    expect(sqlShapeOf('SELECT a FROM').tables).toEqual([]);
    expect(sqlShapeOf('SELECT a FROM (SELECT b FROM t').columns).toContain('a');
  });

  it('treats every keyword in the list as structure', () => {
    // A cheap invariant that catches an entry removed by accident: the set is data, and a keyword
    // that stopped being one would silently become a column in every diff.
    expect(SQL_KEYWORDS.has('select')).toBe(true);
    expect(SQL_KEYWORDS.has('integer')).toBe(true);
    expect(SQL_KEYWORDS.has('reputation')).toBe(false);
  });
});

describe('contextTokens and isGrounded', () => {
  it('tokenises the question and the evidence together, without duplicates', () => {
    const context = contextTokens('How many users?', 'users are counted by id');
    expect(context).toContain('users');
    expect(context.filter((word) => word === 'users')).toHaveLength(1);
    expect(contextTokens('no evidence here', null)).toEqual(['no', 'evidence', 'here']);
    expect(contextTokens('no evidence here', undefined)).toEqual(['no', 'evidence', 'here']);
    // A question made only of digits or punctuation tokenises to nothing, and the set has to be
    // empty rather than `null` for every later membership test to work.
    expect(contextTokens('123 456', null)).toEqual([]);
  });

  it('accepts a name the context states', () => {
    expect(isGrounded('users', contextTokens('how many users', null))).toBe(true);
  });

  it('rejects a name only the rule could have known, under the strict rule', () => {
    expect(isGrounded('frpm', contextTokens('how many schools in Fresno', null))).toBe(false);
  });

  it('accepts a multi-word quoted identifier only when every word is present', () => {
    const both = contextTokens('the low grade students', null);
    expect(isGrounded('low grade', both)).toBe(true);
    expect(isGrounded('low grade', contextTokens('the low students', null))).toBe(false);
  });

  it('grounds a morphological prefix under the looser rule and not under the strict one', () => {
    const context = contextTokens('qualifying race No.903', null);
    expect(isGrounded('raceid', context, 'strict')).toBe(false);
    expect(isGrounded('raceid', context, 'morphological')).toBe(true);
  });

  it('grounds a name contained in a question word under the looser rule', () => {
    expect(isGrounded('end', contextTokens('weekend totals', null), 'morphological')).toBe(true);
  });

  it('ignores question words shorter than three letters under the looser rule', () => {
    expect(isGrounded('abc', contextTokens('ab', null), 'morphological')).toBe(false);
  });

  it('rejects an empty name under the looser rule instead of matching everything', () => {
    expect(isGrounded('_', contextTokens('anything', null), 'morphological')).toBe(false);
  });
});

describe('diffQueries', () => {
  const baseline = 'SELECT DisplayName FROM users WHERE Id = 1';

  it('reports an identical query as unchanged and everything else as empty', () => {
    const delta = diffQueries(baseline, baseline, 'which user', null);
    expect(delta.relation).toBe('unchanged');
    expect(delta.tablesAdded).toEqual([]);
    expect(delta.columnsAdded).toEqual([]);
    expect(delta.ungrounded).toEqual([]);
  });

  it('reports the same tokens in another order as reworded, not as an edit', () => {
    const delta = diffQueries('SELECT a, b FROM t', 'select B, A from T', 'a b', null);
    expect(delta.relation).toBe('reworded');
  });

  it('attributes an added table and an added column to the memory arm', () => {
    const delta = diffQueries(
      'SELECT a FROM t',
      'SELECT a, b FROM t JOIN u ON t.a = u.a',
      'how many a',
      null,
    );
    expect(delta.relation).toBe('edited');
    expect(delta.tablesAdded).toEqual(['u']);
    expect(delta.columnsAdded).toEqual(['b']);
    expect(delta.clausesAdded).toEqual(['join']);
    expect(delta.arityDelta).toBe(1);
  });

  it('attributes a removed name to the baseline side', () => {
    const delta = diffQueries('SELECT a, b FROM t JOIN u', 'SELECT a FROM t', 'a', null);
    expect(delta.tablesRemoved).toEqual(['u']);
    expect(delta.columnsRemoved).toEqual(['b']);
    expect(delta.arityDelta).toBe(-1);
  });

  it('separates names the question grounds from names it does not', () => {
    const delta = diffQueries(
      'SELECT a FROM users',
      'SELECT a FROM users JOIN orders ON users.id = orders.userid',
      'how many users placed orders',
      null,
    );
    expect(delta.grounded).toContain('orders');
    expect(delta.ungrounded).toContain('userid');
  });

  it('diffs literals and aggregates in both directions', () => {
    const delta = diffQueries("SELECT COUNT(a) FROM t WHERE x = 'a'", "SELECT SUM(a) FROM t WHERE x = 'b'", 'a', null);
    expect(delta.aggregatesAdded).toEqual(['sum']);
    expect(delta.aggregatesRemoved).toEqual(['count']);
    expect(delta.literalsAdded).toEqual(['b']);
    expect(delta.literalsRemoved).toEqual(['a']);
  });

  it('counts a change in conjunction count as a direction', () => {
    const delta = diffQueries('SELECT a FROM t WHERE x = 1', 'SELECT a FROM t WHERE x = 1 AND y = 2', 'a', null);
    expect(delta.conjunctionDelta).toBe(1);
  });

  it('carries the looser grounding verdict beside the strict one', () => {
    const delta = diffQueries('SELECT a FROM t', 'SELECT a FROM t JOIN races r ON t.a = r.raceid', 'race 903', null);
    expect(delta.ungrounded).toEqual(['raceid', 'races']);
    // Both names begin with a question word of at least three letters, so the loose rule grounds
    // them and the gap between the two columns is exactly the false-positive rate of the strict one.
    expect(delta.ungroundedLoose).toEqual([]);
  });
});

describe('kindOf', () => {
  const deltaOf = (before: string, after: string, question = 'a'): QueryDelta =>
    diffQueries(before, after, question, null);

  it('labels the seven directions in the documented precedence', () => {
    expect(kindOf(deltaOf('SELECT a FROM t', 'SELECT a FROM t'))).toBe('unchanged');
    expect(kindOf(deltaOf('SELECT a, b FROM t', 'SELECT b, a FROM t', 'a b'))).toBe('reworded');
    expect(kindOf(deltaOf('SELECT a FROM t', 'SELECT a FROM t JOIN u WHERE u.x = 1'))).toBe('imported-name');
    expect(kindOf(deltaOf('SELECT a FROM t', 'SELECT a FROM t WHERE x = 1 AND y = 2'))).toBe('imported-name');
  });

  it('labels a narrowing with no imported name as narrowed', () => {
    expect(kindOf(deltaOf('SELECT a, b FROM t', 'SELECT a FROM t'))).toBe('narrowed');
  });

  it('labels a widening with no imported name as widened', () => {
    expect(kindOf(deltaOf('SELECT a FROM t', 'SELECT a, b FROM t', 'a b'))).toBe('widened');
  });

  it('labels a query that both narrows and widens as reshaped', () => {
    expect(kindOf(deltaOf('SELECT a FROM t', 'SELECT a, b FROM t WHERE x = 1 AND y = 2', 'a b x y'))).toBe(
      'reshaped',
    );
  });

  it('labels an edit with no direction as rewritten', () => {
    expect(kindOf(deltaOf('SELECT a FROM t WHERE x = 1', 'SELECT a FROM t WHERE x = 2'))).toBe('rewritten');
  });

  it('treats a clause that changes the answer set as a direction', () => {
    expect(kindOf(deltaOf('SELECT a FROM t', 'SELECT a FROM t GROUP BY a'))).toBe('narrowed');
    expect(kindOf(deltaOf('SELECT a FROM t GROUP BY a', 'SELECT a FROM t'))).toBe('widened');
  });

  it('does not treat CASE as a direction, because it changes the value and not the rows', () => {
    expect(kindOf(deltaOf('SELECT a FROM t', "SELECT CASE WHEN a > 1 THEN 'x' ELSE 'y' END AS a FROM t"))).toBe(
      'rewritten',
    );
  });
});

describe('gateKeepsMemoryQuery', () => {
  it('keeps a query that imports nothing and discards one that does', () => {
    const clean = diffQueries('SELECT a FROM t', 'SELECT a, b FROM t', 'how many a b', null);
    const dirty = diffQueries('SELECT a FROM t', 'SELECT a FROM t JOIN u ON t.a = u.a', 'a', null);
    expect(gateKeepsMemoryQuery(clean)).toBe(true);
    expect(gateKeepsMemoryQuery(dirty)).toBe(false);
  });

  it('keeps under the looser rule what the strict rule discards', () => {
    const delta = diffQueries('SELECT a FROM t', 'SELECT a FROM t JOIN races r ON t.a = r.raceid', 'race 903', null);
    expect(gateKeepsMemoryQuery(delta, 'strict')).toBe(false);
    expect(gateKeepsMemoryQuery(delta, 'morphological')).toBe(true);
  });
});
