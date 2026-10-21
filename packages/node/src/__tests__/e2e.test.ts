import { mkdtempSync, rmSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createClient } from '@agentix-e/microglia-browser';
import { memoryOutbox } from '@agentix-e/microglia-browser';
import { createServer, listen, type Server } from '../server.js';

const TOKEN = 'e2e-token';
const directories: string[] = [];
const servers: Server[] = [];
const listeners: { close(cb?: () => void): void }[] = [];
const flakyServers: ReturnType<typeof createHttpServer>[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'microglia-e2e-'));
  directories.push(dir);
  return dir;
}

async function start(): Promise<{ base: string; server: Server; port: number }> {
  const server = await createServer({ dir: tempDir(), namespace: 'acme', token: TOKEN });
  const listener = listen(server, 0);
  // `serve` starts listening asynchronously; reading the port before the event
  // yields null, which is a test bug that looks like a server bug.
  await new Promise<void>((resolve) => listener.once('listening', () => resolve()));
  listeners.push(listener);
  servers.push(server);
  const port = (listener.address() as AddressInfo).port;
  return { base: `http://127.0.0.1:${port}`, server, port };
}

afterEach(async () => {
  for (const listener of listeners.splice(0)) {
    await new Promise<void>((resolve) => listener.close(() => resolve()));
  }
  for (const server of servers.splice(0)) await server.close();
  for (const server of flakyServers.splice(0)) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const correction = {
  run: { task: 'chart.recommend', input: { question: 'sales by month' }, output: { mark: 'line' } },
  feedback: { type: 'edit' as const, after: { mark: 'bar' } },
};

describe('client against a real server', () => {
  it('walks the whole loop over HTTP', async () => {
    const { base, server } = await start();
    const client = createClient({ endpoint: base, token: TOKEN });

    const health = await client.health();
    expect(health.ok).toBe(true);

    const empty = await client.recall({ task: 'chart.recommend', text: 'sales by month' });
    expect(empty.ids).toEqual([]);
    expect(empty.rendered).toBe('');

    const sent = await client.feedback(correction);
    expect(sent.queued).toBe(false);
    expect(client.pending()).toBe(0);

    const report = await server.microglia.distill();
    expect(report.events).toBe(1);
    expect(report.failed).toBe(0);

    // Whether one observation is enough to admit a rule is the admission policy's
    // decision, measured in the study. What this test owns is that the correction
    // crossed the wire and became evidence the distiller saw.
    const stats = await server.microglia.stats();
    expect(stats.events).toBe(1);
    expect(stats.runs).toBe(1);
  });

  it('passes every recall option through the query string', async () => {
    const { base } = await start();
    const client = createClient({ endpoint: base, token: TOKEN });
    const pack = await client.recall({
      task: 'chart.recommend',
      text: 'sales by month',
      scope: { domain: 'sales', intent: 'trend', field: 'revenue' },
      budget: 400,
      limit: 3,
      minCoverage: 0.2,
    });
    expect(pack.ids).toEqual([]);
  });

  it('surfaces a client error instead of retrying it', async () => {
    const { base } = await start();
    const client = createClient({ endpoint: base, token: 'wrong' });
    await expect(client.recall({ task: 'chart.recommend', text: 'sales' })).rejects.toThrow(/401/);
  });

  it('keeps the correction when the network is down, and delivers it later', async () => {
    const { base, port } = await start();
    const outbox = memoryOutbox();
    const offline = createClient({
      endpoint: `http://127.0.0.1:${port + 1}`,
      token: TOKEN,
      attempts: 1,
      outbox,
    });
    const result = await offline.feedback(correction);
    expect(result.queued).toBe(true);
    expect(offline.pending()).toBe(1);

    const online = createClient({ endpoint: base, token: TOKEN, outbox });
    expect(online.pending()).toBe(1);
    const flushed = await online.flush();
    expect(flushed.sent).toBe(1);
    expect(flushed.queued).toBe(0);
  });

  it('retries a transient upstream failure before giving up', async () => {
    let calls = 0;
    const flaky = createHttpServer((request, response) => {
      calls += 1;
      if (calls === 1) {
        response.writeHead(500);
        response.end('boom');
        return;
      }
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ok: true, issues: [], stats: { knowledge: 0 } }));
    });
    flakyServers.push(flaky);
    await new Promise<void>((resolve) => flaky.listen(0, '127.0.0.1', () => resolve()));
    const base = `http://127.0.0.1:${(flaky.address() as AddressInfo).port}`;
    const client = createClient({ endpoint: base, token: TOKEN, attempts: 3, baseDelayMs: 1 });
    const health = await client.health();
    expect(health.ok).toBe(true);
    expect(calls).toBe(2);
  });

  it('reports a rejected token as a queued correction, not as success', async () => {
    const { base } = await start();
    const client = createClient({ endpoint: base, token: 'wrong', attempts: 1 });
    const result = await client.feedback(correction);
    expect(result.queued).toBe(true);
    expect(client.pending()).toBe(1);
  });
});
