import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createKnowledgeItem, defaultPolicy, openMicroglia, serveOptions } from '@agentix-e/microglia-core';
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

describe('the shipping contract', () => {
  it('serves the configuration the eval measured, by construction rather than by coincidence', async () => {
    // The server spreads `serveOptions()`, so a host built from the same profile over the same store must
    // produce the same pack. The assertion is on the hash rather than on the options object because a host's
    // options are private: what a deployment actually serves is the bytes, and those are what is compared.
    const server = await createServer({ dir: tempDir(), namespace: 'acme' });
    // A store with one confident rule, put directly: this case is about what the server does with the pack,
    // not about how a rule is learned, and a rule the interpreter failed to distill would make the comparison
    // two empty packs agreeing with each other.
    await server.store.putKnowledge(
      createKnowledgeItem(
        {
          namespace: 'acme',
          kind: 'constraint',
          scope: { task: 'chart.recommend', domain: 'sales', intent: 'trend' },
          statement: 'For a trend question over revenue, use a line chart rather than a bar chart.',
          payload: { when: { intent: 'trend' }, then: { mark: 'line' } },
          evidence: { feedbackId: 'fb_1', runId: 'run_0', at: 1_700_000_000_000, weight: 0.9 },
          trust: 0.9,
          dedupeKey: 'contract',
        },
        defaultPolicy,
        1_700_000_000_000,
        'k_contract',
      ),
    );

    const product = await server.microglia.recall({
      task: 'chart.recommend',
      text: 'monthly revenue trend',
      scope: { domain: 'sales', intent: 'trend' },
    });
    expect(product.ids.length).toBeGreaterThan(0);

    const twin = await openMicroglia({
      app: 'microglia',
      namespace: 'acme',
      store: server.store,
      ...serveOptions(),
    });
    const reference = await twin.recall({
      task: 'chart.recommend',
      text: 'monthly revenue trend',
      scope: { domain: 'sales', intent: 'trend' },
    });
    expect(reference.hash).toBe(product.hash);
    expect(product.budget).toBe(serveOptions().budget ?? defaultPolicy.defaultBudget);
    await twin.close();
    await server.close();
  });
});
