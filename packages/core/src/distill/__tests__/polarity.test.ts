import { describe, expect, it } from 'vitest';
import {
  defaultPolicy,
  fixedClock,
  mulberry32,
  type DistillCandidate,
  type FeedbackEvent,
  type RunRecord,
} from '../../kernel/index.js';
import { EmbeddedMemory, MemoryJournal } from '../../memory/index.js';
import { distill, type Interpreter } from '../index.js';

const at = 1_700_000_000_000;

function run(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    schema: 'microglia.run/1',
    id: 'run_1',
    at,
    namespace: 'acme',
    sessionId: 's1',
    task: 'chart.recommend',
    input: { intent: 'trend' },
    output: { mark: 'bar' },
    provenance: { knowledgeIds: [] },
    feedbackIds: [],
    ...overrides,
  };
}

function event(overrides: Partial<FeedbackEvent> = {}): FeedbackEvent {
  return {
    schema: 'microglia.feedback/1',
    id: 'fb_1',
    at,
    namespace: 'acme',
    sessionId: 's1',
    runId: 'run_1',
    task: 'chart.recommend',
    kind: 'outcome',
    actor: { type: 'host' },
    trust: 0.9,
    signal: { type: 'outcome', ok: false },
    provenance: { knowledgeIds: [] },
    redactions: 0,
    ...overrides,
  };
}

function candidate(overrides: Partial<DistillCandidate> = {}): DistillCandidate {
  return {
    namespace: 'acme',
    kind: 'constraint',
    scope: { task: 'chart.recommend' },
    statement: 'For a trend question over revenue. Use a line chart rather than a bar chart.',
    evidence: { feedbackId: 'fb_1', runId: 'run_1', at, weight: 0.9 },
    trust: 0.9,
    dedupeKey: 'k',
    ...overrides,
  };
}

async function seed(events: readonly FeedbackEvent[]): Promise<EmbeddedMemory> {
  const memory = await EmbeddedMemory.open(new MemoryJournal());
  await memory.putRun(run());
  for (const entry of events) await memory.appendEvent(entry);
  return memory;
}

async function run_(memory: EmbeddedMemory, interpreter: Interpreter) {
  return distill({
    memory,
    policy: defaultPolicy,
    clock: fixedClock(at),
    random: mulberry32(1),
    interpreter,
  });
}

describe('the distiller stamps the side from the event', () => {
  it('records a failed outcome as a repair and a successful one as a pass', async () => {
    for (const [ok, side] of [
      [false, 'repair'],
      [true, 'pass'],
    ] as const) {
      const memory = await seed([
        event({ id: `fb_${String(ok)}`, signal: { type: 'outcome', ok } }),
      ]);
      await run_(memory, () => [
        candidate({
          evidence: { feedbackId: `fb_${String(ok)}`, runId: 'run_1', at, weight: 0.9 },
        }),
      ]);
      const [item] = await memory.listKnowledge({ status: 'all' });
      expect(item?.polarity).toBe(side);
    }
  });

  it('overrules an interpreter that claims the other side', async () => {
    // The side is a property of the observation, not of the interpretation, exactly as the attempt
    // number is. An interpreter that says "pass" over a failed outcome is stating a fact about
    // someone else's evidence, and the event is the authority.
    const memory = await seed([event({ signal: { type: 'outcome', ok: false } })]);
    await run_(memory, () => [candidate({ polarity: 'pass' })]);
    const [item] = await memory.listKnowledge({ status: 'all' });
    expect(item?.polarity).toBe('repair');
  });

  it('stamps a correction as a repair, which is the population the retrospection lane reads', async () => {
    const memory = await seed([
      event({
        kind: 'edit',
        signal: {
          type: 'edit',
          beforeHash: 'a',
          afterHash: 'b',
          ops: [],
          distance: 0.5,
          after: { mark: 'line' },
        },
      }),
    ]);
    await run_(memory, () => [candidate()]);
    const [item] = await memory.listKnowledge({ status: 'all' });
    expect(item?.polarity).toBe('repair');
  });
});
