/**
 * The same pair, read on the endpoint that can actually resolve it.
 *
 * ## Why a second endpoint rather than a bigger sample
 *
 * Every paired verdict this lane publishes is a sign test over `pass^4`: a task counts once, and it
 * counts only if all four trials passed. That is the number the field reports and the number the
 * published bar is stated in, so it has to stay. It also throws away everything between "three of
 * four" and "four of four", and on this bench that is where almost all the movement is — R58's pair
 * moved ten tasks *up* to perfect and nine *down* from it, and its 95% interval was ±15pp wide.
 * `tasksForThreePp` on that sample is 1423; retail has 115 tasks in total. A design that needs
 * twelve times the bench to see a three-point effect cannot be improved by running it more.
 *
 * The rate endpoint keeps the trials. A task's rate is `successes / trials`, so a task that went
 * from three of four to four of four contributes +0.25 instead of a coin flip, and 26 of R58's 57
 * tasks carry a nonzero difference rather than the 19 that changed hands. On that sample the
 * interval narrows from ±15.0pp to ±5.5pp and the sample a 3pp effect needs falls from 1423 to 398.
 * Still more than retail has — the honest conclusion is that this bench can resolve about eight
 * points and no mechanism here is that large — but four times closer, and the direction becomes
 * visible at the size the published record argues about.
 *
 * ## What it is not
 *
 * It is not a substitute verdict, and it does not decide anything. Two endpoints on one sample can
 * disagree, and when they do the disagreement is the finding: R58 reads **+1.75pp** on `pass^4` and
 * **−1.32pp** on the rate, because the arm lifted ten near-misses to perfect and lowered fourteen
 * other tasks by more than a quarter. Averaging that away is what the last six registrations each
 * did in their own way.
 *
 * The endpoint was chosen after seeing how wide the binary interval was, which is a decision that
 * has to be declared rather than discovered: it is reported as a secondary reading of an existing
 * sample, no direction is claimed from it, and every registration that wants to decide on it must
 * name it before the dispatch. `endpointsAgree` is the diagnostic that keeps a reader from picking
 * whichever of the two they prefer.
 */

/** One task's outcome on one arm, as the artefact stores it. */
export type TaskRate = {
  readonly id: string;
  readonly successes: number;
  readonly trials: number;
};

export type RateDelta = {
  /** Tasks present on both arms. A task scored on one arm only is counted in the two fields below. */
  readonly pairs: number;
  readonly onlyFirst: number;
  readonly onlySecond: number;
  /** Mean of the per-task differences, in percentage points. */
  readonly deltaPp: number;
  /** Standard deviation of those differences, in percentage points. */
  readonly sdPp: number;
  /**
   * Standard error of the mean, in percentage points.
   *
   * `null` with fewer than two pairs: one task has no spread, and reporting `0` there would print a
   * perfectly determined estimate from a sample of one.
   */
  readonly sePp: number | null;
  readonly ciLowPp: number | null;
  readonly ciHighPp: number | null;
  /** `delta / se`, or `null` when the standard error is `null` or zero. */
  readonly z: number | null;
  /**
   * The smallest delta this many tasks could detect at 80% power, in percentage points.
   *
   * `2.802 · se`, the same constant `power.ts` uses, so a rate reading and a binary reading are
   * quoted on one convention.
   */
  readonly minDetectablePp: number | null;
  /** Tasks whose rate rose, fell, and did not move. */
  readonly up: number;
  readonly down: number;
  readonly tied: number;
};

/** `z` for α = 0.05 two-sided at 80% power, as `power.ts` and `resolution.ts` use it. */
const Z_80 = 2.802;

/** `z` for a two-sided 95% interval. */
const Z_95 = 1.959964;

function rateOf(task: TaskRate): number | null {
  // A task with no trials has no rate. `trials` is four by protocol, so this is a guard rather than
  // a case: a zero would read as a total failure and move the mean by 1/n of a whole task.
  return task.trials > 0 ? task.successes / task.trials : null;
}

/**
 * The paired difference on per-task pass rate.
 *
 * `first` minus `second`, task by task, over the tasks both arms scored. The arithmetic is the
 * paired mean and its standard error; nothing is pooled across tasks, because the arms saw the same
 * tasks and that is the whole reason this reading is tighter than the binary one.
 */
export function pairedRateDelta(
  first: readonly TaskRate[],
  second: readonly TaskRate[],
): RateDelta {
  const left = new Map<string, number>();
  for (const task of first) {
    const rate = rateOf(task);
    if (rate !== null) left.set(task.id, rate);
  }
  const right = new Map<string, number>();
  for (const task of second) {
    const rate = rateOf(task);
    if (rate !== null) right.set(task.id, rate);
  }

  const differences: number[] = [];
  let up = 0;
  let down = 0;
  let tied = 0;
  for (const [id, value] of left) {
    const other = right.get(id);
    if (other === undefined) continue;
    const difference = value - other;
    differences.push(difference);
    if (difference > 0) up += 1;
    else if (difference < 0) down += 1;
    else tied += 1;
  }
  let onlySecond = 0;
  for (const id of right.keys()) if (!left.has(id)) onlySecond += 1;

  const pairs = differences.length;
  const deltaPp = pairs === 0 ? 0 : (differences.reduce((sum, value) => sum + value, 0) / pairs) * 100;
  let sdPp = 0;
  if (pairs > 1) {
    const variance =
      differences.reduce((sum, value) => sum + (value * 100 - deltaPp) ** 2, 0) / (pairs - 1);
    sdPp = Math.sqrt(variance);
  }
  const sePp = pairs > 1 ? sdPp / Math.sqrt(pairs) : null;
  const halfWidth = sePp === null ? null : Z_95 * sePp;
  return {
    pairs,
    onlyFirst: left.size - pairs,
    onlySecond,
    deltaPp,
    sdPp,
    sePp,
    ciLowPp: halfWidth === null ? null : deltaPp - halfWidth,
    ciHighPp: halfWidth === null ? null : deltaPp + halfWidth,
    z: sePp === null || sePp === 0 ? null : deltaPp / sePp,
    minDetectablePp: sePp === null ? null : Z_80 * sePp,
    up,
    down,
    tied,
  };
}

export type EndpointAgreement = {
  /** The binary reading's delta, in percentage points, as the pair file prints it. */
  readonly binaryPp: number;
  /** The rate reading's delta, in percentage points. */
  readonly ratePp: number;
  /**
   * Whether the two endpoints point the same way.
   *
   * A tie on either side is agreement: "no effect" and "a small effect" are not a contradiction,
   * and calling that a disagreement would make every null pair look like a conflict.
   */
  readonly agree: boolean;
};

/**
 * Whether the binary and rate endpoints point the same way on one sample.
 *
 * This is the reading that stops a report from quoting whichever endpoint it prefers. It says
 * nothing about which is right: the binary endpoint asks *did the task become reliable*, the rate
 * asks *did the arm move the task at all*, and an arm that lifts ten near-misses to perfect while
 * lowering fourteen other tasks answers the two questions differently on purpose.
 */
export function endpointsAgree(binaryPp: number, ratePp: number): EndpointAgreement {
  const agree = binaryPp === 0 || ratePp === 0 || Math.sign(binaryPp) === Math.sign(ratePp);
  return { binaryPp, ratePp, agree };
}

/** How many paired tasks a given effect needs at 80% power, or `null` when the spread is unknown. */
export function tasksForEffectPp(delta: RateDelta, targetPp: number): number | null {
  if (delta.sePp === null || targetPp <= 0) return null;
  // n scales linearly with the variance, and the variance of the mean is sd²/n, so the sample a
  // target needs is `(2.802 · sd / target)²`. Derived from the observed spread rather than assumed.
  const sd = delta.sdPp;
  return Math.ceil(((Z_80 * sd) / targetPp) ** 2);
}
