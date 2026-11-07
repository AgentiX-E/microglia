import { describe, expect, it } from 'vitest';
import { defaultPolicy, fixedClock, mulberry32 } from '../../kernel/index.js';
import type { DistillCandidate, FeedbackEvent } from '../../kernel/index.js';
import { EmbeddedMemory, MemoryJournal } from '../../memory/index.js';
import { distill, type Interpreter } from '../index.js';

const AT = 1_700_000_000_000;

/** One correction, one task. The statement is what the interpreter reports. */
function event(id: string, task: string, at = AT): FeedbackEvent {
  return {
    schema: 'microglia.feedback/1',
    id,
    at,
    namespace: 'acme',
    sessionId: 's1',
    runId: `run_${id}`,
    task,
    kind: 'edit',
    actor: { type: 'user' },
    trust: 0.9,
    signal: {
      type: 'edit',
      beforeHash: 'a',
      afterHash: 'b',
      ops: [],
      distance: 0.5,
      after: { mark: 'line' },
    },
    provenance: { knowledgeIds: [] },
    redactions: 0,
  };
}

/**
 * An interpreter that reports one claim per event, phrased by the caller.
 *
 * Real `DistillCandidate` objects and a real store: the point of these tests is
 * what the write path does, so the only thing replaced is the model call.
 */
function interpreterFor(
  statements: Readonly<Record<string, string>>,
): Interpreter {
  return (context) => {
    const statement = statements[context.event.id];
    if (statement === undefined) return [];
    const candidate: DistillCandidate = {
      namespace: 'acme',
      kind: 'constraint',
      scope: { task: context.event.task, domain: 'sales' },
      statement,
      evidence: {
        feedbackId: context.event.id,
        runId: context.event.runId,
        at: context.event.at,
        weight: 0.9,
      },
      trust: 0.9,
      dedupeKey: `k_${context.event.id}`,
    };
    return [candidate];
  };
}

async function run(
  events: readonly FeedbackEvent[],
  statements: Readonly<Record<string, string>>,
  admission?: { threshold?: number; topS?: number },
) {
  const memory = await EmbeddedMemory.open(new MemoryJournal());
  for (const entry of events) await memory.appendEvent(entry);
  const report = await distill({
    memory,
    policy: defaultPolicy,
    clock: fixedClock(AT + 60_000),
    random: mulberry32(7),
    interpreter: interpreterFor(statements),
    ...(admission === undefined ? {} : { admission }),
  });
  return { memory, report };
}

const RULE = 'Revenue questions use a line chart rather than a bar chart.';
const REPHRASED = 'Revenue questions use a line chart rather than a bar chart';

describe('admission is off until a host asks for it', () => {
  it('stores the same lesson twice when two tasks derive it in different words', async () => {
    // This is the behaviour every lane before this one measured: the exact dedupe
    // key carries the scope, so the second task cannot see the first task's rule.
    // Two items, one observation each, and neither corroborates the other.
    const events = [event('fb_a', 'chart.recommend'), event('fb_b', 'chart.explain')];
    const { memory, report } = await run(events, { fb_a: RULE, fb_b: REPHRASED });
    expect(report.created).toBe(2);
    expect(report.suppressed).toBe(0);
    expect(report.rephrased).toBe(0);
    const items = await memory.listKnowledge({ namespace: 'acme', status: 'all' });
    expect(items).toHaveLength(2);
    await memory.close();
  });
});

describe('admission merges the paraphrase instead of storing it', () => {
  it('keeps one item and gives it both tasks of evidence', async () => {
    const events = [event('fb_a', 'chart.recommend'), event('fb_b', 'chart.explain')];
    const { memory, report } = await run(events, { fb_a: RULE, fb_b: REPHRASED }, {});
    expect(report).toMatchObject({ created: 1, merged: 1, rephrased: 1, suppressed: 0 });

    const items = await memory.listKnowledge({ namespace: 'acme', status: 'all' });
    expect(items).toHaveLength(1);
    const survivor = items[0];
    // One phrasing survives, both observations count: the item now stands on two
    // tasks, which is what a corroboration gate asks for and what two single-
    // observation copies could never give it.
    expect(survivor?.statement).toBe(RULE);
    expect(survivor?.evidence.map((entry) => entry.feedbackId).sort()).toEqual(['fb_a', 'fb_b']);
    expect(survivor?.support).toBeCloseTo(1.8, 10);
    await memory.close();
  });

  it('stores a genuinely different claim', async () => {
    const events = [event('fb_a', 'chart.recommend'), event('fb_b', 'chart.explain')];
    const { memory, report } = await run(
      events,
      { fb_a: RULE, fb_b: 'Totals are summed after the null check.' },
      {},
    );
    expect(report).toMatchObject({ created: 2, merged: 0, suppressed: 0 });
    await memory.close();
  });

  it('stores two claims whose words agree but whose payloads do not', async () => {
    // Same sentence, different rule: merging would let the survivor's payload
    // inherit the other's evidence, so admission adds rather than merges.
    const memory = await EmbeddedMemory.open(new MemoryJournal());
    await memory.appendEvent(event('fb_a', 'chart.recommend'));
    await memory.appendEvent(event('fb_b', 'chart.explain'));
    const marks: Record<string, string> = { fb_a: 'line', fb_b: 'pie' };
    const report = await distill({
      memory,
      policy: defaultPolicy,
      clock: fixedClock(AT + 60_000),
      random: mulberry32(7),
      interpreter: (context) => [
        {
          namespace: 'acme',
          kind: 'constraint',
          scope: { task: context.event.task, domain: 'sales' },
          statement: RULE,
          payload: { mark: marks[context.event.id] ?? 'line' },
          evidence: {
            feedbackId: context.event.id,
            runId: context.event.runId,
            at: context.event.at,
            weight: 0.9,
          },
          trust: 0.9,
          dedupeKey: `k_${context.event.id}`,
        },
      ],
      admission: {},
    });
    expect(report).toMatchObject({ created: 2, merged: 0, suppressed: 0 });
    await memory.close();
  });
});

describe('a replay is a no-op, not a second item', () => {
  it('refuses the third pass over the same two events, and moves nothing', async () => {
    const events = [event('fb_a', 'chart.recommend'), event('fb_b', 'chart.explain')];
    const statements = { fb_a: RULE, fb_b: REPHRASED };
    const first = await run(events, statements, {});
    const afterFirst = await first.memory.listKnowledge({ namespace: 'acme', status: 'all' });
    await first.memory.close();

    // The same two events, distilled again with no `since`: the log is replayed
    // from the beginning, which is what a scheduled distillation does.
    const memory = await EmbeddedMemory.open(new MemoryJournal());
    for (const entry of events) await memory.appendEvent(entry);
    for (const item of afterFirst) await memory.putKnowledge(item);
    const before = new Map((await memory.listKnowledge({ namespace: 'acme', status: 'all' })).map((entry) => [entry.id, entry.updatedAt]));
    const report = await distill({
      memory,
      policy: defaultPolicy,
      clock: fixedClock(AT + 120_000),
      random: mulberry32(7),
      interpreter: interpreterFor(statements),
      admission: {},
    });
    // `fb_b`'s claim is a paraphrase whose observation the survivor already cites:
    // writing it again would only move `updatedAt`, which a delivery log reads as
    // a rewrite.
    expect(report.suppressed).toBe(1);
    const after = await memory.listKnowledge({ namespace: 'acme', status: 'all' });
    expect(after).toHaveLength(1);
    expect(new Map(after.map((entry) => [entry.id, entry.updatedAt]))).toEqual(before);
    await memory.close();
  });
});
