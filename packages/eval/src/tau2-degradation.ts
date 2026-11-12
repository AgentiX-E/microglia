/**
 * Memory-induced degradation, on every pair rather than only on a transfer.
 *
 * `Don't Just Trust Your Memory` (KAIST / DeepAuto.ai, 2026-11-10) defines the phenomenon as an agent
 * failing a task *it would have solved with no memory at all*. Its decomposition is what this lane has
 * been missing: **52%** of the failures on those tasks trace to one memory item and **20% of all
 * failures** are an item that is itself wrong; the rest are an item applied outside its scope, misused,
 * or followed while a better item sat in the same store. `MemTrapBench` (arXiv:2608.20202) found every
 * strategy underperforming no-memory across two model families and five frameworks.
 *
 * This lane has computed the number since the BIRD transfer lane — `transferSummary` returns
 * `breakRate = broke / blankRight`, which is exactly the share above. What it has never done is report
 * it on a **within-domain** pair: `transferReadingOf` is only constructed when the two arms answered
 * different domains, so every retail-against-retail pair this project ran published a `pass^4` delta and
 * nothing about how many trials the memory arm broke that the reference passed.
 *
 * So the arithmetic is not written again. A second implementation of a share that two lanes publish
 * would be two definitions of one number waiting to drift apart, and the identical formula is already
 * covered by `transferSummary`'s own tests. This module is the adapter: it pairs the two ledgers and
 * hands them to that function with the one thing a within-domain pair lacks — a store label, which the
 * transfer reader uses to name the treatment in its ledger.
 */
import {
  transferSummary,
  type TransferSummary,
  type TransferTrial,
} from './rule-probe.js';

/**
 * One ledger row. `reward` is nullable because `per_trial` writes `null` for a trial the harness never
 * scored — a hole that is the absence of a denominator rather than a failure, and one the reader below
 * maps to `undefined` instead of to `false`.
 */
type TrialRow = { readonly id: string; readonly trial: number; readonly reward: number | null };

/** τ²'s own definition of a solved attempt, and the hole it is not. */
function verdictOf(reward: number | null): boolean | undefined {
  if (reward === null) return undefined;
  return reward === 1;
}

function keyOf(row: TrialRow): string {
  return `${row.id}#${String(row.trial)}`;
}

/**
 * The pair's degradation reading, or `undefined` when the two ledgers are not the same trials.
 *
 * `undefined` rather than a partial reading, for the rule `poolArms` states about two experiments: a
 * difference across different trials is a number about the union of those trials. A pair whose arms
 * answered different task sets is two runs, and the caller prints "not measurable", which this project
 * insists on over a plausible wrong number.
 */
export function degradationOfPair(
  reference: readonly TrialRow[],
  memory: readonly TrialRow[],
  store = 'pair',
): TransferSummary | undefined {
  if (reference.length === 0 || memory.length === 0) return undefined;
  const memoryByKey = new Map<string, TrialRow>();
  for (const row of memory) {
    const key = keyOf(row);
    if (memoryByKey.has(key)) return undefined;
    memoryByKey.set(key, row);
  }
  const referenceKeys = new Set<string>();
  for (const row of reference) {
    const key = keyOf(row);
    if (referenceKeys.has(key)) return undefined;
    referenceKeys.add(key);
  }
  if (referenceKeys.size !== memoryByKey.size) return undefined;
  for (const key of referenceKeys) if (!memoryByKey.has(key)) return undefined;

  const trials: TransferTrial[] = reference.map((row) => ({
    itemId: `pair@${store}`,
    targetId: row.id,
    // τ²'s own definition, and the one the `pass^4` beside this reading uses: success is exactly 1.0.
    // A `null` becomes `undefined` and stays out of the denominator -- folding it into `false` would
    // file an unscored trial as a failure and credit every repair with a case nobody measured.
    blankCorrect: verdictOf(row.reward),
    withRuleCorrect: verdictOf((memoryByKey.get(keyOf(row)) as TrialRow).reward),
  }));
  return transferSummary(trials);
}

function pp(share: number): string {
  return `${(share * 100).toFixed(2)}%`;
}

/**
 * One line, in the shape the other censuses print: the share first, the population it is over second.
 *
 * A reader comparing this to the field's 52% has to be able to see what the denominator was — 1 of 4
 * trials and 52 of 500 are not the same claim — and has to see `unmeasured` beside it, because a trial
 * whose partner never returned is the absence of a denominator rather than a negative result.
 */
export function degradationLineOf(reading: TransferSummary | undefined): string {
  if (reading === undefined) {
    return 'degradation: no measurement -- the two arms do not share a trial ledger';
  }
  const share =
    reading.blankRight === 0
      ? 'the reference passed nothing, so there is no share to take'
      : `${String(reading.broke)} of ${String(reading.blankRight)} trial(s) the reference passed, ` +
        `the memory arm failed (${pp(reading.breakRate)})`;
  return `degradation: ${share}; repaired ${String(reading.repaired)}, unmeasured ${String(reading.unmeasured)}`;
}
