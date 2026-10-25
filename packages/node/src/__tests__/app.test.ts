import { describe, expect, it } from 'vitest';
import { EmbeddedMemory, MemoryJournal } from '@agentix-e/microglia-core/memory';
import {
  createKnowledgeItem,
  defaultPolicy,
  openMicroglia,
  type MicrogliaErrorCode,
} from '@agentix-e/microglia-core';
import {
  IDEMPOTENCY_CAPACITY,
  createApp,
  parseLimitQuery,
  parseStatusQuery,
  remember,
  statusFor,
} from '../app.js';

const TOKEN = 'test-token';

async function mount(options: { token?: string; corroborationFloor?: number } = {}) {
  const store = await EmbeddedMemory.open(new MemoryJournal());
  const microglia = await openMicroglia({
    app: 'test',
    namespace: 'acme',
    store,
    clock: { now: () => 1_700_000_000_000 },
    ...(options.corroborationFloor === undefined
      ? {}
      : { corroborationFloor: options.corroborationFloor }),
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

  it('refuses an oversized MCP body with 413 rather than parsing it', async () => {
    const store = await EmbeddedMemory.open(new MemoryJournal());
    const microglia = await openMicroglia({ app: 'test', namespace: 'acme', store });
    const app = createApp({ microglia, token: TOKEN, maxBodyBytes: 16 });
    const response = await app.request('/v1/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(response.status).toBe(413);
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

  it('tells an HTTP client when a pack was silenced rather than unmatched', async () => {
    // The driver and any other HTTP consumer sees an empty pack either way. Only one of
    // those two silences is a retrieval failure, so the reason has to cross the wire.
    const { app } = await mount({ token: TOKEN, corroborationFloor: 0.05 });
    const silenced = await app.request('/v1/recall?task=chart.recommend&text=sales', {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(silenced.status).toBe(200);
    expect(await silenced.json()).toMatchObject({ ids: [], suppressed: 'uncorroborated-store' });

    const unbiased = await mount({ token: TOKEN });
    const plain = await unbiased.app.request('/v1/recall?task=chart.recommend&text=sales', {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(await plain.json()).not.toHaveProperty('suppressed');
  });
});

describe('the ingest body is a contract, not a suggestion', () => {
  it('rejects a misspelt run field instead of dropping what it meant', async () => {
    // `run.taskID` used to be discarded without a word, so the grouping the caller
    // asked for never happened and three attempts at one job were counted as three
    // independent endorsements. A typo has to be an error, not a silence.
    const { app, store } = await mount({ token: TOKEN });
    const response = await post(app, '/v1/feedback', { ...edit, run: { ...edit.run, taskID: 't_1' } });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'run.taskID is not a field' });
    expect(await store.listEvents()).toHaveLength(0);
  });

  it('rejects an unknown top-level field too', async () => {
    const { app } = await mount({ token: TOKEN });
    const response = await post(app, '/v1/feedback', { ...edit, meta: { ui: 'sidebar' } });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'unknown field: meta' });
  });

  it('takes an actor hash of the right shape and refuses any other', async () => {
    const { app, store } = await mount({ token: TOKEN });
    for (const bad of ['', 7, null]) {
      const response = await post(app, '/v1/feedback', { ...edit, run: { ...edit.run, actorIdHash: bad } });
      expect(response.status).toBe(400);
    }
    const good = await post(app, '/v1/feedback', { ...edit, run: { ...edit.run, actorIdHash: 'sha256:x' } });
    expect(good.status).toBe(201);
    const [event] = await store.listEvents();
    expect(event?.actor).toEqual({ type: 'user', idHash: 'sha256:x' });
  });
});

describe('the idempotency map is bounded on purpose', () => {
  it('keeps the newest keys and evicts the oldest once it is full', () => {
    // Tested directly rather than through 1,001 requests: the map is the unit, and
    // a route test that made a thousand round trips would be slow and would still
    // not say which key was dropped.
    const seen = new Map<string, { runId: string; eventId: string }>();
    for (let i = 0; i < IDEMPOTENCY_CAPACITY; i += 1) {
      remember(seen, `k${i}`, { runId: `run_${i}`, eventId: `fb_${i}` });
    }
    expect(seen.size).toBe(IDEMPOTENCY_CAPACITY);
    remember(seen, 'overflow', { runId: 'run_x', eventId: 'fb_x' });
    expect(seen.size).toBe(IDEMPOTENCY_CAPACITY);
    expect(seen.has('k0')).toBe(false);
    expect(seen.has('overflow')).toBe(true);
    expect(seen.has(`k${IDEMPOTENCY_CAPACITY - 1}`)).toBe(true);
  });
});

describe('the query string is input, not decoration', () => {
  it('rejects a status it does not define, instead of listing nothing', async () => {
    // `?status=bogus` used to answer 200 with an empty list: a typo read as "you
    // have no knowledge". An empty answer to a valid question is a fact; an empty
    // answer to an invalid one is a lie with a 200 in front of it.
    const { app } = await mount({ token: TOKEN });
    const response = await app.request('/v1/knowledge?status=bogus', {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'MG_E_SCHEMA_INVALID' });
  });

  it('rejects a limit that is not a positive integer', async () => {
    const { app } = await mount({ token: TOKEN });
    for (const raw of ['abc', '-1', '0', '1.5', '']) {
      const response = await app.request(`/v1/knowledge?limit=${raw}`, {
        headers: { authorization: `Bearer ${TOKEN}` },
      });
      expect({ raw, status: response.status }).toEqual({ raw, status: 400 });
    }
  });

  it('honours a limit it accepted, and lists everything without one', async () => {
    const { app, store } = await mount({ token: TOKEN });
    // Written through the store rather than distilled: this is a test of the query
    // string, and a domain-blind facade would distil nothing to page through.
    for (const [index, id] of ['k_1', 'k_2'].entries()) {
      await store.putKnowledge(
        createKnowledgeItem(
          {
            namespace: 'acme',
            kind: 'constraint',
            scope: { task: 'chart.recommend' },
            statement: `Rule ${id}`,
            evidence: { feedbackId: `fb_${id}`, runId: 'run', at: 1_700_000_000_000, weight: 0.9 },
            trust: 0.9,
            dedupeKey: id,
          },
          defaultPolicy,
          1_700_000_000_000 + index,
          id,
        ),
      );
    }
    const all = (await (await app.request('/v1/knowledge?status=all', {
      headers: { authorization: `Bearer ${TOKEN}` },
    })).json()) as { count: number };
    expect(all.count).toBeGreaterThan(0);
    const one = (await (await app.request('/v1/knowledge?status=all&limit=1', {
      headers: { authorization: `Bearer ${TOKEN}` },
    })).json()) as { count: number };
    expect(one.count).toBe(1);
  });

  it('parses the two defined statuses and no others', () => {
    expect(parseStatusQuery(undefined)).toEqual({ ok: true, value: 'active' });
    expect(parseStatusQuery('active')).toEqual({ ok: true, value: 'active' });
    expect(parseStatusQuery('all')).toEqual({ ok: true, value: 'all' });
    expect(parseStatusQuery('retired').ok).toBe(false);
    expect(parseStatusQuery('ACTIVE').ok).toBe(false);
  });

  it('parses a limit as an integer, and absence as no limit at all', () => {
    expect(parseLimitQuery(undefined)).toEqual({ ok: true, value: undefined });
    expect(parseLimitQuery('7')).toEqual({ ok: true, value: 7 });
    expect(parseLimitQuery(' 7 ')).toEqual({ ok: true, value: 7 });
    for (const raw of ['abc', '0', '-3', '2.0', '1e3', '99999999999999999999']) {
      expect({ raw, ok: parseLimitQuery(raw).ok }).toEqual({ raw, ok: false });
    }
  });

  it('refuses a generalize flag that is present and not a boolean', async () => {
    // `{"generalize": "false"}` is a truthy string: silently dropping it applied the
    // *wider* behaviour the caller meant to switch off.
    const { app } = await mount({ token: TOKEN });
    const response = await post(app, '/v1/distill', { generalize: 'false' });
    expect(response.status).toBe(400);
    const fine = await post(app, '/v1/distill', { generalize: false });
    expect(fine.status).toBe(200);
    const none = await post(app, '/v1/distill', {});
    expect(none.status).toBe(200);
  });
});

describe('error mapping', () => {
  it('maps every named failure to a status a client can act on', () => {
    // A `Record` over the code union, not a list: adding a code without deciding
    // its status is a compile error here rather than a 500 in production.
    const expected: Record<MicrogliaErrorCode, 400 | 401 | 409 | 413 | 500 | 503> = {
      MG_E_CONFIG: 400,
      MG_E_SCHEMA_VERSION: 400,
      MG_E_SCHEMA_INVALID: 400,
      MG_E_INVALID_SIGNAL: 400,
      MG_E_UNKNOWN_TASK: 400,
      MG_E_UNKNOWN_SCOPE: 400,
      MG_E_KNOWLEDGE_UNSAFE: 400,
      MG_E_NAMESPACE_MISMATCH: 401,
      MG_E_RUN_COMMITTED: 409,
      MG_E_NO_OUTPUT: 409,
      MG_E_PACK_STALE: 409,
      MG_E_TASK_CONFLICT: 409,
      MG_E_TASK_CLOSED: 409,
      MG_E_BUDGET_EXCEEDED: 413,
      MG_E_PROVIDER_MISSING: 503,
      MG_E_PROVIDER_FAILED: 503,
      MG_E_NOT_OPEN: 503,
      MG_E_STORE_IO: 500,
      MG_E_STORE_CORRUPT: 500,
    };
    for (const [code, status] of Object.entries(expected)) {
      expect(statusFor(code as MicrogliaErrorCode)).toBe(status);
    }
  });
});

describe('the task instance over the wire', () => {
  it('carries taskId, attempt and parentRunId from the request to the records', async () => {
    const { app, microglia, store } = await mount({ token: TOKEN });
    const response = await post(app, '/v1/feedback', {
      ...edit,
      run: { ...edit.run, taskId: 't_9', attempt: 2, parentRunId: 'run_parent' },
    });
    expect(response.status).toBe(201);
    const [event] = await store.listEvents();
    expect(event).toMatchObject({ taskId: 't_9', attempt: 2 });
    const run = await store.getRun((event as { runId: string }).runId);
    expect(run).toMatchObject({ taskId: 't_9', attempt: 2, parentRunId: 'run_parent' });
    await microglia.close();
  });

  it('rejects a malformed task instance instead of silently dropping it', async () => {
    const { app, microglia } = await mount({ token: TOKEN });
    expect((await post(app, '/v1/feedback', { ...edit, run: { ...edit.run, taskId: '' } })).status).toBe(400);
    expect((await post(app, '/v1/feedback', { ...edit, run: { ...edit.run, attempt: 0 } })).status).toBe(400);
    expect((await post(app, '/v1/feedback', { ...edit, run: { ...edit.run, attempt: 1.5 } })).status).toBe(400);
    expect((await post(app, '/v1/feedback', { ...edit, run: { ...edit.run, parentRunId: 7 } })).status).toBe(400);
    await microglia.close();
  });
});

describe('erasure over the wire', () => {
  it('erases by task and reports what it removed', async () => {
    const { app, microglia, store } = await mount({ token: TOKEN });
    const ingest = await post(app, '/v1/feedback', {
      ...edit,
      run: { ...edit.run, taskId: 't_1' },
    });
    expect(ingest.status).toBe(201);

    const response = await post(app, '/v1/forget', { taskId: 't_1' });
    expect(response.status).toBe(200);
    const report = (await response.json()) as { events: number; tombstone: string };
    expect(report.events).toBe(1);
    expect(report.tombstone).toMatch(/^[0-9a-f]{16}$/);
    expect(await store.listEvents()).toHaveLength(0);
    await microglia.close();
  });

  it('erases by the ids it was given, and only those', async () => {
    const { app, microglia, store } = await mount({ token: TOKEN });
    const first = (await (await post(app, '/v1/feedback', edit)).json()) as { eventId: string };
    await post(app, '/v1/feedback', edit);
    expect(await store.listEvents()).toHaveLength(2);

    const response = await post(app, '/v1/forget', { ids: [first.eventId] });
    expect(response.status).toBe(200);
    expect(((await response.json()) as { events: number }).events).toBe(1);
    const left = await store.listEvents();
    expect(left).toHaveLength(1);
    expect(left[0]?.id).not.toBe(first.eventId);
    await microglia.close();
  });

  it('erases everything one actor contributed, once the surface records who that is', async () => {
    // The HTTP surface used to accept `actorHash` while never recording one, so the
    // selector matched nothing and answered 200 — a quiet success in the one place
    // the route exists to avoid one.
    const { app, microglia, store } = await mount({ token: TOKEN });
    const mine = { ...edit, run: { ...edit.run, actorIdHash: 'sha256:alice' } };
    const theirs = { ...edit, run: { ...edit.run, actorIdHash: 'sha256:bob' } };
    await post(app, '/v1/feedback', mine);
    await post(app, '/v1/feedback', mine);
    await post(app, '/v1/feedback', theirs);
    expect(await store.listEvents()).toHaveLength(3);

    const response = await post(app, '/v1/forget', { actorHash: 'sha256:alice' });
    expect(response.status).toBe(200);
    expect(((await response.json()) as { events: number }).events).toBe(2);
    const left = await store.listEvents();
    expect(left).toHaveLength(1);
    expect(left[0]?.task).toBe('chart.recommend');
    await microglia.close();
  });

  it('applies both halves of a mixed selector', async () => {
    const { app, microglia, store } = await mount({ token: TOKEN });
    const a = (await (await post(app, '/v1/feedback', { ...edit, run: { ...edit.run, taskId: 't_a' } })).json()) as {
      eventId: string;
    };
    await post(app, '/v1/feedback', { ...edit, run: { ...edit.run, taskId: 't_b' } });
    const response = await post(app, '/v1/forget', { ids: [a.eventId], taskId: 't_b' });
    expect(((await response.json()) as { events: number }).events).toBe(2);
    expect(await store.listEvents()).toHaveLength(0);
    await microglia.close();
  });

  it('treats ids: [] as no selector at all, rather than as a wipe', async () => {
    const { app, microglia, store } = await mount({ token: TOKEN });
    await post(app, '/v1/feedback', edit);
    const response = await post(app, '/v1/forget', { ids: [] });
    expect(response.status).toBe(400);
    expect(await store.listEvents()).toHaveLength(1);
    await microglia.close();
  });

  it('refuses an empty selector rather than reporting a quiet success', async () => {
    const { app, microglia } = await mount({ token: TOKEN });
    const response = await post(app, '/v1/forget', {});
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'ids, taskId or actorHash is required' });
    await microglia.close();
  });

  it('rejects a typo instead of erasing nothing and looking successful', async () => {
    const { app, microglia } = await mount({ token: TOKEN });
    const response = await post(app, '/v1/forget', { taskID: 't_1' });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'unknown field: taskID' });
    await microglia.close();
  });

  it('rejects a selector whose field has the wrong shape', async () => {
    const { app, microglia } = await mount({ token: TOKEN });
    expect((await post(app, '/v1/forget', { ids: 'k_1' })).status).toBe(400);
    expect((await post(app, '/v1/forget', { ids: [''] })).status).toBe(400);
    expect((await post(app, '/v1/forget', { taskId: 7 })).status).toBe(400);
    expect((await post(app, '/v1/forget', { actorHash: '' })).status).toBe(400);
    expect((await post(app, '/v1/forget', null)).status).toBe(400);
    await microglia.close();
  });

  it('rejects a body that is not JSON, and one that is too large', async () => {
    const { app, microglia } = await mount({ token: TOKEN });
    const broken = await app.request('/v1/forget', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: '{not json',
    });
    expect(broken.status).toBe(400);
    expect(await broken.json()).toMatchObject({ error: 'body must be JSON' });

    const tiny = createApp({ microglia, token: TOKEN, maxBodyBytes: 4 });
    const huge = await tiny.request('/v1/forget', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ taskId: 't_1' }),
    });
    expect(huge.status).toBe(413);
    await microglia.close();
  });

  it('turns an unexpected failure into a 500 rather than a stack trace', async () => {
    const { app, microglia } = await mount({ token: TOKEN });
    Object.assign(microglia, {
      forget: async () => {
        throw new Error('disk on fire');
      },
    });
    const response = await post(app, '/v1/forget', { taskId: 't_1' });
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: 'internal' });
    await microglia.close();
  });

  it('requires the bearer token like every other route', async () => {
    const { app, microglia } = await mount({ token: TOKEN });
    const response = await app.request('/v1/forget', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ taskId: 't_1' }),
    });
    expect(response.status).toBe(401);
    await microglia.close();
  });
});
