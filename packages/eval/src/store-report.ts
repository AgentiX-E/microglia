/**
 * What the store contained, and what happened when it was shown.
 *
 * Every arm this project has run reports its accuracy, and the accuracy of a memory arm is a single
 * number that cannot say why. The attribution artefacts answer the why at the level of the individual
 * rule: for every rule that reached a prompt, how many questions it was shown on, how many of them it
 * got right that the control got wrong, and how many the reverse. This module adds those up across
 * runs, because the shape of the answer is the same in all of them and the shape is the finding.
 *
 * Three denominators, and they are not interchangeable:
 *
 *  - **rules** — what the distiller kept.
 *  - **injected** — rule *instances* that reached a prompt. One rule shown on five questions is one
 *    rule and five instances, and the instance is the unit that had a chance to do anything.
 *  - **helpful + harmful** — instances after which the answer changed. Everything else is neutral: it
 *    was read, or not read, and the answer was the same either way.
 *
 * The test is McNemar's exact one over the discordant pairs, which is the exact binomial on
 * helpful versus harmful. A test against the neutral mass would answer a different question —
 * whether the model read the prompt — and a store can be read and ignored, or unread and right.
 *
 * The shares are taken over instances rather than over rules on purpose. A store whose rules are
 * mostly never injected is a store with a retrieval problem, and dividing the effects by the whole
 * store would call that a smaller effect instead of a smaller reach.
 */

import { mcnemarExact } from '@agentix-e/microglia-core';

/** One run's attribution summary, as its artefact recorded it. */
export type StoreRun = {
  readonly id: string;
  /** Rules the distiller kept. */
  readonly rules: number;
  /** Rule instances that reached a prompt. */
  readonly injected: number;
  /** Instances after which the answer went from wrong to right. */
  readonly helpful: number;
  /** Instances after which the answer went from right to wrong. */
  readonly harmful: number;
  /** Instances after which the answer did not change. */
  readonly neutral: number;
};

export type StoreTotals = {
  readonly runs: number;
  readonly rules: number;
  readonly injected: number;
  readonly helpful: number;
  readonly harmful: number;
  readonly neutral: number;
  /** Share of injected instances that repaired the answer. */
  readonly helpfulShare: number;
  /** Share of injected instances that broke it. */
  readonly harmfulShare: number;
  /** Share of injected instances that changed nothing. */
  readonly neutralShare: number;
  /** Share of stored rules that ever reached a prompt. */
  readonly injectedShare: number;
  /** Helpful minus harmful, in instances. */
  readonly net: number;
  /** The same as a share of injected instances. */
  readonly netShare: number;
  /** Two-sided exact McNemar p-value over helpful versus harmful. */
  readonly p: number;
  /** The runs, in the order given, so the command can print them beside the total. */
  readonly perRun: readonly StoreRun[];
};

function shareOf(part: number, whole: number): number {
  return whole === 0 ? 0 : part / whole;
}

/**
 * The totals over a set of runs.
 *
 * Sums are added as counts and divided once at the end. Averaging the runs' shares would give a
 * sixty-question pilot the same weight as a 350-question run, and those two disagree by a factor of
 * two on this ratio — the small run is not a smaller measurement of the same quantity, it is a
 * noisier one.
 */
export function storeReport(runs: readonly StoreRun[]): StoreTotals {
  let rules = 0;
  let injected = 0;
  let helpful = 0;
  let harmful = 0;
  let neutral = 0;
  for (const entry of runs) {
    rules += entry.rules;
    injected += entry.injected;
    helpful += entry.helpful;
    harmful += entry.harmful;
    neutral += entry.neutral;
  }
  return {
    runs: runs.length,
    rules,
    injected,
    helpful,
    harmful,
    neutral,
    helpfulShare: shareOf(helpful, injected),
    harmfulShare: shareOf(harmful, injected),
    neutralShare: shareOf(neutral, injected),
    injectedShare: shareOf(injected, rules),
    net: helpful - harmful,
    netShare: shareOf(helpful - harmful, injected),
    // Exact, and over the discordant pairs only: with no discordant pair there is no sign to test,
    // and the honest answer is that nothing moved.
    p: helpful + harmful === 0 ? 1 : mcnemarExact(helpful, harmful),
    perRun: runs,
  };
}
