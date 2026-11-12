/**
 * R85 — pooling two dispatches into one reading, and refusing to pool two experiments.
 *
 * Every lift this lane reports is a difference of a few points on 57 held-out tasks, and a per-task
 * `pass^4` is a Bernoulli, so the 95% half-width at n = 57 is 12.4–12.8pp. τ² ships two domains of
 * 114 tasks each and this lane has always run one of them: the second domain's held-out split is the
 * same experiment on a different corpus, and pooling the two gives n = 114 at ±9pp plus the
 * replication that separates "the mechanism works" from "the mechanism works in retail".
 *
 * ## Why this is a module with refusals rather than a mean
 *
 * "Pool the numbers" is one line of arithmetic and it is the wrong line whenever the two numbers
 * describe two experiments. A pool whose arms differ in the unit distilled, the form asked for, the
 * trace ceiling, the population distilled from or the model that answered is not a larger sample of
 * one thing — it is a smaller sample of two, averaged. So the arithmetic is the last step and the
 * guards are the module: each arm states what it was, and a difference in anything but the domain is
 * a refusal with a sentence.
 *
 * The one condition that cannot be stated by an arm about itself is overlap. Two arms that scored the
 * same task are the same task counted twice, which inflates n and shrinks the interval in exactly the
 * direction that flatters the result. It is checked by id, and it is a refusal rather than a
 * de-duplication because a duplicate means one of the two files is not the split it claims to be.
 */

export type PoolTask = {
  readonly id: string;
  readonly passedAll: boolean;
};

/** What one arm says about itself, which is what the guards compare. */
export type PoolArm = {
  /** The domain or dispatch this arm came from, used in the reading and in the refusals. */
  readonly label: string;
  readonly tasks: readonly PoolTask[];
  /** The three-level identity of the treatment. Two arms may differ here only if they are controls. */
  readonly unit?: string;
  readonly form?: string;
  readonly traceClaims?: number;
  readonly scope?: string;
  /** The model that answered. Two models are two experiments, whoever dispatched them. */
  readonly model?: string;
};

export type PoolArmReading = {
  readonly label: string;
  readonly tasks: number;
  readonly pass4: number;
};

export type PoolReading = {
  readonly arms: readonly PoolArmReading[];
  readonly tasks: number;
  readonly pass4: number;
  /** The 95% half-width at this many tasks, as a normal approximation on a Bernoulli pass rate. */
  readonly halfWidth: number;
  /** Domains the pool covers, in the order the arms were given. */
  readonly domains: readonly string[];
};

export type PoolOutcome =
  | { readonly ok: true; readonly reading: PoolReading }
  | { readonly ok: false; readonly refusals: readonly string[] };

/** The half-width a pass rate earns at this many tasks. */
export function halfWidthOf(pass4: number, tasks: number): number {
  if (tasks <= 0) return 1;
  return 1.96 * Math.sqrt(Math.max(pass4 * (1 - pass4), 0) / tasks);
}

/** The smallest difference two pools of this size could resolve, in percentage points. */
export function detectablePp(pool: Pick<PoolReading, 'halfWidth'>): number {
  return pool.halfWidth * 100 * Math.SQRT2;
}

/**
 * The share of tasks that passed every trial.
 *
 * No empty guard: `poolArms` refuses an arm with no tasks before any mean is taken, and a guard here
 * would be a branch no run can reach -- the kind of dead protection that reads as care and is never
 * exercised.
 */
function meanPass(tasks: readonly PoolTask[]): number {
  return tasks.filter((task) => task.passedAll).length / tasks.length;
}

/**
 * The identity an arm carries: everything that must agree for two arms to be one sample.
 *
 * Returned as a list of pairs rather than compared inline, because the refusal has to say *which*
 * field disagreed and what the two values were — a pool that refused with "the arms differ" would be
 * a guard nobody could act on.
 */
function identity(arm: PoolArm): readonly (readonly [string, string])[] {
  return [
    ['unit', arm.unit === undefined ? UNRECORDED : arm.unit],
    ['form', arm.form === undefined ? UNRECORDED : arm.form],
    ['traceClaims', arm.traceClaims === undefined ? UNRECORDED : String(arm.traceClaims)],
    ['scope', arm.scope === undefined ? UNRECORDED : arm.scope],
    ['model', arm.model === undefined ? UNRECORDED : arm.model],
  ];
}

const UNRECORDED = 'unrecorded';

/**
 * The fields an arm must state before it can be pooled.
 *
 * `traceClaims` is deliberately absent from this list: the correction and raw units have no trace
 * ceiling, so its absence is a fact about the unit rather than a gap. It is still compared — between
 * two arms that state it, and between one that states it and one that does not, which is a
 * disagreement because the ceiling decides the yield.
 */
const MUST_STATE = ['unit', 'form', 'scope', 'model'] as const;

export function poolArms(arms: readonly PoolArm[]): PoolOutcome {
  const refusals: string[] = [];
  if (arms.length < 2) {
    return {
      ok: false,
      refusals: ['a pool of one arm is the arm itself: pooling exists to buy tasks, and one arm has none to add'],
    };
  }
  const empty = arms.filter((arm) => arm.tasks.length === 0).map((arm) => arm.label);
  if (empty.length > 0) {
    // An arm with no tasks is a dispatch that did not measure, and pooling it would lower the mean
    // without lowering the denominator -- or, worse, be dropped silently and leave a pool that reads
    // as two domains when it is one.
    refusals.push(`arm(s) with no tasks: ${empty.join(', ')} — a dispatch that measured nothing cannot join a pool`);
  }

  const seen = new Map<string, string>();
  const overlapping = new Set<string>();
  for (const arm of arms) {
    for (const task of arm.tasks) {
      const previous = seen.get(task.id);
      if (previous !== undefined && previous !== arm.label) overlapping.add(`${task.id} (${previous}, ${arm.label})`);
      seen.set(task.id, arm.label);
    }
  }
  if (overlapping.size > 0) {
    const shown = [...overlapping].slice(0, 5).join('; ');
    refusals.push(
      `the same task appears in two arms: ${shown}${overlapping.size > 5 ? ` and ${overlapping.size - 5} more` : ''} — ` +
        'pooling double-counts it, which inflates the sample and narrows the interval in the direction that flatters the result',
    );
  }

  const silent = arms
    .map((arm) => ({
      label: arm.label,
      fields: identity(arm)
        .filter(([name, value]) => value === UNRECORDED && (MUST_STATE as readonly string[]).includes(name))
        .map(([name]) => name),
    }))
    .filter((entry) => entry.fields.length > 0);
  if (silent.length > 0) {
    // Absence is not agreement. An artefact that does not record the unit it distilled says nothing
    // about what ran, and pooling it as though it matched is how two experiments become one number.
    const detail = silent.map((entry) => `${entry.fields.join(', ')} unrecorded on ${entry.label}`).join('; ');
    refusals.push(
      `the arms do not say what they ran: ${detail} — a field the artefact does not carry cannot be ` +
        'pooled as though the two agreed on it',
    );
  }

  const base = identity(arms[0]!);
  for (const arm of arms.slice(1)) {
    for (const [name, mine] of identity(arm)) {
      const theirs = base.find(([key]) => key === name)?.[1];
      if (theirs !== mine) {
        refusals.push(
          `the arms are two experiments, not one sample: ${name} is '${theirs}' on ${arms[0]!.label} and ` +
            `'${mine}' on ${arm.label}`,
        );
      }
    }
  }

  const ceilingStated = arms.filter((arm) => arm.traceClaims !== undefined).length;
  if (ceilingStated > 0 && ceilingStated < arms.length) {
    const missing = arms.filter((arm) => arm.traceClaims === undefined).map((arm) => arm.label);
    refusals.push(
      `one arm states a trace ceiling and another does not (${missing.join(', ')}): the ceiling decides ` +
        'the yield, so a pool that cannot compare it cannot compare the stores',
    );
  }

  if (refusals.length > 0) return { ok: false, refusals };

  const pooled = arms.flatMap((arm) => arm.tasks);
  const pass4 = meanPass(pooled);
  return {
    ok: true,
    reading: {
      arms: arms.map((arm) => ({ label: arm.label, tasks: arm.tasks.length, pass4: meanPass(arm.tasks) })),
      tasks: pooled.length,
      pass4,
      halfWidth: halfWidthOf(pass4, pooled.length),
      domains: arms.map((arm) => arm.label),
    },
  };
}

/** One line for a log, phrased so a refused pool prints its reasons rather than a number. */
export function poolLine(outcome: PoolOutcome): string {
  if (!outcome.ok) return `pool: refused — ${outcome.refusals.join('; ')}`;
  const { reading } = outcome;
  const arms = reading.arms
    .map((arm) => `${arm.label} ${arm.pass4.toFixed(4)} (n=${String(arm.tasks)})`)
    .join(', ');
  return (
    `pool: ${reading.pass4.toFixed(4)} over ${String(reading.tasks)} task(s) ` +
    `±${(reading.halfWidth * 100).toFixed(2)}pp at 95%, from ${arms}`
  );
}
