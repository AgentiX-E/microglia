/**
 * The transfer measurement, on a second scenario.
 *
 * ## What a transfer trial is here, and why it is not the BIRD one
 *
 * On BIRD a trial is one rule pointed at one foreign question, with two calls: the question without
 * the rule and the question with it. The τ² lane has neither per-rule calls nor a counterfactual
 * retry inside an episode — the treatment is the whole pack and each episode is scored once — so the
 * pair the transfer gates reconcile is `(reference verdict, memory verdict)` for one `(task, trial)`.
 *
 * That is a weaker unit than BIRD's and the difference is stated rather than hidden: one rule is
 * measured there, one store is measured here, so `repaired > 0` says the pack fixed an episode and
 * says nothing about which item in it did. What survives is the part the gates were written for —
 * the net marginal effect over the episodes a deployment would actually see, with the break side
 * counted rather than folded into a conditional rate that cannot go down.
 *
 * ## The three mappings that have to be exact
 *
 * 1. **A hole is a hole.** A `null` reward is what τ² writes for an infrastructure failure, and both
 *    sides must resolve it to `undefined`. Folding it into `false` files the episode under "the
 *    pack failed", which credits or blames the memory for a call that never returned.
 * 2. **The reference arm is the control.** `blankCorrect` is the arm without the store. Reversing it
 *    would publish the treatment as its own control and report a rate with no denominator.
 * 3. **One row per trial, including the holes.** `V33` fails a run whose rate arrived without its
 *    pairs, and a ledger that dropped an unmeasured episode could not reconcile with `trials`.
 *
 * The arithmetic is `transferSummary` — the same function the BIRD lane publishes through — rather
 * than a τ² copy of it. Two implementations of one statistic diverge the first time one is fixed.
 */
import type { TransferGateInput } from '@agentix-e/microglia-protocol';
import { transferSummary, type TransferSummary, type TransferTrial } from './rule-probe.js';
import { qualifiedId } from './tau2-plan.js';

/** One episode's verdict, as the arm artefacts carry it. */
export type TauTrialRow = {
  /** Scenario-qualified task id, so two scenarios' tasks cannot collide. */
  readonly id: string;
  readonly trial: number;
  /** `1` passed, anything else failed, `null` unscored. */
  readonly reward: number | null;
};

/** One ledger row: the episode, and both arms' verdicts on it. */
export type PackTransferEpisode = {
  readonly task: string;
  readonly trial: number;
  /** The reference arm's verdict; `undefined` when it has none. */
  readonly blankCorrect: boolean | undefined;
  /** The memory arm's verdict; `undefined` when it has none. */
  readonly withMemoryCorrect: boolean | undefined;
};

export type PackTransferReading = {
  /** The trials the shared summary is computed over, in the reference arm's order. */
  readonly rows: readonly TransferTrial[];
  readonly summary: TransferSummary;
  /** The same pairs with the trial number kept, which is what the artefact's ledger carries. */
  readonly episodes: readonly PackTransferEpisode[];
  /** The four gates' input, built from the summary rather than beside it. */
  readonly gate: TransferGateInput;
  /** Episodes both arms scored: the denominator every marginal is over. */
  readonly paired: number;
  /** Treatment episodes the control never ran. Should be zero; counted so it can be asserted. */
  readonly orphanMemory: number;
};

/**
 * One arm's parsed trials, named the way the record names them.
 *
 * The qualification happens here rather than at the projection because the two arms must be named
 * identically for a pair to exist at all, and an artefact that named its tasks one way and its
 * ledger another would pair nothing while reporting a denominator.
 */
export function trialRowsOf(
  trials: readonly { readonly taskId: string; readonly trial: number; readonly reward: number | null }[],
  scenario: string,
): readonly TauTrialRow[] {
  return trials.map((trial) => ({
    id: qualifiedId(scenario, trial.taskId),
    trial: trial.trial,
    reward: trial.reward,
  }));
}

/** The key one `(task, trial)` pair is filed under. */
export function pairKey(id: string, trial: number): string {
  return `${id}\u0000${String(trial)}`;
}

/** τ²'s own rule: a trial passes at exactly `1`, and `null` is not a verdict. */
function verdictOf(reward: number | null): boolean | undefined {
  return reward === null ? undefined : reward === 1;
}

export function transferReadingOf(input: {
  readonly reference: readonly TauTrialRow[];
  readonly memory: readonly TauTrialRow[];
  /** The store the pack was built from, which names the treatment in the ledger. */
  readonly store: string;
}): PackTransferReading {
  const treatment = new Map<string, TauTrialRow>();
  for (const row of input.memory) {
    const key = pairKey(row.id, row.trial);
    if (treatment.has(key)) {
      throw new Error(`the treatment arm has two verdicts for ${row.id} trial ${String(row.trial)}`);
    }
    treatment.set(key, row);
  }

  const seen = new Set<string>();
  const rows: TransferTrial[] = [];
  const episodes: PackTransferEpisode[] = [];
  for (const row of input.reference) {
    const key = pairKey(row.id, row.trial);
    seen.add(key);
    const partner = treatment.get(key);
    const blankCorrect = verdictOf(row.reward);
    const withMemoryCorrect = partner === undefined ? undefined : verdictOf(partner.reward);
    rows.push({
      itemId: `pack@${input.store}`,
      targetId: row.id,
      blankCorrect,
      withRuleCorrect: withMemoryCorrect,
    });
    episodes.push({ task: row.id, trial: row.trial, blankCorrect, withMemoryCorrect });
  }

  const summary = transferSummary(rows);
  return {
    rows,
    summary,
    episodes,
    paired: summary.measured,
    orphanMemory: input.memory.filter((row) => !seen.has(pairKey(row.id, row.trial))).length,
    gate: {
      trials: rows.length,
      informative: summary.informative,
      repaired: summary.repaired,
      blankRight: summary.blankRight,
      // A subset of `unmeasured`, named separately because it is the denominator's own absence
      // rather than the treatment's: `V15` reports the two apart.
      unmeasured: summary.unmeasured,
      ...(summary.unmeasuredBlank === 0 ? {} : { unmeasuredBlank: summary.unmeasuredBlank }),
      ledger: episodes.length,
      measured: summary.measured,
      broke: summary.broke,
      netPp: summary.netPp,
      verdict: summary.verdict,
    },
  };
}
