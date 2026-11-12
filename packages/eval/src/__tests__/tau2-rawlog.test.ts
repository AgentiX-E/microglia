import { describe, expect, it } from 'vitest';
import type { FeedbackEvent, RunRecord } from '@agentix-e/microglia-core';
import type { InterpretContext } from '@agentix-e/microglia-core/distill';
import {
  RAWLOG_STATEMENT_CEILING,
  RAWLOG_TRUNCATION_MARK,
  RAWLOG_TRUST,
  rawLogCensus,
  rawLogInterpreter,
  rawLogInterpreterFor,
  rawLogStatement,
  rawLogTruncated,
} from '../tau2-rawlog.js';

/**
 * The arm that stores the record instead of a claim about it.
 *
 * Every case here asserts something the arm's *comparison* depends on rather than that a function
 * returns a string. A record that dropped the question would be a claim; a record that dropped the
 * arguments would be an abstraction; a record that merged with an identical one would have the
 * support of two episodes; and a record that was clipped without saying so would make a short
 * episode and a truncated one the same artefact.
 */

function edit(signal: Partial<Extract<FeedbackEvent['signal'], { type: 'edit' }>> = {}): FeedbackEvent {
  return {
    schema: 'microglia.feedback/1',
    id: 'fb-1',
    runId: 'run-1',
    namespace: 'tau2',
    at: 1,
    task: 'tau2.act',
    actor: { type: 'user' },
    signal: {
      type: 'edit',
      beforeHash: 'before',
      afterHash: 'after',
      ops: [],
      distance: 0.5,
      after: { actions: [] },
      ...signal,
    },
    trust: 1,
  } as unknown as FeedbackEvent;
}

function run(question: string): RunRecord {
  return {
    schema: 'microglia.run/1',
    id: 'run-1',
    at: 1,
    namespace: 'tau2',
    sessionId: 's-1',
    task: 'tau2.act',
    taskId: 'retail/3',
    input: { question },
    output: undefined,
    provenance: { model: 'test', promptVersion: 'tau2/1', domainPack: 'tau2' },
    feedbackIds: [],
  } as unknown as RunRecord;
}

const corrected = (actions: readonly Record<string, unknown>[]): Record<string, unknown> => ({
  actions,
});

describe('rawLogStatement', () => {
  it('writes the question and the corrected call, arguments included', () => {
    const statement = rawLogStatement(
      edit({ after: corrected([{ name: 'cancel_pending_order', arguments: { order_id: 'W237', reason: 'no longer needed' } }]) }),
      run('I need to cancel order W237, I do not need it any more'),
    );
    expect(statement).toBe(
      'Q: I need to cancel order W237, I do not need it any more\n' +
        'A: cancel_pending_order(order_id="W237", reason="no longer needed")',
    );
  });

  it('keeps the entity a later task quotes, which is the thing an abstraction drops', () => {
    // The whole arm in one assertion: `W237` is what the next request will name, and a claim about
    // "cancelling an order" cannot be matched by it. `Memory Tax` calls the loss of this detail
    // `faithfulness`; a record cannot lose what it never removed.
    const statement = rawLogStatement(
      edit({ after: corrected([{ name: 'exchange_delivered_order', arguments: { order_id: 'W237', new_item_ids: ['item-9'] } }]) }),
      run('exchange the shoes in W237 for a bigger size'),
    );
    expect(statement).toContain('W237');
    expect(statement).toContain('item-9');
  });

  it('records a correction that stated an expectation instead of calls', () => {
    const statement = rawLogStatement(
      edit({ after: { actions: [], expectation: 'confirm the order was placed before answering' } }),
      run('did my order go through?'),
    );
    expect(statement).toContain('A: confirm the order was placed before answering');
  });

  it('does not repeat a note the answer line already contains', () => {
    // In this lane the note *is* the correction's statement, so appending it unconditionally would
    // double every record and spend the ceiling on a duplicate of the line above it.
    const statement = rawLogStatement(
      edit({
        after: { actions: [], expectation: 'verify the delivery date' },
        note: 'verify the delivery date',
      }),
      run('when will it arrive?'),
    );
    expect(statement.match(/verify the delivery date/g)).toHaveLength(1);
  });

  it('adds a note that says something the answer line does not', () => {
    const statement = rawLogStatement(
      edit({ after: corrected([{ name: 'lookup_order', arguments: {} }]), note: 'the user gave the id in the thread' }),
      run('look it up'),
    );
    expect(statement).toContain('note: the user gave the id in the thread');
  });

  it('clips at the ceiling and marks the clip, so a short episode and a cut one differ', () => {
    const long = 'x'.repeat(RAWLOG_STATEMENT_CEILING * 2);
    const statement = rawLogStatement(edit({ after: corrected([{ name: 'answer', arguments: { text: long } }]) }), run('q'));
    expect(statement).toHaveLength(RAWLOG_STATEMENT_CEILING);
    expect(statement.endsWith(RAWLOG_TRUNCATION_MARK)).toBe(true);
    expect(rawLogTruncated(statement)).toBe(true);
    expect(rawLogTruncated('Q: short\nA: call()')).toBe(false);
  });

  it('takes its ceiling from the caller, because the default was measured on another unit', () => {
    // 700 came from R84's 640-character statement ceiling, which is a *trace* unit: a summary of one
    // tool call. A record is the whole question and the whole answer, and the corpus says its 95th
    // percentile is 1260 characters with a maximum of 1532. R85 was clipped at twelve of twelve and
    // kept 58 of 137 entity values, so the constant was measuring the cap rather than the unit.
    const long = 'x'.repeat(3000);
    const event = edit({ after: corrected([{ name: 'answer', arguments: { text: long } }]) });
    const wide = rawLogStatement(event, run('q'), 2400);
    expect(wide).toHaveLength(2400);
    expect(wide?.endsWith(RAWLOG_TRUNCATION_MARK)).toBe(true);
    // The default is unchanged, so every published arm keeps the reading it was published with.
    expect(rawLogStatement(event, run('q'))).toHaveLength(RAWLOG_STATEMENT_CEILING);
  });

  it('does not clip a record that fits a ceiling chosen for records', () => {
    // The corpus's longest record is 1532 characters, and this one is deliberately just under 2000
    // so the case is about the ceiling clearing the population rather than about a generous number.
    const text = 'x'.repeat(1800);
    const statement = rawLogStatement(
      edit({ after: corrected([{ name: 'answer', arguments: { text } }]) }),
      run('q'),
      2000,
    );
    expect(rawLogTruncated(statement ?? '')).toBe(false);
  });

  it('writes nothing for an event that is not a correction', () => {
    const rating = edit();
    const notAnEdit = { ...rating, signal: { type: 'rating', value: 'down', reasons: ['wrong'] } } as unknown as FeedbackEvent;
    expect(rawLogStatement(notAnEdit, run('q'))).toBeUndefined();
  });

  it('writes nothing when the event carries neither calls nor an expectation nor a question', () => {
    expect(rawLogStatement(edit(), undefined)).toBeUndefined();
  });
});

describe('rawLogInterpreterFor', () => {
  it('carries the ceiling into the record the interpreter writes', async () => {
    // The ceiling is a property of the experiment, and the experiment is stated in a registration
    // header. A factory rather than a second constant because two globals with one meaning is how a
    // run ends up measuring a number nobody registered.
    const long = 'x'.repeat(3000);
    const event = edit({ after: corrected([{ name: 'answer', arguments: { text: long } }]) });
    const [wide] = await rawLogInterpreterFor(2400)({ event, run: run('q') } as InterpretContext);
    const [narrow] = await rawLogInterpreter({ event, run: run('q') } as InterpretContext);
    expect(wide?.statement).toHaveLength(2400);
    expect(narrow?.statement).toHaveLength(RAWLOG_STATEMENT_CEILING);
    expect(rawLogTruncated(wide?.statement ?? '')).toBe(true);
  });

  it('refuses a ceiling that cannot hold a record, rather than writing an empty one', async () => {
    // A ceiling at or below the marker's own length would slice to a mark and store a record whose
    // entire text is "…" -- an item that exists, is counted, and says nothing. That is the shape this
    // record has paid for twice (R55.0's unreachable store, R58's no-measurement store) and it is
    // cheaper to refuse at the boundary.
    // Thrown when the arm is built rather than when it is called: a dispatch that named such a
    // ceiling has mis-specified the experiment, and the run should not pay for an episode to find out.
    expect(() => rawLogInterpreterFor(RAWLOG_TRUNCATION_MARK.length)).toThrow(/ceiling/);
    expect(() => rawLogInterpreterFor(2.5)).toThrow(/ceiling/);
  });
});

describe('rawLogInterpreter', () => {
  it('answers without a model call, which is the arm', async () => {
    // Synchronous on purpose: an abstracting writer asked to be verbatim is still an abstracting
    // writer, and R58 measured what asking one costs -- eleven faults of fifteen events.
    const result = rawLogInterpreter({
      event: edit({ after: corrected([{ name: 'call', arguments: { a: 1 } }]) }),
      run: run('q'),
    } as unknown as InterpretContext);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(1);
    expect((result as readonly { kind: string }[])[0]?.kind).toBe('exemplar');
  });

  it('gives two identical corrections two keys, because a log is not a claim with support', () => {
    const one = edit({ after: corrected([{ name: 'call', arguments: {} }]) });
    const two = { ...one, id: 'fb-2', runId: 'run-2' } as unknown as FeedbackEvent;
    const first = rawLogInterpreter({ event: one, run: run('q') } as unknown as InterpretContext);
    const second = rawLogInterpreter({ event: two, run: run('q') } as unknown as InterpretContext);
    const keys = [first, second].map((r) => (r as readonly { dedupeKey: string }[])[0]?.dedupeKey);
    expect(keys[0]).toBeDefined();
    expect(keys[0]).not.toBe(keys[1]);
  });

  it('carries the channel trust down but never up, and never below the support floor', () => {
    const lowered = rawLogInterpreter({
      event: { ...edit({ after: corrected([{ name: 'call', arguments: {} }]) }), trust: 0.4 } as unknown as FeedbackEvent,
      run: run('q'),
    } as unknown as InterpretContext);
    const raised = rawLogInterpreter({
      event: edit({ after: corrected([{ name: 'call', arguments: {} }]) }),
      run: run('q'),
    } as unknown as InterpretContext);
    expect((lowered as readonly { trust: number }[])[0]?.trust).toBe(0.4);
    // 0.9 is the policy's own "one trusted edit" case, and the floor is 0.8: a record at 0.7 is
    // stored as a candidate and reachable by nothing, which is how the first version of this arm
    // produced a store of one item and zero servable ones.
    expect(RAWLOG_TRUST).toBe(0.9);
    expect((raised as readonly { trust: number }[])[0]?.trust).toBe(RAWLOG_TRUST);
  });

  it('puts the correction on the record, so the support census can join it back to a task', () => {
    const result = rawLogInterpreter({
      event: edit({ after: corrected([{ name: 'call', arguments: {} }]) }),
      run: run('q'),
    } as unknown as InterpretContext);
    const candidate = (result as readonly { evidence: { taskId?: string; runId: string } }[])[0];
    expect(candidate?.evidence.taskId).toBe('retail/3');
    expect(candidate?.evidence.runId).toBe('run-1');
  });
});

describe('rawLogCensus', () => {
  it('counts from the store and records the ban as off rather than as zero refusals', () => {
    const census = rawLogCensus([
      { statement: 'Q: a\nA: call()' },
      { statement: `Q: ${'y'.repeat(RAWLOG_STATEMENT_CEILING)}${RAWLOG_TRUNCATION_MARK}` },
    ]);
    expect(census).toEqual({ records: 2, clipped: 1, toolBan: false });
  });

  it('reports zero records for an empty store, which is a measurement and not an absence', () => {
    expect(rawLogCensus([])).toEqual({ records: 0, clipped: 0, toolBan: false });
    // The ceiling travels with the census, because R85 wrote twelve clipped records and no ceiling, so
    // its artefact could not say whether a registration chose the number or a default did.
    expect(rawLogCensus([], 2000)).toEqual({ records: 0, clipped: 0, toolBan: false, ceiling: 2000 });
  });
});
