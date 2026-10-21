/**
 * `@agentix-e/microglia-node` — HTTP ingestion and recall.
 *
 * The server does two things a browser cannot do for itself: it owns a durable
 * store, and it holds the model credentials. Everything else is the same library
 * a single-process host uses.
 *
 * The route surface is deliberately five endpoints. A feedback API that grows an
 * endpoint per product feature becomes a second product; this one takes the run
 * and the reaction together, because that pair is what the library needs.
 */
import { Hono } from 'hono';
import { MicrogliaError, isMicrogliaError } from '@agentix-e/microglia-core';
import type {
  FeedbackInput,
  Json,
  JsonObject,
  Microglia,
  MicrogliaErrorCode,
} from '@agentix-e/microglia-core';

export type AppOptions = {
  /** An open facade. The caller owns its lifetime. */
  readonly microglia: Microglia;
  /** When set, every request must carry `Authorization: Bearer <token>`. */
  readonly token?: string;
  /** Largest accepted body, in bytes. Defaults to 256 KiB. */
  readonly maxBodyBytes?: number;
};

const DEFAULT_MAX_BODY = 256 * 1024;

/** HTTP status for a named library failure. Unknown codes are server errors. */
export function statusFor(code: MicrogliaErrorCode): 400 | 401 | 409 | 413 | 500 | 503 {
  switch (code) {
    case 'MG_E_CONFIG':
    case 'MG_E_SCHEMA_INVALID':
    case 'MG_E_INVALID_SIGNAL':
    case 'MG_E_UNKNOWN_SCOPE':
    case 'MG_E_UNKNOWN_TASK':
    case 'MG_E_SCHEMA_VERSION':
    case 'MG_E_KNOWLEDGE_UNSAFE':
      return 400;
    case 'MG_E_NAMESPACE_MISMATCH':
      return 401;
    case 'MG_E_RUN_COMMITTED':
    case 'MG_E_NO_OUTPUT':
    case 'MG_E_PACK_STALE':
    case 'MG_E_TASK_CONFLICT':
    case 'MG_E_TASK_CLOSED':
      return 409;
    case 'MG_E_BUDGET_EXCEEDED':
      return 413;
    case 'MG_E_PROVIDER_MISSING':
    case 'MG_E_NOT_OPEN':
      return 503;
    case 'MG_E_STORE_IO':
    case 'MG_E_STORE_CORRUPT':
      return 500;
  }
}

export function createApp(options: AppOptions): Hono {
  const app = new Hono();
  const limit = options.maxBodyBytes ?? DEFAULT_MAX_BODY;
  /**
   * Idempotency is per process, which is the honest guarantee: a retry that lands
   * on another replica is a duplicate, and a durable key store belongs to the
   * deployment (Redis, the host's database), not to this library. What the map does
   * buy is the common case — a browser retrying after a timeout — without asking
   * the host to build anything.
   */
  const seen = new Map<string, { runId: string; eventId: string }>();

  app.use('*', async (c, next) => {
    if (options.token !== undefined) {
      const header = c.req.header('authorization');
      if (header !== `Bearer ${options.token}`) {
        return c.json({ error: 'unauthorized' }, 401);
      }
    }
    await next();
  });

  app.get('/v1/health', async (c) => {
    const diagnosis = await options.microglia.doctor();
    return c.json({ ok: diagnosis.ok, issues: diagnosis.issues, stats: await options.microglia.stats() });
  });

  app.get('/v1/recall', async (c) => {
    const task = c.req.query('task');
    const text = c.req.query('text');
    if (task === undefined || text === undefined) {
      return c.json({ error: 'task and text are required' }, 400);
    }
    const scope = {
      ...(c.req.query('domain') === undefined ? {} : { domain: c.req.query('domain') as string }),
      ...(c.req.query('intent') === undefined ? {} : { intent: c.req.query('intent') as string }),
      ...(c.req.query('field') === undefined ? {} : { field: c.req.query('field') as string }),
      ...(c.req.query('reasonCode') === undefined
        ? {}
        : { reasonCode: c.req.query('reasonCode') as string }),
    };
    const pack = await options.microglia.recall({
      task,
      text,
      ...(Object.keys(scope).length === 0 ? {} : { scope }),
      ...(c.req.query('budget') === undefined ? {} : { budget: Number(c.req.query('budget')) }),
      ...(c.req.query('limit') === undefined ? {} : { limit: Number(c.req.query('limit')) }),
      ...(c.req.query('minCoverage') === undefined
        ? {}
        : { minCoverage: Number(c.req.query('minCoverage')) }),
    });
    return c.json({
      ids: pack.ids,
      rendered: pack.rendered,
      tokens: pack.tokens,
      hash: pack.hash,
      truncated: pack.truncated,
    });
  });

  app.post('/v1/feedback', async (c) => {
    const raw = await c.req.text();
    if (raw.length > limit) return c.json({ error: 'body too large', limit }, 413);
    let body: unknown;
    try {
      body = JSON.parse(raw) as unknown;
    } catch {
      return c.json({ error: 'body must be JSON' }, 400);
    }
    const parsed = parseIngest(body);
    if ('error' in parsed) return c.json({ error: parsed.error }, 400);

    const key = c.req.header('idempotency-key');
    if (key !== undefined) {
      const previous = seen.get(key);
      if (previous !== undefined) return c.json(previous, 200);
    }

    const run = options.microglia.begin({
      task: parsed.run.task,
      input: parsed.run.input as JsonObject,
      ...(parsed.run.sessionId === undefined ? {} : { sessionId: parsed.run.sessionId }),
      ...(parsed.run.model === undefined ? {} : { model: parsed.run.model }),
      ...(parsed.run.packIds === undefined
        ? {}
        : {
            pack: {
              items: [],
              ids: parsed.run.packIds,
              rendered: '',
              tokens: 0,
              hash: 'ingested',
              budget: 0,
              truncated: 0,
            },
          }),
    });
    await run.complete(parsed.run.output as Json);
    const event = await run.feedback(parsed.feedback);
    const result = { runId: run.id, eventId: event.id };
    if (key !== undefined) {
      if (seen.size >= 1000) {
        const oldest = seen.keys().next().value;
        if (oldest !== undefined) seen.delete(oldest);
      }
      seen.set(key, result);
    }
    return c.json(result, 201);
  });

  app.post('/v1/distill', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { generalize?: unknown };
    const report = await options.microglia.distill({
      ...(typeof body.generalize === 'boolean' ? { generalize: body.generalize } : {}),
    });
    return c.json(report);
  });

  app.get('/v1/knowledge', async (c) => {
    const status = c.req.query('status');
    const items = await options.microglia.store.listKnowledge({
      namespace: options.microglia.namespace,
      ...(status === undefined ? { status: 'active' } : { status: status as 'active' | 'all' }),
      ...(c.req.query('limit') === undefined ? {} : { limit: Number(c.req.query('limit')) }),
    });
    return c.json({
      count: items.length,
      items: items.map((item) => ({
        id: item.id,
        status: item.status,
        trust: item.trust,
        confidence: item.confidence,
        scope: item.scope,
        statement: item.statement,
      })),
    });
  });

  app.notFound((c) => c.json({ error: 'not found' }, 404));

  app.onError((error, c) => {
    if (isMicrogliaError(error)) {
      return c.json(
        { error: error.code, message: error.message, details: error.details },
        statusFor(error.code),
      );
    }
    return c.json({ error: 'internal', message: 'unexpected failure' }, 500);
  });

  return app;
}

type Ingest = {
  readonly run: {
    readonly task: string;
    readonly input: Record<string, unknown>;
    readonly output: Record<string, unknown>;
    readonly sessionId?: string;
    readonly model?: string;
    readonly packIds?: readonly string[];
  };
  readonly feedback: FeedbackInput;
};

function parseIngest(body: unknown): Ingest | { error: string } {
  if (typeof body !== 'object' || body === null) return { error: 'body must be an object' };
  const record = body as Record<string, unknown>;
  const run = record['run'];
  if (typeof run !== 'object' || run === null) return { error: 'run is required' };
  const runRecord = run as Record<string, unknown>;
  const task = runRecord['task'];
  const input = runRecord['input'];
  const output = runRecord['output'];
  if (typeof task !== 'string' || task === '') return { error: 'run.task is required' };
  if (typeof input !== 'object' || input === null) return { error: 'run.input must be an object' };
  if (typeof output !== 'object' || output === null) return { error: 'run.output must be an object' };

  const feedback = parseFeedback(record['feedback']);
  if ('error' in feedback) return feedback;

  const packIds = runRecord['packIds'];
  return {
    run: {
      task,
      input: input as Record<string, unknown>,
      output: output as Record<string, unknown>,
      ...(typeof runRecord['sessionId'] === 'string' ? { sessionId: runRecord['sessionId'] } : {}),
      ...(typeof runRecord['model'] === 'string' ? { model: runRecord['model'] } : {}),
      ...(Array.isArray(packIds) ? { packIds: packIds.filter((id): id is string => typeof id === 'string') } : {}),
    },
    feedback: feedback.value,
  };
}

function parseFeedback(value: unknown): { value: FeedbackInput } | { error: string } {
  if (typeof value !== 'object' || value === null) return { error: 'feedback is required' };
  const record = value as Record<string, unknown>;
  switch (record['type']) {
    case 'edit':
      if (typeof record['after'] !== 'object' || record['after'] === null) {
        return { error: 'feedback.after is required for an edit' };
      }
      return {
        value: {
          type: 'edit',
          after: record['after'] as Json,
          ...(typeof record['note'] === 'string' ? { note: record['note'] } : {}),
        },
      };
    case 'rating':
      if (record['value'] !== 'up' && record['value'] !== 'down') {
        return { error: "feedback.value must be 'up' or 'down'" };
      }
      return {
        value: {
          type: 'rating',
          value: record['value'],
          ...(Array.isArray(record['reasons'])
            ? { reasons: record['reasons'].filter((r): r is string => typeof r === 'string') }
            : {}),
        },
      };
    case 'outcome':
      if (typeof record['ok'] !== 'boolean') return { error: 'feedback.ok must be a boolean' };
      return {
        value: {
          type: 'outcome',
          ok: record['ok'],
          ...(typeof record['code'] === 'string' ? { code: record['code'] } : {}),
        },
      };
    case 'clarification':
      if (typeof record['question'] !== 'string' || typeof record['answer'] !== 'string') {
        return { error: 'feedback.question and feedback.answer are required' };
      }
      return { value: { type: 'clarification', question: record['question'], answer: record['answer'] } };
    case 'abstain':
      if (typeof record['reason'] !== 'string') return { error: 'feedback.reason is required' };
      return { value: { type: 'abstain', reason: record['reason'] } };
    default:
      return { error: 'unknown feedback type' };
  }
}

export { MicrogliaError };
