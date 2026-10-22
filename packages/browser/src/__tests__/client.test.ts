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
