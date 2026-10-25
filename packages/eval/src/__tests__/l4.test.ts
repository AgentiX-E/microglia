import { describe, expect, it } from 'vitest';
import {
  L4ParseError,
  compareArms,
  parseTauResults,
  perTaskRows,
  resolutionOf,
  taskTrials,
  toPassAtK,
  type L4ParseReason,
} from '../l4.js';

/**
 * Documents shaped like the ones `sierra-research/tau2-bench` writes.
 *
 * The field names are taken from `src/tau2/data_model/simulation.py` at `main`
 * (read 2026-10-22): `Results{info, tasks, simulations, simulation_index}`,
 * `SimulationRun{task_id, trial, reward_info.reward}` and
 * `SimulationIndexEntry{task_id, trial, reward}`. A fixture invented here would
 * only test this file against itself.
 */
const info = { environment_info: { domain_name: 'retail' } };

function jsonForm(simulations: readonly unknown[], tasks: readonly unknown[] = [{ id: 't0' }, { id: 't1' }]): string {
  return JSON.stringify({ info, tasks, simulations });
}

function dirForm(index: readonly unknown[], tasks: readonly unknown[] = [{ id: 't0' }, { id: 't1' }]): string {
  return JSON.stringify({ info, tasks, simulation_index: index, simulations: undefined });
}

function sim(taskId: string, trial: number, reward: number | null, extra: Record<string, unknown> = {}) {
  return {
    id: `sim-${taskId}-t${trial}`,
    task_id: taskId,
    trial,
    ...(reward === null ? {} : { reward_info: { reward } }),
    termination_reason: reward === null ? 'infrastructure_error' : 'user_stop',
    ...extra,
  };
}

function reasonOf(run: () => unknown): L4ParseReason {
  try {
    run();
  } catch (error) {
    if (error instanceof L4ParseError) return error.reason;
    throw error;
  }
  throw new Error('the call did not throw');
}

describe('reading a τ²-bench run', () => {
  it('reads the monolithic form, rewards nested under reward_info', () => {
    const run = parseTauResults(jsonForm([sim('t0', 0, 1), sim('t0', 1, 0.5), sim('t1', 0, 0)]));
    expect(run.format).toBe('json');
    expect(run.domain).toBe('retail');
    expect(run.taskIds).toEqual(['t0', 't1']);
    expect(run.trials.map((trial) => [trial.taskId, trial.trial, trial.reward])).toEqual([
      ['t0', 0, 1],
      ['t0', 1, 0.5],
      ['t1', 0, 0],
    ]);
    expect(run.inferredTrials).toBe(0);
  });

  it('reads the directory form, rewards flat in the index', () => {
    const run = parseTauResults(
      dirForm([
        { id: 'a', task_id: 't0', trial: 0, reward: 1 },
        { id: 'b', task_id: 't1', trial: 0, reward: null, termination_reason: 'infrastructure_error' },
      ]),
    );
    expect(run.format).toBe('dir');
    expect(run.trials.map((trial) => trial.reward)).toEqual([1, null]);
  });

  it('accepts a numeric task id, because the index writes `int | str`', () => {
    const run = parseTauResults(
      dirForm(
        [{ task_id: 7, trial: 0, reward: 1 }],
        [{ id: 7 }],
      ),
    );
    expect(run.taskIds).toEqual(['7']);
    expect(run.trials[0]?.taskId).toBe('7');
  });

  it('indexes trials that do not carry a trial number, and says how many', () => {
    const run = parseTauResults(
      jsonForm([
        { task_id: 't0', reward_info: { reward: 1 } },
        { task_id: 't0', reward_info: { reward: 0 } },
        { task_id: 't1', reward_info: { reward: 1 } },
      ]),
    );
    expect(run.trials.map((trial) => trial.trial)).toEqual([0, 1, 0]);
    expect(run.inferredTrials).toBe(3);
  });

  it('reports no domain when the document carries none', () => {
    const run = parseTauResults(
      JSON.stringify({ tasks: [{ id: 't0' }], simulations: [{ task_id: 't0', trial: 0, reward: 1 }] }),
    );
    expect(run.domain).toBeUndefined();
  });

  it('keeps an unscored trial as null rather than as a failure', () => {
    const run = parseTauResults(jsonForm([sim('t0', 0, null), sim('t1', 0, 1)]));
    expect(run.trials[0]?.reward).toBeNull();
    expect(run.trials[0]?.terminationReason).toBe('infrastructure_error');
  });
});

describe('what the reader refuses', () => {
  it('refuses a document that is not JSON', () => {
    expect(reasonOf(() => parseTauResults('{oops'))).toBe('unreadable-json');
  });

  it('refuses a document with no task list', () => {
    expect(reasonOf(() => parseTauResults('[]'))).toBe('missing-tasks');
    expect(reasonOf(() => parseTauResults('{"tasks":{}}'))).toBe('missing-tasks');
    expect(reasonOf(() => parseTauResults('{"tasks":[{"nope":1}],"simulations":[]}'))).toBe('missing-tasks');
    // A task that is not an object at all is the same failure, not a crash.
    expect(reasonOf(() => parseTauResults('{"tasks":[42],"simulations":[]}'))).toBe('missing-tasks');
  });

  it('refuses a document with no results at all', () => {
    expect(reasonOf(() => parseTauResults('{"tasks":[{"id":"t0"}]}'))).toBe('missing-results');
  });

  it('refuses an entry that is not an object, or has no task', () => {
    expect(reasonOf(() => parseTauResults(jsonForm([42])))).toBe('bad-entry');
    expect(reasonOf(() => parseTauResults(jsonForm([{ trial: 0, reward_info: { reward: 1 } }])))).toBe('bad-entry');
  });

  it('refuses a result for a task the run does not claim', () => {
    expect(reasonOf(() => parseTauResults(jsonForm([sim('t9', 0, 1)])))).toBe('unknown-task');
  });

  it('refuses two results for the same trial', () => {
    expect(reasonOf(() => parseTauResults(jsonForm([sim('t0', 0, 1), sim('t0', 0, 0)])))).toBe('duplicate-trial');
  });

  it('refuses a reward that cannot be a τ² reward', () => {
    expect(reasonOf(() => parseTauResults(jsonForm([sim('t0', 0, 1.5)])))).toBe('bad-reward');
    expect(reasonOf(() => parseTauResults(jsonForm([sim('t0', 0, -0.1)])))).toBe('bad-reward');
  });

  it('refuses a trial that is not a non-negative integer', () => {
    expect(reasonOf(() => parseTauResults(jsonForm([{ task_id: 't0', trial: 1.5, reward: 1 }])))).toBe('bad-trial');
    expect(reasonOf(() => parseTauResults(jsonForm([{ task_id: 't0', trial: -1, reward: 1 }])))).toBe('bad-trial');
  });
});

describe('turning a run into the estimator input', () => {
  const run = parseTauResults(
    jsonForm([
      sim('t0', 0, 1),
      sim('t0', 1, 1),
      sim('t0', 2, 0.999),
      sim('t0', 3, 1),
      sim('t1', 0, 0.5),
      sim('t1', 1, 0.5),
      sim('t1', 2, 0.5),
      sim('t1', 3, 0.5),
      sim('t2', 0, 1),
      sim('t2', 1, null),
      sim('t2', 2, 1),
      sim('t2', 3, 1),
    ], [{ id: 't0' }, { id: 't1' }, { id: 't2' }]),
  );

  it('groups rewards per task, in the run order', () => {
    expect(taskTrials(run).map((group) => group.taskId)).toEqual(['t0', 't1', 't2']);
    expect(taskTrials(run)[0]?.rewards).toEqual([1, 1, 0.999, 1]);
  });

  it('scores a reward of exactly 1, and nothing else', () => {
    const { tasks } = toPassAtK(run, 4);
    // t0: three exact successes of four; t1: none.
    expect(tasks.map((task) => [task.successes, task.trials])).toEqual([
      [3, 4],
      [0, 4],
    ]);
  });

  it('drops a task with an unscored trial from the denominator, and names it', () => {
    const { tasks, unscored } = toPassAtK(run, 4);
    expect(unscored).toEqual(['t2']);
    expect(tasks).toHaveLength(2);
  });

  it('refuses a task with fewer than k trials instead of averaging it as zero', () => {
    const short = parseTauResults(jsonForm([sim('t0', 0, 1), sim('t1', 0, 1)]));
    expect(reasonOf(() => toPassAtK(short, 4))).toBe('short-grid');
  });

  it('treats a task with no result at all as a short grid, not as a zero', () => {
    const missing = parseTauResults(jsonForm([sim('t0', 0, 1), sim('t0', 1, 1), sim('t0', 2, 1), sim('t0', 3, 1)]));
    expect(reasonOf(() => toPassAtK(missing, 4))).toBe('short-grid');
  });

  it('refuses a run where nothing was scored', () => {
    // One task, fully attempted, nothing scored: the denominator is empty.
    const blank = parseTauResults(
      jsonForm(
        [sim('t0', 0, null), sim('t0', 1, null), sim('t0', 2, null), sim('t0', 3, null)],
        [{ id: 't0' }],
      ),
    );
    expect(reasonOf(() => toPassAtK(blank, 4))).toBe('no-scored-tasks');
  });
});

describe('pairing the two arms of a split', () => {
  const task = (id: string, passedAll: boolean) => ({ id, passedAll });

  it('reports no difference when the arms agree task by task', () => {
    const first = [task('a', true), task('b', false), task('c', true)];
    const comparison = compareArms(first, first);
    expect(comparison).toMatchObject({ paired: 3, deltaPp: 0, lost: 0, gained: 0, p: 1 });
    expect(comparison.onlyFirst).toBe(0);
    expect(comparison.onlySecond).toBe(0);
  });

  it('signs the delta as second minus first', () => {
    // Every task the reference passed and the memory failed: the memory is worse, so
    // the delta is negative. A sign error here would report a 66pp loss as a gain.
    const reference = [task('a', true), task('b', true), task('c', true)];
    const memory = [task('a', false), task('b', false), task('c', true)];
    const comparison = compareArms(reference, memory);
    expect(comparison.deltaPp).toBeCloseTo(-66.6666, 3);
    expect(comparison.lost).toBe(2);
    expect(comparison.gained).toBe(0);
    // Three pairs cannot exclude zero: the bootstrap over two losses and one tie puts
    // the upper bound exactly at zero, which is the honest reading of a 3-task sample.
    expect(comparison.ciHighPp).toBeLessThanOrEqual(0);
  });

  it('pairs only the tasks both arms scored, and counts the rest', () => {
    // Two runs that look like one split may not be one: a different train share moves
    // the held-out half. The intersection is what a paired test is defined on, and the
    // remainder has to be visible.
    const reference = [task('a', true), task('b', true), task('c', true)];
    const memory = [task('b', false), task('c', true), task('d', true)];
    const comparison = compareArms(reference, memory);
    expect(comparison.paired).toBe(2);
    expect(comparison.onlyFirst).toBe(1);
    expect(comparison.onlySecond).toBe(1);
    expect(comparison.lost).toBe(1);
  });

  it('returns a defined empty comparison rather than NaN when nothing overlaps', () => {
    const comparison = compareArms([task('a', true)], [task('b', true)]);
    expect(comparison).toMatchObject({ paired: 0, deltaPp: 0, p: 1, lost: 0, gained: 0 });
    expect(comparison.onlyFirst).toBe(1);
    expect(comparison.onlySecond).toBe(1);
  });
});

describe('the per-task rows an artefact carries', () => {
  it('turns a scored task into the row a pairing step joins on', () => {
    // The defect this exists for: the pairing step shipped before the artefact carried
    // per-task rows, so the comparison it was built for could not run at all.
    expect(
      perTaskRows([
        { successes: 4, trials: 4, k: 4, taskId: 't1' },
        { successes: 2, trials: 4, k: 4, taskId: 't2' },
      ]),
    ).toEqual([
      { id: 't1', successes: 4, trials: 4, passed_all: true },
      { id: 't2', successes: 2, trials: 4, passed_all: false },
    ]);
  });

  it('refuses a task with no id instead of labelling it', () => {
    // Two tasks called `unknown` would pair the wrong rows and report a difference that
    // belongs to neither arm.
    expect(() => perTaskRows([{ successes: 4, trials: 4, k: 4 }])).toThrow(L4ParseError);
  });
});

describe('what a paired comparison could have detected', () => {
  const comparison = (paired: number, lost: number, gained: number) => ({
    paired,
    onlyFirst: 0,
    onlySecond: 0,
    deltaPp: ((gained - lost) / paired) * 100,
    ciLowPp: 0,
    ciHighPp: 0,
    p: 1,
    lost,
    gained,
  });

  it('reports the half-width the sample actually buys', () => {
    // The run that made this necessary: 68 tasks, 13 lost and 14 gained.
    const resolution = resolutionOf(comparison(68, 13, 14));
    expect(resolution.standardErrorPp).toBeCloseTo(7.64, 2);
    expect(resolution.halfWidthPp).toBeCloseTo(14.98, 1);
    expect(resolution.detectableAtFivePp).toBe(false);
    // And what it would take to see a 5pp difference at that discordance rate.
    expect(resolution.tasksForFivePp).toBe(611);
  });

  it('says what a well-powered sample would need for 3pp', () => {
    expect(resolutionOf(comparison(68, 13, 14)).tasksForThreePp).toBe(1695);
  });

  it('treats perfect agreement as no resolution rather than infinite confidence', () => {
    // Zero discordance gives a zero standard error, which reads as certainty. It is the
    // opposite: two arms that never disagree say nothing about the difference between
    // them, and the required sample size is undefined rather than zero.
    const resolution = resolutionOf(comparison(68, 0, 0));
    expect(resolution.halfWidthPp).toBe(0);
    expect(resolution.tasksForFivePp).toBe(0);
    expect(resolution.detectableAtFivePp).toBe(true);
  });

  it('reports infinity when nothing was paired', () => {
    const resolution = resolutionOf(comparison(0, 0, 0));
    expect(resolution.halfWidthPp).toBe(Number.POSITIVE_INFINITY);
    expect(resolution.detectableAtFivePp).toBe(false);
  });
});
