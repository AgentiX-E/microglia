import { describe, expect, it } from 'vitest';
import {
  createKnowledgeItem,
  defaultPolicy,
  fixedClock,
  mulberry32,
  type DistillCandidate,
  type KnowledgeItem,
} from '@agentix-e/microglia-core';
import { EmbeddedMemory, MemoryJournal } from '@agentix-e/microglia-memory';
import { diagnose } from '../doctor.js';
import { buildDataset } from '../export.js';
import { Microglia, openMicroglia } from '../index.js';

const at = 1_700_000_000_000;

function makeItem(overrides: Partial<DistillCandidate> = {}, id = 'k'): KnowledgeItem {
  const candidate: DistillCandidate = {
    namespace: 'acme',
    kind: 'constraint',
    scope: { task: 'chart.recommend', domain: 'sales', intent: 'trend' },
    statement: `Rule ${id}`,
    evidence: { feedbackId: `fb_${id}`, runId: 'run', at, weight: 0.9 },
    trust: 0.9,
    dedupeKey: id,
    ...overrides,
  };
  return createKnowledgeItem(candidate, defaultPolicy, at, id);
}

async function store(): Promise<EmbeddedMemory> {
  return EmbeddedMemory.open(new MemoryJournal());
}

describe('doctor diagnostics', () => {
  it('flags active knowledge below the evidence floor', async () => {
    const memory = await store();
    const item = makeItem();
    await memory.putKnowledge({ ...item, support: 0.1 });
    const result = await diagnose({ memory, namespace: 'acme', policy: defaultPolicy, now: at });
    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain('MG_D_ACTIVE_WITHOUT_SUPPORT');
    await memory.close();
  });

  it('flags active knowledge that has decayed below the threshold', async () => {
    const memory = await store();
    await memory.putKnowledge({ ...makeItem(), validUntil: at - 400 * 86_400_000 });
    const result = await diagnose({ memory, namespace: 'acme', policy: defaultPolicy, now: at });
    expect(result.issues.map((issue) => issue.code)).toContain('MG_D_ACTIVE_BELOW_THRESHOLD');
    await memory.close();
  });

  it('flags a store that is mostly quarantined and one with conflicts', async () => {
    const memory = await store();
    for (let i = 0; i < 3; i += 1) {
      await memory.putKnowledge({ ...makeItem({ trust: 0.1 }, `q${i}`), status: 'quarantined' });
    }
    await memory.putKnowledge({ ...makeItem({}, 'c'), status: 'conflicted', contradictions: 3 });
    const result = await diagnose({ memory, namespace: 'acme', policy: defaultPolicy, now: at });
    const codes = result.issues.map((issue) => issue.code);
    expect(codes).toContain('MG_D_HIGH_QUARANTINE');
    expect(codes).toContain('MG_D_CONFLICTED');
    await memory.close();
  });

  it('reports feedback with no knowledge as informational only', async () => {
    const memory = await store();
    const mg = await openMicroglia({
      app: 'x',
      namespace: 'acme',
      store: memory,
      clock: fixedClock(at),
      random: mulberry32(1),
    });
    const run = mg.begin({ task: 'chart.recommend', input: { q: 'x' } });
    await run.complete({ mark: 'bar' });
    await run.rate('up');
    const result = await mg.doctor();
    expect(result.ok).toBe(true);
    expect(result.issues.map((issue) => issue.code)).toEqual(['MG_D_NO_KNOWLEDGE']);
    await mg.close();
  });
});

describe('dataset export filters', () => {
  it('skips events whose run is missing and honours task and since filters', async () => {
    const memory = await store();
    const mg = await openMicroglia({
      app: 'x',
      namespace: 'acme',
      store: memory,
      clock: fixedClock(at),
      random: mulberry32(1),
    });
    const run = mg.begin({ task: 'chart.recommend', input: { q: 'x' } });
    await run.complete({ mark: 'bar' });
    await run.edit({ mark: 'line' });

    const other = mg.begin({ task: 'sql.generate', input: { q: 'y' } });
    await other.complete({ sql: 'select 1' });
    await other.edit({ sql: 'select 2' });

    expect(await buildDataset('sft', { memory, namespace: 'acme', task: 'sql.generate' })).toHaveLength(1);
    expect(await buildDataset('sft', { memory, namespace: 'acme', since: at + 1 })).toHaveLength(0);

    // An event with no run is skipped rather than exported with a null prompt.
    await memory.appendEvent({
      schema: 'microglia.feedback/1',
      id: 'fb_orphan',
      at,
      namespace: 'acme',
      sessionId: 's',
      runId: 'run_missing',
      task: 'chart.recommend',
      kind: 'edit',
      actor: { type: 'user' },
      trust: 0.9,
      signal: {
        type: 'edit',
        beforeHash: 'a',
        afterHash: 'b',
        ops: [],
        distance: 1,
        after: { mark: 'line' },
      },
      provenance: { knowledgeIds: [] },
      redactions: 0,
    });
    expect(await buildDataset('sft', { memory, namespace: 'acme' })).toHaveLength(2);
    await mg.close();
  });

  it('emits an eval row for a rating as well as an edit', async () => {
    const memory = await store();
    const mg = await openMicroglia({
      app: 'x',
      namespace: 'acme',
      store: memory,
      clock: fixedClock(at),
      random: mulberry32(1),
    });
    const run = mg.begin({ task: 'chart.recommend', input: { q: 'x' } });
    await run.complete({ mark: 'bar' });
    await run.rate('down', ['wrong']);
    const rows = await buildDataset('eval', { memory, namespace: 'acme' });
    expect(rows[0]?.['signal']).toBe('rating');
    await mg.close();
  });
});

describe('lifecycle edges', () => {
  it('is idempotent on close and rejects work afterwards', async () => {
    const memory = await store();
    const mg = await openMicroglia({
      app: 'x',
      namespace: 'acme',
      store: memory,
      clock: fixedClock(at),
      random: mulberry32(1),
    });
    await mg.close();
    await mg.close();
    expect(() => mg.begin({ task: 't', input: {} })).toThrow(/MG_E_NOT_OPEN/);
    await expect(mg.distill()).rejects.toThrow(/MG_E_NOT_OPEN/);
  });

  it('truncates an over-long comment and detail', async () => {
    const memory = await store();
    const mg = await openMicroglia({
      app: 'x',
      namespace: 'acme',
      store: memory,
      clock: fixedClock(at),
      random: mulberry32(1),
    });
    const run = mg.begin({ task: 't', input: {} });
    await run.complete({ ok: true });
    const event = await run.rate('down', ['r'], { comment: 'x'.repeat(900) });
    if (event.signal.type !== 'rating') throw new Error('unreachable');
    expect(event.signal.comment?.length).toBe(500);
    await mg.close();
  });

  it('accepts an actor and an explicit timestamp', async () => {
    const memory = await store();
    const mg = await openMicroglia({
      app: 'x',
      namespace: 'acme',
      store: memory,
      clock: fixedClock(at),
      random: mulberry32(1),
    });
    const run = mg.begin({ task: 't', input: {} });
    await run.complete({ ok: true });
    const event = await run.outcome(false, 'E_TIMEOUT', 'took too long', {
      actor: { type: 'verifier' },
      at: at + 5,
    });
    expect(event.at).toBe(at + 5);
    expect(event.actor.type).toBe('verifier');
    await mg.close();
  });

  it('exposes a factory equivalent to the constructor', async () => {
    const memory = await store();
    const mg = await Microglia.open({ app: 'x', namespace: 'acme', store: memory });
    expect(mg.namespace).toBe('acme');
    await mg.close();
  });
});

describe('signal normalisation branches', () => {
  async function freshRun() {
    const memory = await store();
    const mg = await openMicroglia({
      app: 'x',
      namespace: 'acme',
      store: memory,
      clock: fixedClock(at),
      random: mulberry32(1),
    });
    const run = mg.begin({ task: 't', input: { q: 'x' } });
    await run.complete({ a: 'x', b: [1, 2], c: { d: 1 } });
    return { mg, run };
  }

  it('captures a preference with and without a criterion', async () => {
    const { mg, run } = await freshRun();
    const plain = await run.feedback({ type: 'preference', chosenRunId: 'a', rejectedRunId: 'b' });
    expect(plain.signal.type).toBe('preference');

    const withCriterion = await run.feedback({
      type: 'preference',
      chosenRunId: 'a',
      rejectedRunId: 'c',
      criterion: 'accuracy',
    });
    expect(withCriterion.trust).toBe(0.7);
    await mg.close();
  });

  it('rejects an invalid or over-long run id', async () => {
    const { mg, run } = await freshRun();
    await expect(
      run.feedback({ type: 'preference', chosenRunId: '', rejectedRunId: 'b' }),
    ).rejects.toThrow(/MG_E_INVALID_SIGNAL/);
    await expect(
      run.feedback({ type: 'preference', chosenRunId: 'x'.repeat(129), rejectedRunId: 'b' }),
    ).rejects.toThrow(/MG_E_INVALID_SIGNAL/);
    await mg.close();
  });

  it('captures an outcome with no code and an abstention', async () => {
    const { mg, run } = await freshRun();
    const outcome = await run.outcome(false);
    expect(outcome.signal.type).toBe('outcome');
    const abstain = await run.abstain('not enough evidence');
    expect(abstain.trust).toBe(0.4);
    await mg.close();
  });

  it('rejects a blank clarification', async () => {
    const { mg, run } = await freshRun();
    await expect(run.clarify('   ', 'answer')).rejects.toThrow(/MG_E_INVALID_SIGNAL/);
    await mg.close();
  });

  it('counts changes across arrays, objects, and unchanged strings', async () => {
    const first = await freshRun();
    const arrayEdit = await first.run.edit({ a: 'x', b: [1, 2, 3], c: {} });
    expect(arrayEdit.redactions).toBe(0);
    await first.mg.close();

    const second = await freshRun();
    const stringEdit = await second.run.edit({ a: 'y', b: [1], c: { d: 2 } });
    expect(stringEdit.signal.type).toBe('edit');
    await second.mg.close();
  });
});

describe('run metadata branches', () => {
  it('defaults the session and merges completion metadata', async () => {
    const memory = await store();
    const mg = await openMicroglia({
      app: 'x',
      namespace: 'acme',
      store: memory,
      clock: fixedClock(at),
      random: mulberry32(1),
    });
    const run = mg.begin({ task: 't', input: { q: 'x' } });
    expect(run.sessionId).toBe('default');
    const record = await run.complete({ ok: true }, { traceId: 't-1' });
    expect(record.provenance.metadata?.['traceId']).toBe('t-1');

    const event = await run.rate('up', undefined, { at: at + 3, comment: undefined });
    expect(event.at).toBe(at + 3);
    await mg.close();
  });
});

describe('optional text branches', () => {
  it('accepts an edit note, an outcome detail, and a trust ceiling', async () => {
    const memory = await store();
    const mg = await openMicroglia({
      app: 'x',
      namespace: 'acme',
      store: memory,
      clock: fixedClock(at),
      random: mulberry32(1),
    });
    const run = mg.begin({ task: 't', input: { q: 'x' } });
    await run.complete({ mark: 'bar' });
    const edit = await run.edit({ mark: 'line' }, { note: 'house style' });
    expect(edit.redactions).toBe(0);

    const outcome = await run.outcome(false, undefined, 'timed out');
    expect(outcome.signal.type).toBe('outcome');

    const capped = await run.feedback(
      { type: 'rating', value: 'down', reasons: ['wrong'] },
      { trustCeiling: 0.2 },
    );
    expect(capped.trust).toBe(0.2);
    await mg.close();
  });
});

describe('run validation and missing knowledge', () => {
  it('rejects an empty or over-long task', async () => {
    const memory = await store();
    const mg = await openMicroglia({ app: 'x', namespace: 'acme', store: memory });
    expect(() => mg.begin({ task: '', input: {} })).toThrow(/MG_E_CONFIG/);
    expect(() => mg.begin({ task: 'x'.repeat(121), input: {} })).toThrow(/MG_E_CONFIG/);
    await mg.close();
  });

  it('honours an explicit session id', async () => {
    const memory = await store();
    const mg = await openMicroglia({ app: 'x', namespace: 'acme', store: memory });
    const run = mg.begin({ task: 't', input: {}, sessionId: 's-9' });
    expect(run.sessionId).toBe('s-9');
    await mg.close();
  });

  it('credits a pack that cites knowledge missing from the store', async () => {
    const memory = await store();
    const mg = await openMicroglia({ app: 'x', namespace: 'acme', store: memory });
    const pack = {
      items: [],
      ids: ['k_missing'],
      rendered: '',
      tokens: 0,
      hash: 'h',
      budget: 0,
      truncated: 0,
    };
    const run = mg.begin({ task: 't', input: {}, pack });
    await run.complete({ ok: true });
    await expect(run.outcome(false)).resolves.toBeDefined();
    await mg.close();
  });
});
