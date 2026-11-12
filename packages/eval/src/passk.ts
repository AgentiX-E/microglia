/**
 * pass^k — the metric τ²-bench is reported in.
 *
 * A task counts as solved on one trial or it does not; `pass^k` asks for k
 * independent successes in a row, because an agent that succeeds one time in four
 * is not a reliable agent. The estimator is the unbiased one, `C(c, k) / C(n, k)`:
 * the share of k-subsets of the n trials that are all successes. It is not
 * `(c/n)^k`, which is the biased plug-in and understates a deterministic agent.
 *
 * Pure arithmetic, so the number can be checked before any model is called — the
 * mistake this prevents is running a two-hour lane and only then discovering the
 * denominator was wrong.
 */
export type PassAtKInput = {
  /** Successful trials for one task. */
  readonly successes: number;
  /** Trials run for that task. */
  readonly trials: number;
  readonly k: number;
  /**
   * Which task this is, when the caller knows.
   *
   * Optional because the estimator does not need it — `pass^k` is a per-task number
   * and the mean is over tasks — but a *comparison* between two arms does: two runs
   * of the same split can only be paired task by task if the tasks are named. The
   * first two full L4 arms were measured without it, and the only thing that could
   * be reported was the difference between two means.
   */
  readonly taskId?: string;
  /**
   * The trials in the order they ran, when the caller kept them.
   *
   * `pass^k` is a function of the counts and does not need the order. Retention does: the probability
   * that a task still passes at trial `t+1` given that it passed at trial `t` is a property of the
   * sequence, and an artefact that records only `4 of 4` cannot tell a run that passed four times in a
   * row from one that passed the first and the last. The published result this metric comes from
   * (*Learning on the Job*, arXiv 2607.22157) reports it as **hold rate** beside pass^1, and on this
   * lane's artefacts it was not computable at all until the field existed.
   *
   * Optional because every artefact written before it existed carries counts only, and a reconstruction
   * from a count would be an invention: four successes in four trials is one sequence, not four.
   */
  readonly outcomes?: readonly boolean[];
};

/** Unbiased pass^k for one task, in [0, 1]. */
export function passAtK(input: PassAtKInput): number {
  const { successes, trials, k } = input;
  if (!Number.isInteger(k) || k < 1) throw new RangeError(`k must be a positive integer, got ${k}`);
  if (!Number.isInteger(trials) || trials < 0) throw new RangeError('trials must be a non-negative integer');
  if (!Number.isInteger(successes) || successes < 0) throw new RangeError('successes must be non-negative');
  if (successes > trials) throw new RangeError('successes cannot exceed trials');
  if (k > trials) return 0;
  return combinations(successes, k) / combinations(trials, k);
}

/** The mean over tasks: each task contributes one pass^k, whatever its trial count. */
export function meanPassAtK(tasks: readonly PassAtKInput[]): number {
  if (tasks.length === 0) return 0;
  return tasks.reduce((sum, task) => sum + passAtK(task), 0) / tasks.length;
}

/**
 * A lane is only a comparison if both sides are measured the same way. Returns
 * the difference and whether it clears a stated bar, so a caller cannot report
 * "beat the published number" from a raw subtraction.
 */
export function compareToPublished(measured: number, published: number, bar: number): {
  readonly delta: number;
  readonly meets: boolean;
} {
  const delta = measured - published;
  return { delta, meets: delta >= bar };
}

function combinations(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let result = 1;
  for (let i = 0; i < k; i += 1) result = (result * (n - i)) / (i + 1);
  return result;
}

/** The two numbers a τ² lane is allowed to claim, in one place. */
export type L4Verdict = {
  readonly pass4: number;
  readonly published: number;
  readonly delta: number;
  readonly tasks: number;
  readonly meetsBar: boolean;
  readonly coversSplit: boolean;
};

/**
 * Judge an L4 run without running one.
 *
 * The gate has two clauses and they fail for different reasons: the effect can
 * miss the bar while the split is fully covered, or the split can be short while
 * the effect looks good. Collapsing them into one boolean is how a 12-task probe
 * becomes a published "we beat ALTK-Evolve", so they stay separate here and the
 * caller must report both.
 */
export function l4Verdict(options: {
  readonly tasks: readonly PassAtKInput[];
  readonly published: number;
  readonly bar: number;
  readonly minTasks?: number;
}): L4Verdict {
  const pass4 = meanPassAtK(options.tasks);
  const compared = compareToPublished(pass4, options.published, options.bar);
  return {
    pass4,
    published: options.published,
    delta: compared.delta,
    tasks: options.tasks.length,
    meetsBar: compared.meets,
    coversSplit: options.tasks.length >= (options.minTasks ?? 60),
  };
}

/**
 * Retention: how often a task that passed a trial passed the next one.
 *
 * `pass^k` answers *did it hold every time*; this answers *does it hold on*, and the two move
 * separately. The published form is P(pass at t+1 | pass at t), pooled over consecutive pairs inside
 * each task — pooled rather than averaged per task, because a task with one held pair is not the same
 * evidence as a task with three.
 *
 * Three refusals, each for a way the number can be invented rather than measured:
 *
 *   - a task with no `outcomes` contributes nothing, and is counted in `withoutOrder` so a rate over
 *     two tasks cannot be read as a rate over ten;
 *   - a task whose first trial failed contributes no held pair — it is evidence about recovery, which
 *     this metric does not measure, and folding it in would make the rate look like pass^1;
 *   - no pairs at all is `undefined`, not zero. Zero says the knowledge never held; `undefined` says
 *     this run cannot answer.
 */
/**
 * What retention needs from a task: the trials in order, and nothing else.
 *
 * Structural rather than `PassAtKInput` because the two documents that carry an order disagree about
 * everything else — an arm's `per_task` rows keep counts, its `per_trial` ledger keeps episodes, and a
 * third reader keeps only `outcomes`. The statistic is the same number over all three.
 */
export type HoldInput = { readonly outcomes?: readonly boolean[] };

export type HoldRate = {
  /** Tasks that carried an ordered outcome list. */
  readonly ordered: number;
  /** Tasks that carried counts only, so they cannot contribute. */
  readonly withoutOrder: number;
  /** Consecutive pairs whose first trial passed. */
  readonly pairs: number;
  /** Of those, the ones whose second trial passed too. */
  readonly held: number;
  readonly rate: number | undefined;
};

export function holdRate(tasks: readonly HoldInput[]): HoldRate {
  let ordered = 0;
  let withoutOrder = 0;
  let pairs = 0;
  let held = 0;
  for (const task of tasks) {
    const outcomes = task.outcomes;
    if (outcomes === undefined) {
      withoutOrder += 1;
      continue;
    }
    ordered += 1;
    for (let index = 0; index + 1 < outcomes.length; index += 1) {
      if (outcomes[index] !== true) continue;
      pairs += 1;
      if (outcomes[index + 1] === true) held += 1;
    }
  }
  return { ordered, withoutOrder, pairs, held, rate: pairs === 0 ? undefined : held / pairs };
}
