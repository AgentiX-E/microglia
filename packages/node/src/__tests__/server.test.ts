import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { LlmProvider } from '@agentix-e/microglia-core/providers';
import { createServer } from '../server.js';

const directories: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'microglia-server-'));
  directories.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function provider(text: string): LlmProvider {
  return { id: 'stub', complete: async () => ({ text, model: 'stub' }) };
}

describe('server composition', () => {
  it('runs without a model provider, using the rule interpreter', async () => {
    const server = await createServer({ dir: tempDir(), namespace: 'acme' });
    const run = server.microglia.begin({ task: 'chart.recommend', input: { q: 'x' } });
    await run.complete({ mark: 'line' });
    await run.edit({ mark: 'bar' });
    const report = await server.microglia.distill();
    expect(report.events).toBe(1);
    await server.close();
  });

  it('wires a model provider into distillation when one is supplied', async () => {
    const server = await createServer({
      dir: tempDir(),
      namespace: 'acme',
      llm: provider(
        JSON.stringify({
          candidates: [
            {
              kind: 'constraint',
              statement: 'This workspace reports monthly revenue in thousands',
              scope: { task: 'chart.recommend', domain: 'sales' },
            },
          ],
        }),
      ),
    });
    const run = server.microglia.begin({ task: 'chart.recommend', input: { q: 'x' } });
    await run.complete({ mark: 'line' });
    await run.edit({ mark: 'bar' });
    const report = await server.microglia.distill();
    expect(report.candidates).toBe(1);
    await server.close();
  });

  it('persists across a restart of the same directory', async () => {
    const dir = tempDir();
    const first = await createServer({ dir, namespace: 'acme' });
    const run = first.microglia.begin({ task: 'chart.recommend', input: { q: 'x' } });
    await run.complete({ mark: 'line' });
    await run.edit({ mark: 'bar' });
    await first.close();

    const second = await createServer({ dir, namespace: 'acme' });
    expect((await second.microglia.stats()).events).toBe(1);
    await second.close();
  });
});
