/**
 * POC-19 — push delivery, measured on a real socket.
 *
 * The lane lives in the package (`lanes/delivery.ts`) and this file is the thin
 * entrypoint: run it, write the artefact, print the gates, and fail the build if a
 * gate fails. What it does *not* do is dress a loopback measurement up as proof
 * that a remote host is reached within the contract's sixty seconds — the artefact
 * says which bound it measured and which one it only inherits.
 */
import { DELIVERY_BOUND_MS, runDeliveryLane } from '@agentix-e/microglia-eval';
import { writeResult } from './lib.js';

const report = await runDeliveryLane();

await writeResult({
  id: 'poc-delivery',
  title: 'POC-19 — webhook delivery: signed, ordered, at least once',
  ranAt: new Date().toISOString(),
  model: 'none',
  n: report.metrics.corrections,
  calls: 0,
  metrics: {
    corrections: report.metrics.corrections,
    events_published: report.metrics.published,
    events_delivered: report.metrics.delivered,
    missed: report.metrics.missed,
    duplicates: report.metrics.duplicates,
    retries: report.metrics.retries,
    signature_failures: report.metrics.signatureFailures,
    ordering_violations: report.metrics.orderingViolations,
    p50_ms: report.metrics.p50Ms,
    p95_ms: report.metrics.p95Ms,
    slowest_ms: report.metrics.slowestMs,
    bound_ms: DELIVERY_BOUND_MS,
    gates_passed: report.gates.filter((gate) => gate.pass).length,
    gates_total: report.gates.length,
  },
  notes: [
    'A real HTTP receiver on loopback verifies an HMAC over the posted bytes, stores by event id and de-duplicates; the sender is the library\'s own WebhookDispatcher.',
    'The receiver stores the first request and then loses the acknowledgement, so the retry has to carry the same id: one repeat, one stored event, zero missed. A sender with random ids would have shown two stored events instead.',
    'One request is answered 250 ms late on purpose. The slowest delivery has to move past it, or a stopwatch stuck at zero would pass the latency gate.',
    `p95 is ${report.metrics.p95Ms} ms on loopback. The contract's 60 s is a ceiling this lane cannot stress — it reports the floor and inherits the bound rather than proving it.`,
    'Event types are derived from store transitions (admitted, rewritten, retired); task.completed is built from the record the host holds when it closes a task, because the task table is the host\'s.',
  ],
});

process.stdout.write(
  `[poc-delivery] events=${report.metrics.published} delivered=${report.metrics.delivered} missed=${report.metrics.missed} duplicates=${report.metrics.duplicates} retries=${report.metrics.retries} p95=${report.metrics.p95Ms}ms\n`,
);
for (const gate of report.gates) {
  process.stdout.write(`  ${gate.pass ? 'PASS' : 'FAIL'} ${gate.id} ${gate.actual} (${gate.criterion})\n`);
}
if (report.gates.some((gate) => !gate.pass)) process.exit(1);
