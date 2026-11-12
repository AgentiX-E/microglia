import { describe, expect, it } from 'vitest';
import {
  defaultPolicy,
  fixedClock,
  mulberry32,
  type DistillCandidate,
  type FeedbackEvent,
  type KnowledgeItem,
  type RunRecord,
} from '../../kernel/index.js';
import { EmbeddedMemory, MemoryJournal } from '../../memory/index.js';
import { distill, type Interpreter } from '../index.js';

const at = 1_700_000_000_000;

function event(overrides: Partial<FeedbackEvent> = {}): FeedbackEvent {
  return {
    schema: 'microglia.feedback/1',
    id: 'fb_1',
    at,
    namespace: 'acme',
    sessionId: 's1',
    runId: 'run_1',
    task: 'retail.exchange',
    kind: 'edit',
    actor: { type: 'user' },
    trust: 0.9,
    signal: {
      type: 'edit',
      beforeHash: 'a',
      afterHash: 'b',
      ops: [],
      distance: 0.5,
      after: { order: 'W237' },
    },
    provenance: { knowledgeIds: [] },
    redactions: 0,
    ...overrides,
  };
}

function run(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    schema: 'microglia.run/1',
    id: 'run_1',
    at,
    namespace: 'acme',
    sessionId: 's1',
    task: 'retail.exchange',
    input: { question: 'the shoes in W237 are too small' },
    output: { order: 'W237' },
    provenance: { knowledgeIds: [] },
    feedbackIds: [],
    ...overrides,
  };
}

function candidate(overrides: Partial<DistillCandidate> = {}): DistillCandidate {
  return {
    namespace: 'acme',
    kind: 'constraint',
    scope: { task: 'retail.exchange', domain: 'retail' },
    statement: 'Take the order id before quoting an exchange window.',
    evidence: { feedbackId: 'fb_1', runId: 'run_1', at, weight: 0.9 },
    trust: 0.9,
    dedupeKey: 'k',
    ...overrides,
  };
}

async function storeOf(entry: FeedbackEvent): Promise<EmbeddedMemory> {
  const memory = await EmbeddedMemory.open(new MemoryJournal());
  await memory.putRun(run({ id: entry.runId }));
  await memory.appendEvent(entry);
  return memory;
}

/** Distil one event through an interpreter that states whatever it is given. */
async function itemsAfter(
  entry: FeedbackEvent,
  stated: Partial<DistillCandidate> = {},
): Promise<readonly KnowledgeItem[]> {
  const memory = await storeOf(entry);
  const interpreter: Interpreter = () => Promise.resolve([candidate(stated)]);
  await distill({ memory, interpreter, policy: defaultPolicy, clock: fixedClock(at), random: mulberry32(1) });
  return memory.listKnowledge({});
}

describe('the attempt an observation came from', () => {
  it('reaches the item from the event, which is the only source that has it', async () => {
    // The interpreter receives the event but is not asked to echo provenance, and the attempt is a
    // property of the observation rather than of the claim. Stamping it here is what lets a host that
    // writes between attempts get the watermark without teaching every interpreter a new field.
    const items = await itemsAfter(event({ attempt: 2 }));
    expect(items).toHaveLength(1);
    expect(items[0]?.evidence[0]?.attempt).toBe(2);
  });

  it('overrules an interpreter that states a different attempt', async () => {
    // Provenance is not the interpreter's to state: it is host code, and a claim that dates itself to
    // someone else's observation is buying support it did not earn. The event wins, the way the host's
    // `domainOf` wins over the model's guess about where the event happened.
    const items = await itemsAfter(event({ attempt: 2 }), {
      evidence: { feedbackId: 'fb_1', runId: 'run_1', at, weight: 0.9, attempt: 7 },
    });
    expect(items[0]?.evidence[0]?.attempt).toBe(2);
  });

  it('leaves the field absent when the host opened no task, rather than writing a zero', async () => {
    // Every offline arm is this case. A `0` here would be an attempt number nobody declared, and
    // `visibleBefore` would then have to guess whether it meant "first" or "unknown".
    const items = await itemsAfter(event());
    expect(items[0]?.evidence[0] !== undefined && 'attempt' in items[0].evidence[0]).toBe(false);
  });

  it('survives a contradicted and a merged claim, because the evidence list is what carries it', async () => {
    const memory = await storeOf(event({ attempt: 2 }));
    const interpreter: Interpreter = () => Promise.resolve([candidate()]);
    await distill({ memory, interpreter, policy: defaultPolicy, clock: fixedClock(at), random: mulberry32(1) });
    // The same claim a second time from attempt 3: merged, one item, two observations, two attempts.
    await memory.appendEvent(event({ id: 'fb_2', runId: 'run_2', attempt: 3 }));
    await memory.putRun(run({ id: 'run_2' }));
    const second: Interpreter = () =>
      Promise.resolve([
        candidate({ evidence: { feedbackId: 'fb_2', runId: 'run_2', at, weight: 0.9 } }),
      ]);
    await distill({ memory, interpreter: second, policy: defaultPolicy, clock: fixedClock(at), random: mulberry32(2) });
    const items = await memory.listKnowledge({});
    expect(items).toHaveLength(1);
    expect(items[0]?.evidence.map((ref) => ref.attempt)).toEqual([2, 3]);
  });
});
