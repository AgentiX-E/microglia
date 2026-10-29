/**
 * What the store contained, and what happened when it was shown.
 *
 * Every arm this project has run reports its accuracy, and the accuracy of a memory arm is a single
 * number that cannot say why. The attribution artefacts answer the why at the level of the individual
 * rule: for every rule that reached a prompt, how many questions it was shown on, how many of them it
 * got right that the control got wrong, and how many the reverse. This module adds those up across
 * runs, because the shape of the answer is the same in all of them and the shape is the finding.
 *
 * **Two units, and the artefact reports one of them.** `injectedRules`, `helpful`, `harmful` and
 * `neutral` are counts of *rules*: the summary classifies each rule by the sign of its net effect and
 * reports how many rules fell in each class. The only instance-weighted number it carries is
 * `harmfulShare`, which is the share of injections belonging to a net-harmful rule. An earlier version
 * of this module read the rule counts as instance counts and reported "3.90% of injected instances
 * repaired the answer", which was 3.90% of the *rules that were injected*. The numbers were close
 * enough to look plausible, which is exactly why the unit had to be written down.
 *
 * What is reported here, then:
 *
 *  - **rules** — what the distiller kept.
 *  - **injectedRules** — of those, the ones that reached a prompt at least once. The gap between the
 *    two is a retrieval measurement, and it is large.
 *  - **helpfulRules / harmfulRules / neutralRules** — the sign of each injected rule's net effect.
 *    Neutral means the flips it caused cancelled out exactly, which for a rule shown once means it
 *    caused none.
 *
 * The test is the exact binomial sign test over the rules: given `helpful + harmful` rules whose net
 * effect was not zero, is the split consistent with a coin? That is McNemar's exact formula applied at
 * the rule level, and the unit is stated because a reader who assumes instances would read a much
 * stronger claim than the data supports.
 */

import { mcnemarExact } from '@agentix-e/microglia-core';

/** One run's attribution summary, as its artefact recorded it. */
export type StoreRun = {
  readonly id: string;
  /** Rules the distiller kept. */
  readonly rules: number;
  /** Of those, the rules that reached a prompt at least once. */
  readonly injectedRules: number;
  /** Injected rules that repaired more answers than they broke. */
  readonly helpfulRules: number;
  /** Injected rules that broke more answers than they repaired. */
  readonly harmfulRules: number;
  /** Injected rules whose flips cancelled out exactly. */
  readonly neutralRules: number;
  /** Share of *injections* belonging to a net-harmful rule. The only instance-weighted number here. */
  readonly harmfulInstanceShare: number;
};

export type StoreTotals = {
  readonly runs: number;
  readonly rules: number;
  readonly injectedRules: number;
  readonly helpfulRules: number;
  readonly harmfulRules: number;
  readonly neutralRules: number;
  /** Share of stored rules that ever reached a prompt. */
  readonly injectedShare: number;
  /** Share of injected rules that net-repaired, net-broke, and net-did-nothing. */
  readonly helpfulShare: number;
  readonly harmfulShare: number;
  readonly neutralShare: number;
  /** Net-helpful minus net-harmful, in rules. */
  readonly net: number;
  /**
   * Range of the artefact's instance-weighted harmful share across runs.
   *
   * A range rather than an average: the runs differ in size, the artefact does not carry the instance
   * total needed to weight them, and an unweighted mean of shares would give the sixty-question pilot
   * the same weight as a 350-question run.
   */
  readonly harmfulInstanceRange: { readonly low: number; readonly high: number };
  /** Two-sided exact binomial sign test over the rules whose net effect was not zero. */
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
  let injectedRules = 0;
  let helpfulRules = 0;
  let harmfulRules = 0;
  let neutralRules = 0;
  for (const entry of runs) {
    rules += entry.rules;
    injectedRules += entry.injectedRules;
    helpfulRules += entry.helpfulRules;
    harmfulRules += entry.harmfulRules;
    neutralRules += entry.neutralRules;
  }
  const shares = runs.map((entry) => entry.harmfulInstanceShare);
  return {
    runs: runs.length,
    rules,
    injectedRules,
    helpfulRules,
    harmfulRules,
    neutralRules,
    injectedShare: shareOf(injectedRules, rules),
    helpfulShare: shareOf(helpfulRules, injectedRules),
    harmfulShare: shareOf(harmfulRules, injectedRules),
    neutralShare: shareOf(neutralRules, injectedRules),
    net: helpfulRules - harmfulRules,
    harmfulInstanceRange: {
      low: shares.length === 0 ? 0 : Math.min(...shares),
      high: shares.length === 0 ? 0 : Math.max(...shares),
    },
    // Exact, and over the rules whose net effect had a sign: with none of them there is no sign to
    // test, and the honest answer is that nothing moved.
    p: helpfulRules + harmfulRules === 0 ? 1 : mcnemarExact(helpfulRules, harmfulRules),
    perRun: runs,
  };
}
