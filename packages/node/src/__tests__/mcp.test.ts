import { describe, expect, it } from 'vitest';
import { EmbeddedMemory, MemoryJournal } from '@agentix-e/microglia-core/memory';
import { dedupeKeyOf, openMicroglia, type Interpreter, type Microglia } from '@agentix-e/microglia-core';
import { createApp } from '../app.js';
import {
  MCP_LATEST_PROTOCOL,
  MCP_PROTOCOL_VERSIONS,
  MCP_TOOLS,
  RPC_INVALID_PARAMS,
  RPC_METHOD_NOT_FOUND,
  RPC_PARSE_ERROR,
  createMcpHandler,
  type JsonRpcResponse,
} from '../mcp.js';

/**
 * A stand-in domain pack: an edit becomes one scoped constraint.
 *
 * The default interpreter is intentionally domain-blind and turns edits into
 * nothing, so a recall test against it would only ever see an empty pack. This is
 * host code — the same role the chart pack plays in the eval package — and it lets
 * the test assert that `_meta.ids` and the rendered text agree with the store.
 */
const conventionInterpreter: Interpreter = (context) => {
  const { event } = context;
  if (event.signal.type !== 'edit') return [];
  const mark = (event.signal.after as { mark?: unknown }).mark;
  if (typeof mark !== 'string') return [];
  const question = context.run?.input['q'];
  const subject = typeof question === 'string' ? question : 'this question';
  const scope = { task: event.task };
  // The statement carries the question's own words, which is what the lexical
  // index needs to retrieve it later: a rule nothing mentions is a rule no pack can
  // reach, and the recall test would pass while proving nothing.
  const statement = `For "${subject}", use a ${mark} chart.`;
  return [
    {
      namespace: event.namespace,
      kind: 'constraint',
      scope,
      statement,
      payload: { when: {}, then: { mark } },
      evidence: { feedbackId: event.id, runId: event.runId, at: event.at, weight: event.trust },
      trust: event.trust,
      dedupeKey: dedupeKeyOf({ namespace: event.namespace, kind: 'constraint', scope, statement }),
    },
  ];
};

async function mount(): Promise<{ app: ReturnType<typeof createApp>; microglia: Microglia }> {
  const store = await EmbeddedMemory.open(new MemoryJournal());
  const microglia = await openMicroglia({
    app: 'mcp-test',
    namespace: 'acme',
    store,
    interpreter: conventionInterpreter,
    clock: { now: () => 1_700_000_000_000 },
  });
  return { app: createApp({ microglia }), microglia };
}

type ToolResult = {
  readonly content: readonly { readonly type: string; readonly text: string }[];
  readonly isError: boolean;
  readonly _meta?: { readonly ids: readonly string[]; readonly tokens: number; readonly truncated: boolean };
};

const call = (id: number, name: string, args: unknown) => ({
  jsonrpc: '2.0' as const,
  id,
  method: 'tools/call',
  params: { name, arguments: args },
});

async function invoke(handler: ReturnType<typeof createMcpHandler>, request: unknown): Promise<JsonRpcResponse> {
  const response = await handler(request);
  if (response === undefined) throw new Error('the handler answered a notification');
  return response;
}

describe('the MCP handshake', () => {
  it('echoes a protocol version it serves, and falls back for one it does not', async () => {
    const { microglia } = await mount();
    const handler = createMcpHandler({ microglia });
    const supported = await invoke(handler, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: MCP_PROTOCOL_VERSIONS[1] },
    });
    expect(supported.result).toMatchObject({
      protocolVersion: MCP_PROTOCOL_VERSIONS[1],
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'microglia' },
    });
    const unknown = await invoke(handler, {
      jsonrpc: '2.0',
      id: 2,
      method: 'initialize',
      params: { protocolVersion: '1999-01-01' },
    });
    expect((unknown.result as { protocolVersion: string }).protocolVersion).toBe(MCP_LATEST_PROTOCOL);
  });

  it('answers a notification with nothing at all', async () => {
    const { microglia } = await mount();
    const handler = createMcpHandler({ microglia });
    await expect(handler({ jsonrpc: '2.0', method: 'notifications/initialized' })).resolves.toBeUndefined();
  });

  it('refuses a batch, a non-object and a wrong version', async () => {
    const { microglia } = await mount();
    const handler = createMcpHandler({ microglia });
    expect((await invoke(handler, [{ jsonrpc: '2.0', id: 1, method: 'ping' }])).error?.code).toBe(-32600);
    expect((await invoke(handler, 'nope')).error?.code).toBe(-32600);
    expect((await invoke(handler, { jsonrpc: '1.0', id: 1, method: 'ping' })).error?.code).toBe(-32600);
    expect((await invoke(handler, { jsonrpc: '2.0', id: 1 })).error?.code).toBe(-32600);
  });

  it('answers ping, and refuses a method it does not serve', async () => {
    const { microglia } = await mount();
    const handler = createMcpHandler({ microglia });
    expect((await invoke(handler, { jsonrpc: '2.0', id: 7, method: 'ping' })).result).toEqual({});
    expect((await invoke(handler, { jsonrpc: '2.0', id: 8, method: 'resources/list' })).error?.code).toBe(
      RPC_METHOD_NOT_FOUND,
    );
  });
});

describe('the tool list', () => {
  it('is two tools, each with the fields a caller needs', async () => {
    const { microglia } = await mount();
    const handler = createMcpHandler({ microglia });
    const response = await invoke(handler, { jsonrpc: '2.0', id: 1, method: 'tools/list' });
    const tools = (response.result as { tools: typeof MCP_TOOLS }).tools;
    expect(tools.map((tool) => tool.name)).toEqual(['microglia_recall', 'microglia_feedback']);
    for (const tool of tools) {
      expect(tool.description.length).toBeGreaterThan(20);
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.inputSchema.additionalProperties).toBe(false);
      expect(tool.inputSchema.required.length).toBeGreaterThan(0);
    }
    // The surface is the gate, so pin it: a third tool is a decision, not a detail.
    expect(tools).toHaveLength(2);
  });
});

describe('microglia_recall', () => {
  it('returns the rendered pack and its ids', async () => {
    const { microglia } = await mount();
    const run = microglia.begin({
      task: 'chart.recommend',
      input: { q: 'compare revenue by region' },
    });
    await run.complete({ mark: 'bar' });
    await run.edit({ mark: 'line' });
    await microglia.distill();

    const handler = createMcpHandler({ microglia });
    const response = await invoke(
      handler,
      call(1, 'microglia_recall', { taskType: 'chart.recommend', question: 'compare revenue by region' }),
    );
    const result = response.result as ToolResult;
    expect(result.isError).toBe(false);
    expect(result.content[0]?.type).toBe('text');
    expect(result.content[0]?.text).toContain('use a line chart');
    expect(result._meta?.ids.length).toBeGreaterThan(0);
  });

  it('returns an empty pack as an empty string, not an error', async () => {
    const { microglia } = await mount();
    const handler = createMcpHandler({ microglia });
    const response = await invoke(
      handler,
      call(2, 'microglia_recall', { taskType: 'chart.recommend', question: 'anything' }),
    );
    const result = response.result as ToolResult;
    expect(result.isError).toBe(false);
    expect(result.content[0]?.text).toBe('');
    expect(result._meta?.ids).toEqual([]);
  });

  it('passes a domain and a budget through, and omits them when absent', async () => {
    const { microglia } = await mount();
    const handler = createMcpHandler({ microglia });
    const narrowed = await invoke(
      handler,
      call(1, 'microglia_recall', { taskType: 'chart.recommend', question: 'q', domain: 'sales', budget: 400 }),
    );
    expect((narrowed.result as ToolResult).isError).toBe(false);
    const bare = await invoke(handler, call(2, 'microglia_recall', { taskType: 'chart.recommend', question: 'q' }));
    expect((bare.result as ToolResult).isError).toBe(false);
  });

  it('refuses a call whose tool name or arguments are not shaped right', async () => {
    const { microglia } = await mount();
    const handler = createMcpHandler({ microglia });
    const noName = await invoke(handler, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: {} });
    expect(noName.error?.code).toBe(RPC_INVALID_PARAMS);
    const badArgs = await invoke(handler, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'microglia_recall', arguments: 5 },
    });
    expect(badArgs.error?.code).toBe(RPC_INVALID_PARAMS);
    const badParams = await invoke(handler, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: [] });
    expect(badParams.error?.code).toBe(RPC_INVALID_PARAMS);
    // No `arguments` key at all: the tool is called with nothing, and the missing
    // required field is what the error names.
    const noArgs = await invoke(handler, {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'microglia_recall' },
    });
    expect(noArgs.error?.message).toContain('taskType');
  });

  it('refuses a call without a task type or a question', async () => {
    const { microglia } = await mount();
    const handler = createMcpHandler({ microglia });
    expect((await invoke(handler, call(3, 'microglia_recall', { question: 'q' }))).error?.code).toBe(
      RPC_INVALID_PARAMS,
    );
    expect((await invoke(handler, call(4, 'microglia_recall', { taskType: 't', question: '' }))).error?.code).toBe(
      RPC_INVALID_PARAMS,
    );
    expect(
      (await invoke(handler, call(5, 'microglia_recall', { taskType: 't', question: 'q', budget: 0 }))).error
        ?.code,
    ).toBe(RPC_INVALID_PARAMS);
    expect(
      (await invoke(handler, call(6, 'microglia_recall', { taskType: 't', question: 'q', domain: 7 }))).error?.code,
    ).toBe(RPC_INVALID_PARAMS);
  });
});

describe('microglia_feedback', () => {
  async function withRun(): Promise<{ microglia: Microglia; runId: string }> {
    const { microglia } = await mount();
    const run = microglia.begin({ task: 'chart.recommend', input: { q: 'x' } });
    const record = await run.complete({ mark: 'bar' });
    return { microglia, runId: record.id };
  }

  it('records an edit against the run it names', async () => {
    const { microglia, runId } = await withRun();
    const handler = createMcpHandler({ microglia });
    const response = await invoke(
      handler,
      call(1, 'microglia_feedback', { runId, kind: 'edit', after: { mark: 'line' } }),
    );
    expect((response.result as ToolResult).isError).toBe(false);
    const events = await microglia.store.listEvents();
    expect(events.map((event) => event.signal.type)).toEqual(['edit']);
  });

  it('carries a note when one is given', async () => {
    const { microglia, runId } = await withRun();
    const handler = createMcpHandler({ microglia });
    await invoke(
      handler,
      call(1, 'microglia_feedback', { runId, kind: 'edit', after: { mark: 'line' }, note: 'wrong axis' }),
    );
    const events = await microglia.store.listEvents();
    const edit = events.find((event) => event.signal.type === 'edit');
    expect(edit?.signal.type === 'edit' ? edit.signal.note : undefined).toBe('wrong axis');
  });

  it('records a rating and an abstention', async () => {
    const { microglia, runId } = await withRun();
    const handler = createMcpHandler({ microglia });
    await invoke(handler, call(1, 'microglia_feedback', { runId, kind: 'rating', value: 'down' }));
    await invoke(handler, call(2, 'microglia_feedback', { runId, kind: 'abstain', reason: 'not answerable' }));
    const events = await microglia.store.listEvents();
    // Both land on the same clock tick, so the log's order is by id, not arrival:
    // asserting a sequence here would be a flaky test pretending to be a strict one.
    expect(events.map((event) => event.signal.type).sort()).toEqual(['abstain', 'rating']);
  });

  it('reports an unknown run as a tool error the model can read', async () => {
    const { microglia } = await mount();
    const handler = createMcpHandler({ microglia });
    const response = await invoke(
      handler,
      call(1, 'microglia_feedback', { runId: 'run_missing', kind: 'edit', after: { mark: 'line' } }),
    );
    const result = response.result as ToolResult;
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('run_missing');
  });

  it('refuses a malformed feedback request', async () => {
    const { microglia, runId } = await withRun();
    const handler = createMcpHandler({ microglia });
    const cases = [
      { runId, kind: 'edit' },
      { runId, kind: 'rating' },
      { runId, kind: 'abstain' },
      { runId, kind: 'shrug' },
      { kind: 'edit', after: { mark: 'line' } },
    ];
    for (const [index, args] of cases.entries()) {
      const response = await invoke(handler, call(index, 'microglia_feedback', args));
      expect(response.error?.code, JSON.stringify(args)).toBe(RPC_INVALID_PARAMS);
    }
  });

  it('turns a library refusal into a tool error rather than a crash', async () => {
    // The run belongs to `acme`; the facade answering is `other`. The library
    // refuses the mismatch, and the model has to read that as a tool error.
    const store = await EmbeddedMemory.open(new MemoryJournal());
    const writer = await openMicroglia({
      app: 'mcp-test',
      namespace: 'acme',
      store,
      interpreter: conventionInterpreter,
      clock: { now: () => 1_700_000_000_000 },
    });
    const run = writer.begin({ task: 'chart.recommend', input: { q: 'x' } });
    const record = await run.complete({ mark: 'bar' });

    const reader = await openMicroglia({
      app: 'mcp-test',
      namespace: 'other',
      store,
      clock: { now: () => 1_700_000_000_000 },
    });
    const handler = createMcpHandler({ microglia: reader });
    // The run is visible through the shared store, so the tool reaches the write
    // and the facade refuses it for the namespace.
    const response = await invoke(
      handler,
      call(1, 'microglia_feedback', { runId: record.id, kind: 'edit', after: { mark: 'line' } }),
    );
    const result = response.result as ToolResult & { _meta?: { code?: string } };
    expect(result.isError).toBe(true);
    expect(result._meta?.code).toBe('MG_E_NAMESPACE_MISMATCH');
  });

  it('refuses a tool it does not serve, and names the ones it does', async () => {
    const { microglia } = await mount();
    const handler = createMcpHandler({ microglia });
    const response = await invoke(handler, call(1, 'microglia_forget', {}));
    expect(response.error?.code).toBe(RPC_INVALID_PARAMS);
    expect(response.error?.data).toEqual({ tools: ['microglia_recall', 'microglia_feedback'] });
  });
});

describe('the HTTP transport', () => {
  function post(app: ReturnType<typeof createApp>, body: string) {
    return app.request('/v1/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });
  }

  it('answers a JSON-RPC call with JSON', async () => {
    const { app } = await mount();
    const response = await post(app, JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { result: { tools: unknown[] } };
    expect(body.result.tools).toHaveLength(2);
  });

  it('answers a notification with 202 and no body', async () => {
    const { app } = await mount();
    const response = await post(app, JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }));
    expect(response.status).toBe(202);
  });

  it('refuses a body that is not JSON with the parse-error code', async () => {
    const { app } = await mount();
    const response = await post(app, '{oops');
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: number } };
    expect(body.error.code).toBe(RPC_PARSE_ERROR);
  });
});
