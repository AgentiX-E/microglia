import { describe, expect, it } from 'vitest';
import {
  actionSentence,
  taskCorrection,
  driverArgs,
  learnableCorrections,
  parseTauTasks,
  splitTaskIds,
  type TauTask,
} from '../tau2.js';

const task = (overrides: Partial<TauTask> = {}): TauTask => ({
  id: 't1',
  actions: [{ name: 'get_order', arguments: { order_id: '#W1' } }],
  communicate: [],
  ...overrides,
});

describe('parseTauTasks', () => {
  it('reads the criteria the evaluator stores', () => {
    const tasks = parseTauTasks({
      tasks: [
        {
          id: 't1',
          evaluation_criteria: {
            actions: [{ name: 'get_order', arguments: { order_id: '#W1' }, compare_args: ['order_id'] }],
            communicate_info: ['the order ships Monday'],
          },
        },
      ],
    });
    expect(tasks).toEqual([
      {
        id: 't1',
        actions: [{ name: 'get_order', arguments: { order_id: '#W1' }, compareArgs: ['order_id'] }],
        communicate: ['the order ships Monday'],
      },
    ]);
  });

  it('omits compare_args when the evaluator does not constrain them', () => {
    const [parsed] = parseTauTasks({
      tasks: [{ id: 't1', evaluation_criteria: { actions: [{ name: 'get_order', arguments: { a: 1 } }] } }],
    });
    expect(parsed?.actions[0]).toEqual({ name: 'get_order', arguments: { a: 1 } });
    expect(parsed?.actions[0]).not.toHaveProperty('compareArgs');
  });

  it('treats criteria with a non-array actions field as nothing to check', () => {
    expect(parseTauTasks({ tasks: [{ id: 't4', evaluation_criteria: { actions: null } }] })).toEqual([
      { id: 't4', actions: [], communicate: [] },
    ]);
  });

  it('keeps a task with no criteria as a task with nothing to check', () => {
    expect(parseTauTasks({ tasks: [{ id: 't2' }] })).toEqual([{ id: 't2', actions: [], communicate: [] }]);
  });

  it('drops non-string entries in the arrays instead of inventing them', () => {
    const [parsed] = parseTauTasks({
      tasks: [
        {
          id: 't3',
          evaluation_criteria: {
            actions: [],
            communicate_info: ['kept', 7, null, ''],
          },
        },
      ],
    });
    expect(parsed?.communicate).toEqual(['kept']);
  });

  it('refuses a document that is not a run', () => {
    expect(() => parseTauTasks(null)).toThrow(/not an object/);
    expect(() => parseTauTasks({})).toThrow(/no `tasks` array/);
    expect(() => parseTauTasks({ tasks: {} })).toThrow(/no `tasks` array/);
  });

  it('refuses a malformed task rather than skipping it', () => {
    expect(() => parseTauTasks({ tasks: [7] })).toThrow(/a task is not an object/);
    expect(() => parseTauTasks({ tasks: [{ id: '' }] })).toThrow(/a task has no id/);
  });

  it('refuses a malformed action rather than guessing its call', () => {
    expect(() => parseTauTasks({ tasks: [{ id: 't', evaluation_criteria: { actions: [null] } }] })).toThrow(
      /an action is not an object/,
    );
    expect(() =>
      parseTauTasks({ tasks: [{ id: 't', evaluation_criteria: { actions: [{ arguments: {} }] } }] }),
    ).toThrow(/an action has no name/);
    expect(() =>
      parseTauTasks({ tasks: [{ id: 't', evaluation_criteria: { actions: [{ name: 'go' }] } }] }),
    ).toThrow(/has no argument object/);
  });
});

describe('actionSentence', () => {
  it('renders a call the way a person would write it', () => {
    expect(actionSentence({ name: 'get_order', arguments: { order_id: '#W1' } })).toBe('get_order(order_id="#W1")');
  });

  it('keeps numbers bare and objects as JSON', () => {
    expect(actionSentence({ name: 'set', arguments: { n: 3, flag: true, nested: { a: 1 } } })).toBe(
      'set(n=3, flag=true, nested={"a":1})',
    );
  });

  it('renders a call with no arguments without a dangling separator', () => {
    expect(actionSentence({ name: 'ping', arguments: {} })).toBe('ping()');
  });
});

describe('taskCorrection', () => {
  it('states the calls in the order the evaluator expects', () => {
    expect(
      taskCorrection(
        task({
          actions: [
            { name: 'get_order', arguments: { order_id: '#W1' } },
            { name: 'cancel', arguments: { order_id: '#W1', reason: 'late' } },
          ],
        }),
      ),
    ).toBe('A request of this shape is resolved by calling get_order(order_id="#W1"), then cancel(order_id="#W1", reason="late"), in that order.');
  });

  it('teaches nothing when the criteria name no action', () => {
    expect(taskCorrection(task({ actions: [] }))).toBeUndefined();
  });
});

describe('learnableCorrections', () => {
  it('takes the failures and leaves the passes alone', () => {
    const tasks = [task({ id: 'a' }), task({ id: 'b' }), task({ id: 'c' })];
    const rewards = new Map([
      ['a', 0.4],
      ['b', 1],
    ]);
    const corrections = learnableCorrections(tasks, rewards);
    // `c` has no reward recorded: an unscored task teaches nothing, because a
    // missing measurement is not a failure.
    expect(corrections.map((entry) => entry.taskId)).toEqual(['a']);
  });

  it('skips a failure whose criteria are empty', () => {
    expect(learnableCorrections([task({ id: 'a', actions: [] })], new Map([['a', 0]]))).toEqual([]);
  });

  it('honours a threshold below one, for runs that score partial credit', () => {
    const tasks = [task({ id: 'a' }), task({ id: 'b' })];
    const rewards = new Map([
      ['a', 0.8],
      ['b', 0.4],
    ]);
    expect(learnableCorrections(tasks, rewards, 0.8).map((entry) => entry.taskId)).toEqual(['b']);
  });
});

describe('splitTaskIds', () => {
  it('sorts and dedupes before cutting, so the split is a function of the id set', () => {
    const first = splitTaskIds(['b', 'a', 'c', 'd']);
    const second = splitTaskIds(['d', 'c', 'b', 'a', 'b']);
    expect(first).toEqual(second);
    expect(first.train).toEqual(['a', 'b']);
    expect(first.test).toEqual(['c', 'd']);
  });

  it('rounds the cut rather than truncating an odd split in one direction', () => {
    expect(splitTaskIds(['a', 'b', 'c']).train).toEqual(['a', 'b']);
    expect(splitTaskIds(['a', 'b', 'c']).test).toEqual(['c']);
  });

  it('handles an empty split without inventing ids', () => {
    expect(splitTaskIds([])).toEqual({ train: [], test: [] });
  });

  it('refuses a share that would empty a side', () => {
    expect(() => splitTaskIds(['a'], 0)).toThrow(RangeError);
    expect(() => splitTaskIds(['a'], 1)).toThrow(RangeError);
    expect(() => splitTaskIds(['a'], Number.NaN)).toThrow(RangeError);
  });
});

describe('driverArgs', () => {
  it('names every flag the driver script reads', () => {
    const args = driverArgs({
      script: 'run_split.py',
      domain: 'retail',
      phase: 'eval',
      taskIds: ['b', 'a'],
      trials: 4,
      out: 'results.json',
      agent: 'microglia_agent',
    });
    expect(args).toEqual([
      'run_split.py',
      '--domain',
      'retail',
      '--phase',
      'eval',
      '--agent',
      'microglia_agent',
      '--trials',
      '4',
      '--out',
      'results.json',
      '--tasks',
      'a,b',
    ]);
  });

  it('passes the optional flags only when they are set', () => {
    const base = {
      script: 's.py',
      domain: 'airline',
      phase: 'learn' as const,
      taskIds: ['a'],
      trials: 1,
      out: 'o.json',
      agent: 'llm_agent' as const,
    };
    expect(driverArgs(base)).not.toContain('--memory-url');
    const full = driverArgs({ ...base, memoryUrl: 'http://127.0.0.1:9000', maxSteps: 50, seed: 300 });
    expect(full).toContain('--memory-url');
    expect(full[full.indexOf('--max-steps') + 1]).toBe('50');
    expect(full[full.indexOf('--seed') + 1]).toBe('300');
  });
});
