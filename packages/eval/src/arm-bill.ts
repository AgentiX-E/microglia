/**
 * An arm's bill, and the difference between a zero and a silence.
 *
 * R198 was registered because the τ² lane could report accuracy for a third time and still no price:
 * `bin/l4.ts` wrote `calls: 0` as a **literal** on every arm, while the driver below it had been
 * counting provider calls since R103. Two facts made that worse than untidy.
 *
 *  - The pair step reads `tau2.usage.calls` and the arm step read nothing, so the two files disagreed
 *    about one run: an artefact that said `calls: 0` beside a `tau2.usage.calls` of 2,667 gave a reader
 *    two answers and no way to tell which one was measured.
 *  - A re-scored document — the only path that works without an agent environment — carried no arm
 *    record at all, so the cost axis was `0` there for a structural reason rather than a measured one.
 *
 * A bill therefore has **three** states, not two, and the whole point of this module is that a reader
 * can tell them apart without a footnote:
 *
 *  - `census` — a phase printed what the provider charged it. Calls and tokens are measured.
 *  - `count` — an artefact recorded a call count but no census. Calls are measured; tokens are not,
 *    and are absent rather than zero.
 *  - `absent` — nothing was recorded. `calls` is `0` because there is no number to carry, which is
 *    **not** the statement that the arm made no calls.
 *
 * `count` exists because artefacts written before this module carry `calls` and nothing else, and
 * treating their number as a census would put a measured call count beside an invented token vector.
 * A recorded `calls: 0` is deliberately read as `absent`: that is the literal this module exists to
 * stop quoting, and no artefact in the lane has ever measured a zero it could prove.
 */

import type { Tau2PhaseUsage } from './tau2-instrument.js';

/** How this arm's call count came to be known. Never inferred from the number alone. */
export type BillSource = 'census' | 'count' | 'absent';

export type ArmBill = {
  /** The provider's call count when it is known, `0` when nothing is. See `source`. */
  readonly calls: number;
  readonly source: BillSource;
  /** Absent when the source is not a census, because a count carries no token vector. */
  readonly promptTokens?: number;
  readonly completionTokens?: number;
  readonly uncachedTokens?: number;
};

function counted(value: number | null | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/**
 * The bill of an arm, from its census when it has one and from its recorded count when it does not.
 *
 * `recorded` is the artefact's own top-level `calls`, which is the only channel a pre-R198 arm has.
 */
export function armBillOf(usage?: Tau2PhaseUsage, recorded?: number): ArmBill {
  const calls = counted(usage?.calls);
  if (calls !== undefined) {
    const promptTokens = counted(usage?.prompt_tokens);
    const completionTokens = counted(usage?.completion_tokens);
    const uncachedTokens = counted(usage?.uncached_tokens);
    return {
      calls,
      source: 'census',
      ...(promptTokens === undefined ? {} : { promptTokens }),
      ...(completionTokens === undefined ? {} : { completionTokens }),
      ...(uncachedTokens === undefined ? {} : { uncachedTokens }),
    };
  }
  const fallback = counted(recorded);
  if (fallback !== undefined && fallback > 0) return { calls: fallback, source: 'count' };
  return { calls: 0, source: 'absent' };
}

/**
 * The bill of an arm *artefact*, in any of the shapes the lane has written.
 *
 * Three writers, one reading order: the root `usage` block (R198 onward, on every lane), then
 * `tau2.usage` (R103's projection, kept for readers written before R198), then the top-level `calls`
 * (every artefact, and the only channel a pre-R103 one has). The census wins over the count because a
 * summary must not overwrite the measurement it summarises.
 */
export function artefactBillOf(artefact: {
  readonly calls?: number;
  readonly usage?: Tau2PhaseUsage | undefined;
  readonly tau2?: { readonly usage?: Tau2PhaseUsage } | undefined;
}): ArmBill {
  return armBillOf(artefact.usage ?? artefact.tau2?.usage, artefact.calls);
}

/**
 * The bill as numbers a reader of an artefact can divide by.
 *
 * `usage_absent` and `usage_counted` are both always written, because one flag cannot carry three
 * states: `0/0` is a census, `0/1` is a count, `1/0` is silence. Writing only the absent flag would
 * make a count and a census indistinguishable, which is the defect this module exists to remove.
 */
export function armBillMetrics(bill: ArmBill): Record<string, number> {
  return {
    usage_absent: bill.source === 'absent' ? 1 : 0,
    usage_counted: bill.source === 'count' ? 1 : 0,
    ...(bill.promptTokens === undefined ? {} : { prompt_tokens: bill.promptTokens }),
    ...(bill.completionTokens === undefined ? {} : { completion_tokens: bill.completionTokens }),
    ...(bill.uncachedTokens === undefined ? {} : { uncached_tokens: bill.uncachedTokens }),
  };
}

/**
 * One line, for a note or a log, that says which of the three states this bill is in.
 *
 * A sentence rather than a number because the three states differ by what they *mean*: an arm that
 * made no calls and an arm nobody counted both print `0`, and only a sentence can tell them apart.
 */
export function armBillLine(bill: ArmBill, subject = 'Bill'): string {
  if (bill.source === 'census') {
    const tokens =
      bill.promptTokens === undefined
        ? 'the phase printed no token totals'
        : `${String(bill.promptTokens)} prompt token(s)${bill.uncachedTokens === undefined ? '' : ` of which ${String(bill.uncachedTokens)} uncached`}${
            bill.completionTokens === undefined ? '' : `, ${String(bill.completionTokens)} completion token(s)`
          }`;
    return `${subject} (census): ${String(bill.calls)} provider call(s), ${tokens}.`;
  }
  if (bill.source === 'count') {
    return `${subject} (count only): ${String(bill.calls)} provider call(s) recorded; the artefact carries no token census, so its tokens are unmeasured rather than zero.`;
  }
  return `${subject}: unmeasured. No census and no recorded count reached this artefact, so \`calls: 0\` means "nobody counted", not "the arm made no calls".`;
}
