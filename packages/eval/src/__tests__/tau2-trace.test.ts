/**
 * R58 — the trace, read out of the learning half's own document.
 *
 * The unit a distiller is given decides what it can say. Until now this lane's unit was the
 * correction: `taskCorrection` renders one failed task as one sentence (*"a request of this shape is
 * resolved by calling find_user, then cancel_pending_order, in that order"*), the event carries that
 * sentence, and the model writes one rule from it. The trajectory the agent actually walked never
 * entered the prompt — it is in the run document, under `simulations[].messages`, and nothing read
 * it.
 *
 * These tests are about the reading: which messages carry a call, which trial a failed task
 * contributes, and what the prompt's payload looks like once it has both halves. They are written
 * against documents shaped like τ²'s own results file, because a reader tested only on a convenient
 * shape is a reader that will meet the real one and return nothing.
 */
import { describe, expect, it } from 'vitest';
import { buildDistillPrompt } from '@agentix-e/microglia-core/distill';
import type { FeedbackEvent, RunRecord } from '@agentix-e/microglia-core';
import {
  parseTraceCalls,
  resolveDistillUnit,
  traceOf,
  tracesOf,
  type TraceCall,
} from '../tau2-trace.js';

function assistantWith(
  ...calls: readonly { readonly name: string; readonly arguments: unknown }[]
) {
  return {
    role: 'assistant',
    content: null,
    tool_calls: calls.map((call, index) => ({
      id: `call_${String(index)}`,
      name: call.name,
      arguments: call.arguments,
    })),
  };
}

function document(simulations: readonly unknown[]) {
  return { info: {}, tasks: [], simulations };
}

describe('tracesOf', () => {
  it('reads the assistant’s calls in the order they were made', () => {
    const traces = tracesOf(
      document([
        {
          task_id: 't1',
          trial: 0,
          reward_info: { reward: 0.4 },
          messages: [
            { role: 'system', content: 'policy' },
            { role: 'user', content: 'cancel my order' },
            assistantWith({ name: 'find_user', arguments: { user_id: 'u_1' } }),
            { role: 'tool', content: '{"ok":true}' },
            assistantWith({ name: 'cancel_order', arguments: { order_id: '#W1' } }),
          ],
        },
      ]),
    );
    const trace = traces.get('t1');
    expect(trace?.attempt.map((call) => call.name)).toEqual(['find_user', 'cancel_order']);
    // The arguments are evidence: a rule about *which* call is missing is worthless without knowing
    // what the calls were asked to do.
    expect(trace?.attempt[0]?.detail).toContain('user_id="u_1"');
    expect(trace?.reward).toBe(0.4);
  });

  it('reads the other shape τ² writes, where the name sits under `function`', () => {
    const traces = tracesOf(
      document([
        {
          task_id: 't1',
          reward_info: { reward: 0 },
          messages: [
            {
              role: 'assistant',
              content: null,
              tool_calls: [
                { id: 'c1', function: { name: 'get_order', arguments: '{"id":"#W1"}' } },
              ],
            },
          ],
        },
      ]),
    );
    expect(traces.get('t1')?.attempt).toEqual([
      { name: 'get_order', detail: 'get_order(id="#W1")' },
    ]);
  });

  it('takes the trial that failed, not the first one recorded', () => {
    // A task contributes a correction because it failed, and the trace that teaches is the failing
    // attempt. Reading the first trial would explain a failure with a success.
    const traces = tracesOf(
      document([
        {
          task_id: 't1',
          trial: 0,
          reward_info: { reward: 1 },
          messages: [assistantWith({ name: 'a', arguments: {} })],
        },
        {
          task_id: 't1',
          trial: 1,
          reward_info: { reward: 0 },
          messages: [assistantWith({ name: 'b', arguments: {} })],
        },
        {
          task_id: 't1',
          trial: 2,
          reward_info: { reward: 0.5 },
          messages: [assistantWith({ name: 'c', arguments: {} })],
        },
      ]),
    );
    expect(traces.get('t1')?.attempt.map((call) => call.name)).toEqual(['b']);
    expect(traces.get('t1')?.trial).toBe(1);
  });

  it('keeps a trial that carries no reward, because an unscored attempt is still an attempt', () => {
    const traces = tracesOf(
      document([
        { task_id: 't1', trial: 0, messages: [assistantWith({ name: 'a', arguments: {} })] },
      ]),
    );
    expect(traces.get('t1')?.reward).toBeUndefined();
    expect(traces.get('t1')?.attempt).toHaveLength(1);
  });

  it('bounds the attempt and says how much it cut', () => {
    const calls = Array.from({ length: 20 }, (_, index) => ({
      name: `call_${String(index)}`,
      arguments: {},
    }));
    const traces = tracesOf(
      document([
        { task_id: 't1', reward_info: { reward: 0 }, messages: [assistantWith(...calls)] },
      ]),
      8,
    );
    expect(traces.get('t1')?.attempt).toHaveLength(8);
    expect(traces.get('t1')?.omitted).toBe(12);
  });

  it('reads nothing out of a document with no simulations, and out of a malformed one', () => {
    expect(tracesOf({}).size).toBe(0);
    expect(tracesOf({ simulations: 'not an array' }).size).toBe(0);
    expect(tracesOf(document([{ no_task_id: true }])).size).toBe(0);
    expect(tracesOf(document([null, 7, 'x'])).size).toBe(0);
  });

  it('ignores a message whose tool calls are not a list', () => {
    const traces = tracesOf(
      document([
        {
          task_id: 't1',
          reward_info: { reward: 0 },
          messages: [{ role: 'assistant', content: 'I will help', tool_calls: 'nope' }],
        },
      ]),
    );
    expect(traces.get('t1')?.attempt).toEqual([]);
  });

  it('keeps an argument string that is not JSON, because it is still what the call carried', () => {
    const calls = parseTraceCalls([
      { role: 'assistant', tool_calls: [{ name: 'reserve', arguments: 'not json at all' }] },
    ]);
    expect(calls[0]?.name).toBe('reserve');
    expect(calls[0]?.detail).toContain('not json at all');
  });

  it('renders a call with no arguments as its name, and a scalar argument as itself', () => {
    expect(
      parseTraceCalls([{ role: 'assistant', tool_calls: [{ name: 'ping' }] }])[0]?.detail,
    ).toBe('ping');
    expect(
      parseTraceCalls([{ role: 'assistant', tool_calls: [{ name: 'ping', arguments: 7 }] }])[0]
        ?.detail,
    ).toBe('ping(7)');
    expect(
      parseTraceCalls([{ role: 'assistant', tool_calls: [{ name: 'ping', arguments: null }] }])[0]
        ?.detail,
    ).toBe('ping');
  });

  it('keeps the first trial when two failed the same way', () => {
    const traces = tracesOf(
      document([
        {
          task_id: 't1',
          trial: 0,
          reward_info: { reward: 0 },
          messages: [assistantWith({ name: 'a', arguments: {} })],
        },
        {
          task_id: 't1',
          trial: 1,
          reward_info: { reward: 0 },
          messages: [assistantWith({ name: 'b', arguments: {} })],
        },
      ]),
    );
    expect(traces.get('t1')?.trial).toBe(0);
    expect(traces.get('t1')?.attempt.map((call) => call.name)).toEqual(['a']);
  });

  it('drops a call with no name rather than inventing one', () => {
    const calls = parseTraceCalls([
      {
        role: 'assistant',
        tool_calls: [{ arguments: { x: 1 } }, { name: '  ' }, { name: 'ok', arguments: {} }],
      },
    ]);
    expect(calls.map((call: TraceCall) => call.name)).toEqual(['ok']);
  });
});

describe('trace reading, on the shapes that are malformed rather than merely different', () => {
  it('skips a message that is not an object, and a function field that is not one', () => {
    const calls = parseTraceCalls([
      null,
      'assistant',
      { role: 'assistant', tool_calls: [{ name: 'ok', arguments: {}, function: 'not an object' }] },
    ]);
    expect(calls.map((call) => call.name)).toEqual(['ok']);
  });

  it('reads a simulation that states no trial as trial zero', () => {
    const traces = tracesOf(
      document([
        {
          task_id: 't1',
          reward_info: { reward: 0 },
          messages: [assistantWith({ name: 'a', arguments: {} })],
        },
      ]),
    );
    expect(traces.get('t1')?.trial).toBe(0);
  });

  it('renders an argument whose value is undefined as null rather than dropping the key', () => {
    const calls = parseTraceCalls([
      {
        role: 'assistant',
        tool_calls: [{ name: 'call', arguments: { user: undefined, order: '#W1' } }],
      },
    ]);
    expect(calls[0]?.detail).toBe('call(user=null, order="#W1")');
  });

  it('cuts a scalar detail longer than the cap too, and marks it', () => {
    const calls = parseTraceCalls([
      { role: 'assistant', tool_calls: [{ name: 'call', arguments: 'x'.repeat(400) }] },
    ]);
    expect(calls[0]?.detail.endsWith('…')).toBe(true);
    expect(calls[0]?.detail.length).toBeLessThanOrEqual(240);
  });

  it('accepts a message list that is not a list, and a call that is not an object', () => {
    expect(parseTraceCalls(undefined)).toEqual([]);
    expect(parseTraceCalls([{ role: 'assistant', tool_calls: [null, 3] }])).toEqual([]);
  });

  it('lets a scored attempt replace an unscored one, because a reward is what a failure is read from', () => {
    const traces = tracesOf(
      document([
        { task_id: 't1', trial: 0, messages: [assistantWith({ name: 'a', arguments: {} })] },
        {
          task_id: 't1',
          trial: 1,
          reward_info: { reward: 0 },
          messages: [assistantWith({ name: 'b', arguments: {} })],
        },
      ]),
    );
    expect(traces.get('t1')?.trial).toBe(1);
    expect(traces.get('t1')?.reward).toBe(0);
  });

  it('cuts a detail longer than the cap and marks the cut', () => {
    const calls = parseTraceCalls([
      { role: 'assistant', tool_calls: [{ name: 'call', arguments: { blob: 'x'.repeat(400) } }] },
    ]);
    expect(calls[0]?.detail.endsWith('…')).toBe(true);
    expect(calls[0]?.detail.length ?? 0).toBeLessThanOrEqual(240);
  });
});

describe('traceOf and the payload the prompt reads', () => {
  const trace = {
    taskId: 't1',
    trial: 0,
    attempt: [{ name: 'find_user', detail: 'find_user(user_id="u_1")' }],
    omitted: 0,
  };

  it('carries both halves of the episode, which is the whole point of the unit', () => {
    const payload = traceOf(trace, {
      expected: ['find_user(user_id="u_1")', 'get_order_details(order_id="#W1")'],
      rubric: ['The order must still be pending.'],
    });
    expect(payload['trace']).toEqual({
      attempt: ['find_user(user_id="u_1")'],
      expected: ['find_user(user_id="u_1")', 'get_order_details(order_id="#W1")'],
      rubric: ['The order must still be pending.'],
      omitted: 0,
    });
  });

  it('omits a rubric it does not have rather than writing an empty one', () => {
    const payload = traceOf(trace, { expected: [] });
    const shown = payload['trace'] as Record<string, unknown>;
    expect('rubric' in shown).toBe(false);
    expect(shown['expected']).toEqual([]);
    // The count of what did not fit travels with the trace: a prompt that shows eight of twenty
    // calls and does not say so is a prompt whose reader believes it saw the attempt.
    expect(shown['omitted']).toBe(0);
  });
});

describe('traceOf and the record a passing trajectory makes', () => {
  const trace = {
    taskId: 't1',
    trial: 0,
    attempt: [{ name: 'find_user', detail: 'find_user(user_id="u_1")' }],
    omitted: 0,
  };

  it('states the trajectory that met the checks, and no reference to differ from', () => {
    // R62. A record made from a task that passed has nothing to compare: the attempt *is* the
    // reference. Emitting an empty `expected` would be the same lie as an empty rubric — it says
    // "the reference trajectory does nothing", which is a claim about the task rather than an absence.
    const payload = traceOf(trace, { met: true, rubric: ['The order must still be pending.'] });
    expect(payload['trace']).toEqual({
      attempt: ['find_user(user_id="u_1")'],
      rubricMet: true,
      rubric: ['The order must still be pending.'],
      omitted: 0,
    });
    expect(Object.keys(payload['trace'] as Record<string, unknown>)).not.toContain('expected');
  });

  it('refuses a payload that would say both', () => {
    // The contradiction has to be refused at the boundary rather than resolved in a caller's favour:
    // a prompt that holds "here is what should have happened instead" beside "nothing should have
    // happened instead" asks the model to guess, and a guess inside a prompt is an undeclared
    // measurement.
    expect(() => traceOf(trace, { met: true, expected: ['find_user(user_id="u_1")'] })).toThrow(
      RangeError,
    );
  });

  it('omits a rubric it does not have, on the passing shape too', () => {
    const payload = traceOf(trace, { met: true });
    expect(Object.keys(payload['trace'] as Record<string, unknown>).sort()).toEqual([
      'attempt',
      'omitted',
      'rubricMet',
    ]);
  });

  it('writes an empty expected list when a repair record supplies none at all', () => {
    // Reachable now that the field is optional: a caller with a reference it could not read states
    // nothing rather than omitting the key, because the repair shape promises a list and a reader
    // that had to tell "absent" from "empty" here would be re-deriving what `met` already says.
    expect(traceOf(trace, { met: false })).toEqual({
      trace: { attempt: ['find_user(user_id="u_1")'], expected: [], omitted: 0 },
    });
  });

  it('keeps the repair shape byte for byte when `met` is absent', () => {
    // The invariant that makes R62 comparable to R61: a dispatch that distils repairs alone must read
    // exactly the payload it read before this field existed. `met: false` and an absent `met` are the
    // same payload, so a caller cannot half-migrate.
    expect(traceOf(trace, { expected: ['a(b="1")'], rubric: ['r'] })).toEqual(
      traceOf(trace, { expected: ['a(b="1")'], rubric: ['r'], met: false }),
    );
  });
});

describe('resolveDistillUnit', () => {
  it('defaults to the correction, which is what every published arm measured', () => {
    expect(resolveDistillUnit(undefined)).toBe('correction');
    expect(resolveDistillUnit('')).toBe('correction');
    expect(resolveDistillUnit('   ')).toBe('correction');
    expect(resolveDistillUnit('correction')).toBe('correction');
  });

  it('accepts the trace, case and space forgiven', () => {
    expect(resolveDistillUnit('trace')).toBe('trace');
    expect(resolveDistillUnit(' TRACE ')).toBe('trace');
  });

  it('refuses an unrecognised unit instead of measuring the default', () => {
    // A typo in a dispatch variable is a run that reports a number about a treatment it never
    // applied. `resolveDistillForm` predates this and reads garbage as its default; the unit is
    // refused, and the refusal is the difference between a wasted dispatch and a wrong reading.
    expect(() => resolveDistillUnit('traces')).toThrow(/TAU_DISTILL_UNIT/);
  });
});

describe('the hand-off the driver makes, without a driver', () => {
  it('carries an attempt read from a learning document into the prompt a model would receive', () => {
    // The driver's path is: learning document -> `tracesOf` -> `traceOf` -> the run's `input` ->
    // `buildDistillPrompt`. Every hop is a module boundary, and the run cannot report which one a
    // silent failure happened at — a prompt without the trace looks exactly like a model that
    // ignored one. This test crosses all four in one process, with no model and no tau2.
    const learned = document([
      {
        task_id: 'task-42',
        trial: 0,
        reward_info: { reward: 0 },
        messages: [
          { role: 'user', content: 'I need to cancel the order I placed yesterday.' },
          assistantWith({ name: 'cancel_pending_order', arguments: { order_id: '#W1' } }),
        ],
      },
    ]);
    const trace = tracesOf(learned).get('task-42');
    expect(trace).toBeDefined();

    const input = {
      question: 'I need to cancel the order I placed yesterday.',
      taskId: 'task-42',
      ...traceOf(trace as NonNullable<typeof trace>, {
        expected: ['get_order_details(order_id="#W1")', 'cancel_pending_order(order_id="#W1")'],
        rubric: ['The order must still be pending.'],
      }),
    };
    const event = {
      schema: 'microglia.feedback/1',
      id: 'fb_1',
      at: 1_700_000_000_000,
      namespace: 'tau2',
      sessionId: 's',
      runId: 'run_1',
      task: 'retail',
      kind: 'edit',
      actor: { type: 'user' },
      trust: 0.9,
      signal: { type: 'edit', beforeHash: 'a', afterHash: 'b', ops: [], distance: 1 },
      provenance: { knowledgeIds: [] },
      redactions: 0,
      taskId: 'task-42',
    } as FeedbackEvent;
    const run = {
      schema: 'microglia.run/1',
      id: 'run_1',
      at: 1_700_000_000_000,
      namespace: 'tau2',
      sessionId: 's',
      task: 'retail',
      input,
      output: {},
      provenance: { knowledgeIds: [] },
      feedbackIds: [],
    } as RunRecord;

    const prompt = buildDistillPrompt({ event, run }, [], undefined, 'trace');
    expect(prompt).toContain('cancel_pending_order');
    expect(prompt).toContain('get_order_details');
    expect(prompt).toContain('The order must still be pending.');
    expect(prompt).toContain('at most 3 candidates');
  });
});
