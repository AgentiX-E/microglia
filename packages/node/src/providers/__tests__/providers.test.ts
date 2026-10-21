import { createServer as createHttpServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { deepseekProvider, deepseekFactory } from '../deepseek.js';
import { zhipuEmbeddings, zhipuFactory } from '../zhipu.js';

const servers: Server[] = [];

/** A real HTTP peer speaking the two vendor shapes, so the adapter is tested over the wire. */
async function peer(handler: (path: string, body: unknown) => { status: number; body: unknown }): Promise<string> {
  const server = createHttpServer((request, response) => {
    let raw = '';
    request.on('data', (chunk) => {
      raw += String(chunk);
    });
    request.on('end', () => {
      const result = handler(request.url ?? '/', JSON.parse(raw === '' ? '{}' : raw));
      response.writeHead(result.status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(result.body));
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

afterEach(async () => {
  for (const server of servers.splice(0)) await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('deepseek provider', () => {
  it('sends the request shape and reads the reply', async () => {
    let seen: Record<string, unknown> = {};
    const base = await peer((_path, body) => {
      seen = body as Record<string, unknown>;
      return { status: 200, body: { choices: [{ message: { content: 'hello' } }], usage: { total_tokens: 7 } } };
    });
    const provider = deepseekProvider({ apiKey: 'k', baseUrl: base });
    const reply = await provider.complete({ prompt: 'q', system: 's', maxTokens: 32 });
    expect(reply.text).toBe('hello');
    expect(reply.tokens).toBe(7);
    expect(seen['model']).toBe('deepseek-chat');
    expect((seen['messages'] as unknown[]).length).toBe(2);
  });

  it('surfaces a provider failure as a named error', async () => {
    const base = await peer(() => ({ status: 500, body: { error: 'down' } }));
    await expect(deepseekProvider({ apiKey: 'k', baseUrl: base }).complete({ prompt: 'q' })).rejects.toThrow(
      /DeepSeek returned 500/,
    );
  });

  it('tolerates a reply with no choices and no usage', async () => {
    const base = await peer(() => ({ status: 200, body: {} }));
    const reply = await deepseekProvider({ apiKey: 'k', baseUrl: base }).complete({ prompt: 'q' });
    expect(reply.text).toBe('');
    expect(reply.tokens).toBeUndefined();
  });

  it('requires a key in the declarative form', () => {
    expect(() => deepseekFactory({})).toThrow(/apiKey/);
    expect(deepseekFactory({ apiKey: 'k', model: 'deepseek-reasoner' }).id).toBe('deepseek:deepseek-reasoner');
  });
});

describe('zhipu embeddings', () => {
  it('returns one vector per input', async () => {
    const base = await peer(() => ({ status: 200, body: { data: [{ embedding: [1, 2] }, { embedding: [3, 4] }] } }));
    const vectors = await zhipuEmbeddings({ apiKey: 'k', baseUrl: base }).embed(['a', 'b']);
    expect(vectors).toEqual([[1, 2], [3, 4]]);
  });

  it('does not call the provider for an empty batch', async () => {
    const vectors = await zhipuEmbeddings({ apiKey: 'k', baseUrl: 'http://127.0.0.1:1' }).embed([]);
    expect(vectors).toEqual([]);
  });

  it('treats a reply with no vectors as a mismatch', async () => {
    const base = await peer(() => ({ status: 200, body: {} }));
    await expect(zhipuEmbeddings({ apiKey: 'k', baseUrl: base }).embed(['a'])).rejects.toThrow(/different number/);
  });

  it('rejects a mismatched reply and a missing key', async () => {
    const base = await peer(() => ({ status: 200, body: { data: [{ embedding: [1] }] } }));
    await expect(zhipuEmbeddings({ apiKey: 'k', baseUrl: base }).embed(['a', 'b'])).rejects.toThrow(/different number/);
    expect(() => zhipuFactory({})).toThrow(/apiKey/);
    expect(zhipuFactory({ apiKey: 'k' }).id).toBe('zhipu:embedding-3');
  });

  it('surfaces a provider failure', async () => {
    const base = await peer(() => ({ status: 429, body: { error: 'quota' } }));
    await expect(zhipuEmbeddings({ apiKey: 'k', baseUrl: base }).embed(['a'])).rejects.toThrow(/Zhipu returned 429/);
  });
});
