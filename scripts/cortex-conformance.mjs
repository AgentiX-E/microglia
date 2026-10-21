#!/usr/bin/env node
/**
 * Conformance against the real `@agentix-e/cortex-core` build.
 *
 * The adapter ships with a structural copy of cortex's `MemoryValue` because the
 * packages are not published yet. That copy is a promise, and this script is how
 * the promise is checked: it builds a knowledge item, projects it through the
 * adapter, and compares the result against what cortex's own factory produces for
 * the same input.
 *
 * It runs in the `cortex` workflow, which clones and builds cortex from source —
 * the workaround that stands in for the missing registry release.
 *
 * Usage: CORTEX_DIST=/path/to/cortex-core/dist/index.js node scripts/cortex-conformance.mjs
 */
import { pathToFileURL } from 'node:url';

const dist = process.env.CORTEX_DIST ?? '/tmp/cortex/packages/cortex-core/dist/index.js';
const adapterPath = new URL('../packages/node/dist/store/cortex.js', import.meta.url).pathname;

const cortex = await import(pathToFileURL(dist).href);
const adapter = await import(pathToFileURL(adapterPath).href);

if (typeof cortex.createMemory !== 'function') {
  throw new Error(`cortex build at ${dist} does not export createMemory`);
}
if (typeof adapter.toCortexMemory !== 'function') {
  throw new Error('the adapter does not export toCortexMemory; run pnpm build first');
}

const item = {
  schema: 'microglia.knowledge/1',
  id: 'k_conformance',
  namespace: 'acme',
  kind: 'constraint',
  scope: { task: 'chart.recommend', domain: 'sales', intent: 'trend' },
  statement: 'For a trend question over revenue. use a line chart rather than a bar chart.',
  payload: { when: { intent: 'trend' }, then: { mark: 'line' } },
  evidence: [{ feedbackId: 'fb_1', runId: 'run_1', at: 1_700_000_000_000, weight: 0.9 }],
  trust: 0.9,
  support: 0.9,
  confidence: 0.82,
  contradictions: 0,
  applied: 2,
  succeeded: 2,
  status: 'active',
  statusReason: 'confidence-cleared',
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
  validUntil: Number.POSITIVE_INFINITY,
  systemUntil: Number.POSITIVE_INFINITY,
};

const projected = adapter.toCortexMemory(item);
const reference = cortex.createMemory({
  id: projected.id,
  content: projected.content,
  value: projected.value,
  confidence: projected.confidence,
  source: projected.source,
  sourceTrust: projected.sourceTrust,
  type: projected.type,
  tags: projected.tags,
  createdAt: projected.createdAt,
  lastAccessedAt: projected.lastAccessedAt,
});

const problems = [];
const referenceKeys = Object.keys(reference).sort();
const projectedKeys = Object.keys(projected).sort();
if (referenceKeys.join(',') !== projectedKeys.join(',')) {
  problems.push(`key sets differ: adapter [${projectedKeys.join(',')}] vs cortex [${referenceKeys.join(',')}]`);
}
for (const key of referenceKeys) {
  const expected = typeof reference[key];
  const actual = typeof projected[key];
  if (expected !== actual) problems.push(`field ${key}: adapter ${actual} vs cortex ${expected}`);
}
if (projected.confidence !== item.confidence) problems.push('confidence is not carried through');
if (projected.type !== 'semantic') problems.push('a constraint must project as semantic memory');
if (projected.source !== 'microglia') problems.push('source tag is missing');

const fact = adapter.toCortexFact(item);
for (const key of ['subject', 'predicate', 'object', 'validFrom', 'validUntil', 'source', 'sourceTrust']) {
  if (!(key in fact)) problems.push(`fact projection is missing ${key}`);
}

if (problems.length > 0) {
  process.stderr.write(`cortex conformance failed (${problems.length})\n`);
  for (const problem of problems) process.stderr.write(`  - ${problem}\n`);
  process.exit(1);
}
process.stdout.write(`cortex conformance: ok (${referenceKeys.length} fields matched)\n`);
