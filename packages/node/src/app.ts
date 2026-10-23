/**
 * `@agentix-e/microglia-node` — HTTP ingestion and recall.
 *
 * The server does two things a browser cannot do for itself: it owns a durable
 * store, and it holds the model credentials. Everything else is the same library
 * a single-process host uses.
 *
 * The route surface is deliberately small: health, recall, feedback, distill,
 * knowledge, and forget. A feedback API that grows an endpoint per product
 * feature becomes a second product; this one takes the run and the reaction
 * together, because that pair is what the library needs.
 *
 * `forget` is the sixth and the last. It is not a feature endpoint: a host that
 * runs this server cannot honour a deletion obligation through the SDK alone,
 * and a store of other people's corrections without a reachable delete is the
 * one asymmetry worth breaking the rule for.
 */
import { Hono } from 'hono';
import { MicrogliaError, isMicrogliaError } from '@agentix-e/microglia-core';
import { RPC_PARSE_ERROR, createMcpHandler } from './mcp.js';
import type {
  ErasureSelector,
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
    case 'MG_E_PROVIDER_FAILED':
    case 'MG_E_NOT_OPEN':
      return 503;
    case 'MG_E_STORE_IO':
    case 'MG_E_STORE_CORRUPT':
      return 500;
  }
}

/**
 * A parsed query parameter, or the reason it could not be parsed.
 *
 * A union rather than a fallback: `?status=bogus` used to reach the store as an
 * unknown status and come back as an empty list with a 200, which reads as "you
 * have no knowledge" — a lie that a caller has no way to notice. Every call site
 * now has to answer both arms, and the route answers the failing one with a 400.
 */
export type ParsedQuery<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: string };

/** The two statuses the API defines. `all` includes retired and quarantined. */
const STATUSES = ['active', 'all'] as const;

/** `?status=`, defaulting to `active`: the list a host polls is the live one. */
export function parseStatusQuery(raw: string | undefined): ParsedQuery<'active' | 'all'> {
  if (raw === undefined) return { ok: true, value: 'active' };
  const match = STATUSES.find((status) => status === raw);
  if (match === undefined) {
    return { ok: false, reason: `status must be one of ${STATUSES.join(', ')}, got '${raw}'` };
  }
  return { ok: true, value: match };
}

/**
 * `?limit=`, absent meaning no limit.
 *
 * The digits are checked as text, not as a number: `Number('2.0')` is 2 and
 * `Number('1e3')` is 1000, so a numeric check would accept a decimal point and a
 * scientific literal and then behave as though neither had been written. `limit`
 * is a count of rows; the grammar for a count is digits.
 */
export function parseLimitQuery(raw: string | undefined): ParsedQuery<number | undefined> {
  if (raw === undefined) return { ok: true, value: undefined };
  const trimmed = raw.trim();
  if (!/^[1-9]\d*$/.test(trimmed)) {
    return { ok: false, reason: `limit must be a positive integer, got '${raw}'` };
  }
  const value = Number(trimmed);
  if (!Number.isSafeInteger(value)) {
    return { ok: false, reason: `limit must be a safe integer, got '${raw}'` };
  }
  return { ok: true, value };
}

/**
 * Remember an idempotent result, keeping the map bounded.
 *
 * Bounded because the map is per process and unbounded only in the sense that a
 * long-lived host would grow it forever: 1,000 recent keys is more than a retry
 * window needs, and the oldest is evicted first. The eviction is here rather than
 * inside the route so it can be exercised without 1,001 requests.
 */
export const IDEMPOTENCY_CAPACITY = 1000;

export function remember(
  seen: Map<string, { runId: string; eventId: string }>,
  key: string,
  value: { runId: string; eventId: string },
): void {
  if (seen.size >= IDEMPOTENCY_CAPACITY) {
    const oldest = seen.keys().next().value;
    if (oldest !== undefined) seen.delete(oldest);
  }
  seen.set(key, value);
}

/**
 * A selector body, validated field by field.
 *
 * Unknown fields are rejected rather than ignored: `{ taskID: 'x' }` is a typo
 * that would erase nothing and look like success, which is the worst possible
 * answer to a deletion request.
 */
function parseForget(body: unknown): { selector: ErasureSelector } | { error: string } {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'body must be an object' };
  }
  const record = body as Record<string, unknown>;
  const allowed = new Set(['ids', 'taskId', 'actorHash']);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) return { error: `unknown field: ${key}` };
  }
  const ids = record['ids'];
  if (ids !== undefined && (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string' || id === ''))) {
    return { error: 'ids must be an array of non-empty strings' };
  }
  const taskId = record['taskId'];
  if (taskId !== undefined && (typeof taskId !== 'string' || taskId === '')) {
    return { error: 'taskId must be a non-empty string' };
  }
  const actorHash = record['actorHash'];
  if (actorHash !== undefined && (typeof actorHash !== 'string' || actorHash === '')) {
    return { error: 'actorHash must be a non-empty string' };
  }
  if (ids === undefined && taskId === undefined && actorHash === undefined) {
    return { error: 'ids, taskId or actorHash is required' };
  }
  return {
    selector: {
      ...(ids === undefined ? {} : { ids: ids as string[] }),
      ...(taskId === undefined ? {} : { taskId: taskId as string }),
      ...(actorHash === undefined ? {} : { actorHash: actorHash as string }),
    },
  };
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
  /**
   * The MCP surface is mounted as one route rather than a framework plugin: it is a
   * JSON-RPC envelope over the same facade, and a second routing layer would only
   * add a place for the two to disagree about authentication.
   */
  const mcp = createMcpHandler({ microglia: options.microglia });

  app.use('*', async (c, next) => {
    if (options.token !== undefined) {
      const header = c.req.header('authorization');
      if (header !== `Bearer ${options.token}`) {
        return c.json({ error: 'unauthorized' }, 401);
      }
    }
    await next();
  });

  app.post('/v1/mcp', async (c) => {
    const raw = await c.req.text();
    if (raw.length > limit) return c.json({ error: 'body too large', limit }, 413);
    let body: unknown;
    try {
      body = JSON.parse(raw) as unknown;
    } catch {
      // A parse error has no id to echo; JSON-RPC says use null.
      return c.json({ jsonrpc: '2.0', id: null, error: { code: RPC_PARSE_ERROR, message: 'Parse error' } }, 400);
    }
    const response = await mcp(body);
    // A notification gets no body; 202 says "received", which is all a notification
    // can be owed.
    if (response === undefined) return c.body(null, 202);
    return c.json(response);
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
      ...(parsed.run.taskId === undefined ? {} : { taskId: parsed.run.taskId }),
      ...(parsed.run.attempt === undefined ? {} : { attempt: parsed.run.attempt }),
      ...(parsed.run.parentRunId === undefined ? {} : { parentRunId: parsed.run.parentRunId }),
    });
    await run.complete(parsed.run.output as Json);
    const event = await run.feedback(parsed.feedback, {
      ...(parsed.run.actorIdHash === undefined
        ? {}
        : { actor: { type: 'user' as const, idHash: parsed.run.actorIdHash } }),
    });
    const result = { runId: run.id, eventId: event.id };
    if (key !== undefined) remember(seen, key, result);
    return c.json(result, 201);
  });

  app.post('/v1/distill', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { generalize?: unknown };
    // Present and not a boolean is a refusal, not a default. `"false"` is a truthy
    // string, so dropping it silently applied the wider behaviour the caller was
    // trying to switch off.
    if (body.generalize !== undefined && typeof body.generalize !== 'boolean') {
      return c.json(
        { error: 'MG_E_SCHEMA_INVALID', message: 'generalize must be a boolean when present' },
        400,
      );
    }
    const report = await options.microglia.distill({
      ...(body.generalize === undefined ? {} : { generalize: body.generalize }),
    });
    return c.json(report);
  });

  app.get('/v1/knowledge', async (c) => {
    const parsed = parseStatusQuery(c.req.query('status'));
    if (!parsed.ok) {
      return c.json({ error: 'MG_E_SCHEMA_INVALID', message: parsed.reason }, 400);
    }
    const limited = parseLimitQuery(c.req.query('limit'));
    if (!limited.ok) {
      return c.json({ error: 'MG_E_SCHEMA_INVALID', message: limited.reason }, 400);
    }
    const items = await options.microglia.store.listKnowledge({
      namespace: options.microglia.namespace,
      status: parsed.value,
      ...(limited.value === undefined ? {} : { limit: limited.value }),
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

  /**
   * Erase by selector.
   *
   * The body never carries a namespace: the facade sets its own, so a token for
   * one tenant cannot be replayed against another. An empty body is a 400 rather
   * than a 200 with zeros, because `forget({})` is a wipe request that the
   * library refuses, and the route should say so before calling it.
   */
  app.post('/v1/forget', async (c) => {
    const raw = await c.req.text();
    if (raw.length > limit) return c.json({ error: 'body too large', limit }, 413);
    let body: unknown;
    try {
      body = JSON.parse(raw) as unknown;
    } catch {
      return c.json({ error: 'body must be JSON' }, 400);
    }
    const parsed = parseForget(body);
    if ('error' in parsed) return c.json({ error: parsed.error }, 400);
    const report = await options.microglia.forget(parsed.selector);
    return c.json(report, 200);
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
    /**
     * The task instance this run belongs to.
     *
     * Without it every event is its own task, so three attempts at one job count
     * as three independent endorsements and a deletion request that names the
     * job matches nothing. The field is optional only because a host that never
     * groups attempts keeps the older behaviour.
     */
    readonly taskId?: string;
    readonly attempt?: number;
    readonly parentRunId?: string;
    /**
     * A salted hash of who produced this reaction, when the host has one.
     *
     * Without it `POST /v1/forget { actorHash }` — a documented selector — matched
     * nothing and answered 200: the surface accepted a request it could never
     * satisfy. It is an identity for erasure only; the actor *type* stays `user`,
     * because trust never climbs on a claim the requester makes about itself.
     */
    readonly actorIdHash?: string;
  };
  readonly feedback: FeedbackInput;
};

const INGEST_FIELDS = new Set(['run', 'feedback']);
const RUN_FIELDS = new Set([
  'task',
  'input',
  'output',
  'sessionId',
  'model',
  'packIds',
  'taskId',
  'attempt',
  'parentRunId',
  'actorIdHash',
]);

/**
 * Reject an unknown field, naming it.
 *
 * Lenient parsing is how a typo becomes a silent behaviour change: `run.taskID`
 * was dropped, so the task grouping the caller asked for never happened and three
 * attempts at one job counted as three independent endorsements. The erasure
 * selector has refused unknown fields since it was written for the same reason;
 * this is the same rule at the other end of the surface.
 */
function unknownField(record: Record<string, unknown>, allowed: ReadonlySet<string>): string | undefined {
  for (const key of Object.keys(record)) if (!allowed.has(key)) return `unknown field: ${key}`;
  return undefined;
}

function parseIngest(body: unknown): Ingest | { error: string } {
  if (typeof body !== 'object' || body === null) return { error: 'body must be an object' };
  const record = body as Record<string, unknown>;
  const unknown = unknownField(record, INGEST_FIELDS);
  if (unknown !== undefined) return { error: unknown };
  const run = record['run'];
  if (typeof run !== 'object' || run === null) return { error: 'run is required' };
  const runRecord = run as Record<string, unknown>;
  const unknownRun = unknownField(runRecord, RUN_FIELDS);
  if (unknownRun !== undefined) return { error: `run.${unknownRun.replace('unknown field: ', '')} is not a field` };
  const task = runRecord['task'];
  const input = runRecord['input'];
  const output = runRecord['output'];
  if (typeof task !== 'string' || task === '') return { error: 'run.task is required' };
  if (typeof input !== 'object' || input === null) return { error: 'run.input must be an object' };
  if (typeof output !== 'object' || output === null) return { error: 'run.output must be an object' };

  const feedback = parseFeedback(record['feedback']);
  if ('error' in feedback) return feedback;

  const packIds = runRecord['packIds'];
  const taskId = runRecord['taskId'];
  if (taskId !== undefined && (typeof taskId !== 'string' || taskId === '')) {
    return { error: 'run.taskId must be a non-empty string' };
  }
  const attempt = runRecord['attempt'];
  if (attempt !== undefined && (!Number.isInteger(attempt) || (attempt as number) < 1)) {
    return { error: 'run.attempt must be a positive integer' };
  }
  const actorIdHash = runRecord['actorIdHash'];
  if (actorIdHash !== undefined && (typeof actorIdHash !== 'string' || actorIdHash === '')) {
    return { error: 'run.actorIdHash must be a non-empty string' };
  }
  const parentRunId = runRecord['parentRunId'];
  if (parentRunId !== undefined && typeof parentRunId !== 'string') {
    return { error: 'run.parentRunId must be a string' };
  }
  return {
    run: {
      task,
      input: input as Record<string, unknown>,
      output: output as Record<string, unknown>,
      ...(typeof runRecord['sessionId'] === 'string' ? { sessionId: runRecord['sessionId'] } : {}),
      ...(typeof runRecord['model'] === 'string' ? { model: runRecord['model'] } : {}),
      ...(Array.isArray(packIds) ? { packIds: packIds.filter((id): id is string => typeof id === 'string') } : {}),
      ...(taskId === undefined ? {} : { taskId }),
      ...(attempt === undefined ? {} : { attempt: attempt as number }),
      ...(parentRunId === undefined ? {} : { parentRunId }),
      ...(actorIdHash === undefined ? {} : { actorIdHash }),
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
