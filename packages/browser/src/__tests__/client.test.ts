import { describe, expect, it } from 'vitest';
import { createClient } from '../client.js';

const ENDPOINT = 'https://memory.test';

function clientWith(response: () => Response, calls: { url: string; init: RequestInit | undefined }[]) {
  return createClient({
    endpoint: ENDPOINT,
    token: 't',
    attempts: 1,
    fetch: async (url, init) => {
      calls.push({ url: String(url), init });
      return response();
    },
  });
}

describe('the client erase path', () => {
  it('posts the selector and returns the report', async () => {
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const client = clientWith(
      () =>
        new Response(
          JSON.stringify({ events: 2, runs: 1, knowledge: 1, rescored: 3, tombstone: 'abc' }),
          { status: 200 },
        ),
      calls,
    );
    const report = await client.forget({ taskId: 't_1' });
    expect(report).toMatchObject({ events: 2, tombstone: 'abc' });
    expect(calls[0]?.url).toBe(`${ENDPOINT}/v1/forget`);
    expect(calls[0]?.init?.method).toBe('POST');
    expect(calls[0]?.init?.body).toBe(JSON.stringify({ taskId: 't_1' }));
    expect((calls[0]?.init?.headers as Record<string, string>)['authorization']).toBe('Bearer t');
  });

  it('never queues an erasure, and surfaces the refusal', async () => {
    // A deletion that waits in an outbox is one that lands after the user changed
    // their mind; a client that swallowed the 400 would report success for a
    // request the server refused.
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const client = clientWith(() => new Response('{"error":"no selector"}', { status: 400 }), calls);
    await expect(client.forget({})).rejects.toThrow(/400/);
    expect(client.pending()).toBe(0);
    expect(calls).toHaveLength(1);
  });
});

describe('the client ingest path', () => {
  it('sends a correction with its task instance and actor, and clears the queue', async () => {
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const client = clientWith(
      () => new Response(JSON.stringify({ runId: 'run_1', eventId: 'fb_1' }), { status: 201 }),
      calls,
    );
    const result = await client.feedback({
      run: {
        task: 'chart.recommend',
        input: { q: 'sales by month' },
        output: { mark: 'line' },
        taskId: 't_1',
        attempt: 2,
        parentRunId: 'run_0',
        actorIdHash: 'sha256:alice',
      },
      feedback: { type: 'edit', after: { mark: 'bar' } },
    });
    expect(result.queued).toBe(false);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`${ENDPOINT}/v1/feedback`);
    const body = JSON.parse(String(calls[0]?.init?.body)) as {
      run: Record<string, unknown>;
    };
    expect(body.run['taskId']).toBe('t_1');
    expect(body.run['attempt']).toBe(2);
    expect(body.run['parentRunId']).toBe('run_0');
    expect(body.run['actorIdHash']).toBe('sha256:alice');
    expect(client.pending()).toBe(0);
  });

  it('keeps the correction queued when the network refuses it', async () => {
    // The outbox is the point of the client: a correction made offline has to
    // survive, and a send that failed has to be visible as pending rather than
    // reported as sent.
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const client = clientWith(
      () => new Response(JSON.stringify({ error: 'down' }), { status: 400 }),
      calls,
    );
    const result = await client.feedback({
      run: { task: 'chart.recommend', input: {}, output: {} },
      feedback: { type: 'rating', value: 'down' },
    });
    expect(result.queued).toBe(true);
    expect(client.pending()).toBe(1);
  });

  it('omits the authorization header when no token was configured', async () => {
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const client = createClient({
      endpoint: ENDPOINT,
      attempts: 1,
      fetch: async (url, init) => {
        calls.push({ url: String(url), init });
        return new Response(JSON.stringify({ ok: true, stats: {} }), { status: 200 });
      },
    });
    await client.health();
    expect((calls[0]?.init?.headers as Record<string, string>)['authorization']).toBeUndefined();
  });
});

describe('a host that throws something that is not an Error', () => {
  it('reports it as an Error rather than rethrowing a bare string', async () => {
    // A wrapped fetch (tracing, a proxy shim) can throw anything. Rethrowing the
    // string would give callers `catch (e)` a value with no stack and no message.
    const client = createClient({
      endpoint: ENDPOINT,
      attempts: 1,
      fetch: async () => {
        throw 'boom';
      },
    });
    await expect(client.health()).rejects.toBeInstanceOf(Error);
    await expect(client.health()).rejects.toThrow(/boom/);
  });
});
