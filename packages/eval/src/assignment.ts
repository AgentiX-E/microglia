/**
 * Whether showing one rule instead of two is an improvement, decided by assignment.
 *
 * R35 closed the store and left two levers, both of them designs: the grain at which memory is
 * written, and the number of items a prompt carries. It also left one number above zero — the
 * pack-size contrast, +3.13pp [+0.62, +5.23] on the dev split — recorded as a lead because retrieval
 * assigns pack size and the questions served a single rule are harder.
 *
 * The lane has carried an arm that assigns it since R25: the same retrieval, the same order, the
 * first item and no second one, built from the pack `full` carries so that the two prompts differ in
 * exactly one field. R25 reported it as a dose control. This module reads it as a test, and it adds
 * the two readings R25 did not have:
 *
 *  1. **The hurdle.** R34 established that repairs sit on a base of questions the bare model got
 *     wrong and breaks on a base it got right, so the rate at which an arm breaks even is the bare
 *     model's odds rather than parity. A delta in percentage points cannot say whether an arm that
 *     is a wash in accuracy is closer to or further from paying.
 *  2. **The marginal item.** The difference between the two arms is a single rule, so the contrast
 *     decomposes into the repairs the second rule carries and the breaks it saves. That ratio is what
 *     "capping the pack at one" actually removes, and no round has computed it.
 *
 * The module holds no model call and no free parameter: every number is a function of the committed
 * per-case outcomes. The thresholds live in `R36_BARS`, in one place, because a bar that drifts
 * between the registration and the reading is how a null becomes a finding.
 */
import { comparePaired, clusterBootstrapCI } from './stats.js';
import { exchangeOf, type ExchangeReading } from './admission.js';

/** One question under the two arms the round compares. */
export type AssignmentCase = {
  readonly id: string;
  readonly dbId: string;
  /** The cross-fitting fold the question was held out in, when the artefact records one. */
  readonly fold?: number;
  /** The bare model, for the exchange reading only: it is the base both arms sit on. */
  readonly bare: boolean;
  /** `full`: the pack retrieval returned. */
  readonly kept: boolean;
  /** `full-one`: the same pack cut to its first item. */
  readonly removed: boolean;
};

/** The bars `prereg/R36-pack-assignment.md` fixed before the replication was dispatched. */
export const R36_BARS = {
  /** P1: the split the registration describes, and the share of prompts truncation has to touch. */
  minQuestions: 1_500,
  minDatabases: 10,
  minChangedShare: 0.7,
  /** P2: two implementations of one contrast agree to this, or one of them is wrong. */
  tolerancePp: 0.01,
  /** P4: what the second item has to be worth per break it introduces. */
  minMarginalHelpPerHarm: 2,
  /**
   * P5: R25's own registered threshold for this arm, reused rather than chosen here.
   *
   * The two rounds have to mean the same thing by "it works"; a fresh number would let this round
   * claim a result the previous one had already defined as too small to count.
   */
  materialPp: 2,
} as const;

/**
 * What the second item does, counted on the four cells the two arms can disagree in.
 *
 * The cells are split by the base each question sits on, because a repair and a break are not the same
 * event: `repairs*` are questions the bare model got wrong and one arm fixed, `breaks*` are questions
 * it got right and one arm broke. The truncation's net change is the sum of the four with the signs a
 * reader expects, and it must equal the paired contrast's delta — the module's own test is that it does.
 */
export type MarginalReading = {
  /** The single rule repaired it and the pair did not: a repair the second item prevents. */
  readonly repairsGained: number;
  /** The pair repaired it and the single rule did not: a repair the second item carries. */
  readonly repairsLost: number;
  /** The single rule broke it and the pair did not: a break the second item prevents. */
  readonly breaksGained: number;
  /** The pair broke it and the single rule did not: a break the second item causes. */
  readonly breaksSaved: number;
  /** The truncation's net change in correct answers, so a negative number is a loss for it. */
  readonly netChange: number;
  /**
   * The second item's repairs over the breaks it causes.
   *
   * `null` when it caused no break: a ratio with no denominator is not zero, and calling it zero would
   * make the best item this corpus could hold look like the worst.
   */
  readonly helpPerHarm: number | null;
};

/** One arm's exchange rate, named so a table can be read without the caller knowing the order. */
export type ArmExchange = {
  readonly arm: 'bare' | 'kept' | 'removed';
  readonly items: string;
  readonly exchange: ExchangeReading;
};

export type AssignmentReading = {
  readonly n: number;
  readonly databases: number;
  /** Questions the two arms answered differently, which is what the contrast is estimated from. */
  readonly discordant: number;
  readonly discordantShare: number;
  readonly contrast: {
    /** The single rule right where the pair was wrong. */
    readonly gained: number;
    /** The pair right where the single rule was wrong. */
    readonly lost: number;
    readonly deltaPp: number;
    /** Per-question resampling, the lane's own convention. */
    readonly iidLowPp: number;
    readonly iidHighPp: number;
    /** Databases resampled, which is the interval the registration reads. */
    readonly clusteredLowPp: number;
    readonly clusteredHighPp: number;
    readonly p: number;
  };
  readonly arms: { readonly bare: ArmExchange; readonly kept: ArmExchange; readonly removed: ArmExchange };
  readonly marginal: MarginalReading;
};

/**
 * Read the two arms as an assignment test.
 *
 * `resamples` is explicit for the reason the lane's protocol fixes it everywhere: an interval at a
 * default nobody wrote down makes two reports incomparable, and the clustered interval is the one a
 * decision is made on.
 */
export function assignmentOf(
  cases: readonly AssignmentCase[],
  options: { readonly resamples?: number; readonly seed?: number } = {},
): AssignmentReading {
  const n = cases.length;
  const kept = cases.map((entry) => entry.kept);
  const removed = cases.map((entry) => entry.removed);
  const paired = comparePaired(kept, removed, options.seed ?? 12345, options.resamples ?? 10_000);
  const deltas = removed.map((hit, at) => (hit ? 1 : 0) - (kept[at] === true ? 1 : 0));
  const clustered = clusterBootstrapCI(
    deltas,
    cases.map((entry) => entry.dbId),
    options.resamples ?? 10_000,
    options.seed ?? 12345,
  );

  let repairsGained = 0;
  let repairsLost = 0;
  let breaksGained = 0;
  let breaksSaved = 0;
  for (const entry of cases) {
    // The arms agreeing contributes nothing to any cell, and the base decides what a disagreement
    // means: on a question the bare model missed it is a repair, on one it answered it is a break.
    if (entry.kept === entry.removed) continue;
    if (entry.bare) {
      if (entry.kept) breaksGained += 1;
      else breaksSaved += 1;
    } else if (entry.kept) {
      repairsLost += 1;
    } else {
      repairsGained += 1;
    }
  }

  const exchangeFor = (arm: 'bare' | 'kept' | 'removed'): ExchangeReading =>
    exchangeOf(
      cases.map((entry) => ({
        correct: arm === 'bare' ? entry.bare : entry[arm],
        withoutMemoryCorrect: entry.bare,
      })),
    );

  return {
    n,
    databases: new Set(cases.map((entry) => entry.dbId)).size,
    discordant: paired.lost + paired.gained,
    discordantShare: n === 0 ? 0 : (paired.lost + paired.gained) / n,
    contrast: {
      gained: paired.gained,
      lost: paired.lost,
      deltaPp: paired.delta * 100,
      iidLowPp: paired.deltaCI.low * 100,
      iidHighPp: paired.deltaCI.high * 100,
      clusteredLowPp: clustered.low * 100,
      clusteredHighPp: clustered.high * 100,
      p: paired.p,
    },
    arms: {
      bare: { arm: 'bare', items: 'none', exchange: exchangeFor('bare') },
      kept: { arm: 'kept', items: 'the pack retrieval returned', exchange: exchangeFor('kept') },
      removed: { arm: 'removed', items: 'the same pack, first item only', exchange: exchangeFor('removed') },
    },
    marginal: {
      repairsGained,
      repairsLost,
      breaksGained,
      breaksSaved,
      netChange: repairsGained + breaksSaved - repairsLost - breaksGained,
      helpPerHarm: breaksSaved === 0 ? null : repairsLost / breaksSaved,
    },
  };
}

/**
 * The four cells and the contrast, one row per cross-fitting fold.
 *
 * The interaction is the round's claim, and a claim about a mechanism has to survive being measured
 * fold by fold: a store is distilled per fold, so a cross-term that appears in one fold and not the
 * others is a property of that store rather than of packs. Grouped rather than pooled because pooling
 * is what would hide exactly that.
 */
export type FoldReading = {
  readonly fold: number;
  readonly questions: number;
  readonly repairsGained: number;
  readonly repairsLost: number;
  readonly breaksGained: number;
  readonly breaksSaved: number;
  readonly netChange: number;
  readonly deltaPp: number;
};

export function foldsOf(cases: readonly AssignmentCase[]): readonly FoldReading[] {
  const byFold = new Map<number, AssignmentCase[]>();
  for (const entry of cases) {
    const key = entry.fold ?? 0;
    const bucket = byFold.get(key) ?? [];
    bucket.push(entry);
    byFold.set(key, bucket);
  }
  return [...byFold.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([fold, bucket]) => {
      const reading = assignmentOf(bucket);
      return {
        fold,
        questions: reading.n,
        repairsGained: reading.marginal.repairsGained,
        repairsLost: reading.marginal.repairsLost,
        breaksGained: reading.marginal.breaksGained,
        breaksSaved: reading.marginal.breaksSaved,
        netChange: reading.marginal.netChange,
        deltaPp: reading.contrast.deltaPp,
      };
    });
}

export type R36Verdict = {
  readonly id: 'P1' | 'P2' | 'P3' | 'P4' | 'P5';
  readonly claim: string;
  readonly observed: string;
  readonly holds: boolean;
};

export type R36Input = {
  readonly reading: AssignmentReading;
  /** What the arm carried, from the artefact's own pack-size metrics and gate. */
  readonly instrument: SlotBasis;
  /** The lane's own contrast for the same pair, when the artefact carries one. */
  readonly reported: { readonly deltaPp: number | null; readonly gained: number | null; readonly lost: number | null };
  /** A second store draw of the same arms, or `null` before it is run. */
  readonly replication: Pick<AssignmentReading, 'contrast'> | null;
};

const pp = (value: number | null): string => (value === null ? 'n/a' : `${value >= 0 ? '+' : ''}${value.toFixed(2)}pp`);
const num = (value: number | null, digits: number): string => (value === null ? 'n/a' : value.toFixed(digits));

/**
 * The five verdicts of `prereg/R36-pack-assignment.md`.
 *
 * P1–P4 are readings of a cell that existed before the registration and are reported as such; P5 is
 * the only blind test, and it is the one that decides the lever.
 */
export function adjudicateR36(input: R36Input): readonly R36Verdict[] {
  const { reading, instrument, reported, replication } = input;
  const { contrast, marginal, arms } = reading;
  const agreement =
    reported.deltaPp !== null &&
    Math.abs(contrast.deltaPp - reported.deltaPp) <= R36_BARS.tolerancePp &&
    reported.gained === contrast.gained &&
    reported.lost === contrast.lost;

  const profit = arms.removed.exchange.clearance;
  const pairProfit = arms.kept.exchange.clearance;

  return [
    {
      id: 'P1',
      claim: 'the arm is a truncation of the pack and nothing else: one item, on the split, over more than one database',
      observed:
        `${instrument.maxItemsPerPrompt} item(s) at most and ${num(instrument.meanItemsPerPrompt, 2)} on average; ` +
        `${instrument.changedShare === null ? 'an unrecorded share' : `${num(instrument.changedShare * 100, 1)}%`} of prompts differ from the pair, ` +
        `over ${reading.databases} databases and ${reading.n} questions`,
      holds:
        reading.n >= R36_BARS.minQuestions &&
        reading.databases >= R36_BARS.minDatabases &&
        instrument.changedShare !== null &&
        instrument.changedShare >= R36_BARS.minChangedShare &&
        instrument.maxItemsPerPrompt <= 1,
    },
    {
      id: 'P2',
      claim: 'the reading reproduces the lane\'s own contrast for the same pair, so the two implementations are one instrument',
      observed:
        reported.deltaPp === null
          ? 'the artefact carries no contrast for this pair'
          : `${pp(contrast.deltaPp)} [${pp(contrast.clusteredLowPp)}, ${pp(contrast.clusteredHighPp)}] against the lane's ${pp(reported.deltaPp)}; ${contrast.gained}/${contrast.lost} discordant against ${String(reported.gained)}/${String(reported.lost)}`,
      holds: agreement,
    },
    {
      id: 'P3',
      claim: 'the one-rule pack does not clear the hurdle, and does not exchange better than the pair it was cut from',
      observed:
        `${num(profit, 3)} clearance on a hurdle of ${num(arms.removed.exchange.hurdle, 3)}, ` +
        `against ${num(pairProfit, 3)} for the pair; repair ${pp(arms.removed.exchange.repairRatePp)} and break ${pp(arms.removed.exchange.breakRatePp)} against ${pp(arms.kept.exchange.repairRatePp)} and ${pp(arms.kept.exchange.breakRatePp)}`,
      holds: profit !== null && pairProfit !== null && profit < 1 && profit < pairProfit,
    },
    {
      id: 'P4',
      claim: 'the second item is the one that pays: truncating removes more repairs than breaks',
      observed:
        `${marginal.repairsLost} repairs carried and ${marginal.breaksSaved} breaks caused, ` +
        `${num(marginal.helpPerHarm, 2)} repairs per break; it also prevents ${marginal.repairsGained} repairs and ` +
        `${marginal.breaksGained} breaks, for a net ${marginal.netChange >= 0 ? '+' : ''}${marginal.netChange} questions`,
      holds: marginal.helpPerHarm !== null && marginal.helpPerHarm > R36_BARS.minMarginalHelpPerHarm,
    },
    {
      id: 'P5',
      claim: `the null replicates on a fresh store: the truncation stays below +${String(R36_BARS.materialPp)}pp`,
      observed:
        replication === null
          ? `no replication yet; the threshold this will be read against is +${String(R36_BARS.materialPp)}pp`
          : `replication ${pp(replication.contrast.deltaPp)} [${pp(replication.contrast.clusteredLowPp)}, ${pp(replication.contrast.clusteredHighPp)}] against a +${String(R36_BARS.materialPp)}pp threshold: ` +
            (replication.contrast.clusteredHighPp < R36_BARS.materialPp
              ? 'the lever is closed'
              : replication.contrast.clusteredLowPp >= R36_BARS.materialPp
                ? 'refuted — the lead survives assignment'
                : 'underpowered, and the sign is not read'),
      holds: replication !== null && replication.contrast.clusteredHighPp < R36_BARS.materialPp,
    },
  ];
}

/**
 * One per-question record of the lane's artefact, reduced to the four cells this round needs.
 *
 * `arms` is the lane's per-arm outcome map. A row without a cell for the named arm is **skipped and
 * counted**, not treated as a failure: an artefact from a dispatch that never asked for the arm would
 * otherwise be read as a truncation that broke every question it was never shown.
 */
export type AssignRow = {
  readonly id: string;
  readonly dbId: string;
  readonly fold?: number;
  readonly correct: boolean;
  readonly withoutMemoryCorrect: boolean;
  readonly arms?: Readonly<Record<string, boolean>> | null;
};

export function packAssignCasesOf(
  rows: readonly AssignRow[],
  arm = 'full-one',
): { readonly cases: readonly AssignmentCase[]; readonly skipped: number } {
  const cases: AssignmentCase[] = [];
  let skipped = 0;
  for (const row of rows) {
    const removed = row.arms?.[arm];
    if (removed === undefined) {
      skipped += 1;
      continue;
    }
    cases.push({
      id: row.id,
      dbId: row.dbId,
      ...(row.fold === undefined ? {} : { fold: row.fold }),
      bare: row.withoutMemoryCorrect,
      kept: row.correct,
      removed,
    });
  }
  return { cases, skipped };
}

/** Where the one-item claim came from, so a reader can weigh an artefact that predates the count. */
export type SlotBasis = {
  readonly maxItemsPerPrompt: number;
  readonly meanItemsPerPrompt: number;
  /** Share of prompts whose knowledge block differs from `full`'s, when the artefact recorded it. */
  readonly changedShare: number | null;
  readonly basis: 'count' | 'gate' | 'none';
};

/**
 * Whether the arm was a truncation, from the best evidence the artefact carries.
 *
 * Three sources, in order of directness: the lane's own per-prompt count (R36 onward), the lane's
 * gate for the same check (R25 to R35), and nothing. The last fails closed — an artifact that cannot
 * say whether the arm was a truncation cannot support a claim that it was one.
 */
export function singleSlotOf(input: {
  readonly over: number | null | undefined;
  readonly gatePassed: boolean | null;
  readonly meanItems: number | null;
  readonly differs: number | null;
  readonly questions: number;
}): SlotBasis {
  const meanItemsPerPrompt = input.meanItems ?? 0;
  const changedShare =
    input.differs === null || input.questions === 0 ? null : input.differs / input.questions;
  if (input.over !== null && input.over !== undefined) {
    return { maxItemsPerPrompt: input.over > 0 ? 2 : 1, meanItemsPerPrompt, changedShare, basis: 'count' };
  }
  if (input.gatePassed !== null) {
    return { maxItemsPerPrompt: input.gatePassed ? 1 : 2, meanItemsPerPrompt, changedShare, basis: 'gate' };
  }
  return { maxItemsPerPrompt: 2, meanItemsPerPrompt, changedShare, basis: 'none' };
}
