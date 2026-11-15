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
