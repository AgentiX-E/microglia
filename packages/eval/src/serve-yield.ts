/**
 * What a served record could have done, before asking what it did.
 *
 * ## The denominator R129 kept missing
 *
 * Every outcome counter this record has considered — quarantine the net-negative item, retire the record that
 * never repaired — was refused on the same ground: at the sample sizes the lane reaches, an item served once or
 * twice produces a number that cannot be told from the lane's own base rate. R138 read that as "recurrence is
 * the missing piece"; R141 produced the recurrence (one record rendered nine times) and the counter still could
 * not act, because **recurrence is not the denominator**.
 *
 * The denominator is *opportunity*. A memory can only repair a trial the bare agent got wrong, and it can only
 * break one the bare agent got right. On R141 the reference arm passed 33 of 40 trials, so **34 of the 40
 * renders landed where nothing could be repaired** — and a record rendered nine times inside that population
 * has a expected repair count of 9 × 0.175 ≈ 1.6, which zero repairs does not contradict. A counter that
 * divides repairs by renders is measuring the corpus's difficulty, not the record.
 *
 * So this module states three counts per record — renders, opportunities, repairs — and then the only statistic
 * that can carry a decision: a **one-sided binomial tail** of the record's repair count against the lane's own
 * repair rate per opportunity. A record with one render has a tail of ~1 and can never be quarantined; that is
 * R138's own objection, now refused by construction rather than by argument.
 *
 * ## What it is not
 *
 * It is not a score. Repairing nothing at nine opportunities is evidence, not proof: at α = 0.05 with a base
 * rate of 0.175, a record needs roughly **eleven** opportunities before zero repairs is distinguishable from
 * bad luck, and τ² retail at 40 held-out tasks does not produce eleven opportunities per record. The census says
 * so in `candidates` being empty rather than in a footnote.
 */

import { logBinomialPmf } from '@agentix-e/microglia-core';

/**
 * One render: a record put in front of an episode, and what that episode did with and without it.
 *
 * `task` is **attribution and never a count**. This field was withheld for two rounds on the argument that an
 * id invites a second de-duplication at a different grain, and two grains of one count are two answers. The
 * argument is sound and the withholding was still wrong: without the id the census cannot say whether the
 * harm landed on one task of a hundred or one trial of a hundred, which are different diseases
 * (`serveTaskCensus` in `serve-tasks.ts`). So the field exists, the counting census ignores it, and the suite
 * asserts that `serveYieldCensus` produces an identical table with and without it — the guard the comment
 * could not be.
 *
 * Absent on an artefact written before the id was carried. A census that reads such an artefact reports the
 * renders it could not attribute rather than leaving them out of its own total.
 */
export type ServeRender = {
  readonly itemId: string;
  /** Whether the reference arm — the same task without a memory — passed. */
  readonly controlPassed: boolean;
  readonly memoryPassed: boolean;
  /** The task this render was served into, for attribution only: no rate in this module divides by it. */
  readonly task?: string;
};

export type ServeYieldItem = {
  readonly itemId: string;
  readonly renders: number;
  /** Renders on a trial the reference arm failed: the only population a repair can come from. */
  readonly opportunity: number;
  readonly repairs: number;
  readonly breaks: number;
  /** Renders that changed nothing, whether because the trial passed either way or failed either way. */
  readonly inert: number;
  /**
   * `P(X ≤ repairs)` under the lane's own rate per opportunity, which is what a quarantine would test.
   *
   * 1 when the record had no opportunity at all: nothing it could have repaired, so nothing it failed to.
   */
  readonly inertP: number;
};

export type ServeYieldCensus = {
  readonly renders: number;
  readonly opportunity: number;
  readonly repairs: number;
  readonly breaks: number;
  readonly inert: number;
  /** Repairs per opportunity, which is the rate the tails are taken against. */
  readonly repairRate: number;
  readonly items: readonly ServeYieldItem[];
  /** Records whose repair count is below that rate at `alpha`; empty when the sample cannot separate one. */
  readonly candidates: readonly string[];
  /** Opportunities a record needs before zero repairs is evidence at this rate and this alpha. */
  readonly opportunitiesForEvidence: number;
};

/**
 * The lower tail of a binomial, summed in log space.
 *
 * `logBinomialPmf` is the core's own formula rather than a second one, for the reason `mcnemarExact` gives: two
 * implementations of one quantity produce two answers, and the disagreement surfaces as a gate that passes what
 * the audit rejects. Only the summation is local, and it uses the same max-shift trick the core's own
 * `logSumExp` does so that a tail of ten thousand terms does not underflow to zero.
 */
function lowerTail(n: number, observed: number, p: number): number {
  if (n <= 0) return 1;
  // No guard on `p`: the core's own pmf is `-Infinity` for `k > 0` when `p` is zero and zero at `k = 0`, so a
  // store that repaired nothing yields a tail of one without a branch that says so — one formulation of the
  // arithmetic rather than two, which is the rule this module's doc comment states for every statistic in it.
  // Summed directly rather than through a max-shift. The shift exists to stop a long tail from underflowing,
  // and these tails are short by construction: `n` is the opportunities one record was given on one corpus, so
  // the smallest term here is around `exp(-n)`, which stays representable far past any n this lane reaches. A
  // shift would also reintroduce the `-Infinity - -Infinity` degeneracy it was invented to avoid, on exactly the
  // case a store that repaired everything it was offered produces.
  let sum = 0;
  for (let k = 0; k <= Math.min(observed, n); k += 1) sum += Math.exp(logBinomialPmf(n, k, p));
  return Math.min(1, sum);
}

/**
 * The fewest opportunities at which a record that repaired nothing is evidence at `alpha`.
 *
 * The smallest `n` with `P(X = 0) = (1 − p)^n ≤ alpha`, which is the question a quarantine actually asks. It is
 * computed rather than tabulated because the rate is the corpus's, not a constant: a corpus that repairs 40% of
 * its opportunities needs four, and one that repairs 17.5% needs seventeen.
 */
export function opportunitiesForEvidence(rate: number, alpha = 0.05): number {
  if (!(rate > 0) || rate >= 1) return Number.POSITIVE_INFINITY;
  return Math.ceil(Math.log(alpha) / Math.log(1 - rate));
}

export function serveYieldCensus(renders: readonly ServeRender[], alpha = 0.05): ServeYieldCensus {
  const perItem = new Map<string, { renders: number; opportunity: number; repairs: number; breaks: number; inert: number }>();
  let opportunities = 0;
  let repairs = 0;
  let breaks = 0;
  for (const render of renders) {
    const row = perItem.get(render.itemId) ?? { renders: 0, opportunity: 0, repairs: 0, breaks: 0, inert: 0 };
    row.renders += 1;
    if (!render.controlPassed) {
      row.opportunity += 1;
      opportunities += 1;
      if (render.memoryPassed) {
        row.repairs += 1;
        repairs += 1;
      } else {
        row.inert += 1;
      }
    } else if (!render.memoryPassed) {
      row.breaks += 1;
      breaks += 1;
    } else {
      row.inert += 1;
    }
    perItem.set(render.itemId, row);
  }

  const repairRate = opportunities === 0 ? 0 : repairs / opportunities;
  const items = [...perItem]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([itemId, row]) => ({
      itemId,
      renders: row.renders,
      opportunity: row.opportunity,
      repairs: row.repairs,
      breaks: row.breaks,
      inert: row.inert,
      inertP: lowerTail(row.opportunity, row.repairs, repairRate),
    }));

  return {
    renders: renders.length,
    opportunity: opportunities,
    repairs,
    breaks,
    inert: renders.length - repairs - breaks,
    repairRate,
    items,
    candidates: items.filter((item) => item.inertP <= alpha).map((item) => item.itemId),
    opportunitiesForEvidence: opportunitiesForEvidence(repairRate, alpha),
  };
}

/**
 * The census as one line, in the shape the rest of the lane prints.
 *
 * The inert share is the number this exists for: it is the fraction of the money's renders that could not have
 * changed the answer, and it is what makes a per-render repair rate a statement about the corpus.
 */
export function serveYieldLine(census: ServeYieldCensus): string {
  if (census.renders === 0) return 'serve yield: no render was made, so no yield can be read';
  const share = (value: number): string => `${(value * 100).toFixed(2)}%`;
  // A store that repaired every opportunity it was offered has no evidence threshold at all: (1 − 1)^n is zero
  // for every n, so no sample can distinguish a record that repaired nothing from bad luck. Saying `Infinity`
  // would print a number the reader can only misread, so the sentence states the fact instead.
  const threshold = Number.isFinite(census.opportunitiesForEvidence)
    ? `a record needs ${String(census.opportunitiesForEvidence)} opportunities before zero repairs is evidence`
    : 'no number of opportunities separates a record at this rate, because every opportunity was repaired';
  const candidates =
    census.candidates.length === 0
      ? `no record is below its own rate at 5% (${threshold})`
      : `${String(census.candidates.length)} record(s) below their own rate at 5%: ${census.candidates.join(', ')}`;
  return (
    `serve yield: ${String(census.renders)} render(s) over ${String(census.items.length)} record(s); ` +
    `${String(census.opportunity)} landed where a repair was possible (${share(census.opportunity / census.renders)}); ` +
    `${String(census.repairs)} repaired, ${String(census.breaks)} broke, ` +
    `${String(census.inert)} inert (${share(census.inert / census.renders)}); ${candidates}`
  );
}
