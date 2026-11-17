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
  /**
   * The half-open request ranges this episode spent.
   *
   * R136. One episode normally spends one range — from its boundary to the next — but a task simulated
   * twice opens two boundaries, and under a concurrent runner they need not be adjacent. A reading that
   * delimited an episode by "its start to the next start" would then hand the second boundary's requests to
   * whichever task opened in between, which is a positional join at the only place identity is known.
   * Absent on episodes joined by position: the fallback is exactly that range, computed from the list.
   */
  readonly spans?: readonly (readonly [number, number])[];
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
  // A row that is not a list of ids is a malformed ledger, not a request that served nothing. Thrown rather
  // than tolerated: a hole read as an empty pack would make the request count the table's denominator while
  // contributing no observation, and every rate derived from it would be a rate over the wrong population.
  for (const row of input.ledger) {
    if (!Array.isArray(row)) {
      throw new TypeError('the ledger carries a request with no id list, so it is not a ledger of packs');
    }
  }
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
    // R136: a joined episode carries its own ranges, one per boundary it opened, because a task simulated
    // twice has two of them and only the identity join knows that they are the same episode. Clamped to the
    // ledger, because a caller without one leaves the last range open.
    const spans = (episode.spans ?? [[start, end] as const]).map(
      ([from, to]) =>
        [Math.min(from, input.ledger.length), Math.min(to, input.ledger.length)] as const,
    );
    const served = new Set<string>();
    for (const [from, to] of spans) {
      if (to <= from) continue;
      for (let request = from; request < to; request += 1) {
        // `ledger` is one entry per request by construction, every `to` is clamped to its length and every
        // row was checked to be a list above, so the element exists: a `?? []` here was a branch no artefact
        // could reach, which is the shape this record deletes rather than exempts.
        for (const id of input.ledger[request] as readonly string[]) served.add(id);
      }
    }
    if (spans.every(([from, to]) => to <= from)) continue;
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
  /** R136: the task each boundary opened for, when the arm names them. */
  readonly boundaryTasks?: readonly (string | null)[];
  /** The request count the last boundary's range ends at. Absent when the caller has no ledger. */
  readonly ledgerLength?: number;
}): readonly EpisodeOutcome[] | undefined {
  const ledgerLength = input.ledgerLength ?? Number.MAX_SAFE_INTEGER;
  const control = new Map(
    input.referenceTrials.map((row) => [`${row.id}#${String(row.trial)}`, row.reward]),
  );
  // Identity first, for the reason `serveSplit` gives: it is the only path that can pair 41 boundaries with
  // 40 trials, and the only one that knows a repeated task is one episode with two ranges.
  const join =
    input.boundaryTasks === undefined
      ? undefined
      : boundaryJoin({
          episodeStarts: input.episodeStarts,
          boundaryTasks: input.boundaryTasks,
          memoryTrials: input.memoryTrials,
        });
  if (join !== undefined) {
    // A named boundary that resolves to nothing is not a case for the positional path: the arm said which
    // task it opened and the reader could not honour it, which is an instrument finding.
    if (!('measured' in join) || join.unresolved > 0 || join.measured.length === 0) return undefined;
    const episodes: EpisodeOutcome[] = [];
    for (const group of join.measured) {
      // The trial index came from this array, so the row exists: a `=== undefined` guard here was a branch
      // no artefact could reach, which is the shape this record deletes rather than exempts.
      const row = input.memoryTrials[group.trial] as TauTrialRow;
      const other = control.get(`${row.id}#${String(row.trial)}`);
      if (other === null || other === undefined || row.reward === null) continue;
      const spans = group.boundaries.map((index) => boundarySpan(input.episodeStarts, index, ledgerLength));
      const startsAt = Math.min(...spans.map(([from]) => from));
      episodes.push({ startsAt, spans, memory: row.reward === 1, control: other === 1 });
    }
    return episodes;
  }
  // One boundary per episode and one row per episode. Anything else cannot be joined by index, and a
  // positional fallback is the exact assumption R128 exists to remove.
  if (input.episodeStarts.length !== input.memoryTrials.length) return undefined;
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
  readonly boundaryTasks?: readonly (string | null)[];
  readonly memoryTrials?: readonly TauTrialRow[];
  readonly referenceTrials?: readonly TauTrialRow[];
}): { readonly items: readonly ItemTransfer[]; readonly unmatchedRequests: number } | undefined {
  const { ledger, episodeStarts, memoryTrials, referenceTrials, boundaryTasks } = input;
  if (ledger === undefined || episodeStarts === undefined || memoryTrials === undefined) return undefined;
  const episodes = pairedEpisodes({
    referenceTrials: referenceTrials ?? [],
    memoryTrials,
    episodeStarts,
    ledgerLength: ledger.length,
    ...(boundaryTasks === undefined ? {} : { boundaryTasks }),
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
 * The task each boundary opened for, from `memory.boundaryTasks`, or `undefined` when the arm carries none.
 *
 * R136. A `null` entry is a boundary the runner could not resolve to a task, and it is kept in place rather
 * than filtered out: the list is positional against `episodeStarts`, and dropping an entry would shift every
 * boundary after it onto the wrong task — the exact failure the field exists to end.
 */
export function boundaryTasksOf(memory: unknown): readonly (string | null)[] | undefined {
  if (memory === null || typeof memory !== 'object') return undefined;
  const raw = (memory as Record<string, unknown>)['boundaryTasks'];
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  if (!raw.every((entry) => entry === null || (typeof entry === 'string' && entry !== ''))) return undefined;
  return raw as readonly (string | null)[];
}

/** A task id without the domain prefix, so `retail/5` from `per_task` matches `5` from τ². */
export function taskKey(id: string): string {
  const cut = id.lastIndexOf('/');
  return cut === -1 ? id : id.slice(cut + 1);
}

/** One task's boundaries: the requests they opened and the trial they scored. */
export type BoundaryGroup = {
  readonly task: string;
  /** Indexes into `episodeStarts`, in request order. More than one means the task was simulated twice. */
  readonly boundaries: readonly number[];
  /** Index into the arm's trial rows. */
  readonly trial: number;
};

export type BoundaryAbsence =
  /** The arm carries no boundary at all, so there is no request partition to name. */
  | 'no-boundary'
  /** The arm predates the instrument: `episodeStarts` without `boundaryTasks`. */
  | 'no-tasks'
  /** The two lists are positional against each other and their lengths disagree: the instrument is broken. */
  | 'length-disagrees'
  /** A boundary names a task the arm never scored, which is a mislabelled artefact rather than a retry. */
  | 'unknown-task';

export type BoundaryJoinReading =
  | {
      readonly measured: readonly BoundaryGroup[];
      /** The tasks that opened more than one boundary, i.e. the retries the old join refused on. */
      readonly retried: readonly BoundaryGroup[];
      /** Boundaries no task could be resolved for. Their requests belong to no trial and are excluded. */
      readonly unresolved: number;
    }
  | { readonly absent: BoundaryAbsence; readonly detail: string };

/**
 * Join a phase's boundaries to its trials **by the task each boundary opened for**.
 *
 * R135 spent its course on a join that could not be made: 41 boundaries for 40 scored episodes, one task
 * simulated twice, and every positional join in this package refusing for the right reason and offering no
 * repair. The repair is not a better guess about order — it is the identity the boundary already carries.
 *
 * Two properties make this a reading rather than a convention:
 *
 *  - a boundary's *requests* are still delimited by position, because `episodeStarts` is a partition of the
 *    request stream and no identity changes that;
 *  - a boundary's *trial* comes from the task it names, so a repeated task contributes one episode with two
 *    ranges instead of two episodes with one outcome each.
 *
 * `absent` rather than an empty list on every way this can fail, because a join that returns nothing and a
 * join that finds nothing are different findings and this record has confused them before.
 */
export function boundaryJoin(input: {
  readonly episodeStarts?: readonly number[];
  readonly boundaryTasks?: readonly (string | null)[];
  readonly memoryTrials?: readonly TauTrialRow[];
}): BoundaryJoinReading {
  const { episodeStarts, boundaryTasks, memoryTrials } = input;
  if (episodeStarts === undefined || episodeStarts.length === 0) {
    return { absent: 'no-boundary', detail: 'the arm recorded no episode boundary, so no request belongs to a trial' };
  }
  if (boundaryTasks === undefined || boundaryTasks.length === 0) {
    return {
      absent: 'no-tasks',
      detail: `${String(episodeStarts.length)} boundar(ies) with no task named for any of them`,
    };
  }
  if (boundaryTasks.length !== episodeStarts.length) {
    return {
      absent: 'length-disagrees',
      detail: `${String(boundaryTasks.length)} task name(s) against ${String(episodeStarts.length)} boundar(ies); the two lists are positional`,
    };
  }
  const trials = memoryTrials ?? [];
  const trialOf = new Map<string, number>();
  trials.forEach((row, index) => {
    const key = taskKey(row.id);
    if (!trialOf.has(key)) trialOf.set(key, index);
  });
  const groups = new Map<string, { boundaries: number[]; trial: number }>();
  let unresolved = 0;
  boundaryTasks.forEach((task, index) => {
    if (task === null) {
      unresolved += 1;
      return;
    }
    const key = taskKey(task);
    const trial = trialOf.get(key);
    if (trial === undefined) {
      unresolved += 1;
      return;
    }
    const group = groups.get(key) ?? { boundaries: [], trial };
    group.boundaries.push(index);
    groups.set(key, group);
  });
  // A boundary that named a task the arm never scored is a mislabelled artefact, not a retry: pairing it
  // would attribute one task's requests to another's outcome, which is the direction this join exists to
  // get right. It is named rather than dropped.
  const orphan = boundaryTasks.find((task) => task !== null && !trialOf.has(taskKey(task)));
  if (orphan !== null && orphan !== undefined && groups.size === 0) {
    return {
      absent: 'unknown-task',
      detail: `every boundary names a task this arm never scored (first: ${orphan})`,
    };
  }
  const measured = [...groups.entries()].map(([task, group]) => ({
    task,
    boundaries: group.boundaries,
    trial: group.trial,
  }));
  return { measured, retried: measured.filter((group) => group.boundaries.length > 1), unresolved };
}

/**
 * The line a run prints about its own boundary, which is the one sentence R135 could not write.
 *
 * A count of boundaries and a count of trials are not the same number and never were: the difference is a
 * task simulated twice, and a line that prints only the counts leaves a reader unable to tell a retry from a
 * broken instrument.
 */
export function boundaryLine(reading: BoundaryJoinReading): string {
  if ('absent' in reading) {
    return `boundary: not joined (${reading.absent}) — ${reading.detail}`;
  }
  const boundaries = reading.measured.reduce((sum, group) => sum + group.boundaries.length, 0);
  const named = reading.retried.map((group) => `${group.task} ${String(group.boundaries.length)}`);
  return (
    `boundary: ${String(boundaries)} boundar(ies) for ${String(reading.measured.length)} task(s)` +
    (named.length === 0 ? ', none repeated' : `; repeated ${named.join(', ')}`) +
    (reading.unresolved === 0 ? '' : `; ${String(reading.unresolved)} unresolved`)
  );
}

/**
 * Why a serve split could not be computed.
 *
 * One sentence per way it fails, because the repair differs for each. `undefined` was this function's first
 * answer and it cost R123 its registered core reading: the split returned nothing, the caller printed
 * nothing, and a run whose mechanism check was unmeasurable looked exactly like a run that did not have one.
 */
export type ServeSplitAbsence =
  /** The arm recorded no ledger: no request reached the facade, or the field predates the census. */
  | 'no-ledger'
  /** The arm recorded no episode boundary, so a request cannot be attributed to a trial. */
  | 'no-boundary'
  /** The boundary exists but its length disagrees with the trials it would be joined to. */
  | 'boundary-disagrees'
  /** R136: the arm names its boundaries and some of them name no task, so identity cannot decide. */
  | 'tasks-unresolved';

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
 *
 * R136 added `boundaryTasks`, and it changes what "one entry per trial" means. R135 had 41 boundaries for 40
 * trials — a task simulated twice — and no positional repair exists for that, so the count check refused an
 * arm whose treatment was fine and the arm's mechanism reading was lost. With the boundary's task named, the
 * count is allowed to differ: the boundary count is the number of *ranges*, the group count is the number of
 * episodes, and the two are equal only on an arm that retried nothing.
 */
export function serveSplit(input: {
  readonly ledger?: readonly (readonly string[])[];
  readonly episodeStarts?: readonly number[];
  readonly memoryTrials?: readonly TauTrialRow[];
  readonly boundaryTasks?: readonly (string | null)[];
}): ServeSplitReading {
  const { ledger, episodeStarts, memoryTrials, boundaryTasks } = input;
  if (ledger === undefined || ledger.length === 0) {
    return { absent: 'no-ledger', detail: 'the arm recorded no request, so there is nothing to split' };
  }
  if (!ledger.every((row) => Array.isArray(row))) {
    return {
      absent: 'no-ledger',
      detail: 'the ledger carries a request with no id list, so its rows are not packs',
    };
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
  const defect = boundaryDefect(episodeStarts, ledger.length);
  if (defect !== undefined) return { absent: 'boundary-disagrees', detail: defect };
  // The identity path first: it is the only one that can pair 41 boundaries with 40 trials, and it is the
  // only one that knows a repeated task is one episode with two ranges rather than two episodes.
  const join =
    boundaryTasks === undefined
      ? undefined
      : boundaryJoin({ episodeStarts, boundaryTasks, memoryTrials });
  if (join !== undefined) {
    // Identity decides when it is available, and it does not fall back: a boundary that names no task cannot
    // be positioned either, and a positional fallback here would be the join R136 exists to replace, wearing
    // the name of the one it replaced.
    if (!('measured' in join)) {
      return { absent: 'boundary-disagrees', detail: join.detail };
    }
    if (join.unresolved > 0 || join.measured.length === 0) {
      return {
        absent: 'tasks-unresolved',
        detail:
          `${String(join.unresolved)} of ${String(episodeStarts.length)} boundar(ies) name no task this ` +
          'arm scored, so the requests they opened belong to no trial',
      };
    }
    const served = { episodes: 0, passed: 0 };
    const withheld = { episodes: 0, passed: 0 };
    for (const group of join.measured) {
      const row = memoryTrials[group.trial] as TauTrialRow;
      // `null` is the harness declining to score, which is not a failure and must not enter either rate.
      if (row.reward === null) continue;
      // No empty-range guard here: `boundaryDefect` has already established a strictly increasing list
      // inside the ledger, so every span this group owns is non-empty by construction.
      const spans = group.boundaries.map((index) => boundarySpan(episodeStarts, index, ledger.length));
      const carried = spans.some(([from, to]) => {
        for (let request = from; request < to; request += 1) {
          // No `?? []`: every row was checked to be a list before the join ran, so a hole cannot reach here.
          if ((ledger[request] as readonly string[]).length > 0) return true;
        }
        return false;
      });
      const bucket = carried ? served : withheld;
      bucket.episodes += 1;
      if (row.reward === 1) bucket.passed += 1;
    }
    return { measured: { served, withheld } };
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
    // The ranges and the rows are one per boundary by the check above, and `boundaryDefect` has already
    // established that every range is non-empty and inside the ledger: the two guards that used to sit here
    // (`row === undefined`, `end <= start`) were branches no artefact could reach.
    const [start, end] = boundarySpan(episodeStarts, index, ledger.length);
    const row = memoryTrials[index] as TauTrialRow;
    let carried = false;
    for (let request = start; request < end; request += 1) {
      if ((ledger[request] as readonly string[]).length > 0) {
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

/** The half-open request range one boundary owns: from its own index to the next boundary's. */
export function boundarySpan(
  episodeStarts: readonly number[],
  index: number,
  ledgerLength: number,
): readonly [number, number] {
  const start = episodeStarts[index] as number;
  const next = episodeStarts[index + 1];
  const end = next === undefined ? ledgerLength : Math.min(next, ledgerLength);
  return [Math.min(start, ledgerLength), end];
}

/**
 * What is wrong with a boundary list read as a partition, or `undefined` when nothing is.
 *
 * Shared by both join paths: identity decides *which* episode a range belongs to, and cannot rescue a list
 * that is not a list of boundaries.
 */
export function boundaryDefect(
  episodeStarts: readonly number[],
  ledgerLength: number,
): string | undefined {
  for (let index = 1; index < episodeStarts.length; index += 1) {
    if ((episodeStarts[index] as number) <= (episodeStarts[index - 1] as number)) {
      return `the boundary repeats or decreases at entry ${String(index)} (${String(episodeStarts[index])} after ${String(episodeStarts[index - 1])}), so it is a position rather than an episode start`;
    }
  }
  const last = episodeStarts[episodeStarts.length - 1] as number;
  if (last >= ledgerLength) {
    return `the last boundary is request ${String(last)} of ${String(ledgerLength)}, so an episode starts past the ledger`;
  }
  return undefined;
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

/**
 * Whether the agent's own copy count reconciles with the injections it made.
 *
 * R137. The wrapper appended the recalled block to a state tau2 threads back, so an episode of ten turns
 * carried ten copies of it — and the only test that could have caught it asserted a caller the benchmark
 * does not have. The repair removes every copy the agent wrote before appending one, which makes an identity
 * hold that no run can fake:
 *
 *   packCopiesDropped == injectedMessages − boundaries
 *
 * because every injected call after the first of its episode is handed a state that already carries the
 * block, and drops it. With the defect the left side is zero and the right side is not; with a benchmark
 * that stops threading the state the right side is zero and the left side is not, which is the *other*
 * reason to print it — a fact about the harness rather than about the wrapper, and one this lane has no
 * other way to observe.
 *
 * `absent` rather than a pass when the arm predates the counter: an arm that never recorded the field did
 * not reconcile anything, and a green gate on a missing measurement is the defect R123a paid for.
 */
export type CopyLedgerInput = {
  readonly dropped?: number | null;
  readonly injected?: number | null;
  readonly boundaries?: number | null;
};

export type CopyLedgerReading = {
  /** `expected` is `injected − boundaries`: the copies a sound wrapper must have removed. */
  readonly state: 'reconciled' | 'unreconciled' | 'absent';
  readonly dropped: number | null;
  readonly expected: number | null;
  readonly detail: string;
};

export function copyLedgerOf(input: CopyLedgerInput): CopyLedgerReading {
  const dropped = finiteOrNull(input.dropped);
  const injected = finiteOrNull(input.injected);
  const boundaries = finiteOrNull(input.boundaries);
  if (dropped === null || injected === null || boundaries === null) {
    return {
      state: 'absent',
      dropped,
      expected: null,
      detail:
        'the arm did not report the copies it removed, the messages it injected and the boundaries it opened, so there is nothing to reconcile',
    };
  }
  const expected = injected - boundaries;
  if (dropped === expected) {
    return { state: 'reconciled', dropped, expected, detail: `${String(dropped)} copy(ies) removed, as the identity requires` };
  }
  return {
    state: 'unreconciled',
    dropped,
    expected,
    detail:
      expected === 0
        ? `the agent removed ${String(dropped)} copies where the identity requires none, which is a bench that does not thread the state back`
        : `the agent removed ${String(dropped)} copies where ${String(expected)} injection(s) were handed a state that already carried the block`,
  };
}

export function copyLedgerLine(reading: CopyLedgerReading): string {
  return `copies: ${reading.state} — ${reading.detail}`;
}

/** A finite number, or `null`. Three counters arrive from a JSON artefact and any of them may be absent. */
function finiteOrNull(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * The ledger rows that name a scored trial, and the ones an abandoned attempt opened.
 *
 * R138. τ² re-runs a simulation whose first attempt died, so the facade serves a pack to an episode the runner
 * never scores: R137 took 42 requests for 40 trials and `item-ledger` refused, which suppressed the per-item
 * census on the one arm that had a clean carriage. The rows are not unknown — each boundary owns exactly one
 * ledger row, in order — so the two that name no task can be removed rather than guessed at, and what is
 * removed is reported.
 *
 * The repair is conservative and says why: a row is dropped only when its own boundary names no scored task,
 * **and** only when the survivors cover every scored trial exactly once. A task that was simulated twice fails
 * the second test (its rows outnumber the trials), because that case needs the spans `boundaryJoin` groups and
 * a positional join would silently merge two ranges.
 */
export type NamedLedgerInput = {
  readonly ledger?: readonly (readonly string[])[] | null;
  readonly boundaryTasks?: readonly (string | null)[] | null;
  readonly tasks: readonly string[];
};

export type NamedLedgerReading =
  | { readonly ledger: readonly (readonly string[])[]; readonly dropped: number }
  | { readonly absent: 'no-ledger' | 'no-tasks' | 'length-disagrees' | 'tasks-unresolved' | 'unknown-task'; readonly detail: string };

export function namedLedgerOf(input: NamedLedgerInput): NamedLedgerReading {
  const ledger = input.ledger;
  if (!Array.isArray(ledger) || ledger.length === 0) {
    return { absent: 'no-ledger', detail: 'the artefact carries no pack ledger, so no request can be priced' };
  }
  const names = input.boundaryTasks;
  if (!Array.isArray(names) || names.length === 0) {
    return {
      absent: 'no-tasks',
      detail: 'the arm recorded no boundary names, so a ledger row cannot be told from an abandoned attempt',
    };
  }
  if (ledger.length !== names.length) {
    return {
      absent: 'length-disagrees',
      detail: `${String(ledger.length)} ledger row(s) against ${String(names.length)} boundary name(s)`,
    };
  }
  // One row per boundary, in order: a recall succeeds once per boundary, and the ledger records the requests
  // that succeeded. So a row is paired with the name at its own index, and the pair survives only if the name
  // is one.
  const kept: (readonly string[])[] = [];
  const named: string[] = [];
  ledger.forEach((row, index) => {
    const name = names[index];
    if (name === null || name === undefined) return;
    kept.push(row);
    named.push(name);
  });
  if (kept.length !== input.tasks.length) {
    return {
      absent: 'tasks-unresolved',
      detail:
        `${String(kept.length)} row(s) name a scored task against ${String(input.tasks.length)} trial(s): a task ` +
        'simulated twice, or a boundary that names nothing, and neither can be joined by position',
    };
  }
  const scored = new Set(input.tasks.map((id) => taskKey(id)));
  if (named.some((name) => !scored.has(taskKey(name)))) {
    return {
      absent: 'unknown-task',
      detail: 'a named boundary resolves to a task this arm never scored, so its rows belong to no trial',
    };
  }
  return { ledger: kept, dropped: ledger.length - kept.length };
}
