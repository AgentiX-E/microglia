/**
 * What a margin gate would have done, priced against the outcomes the run already paid for.
 *
 * ## The question the ladder could not answer
 *
 * `pack.margins.ladder` counts how many requests each rung would withhold. That prices a rung in advance
 * and cannot say **which** requests it withholds, and the only question a rung is chosen by is whether the
 * requests it withholds are the ones that did damage. R142 is the run that made the gap expensive: its
 * ladder read `0.10 → 23` and its outcome ledger read six breaks and four repairs, and nothing in the
 * artefact joined the two, so the honest answer to "would a rung have helped" was a second dispatch.
 *
 * It does not have to be. The artefact carries three arrays of one row per request in arrival order —
 * `pack.ledger` (which records were served), `pack.margins.perRequest` (the gate's own margin) and
 * `per_trial` (what the two arms scored) — and the episode join already exists for the attribution table.
 * A sweep over rungs is arithmetic over data the run has already bought, and it costs nothing at readback
 * time. This module is that arithmetic.
 *
 * ## What it estimates, and the premise it states
 *
 * A trial served at rung `r` keeps the outcome it measured. A trial withheld at rung `r` is estimated at
 * **its control outcome**, because the alternative to a served pack is the bare agent that produced the
 * control half of the pair — which is exactly what the arm's own reference run is. That is an estimate and
 * not a measurement: a model that has been shown a procedure and then not shown it is not the same model as
 * one that never saw it, and the estimator cannot see the difference. The line says `estimated` for that
 * reason, and the verdict on a rung still needs the dispatch that runs it.
 *
 * ## Why a rung and not a maximum
 *
 * The statistic this module reports is the **first rung at which no break survives**, with the repairs it
 * costs and the requests it silences. A maximum over rungs would be a parameter fitted to the sample it is
 * read from — the defect this record has refused in a dozen other places — while "the cheapest rung that
 * removes every break" is a question whose answer can be refuted by the next run: either the rung removes
 * the breaks again, or it does not.
 */
import type { ServeRender } from './serve-yield.js';

/**
 * A render with the gate's own decision attached.
 *
 * `margin` is absent when the arm carried no margin census at all — an artefact written before R135, or a
 * host that never asked for one — and `null` when the census was there and this record's requests were not
 * contested. The two are different facts and the sweep treats them differently: absent is unpriced (served
 * at every rung, because a gate with no measurement cannot have withheld anything), `null` is the same
 * behaviour but counted separately, because a store that serves one candidate per request is a store no
 * rung can act on and a reader should see that rather than infer it.
 */
export type PricedRender = ServeRender & {
  /** The highest margin among the requests of the episode that served this record. */
  readonly margin?: number | null;
};

/** One rung, priced. */
export type SweepRung = {
  readonly rung: number;
  /** Trials with at least one render still served at this rung. */
  readonly served: number;
  /** Trials whose every render the rung withholds. */
  readonly withheld: number;
  /**
   * Served trials that lost part of their pack rather than all of it.
   *
   * A pack of one record is the shape every arm of this lane serves, so this is zero there; it exists
   * because `packLimit` is a knob and a partially withheld trial is a state the estimator cannot price.
   */
  readonly partial: number;
  /** Repaired trials among the served, and broken ones. A withheld trial contributes to neither. */
  readonly kept: number;
  readonly broke: number;
  readonly net: number;
  /** `net` over every trial in the reading, which is the quantity a paired delta is also in. */
  readonly netPp: number;
};

/**
 * Whether the margin ranks a repair above a break, and how surprising that ranking is.
 *
 * The sweep answers "what would a rung withhold"; this answers the question underneath it — whether the
 * ranking carries any information about the outcome at all. `auc` is the probability that a randomly chosen
 * repaired trial carried a higher margin than a randomly chosen broken one, ties counted a half; `p` is the
 * exact one-sided permutation probability of a ranking at least that good when the outcome labels are
 * shuffled across the same margins.
 *
 * Exact rather than asymptotic, and bounded rather than approximated: the null is enumerated over every
 * labelling when the count of them is small enough to enumerate, and `p` is `null` with `enumerable: false`
 * when it is not. An asymptotic approximation on six breaks and four repairs would be a number about a
 * normal distribution that nobody believes, and the record's rule is that an absent reading is named rather
 * than replaced by one from another distribution.
 */
export type MarginRanking = {
  /** Priced trials that repaired, and priced trials that broke. Trials that did neither are not ranked. */
  readonly kept: number;
  readonly broke: number;
  /** `null` when one side is empty: a ranking needs two populations to compare. */
  readonly auc: number | null;
  /** Exact one-sided permutation probability, or `null` when the labellings were too many to enumerate. */
  readonly p: number | null;
  /** How many labellings the null has: always exact, whether or not they were walked. */
  readonly labellings: number;
  readonly enumerable: boolean;
};

/** The point estimate, from the two margin lists, with ties counted a half. */
function aucOf(kept: readonly number[], broke: readonly number[]): number | null {
  if (kept.length === 0 || broke.length === 0) return null;
  let credit = 0;
  for (const high of kept) {
    for (const low of broke) {
      if (high > low) credit += 1;
      else if (high === low) credit += 0.5;
    }
  }
  return credit / (kept.length * broke.length);
}

/** `n choose k`, in floating point: it is only ever compared against a cap. */
function choose(n: number, k: number): number {
  const smaller = Math.min(k, n - k);
  let value = 1;
  for (let step = 0; step < smaller; step += 1) value = (value * (n - step)) / (step + 1);
  return value;
}

/** The most labellings this will walk. Above it the exact null is not available and the reading says so. */
const ENUMERATION_CAP = 20000;

/**
 * The ranking, from the priced trials in a render list.
 *
 * Trials carrying no measured margin are **excluded** rather than pooled at zero: a trial whose margin was
 * never measured cannot be ranked against one that was, and the sweep already reports how many those were.
 * The unit is the trial and the margin is the trial's highest — the same aggregation the sweep prices rungs
 * with, so the two readings describe the same quantity.
 */
export function marginRanking(renders: readonly PricedRender[]): MarginRanking {
  return rankingOf(trialsOf(renders));
}

/** The ranking over trials already grouped, which is where the sweep reads it. */
function rankingOf(trials: readonly TrialGroup[]): MarginRanking {
  const kept: number[] = [];
  const broke: number[] = [];
  for (const trial of trials) {
    const margins = trial.margins.filter((margin): margin is number => typeof margin === 'number');
    // A trial served only at uncontested requests has no margin to rank: it is not evidence about whether
    // the ranking works, it is evidence that nothing competed.
    if (margins.length === 0) continue;
    const margin = Math.max(...margins);
    if (trial.kept) kept.push(margin);
    if (trial.broke) broke.push(margin);
  }
  const auc = aucOf(kept, broke);
  const labellings = choose(kept.length + broke.length, kept.length);
  const enumerable = auc !== null && labellings <= ENUMERATION_CAP;
  if (!enumerable) {
    return { kept: kept.length, broke: broke.length, auc, p: null, labellings, enumerable: false };
  }
  // The null: every way of choosing which of the pooled margins belonged to the repaired trials. Walking
  // the combinations rather than resampling, because there is no randomness in this question — the
  // margins and the outcomes are fixed, and the only thing in doubt is which label went where.
  const pool = [...kept, ...broke];
  const observed = auc as number;
  const size = kept.length;
  let atLeast = 0;
  let walked = 0;
  const pick = new Array<number>(size).fill(0);
  const walk = (depth: number, from: number): void => {
    if (depth === size) {
      const chosen: number[] = [];
      const rest: number[] = [];
      for (let index = 0; index < pool.length; index += 1) {
        if (pick.includes(index)) chosen.push(pool[index] as number);
        else rest.push(pool[index] as number);
      }
      const value = aucOf(chosen, rest) as number;
      walked += 1;
      if (value >= observed - 1e-12) atLeast += 1;
      return;
    }
    for (let index = from; index <= pool.length - (size - depth); index += 1) {
      pick[depth] = index;
      walk(depth + 1, index + 1);
    }
  };
  walk(0, 0);
  return {
    kept: kept.length,
    broke: broke.length,
    auc,
    // `walked` is the number of labellings, which is at least one whenever both populations are non-empty —
    // and a null `auc` above took the other branch — so there is no empty-walk case to report.
    p: atLeast / walked,
    labellings,
    enumerable: true,
  };
}

export type SweepReading = {
  /** Trials the sweep is over: one per task the renders were attributed to. */
  readonly trials: number;
  /** Trials whose renders carried no margin, served at every rung by construction. */
  readonly unpriced: number;
  /** The smallest rung that withholds every break and keeps at least one repair, or `null`. */
  readonly firstClean: SweepRung | null;
  readonly rows: readonly SweepRung[];
  /** Whether the margin orders a repair above a break, and how surprising that order is. */
  readonly ranking: MarginRanking;
};

/**
 * The rungs a sweep is priced at, unless a caller names its own.
 *
 * Deliberately the same list `MARGIN_RUNGS` prices the ladder at: a sweep on a different grid from the
 * census beside it would be two readings of one knob that a reader could not line up.
 */
export const SWEEP_RUNGS: readonly number[] = [0, 0.01, 0.02, 0.05, 0.08, 0.1, 0.15, 0.2, 0.25, 0.3];

/** One trial's renders, grouped. */
type TrialGroup = {
  readonly margins: readonly (number | null)[];
  readonly kept: boolean;
  readonly broke: boolean;
};

/**
 * Group renders into trials.
 *
 * A render with no `task` is refused rather than pooled: the sweep's unit is the trial, a gate acts on a
 * request and a request belongs to a trial, and a render whose trial is unknown can be neither served nor
 * withheld coherently. Refusing loudly is the same choice `itemTransfer` makes about a ledger row that is
 * not a list — a silent pool would produce a rate over a population nobody can name.
 */
function trialsOf(renders: readonly PricedRender[]): readonly TrialGroup[] {
  const byTask = new Map<string, { margins: (number | null)[]; kept: boolean; broke: boolean }>();
  for (const render of renders) {
    if (render.task === undefined) {
      throw new TypeError(
        'a margin sweep needs the trial each render was served into, and one render carries no task',
      );
    }
    const group = byTask.get(render.task) ?? { margins: [], kept: false, broke: false };
    group.margins.push(render.margin === undefined ? null : render.margin);
    if (render.memoryPassed && !render.controlPassed) group.kept = true;
    if (!render.memoryPassed && render.controlPassed) group.broke = true;
    byTask.set(render.task, group);
  }
  return [...byTask.values()];
}

/**
 * Price every rung against the outcomes, and name the first one that silences the harm.
 *
 * `rung` withholds a render when its margin is below the rung, which is the strict comparison `buildPack`
 * makes (`margin < rung` serves nothing). A trial is served while any of its renders survives, so the
 * counts are trials and not renders — the same population `serveYieldCensus` divides by, and the reason
 * `netPp` is comparable with the pair's own delta.
 */
export function marginSweep(
  renders: readonly PricedRender[],
  rungs: readonly number[] = SWEEP_RUNGS,
): SweepReading {
  const trials = trialsOf(renders);
  const ordered = [...rungs].sort((left, right) => left - right);
  const rows: SweepRung[] = [];
  for (const rung of ordered) {
    let served = 0;
    let partial = 0;
    let kept = 0;
    let broke = 0;
    for (const trial of trials) {
      const survivors = trial.margins.filter((margin) => margin === null || margin >= rung).length;
      if (survivors === 0) continue;
      served += 1;
      if (survivors < trial.margins.length) partial += 1;
      if (trial.kept) kept += 1;
      if (trial.broke) broke += 1;
    }
    rows.push({
      rung,
      served,
      withheld: trials.length - served,
      partial,
      kept,
      broke,
      net: kept - broke,
      // A reading over no trials has no rate: a `0` here would be a mean of nothing, the failure mode this
      // lane has repaired four times, so the arithmetic is stated once and the empty case is zero by
      // construction rather than by a branch.
      netPp: trials.length === 0 ? 0 : ((kept - broke) / trials.length) * 100,
    });
  }
  // Clean means the harm is gone **and** something is still served that repaired: a rung that withholds
  // everything is trivially clean and worthless, which is why the `kept > 0` clause is in the predicate
  // rather than in a reader's eye.
  const firstClean = rows.find((row) => row.broke === 0 && row.kept > 0) ?? null;
  return {
    trials: trials.length,
    unpriced: trials.filter((trial) => trial.margins.every((margin) => margin === null)).length,
    firstClean,
    rows,
    ranking: rankingOf(trials),
  };
}

/**
 * The sweep on one line.
 *
 * Two sentences, because the two questions are different: whether any rung is clean at all, and what the
 * cleanest rung costs. The table follows on the same line rather than in a block, for the reason every
 * other census in this lane prints on one line — a readback greps a log, and a block that has to be
 * reconstructed from context is a block that gets reconstructed wrongly.
 */
export function serveSweepLine(reading: SweepReading): string {
  if (reading.trials === 0) {
    return 'serve sweep: no trial carries a priced render, so no rung can be priced';
  }
  const table = reading.rows
    .map((row) => `${row.rung.toFixed(2)} ${String(row.netPp >= 0 ? '+' : '')}${row.netPp.toFixed(2)}`)
    .join(' / ');
  const clean =
    reading.firstClean === null
      ? 'no rung withholds every break and keeps a repair'
      : `the first rung that withholds every break is ${reading.firstClean.rung.toFixed(2)}, which keeps ` +
        `${String(reading.firstClean.kept)} repair(s) and serves ${String(reading.firstClean.served)} of ` +
        `${String(reading.trials)} trial(s)`;
  const unpriced =
    reading.unpriced === 0
      ? ''
      : `; ${String(reading.unpriced)} trial(s) carried no margin and are served at every rung`;
  return (
    `serve sweep (estimated, withholding is priced as the control outcome): ${clean}${unpriced}; ` +
    `${rankingLine(reading.ranking)}; net by rung ${table}`
  );
}

/**
 * Whether the ranking carries information, in one clause.
 *
 * The three states are kept apart for the reason every other census here keeps them apart: a ranking that
 * is indistinguishable from a shuffle, a ranking the exact null was too large to test, and a population with
 * no repairs or no breaks to rank at all are three different facts about a rung, and the difference decides
 * whether the sweep's clean rung means anything.
 */
export function rankingLine(ranking: MarginRanking): string {
  if (ranking.auc === null) {
    return ranking.kept === 0
      ? 'no repaired trial carries a margin, so the ranking has nothing to order'
      : 'no broken trial carries a margin, so the ranking has nothing to order';
  }
  const counts = `${String(ranking.kept)} repaired against ${String(ranking.broke)} broken`;
  const auc = `the margin orders a repair above a break at AUC ${ranking.auc.toFixed(3)}`;
  // `p === null` is exactly the state the walk did not reach: a null `auc` above took the other branch, so
  // the only way here with no p is a null too large to enumerate.
  if (ranking.p === null) {
    return `${auc} over ${counts}, and the exact null was not walked (${String(ranking.labellings)} labellings)`;
  }
  return `${auc} over ${counts}, exact p ${ranking.p.toFixed(3)} over ${String(ranking.labellings)} labelling(s)`;
}
