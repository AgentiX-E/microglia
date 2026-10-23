/**
 * The MCP surface: two tools, and nothing else.
 *
 * An agent that can ask will ask too often — every turn, for every question — so
 * the surface is deliberately two calls: look up what this workspace has learned,
 * and say that an answer was wrong. Anything larger turns the library into a second
 * product with its own tool taxonomy, and the gate in §17.21 measures exactly that
 * risk (≤2 calls per task; an agent that recalls every turn has replaced a prompt
 * block with a latency tax).
 *
 * ## One deviation from the written contract, and why
 *
 * §17.21 sketched `microglia_feedback` as `{taskId, kind, after}`. The shipped tool
 * takes **`runId`**, because feedback in this library attaches to a *run* — one
 * immutable generation — and a task can have several attempts. A task id alone
 * cannot say which attempt the user was judging, and guessing "the last one" would
 * blame a generation that may have been correct. The schema below is the corrected
 * contract; §17.21 carries the note.
 *
 * ## Transport
 *
 * JSON-RPC 2.0 over HTTP (`POST /v1/mcp`), one request per call, no SSE. That is
 * enough for a tool caller and testable without a socket dance; stdio is a
 * transport, not a behaviour, and can be added without touching this file.
 */
import { MicrogliaError, type JsonObject, type Microglia } from '@agentix-e/microglia-core';

/** Newest first; the negotiated version is echoed when a client asks for one we serve. */
export const MCP_PROTOCOL_VERSIONS = ['2025-06-18', '2024-11-05'] as const;
export const MCP_LATEST_PROTOCOL = MCP_PROTOCOL_VERSIONS[0];

export type McpTool = {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: {
    readonly type: 'object';
    readonly required: readonly string[];
    readonly properties: Readonly<Record<string, unknown>>;
    readonly additionalProperties: false;
  };
};

/**
 * The two tools, as data.
 *
 * Descriptions are instructions to a model, so they say when to call and what the
 * call buys — not what the endpoint does internally.
 */
export const MCP_TOOLS: readonly McpTool[] = [
  {
    name: 'microglia_recall',
    description:
      'Look up workspace conventions learned from earlier corrections before answering.',
    inputSchema: {
      type: 'object',
      required: ['taskType', 'question'],
      properties: {
        taskType: { type: 'string', description: 'The task the answer belongs to, e.g. chart.recommend.' },
        question: { type: 'string', description: 'The question or instruction being answered.' },
        domain: { type: 'string', description: 'Narrow the lookup to one domain, when the task has domains.' },
        budget: { type: 'integer', minimum: 1, description: 'Maximum characters of knowledge to return.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'microglia_feedback',
    description: 'Record that a particular answer was wrong and what the correct one is.',
    inputSchema: {
      type: 'object',
      required: ['runId', 'kind'],
      properties: {
        runId: { type: 'string', description: 'The run whose output is being judged.' },
        kind: { type: 'string', enum: ['edit', 'rating', 'abstain'], description: 'What kind of reaction this is.' },
        after: { type: 'object', description: 'For `edit`: the corrected output, in the task\'s own shape.' },
        value: { type: 'string', enum: ['up', 'down'], description: 'For `rating`: the verdict.' },
        reason: { type: 'string', description: 'For `abstain`: why this question cannot be answered here.' },
        note: { type: 'string', description: 'Free-text note carried with the feedback.' },
      },
      additionalProperties: false,
    },
  },
];

export type JsonRpcId = string | number | null;

export type JsonRpcResponse = {
  readonly jsonrpc: '2.0';
  readonly id: JsonRpcId;
  readonly result?: unknown;
  readonly error?: { readonly code: number; readonly message: string; readonly data?: unknown };
};

/** JSON-RPC codes this server returns. Tool failures are results, not codes. */
export const RPC_PARSE_ERROR = -32700;
export const RPC_INVALID_REQUEST = -32600;
export const RPC_METHOD_NOT_FOUND = -32601;
export const RPC_INVALID_PARAMS = -32602;

export type McpOptions = {
  readonly microglia: Microglia;
  readonly serverName?: string;
  readonly version?: string;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function failure(id: JsonRpcId, code: number, message: string, data?: unknown): JsonRpcResponse {
  return {
    jsonrpc: '2.0',
    id,
    error: { code, message, ...(data === undefined ? {} : { data }) },
  };
}

function success(id: JsonRpcId, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result };
}

/**
 * A tool's outcome, in the shape MCP expects.
 *
 * A failure that the *tool* produced (an unknown run, an invalid edit) comes back
 * as `isError: true` with a message, not as a protocol error: the model is supposed
 * to read it and try something else. A malformed *request* is a protocol error,
 * because no amount of model reasoning fixes a missing field.
 */
function toolText(text: string, isError = false, meta?: JsonObject): unknown {
  return {
    content: [{ type: 'text', text }],
    isError,
    ...(meta === undefined ? {} : { _meta: meta }),
  };
}

export type McpHandler = (request: unknown) => Promise<JsonRpcResponse | undefined>;

export function createMcpHandler(options: McpOptions): McpHandler {
  const name = options.serverName ?? 'microglia';
  const version = options.version ?? '0.1.0';

  async function callTool(params: Record<string, unknown>, id: JsonRpcId): Promise<JsonRpcResponse> {
    const tool = params['name'];
    if (typeof tool !== 'string') return failure(id, RPC_INVALID_PARAMS, '`name` must be a string');
    const args = asRecord(params['arguments'] ?? {});
    if (args === undefined) return failure(id, RPC_INVALID_PARAMS, '`arguments` must be an object');

    if (tool === 'microglia_recall') {
      const taskType = args['taskType'];
      const question = args['question'];
      if (typeof taskType !== 'string' || taskType.length === 0) {
        return failure(id, RPC_INVALID_PARAMS, '`taskType` must be a non-empty string');
      }
      if (typeof question !== 'string' || question.length === 0) {
        return failure(id, RPC_INVALID_PARAMS, '`question` must be a non-empty string');
      }
      const domain = args['domain'];
      const budget = args['budget'];
      if (domain !== undefined && typeof domain !== 'string') {
        return failure(id, RPC_INVALID_PARAMS, '`domain` must be a string when present');
      }
      if (budget !== undefined && (typeof budget !== 'number' || !Number.isInteger(budget) || budget < 1)) {
        return failure(id, RPC_INVALID_PARAMS, '`budget` must be a positive integer when present');
      }
      const pack = await options.microglia.recall({
        task: taskType,
        text: question,
        ...(domain === undefined ? {} : { scope: { domain } }),
        ...(budget === undefined ? {} : { budget }),
      });
      return success(
        id,
        toolText(pack.rendered, false, {
          ids: [...pack.ids],
          tokens: pack.tokens,
          hash: pack.hash,
          truncated: pack.truncated,
        }),
      );
    }

    if (tool === 'microglia_feedback') {
      const runId = args['runId'];
      const kind = args['kind'];
      if (typeof runId !== 'string' || runId.length === 0) {
        return failure(id, RPC_INVALID_PARAMS, '`runId` must be a non-empty string');
      }
      if (kind !== 'edit' && kind !== 'rating' && kind !== 'abstain') {
        return failure(id, RPC_INVALID_PARAMS, '`kind` must be one of edit, rating, abstain');
      }
      const run = await options.microglia.store.getRun(runId);
      if (run === undefined) {
        // The run is the unit of feedback; an unknown one is a tool failure the
        // caller can correct, not a protocol error.
        return success(id, toolText(`No run '${runId}' in this namespace.`, true));
      }
      const note = args['note'];
      const noteOption = typeof note === 'string' ? { note } : {};
      try {
        if (kind === 'edit') {
          const after = asRecord(args['after']);
          if (after === undefined) {
            return failure(id, RPC_INVALID_PARAMS, '`after` is required for an edit');
          }
          await options.microglia.recordFeedback(run, {
            type: 'edit',
            after: after as unknown as JsonObject,
            ...noteOption,
          });
        } else if (kind === 'rating') {
          const value = args['value'];
          if (value !== 'up' && value !== 'down') {
            return failure(id, RPC_INVALID_PARAMS, '`value` must be up or down for a rating');
          }
          await options.microglia.recordFeedback(run, { type: 'rating', value, ...noteOption });
        } else {
          const reason = args['reason'];
          if (typeof reason !== 'string' || reason.length === 0) {
            return failure(id, RPC_INVALID_PARAMS, '`reason` is required for an abstention');
          }
          await options.microglia.recordFeedback(run, { type: 'abstain', reason });
        }
      } catch (error) {
        if (error instanceof MicrogliaError) return success(id, toolText(error.message, true, { code: error.code }));
        throw error;
      }
      return success(id, toolText(`Recorded a ${kind} against ${runId}.`));
    }

    return failure(id, RPC_INVALID_PARAMS, `Unknown tool '${tool}'`, { tools: MCP_TOOLS.map((entry) => entry.name) });
  }

  return async (request: unknown) => {
    // A batch is legal JSON-RPC and not part of MCP's tool flow; refusing it is
    // clearer than answering half of one.
    if (Array.isArray(request)) {
      return failure(null, RPC_INVALID_REQUEST, 'Batch requests are not supported');
    }
    const body = asRecord(request);
    if (body === undefined) return failure(null, RPC_INVALID_REQUEST, 'A request must be an object');
    if (body['jsonrpc'] !== '2.0') return failure(null, RPC_INVALID_REQUEST, '`jsonrpc` must be "2.0"');

    const method = body['method'];
    if (typeof method !== 'string') return failure(null, RPC_INVALID_REQUEST, '`method` must be a string');
    const hasId = Object.prototype.hasOwnProperty.call(body, 'id');
    const rawId = body['id'];
    const id: JsonRpcId = typeof rawId === 'string' || typeof rawId === 'number' ? rawId : null;
    const rawParams = body['params'];
    const params = rawParams === undefined ? {} : asRecord(rawParams);
    if (params === undefined) return failure(id, RPC_INVALID_PARAMS, '`params` must be an object');

    if (method === 'initialize') {
      const requested = params['protocolVersion'];
      const negotiated =
        typeof requested === 'string' && (MCP_PROTOCOL_VERSIONS as readonly string[]).includes(requested)
          ? requested
          : MCP_LATEST_PROTOCOL;
      return success(id, {
        protocolVersion: negotiated,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name, version },
      });
    }

    // Notifications carry no id and take no response — `initialized` is the one a
    // client always sends, and answering it breaks strict clients.
    if (!hasId) return undefined;

    if (method === 'ping') return success(id, {});
    if (method === 'tools/list') return success(id, { tools: MCP_TOOLS });
    if (method === 'tools/call') return callTool(params, id);
    return failure(id, RPC_METHOD_NOT_FOUND, `Unknown method '${method}'`);
  };
}
