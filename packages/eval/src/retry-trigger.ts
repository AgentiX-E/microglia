/**
 * When a first answer earns a second one.
 *
 * The retry arms are conditional treatments, so their population is not a detail of the
 * measurement — it is the denominator. `full-onretry` and `retry-blank` are the only two arms in
 * this record that were ever read as non-negative (+1.43pp and +0.57pp), and neither number has an
 * artefact behind it: the arms exist, the trigger exists, and the size of the population they act
 * on was never written down. A +0.57pp effect on an unknown number of questions is not a
 * measurement of a mechanism, it is a measurement of a rumour.
 *
 * So the trigger is here, as one function with one vocabulary, for the same reason the ordering
 * signal is: a lane that decides who gets retried and a report that counts who got retried have to
 * be the same code, or the report describes a pipeline nobody ran.
 *
 * The rule itself is a deployment fact rather than a benchmark one — both conditions are decidable
 * from the database alone, without the answer key:
 *
 * - the reply contained no query, so there was nothing to run;
 * - the query ran and failed;
 * - the query ran and returned no rows.
 *
 * A query that runs and returns the **wrong** rows is deliberately not retried. That is the line
 * this module exists to hold: "retry the things the world rejected" is a mechanism, and "retry the
 * things we know were wrong" is a benchmark with the answer key wired into the inference path.
 */
import { MicrogliaError } from '@agentix-e/microglia-core';
import type { QueryOutcome } from '@agentix-e/microglia-sql';

/** The three ways a first attempt can earn a second one, in the order they are checked. */
export type RetryReason = 'no-query' | 'error' | 'empty';

export const RETRY_REASONS: readonly RetryReason[] = ['no-query', 'error', 'empty'];

/** A reason and the words the retry prompt uses to describe it. */
export type RetryTrigger = {
  readonly reason: RetryReason;
  readonly message: string;
};

/**
 * What is known about a first attempt at the moment the retry decision is taken.
 *
 * Primitives rather than a `QueryOutcome`, because the lane already holds these four facts from the
 * execution it needed for judging and should not have to fabricate an outcome to ask a question
 * about it. `rows` is ignored when `executed` is false, and `error` is ignored when it is true.
 */
export type RetryEvidence = {
  readonly parsed: boolean;
  readonly executed: boolean;
  readonly rows: number;
  readonly error: string | undefined;
};

/**
 * The decision, from the four facts a caller already has.
 *
 * `error ?? 'an error'` is load-bearing: a driver that reports failure without a message would
 * otherwise put the string `undefined` into a prompt, which reads to the model as a stack trace it
 * is expected to interpret.
 */
export function retryTriggerOf(evidence: RetryEvidence): RetryTrigger | undefined {
  if (!evidence.parsed) return { reason: 'no-query', message: 'it did not contain a query' };
  if (!evidence.executed) {
    return { reason: 'error', message: `it failed with: ${evidence.error ?? 'an error'}` };
  }
  if (evidence.rows === 0) return { reason: 'empty', message: 'it returned no rows' };
  return undefined;
}

/**
 * The same decision, from a statement and the outcome of running it.
 *
 * `sql === undefined` and `outcome === undefined` are different facts and only the first one is a
 * retry reason. A defined statement with no outcome means the caller lost an execution, which is a
 * defect in the lane rather than a property of an answer, so it is raised instead of being counted
 * as a failure — the alternative is a population that silently includes the bench's own mistakes.
 */
export function retryTriggerFor(
  sql: string | undefined,
  outcome: QueryOutcome | undefined,
): RetryTrigger | undefined {
  if (sql === undefined) {
    return retryTriggerOf({ parsed: false, executed: false, rows: 0, error: undefined });
  }
  if (outcome === undefined) {
    throw new MicrogliaError('MG_E_CONFIG', 'an attempted statement has no execution outcome', {
      sql: sql.slice(0, 200),
    });
  }
  return retryTriggerOf({
    parsed: true,
    executed: outcome.ok,
    rows: outcome.tuples.length,
    error: outcome.error,
  });
}

/** One question's first attempt, reduced to the two facts the population needs. */
export type RetryPopulationRow = {
  readonly reason: RetryReason | undefined;
  /** Whether the first attempt happened to be right, which decides whether a repair is available. */
  readonly correct: boolean;
};

/**
 * The population a retry arm acts on, and whether it is big enough to say anything about it.
 *
 * `wrongAmongRetried` is the repair target: a retried question that was already correct cannot be
 * improved by a second attempt and can only be made worse, and a retried question that was wrong
 * can only be made better. Reporting the population without that split would let a net delta of
 * zero hide a repair and a break of the same size.
 *
 * `floor` is a parameter rather than a constant because it is a registration's decision about how
 * much evidence it needs, not a property of the pipeline. It is reported back with the verdict so
 * that an artefact saying `meetsFloor: false` cannot be read as a result.
 */
/**
 * The population a retry effect needs before it is reported as one.
 *
 * 90 is R64's amended floor, and the amendment is the interesting part: the original registration
 * asked for 140 on the reasoning that a 53% base accuracy leaves about 165 wrong answers. A retry arm
 * does not act on wrong answers — it acts on the questions the pipeline itself rejected, which is
 * 6.39% of the dev split, so 140 was unreachable by a factor of 1.4 and the run would have been
 * void for a reason the registration had invented. Ninety is what the population supports, and 98
 * questions resolve a repaired rate near a fifth to about ±7.6pp — enough to separate "does nothing"
 * from "repairs a fifth of what it touches".
 *
 * It lives here rather than in the lane so that the number the artefact reports and the number a
 * test can hold to the registration are the same number: the first R64 artefact was produced with a
 * stale default of 140 and said `meetsFloor: false` about a population the amended document accepts.
 */
export const RETRY_POPULATION_FLOOR = 90;

export type RetryPopulation = {
  readonly asked: number;
  readonly retried: number;
  readonly share: number;
  readonly byReason: Readonly<Record<RetryReason, number>>;
  readonly wrongAmongRetried: number;
  readonly floor: number;
  readonly meetsFloor: boolean;
};

export function summariseRetryPopulation(
  rows: readonly RetryPopulationRow[],
  floor: number,
): RetryPopulation {
  const byReason: Record<RetryReason, number> = { 'no-query': 0, error: 0, empty: 0 };
  let retried = 0;
  let wrongAmongRetried = 0;
  for (const row of rows) {
    if (row.reason === undefined) continue;
    byReason[row.reason] += 1;
    retried += 1;
    if (!row.correct) wrongAmongRetried += 1;
  }
  return {
    asked: rows.length,
    retried,
    // A share of nothing is reported as zero rather than as `NaN`: an empty population is a fact
    // about a dispatch, and a field that poisons every downstream average is not.
    share: rows.length === 0 ? 0 : Number((retried / rows.length).toFixed(4)),
    byReason,
    wrongAmongRetried,
    floor,
    meetsFloor: retried >= floor,
  };
}
