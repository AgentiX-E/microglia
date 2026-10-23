import { describe, expect, it } from 'vitest';
import {
  createKnowledgeItem,
  defaultPolicy,
  fixedClock,
  mulberry32,
  type DistillCandidate,
  type KnowledgeItem,
} from '../../kernel/index.js';
import { EmbeddedMemory, MemoryJournal } from '../../memory/index.js';
import {
  Microglia,
  creditOf,
  openMicroglia,
  seededRandom,
  trustFor,
  type MicrogliaOptions,
} from '../index.js';

const at = 1_700_000_000_000;

function knowledge(id: string, feedbackId = `fb_${id}`): KnowledgeItem {
  const candidate: DistillCandidate = {
    namespace: 'acme',
    kind: 'constraint',
    scope: { task: 'chart.recommend', domain: 'sales', intent: 'trend' },
    statement: 'For a trend question over revenue. Use a line chart rather than a bar chart.',
    payload: { when: { intent: 'trend' }, then: { mark: 'line' } },
    evidence: { feedbackId, runId: 'run_0', at, weight: 0.9 },
    trust: 0.9,
    dedupeKey: id,
  };
  return createKnowledgeItem(candidate, defaultPolicy, at, id);
}

async function create(overrides: Partial<MicrogliaOptions> = {}): Promise<{
  mg: Microglia;
  store: EmbeddedMemory;
}> {
  const store = await EmbeddedMemory.open(new MemoryJournal());
  const mg = await openMicroglia({
    app: 'nl2charts',
    namespace: 'acme',
    store,
    clock: fixedClock(at),
    random: mulberry32(7),
    ...overrides,
  });
  return { mg, store };
}

const baseRun = {
  task: 'chart.recommend',
  input: { question: 'revenue by month', domain: 'sales', intent: 'trend' },
};

describe('configuration', () => {
  it('rejects an invalid namespace, app, or missing store', async () => {
    const store = await EmbeddedMemory.open(new MemoryJournal());
    expect(() => new Microglia({ app: 'x', namespace: 'bad namespace', store })).toThrow(
      /MG_E_NAMESPACE_MISMATCH/,
    );
    expect(() => new Microglia({ app: '', namespace: 'acme', store })).toThrow(/MG_E_CONFIG/);
    expect(
      () => new Microglia({ app: 'x', namespace: 'acme', store: undefined as never }),
    ).toThrow(/MG_E_CONFIG/);
  });
});

describe('run lifecycle', () => {
  it('persists a run and refuses feedback before the output exists', async () => {
    const { mg } = await create();
    const run = mg.begin(baseRun);
    await expect(run.feedback({ type: 'rating', value: 'up' })).rejects.toThrow(/MG_E_NO_OUTPUT/);
    const record = await run.complete({ mark: 'bar' });
    expect(record.output).toEqual({ mark: 'bar' });
    expect(record.provenance.knowledgeIds).toEqual([]);
    await expect(run.complete({ mark: 'bar' })).rejects.toThrow(/MG_E_RUN_COMMITTED/);
    await mg.close();
  });

  it('captures an edit with a structural diff, distance, and hashes', async () => {
    const { mg, store } = await create();
    const run = mg.begin(baseRun);
    await run.complete({ mark: 'bar', x: 'order_date', y: 'revenue', aggregate: 'sum' });
    const event = await run.edit({
      mark: 'line',
      x: 'order_date',
      y: 'revenue',
      aggregate: 'sum',
    });
    expect(event.signal.type).toBe('edit');
    if (event.signal.type !== 'edit') throw new Error('unreachable');
    expect(event.signal.ops).toHaveLength(1);
    expect(event.signal.distance).toBeGreaterThan(0);
    expect(event.trust).toBeGreaterThan(0.5);
    expect(await store.listEvents({ runId: run.id })).toHaveLength(1);
    await mg.close();
  });

  it('rejects an edit that changes nothing', async () => {
    const { mg } = await create();
    const run = mg.begin(baseRun);
    await run.complete({ mark: 'bar' });
    await expect(run.edit({ mark: 'bar' })).rejects.toThrow(/MG_E_INVALID_SIGNAL/);
    await mg.close();
  });

  it('records a rating with normalised reasons and a comment', async () => {
    const { mg } = await create();
    const run = mg.begin(baseRun);
    await run.complete({ mark: 'bar' });
    const event = await run.rate('down', [' wrong_chart_type ', 'wrong_chart_type', ''], {
      comment: 'contact me at a@b.com',
    });
    expect(event.trust).toBe(0.6);
    if (event.signal.type !== 'rating') throw new Error('unreachable');
    expect(event.signal.reasons).toEqual(['wrong_chart_type']);
    expect(event.signal.comment).toContain('[email]');
    expect(event.redactions).toBe(1);
    await mg.close();
  });

  it('rejects a preference between the same run', async () => {
    const { mg } = await create();
    const run = mg.begin(baseRun);
    await run.complete({ mark: 'bar' });
    await expect(
      run.feedback({ type: 'preference', chosenRunId: run.id, rejectedRunId: run.id }),
    ).rejects.toThrow(/MG_E_INVALID_SIGNAL/);
    await mg.close();
  });

  it('carries the note a reviewer wrote into the edit signal', async () => {
    // `edit(after, { note })` accepted a note and the normaliser dropped it, so the
    // one piece of human context an interpreter could use never reached the store.
    const { mg, store } = await create();
    const run = mg.begin(baseRun);
    await run.complete({ mark: 'bar' });
    await run.edit({ mark: 'line' }, { note: 'wrong axis for a time series' });
    const [event] = await store.listEvents();
    expect(event?.signal.type).toBe('edit');
    expect(event?.signal.type === 'edit' ? event.signal.note : undefined).toBe('wrong axis for a time series');
    await mg.close();
  });

  it('omits the note when none was given', async () => {
    const { mg, store } = await create();
    const run = mg.begin(baseRun);
    await run.complete({ mark: 'bar' });
    await run.edit({ mark: 'line' });
    const [event] = await store.listEvents();
    expect(event?.signal.type === 'edit' ? 'note' in event.signal : true).toBe(false);
    await mg.close();
  });

  it('refuses to record feedback against a run from another namespace', async () => {
    // The write end of this boundary was guarded (`persistRun`); the feedback end
    // was not, so a facade could annotate another tenant's run and the next
    // distillation would read that run through this tenant's interpreter. Found by
    // an MCP tool test, which is exactly the sort of caller the SDK is for.
    const { mg, store } = await create();
    const run = mg.begin(baseRun);
    const record = await run.complete({ mark: 'bar' });

    const foreign = new Microglia({
      app: 'test',
      namespace: 'other',
      store,
      clock: { now: () => 1_700_000_000_000 },
    });
    await expect(
      foreign.recordFeedback(record, { type: 'edit', after: { mark: 'line' } }),
    ).rejects.toThrow(/MG_E_NAMESPACE_MISMATCH/);
    // And nothing was written: a refused write that still lands is worse than one
    // that throws.
    expect(await store.listEvents()).toHaveLength(0);
    await mg.close();
  });

  it('refuses to persist a run from another namespace', async () => {
    const { mg } = await create();
    const run = mg.begin(baseRun);
    const record = await run.complete({ mark: 'bar' });
    await expect(mg.persistRun({ ...record, namespace: 'other' })).rejects.toThrow(
      /MG_E_NAMESPACE_MISMATCH/,
    );
    await mg.close();
  });
});

describe('recall and provenance', () => {
  it('records the pack ids on the run so credit can be assigned later', async () => {
    const { mg, store } = await create();
    await store.putKnowledge(knowledge('k_1'));
    const pack = await mg.recall({
      task: 'chart.recommend',
      text: 'monthly revenue trend in sales',
      scope: { domain: 'sales' },
    });
    expect(pack.ids).toEqual(['k_1']);

    const run = mg.begin({ ...baseRun, pack });
    const record = await run.complete({ mark: 'line' });
    expect(record.provenance.knowledgeIds).toEqual(['k_1']);
    expect(record.provenance.retrievalHash).toBe(pack.hash);
    await mg.close();
  });

  it('returns an empty pack when the store is empty', async () => {
    const { mg } = await create();
    const pack = await mg.recall({ task: 'chart.recommend', text: 'anything' });
    expect(pack.ids).toEqual([]);
    expect(pack.rendered).toBe('');
    await mg.close();
  });
});

describe('credit assignment', () => {
  it('counts a negative edit against the knowledge that was applied', async () => {
    const { mg, store } = await create();
    const item = knowledge('k_2');
    await store.putKnowledge(item);
    const pack = await mg.recall({ task: 'chart.recommend', text: 'monthly revenue trend' });

    const run = mg.begin({ ...baseRun, pack });
    await run.complete({ mark: 'bar' });
    await run.edit({ mark: 'line' });

    const updated = await store.getKnowledge('k_2');
    expect(updated?.applied).toBe(1);
    expect(updated?.succeeded).toBe(0);
    expect(updated?.confidence).toBeLessThan(item.confidence);
    await mg.close();
  });

  it('counts a successful outcome as success', async () => {
    const { mg, store } = await create();
    await store.putKnowledge(knowledge('k_3'));
    const pack = await mg.recall({ task: 'chart.recommend', text: 'monthly revenue trend' });
    const run = mg.begin({ ...baseRun, pack });
    await run.complete({ mark: 'line' });
    await run.outcome(true);

    const updated = await store.getKnowledge('k_3');
    expect(updated?.applied).toBe(1);
    expect(updated?.succeeded).toBe(1);
    await mg.close();
  });

  it('credits one signal per run and item, even with two feedback events', async () => {
    const { mg, store } = await create();
    await store.putKnowledge(knowledge('k_4'));
    const pack = await mg.recall({ task: 'chart.recommend', text: 'monthly revenue trend' });
    const run = mg.begin({ ...baseRun, pack });
    await run.complete({ mark: 'bar' });
    await run.rate('down', ['wrong_chart_type']);
    await run.edit({ mark: 'line' });

    const updated = await store.getKnowledge('k_4');
    expect(updated?.applied).toBe(1);
    await mg.close();
  });

  it('does not credit a clarification or an abstention', async () => {
    const { mg, store } = await create();
    await store.putKnowledge(knowledge('k_5'));
    const pack = await mg.recall({ task: 'chart.recommend', text: 'monthly revenue trend' });
    const run = mg.begin({ ...baseRun, pack });
    await run.complete({ mark: 'line' });
    await run.clarify('active customer', 'ordered in 90 days');
    await run.abstain('not enough evidence');

    const updated = await store.getKnowledge('k_5');
    expect(updated?.applied).toBe(0);
    await mg.close();
  });

  it('maps signals to credit explicitly', () => {
    expect(creditOf({ type: 'rating', value: 'up', reasons: [] })).toBe(true);
    expect(creditOf({ type: 'rating', value: 'down', reasons: [] })).toBe(false);
    expect(creditOf({ type: 'outcome', ok: true })).toBe(true);
    expect(creditOf({ type: 'edit', beforeHash: 'a', afterHash: 'b', ops: [], distance: 0.2, after: null })).toBe(false);
    expect(creditOf({ type: 'clarification', question: 'q', answer: 'a' })).toBeUndefined();
    expect(creditOf({ type: 'abstain', reason: 'r' })).toBeUndefined();
  });
});

describe('trust derivation', () => {
  it('orders verification above edit above an unreasoned click', () => {
    const verified = trustFor({ type: 'outcome', ok: false, code: 'x' });
    const bigEdit = trustFor({
      type: 'edit',
      beforeHash: 'a',
      afterHash: 'b',
      ops: [],
      distance: 0.5,
      after: null,
    });
    const reasoned = trustFor({ type: 'rating', value: 'down', reasons: ['wrong'] });
    const bare = trustFor({ type: 'rating', value: 'down', reasons: [] });
    expect(verified).toBeGreaterThan(bigEdit);
    expect(bigEdit).toBeGreaterThan(reasoned);
    expect(reasoned).toBeGreaterThan(bare);
  });
});

describe('dataset export', () => {
  async function withFeedback(): Promise<{ mg: Microglia; runId: string }> {
    const { mg } = await create();
    const run = mg.begin(baseRun);
    await run.complete({ mark: 'bar', x: 'order_date', y: 'revenue', aggregate: 'sum' });
    await run.edit({ mark: 'line', x: 'order_date', y: 'revenue', aggregate: 'sum' });
    await run.rate('down', ['wrong_chart_type']);
    return { mg, runId: run.id };
  }

  it('emits SFT, DPO, KTO, and eval rows with the expected keys', async () => {
    const { mg } = await withFeedback();
    const sft = await mg.exportDataset('sft');
    expect(sft[0]).toMatchObject({ task: 'chart.recommend' });
    expect(sft[0]?.['completion']).toMatchObject({ mark: 'line' });

    const dpo = await mg.exportDataset('dpo');
    expect(dpo[0]?.['chosen']).toMatchObject({ mark: 'line' });
    expect(dpo[0]?.['rejected']).toMatchObject({ mark: 'bar' });

    const kto = await mg.exportDataset('kto');
    expect(kto[0]?.['label']).toBe(false);

    const evalRows = await mg.exportDataset('eval');
    expect(evalRows).toHaveLength(2);
    await mg.close();
  });

  it('writes a self-describing JSONL header', async () => {
    const { mg } = await withFeedback();
    const text = await mg.exportJsonl('dpo');
    const lines = text.trim().split('\n');
    const header = JSON.parse(lines[0] as string) as Record<string, unknown>;
    expect(header['schema']).toBe('microglia.dataset/1');
    expect(header['format']).toBe('dpo');
    expect(header['rows']).toBe(lines.length - 1);
    await mg.close();
  });
});

describe('doctor', () => {
  it('reports an orphaned evidence reference as an error', async () => {
    const { mg, store } = await create();
    await store.putKnowledge(knowledge('k_6', 'fb_missing'));
    const diagnosis = await mg.doctor();
    expect(diagnosis.ok).toBe(false);
    expect(diagnosis.issues.map((issue) => issue.code)).toContain('MG_D_ORPHAN_EVIDENCE');
    await mg.close();
  });

  it('is quiet on a healthy empty store', async () => {
    const { mg } = await create();
    const diagnosis = await mg.doctor();
    expect(diagnosis.ok).toBe(true);
    expect(diagnosis.issues).toEqual([]);
    await mg.close();
  });
});

describe('determinism', () => {
  it('produces the same event ids under the same seed', async () => {
    const build = async (): Promise<string> => {
      const { mg } = await create({ random: seededRandom(99) });
      const run = mg.begin(baseRun);
      await run.complete({ mark: 'bar' });
      const event = await run.rate('up');
      await mg.close();
      return event.id;
    };
    expect(await build()).toBe(await build());
  });
});

describe('doctor: the promotion gate backlog', () => {
  it('names the lessons that are stored but cannot steer output', async () => {
    const store = await EmbeddedMemory.open(new MemoryJournal());
    const mg = await openMicroglia({
      app: 'test',
      namespace: 'acme',
      store,
      clock: fixedClock(at),
      random: mulberry32(2),
    });
    const run = mg.begin({ task: 'chart.recommend', input: { q: 'trend' } });
    await run.complete({ mark: 'bar' });
    await run.clarify('which mark for trend?', 'line');
    await mg.distill();

    const diagnosis = await mg.doctor();
    const issue = diagnosis.issues.find((entry) => entry.code === 'MG_D_AWAITING_CORROBORATION');
    expect(issue).toBeDefined();
    expect(issue?.severity).toBe('warn');
    expect(issue?.ids).toHaveLength(1);
    // A warning, not an error: a single-user workspace legitimately sits here.
    expect(diagnosis.ok).toBe(true);
    await mg.close();
  });
});
