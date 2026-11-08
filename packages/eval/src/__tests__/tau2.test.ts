import { describe, expect, it } from 'vitest';
import {
  actionSentence,
  correctionEdit,
  taskCorrection,
  driverArgs,
  learnableCorrections,
  parseTauTasks,
  splitTaskIds,
  unansweredTasks,
  type TauTask,
} from '../tau2.js';

const task = (overrides: Partial<TauTask> = {}): TauTask => ({
  id: 't1',
  instruction: '',
  actions: [{ name: 'get_order', arguments: { order_id: '#W1' } }],
  communicate: [],
  assertions: [],
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
            nl_assertions: ['The order status is pending.'],
          },
        },
      ],
    });
    expect(tasks).toEqual([
      {
        id: 't1',
        instruction: '',
        actions: [{ name: 'get_order', arguments: { order_id: '#W1' }, compareArgs: ['order_id'] }],
        communicate: ['the order ships Monday'],
        assertions: ['The order status is pending.'],
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
      { id: 't4', instruction: '', actions: [], communicate: [], assertions: [] },
    ]);
  });

  it('keeps a task with no criteria as a task with nothing to check', () => {
    expect(parseTauTasks({ tasks: [{ id: 't2' }] })).toEqual([
      { id: 't2', instruction: '', actions: [], communicate: [], assertions: [] },
    ]);
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

  it('teaches the rubric when the criteria name no action', () => {
    // τ²'s retail domain checks database state instead of naming calls, and in R42 twenty-five of
    // thirty-two failed tasks named no action at all: the store learned from seven of them and `V32`
    // reported the other twenty-five as questions the record lost. The assertion text is the same
    // fact in the other admissible form — what must be true at the end rather than which call makes
    // it true — and a learner that can read only the second form discards two thirds of its failures.
    expect(
      taskCorrection(
        task({
          actions: [],
          assertions: ['The order status is cancelled.', 'The payment is refunded to the gift card.'],
        }),
      ),
    ).toBe(
      'A request of this shape is resolved when: The order status is cancelled. The payment is refunded to the gift card.',
    );
  });

  it('prefers the calls when a task states both, because they are the sharper lesson', () => {
    expect(taskCorrection(task({ assertions: ['The order is cancelled.'] }))).toContain('resolved by calling');
  });

  it('teaches nothing when the criteria name neither an action nor an assertion', () => {
    expect(taskCorrection(task({ actions: [], assertions: [] }))).toBeUndefined();
  });
});

describe('the instruction, which the lane threw away for its whole life', () => {
  const first = (document: unknown) => parseTauTasks(document)[0]?.instruction;

  it('reads the bare-string shape', () => {
    expect(first({ tasks: [{ id: '7', user_scenario: { instructions: 'Swap my two orders.' } }] })).toBe(
      'Swap my two orders.',
    );
  });

  it('joins the object shape, because the topic alone recalls every topic', () => {
    // `reason_for_call: 'Refund'` is a one-line topic and `task_instructions` is
    // the request. A trigger built from the topic would fire on every refund, and a
    // trigger is only useful if it is narrower than the domain it lives in.
    expect(
      first({
        tasks: [
          {
            id: '9',
            user_scenario: {
              instructions: { reason_for_call: 'Refund', task_instructions: 'Refund the cheapest item.' },
            },
          },
        ],
      }),
    ).toBe('Refund. Refund the cheapest item.');
  });

  it('keeps whichever half of the object shape is present', () => {
    expect(
      first({
        tasks: [{ id: '9', user_scenario: { instructions: { task_instructions: 'Cancel it.' } } }],
      }),
    ).toBe('Cancel it.');
    expect(
      first({ tasks: [{ id: '9', user_scenario: { instructions: { reason_for_call: 'Cancel' } } }] }),
    ).toBe('Cancel');
  });

  it('is the empty string when the task states none, and never undefined', () => {
    // Absent and empty are one fact here: every consumer asks "is there a question
    // to show", and none of them should have to distinguish two ways of saying no.
    expect(first({ tasks: [{ id: 't2' }] })).toBe('');
    expect(first({ tasks: [{ id: 't2', user_scenario: {} }] })).toBe('');
    expect(first({ tasks: [{ id: 't2', user_scenario: { instructions: 7 } }] })).toBe('');
    expect(first({ tasks: [{ id: 't2', user_scenario: 'Swap my orders.' }] })).toBe('');
  });

  it('trims both shapes, so a padded instruction is not a padded prompt', () => {
    expect(first({ tasks: [{ id: '7', user_scenario: { instructions: '  Swap.  ' } }] })).toBe('Swap.');
    expect(
      first({
        tasks: [
          {
            id: '7',
            user_scenario: { instructions: { reason_for_call: ' Refund ', task_instructions: ' Now. ' } },
          },
        ],
      }),
    ).toBe('Refund. Now.');
  });
});

describe('correctionEdit', () => {
  it('states the calls for a correction that names them', () => {
    expect(
      correctionEdit({
        taskId: 'a',
        instruction: '',
        statement: 'A request of this shape is resolved by calling get_order(order_id="#W1"), in that order.',
        actions: [{ name: 'get_order', arguments: { order_id: '#W1' } }],
      }),
    ).toEqual({ actions: [{ name: 'get_order', arguments: { order_id: '#W1' } }] });
  });

  it('carries the rubric for a correction that names none, so the edit is not a no-op', () => {
    // The capture layer refuses an edit that does not change the output, so this payload is the
    // difference between recording 32 lessons and recording 7 -- and the refusal would have been
    // thrown in the driver's loop, ending the run at the first rubric-only task.
    const payload = correctionEdit({
      taskId: 'a',
      instruction: '',
      statement: 'A request of this shape is resolved when: the order is cancelled.',
      actions: [],
    });
    expect(payload).toEqual({
      actions: [],
      expectation: 'A request of this shape is resolved when: the order is cancelled.',
    });
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

  it('keeps a rubric-only correction, with the empty call list it really has', () => {
    const [only] = learnableCorrections(
      [task({ id: 'a', actions: [], assertions: ['The order is cancelled.'] })],
      new Map([['a', 0]]),
    );
    expect(only?.taskId).toBe('a');
    expect(only?.actions).toEqual([]);
    expect(only?.statement).toBe('A request of this shape is resolved when: The order is cancelled.');
  });

  it('carries the question on the correction, because the write path is where it went missing', () => {
    // R51. The driver passed `correction.taskId` as `input.question`, so the
    // distiller was asked to write a trigger "in the question's own terms" while
    // being shown `"a"`. The correction carries the instruction now, and the driver
    // forwards it; this assertion is the link between the parse and the event.
    const [only] = learnableCorrections(
      [task({ id: 'a', instruction: 'Cancel a shipment that has not left the warehouse.' })],
      new Map([['a', 0]]),
    );
    expect(only?.instruction).toBe('Cancel a shipment that has not left the warehouse.');
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

describe('unansweredTasks', () => {
  it('does not count a task the model already passed', () => {
    // The difference `V32` grades. A pass needs no correction and leaves the store smaller without
    // leaving a gap in the record, so counting it as unanswered would make the gate a statement
    // about the model's skill rather than about the learning the store was built from: on a τ²
    // training half where the model solves a third of the tasks, a store built from every failure
    // would still have read as 33% unanswered and failed a blocking gate.
    const tasks = [task({ id: 'a' }), task({ id: 'b' })];
    const rewards = new Map([
      ['a', 1],
      ['b', 0],
    ]);
    expect(unansweredTasks(tasks, rewards)).toEqual([]);
  });

  it('counts a failure whose criteria say nothing about what should have happened', () => {
    const tasks = [task({ id: 'a', actions: [] }), task({ id: 'b' })];
    expect(unansweredTasks(tasks, new Map([['a', 0], ['b', 0]]))).toEqual(['a']);
  });

  it('does not count a failure whose rubric states what should have happened', () => {
    // The shape this exists for: a failure that names no calls and states a rubric. Counting it as a
    // lost question would measure the lane's reader rather than the record. How often that shape occurs
    // is a property of the corpus, not of a run: 7 of the 164 shipped tasks state a rubric and name no
    // calls, per `label-census.ts`.
    const tasks = [task({ id: 'a', actions: [], assertions: ['The order is cancelled.'] })];
    expect(unansweredTasks(tasks, new Map([['a', 0]]))).toEqual([]);
  });

  it('counts a task the run never scored, because a missing measurement is not a pass', () => {
    // `bestRewards` only holds tasks that produced a scored trial. A task with none is a question
    // the driver cannot say anything about, and calling that "learned" would be the opposite error
    // to the one above: an empty store reported as a full one.
    expect(unansweredTasks([task({ id: 'a' })], new Map())).toEqual(['a']);
  });

  it('takes the threshold, so a run that scores partial credit reads its own passes', () => {
    const tasks = [task({ id: 'a' }), task({ id: 'b' }), task({ id: 'c', actions: [] })];
    const rewards = new Map([
      ['a', 0.8],
      ['b', 0.4],
      ['c', 0.4],
    ]);
    expect(unansweredTasks(tasks, rewards, 0.8)).toEqual(['c']);
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
