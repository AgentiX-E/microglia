/**
 * L4 — reading a τ²-bench run, without running one.
 *
 * The lane's metric layer (`passk.ts`) was built first because the estimator is
 * where this lane can be wrong before any model is called. What was missing is the
 * step between a finished run and that estimator: τ²-bench writes its own result
 * documents, and turning them into `(successes, trials)` pairs is a parsing job
 * with three traps, all of which the upstream code refuses rather than guesses.
 *
 * ## What the upstream format actually is
 *
 * From `sierra-research/tau2-bench` at the version this repository pins
 * (`src/tau2/data_model/simulation.py`, `src/tau2/runner/pass3.py`, and
 * `tests/test_results_format.py`, read at `main` on 2026-10-22):
 *
 *   - `Results` stores `info`, `tasks` and `simulations`, and has a second
 *     storage form: `results.json` with `info`, `tasks` and a `simulation_index`
 *     of lightweight entries plus one file per simulation under `simulations/`.
 *   - A `SimulationRun` carries `task_id`, `trial` (optional) and
 *     `reward_info.reward`; an index entry carries `task_id`, `trial` and
 *     `reward` directly. A reward may be `null`, which upstream permits **only**
 *     for `INFRASTRUCTURE_ERROR` and which is never counted as a failure.
 *   - A trial succeeds when `reward == 1.0` exactly. τ² rewards are not binary by
 *     nature (database, action and communicate checks each contribute), and
 *     `0.999` is a near miss, not a pass.
 *   - A partial grid is refused, not averaged: every task needs the same trial
 *     count, every task in `tasks` needs a result, and duplicate results for one
 *     trial are an error.
 *
 * This module keeps those four rules and makes each one a named refusal, so a
 * lane can report *why* a run was not scoreable instead of scoring half of it.
 */
import type { PassAtKInput } from './passk.js';

/** One scored attempt: which task, which trial, what reward (null = unscored). */
export type TauTrial = {
  readonly taskId: string;
  readonly trial: number;
  readonly reward: number | null;
  readonly terminationReason?: string;
};

export type TauRun = {
  /** `info.environment_info.domain_name` when the document carries it. */
  readonly domain?: string;
  /** The task list the run claims to cover, in document order. */
  readonly taskIds: readonly string[];
  readonly trials: readonly TauTrial[];
  readonly format: 'json' | 'dir';
  /** Trials whose `trial` field was absent and therefore indexed by position. */
  readonly inferredTrials: number;
};

export type TaskTrials = {
  readonly taskId: string;
  readonly rewards: readonly (number | null)[];
};

/**
 * Why a document could not be read as a τ² run.
 *
 * A parse failure is data, not a bug in the lane: the lane records the reason and
 * refuses to score, which is the difference between "the run was bad" and "the
 * loop is bad".
 */
export type L4ParseReason =
  | 'unreadable-json'
  | 'missing-tasks'
  | 'missing-results'
  | 'bad-entry'
  | 'unknown-task'
  | 'duplicate-trial'
  | 'bad-reward'
  | 'bad-trial'
  | 'short-grid'
  | 'no-scored-tasks';

export class L4ParseError extends Error {
  public readonly reason: L4ParseReason;

  public constructor(reason: L4ParseReason, message: string) {
    super(`${reason}: ${message}`);
    this.name = 'L4ParseError';
    this.reason = reason;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asArray(value: unknown): readonly unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function taskIdOf(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

/**
 * The reward of one entry, from either storage form.
 *
 * `simulations` nests it under `reward_info`; an index entry carries it flat. A
 * missing `reward_info` is `null` (unscored), not 0: counting an unscored attempt
 * as a failure is how a lane reports an infrastructure failure as a model failure.
 */
function rewardOf(entry: Record<string, unknown>): number | null {
  const flat = entry['reward'];
  if (typeof flat === 'number') return flat;
  const info = asRecord(entry['reward_info']);
  const nested = info?.['reward'];
  if (typeof nested === 'number') return nested;
  return null;
}

function trialOf(entry: Record<string, unknown>): number | undefined {
  const trial = entry['trial'];
  if (trial === undefined || trial === null) return undefined;
  if (typeof trial !== 'number' || !Number.isInteger(trial) || trial < 0) {
    throw new L4ParseError('bad-trial', `trial must be a non-negative integer, got ${String(trial)}`);
  }
  return trial;
}

/**
 * Read one τ²-bench result document.
 *
 * Both storage forms are accepted because a recorded artefact can be either, and
 * the difference is invisible to everything downstream: what the lane needs is
 * `(task, trial, reward)`, and provenance that does not change that is noise.
 */
export function parseTauResults(text: string): TauRun {
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch (error) {
    throw new L4ParseError('unreadable-json', String(error).slice(0, 200));
  }
  const root = asRecord(document);
  if (root === undefined) throw new L4ParseError('missing-tasks', 'the document is not an object');

  const tasks = asArray(root['tasks']);
  if (tasks === undefined) throw new L4ParseError('missing-tasks', '`tasks` is not an array');
  const taskIds: string[] = [];
  for (const task of tasks) {
    const entry = asRecord(task);
    const id = entry === undefined ? undefined : taskIdOf(entry['id']);
    if (id === undefined) throw new L4ParseError('missing-tasks', 'a task has no id');
    taskIds.push(id);
  }

  const simulations = asArray(root['simulations']);
  const index = asArray(root['simulation_index']);
  const entries = simulations ?? index;
  if (entries === undefined) {
    throw new L4ParseError('missing-results', 'neither `simulations` nor `simulation_index` is present');
  }

  const known = new Set(taskIds);
  const seen = new Set<string>();
  const inferred = new Map<string, number>();
  const trials: TauTrial[] = [];
  let inferredTrials = 0;

  for (const raw of entries) {
    const entry = asRecord(raw);
    if (entry === undefined) throw new L4ParseError('bad-entry', 'a result entry is not an object');
    const taskId = taskIdOf(entry['task_id']);
    if (taskId === undefined) throw new L4ParseError('bad-entry', 'a result entry has no `task_id`');
    if (!known.has(taskId)) {
      throw new L4ParseError('unknown-task', `result for '${taskId}', which is not in \`tasks\``);
    }
    const explicit = trialOf(entry);
    const trial = explicit ?? (inferred.get(taskId) ?? -1) + 1;
    if (explicit === undefined) {
      inferredTrials += 1;
      inferred.set(taskId, trial);
    }
    const key = `${taskId}\u0000${trial}`;
    if (seen.has(key)) {
      throw new L4ParseError('duplicate-trial', `'${taskId}' has two results for trial ${trial}`);
    }
    seen.add(key);
    const reward = rewardOf(entry);
    if (reward !== null && (!Number.isFinite(reward) || reward < 0 || reward > 1)) {
      throw new L4ParseError('bad-reward', `'${taskId}' trial ${trial} has reward ${String(reward)}`);
    }
    const termination = entry['termination_reason'];
    trials.push({
      taskId,
      trial,
      reward,
      ...(typeof termination === 'string' ? { terminationReason: termination } : {}),
    });
  }

  const info = asRecord(root['info']);
  const environment = asRecord(info?.['environment_info']);
  const domain = environment?.['domain_name'];
  return {
    ...(typeof domain === 'string' ? { domain } : {}),
    taskIds,
    trials,
    format: simulations === undefined ? 'dir' : 'json',
    inferredTrials,
  };
}

/**
 * Rewards per task, in the run's own task order.
 *
 * Order matters for reproducibility: a report that lists tasks in hash order
 * cannot be compared with the previous run's report line by line.
 */
export function taskTrials(run: TauRun): readonly TaskTrials[] {
  return run.taskIds.map((taskId) => ({
    taskId,
    rewards: run.trials.filter((trial) => trial.taskId === taskId).map((trial) => trial.reward),
  }));
}

/**
 * The estimator's input, from a finished run.
 *
 * Three refusals, each taken from upstream rather than invented here:
 *
 *   - a task whose results include an unscored trial is an infrastructure error
 *     and leaves the denominator entirely;
 *   - a task with fewer than `k` trials cannot be scored at `k` — averaging it as
 *     zero is the biased number this lane exists to avoid;
 *   - a run where every task was unscored has no denominator at all.
 */
export function toPassAtK(
  run: TauRun,
  k: number,
): { readonly tasks: readonly PassAtKInput[]; readonly unscored: readonly string[] } {
  const groups = taskTrials(run);
  const unscored: string[] = [];
  const scoreable: PassAtKInput[] = [];
  const short: string[] = [];

  for (const group of groups) {
    if (group.rewards.some((reward) => reward === null)) {
      unscored.push(group.taskId);
      continue;
    }
    // A task with no result at all is as unscorable as one with an unscored trial:
    // the grid is incomplete either way.
    if (group.rewards.length < k) {
      short.push(`${group.taskId}(${group.rewards.length})`);
      continue;
    }
    const successes = group.rewards.filter((reward) => reward === 1).length;
    scoreable.push({ successes, trials: group.rewards.length, k, taskId: group.taskId });
  }

  if (short.length > 0) {
    throw new L4ParseError('short-grid', `${short.length} task(s) have fewer than k=${k} trials: ${short.slice(0, 5).join(', ')}`);
  }
  if (scoreable.length === 0) {
    throw new L4ParseError('no-scored-tasks', `all ${groups.length} task(s) are unscored`);
  }
  return { tasks: scoreable, unscored };
}
