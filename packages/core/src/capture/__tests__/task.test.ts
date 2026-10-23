import { describe, expect, it } from 'vitest';
import { MicrogliaError } from '../../kernel/index.js';
import { EmbeddedMemory, MemoryJournal } from '../../memory/index.js';
import { openMicroglia } from '../index.js';
import type { Microglia } from '../microglia.js';

async function host(): Promise<Microglia> {
  const store = await EmbeddedMemory.open(new MemoryJournal());
  return openMicroglia({ app: 'acme', namespace: 'acme', store });
}

function codeOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof MicrogliaError) return error.code;
    throw error;
  }
  throw new Error('expected the call to throw');
}

describe('task instance', () => {
  it('carries the session a task was opened with', async () => {
    const mg = await host();
    const task = mg.openTask({ taskId: 'T-9', taskType: 'chart.recommend', sessionId: 's-1' });
    const run = task.begin({ attempt: 1, input: { question: 'q' } });
    await run.complete({ mark: 'line' });
    expect((await task.complete({ status: 'accepted' })).sessionId).toBe('s-1');
  });

  it('records a task opened without a session at all', async () => {
    // A host that never had a session — a batch job, a queue worker — must still get
    // a task record; the field is absent rather than the string "undefined".
    const mg = await host();
    const task = mg.openTask({ taskId: 'T-0', taskType: 'chart.recommend' });
    const run = task.begin({ attempt: 1, input: { question: 'q' } });
    await run.complete({ mark: 'line' });
    const record = await task.complete({ status: 'accepted' });
    expect(record).not.toHaveProperty('sessionId');
    expect(record.taskId).toBe('T-0');
  });

  it('groups attempts and records the terminal decision', async () => {
    const mg = await host();
    const task = mg.openTask({ taskId: 'T-1', taskType: 'chart.recommend' });

    const first = task.begin({ attempt: 1, input: { question: 'sales by month' } });
    await first.complete({ mark: 'bar' });

    const second = task.begin({
      attempt: 2,
      parentRunId: first.id,
      input: { question: 'sales by month' },
    });
    await second.complete({ mark: 'line' });

    expect(second.record?.taskId).toBe('T-1');
    expect(second.record?.attempt).toBe(2);
    expect(second.record?.parentRunId).toBe(first.id);

    const record = await task.complete({ status: 'accepted', finalRunId: second.id });
    expect(record).toMatchObject({ taskId: 'T-1', status: 'accepted', attempts: 2 });

    // The decision is evidence: one outcome event, attributed to the final run.
    const stats = await mg.stats();
    expect(stats.events).toBe(1);
    await mg.close();
  });

  it('refuses a reused attempt number', async () => {
    const mg = await host();
    const task = mg.openTask({ taskId: 'T-2', taskType: 'chart.recommend' });
    task.begin({ attempt: 1, input: { q: 1 } });
    expect(codeOf(() => task.begin({ attempt: 1, input: { q: 1 } }))).toBe('MG_E_TASK_CONFLICT');
    expect(codeOf(() => task.begin({ attempt: 3, input: { q: 1 } }))).toBe('MG_E_TASK_CONFLICT');
    await mg.close();
  });

  it('refuses a write after the task is closed, and a second decision', async () => {
    const mg = await host();
    const task = mg.openTask({ taskId: 'T-3', taskType: 'chart.recommend' });
    const run = task.begin({ attempt: 1, input: { q: 1 } });
    await run.complete({ mark: 'bar' });
    await task.complete({ status: 'abandoned' });
    expect(codeOf(() => task.begin({ attempt: 2, input: { q: 1 } }))).toBe('MG_E_TASK_CLOSED');
    await expect(task.complete({ status: 'accepted' })).rejects.toThrow(/closed/i);
    await mg.close();
  });

  it('validates its inputs', async () => {
    const mg = await host();
    expect(codeOf(() => mg.openTask({ taskId: '', taskType: 'x' }))).toBe('MG_E_CONFIG');
    expect(codeOf(() => mg.openTask({ taskId: 'T-4', taskType: '' }))).toBe('MG_E_CONFIG');
    const task = mg.openTask({ taskId: 'T-5', taskType: 'chart.recommend' });
    expect(codeOf(() => task.begin({ attempt: 0, input: {} }))).toBe('MG_E_CONFIG');
    await mg.close();
  });

  it('exposes an open task before a decision and never invents one', async () => {
    const mg = await host();
    const task = mg.openTask({ taskId: 'T-7', taskType: 'chart.recommend', sessionId: 's-9' });
    expect(task.record).toBeUndefined();
    expect(task.attemptCount).toBe(0);
    const run = task.begin({ attempt: 1, input: { q: 1 } });
    await run.complete({ mark: 'bar' });
    expect(task.attemptCount).toBe(1);
    expect(run.record?.sessionId).toBe('s-9');
    expect(task.record).toBeUndefined();
    await mg.close();
  });

  it('refuses to decide a task that has no attempt, or an unknown attempt', async () => {
    const mg = await host();
    const empty = mg.openTask({ taskId: 'T-8', taskType: 'chart.recommend' });
    await expect(empty.complete({ status: 'accepted' })).rejects.toThrow(/no attempt/i);

    const task = mg.openTask({ taskId: 'T-9', taskType: 'chart.recommend' });
    const first = task.begin({ attempt: 1, input: { q: 1 } });
    await first.complete({ mark: 'bar' });
    const second = task.begin({ attempt: 2, input: { q: 2 } });
    // An attempt that produced nothing cannot be the one a decision judges.
    await expect(task.complete({ status: 'accepted', finalRunId: second.id })).rejects.toThrow(
      /no output/i,
    );
    await expect(task.complete({ status: 'accepted', finalRunId: 'run_nope' })).rejects.toThrow(
      /not an attempt/i,
    );
    await mg.close();
  });

  it('rejects names that are too long and attempts that are not integers', async () => {
    const mg = await host();
    const long = 'x'.repeat(121);
    expect(codeOf(() => mg.openTask({ taskId: long, taskType: 'x' }))).toBe('MG_E_CONFIG');
    expect(codeOf(() => mg.openTask({ taskId: 'T', taskType: long }))).toBe('MG_E_CONFIG');
    const task = mg.openTask({ taskId: 'T-10', taskType: 'chart.recommend' });
    expect(codeOf(() => task.begin({ attempt: 1.5, input: {} }))).toBe('MG_E_CONFIG');
    await mg.close();
  });

  it('reports an abandoned task as an unsuccessful outcome', async () => {
    const mg = await host();
    const task = mg.openTask({ taskId: 'T-6', taskType: 'chart.recommend' });
    const run = task.begin({ attempt: 1, input: { q: 1 } });
    await run.complete({ mark: 'bar' });
    const record = await task.complete({ status: 'abandoned', reasonCode: 'user-cancelled' });
    expect(record.reasonCode).toBe('user-cancelled');
    const events = await mg.store.listEvents({ namespace: 'acme' });
    expect(events).toHaveLength(1);
    // The reason code is preserved when the host gives one, because "abandoned
    // because the customer left" and "abandoned because the tool failed" are
    // different evidence, and only the host knows which happened.
    expect(events[0]?.signal).toMatchObject({ type: 'outcome', ok: false, code: 'user-cancelled' });
    expect(events[0]?.taskId).toBe('T-6');
    await mg.close();
  });
});
