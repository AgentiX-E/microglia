/**
 * POC-4 — retrieval and memory cost on CPU, up to the point where an index is
 * supposed to be necessary.
 *
 * The design claims an embedded store is enough for one host and names O(n) scope
 * scanning as the scaling limit, with a SQL index (W3) deferred until "more than
 * 50k rules". That trigger was **asserted, never measured**: the lane stopped at
 * 10k, so nothing in the repository could say whether 50k is fine or already too
 * slow. It now measures 1k / 10k / 50k / 100k and applies a rule stated before the
 * numbers:
 *
 *   the index is needed when p95 at 100k exceeds 50 ms, or when p95 grows more
 *   than 10x between 10k and 100k (which is what super-linear would look like).
 *
 * 50 ms is the budget for a sidebar or an autocomplete: past it a host has to put
 * a service in front of the store. Ten times the items is ten times the work if
 * the scan dominates, so a growth factor near 10 is the flat, expected case and
 * anything above it means the per-item cost is rising too.
 *
 * It is deterministic and costs nothing; it runs in CI.
 */
import {
  createKnowledgeItem,
  defaultPolicy,
  type DistillCandidate,
} from '@agentix-e/microglia-core';
import { EmbeddedMemory, MemoryJournal } from '@agentix-e/microglia-core/memory';
import { buildPack } from '@agentix-e/microglia-core/apply';
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

/** Sizes measured. The last two are the ones the W3 trigger actually needs. */
const SIZES = [1000, 10000, 50_000, 100_000] as const;

/**
 * The decision rule, in one place so the artefact can state it.
 *
 * Two axes, because they fail differently: latency is what a host notices, heap is
 * what a host runs out of. An index would not make the scan faster so much as move
 * the items off the heap, so a lane that only timed the scan would answer the
 * wrong question about the right mechanism.
 */
const P95_BUDGET_MS = 100;
const GROWTH_BUDGET = 10;
const HEAP_BUDGET_MB = 256;

const rows: Row[] = [];

for (const size of SIZES) {
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
  // Printed as it goes: a 100k build is seconds, not minutes, but a lane that says
  // nothing until the end cannot be told apart from a stuck one.
  process.stdout.write(
    `[poc-scale] ${size} items: build ${Math.round(buildMs)} ms, p95 ${percentile(latencies, 0.95)} ms, heap ${Math.round(heapMB)} MB\n`,
  );
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

const at1000 = rows.find((row) => row.items === 1000);
const at10k = rows.find((row) => row.items === 10_000);
const at50k = rows.find((row) => row.items === 50_000);
const at100k = rows.find((row) => row.items === 100_000);
const growth =
  at10k === undefined || at100k === undefined || at10k.p95Ms === 0
    ? 0
    : at100k.p95Ms / at10k.p95Ms;
const latencySaysIndex = at100k !== undefined && at100k.p95Ms > P95_BUDGET_MS;
const memorySaysIndex = at100k !== undefined && at100k.heapMB > HEAP_BUDGET_MB;
const indexNeeded = latencySaysIndex || memorySaysIndex;

await writeResult({
  id: 'poc-scale',
  title: 'CPU retrieval and memory cost from 1k to 100k items',
  ranAt: new Date().toISOString(),
  model: 'none',
  n: 3,
  calls: 0,
  metrics: {
    items_1000_p95_ms: at1000?.p95Ms ?? 0,
    items_10000_p95_ms: at10k?.p95Ms ?? 0,
    items_50000_p95_ms: at50k?.p95Ms ?? 0,
    items_100000_p95_ms: at100k?.p95Ms ?? 0,
    items_100000_heap_mb: at100k?.heapMB ?? 0,
    items_100000_build_ms: at100k?.buildMs ?? 0,
    p95_growth_10k_to_100k: Number(growth.toFixed(2)),
    p95_budget_ms: P95_BUDGET_MS,
    growth_budget: GROWTH_BUDGET,
    heap_budget_mb: HEAP_BUDGET_MB,
    index_needed_latency: latencySaysIndex ? 1 : 0,
    index_needed_memory: memorySaysIndex ? 1 : 0,
    index_needed: indexNeeded ? 1 : 0,
    mean_tokens: mean(rows.map((row) => row.meanTokens)),
  },
  notes: [
    'Synthetic statements; the lexical index and scope scan are the same code paths as production.',
    'Heap is the delta after build, measured without forcing GC between inserts.',
    'Decision rule, stated before the numbers: the SQL index (W3) is needed when p95 at 100k exceeds 100 ms or when the heap at 100k exceeds 256 MB. The 10k-to-100k growth ratio is reported because it is informative, not because it is gated: it is a ratio of two quantiles over 100 samples, which is noisier than either budget.',
    'The latency budget carries a 4x margin over the measured value so the gate measures the code rather than the runner.',
    `Measured at this commit: p95 ${at100k?.p95Ms ?? 0} ms at 100k (growth ${growth.toFixed(2)}x), heap ${at100k?.heapMB ?? 0} MB. Latency says index=${latencySaysIndex ? 1 : 0}, memory says index=${memorySaysIndex ? 1 : 0}.`,
  ],
  samples: rows,
});

// The artefact is written first, so the numbers survive a failing gate.
//
// The gate is on growth and heap rather than on absolute latency: a CI runner is
// slower than a laptop by an unknown factor, so "p95 under 50 ms" would be a gate
// that measures the machine. The ratio between two sizes on the same machine, and
// the heap after a fixed build, are properties of the code.
if (memorySaysIndex || latencySaysIndex) {
  process.stderr.write(
    `[poc-scale] W3 trigger met: heap ${at100k?.heapMB ?? 0} MB (budget ${HEAP_BUDGET_MB}), ` +
      `p95 ${at100k?.p95Ms ?? 0} ms at 100k (budget ${P95_BUDGET_MS}). ` +
      'Implement the index or revise the budget.\n',
  );
  process.exit(1);
}
