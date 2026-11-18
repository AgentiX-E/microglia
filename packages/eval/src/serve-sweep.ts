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

export type SweepReading = {
  /** Trials the sweep is over: one per task the renders were attributed to. */
  readonly trials: number;
  /** Trials whose renders carried no margin, served at every rung by construction. */
  readonly unpriced: number;
  /** The smallest rung that withholds every break and keeps at least one repair, or `null`. */
  readonly firstClean: SweepRung | null;
  readonly rows: readonly SweepRung[];
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
    `net by rung ${table}`
  );
}
