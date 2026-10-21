import { describe, expect, it } from 'vitest';
import { EmbeddedMemory, MemoryJournal } from '@agentix-e/microglia-core/memory';
import { openMicroglia, type MicrogliaErrorCode } from '@agentix-e/microglia-core';
import { createApp, statusFor } from '../app.js';

const TOKEN = 'test-token';

async function mount(options: { token?: string } = {}) {
  const store = await EmbeddedMemory.open(new MemoryJournal());
  const microglia = await openMicroglia({
    app: 'test',
    namespace: 'acme',
    store,
    clock: { now: () => 1_700_000_000_000 },
  });
  const app = createApp({ microglia, ...(options.token === undefined ? {} : { token: options.token }) });
  return { app, microglia, store };
}

const edit = {
  run: { task: 'chart.recommend', input: { q: 'sales by month' }, output: { mark: 'line' } },
  feedback: { type: 'edit', after: { mark: 'bar' } },
};

function post(app: ReturnType<typeof createApp>, path: string, body: unknown, key?: string) {
  return app.request(path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${TOKEN}`,
      ...(key === undefined ? {} : { 'idempotency-key': key }),
    },
    body: JSON.stringify(body),
  });
}

describe('http surface', () => {
  it('rejects an unauthenticated request when a token is configured', async () => {
    const { app } = await mount({ token: TOKEN });
    const response = await app.request('/v1/health');
    expect(response.status).toBe(401);
  });

  it('reports health and the store counts', async () => {
    const { app } = await mount({ token: TOKEN });
    const response = await app.request('/v1/health', { headers: { authorization: `Bearer ${TOKEN}` } });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; stats: { knowledge: number } };
    expect(body.ok).toBe(true);
    expect(body.stats.knowledge).toBe(0);
  });

  it('ingests a run and its correction, then distils it', async () => {
    const { app } = await mount({ token: TOKEN });
    const created = await post(app, '/v1/feedback', edit);
    expect(created.status).toBe(201);
    const ids = (await created.json()) as { runId: string; eventId: string };
    expect(ids.runId).toMatch(/^run_/);
    expect(ids.eventId).toMatch(/^fb_/);

    const distilled = await post(app, '/v1/distill', {});
    expect(distilled.status).toBe(200);

    const knowledge = await app.request('/v1/knowledge?status=all', {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(knowledge.status).toBe(200);
    const body = (await knowledge.json()) as { count: number };
    expect(body.count).toBeGreaterThanOrEqual(0);
  });

  it('answers the same ids for a retried idempotency key', async () => {
    const { app } = await mount({ token: TOKEN });
    const first = await post(app, '/v1/feedback', edit, 'k-1');
    const second = await post(app, '/v1/feedback', edit, 'k-1');
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual(await first.json());
  });

  it('validates the body instead of trusting it', async () => {
    const { app } = await mount({ token: TOKEN });
    const noFeedback = await post(app, '/v1/feedback', { run: edit.run });
    expect(noFeedback.status).toBe(400);

    const badType = await post(app, '/v1/feedback', { ...edit, feedback: { type: 'shrug' } });
    expect(badType.status).toBe(400);

    const missingAfter = await post(app, '/v1/feedback', {
      ...edit,
      feedback: { type: 'edit' },
    });
    expect(missingAfter.status).toBe(400);

    const notJson = await app.request('/v1/feedback', {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}` },
      body: '{',
    });
    expect(notJson.status).toBe(400);
  });

  it('rejects a malformed run and incomplete feedback', async () => {
    const { app } = await mount({ token: TOKEN });
    const notObject = await post(app, '/v1/feedback', 7);
    expect(notObject.status).toBe(400);

    const noRun = await post(app, '/v1/feedback', { feedback: { type: 'outcome', ok: true } });
    expect(noRun.status).toBe(400);

    const noTask = await post(app, '/v1/feedback', { run: { input: {}, output: {} }, feedback: { type: 'outcome', ok: true } });
    expect(noTask.status).toBe(400);

    const noInput = await post(app, '/v1/feedback', { run: { task: 't', output: {} }, feedback: { type: 'outcome', ok: true } });
    expect(noInput.status).toBe(400);

    const noOutput = await post(app, '/v1/feedback', { run: { task: 't', input: {} }, feedback: { type: 'outcome', ok: true } });
    expect(noOutput.status).toBe(400);

    const badOutcome = await post(app, '/v1/feedback', { ...edit, feedback: { type: 'outcome' } });
    expect(badOutcome.status).toBe(400);

    const badClarification = await post(app, '/v1/feedback', { ...edit, feedback: { type: 'clarification', question: 'q' } });
    expect(badClarification.status).toBe(400);

    const badAbstain = await post(app, '/v1/feedback', { ...edit, feedback: { type: 'abstain' } });
    expect(badAbstain.status).toBe(400);

    const badRating = await post(app, '/v1/feedback', { ...edit, feedback: { type: 'rating', value: 'meh' } });
    expect(badRating.status).toBe(400);

    const minimal = await post(app, '/v1/feedback', { ...edit, feedback: { type: 'rating', value: 'up' } });
    expect(minimal.status).toBe(201);
  });

  it('refuses a body above the configured limit', async () => {
    const store = await EmbeddedMemory.open(new MemoryJournal());
    const microglia = await openMicroglia({ app: 'test', namespace: 'acme', store });
    const app = createApp({ microglia, token: TOKEN, maxBodyBytes: 32 });
    const response = await post(app, '/v1/feedback', edit);
    expect(response.status).toBe(413);
  });

  it('accepts every feedback kind the library defines', async () => {
    const { app } = await mount({ token: TOKEN });
    const kinds = [
      { type: 'rating', value: 'down', reasons: ['wrong'] },
      { type: 'outcome', ok: false, code: 'E_SUM' },
      { type: 'clarification', question: 'which field?', answer: 'revenue' },
      { type: 'abstain', reason: 'no data' },
      { type: 'edit', after: { mark: 'bar' }, note: 'prefers bars' },
    ];
    for (const kind of kinds) {
      const response = await post(app, '/v1/feedback', { ...edit, feedback: kind });
      expect(response.status).toBe(201);
    }
    const annotated = await post(app, '/v1/feedback', {
      run: { ...edit.run, sessionId: 's-1', model: 'deepseek-chat', packIds: ['k_1'] },
      feedback: { type: 'outcome', ok: true },
    });
    expect(annotated.status).toBe(201);
  });

  it('maps a closed facade to 503 rather than a stack trace', async () => {
    const { app, microglia } = await mount({ token: TOKEN });
    await microglia.close();
    const response = await app.request('/v1/health', { headers: { authorization: `Bearer ${TOKEN}` } });
    expect(response.status).toBe(503);
  });

  it('recalls, requires task and text, and 404s the rest', async () => {
    const { app } = await mount({ token: TOKEN });
    const missing = await app.request('/v1/recall?task=t', { headers: { authorization: `Bearer ${TOKEN}` } });
    expect(missing.status).toBe(400);

    const recalled = await app.request(
      '/v1/recall?task=chart.recommend&text=sales&domain=sales&intent=trend&field=revenue&reasonCode=R1&budget=400&limit=3&minCoverage=0.1',
      {
        headers: { authorization: `Bearer ${TOKEN}` },
      },
    );
    expect(recalled.status).toBe(200);
    const pack = (await recalled.json()) as { ids: string[]; rendered: string };
    expect(pack.ids).toEqual([]);
    expect(pack.rendered).toBe('');

    const missingRoute = await app.request('/v1/nope', { headers: { authorization: `Bearer ${TOKEN}` } });
    expect(missingRoute.status).toBe(404);
  });
});

describe('error mapping', () => {
  it('maps every named failure to a status a client can act on', () => {
    const codes: MicrogliaErrorCode[] = [
      'MG_E_CONFIG',
      'MG_E_SCHEMA_VERSION',
      'MG_E_SCHEMA_INVALID',
      'MG_E_NOT_OPEN',
      'MG_E_RUN_COMMITTED',
      'MG_E_NO_OUTPUT',
      'MG_E_INVALID_SIGNAL',
      'MG_E_UNKNOWN_TASK',
      'MG_E_UNKNOWN_SCOPE',
      'MG_E_STORE_IO',
      'MG_E_STORE_CORRUPT',
      'MG_E_KNOWLEDGE_UNSAFE',
      'MG_E_BUDGET_EXCEEDED',
      'MG_E_NAMESPACE_MISMATCH',
      'MG_E_PACK_STALE',
      'MG_E_PROVIDER_MISSING',
    ];
    const statuses = new Map(codes.map((code) => [code, statusFor(code)]));
    expect(statuses.get('MG_E_CONFIG')).toBe(400);
    expect(statuses.get('MG_E_NAMESPACE_MISMATCH')).toBe(401);
    expect(statuses.get('MG_E_RUN_COMMITTED')).toBe(409);
    expect(statuses.get('MG_E_BUDGET_EXCEEDED')).toBe(413);
    expect(statuses.get('MG_E_PROVIDER_MISSING')).toBe(503);
    expect(statuses.get('MG_E_STORE_IO')).toBe(500);
  });
});
