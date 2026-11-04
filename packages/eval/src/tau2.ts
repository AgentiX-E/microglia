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
  /**
   * The task's own success criteria in prose, for the tasks that state a rubric instead of calls.
   *
   * Both scenarios write both forms, in different proportions: at v0.2.0 `retail` names calls on 112
   * of 114 tasks and states prose on 8, while `airline` states prose on all 50 and names calls on 43
   * (`label-census.ts` counts them out of the files). A learner that could read only the first form
   * would have nothing to learn from 7 of the 164 tasks -- the airline tasks that state a rubric and
   * name no calls, of which there are seven -- so the assertion text is carried here as the other
   * admissible form of the same fact.
   */
  readonly assertions: readonly string[];
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
      assertions: asStringArray(criteria?.['nl_assertions']),
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
 * What a failed episode teaches: the calls that were expected, or the rubric that names no calls.
 *
 * Deliberately the criteria and not the reward. A reward of 0.4 says an episode went badly; the
 * criteria say what should have happened, and that is the only form in which a correction can be
 * learned and later applied.
 *
 * The calls come first because they are the sharper lesson — an order of tool names with their
 * arguments can be followed without interpretation. The prose rubric is the fallback for the domains
 * that check state rather than calls, and it is a *different* statement, not a weaker copy of the
 * first: it says what must be true at the end, which the distiller turns into a procedure the model
 * can act on. A task that states neither teaches nothing and is counted as such by `unansweredTasks`.
 */
export function taskCorrection(task: TauTask): string | undefined {
  if (task.actions.length > 0) {
    const calls = task.actions.map(actionSentence).join(', then ');
    return `A request of this shape is resolved by calling ${calls}, in that order.`;
  }
  if (task.assertions.length > 0) {
    return `A request of this shape is resolved when: ${task.assertions.join(' ')}`;
  }
  return undefined;
}

export type Correction = {
  readonly taskId: string;
  readonly statement: string;
  readonly actions: readonly TauAction[];
};

/**
 * The corrected output one correction is recorded as.
 *
 * `complete` states what the agent did — the call names, in order — and `edit` states what should
 * have happened. The two must differ, because the capture layer refuses an edit that changes nothing
 * (`MG_E_INVALID_SIGNAL`, "Edit does not change the output"). That refusal is reachable: a rubric-only
 * task recorded against a completion that made no calls would state an empty call list on both sides,
 * and the event would stop the learning loop rather than teach it. It is the 7 of 164 shipped tasks that
 * state a rubric and name no calls, not the twenty-five of thirty-two an earlier reading of R42
 * attributed to it — that count was the driver's arithmetic, not the corpus (the census bounds every
 * corpus claim: 2 of 114 retail tasks state neither form, 7 airline tasks state prose alone). The rubric
 * travels as `expectation` beside the empty call list, which is the same fact in the form the event
 * can carry, and it is what the distiller reads.
 */
export function correctionEdit(correction: Correction): Record<string, Json> {
  const actions = correction.actions.map((action) => ({
    name: action.name,
    // A mutable copy: the store's payload type is JSON, and a readonly tuple of readonly actions is
    // not assignable to it, which is the type system asking for a value that cannot be aliased into
    // the record.
    arguments: { ...action.arguments },
  }));
  return correction.actions.length > 0 ? { actions } : { actions, expectation: correction.statement };
}

/**
 * The statement one task teaches, or `undefined` when it teaches nothing.
 *
 * Both callers of this — the corrections and the unanswered ledger — ask the same question in
 * different words, and they must answer it the same way: a task that teaches and a task that does
 * not are the two halves of one decision, and two copies of the decision drift.
 */
function teachingOf(task: TauTask, reward: number | undefined, threshold: number): string | undefined {
  if (reward === undefined || reward >= threshold) return undefined;
  return taskCorrection(task);
}

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
    const teaching = teachingOf(task, rewards.get(task.id), threshold);
    if (teaching === undefined) continue;
    out.push({ taskId: task.id, statement: teaching, actions: task.actions });
  }
  return out;
}

/**
 * The learning questions the driver could not read: the gap `V32` is about.
 *
 * Three ways a training task can leave the store empty, and only two of them are a gap.
 *
 *  - It **passed**. Nothing went wrong, so there is nothing to record, and a store built from every
 *    failure is the store the fold paid for. Counting a pass here would turn the gate into a
 *    statement about the model's skill: on a τ² training half where the model solves a third of the
 *    tasks, a store built from every single failure would read as 33% unanswered and fail a
 *    blocking gate — which is exactly what the driver's `train.length - corrections.length`
 *    arithmetic did before this function existed.
 *  - It **failed with no criteria**, or **was never scored**. The run knows something went wrong and
 *    cannot say what, so the correction the failure should have become does not exist. That is the
 *    question the record lost, and it is what `unanswered` counts.
 *
 * The threshold travels with the caller's, so a run that scores partial credit reads its own passes
 * as passes here too.
 */
export function unansweredTasks(
  tasks: readonly TauTask[],
  rewards: ReadonlyMap<string, number>,
  threshold = 1,
): string[] {
  const out: string[] = [];
  for (const task of tasks) {
    const reward = rewards.get(task.id);
    const passed = reward !== undefined && reward >= threshold;
    if (passed) continue;
    if (teachingOf(task, reward, threshold) !== undefined) continue;
    out.push(task.id);
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
