/**
 * What the agent did when it had a pack: act, or stop acting.
 *
 * A `pass^4` delta answers "did the pack change the outcome". It does not answer "how", and the two
 * ways a pack can cost an episode are not the same finding:
 *
 *   - the agent acted and the pack sent it to the wrong tool (a wrong-action delta), or
 *   - the agent never acted at all (an inaction delta).
 *
 * The distinction is not cosmetic. The published ablation behind the memory hypothesis
 * (`COMPETITIVE` L.21) measures the same question against a ~300-token focused prompt and a
 * ~113,000-token session and finds 15-35pp across every model family, with the strongest models
 * expressing most of the gap as **abstention** rather than as a wrong answer. If τ²'s floor delta
 * is likewise mostly inaction, then the mechanism is "the pack made the agent give up", and the
 * repair is about pack content and size -- not about the reasoning that follows it.
 *
 * ## Why an episode with no tool call is the τ² form of abstention
 *
 * Upstream's message model states the invariant: a participant message carries either text or tool
 * calls, and an assistant message in a τ² episode continues only by calling a tool. An assistant
 * message with text and no tool calls ends the episode. So "the agent never called a tool" is
 * exactly "the agent declined to continue acting", which is the τ² counterpart of the answered
 * "I don't know" that LongMemEval scores. It is a *mechanism* measurement, not a score: it never
 * changes a reward, and it is never used to choose a floor.
 *
 * ## Why the census is tri-state rather than a number
 *
 * Every dispatch before this instrument has no census at all, and a missing census read as
 * `inactive = 0` would publish "no abstention" for a run that never looked -- the same defect as
 * reading an unscored τ² trial as a failure. `NOT_OBSERVED` is therefore a state, and it carries
 * the reason, so an artefact cannot present an unmeasured population as a zero.
 *
 * The Python phase reports per-episode flags from upstream's live objects (where `role` and
 * `tool_calls` exist) and this module reduces them. The reduction is here rather than there because
 * this is the half with tests: a census that can be wrong silently would be worse than none.
 */

export type TaskInaction = {
  /** Scenario-qualified task id, named the way the pair artefact names its tasks. */
  readonly id: string;
  /** Trials in which the agent never called a tool. */
  readonly inactive: number;
  /** Trials this task contributed, which is the denominator of its own share. */
  readonly trials: number;
};

export type InactionCensus =
  | { readonly state: 'NOT_OBSERVED'; readonly reason: string }
  | {
      readonly state: 'OBSERVED';
      /** Ordered by id, so two censuses compare line by line. */
      readonly tasks: readonly TaskInaction[];
      readonly inactiveTrials: number;
      readonly totalTrials: number;
    };

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function notObserved(reason: string): InactionCensus {
  return { state: 'NOT_OBSERVED', reason };
}

/**
 * Reduce a phase's `diagnostics` object to a census.
 *
 * Strict where the phase is the instrument and lenient where the lane cannot be: a malformed
 * episode is a thrown error (the instrument produced something no reader can interpret), while an
 * absent or explicitly unobservable census is a labelled state (the instrument looked and could not
 * see). `scenario` is applied here for the same reason `trialRowsOf` applies it: the pair artefact
 * names its tasks with the scenario, and a census that named them differently would reconcile with
 * nothing.
 */
export function inactionCensusOf(diagnostics: unknown, scenario: string): InactionCensus {
  if (diagnostics === undefined) return notObserved('the phase reported no diagnostics');
  const root = asRecord(diagnostics);
  if (root === undefined) throw new Error('the phase diagnostics are not an object');
  const raw = root['inaction'];
  if (raw === undefined) {
    return notObserved('the phase reported no inaction census, so abstention was not observed');
  }
  const census = asRecord(raw);
  if (census === undefined) throw new Error('the inaction census is not an object');
  const observable = census['observable'];
  if (typeof observable !== 'boolean') {
    throw new Error(`the inaction census must state whether it is observable, received '${String(observable)}'`);
  }
  if (!observable) {
    return notObserved('upstream did not expose the episode messages, so abstention is not observable');
  }
  const episodes = census['episodes'];
  if (!Array.isArray(episodes)) throw new Error('the inaction census has no episode list');
  if (episodes.length === 0) {
    return notObserved('the inaction census holds no episode, so it measured nothing');
  }

  const seen = new Set<string>();
  const perTask = new Map<string, { inactive: number; trials: number }>();
  let inactiveTrials = 0;
  for (const entry of episodes) {
    const episode = asRecord(entry);
    if (episode === undefined) throw new Error('an inaction episode is not an object');
    const task = episode['task'];
    if (typeof task !== 'string' || task.trim() === '') {
      throw new Error('an inaction episode has no task id');
    }
    const trial = episode['trial'];
    if (typeof trial !== 'number' || !Number.isInteger(trial) || trial < 0) {
      throw new Error(`inaction episode '${task}' has no non-negative integer trial, received '${String(trial)}'`);
    }
    const acted = episode['acted'];
    if (typeof acted !== 'boolean') {
      throw new Error(`inaction episode '${task}' trial ${String(trial)} has no boolean 'acted' flag`);
    }
    const id = `${scenario}/${task}`;
    const key = `${id}\u0000${String(trial)}`;
    if (seen.has(key)) {
      throw new Error(`the inaction census has two action records for ${id} trial ${String(trial)}`);
    }
    seen.add(key);
    const tally = perTask.get(id) ?? { inactive: 0, trials: 0 };
    tally.trials += 1;
    if (!acted) {
      tally.inactive += 1;
      inactiveTrials += 1;
    }
    perTask.set(id, tally);
  }

  const tasks = [...perTask.entries()]
    .map(([id, tally]) => ({ id, inactive: tally.inactive, trials: tally.trials }))
    // Two-way on purpose: the keys are map keys, so two of them are never equal, and a third
    // "equal" arm would be a branch no input can reach.
    .sort((left, right) => (left.id < right.id ? -1 : 1));

  return { state: 'OBSERVED', tasks, inactiveTrials, totalTrials: episodes.length };
}

/** The share of episodes in which the agent never acted, or `null` when unobservable. */
export function inactionRate(census: InactionCensus): number | null {
  if (census.state !== 'OBSERVED') return null;
  if (census.totalTrials === 0) return null;
  return census.inactiveTrials / census.totalTrials;
}

export type InactionContrast = {
  readonly asIsRate: number;
  readonly flooredRate: number;
  /** The treatment's inaction share minus the control's, in percentage points. */
  readonly deltaPp: number;
  readonly inactiveTrials: { readonly asIs: number; readonly floored: number };
};

/**
 * The change in inaction share between the two facades of one run.
 *
 * Defined only when BOTH sides observed the same episodes. A contrast over different populations
 * would be a cross-run comparison in miniature -- the defect `within-run-pair.ts` exists to refuse --
 * so a mismatched task set throws here rather than printing a delta beside the pair's.
 */
export function inactionContrast(
  asIs: InactionCensus,
  floored: InactionCensus,
): InactionContrast | undefined {
  if (asIs.state !== 'OBSERVED' || floored.state !== 'OBSERVED') return undefined;
  if (asIs.totalTrials === 0 || floored.totalTrials === 0) return undefined;
  const shape = (census: Extract<InactionCensus, { state: 'OBSERVED' }>): string =>
    census.tasks.map((task) => `${task.id}:${String(task.trials)}`).join('|');
  if (shape(asIs) !== shape(floored)) {
    throw new Error('an inaction contrast needs both facades over the same tasks and trial counts');
  }
  const asIsRate = asIs.inactiveTrials / asIs.totalTrials;
  const flooredRate = floored.inactiveTrials / floored.totalTrials;
  return {
    asIsRate,
    flooredRate,
    deltaPp: Number(((flooredRate - asIsRate) * 100).toFixed(2)),
    inactiveTrials: { asIs: asIs.inactiveTrials, floored: floored.inactiveTrials },
  };
}

/**
 * The contrast, or `null` where one is not defined.
 *
 * A boundary adapter, not a second contract. `inactionContrast` throws on two populations -- the
 * right answer for a pure function asked for a number that does not exist -- but the one caller is
 * the driver, after an hour of evaluation, and a throw there would lose the artefact that holds
 * both censuses. The refusal becomes a `null` contrast, and the artefact still shows both shapes for
 * a reader to compare. Anything that is not a population mismatch also becomes `null` rather than a
 * guess.
 */
export function inactionContrastOrNull(
  asIs: InactionCensus,
  floored: InactionCensus,
): InactionContrast | null {
  try {
    return inactionContrast(asIs, floored) ?? null;
  } catch {
    return null;
  }
}

/** One line for the run log: the shares, or the reason there is no census. */
export function inactionSummary(asIs: InactionCensus, floored: InactionCensus): string {
  if (asIs.state === 'NOT_OBSERVED') return `inaction: NOT_OBSERVED (${asIs.reason})`;
  if (floored.state === 'NOT_OBSERVED') return `inaction: NOT_OBSERVED (${floored.reason})`;
  return (
    `inaction: as-is ${String(asIs.inactiveTrials)}/${String(asIs.totalTrials)} ` +
    `floored ${String(floored.inactiveTrials)}/${String(floored.totalTrials)}`
  );
}
