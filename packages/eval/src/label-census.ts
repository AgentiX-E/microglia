/**
 * What a published benchmark's labels carry, counted.
 *
 * The reason this exists as code rather than as a paragraph: two of this repository's own claims about
 * τ²-bench were made from a run's counters, and the corpus disagrees with both of them. The corpus is
 * the part of the experiment we do not control, so its shape is measured out of the files themselves,
 * at the pinned ref, and printed beside the run that consumes it.
 *
 * ## What the pinned ref establishes
 *
 * At `sierra-research/tau2-bench` v0.2.0, three facts decide what a label is worth, and none of them is
 * a matter of interpretation:
 *
 *  - `EvaluationCriteria.reward_basis` defaults to `[DB, COMMUNICATE]` (`src/tau2/data_model/tasks.py`,
 *    `default_factory`).
 *  - The reward is the product of exactly the components whose `RewardType` appears in that basis
 *    (`src/tau2/evaluator/evaluator.py:92-118`). `NL_ASSERTION` and `ACTION` are components like any
 *    other, so a task that does not declare them is not graded on them.
 *  - `actions` is nonetheless *consumed* on the `DB` path: `EnvironmentEvaluator` replays the reference
 *    trajectory onto a fresh environment and compares DB hashes
 *    (`src/tau2/evaluator/evaluator_env.py:93-111`). The call list is therefore the definition of the
 *    target end state, not a trajectory the agent has to walk — which is why `pathScored` and `calls`
 *    are different numbers, and why "the reward does not read these calls" would be the wrong sentence.
 *
 * The prose rubric is the label that *is* read by nothing in the default configuration: `nl_assertions`
 * gates the reward only under `NL_ASSERTION`, and no task in either shipped scenario declares it. A
 * learner that turns that prose into a lesson is learning from commentary on the graded outcome, which
 * is admissible and is a weaker claim about the benchmark than a replay-derived end state.
 *
 * ## Three distinctions the census keeps
 *
 * Collapsing any of them produced a wrong sentence somewhere in this repository's history: **calls
 * versus prose**, **present versus graded**, and **silent versus rubric-only** — the third bounds how
 * much of a run's `unanswered` a corpus can explain; the others bound nothing.
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
   * nothing is scored. The two are not merged, because a corpus that opted out of every reward and one
   * that took the default are different measurements.
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
  /** Tasks whose call list is graded as a trajectory (`ACTION` in the basis). */
  readonly pathScored: number;
  /** Tasks whose prose rubric is graded (`NL_ASSERTION` in the basis). */
  readonly rubricGraded: number;
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
  let pathScored = 0;
  let rubricGraded = 0;
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
    if (basis.includes('ACTION')) pathScored += 1;
    if (basis.includes('NL_ASSERTION')) rubricGraded += 1;
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
    pathScored,
    rubricGraded,
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
 * tasks in `tasks` (`Results.tasks`). A reader that took only one of them would have to be duplicated to
 * compare the corpus against the run, which is the comparison that makes the census worth printing.
 *
 * Absent is not the same as empty here: `reward_basis` missing means the task inherits upstream's
 * default, and `reward_basis: []` means it scores nothing. Feeding both through `stringsOf` would have
 * reported the first as the second.
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
