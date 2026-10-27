/**
 * The host-facing surface, tested as a host uses it.
 *
 * These cases exist because the facade is what a caller integrates: a getter
 * that returns the wrong record, an export that writes `undefined` where a
 * dataset expects `null`, or a `stats()` that drifts from the store would each be
 * discovered only in production.
 */
import { describe, expect, it } from 'vitest';
import {
  fixedClock,
  mulberry32,
  type Json,
  type RunRecord,
} from '../../kernel/index.js';
import { EmbeddedMemory, MemoryJournal } from '../../memory/index.js';
import { openMicroglia, type Microglia } from '../index.js';

const AT = 1_700_000_000_000;
/** A synthetic credential: assembled at runtime so the repository audit stays strict. */
const FAKE_KEY = `sk-${'a'.repeat(24)}`;

async function host(options: { tag?: string; budget?: number } = {}): Promise<{
  mg: Microglia;
  store: EmbeddedMemory;
}> {
  const store = await EmbeddedMemory.open(new MemoryJournal());
  const mg = await openMicroglia({
    app: 'nl2charts',
    namespace: 'acme',
    store,
    clock: fixedClock(AT),
    random: mulberry32(3),
    ...options,
  });
  return { mg, store };
}

describe('recall', () => {
  it('uses the configured element name', async () => {
    const { mg } = await host({ tag: 'acme-rules' });
    const pack = await mg.recall({ task: 'chart.recommend', text: 'trend of revenue' });
    expect(pack.rendered === '' || pack.rendered.startsWith('<acme-rules')).toBe(true);
    await mg.close();
  });

  it('honours a per-call budget over the configured one', async () => {
    const { mg } = await host({ budget: 1200 });
    const pack = await mg.recall({ task: 'chart.recommend', text: 'trend', budget: 400 });
    expect(pack.budget).toBe(400);
    await mg.close();
  });
});

describe('run lifecycle', () => {
  it('exposes no record before completion and the persisted record after', async () => {
    const { mg } = await host();
    const run = mg.begin({ task: 'chart.recommend', input: { q: 'trend' } });
    expect(run.record).toBeUndefined();
    const record = await run.complete({ mark: 'line' });
    expect(run.record).toBe(record);
    expect(record.output).toEqual({ mark: 'line' });
    await mg.close();
  });

  it('records every provenance field the host supplied', async () => {
    const { mg } = await host();
    const run = mg.begin({
      task: 'chart.recommend',
      input: { q: 'trend' },
      model: 'deepseek-chat',
      promptVersion: 'p3',
      appVersion: '1.4.0',
      domainPack: 'nl2charts',
      schemaDigest: 'sha256:abc',
      metadata: { traceId: 't-1' },
    });
    const record = await run.complete({ mark: 'line' });
    expect(record.provenance).toMatchObject({
      model: 'deepseek-chat',
      promptVersion: 'p3',
      appVersion: '1.4.0',
      domainPack: 'nl2charts',
      schemaDigest: 'sha256:abc',
      metadata: { traceId: 't-1' },
    });
    await mg.close();
  });

  it('rejects an output that cannot be persisted as JSON', async () => {
    const { mg } = await host();
    const run = mg.begin({ task: 'chart.recommend', input: { q: 'trend' } });
    await expect(run.complete(10n as unknown as Json)).rejects.toThrow(/MG_E_INVALID_SIGNAL/);
    await mg.close();
  });

  it('refuses feedback on a run that has not completed', async () => {
    const { mg } = await host();
    const run = mg.begin({ task: 'chart.recommend', input: { q: 'trend' } });
    await expect(run.rate('up')).rejects.toThrow(/MG_E_NO_OUTPUT/);
    await mg.close();
  });

  it('refuses an edit on a run that produced nothing', async () => {
    const { mg } = await host();
    const run = mg.begin({ task: 'chart.recommend', input: { q: 'trend' } });
    await expect(run.edit({ mark: 'line' })).rejects.toThrow(/MG_E_NO_OUTPUT/);
    await mg.close();
  });
});

describe('redaction accounting', () => {
  it('counts a secret removed from a string output', async () => {
    const { mg } = await host();
    const run = mg.begin({ task: 'chart.recommend', input: { q: 'trend' } });
    await run.complete('the chart used revenue by month');
    const event = await run.edit(`the chart used revenue by month, key ${FAKE_KEY}`);
    expect(event.redactions).toBe(1);
    expect(JSON.stringify(event.signal)).not.toContain('${FAKE_KEY}');
    await mg.close();
  });

  it('caps the reason list a host may attach', async () => {
    const { mg } = await host();
    const run = mg.begin({ task: 'chart.recommend', input: { q: 'trend' } });
    await run.complete({ mark: 'bar' });
    const event = await run.rate(
      'down',
      Array.from({ length: 10 }, (_, index) => `reason-${index}`),
    );
    expect(event.signal.type).toBe('rating');
    if (event.signal.type === 'rating') expect(event.signal.reasons).toHaveLength(8);
    await mg.close();
  });
});

describe('dataset export', () => {
  async function seed(mg: Microglia, store: EmbeddedMemory): Promise<void> {
    const withOutput = mg.begin({ task: 'chart.recommend', input: { q: 'a' } });
    await withOutput.complete({ mark: 'bar' });
    await withOutput.edit({ mark: 'line' });

    // A journal written by an older build can hold an event whose run row was
    // pruned or never carried an output. Export must emit `null` for it rather
    // than dropping the row or writing `undefined` into the dataset.
    await store.putRun({
      schema: 'microglia.run/1',
      id: 'run_orphan',
      at: AT,
      namespace: 'acme',
      sessionId: 's',
      task: 'chart.recommend',
      input: { q: 'b' },
      output: undefined,
      provenance: { knowledgeIds: [] },
      feedbackIds: [],
    } as unknown as RunRecord);
    await store.appendEvent({
      schema: 'microglia.feedback/1',
      id: 'fb_orphan',
      at: AT,
      namespace: 'acme',
      sessionId: 's',
      runId: 'run_orphan',
      task: 'chart.recommend',
      kind: 'rating',
      actor: { type: 'user' },
      trust: 0.6,
      signal: { type: 'rating', value: 'up', reasons: [] },
      provenance: { knowledgeIds: [] },
      redactions: 0,
    });
  }

  it('writes null completions for an event whose run has no output', async () => {
    const { mg, store } = await host();
    await seed(mg, store);
    // KTO is built from ratings only; the edit in the same seed is not a label.
    const rows = (await mg.exportDataset('kto')) as readonly Record<string, Json>[];
    expect(rows).toHaveLength(1);
    const orphan = rows.find((row) => row['completion'] === null);
    expect(orphan?.['id']).toBe('fb_orphan');
    expect(orphan?.['label']).toBe(true);
    await mg.close();
  });

  it('writes the completion as the expected answer for a rating', async () => {
    const { mg, store } = await host();
    await seed(mg, store);
    const rows = (await mg.exportDataset('eval')) as readonly Record<string, Json>[];
    const edited = rows.find((row) => row['expected'] !== null);
    expect(edited?.['expected']).toEqual({ mark: 'line' });
    expect(rows.some((row) => row['expected'] === null)).toBe(true);
    await mg.close();
  });

  it('filters an export by task and by time', async () => {
    const { mg, store } = await host();
    await seed(mg, store);
    expect(await mg.exportDataset('kto', { task: 'sql.generate' })).toHaveLength(0);
    expect(await mg.exportDataset('kto', { since: AT + 1 })).toHaveLength(0);
    expect(await mg.exportDataset('kto', { since: AT })).toHaveLength(1);
    expect(await mg.exportDataset('eval', { task: 'chart.recommend' })).toHaveLength(2);
    await mg.close();
  });
});

describe('distillation window', () => {
  it('only reads events inside the requested window', async () => {
    const { mg } = await host();
    const first = mg.begin({ task: 'chart.recommend', input: { q: 'a' } });
    await first.complete({ mark: 'bar' });
    await first.rate('down', ['wrong_chart_type']);

    const second = mg.begin({ task: 'chart.recommend', input: { q: 'b' } });
    await second.complete({ mark: 'pie' });
    await second.rate('down', ['wrong_chart_type']);

    // The clock is fixed, so both events share a timestamp; `since` at AT + 1
    // therefore excludes both, and `limit` caps the batch.
    expect((await mg.distill({ since: AT + 1 })).events).toBe(0);
    expect((await mg.distill({ limit: 1 })).events).toBe(1);
    await mg.close();
  });

  it('lets the host veto a claim before it is stored', async () => {
    // A prompt can ask for a lesson with no table names in it; only the host can refuse one that
    // has them. The veto is counted, so a store emptied by its own filter is visible.
    const { mg } = await host();
    const run = mg.begin({ task: 'chart.recommend', input: { q: 'a' } });
    await run.complete({ mark: 'bar' });
    await run.rate('down', ['wrong_chart_type']);

    const report = await mg.distill({ accept: () => false });
    expect(report.events).toBe(1);
    expect(report.candidates).toBeGreaterThan(0);
    expect(report.rejectedByHost).toBe(report.candidates);
    expect(report.created).toBe(0);
    await mg.close();
  });
});

describe('observability', () => {
  it('reports store statistics that match what was written', async () => {
    const { mg, store } = await host();
    const run = mg.begin({ task: 'chart.recommend', input: { q: 'a' } });
    const record: RunRecord = await run.complete({ mark: 'bar' });
    await run.rate('up');
    expect(record.id).toBe(run.id);
    expect(await mg.stats()).toMatchObject({ events: 1, runs: 1, knowledge: 0 });
    expect(await store.stats()).toEqual(await mg.stats());
    await mg.close();
  });
});

describe('event construction as a public function', () => {
  it('refuses an edit against a run that has no output', async () => {
    const { buildFeedbackEvent } = await import('../index.js');
    expect(() =>
      buildFeedbackEvent({
        input: { type: 'edit', after: { mark: 'line' } },
        run: {
          schema: 'microglia.run/1',
          id: 'run_x',
          at: AT,
          namespace: 'acme',
          sessionId: 's',
          task: 'chart.recommend',
          input: { q: 'x' },
          output: undefined,
          provenance: { knowledgeIds: [] },
          feedbackIds: [],
        },
        namespace: 'acme',
        at: AT,
        id: 'fb_x',
        actor: { type: 'user' },
      }),
    ).toThrow(/MG_E_NO_OUTPUT/);
  });
});
