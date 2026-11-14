/**
 * Protocol arithmetic for a cross-fitted experiment.
 *
 * Three primitives, all deterministic and all testable in isolation, because the
 * benchmark lane is only as trustworthy as the split it runs on. A half split
 * wastes half the questions as evaluation data and lets file order decide who
 * lands where; a round-robin slice over a database-sorted file measures one
 * database; and a reported effect size without a stated detectable difference
 * invites reading noise as progress.
 *
 * Nothing here calls a model or touches storage.
 */
import { MicrogliaError } from '@agentix-e/microglia-core';

/**
 * Assign every id to exactly one fold, balance across folds, and stay stable.
 *
 * Sorted order plus round-robin is deliberate: the assignment must not depend on
 * the order a file happened to be written in, and two runs over the same ids must
 * produce the same split. Balance matters because a fold that draws from one
 * database measures that database, not the benchmark.
 */
export function assignFolds(ids: readonly string[], folds: number): ReadonlyMap<string, number> {
  if (!Number.isInteger(folds) || folds < 2) {
    throw new MicrogliaError('MG_E_CONFIG', 'folds must be an integer of at least 2', { folds });
  }
  if (ids.length === 0) {
    return new Map();
  }
  if (folds > ids.length) {
    throw new MicrogliaError('MG_E_CONFIG', 'folds cannot exceed the number of ids', {
      folds,
      ids: ids.length,
    });
  }
  const unique = new Set(ids);
  if (unique.size !== ids.length) {
    throw new MicrogliaError('MG_E_CONFIG', 'fold assignment requires unique ids', {
      ids: ids.length,
      unique: unique.size,
    });
  }
  const assignment = new Map<string, number>();
  [...ids].sort().forEach((id, index) => {
    assignment.set(id, index % folds);
  });
  return assignment;
}

/**
 * Reorder rows so that any prefix covers every key as evenly as its size allows.
 *
 * A question file is grouped by database, so `rows.slice(0, limit)` is a sample
 * of the first database. Interleaving turns a prefix into a stratified sample
 * without randomness, which keeps a small run reproducible and comparable to a
 * larger one.
 */
export function interleaveByKey<T>(rows: readonly T[], key: (row: T) => string): T[] {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const bucket = groups.get(key(row));
    if (bucket === undefined) groups.set(key(row), [row]);
    else bucket.push(row);
  }
  const queues = [...groups.values()];
  const out: T[] = [];
  let emitted = 0;
  while (emitted < rows.length) {
    for (const queue of queues) {
      const next = queue.shift();
      if (next === undefined) continue;
      out.push(next);
      emitted += 1;
    }
  }
  return out;
}

// The formula is re-exported rather than defined here, because `prereg.ts` needs the same one and
// cannot reach this module: the registration runs before anything is built, and this file imports
// the core package. One definition, in `detectable.ts`, reached from both.
export { detectableDelta, POWER_Z } from './detectable.js';

/** Share of pairs where the two arms disagree, in [0, 1]. */
export function discordanceOf(baseline: readonly boolean[], treatment: readonly boolean[]): number {
  if (baseline.length === 0 || baseline.length !== treatment.length) return 0;
  let disagree = 0;
  for (let i = 0; i < baseline.length; i += 1) {
    if ((baseline[i] === true) !== (treatment[i] === true)) disagree += 1;
  }
  return disagree / baseline.length;
}
