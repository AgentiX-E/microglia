/**
 * POC-4 — retrieval and memory cost on CPU at 1k / 5k / 10k knowledge items.
 *
 * The design claims an embedded store is enough for one host and names O(n)
 * scope scanning as the scaling limit. This script measures that claim rather
 * than asserting it: it builds synthetic stores of increasing size and reports
 * recall latency, index build time, and heap growth.
 *
 * It is deterministic and costs nothing; it runs in CI.
 */
import {
  createKnowledgeItem,
  defaultPolicy,
  type DistillCandidate,
} from '@agentix-e/microglia-core';
import { EmbeddedMemory, MemoryJournal } from '@agentix-e/microglia-memory';
import { buildPack } from '@agentix-e/microglia-apply';
import { mean, percentile, writeResult } from './lib.js';

const AT = 1_700_000_000_000;
const DOMAINS = ['sales', 'hr', 'finance', 'ops'];
const INTENTS = ['trend', 'comparison', 'composition', 'distribution', 'correlation', 'matrix', 'ranking'];

function makeItem(index: number) {
  const domain = DOMAINS[index % DOMAINS.length] as string;
  const intent = INTENTS[index % INTENTS.length] as DistillCandidate['scope']['intent'];
  const candidate: DistillCandidate = {
    namespace: 'acme',
    kind: 'constraint',
    scope: { task: 'chart.recommend', domain, intent },
    statement: `Rule ${index}: for ${intent} in ${domain}, prefer the documented mark ${index % 6}.`,
    payload: { when: { intent }, then: { mark: 'line' } },
    evidence: { feedbackId: `fb_${index}`, runId: `run_${index}`, at: AT, weight: 0.9 },
    trust: 0.9,
    dedupeKey: `k_${index}`,
  };
  return createKnowledgeItem(candidate, defaultPolicy, AT, `k_${index}`);
}

type Row = {
  items: number;
  buildMs: number;
  p50Ms: number;
  p95Ms: number;
  meanTokens: number;
  heapMB: number;
};

const rows: Row[] = [];

for (const size of [1000, 5000, 10000]) {
  if (global.gc) global.gc();
  const before = process.memoryUsage().heapUsed;
  const started = performance.now();
  const memory = await EmbeddedMemory.open(new MemoryJournal());
  for (let i = 0; i < size; i += 1) await memory.putKnowledge(makeItem(i));
  const buildMs = performance.now() - started;

  const latencies: number[] = [];
  let tokens = 0;
  for (let q = 0; q < 100; q += 1) {
    const intent = INTENTS[q % INTENTS.length] as string;
    const domain = DOMAINS[q % DOMAINS.length] as string;
    const at = performance.now();
    const pack = await buildPack(
      { task: 'chart.recommend', text: `how does it look for ${intent} in ${domain}`, namespace: 'acme', scope: { domain, intent } },
      { memory, budget: 1200 },
    );
    latencies.push(performance.now() - at);
    tokens += pack.tokens;
  }
  const heapMB = (process.memoryUsage().heapUsed - before) / 1024 / 1024;
  rows.push({
    items: size,
    buildMs: Math.round(buildMs),
    p50Ms: percentile(latencies, 0.5),
    p95Ms: percentile(latencies, 0.95),
    meanTokens: tokens / 100,
    heapMB: Math.round(heapMB * 10) / 10,
  });
  await memory.close();
}

await writeResult({
  id: 'poc-scale',
  title: 'CPU retrieval and memory cost at 1k / 5k / 10k items',
  ranAt: new Date().toISOString(),
  model: 'none',
  n: 3,
  calls: 0,
  metrics: {
    items_1000_p95_ms: rows[0]?.p95Ms ?? 0,
    items_5000_p95_ms: rows[1]?.p95Ms ?? 0,
    items_10000_p95_ms: rows[2]?.p95Ms ?? 0,
    items_10000_heap_mb: rows[2]?.heapMB ?? 0,
    items_10000_build_ms: rows[2]?.buildMs ?? 0,
    mean_tokens: mean(rows.map((row) => row.meanTokens)),
  },
  notes: [
    'Synthetic statements; the lexical index and scope scan are the same code paths as production.',
    'Heap is the delta after build, measured without forcing GC between inserts.',
    'Scope scanning is O(n); the result quantifies why a SQL index is a P1 item, not a redesign.',
  ],
  samples: rows,
});
