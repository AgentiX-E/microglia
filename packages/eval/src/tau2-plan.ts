/**
 * Which tasks an arm learns from, and which it is scored on.
 *
 * ## Why this is not four lines in the driver
 *
 * A driver decides the split in the middle of a run that costs an hour, and the two properties that
 * matter are invisible from outside it: the halves must be disjoint, and a task's identity must
 * survive the boundary between two scenarios. τ² gives every domain its own task list and numbers
 * each from zero, so `retail`'s task `3` and `airline`'s task `3` are different tasks with the same
 * name. A plan that carried bare ids across a domain boundary would hand the protocol a training set
 * and an evaluation set that intersect completely, and `V2-fold-partition` would report every
 * evaluated task as leaked — a defect in the plan published as a defect in the run.
 *
 * The qualification is therefore part of the identity, not a prefix added for display: every id this
 * module returns is `scenario/task`, and a caller that writes one of these ids into a record has
 * written a name that cannot collide.
 *
 * ## The two shapes
 *
 * | scenarios | train | test |
 * |---|---|---|
 * | one | the first `trainShare` of the pool | the rest |
 * | two | every learned id, capped | every evaluated id, capped |
 *
 * A cross-domain arm has nothing to split: the store learns from one scenario and answers the other,
 * so the held-out half is the whole evaluated list and the share has no denominator to act on.
 * Validating it there would refuse a run over a knob that is not read, which is how a configuration
 * starts lying about itself.
 */
import { splitTaskIds } from './tau2.js';

/** The id of one task, qualified by the scenario that owns it. */
export function qualifiedId(scenario: string, id: string): string {
  return `${scenario}/${id}`;
}

/** The benchmark's own halves, as `split_tasks.json` states them. */
export type TaskSplit = {
  readonly train: readonly string[];
  readonly test: readonly string[];
};

/**
 * Read the split τ² publishes, or say why the document is not one.
 *
 * This exists because the lane was cutting the corpus itself. `TRAIN_SHARE = 0.5` took the
 * lexicographically first 57 of retail's 114 tasks, while the benchmark ships
 * `data/tau2/domains/<domain>/split_tasks.json` with **74 train and 40 test** — so every held-out number
 * this lane has produced was measured on a set the benchmark does not define and the competitor did not
 * use, and the comparison was cross-split on top of cross-model.
 *
 * A document with an empty half, an overlap, or a field that is not a list is refused: a split that
 * silently loses a task is a denominator nobody stated, which is the defect class this repository keeps
 * auditing.
 */
export function splitFromOfficial(document: unknown): TaskSplit {
  const record = asRecord(document);
  if (record === undefined) {
    throw new RangeError('a task split is not an object');
  }
  const half = (key: 'train' | 'test'): string[] => {
    const value = record[key];
    if (!Array.isArray(value) || value.length === 0) {
      throw new RangeError(`a task split names no \`${key}\` tasks`);
    }
    const ids = value.map((entry) => {
      if (typeof entry !== 'string' || entry.length === 0) {
        throw new RangeError(`a task split names a \`${key}\` task that is not an id`);
      }
      return entry;
    });
    if (new Set(ids).size !== ids.length) {
      throw new RangeError(`a task split repeats a \`${key}\` task`);
    }
    return ids;
  };
  const train = half('train');
  const test = half('test');
  const overlap = train.filter((id) => test.includes(id));
  if (overlap.length > 0) {
    throw new RangeError(
      `a task split holds ${String(overlap.length)} task(s) in both halves: ${overlap.slice(0, 3).join(', ')}`,
    );
  }
  return { train, test };
}

export type HeldOutPlanInput = {
  /** Task ids the learning half may draw from, as the scenario states them. */
  readonly learnIds: readonly string[];
  /** Task ids the evaluated half may draw from, as the scenario states them. */
  readonly evalIds: readonly string[];
  readonly learnScenario: string;
  readonly testScenario: string;
  /** Share of the pool the learning half takes, on one scenario. Unread across two. */
  readonly trainShare: number;
  /** Tasks the learning half keeps; `0` or absent means all of them. */
  readonly trainCap?: number;
  /** Tasks the evaluated half keeps; `0` or absent means all of them. */
  readonly evalCap?: number;
  /**
   * The benchmark's own halves, when the arm runs the split the benchmark defines.
   *
   * Absent means the lane cuts the pool itself, which is what every arm before R92 did. Present means
   * `trainShare` is not read at all: the halves are the ones a competitor's number can be compared to,
   * and a share applied on top of them would silently move the boundary the comparison rests on.
   */
  readonly official?: TaskSplit;
};

export type HeldOutPlan = {
  readonly train: readonly string[];
  readonly test: readonly string[];
  /** Whether the two halves come from different scenarios, which is what a transfer arm is. */
  readonly crossDomain: boolean;
  readonly learnScenario: string;
  readonly testScenario: string;
};

/** `0` means "no cap", and a negative or fractional cap is a caller error rather than a policy. */
function capOf(value: number | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative integer, received ${String(value)}`);
  }
  return value === 0 ? undefined : value;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function qualified(ids: readonly string[], scenario: string): readonly string[] {
  return [...new Set(ids.map((id) => qualifiedId(scenario, id)))].sort();
}

function take<T>(list: readonly T[], cap: number | undefined): readonly T[] {
  return cap === undefined ? list : list.slice(0, cap);
}

export function heldOutPlan(input: HeldOutPlanInput): HeldOutPlan {
  const trainCap = capOf(input.trainCap, 'trainCap');
  const evalCap = capOf(input.evalCap, 'evalCap');
  const crossDomain = input.learnScenario !== input.testScenario;

  // The benchmark's split, when the arm states one. Checked against the pool rather than trusted: a
  // published split file that names a task this run does not list is a corpus mismatch, and a run that
  // absorbed it would evaluate fewer tasks than its registration says.
  //
  // One scenario only. A transfer arm learns from one domain and answers another, and no published
  // document states which foreign tasks are held out — an official split applied there would be a
  // boundary invented by this file.
  if (input.official !== undefined) {
    if (crossDomain) {
      throw new RangeError(
        'an official task split belongs to one scenario; a transfer arm has no published halves',
      );
    }
    const pool = new Set(qualified([...input.learnIds, ...input.evalIds], input.testScenario));
    const named = [...input.official.train, ...input.official.test].map((id) =>
      qualifiedId(input.testScenario, id),
    );
    const missing = named.filter((id) => !pool.has(id));
    if (missing.length > 0) {
      throw new RangeError(
        `the official split names ${String(missing.length)} task(s) this corpus does not hold: ` +
          missing.slice(0, 3).join(', '),
      );
    }
    return {
      train: take(qualified(input.official.train, input.learnScenario), trainCap),
      test: take(qualified(input.official.test, input.testScenario), evalCap),
      crossDomain: false,
      learnScenario: input.learnScenario,
      testScenario: input.testScenario,
    };
  }

  if (crossDomain) {
    return {
      train: take(qualified(input.learnIds, input.learnScenario), trainCap),
      test: take(qualified(input.evalIds, input.testScenario), evalCap),
      crossDomain: true,
      learnScenario: input.learnScenario,
      testScenario: input.testScenario,
    };
  }

  // The union rather than one list: on one scenario both halves are drawn from the same pool, and a
  // caller that named only one of them would otherwise silently drop tasks it said it had.
  const pool = qualified([...input.learnIds, ...input.evalIds], input.testScenario);
  const split = splitTaskIds(pool, input.trainShare);
  return {
    train: take(split.train, trainCap),
    test: take(split.test, evalCap),
    crossDomain: false,
    learnScenario: input.learnScenario,
    testScenario: input.testScenario,
  };
}
