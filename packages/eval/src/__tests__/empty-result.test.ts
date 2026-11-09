import { describe, expect, it } from 'vitest';
import { classifyEmptyAttempt, summariseEmptyAttempts, type EmptyAttempt } from '../empty-result.js';

const GOLD = 'SELECT T1.name FROM singer AS T1 JOIN concert AS T2 ON T1.id = T2.singer_id WHERE T2.year = 2014';

describe('classifyEmptyAttempt', () => {
  it('calls an attempt that reads the same tables what it is, whatever the join order', () => {
    const attempt = 'SELECT name FROM concert JOIN singer ON singer.id = concert.singer_id WHERE year = 2015';
    const classified = classifyEmptyAttempt(attempt, GOLD);
    expect(classified.cause).toBe('same-tables');
    // Bare numbers are values too: BIRD writes `year = 2014` without quotes, and the 2015 the
    // attempt invented against the 2014 the gold uses is exactly the difference that emptied it.
    expect(classified.goldValuesAbsent).toBe(1);
    expect(classified.attemptValuesExtra).toBe(1);
  });

  it('treats a differently spelled literal as a different value', () => {
    const gold = "SELECT name FROM singer WHERE name = 'Acme'";
    const attempt = "SELECT name FROM singer WHERE name = 'ACME'";
    // Literals are lower-cased by the tokenizer, so this pair is one value and not a miss.
    expect(classifyEmptyAttempt(attempt, gold).goldValuesAbsent).toBe(0);
    expect(classifyEmptyAttempt("SELECT name FROM singer WHERE name = 'Acme Inc'", gold).goldValuesAbsent).toBe(1);
  });

  it('separates a missing table from an invented one, because only one of them is a relaxation', () => {
    const missing = classifyEmptyAttempt('SELECT name FROM singer WHERE id = 3', GOLD);
    expect(missing.cause).toBe('missing-table');
    const extra = classifyEmptyAttempt(`${GOLD} AND EXISTS (SELECT 1 FROM stadium)`, GOLD);
    expect(extra.cause).toBe('extra-table');
  });

  it('reports a missing table over an invented one, because that is the fact a repair acts on', () => {
    // Two disjoint sets differ in both directions at once, and the buckets are ordered rather than
    // exclusive: a table the gold needs and the attempt never read is the actionable half.
    expect(classifyEmptyAttempt('SELECT 1 FROM stadium JOIN league ON 1 = 1', GOLD).cause).toBe('missing-table');
  });

  it('counts the gold values the attempt never wrote, which is the value-spelling bucket', () => {
    const attempt = 'SELECT T1.name FROM singer AS T1 JOIN concert AS T2 ON T1.id = T2.singer_id WHERE T2.year = 2014 AND T2.venue = 7';
    const classified = classifyEmptyAttempt(attempt, GOLD);
    expect(classified.cause).toBe('same-tables');
    // The gold's 2014 is present, so this attempt is not a value miss; the invented 7 is extra.
    expect(classified.goldValuesAbsent).toBe(0);
    expect(classified.attemptValuesExtra).toBe(1);
  });

  it('notices when the gold ranks and the attempt filtered instead', () => {
    // "the youngest client" answered as `WHERE age = 17`: a phrasing miss whose result is empty by
    // construction, and the one bucket a second attempt can repair by re-reading the question.
    const gold = 'SELECT name FROM singer ORDER BY age LIMIT 1';
    expect(classifyEmptyAttempt('SELECT name FROM singer WHERE age = 99', gold).goldRanksOnly).toBe(true);
    expect(classifyEmptyAttempt('SELECT name FROM singer ORDER BY age LIMIT 1', gold).goldRanksOnly).toBe(false);
  });

  it('is symmetric about ranking: an attempt that ranks where the gold does not is not this bucket', () => {
    expect(classifyEmptyAttempt('SELECT name FROM singer ORDER BY age', 'SELECT name FROM singer').goldRanksOnly).toBe(
      false,
    );
  });
});

describe('summariseEmptyAttempts', () => {
  const attempts: readonly EmptyAttempt[] = [
    { cause: 'same-tables', goldValuesAbsent: 1, attemptValuesExtra: 1, goldRanksOnly: false },
    { cause: 'same-tables', goldValuesAbsent: 0, attemptValuesExtra: 0, goldRanksOnly: true },
    { cause: 'same-tables', goldValuesAbsent: 1, attemptValuesExtra: 0, goldRanksOnly: false },
    { cause: 'extra-table', goldValuesAbsent: 0, attemptValuesExtra: 0, goldRanksOnly: false },
    { cause: 'missing-table', goldValuesAbsent: 0, attemptValuesExtra: 0, goldRanksOnly: true },
    { cause: 'extra-table', goldValuesAbsent: 2, attemptValuesExtra: 2, goldRanksOnly: false },
  ];

  it('describes the population by cause', () => {
    const summary = summariseEmptyAttempts(attempts);
    expect(summary.examined).toBe(6);
    expect(summary.byCause).toEqual({ 'same-tables': 3, 'missing-table': 1, 'extra-table': 2 });
    expect(summary.sameTables).toBe(3);
    expect(summary.shareSameTables).toBe(0.5);
  });

  it('divides the value-spelling bucket by the whole population, not by the bucket it sits in', () => {
    // A share of the same-tables subset would be the same mistake as the prose this replaces: it
    // would say "two thirds of empty results are value misses" when the reachable share is a third.
    const summary = summariseEmptyAttempts(attempts);
    expect(summary.sameTablesMissingValue).toBe(2);
    expect(summary.shareMissingValue).toBe(0.3333);
  });

  it('counts ranking misses wherever they occur, because they are not a table property', () => {
    expect(summariseEmptyAttempts(attempts).goldRanksOnly).toBe(2);
  });

  it('reports zero shares rather than NaN when nothing was examined', () => {
    const summary = summariseEmptyAttempts([]);
    expect(summary).toEqual({
      examined: 0,
      byCause: { 'same-tables': 0, 'missing-table': 0, 'extra-table': 0 },
      sameTables: 0,
      shareSameTables: 0,
      sameTablesMissingValue: 0,
      shareMissingValue: 0,
      goldRanksOnly: 0,
    });
  });
});
