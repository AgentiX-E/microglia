/**
 * Which claim hurt which trial.
 *
 * Every gate this record has built asks whether a pack should be served: a coverage floor, a corroboration
 * floor, a margin between the top two candidates. None of them can answer the question R123a's transfer
 * ledger made unavoidable, and that ledger is the first same-run, same-store paired reading of the
 * memory's **direction** on the board:
 *
 *     transfer: 8 repaired, 12 broken of 160 measured (21 informative), net -2.50pp
 *
 * Twelve trials were made worse by a store that served four lines apiece. A gate cannot say which of those
 * lines did it, and lowering a threshold until the harm disappears is how a store becomes a placebo.
 *
 * The join is exact and needs three things the artefacts already carry:
 *
 *   - `pack.ledger` — the ids served at each request, in request order;
 *   - `per_trial` — each trial's reward, in the order the runner executed trials;
 *   - `memory.episodeStarts` — the request index at which each episode opened (R128).
 *
 * The third is the one that was missing, and it was missing for a reason worth stating: `recall` fires once
 * per episode, so 164 requests covered 160 episodes, and a join that assumed one request per episode would
 * be wrong from the fourth double-recall onwards — silently, and in a direction that attributes one episode's
 * claims to another's outcome.
 *
 * ## What this function does not claim
 *
 * An item that appears in a trial the memory lost is **not** proven to have caused the loss. A trial is a
 * trajectory of ten turns and the store served four lines into it; the honest reading of a negative count is
 * *this claim is present whenever the memory fails*, which is a screening criterion and not a verdict. The
 * verdict needs the arm this instrument makes cheap: withhold exactly that claim and re-run, which is the
 * ablation R128 registers. The distinction is the difference between a ranking and a cause, and the whole
 * reason this record has refused to rank two 40-task samples applies here at item granularity.
 */

import type { TauTrialRow } from './tau2-transfer.js';
import { wilsonInterval } from './reproduction.js';

/** One episode, as the analysis needs it: the requests it spent and how the two arms scored it. */
export type EpisodeOutcome = {
  /** Request index this episode opened at, from `memory.episodeStarts`. */
  readonly startsAt: number;
  /** Whether the memory arm passed, and whether the control did. */
  readonly memory: boolean;
  readonly control: boolean;
};

/** One item's record across the trials it was served into. */
export type ItemTransfer = {
  readonly id: string;
  /** Episodes the item was served into, where both arms were measured. */
  readonly episodes: number;
  /** Of those, the ones only the memory arm passed. */
  readonly kept: number;
  /** Of those, the ones only the control passed — the count a negative store shows. */
  readonly broke: number;
  /** `kept - broke`: positive is a claim that helped more often than it hurt. */
  readonly net: number;
};

/**
 * The per-item transfer table, worst net first.
 *
 * Ties break by id so two runs of the same artefacts print the same order: an analysis whose output order
 * depends on insertion order cannot be diffed between rounds.
 */
export function itemTransfer(input: {
  readonly episodes: readonly EpisodeOutcome[];
  readonly ledger: readonly (readonly string[])[];
  /** Requests with no episode behind them — a recall that fired outside any trial. Excluded, and counted. */
}): { readonly items: readonly ItemTransfer[]; readonly unmatchedRequests: number } {
  const ordered = [...input.episodes].sort((left, right) => left.startsAt - right.startsAt);
  const tallies = new Map<string, { episodes: number; kept: number; broke: number }>();
  let unmatchedRequests = 0;

  for (let index = 0; index < ordered.length; index += 1) {
    const episode = ordered[index] as EpisodeOutcome;
    const next = ordered[index + 1];
    const end = next === undefined ? input.ledger.length : Math.min(next.startsAt, input.ledger.length);
    const start = Math.min(episode.startsAt, input.ledger.length);
    // A repeated boundary is legal (`recall` that returned without a request leaves the index unchanged),
    // and an empty range is the correct reading of it: that episode spent no request of its own.
    if (end <= start) continue;
    // The union of the episode's served ids: a claim served twice into one trajectory is still one
    // observation of that trajectory, and counting it twice would weight a long episode's claims by how
    // often they happened to be rendered.
    const served = new Set<string>();
    for (let request = start; request < end; request += 1) {
      // `ledger` is one entry per request by construction and `end` is clamped to its length, so the
      // element exists: a `?? []` here was a branch no artefact could reach, which is the shape this
      // record deletes rather than exempts.
      for (const id of input.ledger[request] as readonly string[]) served.add(id);
    }
    for (const id of served) {
      const tally = tallies.get(id) ?? { episodes: 0, kept: 0, broke: 0 };
      tally.episodes += 1;
      if (episode.memory && !episode.control) tally.kept += 1;
      if (!episode.memory && episode.control) tally.broke += 1;
      tallies.set(id, tally);
    }
  }

  // Every request belongs to an episode by construction: `recall` opens one before it asks, and the last
  // boundary therefore covers the tail of the ledger. The only way a request is unattributed is a ledger
  // with no episodes at all — an arm that served packs outside the runner, which is a wiring finding rather
  // than an analysis one, so it is counted instead of dropped.
  unmatchedRequests = ordered.length === 0 ? input.ledger.length : 0;

  const items = [...tallies.entries()]
    .map(([id, tally]) => ({ id, ...tally, net: tally.kept - tally.broke }))
    .sort((left, right) => (left.net === right.net ? left.id.localeCompare(right.id) : left.net - right.net));
  return { items, unmatchedRequests };
}

/**
 * The line a run prints, and it prints the worst claims rather than the total.
 *
 * A total is what the transfer ledger already says. What a reader can act on is *which*: three ids with a
 * negative net are three candidates for the ablation, and a line that printed only `net -2.50pp` would leave
 * the next round where this one started.
 */
export function itemTransferLine(
  result: { readonly items: readonly ItemTransfer[]; readonly unmatchedRequests: number },
  options: { readonly top?: number } = {},
): string {
  const top = options.top ?? 3;
  if (result.items.length === 0) {
    return 'attribution: no item was served into a measured episode, so nothing can be attributed';
  }
  const harmful = result.items.filter((item) => item.net < 0);
  const helpful = result.items.filter((item) => item.net > 0);
  const worst = harmful.slice(0, top);
  const named =
    worst.length === 0
      ? 'no claim was served into more trials than it broke'
      : worst
          .map((item) => `${item.id} ${String(item.net)} of ${String(item.episodes)}`)
          .join(', ');
  return (
    `attribution: ${String(result.items.length)} item(s) over ${String(result.items.reduce((sum, item) => sum + item.episodes, 0))} served episode(s); ` +
    `${String(harmful.length)} with a negative net, ${String(helpful.length)} positive; worst ${named}`
  );
}

/**
 * Pair two arms' trials into the episodes the attribution joins on.
 *
 * Extracted from the binary that first needed it, for the reason every pure core in this package was
 * extracted: a join that can only be exercised by running a dispatch is a join with no test. The two
 * refusals below are both readings rather than failures — an unscored trial is not an outcome, and a
 * boundary count that disagrees with the trial count is an instrument fault the join must decline instead
 * of pairing by position.
 */
export function pairedEpisodes(input: {
  readonly referenceTrials: readonly TauTrialRow[];
  readonly memoryTrials: readonly TauTrialRow[];
  readonly episodeStarts: readonly number[];
}): readonly EpisodeOutcome[] | undefined {
  // One boundary per episode and one row per episode. Anything else cannot be joined by index, and a
  // positional fallback is the exact assumption R128 exists to remove.
  if (input.episodeStarts.length !== input.memoryTrials.length) return undefined;
  const control = new Map(
    input.referenceTrials.map((row) => [`${row.id}#${String(row.trial)}`, row.reward]),
  );
  const episodes: EpisodeOutcome[] = [];
  input.memoryTrials.forEach((row, index) => {
    const other = control.get(`${row.id}#${String(row.trial)}`);
    // `null` is the harness declining to score, on either side, and folding it into a failure is the defect
    // `tau2-degradation` was written against.
    if (other === null || other === undefined || row.reward === null) return;
    episodes.push({
      startsAt: input.episodeStarts[index] as number,
      memory: row.reward === 1,
      control: other === 1,
    });
  });
  return episodes;
}

/**
 * The whole reading, from the three fields as they appear in an artefact.
 *
 * `undefined` for any missing field rather than an empty table: an artefact written before the episode
 * boundary existed cannot be joined, and a table of zero items would read as "no claim was served into a
 * measured trial" — the same collapse of absent into zero that cost R123a a dispatch.
 */
export function pairAttribution(input: {
  readonly ledger?: readonly (readonly string[])[];
  readonly episodeStarts?: readonly number[];
  readonly memoryTrials?: readonly TauTrialRow[];
  readonly referenceTrials?: readonly TauTrialRow[];
}): { readonly items: readonly ItemTransfer[]; readonly unmatchedRequests: number } | undefined {
  const { ledger, episodeStarts, memoryTrials, referenceTrials } = input;
  if (ledger === undefined || episodeStarts === undefined || memoryTrials === undefined) return undefined;
  const episodes = pairedEpisodes({
    referenceTrials: referenceTrials ?? [],
    memoryTrials,
    episodeStarts,
  });
  if (episodes === undefined) return undefined;
  return itemTransfer({ episodes, ledger });
}

/**
 * What a gate that withheld a pack did to the trials it withheld it from.
 *
 * R123's mechanism check, and it is free: the ledger already records an empty list for the requests the
 * gate refused, so the arm's own episodes split into the ones that ran with knowledge and the ones that did
 * not, and the two rates are a within-arm comparison nothing else on this lane can make. The alternative
 * reading — the arm's rate against its control — cannot attribute a drop to the gate, because the control
 * differs in every other way too.
 *
 * The prediction R123 registers is directional and can fail: if the withheld trials score like the served
 * ones, the gate removed traffic without removing harm, which is a filter rather than a treatment.
 */
export type ServeSplit = {
  /** Episodes where at least one request in the episode's range was served a non-empty pack. */
  readonly served: { readonly episodes: number; readonly passed: number };
  /** Episodes where every request in range was refused. */
  readonly withheld: { readonly episodes: number; readonly passed: number };
};

/**
 * The episode boundary from a phase's sidecar census, or `undefined` when it carried none.
 *
 * Validated rather than asserted: the block is the sidecar's own payload and a release that renamed the field
 * would otherwise hand this reader `undefined` inside a `readonly number[]`, which is the shape that makes a
 * join silently return nothing. An entry that is not a non-negative integer drops the whole boundary, because
 * a partially read boundary would split some episodes and merge others without saying which.
 */
export function episodeStartsOf(memory: unknown): readonly number[] | undefined {
  if (memory === null || typeof memory !== 'object') return undefined;
  const raw = (memory as Record<string, unknown>)['episodeStarts'];
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  if (!raw.every((entry) => Number.isInteger(entry) && (entry as number) >= 0)) return undefined;
  return raw as readonly number[];
}

/**
 * Why a serve split could not be computed.
 *
 * Four sentences, because four different things go wrong and the repair differs for each. `undefined` was
 * this function's first answer and it cost R123 its registered core reading: the split returned nothing, the
 * caller printed nothing, and a run whose mechanism check was unmeasurable looked exactly like a run that did
 * not have one.
 */
export type ServeSplitAbsence =
  /** The arm recorded no ledger: no request reached the facade, or the field predates the census. */
  | 'no-ledger'
  /** The arm recorded no episode boundary, so a request cannot be attributed to a trial. */
  | 'no-boundary'
  /** The boundary exists but its length disagrees with the trials it would be joined to. */
  | 'boundary-disagrees';

export type ServeSplitReading =
  | { readonly measured: ServeSplit }
  | { readonly absent: ServeSplitAbsence; readonly detail: string };

/**
 * Split one arm's episodes by whether its pack was served.
 *
 * The join is by **boundary value**, not by array length. `episodeStarts` holds the request index at which
 * each episode's requests begin, so its length is the episode count and consecutive entries bracket one
 * episode's requests — but R123's phase recorded one entry per *request* (`[0..161]` over 160 episodes),
 * which passes a length check against the ledger and fails the one that matters. So the boundary is validated
 * as a boundary: strictly increasing, inside the ledger, and one entry per trial. Anything else is reported
 * as an absence with the numbers that disagreed, which is what a reader needs to repair it.
 */
export function serveSplit(input: {
  readonly ledger?: readonly (readonly string[])[];
  readonly episodeStarts?: readonly number[];
  readonly memoryTrials?: readonly TauTrialRow[];
}): ServeSplitReading {
  const { ledger, episodeStarts, memoryTrials } = input;
  if (ledger === undefined || ledger.length === 0) {
    return { absent: 'no-ledger', detail: 'the arm recorded no request, so there is nothing to split' };
  }
  if (episodeStarts === undefined || episodeStarts.length === 0) {
    return {
      absent: 'no-boundary',
      detail: `${String(ledger.length)} request(s) with no episode boundary, so no request belongs to a trial`,
    };
  }
  if (memoryTrials === undefined || memoryTrials.length === 0) {
    return { absent: 'boundary-disagrees', detail: 'the arm recorded no trial rows to join the boundary to' };
  }
  // A boundary is strictly increasing and inside the ledger. `[0..161]` is neither a partition nor a subset
  // when the phase spent 162 requests on 160 episodes, and a joiner that accepted it would place every
  // request in an episode of its own and call the result a split.
  for (let index = 1; index < episodeStarts.length; index += 1) {
    if ((episodeStarts[index] as number) <= (episodeStarts[index - 1] as number)) {
      return {
        absent: 'boundary-disagrees',
        detail: `the boundary repeats or decreases at entry ${String(index)} (${String(episodeStarts[index])} after ${String(episodeStarts[index - 1])}), so it is a position rather than an episode start`,
      };
    }
  }
  const last = episodeStarts[episodeStarts.length - 1] as number;
  if (last >= ledger.length) {
    return {
      absent: 'boundary-disagrees',
      detail: `the last boundary is request ${String(last)} of ${String(ledger.length)}, so an episode starts past the ledger`,
    };
  }
  if (episodeStarts.length !== memoryTrials.length) {
    return {
      absent: 'boundary-disagrees',
      detail: `${String(episodeStarts.length)} boundar(ies) against ${String(memoryTrials.length)} trial row(s)`,
    };
  }
  const served = { episodes: 0, passed: 0 };
  const withheld = { episodes: 0, passed: 0 };
  for (let index = 0; index < episodeStarts.length; index += 1) {
    const start = episodeStarts[index] as number;
    const next = episodeStarts[index + 1];
    // The boundary is a request index, so the range is half-open: `[start, next)`.
    const end = next === undefined ? ledger.length : next;
    const row = memoryTrials[index];
    if (row === undefined) continue;
    // An episode that spent no request cannot have been refused one, so it counts on neither side: charging
    // it to `withheld` would make a gate look like it fired more often than it did.
    if (end <= start) continue;
    let carried = false;
    for (let request = start; request < end; request += 1) {
      if (((ledger[request] as readonly string[] | undefined) ?? []).length > 0) {
        carried = true;
        break;
      }
    }
    // `null` is the harness declining to score, which is not a failure and must not enter either rate.
    if (row.reward === null) continue;
    const bucket = carried ? served : withheld;
    bucket.episodes += 1;
    if (row.reward === 1) bucket.passed += 1;
  }
  return { measured: { served, withheld } };
}

/**
 * The split as one line, with both rates and both intervals.
 *
 * A rate without its interval is the reading this record has refused for three rounds: `served 90.4%,
 * withheld 83.7%` invites a reader to see a 6.7pp gap where the sample can only resolve 25pp. The two
 * intervals are printed beside the two counts so the gap can be compared with the noise that produced it.
 */
export function serveSplitLine(reading: ServeSplitReading): string {
  if ('absent' in reading) {
    // Printed, not skipped. A run whose registered mechanism check could not be computed is a finding, and a
    // silent caller is how R123's split disappeared between a green gate and an artefact with no field.
    return `serve split: not measured (${reading.absent}) — ${reading.detail}`;
  }
  const render = (bucket: { readonly episodes: number; readonly passed: number }): string => {
    if (bucket.episodes === 0) return 'none measured';
    const rate = bucket.passed / bucket.episodes;
    const { low, high } = wilsonInterval({ accuracy: rate, n: bucket.episodes });
    return (
      `${String(bucket.passed)} of ${String(bucket.episodes)} = ${(rate * 100).toFixed(2)}% ` +
      `[${(low * 100).toFixed(1)}, ${(high * 100).toFixed(1)}]`
    );
  };
  return `serve split: served ${render(reading.measured.served)}; withheld ${render(reading.measured.withheld)}`;
}
