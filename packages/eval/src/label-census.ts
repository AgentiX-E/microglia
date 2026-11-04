/**
 * What a published benchmark's labels carry, counted.
 *
 * The reason this exists as code rather than as a paragraph: two of this repository's own claims
 * about τ²-bench were made from a run's counters and turned out to be backwards. The corpus is the
 * part of the experiment we do not control, so its shape gets measured out of the file itself, at
 * the pinned ref, and printed beside the run that consumes it.
 *
 * Three distinctions the census keeps, because collapsing any of them produced a wrong sentence:
 *
 *  - **Calls versus prose.** A task can name the tool calls that resolve it, state a rubric in
 *    natural language, do both, or do neither. `retail` and `airline` at v0.2.0 sit at opposite ends
 *    of this axis, so a statement that starts "the benchmark states X" is a statement about one
 *    domain wearing the other's name.
 *  - **Present versus scored.** `EvaluationCriteria.reward_basis` defaults to `[DB, COMMUNICATE]`
 *    (`src/tau2/data_model/tasks.py`, v0.2.0). `actions` is the label for `ACTION`, which is not in
 *    that default, so a corpus that never declares a basis carries call lists the reward does not
 *    read. That is a fact about the benchmark, and a learner trained on those lists is learning
 *    something the evaluator never checks — which is worth knowing before attributing a null to the
 *    memory.
 *  - **Silent versus rubric-only.** A rubric-only task can be learned as a procedure. A task that
 *    states nothing cannot be learned at all, and is the only shape that can justify an "unanswered"
 *    count. The difference bounds how much of a run's `unanswered` the corpus can explain.
 */

/** The basis upstream applies when a task does not state one (`EvaluationCriteria.reward_basis`). */
export const UPSTREAM_DEFAULT_BASIS = ['DB', 'COMMUNICATE'] as const;

/** One task, reduced to the facts the census reads. */
export type LabelCensusTask = {
  readonly id: string;
  /** The task's reference tool calls, one entry per call. */
  readonly actions: readonly unknown[];
  /** The task's prose rubric, one entry per assertion. */
  readonly assertions: readonly string[];
  /** The facts the task requires the agent to tell the user. */
  readonly communicate: readonly string[];
  /**
   * The task's own reward basis.
   *
   * `undefined` is silence and inherits {@link UPSTREAM_DEFAULT_BASIS}; `[]` is a statement that
   * nothing is scored. The two are not merged, because a corpus that opted out of every reward and
   * one that took the default are different measurements.
   */
  readonly rewardBasis?: readonly string[];
};

/** The census of one corpus. Every field counts tasks, never entries. */
export interface LabelCensus {
  readonly tasks: number;
  /** Tasks that name at least one tool call. */
  readonly calls: number;
  /** Tasks that state at least one prose assertion. */
  readonly rubric: number;
  /** Tasks that state at least one fact the agent must communicate. */
  readonly communicate: number;
  /** Tasks a learner can read something from: calls or rubric. */
  readonly teachable: number;
  /** Tasks that name no call and state no rubric, whatever else they carry: the bound on `unanswered`. */
  readonly unteachable: number;
  /** Tasks that carry no label of any kind. */
  readonly silent: number;
  /** Tasks that declare a basis of their own. */
  readonly declaredBasis: number;
  /** Tasks whose call list is outside the basis the reward is computed over. */
  readonly unscoredCalls: number;
}

/** Count one corpus. */
export function labelCensus(tasks: readonly LabelCensusTask[]): LabelCensus {
  let calls = 0;
  let rubric = 0;
  let communicate = 0;
  let teachable = 0;
  let unteachable = 0;
  let silent = 0;
  let declaredBasis = 0;
  let unscoredCalls = 0;
  for (const task of tasks) {
    const named = task.actions.length > 0;
    const stated = task.assertions.length > 0;
    const facts = task.communicate.length > 0;
    if (named) calls += 1;
    if (stated) rubric += 1;
    if (facts) communicate += 1;
    if (named || stated) teachable += 1;
    else unteachable += 1;
    if (!named && !stated && !facts) silent += 1;
    const declared = task.rewardBasis;
    if (declared !== undefined) declaredBasis += 1;
    const basis = declared ?? UPSTREAM_DEFAULT_BASIS;
    if (named && !basis.includes('ACTION')) unscoredCalls += 1;
  }
  return {
    tasks: tasks.length,
    calls,
    rubric,
    communicate,
    teachable,
    unteachable,
    silent,
    declaredBasis,
    unscoredCalls,
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringsOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);
}

/**
 * Read a corpus into the shape {@link labelCensus} counts.
 *
 * Both storage forms are accepted because both are quoted in this repository: the domain files ship a
 * bare list (`data/tau2/domains/retail/tasks.json` at v0.2.0), and a run's results file wraps the same
 * tasks in `tasks` (`Results.tasks`, `src/tau2/data_model/results`). A reader that took only one of
 * them would have to be duplicated to compare the corpus against the run, which is the comparison
 * that makes the census worth printing.
 *
 * Absent is not the same as empty here: `reward_basis` missing means the task inherits upstream's
 * default, and `reward_basis: []` means it scores nothing. Feeding both through `stringsOf` would
 * have reported the first as the second.
 */
export function readLabelCensusTasks(document: unknown): LabelCensusTask[] {
  const listed = Array.isArray(document) ? document : asRecord(document)?.['tasks'];
  if (!Array.isArray(listed)) {
    throw new RangeError('census: the document is neither a task list nor an object with `tasks`');
  }
  return listed.map((entry) => {
    const task = asRecord(entry);
    if (task === undefined) throw new RangeError('census: a task is not an object');
    const id = task['id'];
    if (typeof id !== 'string' || id === '') throw new RangeError('census: a task has no id');
    const criteria = asRecord(task['evaluation_criteria']);
    const actions = criteria?.['actions'];
    const basis = criteria?.['reward_basis'];
    if (basis !== undefined && !Array.isArray(basis)) {
      throw new RangeError(`census: task ${id} has a reward_basis that is not a list`);
    }
    return {
      id,
      actions: Array.isArray(actions) ? actions : [],
      assertions: stringsOf(criteria?.['nl_assertions']),
      communicate: stringsOf(criteria?.['communicate_info']),
      ...(basis === undefined ? {} : { rewardBasis: stringsOf(basis) }),
    };
  });
}
