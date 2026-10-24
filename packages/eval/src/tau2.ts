/**
 * The parts of the τ²-bench lane that are pure.
 *
 * L4 has two halves. The first — reading a finished run and scoring pass^k — is
 * `l4.ts` and `passk.ts`, both tested against the two storage forms upstream ships.
 * The second is *running* one: install an agent, run a split, and turn the failures
 * into corrections the memory can learn from. That half is a driver, and everything
 * in it that is decidable is here, because a driver whose scoring conditions live
 * in a Python subprocess is a driver nobody can test.
 *
 * ## What the upstream task format establishes
 *
 * From `sierra-research/tau2-bench` at the ref this repository pins
 * (`src/tau2/data_model/tasks.py`): a `Task` carries `id`, `user_scenario`, and
 * `evaluation_criteria`, and the criteria carry `actions` (each with `name`,
 * `arguments`, and an optional `compare_args`), `communicate_info`, and
 * `nl_assertions`. A failed episode is therefore actionable: the criteria say
 * exactly which tool calls should have happened.
 *
 * That is the property this module exploits. The BIRD lane learns from a wrong
 * query; τ² learns from a *missing or wrong tool call*, which is a sharper
 * correction and the reason the lane is worth running at all.
 */
import type { Json } from '@agentix-e/microglia-core';
import { L4ParseError } from './l4.js';

export type TauAction = {
  readonly name: string;
  /** The tool arguments exactly as the task states them; the store accepts JSON. */
  readonly arguments: Readonly<Record<string, Json>>;
  /** Which arguments the evaluator actually compares, when it says. */
  readonly compareArgs?: readonly string[];
};

export type TauTask = {
  readonly id: string;
  readonly actions: readonly TauAction[];
  /** Facts the agent is supposed to tell the user. */
  readonly communicate: readonly string[];
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);
}

function parseAction(value: unknown, taskId: string): TauAction {
  const record = asRecord(value);
  if (record === undefined) {
    throw new L4ParseError('bad-entry', `task ${taskId}: an action is not an object`);
  }
  const name = record['name'];
  if (typeof name !== 'string' || name.length === 0) {
    throw new L4ParseError('bad-entry', `task ${taskId}: an action has no name`);
  }
  const rawArguments = record['arguments'];
  const args = asRecord(rawArguments);
  if (args === undefined) {
    throw new L4ParseError('bad-entry', `task ${taskId}: action ${name} has no argument object`);
  }
  const compare = asStringArray(record['compare_args']);
  return {
    name,
    arguments: args as Record<string, Json>,
    ...(compare.length === 0 ? {} : { compareArgs: compare }),
  };
}

/**
 * Read the task definitions a τ² results document carries.
 *
 * A document without a `tasks` array is refused rather than treated as an empty
 * split: the difference between "this run covered nothing" and "this document is
 * not a run" is the difference between a zero and a bug.
 */
export function parseTauTasks(document: unknown): TauTask[] {
  const record = asRecord(document);
  if (record === undefined) throw new L4ParseError('unreadable-json', 'the document is not an object');
  const raw = record['tasks'];
  if (!Array.isArray(raw)) throw new L4ParseError('missing-tasks', 'the document has no `tasks` array');
  return raw.map((entry) => {
    const task = asRecord(entry);
    if (task === undefined) throw new L4ParseError('bad-entry', 'a task is not an object');
    const id = task['id'];
    if (typeof id !== 'string' || id.length === 0) {
      throw new L4ParseError('bad-entry', 'a task has no id');
    }
    const criteria = asRecord(task['evaluation_criteria']);
    const actions = criteria?.['actions'];
    return {
      id,
      actions: Array.isArray(actions) ? actions.map((action) => parseAction(action, id)) : [],
      communicate: asStringArray(criteria?.['communicate_info']),
    };
  });
}

/** One tool call as a line a person - or a distiller - can act on. */
export function actionSentence(action: TauAction): string {
  const entries = Object.entries(action.arguments).map(([key, value]) => {
    const rendered =
      typeof value === 'string' ? JSON.stringify(value) : typeof value === 'object' ? JSON.stringify(value) : String(value);
    return `${key}=${rendered}`;
  });
  return `${action.name}(${entries.join(', ')})`;
}

/**
 * What a failed episode teaches: the calls that were expected.
 *
 * Deliberately the *actions* and not the reward. A reward of 0.4 says an episode
 * went badly; the criteria say which tool calls were missing, and that is the only
 * form in which a correction can be learned and later applied.
 */
export function taskCorrection(task: TauTask): string | undefined {
  if (task.actions.length === 0) return undefined;
  const calls = task.actions.map(actionSentence).join(', then ');
  return `A request of this shape is resolved by calling ${calls}, in that order.`;
}

export type Correction = {
  readonly taskId: string;
  readonly statement: string;
  readonly actions: readonly TauAction[];
};

/**
 * The corrections a split teaches, given the rewards it produced.
 *
 * A task contributes one correction when its reward is below `threshold`, and none
 * when it passed: learning from a success would teach the memory that an episode
 * which already worked needs different handling.
 */
export function learnableCorrections(
  tasks: readonly TauTask[],
  rewards: ReadonlyMap<string, number>,
  threshold = 1,
): Correction[] {
  const out: Correction[] = [];
  for (const task of tasks) {
    const reward = rewards.get(task.id);
    if (reward === undefined || reward >= threshold) continue;
    const statement = taskCorrection(task);
    if (statement === undefined) continue;
    out.push({ taskId: task.id, statement, actions: task.actions });
  }
  return out;
}

/**
 * Split task ids into a training half and a held-out half, deterministically.
 *
 * Sorted before slicing so the split depends on the id set and not on the order a
 * document happens to list them: two dispatches over the same tasks must learn from
 * the same half, or the comparison between them is between two experiments.
 */
export function splitTaskIds(
  ids: readonly string[],
  trainShare = 0.5,
): { readonly train: readonly string[]; readonly test: readonly string[] } {
  if (!(trainShare > 0 && trainShare < 1)) {
    throw new RangeError(`trainShare must be strictly between 0 and 1, received ${String(trainShare)}`);
  }
  const sorted = [...new Set(ids)].sort();
  const cut = Math.round(sorted.length * trainShare);
  return { train: sorted.slice(0, cut), test: sorted.slice(cut) };
}

export type DriverCommand = {
  readonly command: 'python' | 'python3' | 'uv';
  readonly args: readonly string[];
};

/**
 * The argv for one phase of a τ² run.
 *
 * Built here rather than in the caller so the shape is testable: a driver that
 * passes `--trials` where the script expects `--num-trials` fails after the
 * environment is installed, which is the most expensive possible moment to find
 * out.
 */
export function driverArgs(input: {
  readonly script: string;
  readonly domain: string;
  readonly phase: 'learn' | 'eval';
  readonly taskIds: readonly string[];
  readonly trials: number;
  readonly out: string;
  readonly agent: 'llm_agent' | 'microglia_agent';
  readonly memoryUrl?: string;
  readonly maxSteps?: number;
  readonly seed?: number;
}): string[] {
  const args = [
    input.script,
    '--domain',
    input.domain,
    '--phase',
    input.phase,
    '--agent',
    input.agent,
    '--trials',
    String(input.trials),
    '--out',
    input.out,
    '--tasks',
    [...input.taskIds].sort().join(','),
  ];
  if (input.memoryUrl !== undefined) args.push('--memory-url', input.memoryUrl);
  if (input.maxSteps !== undefined) args.push('--max-steps', String(input.maxSteps));
  if (input.seed !== undefined) args.push('--seed', String(input.seed));
  return args;
}
