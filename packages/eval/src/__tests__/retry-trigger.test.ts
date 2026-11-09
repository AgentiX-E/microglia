import { describe, expect, it } from 'vitest';
import {
  RETRY_REASONS,
  retryTriggerFor,
  retryTriggerOf,
  summariseRetryPopulation,
  type RetryPopulationRow,
} from '../retry-trigger.js';
import type { QueryOutcome } from '@agentix-e/microglia-sql';

function ran(rows: number): QueryOutcome {
  return {
    ok: true,
    tuples: Array.from({ length: rows }, () => [1]),
    canonical: Array.from({ length: rows }, () => '1'),
    columns: rows === 0 ? [] : ['c'],
    error: undefined,
  };
}

function failed(error: string | undefined): QueryOutcome {
  return { ok: false, tuples: [], canonical: [], columns: [], error };
}

describe('retryTriggerOf', () => {
  it('retries a reply that contained no query, whatever the execution says', () => {
    // There was nothing to run, so the state of the last execution is not evidence about this
    // attempt. The reason wins over the other two branches because it is the cause of them.
    expect(retryTriggerOf({ parsed: false, executed: false, rows: 0, error: 'disk is on fire' })).toEqual({
      reason: 'no-query',
      message: 'it did not contain a query',
    });
    expect(retryTriggerOf({ parsed: false, executed: true, rows: 3, error: undefined })).toEqual({
      reason: 'no-query',
      message: 'it did not contain a query',
    });
  });

  it("carries the driver's own words when the statement failed", () => {
    const trigger = retryTriggerOf({
      parsed: true,
      executed: false,
      rows: 0,
      error: 'Error: no such column: t.foo',
    });
    expect(trigger?.reason).toBe('error');
    expect(trigger?.message).toBe('it failed with: Error: no such column: t.foo');
  });

  it('substitutes a sentence for a driver that fails without a message', () => {
    // The alternative is the word `undefined` reaching a prompt, where it reads as something the
    // model is meant to interpret.
    expect(retryTriggerOf({ parsed: true, executed: false, rows: 0, error: undefined })?.message).toBe(
      'it failed with: an error',
    );
  });

  it('retries a statement that ran and returned nothing', () => {
    expect(retryTriggerOf({ parsed: true, executed: true, rows: 0, error: undefined })).toEqual({
      reason: 'empty',
      message: 'it returned no rows',
    });
  });

  it('does not retry a wrong answer that came back with rows', () => {
    // The line this module exists to hold. Retrying this would need the answer key inside the
    // inference path, and the arm would stop being a mechanism.
    expect(retryTriggerOf({ parsed: true, executed: true, rows: 1, error: undefined })).toBeUndefined();
  });

  it('uses one vocabulary of three reasons', () => {
    expect([...RETRY_REASONS]).toEqual(['no-query', 'error', 'empty']);
  });
});

describe('retryTriggerFor', () => {
  it('reads a missing statement as the no-query reason', () => {
    expect(retryTriggerFor(undefined, undefined)).toEqual({
      reason: 'no-query',
      message: 'it did not contain a query',
    });
  });

  it('agrees with the evidence form on every branch it adapts', () => {
    // The two entry points are one rule with two adapters; if they ever disagree, the lane and the
    // report describe different pipelines.
    const cases: readonly (readonly [string | undefined, QueryOutcome | undefined, readonly unknown[] | undefined])[] = [
      [undefined, undefined, [{ reason: 'no-query', message: 'it did not contain a query' }]],
      ['SELECT 1', failed('Error: boom'), [{ reason: 'error', message: 'it failed with: Error: boom' }]],
      ['SELECT 1', failed(undefined), [{ reason: 'error', message: 'it failed with: an error' }]],
      ['SELECT 1', ran(0), [{ reason: 'empty', message: 'it returned no rows' }]],
      ['SELECT 1', ran(2), undefined],
    ];
    for (const [sql, outcome, expected] of cases) {
      const adapted = retryTriggerFor(sql, outcome);
      expect(adapted === undefined ? undefined : { reason: adapted.reason, message: adapted.message }).toEqual(
        expected?.[0],
      );
    }
  });

  it('raises when an attempted statement lost its outcome', () => {
    // A defined statement with no outcome is a defect in the lane, and counting it as a model
    // failure would put the bench's own mistakes inside the retried population.
    expect(() => retryTriggerFor('SELECT 1', undefined)).toThrow(/no execution outcome/);
  });
});

describe('summariseRetryPopulation', () => {
  const rows: readonly RetryPopulationRow[] = [
    { reason: 'no-query', correct: false },
    { reason: 'error', correct: false },
    { reason: 'empty', correct: false },
    { reason: 'empty', correct: true },
    { reason: undefined, correct: true },
    { reason: undefined, correct: false },
  ];

  it('counts the population, its share and its composition', () => {
    const summary = summariseRetryPopulation(rows, 3);
    expect(summary.asked).toBe(6);
    expect(summary.retried).toBe(4);
    expect(summary.share).toBe(0.6667);
    expect(summary.byReason).toEqual({ 'no-query': 1, error: 1, empty: 2 });
  });

  it('separates the questions a retry can repair from the ones it can only break', () => {
    // A net delta of zero over a population that repaired one and broke one is two opposite facts,
    // and only the split makes them visible.
    expect(summariseRetryPopulation(rows, 3).wrongAmongRetried).toBe(3);
  });

  it('reports a share of zero rather than NaN when nothing was asked', () => {
    const summary = summariseRetryPopulation([], 140);
    expect(summary).toEqual({
      asked: 0,
      retried: 0,
      share: 0,
      byReason: { 'no-query': 0, error: 0, empty: 0 },
      wrongAmongRetried: 0,
      floor: 140,
      meetsFloor: false,
    });
  });

  it('carries the floor it was given, and meets it exactly', () => {
    const atFloor = Array.from({ length: 140 }, () => ({ reason: 'empty' as const, correct: false }));
    expect(summariseRetryPopulation(atFloor, 140).meetsFloor).toBe(true);
    expect(summariseRetryPopulation(atFloor.slice(1), 140).meetsFloor).toBe(false);
  });
});
