/**
 * POC-19 — does push earn a surface?
 *
 * The delivery contract (§17.21) says a host is told when knowledge changes, at
 * least once, ordered per task type, signed so the receiver can prove the body came
 * from us, and within 60 s. Every one of those is checkable without a hosted
 * environment, and three of them are the kind of claim that quietly stops being
 * true:
 *
 *   - **delivered exactly the set that changed** — a dispatcher that drops an
 *     event under load looks identical to one that had nothing to send, unless the
 *     lane diffs the published ids against the received ones;
 *   - **at-least-once means a duplicate is expected** — the receiver fails the
 *     first request on purpose, so a lane that reports "0 duplicates" is reporting
 *     that the retry path never ran;
 *   - **the measurement can see latency** — one event is answered 250 ms late, and
 *     p95 has to move. Without that control, a stopwatch stuck at zero would pass
 *     the 60 s gate.
 *
 * What this lane cannot show is the 60 s boundary itself: it runs on loopback, so
 * the number it reports is a floor, not a demonstration that a remote host is
 * reached in time. That is stated in the artefact rather than folded into a green
 * gate.
 */
import { createServer, type Server } from 'node:http';
import { openMicroglia, type Microglia } from '@agentix-e/microglia-core/capture';
import { EmbeddedMemory, MemoryJournal } from '@agentix-e/microglia-core/memory';
import {
  SIGNATURE_HEADER,
  WebhookDispatcher,
  hmacSha256Hex,
  knowledgeEvents,
  snapshotOf,
  type DraftEvent,
  type KnowledgeSnapshot,
} from '@agentix-e/microglia-core/delivery';
import { mulberry32, steppingClock, type Json, type JsonObject } from '@agentix-e/microglia-core';
import { chartEditDistance, chartInterpreter } from '../workload/index.js';
import type { ChartIntent, ChartMark } from '../workload/index.js';

const NAMESPACE = 'delivery';
const SECRET = 'lane-secret-not-a-credential';
const CLOCK_START = 1_700_000_000_000;

/** The two task types the lane publishes under, so sequencing is per type. */
export const TASK_TYPES = ['chart.recommend', 'chart.repair'] as const;

/** The contract's bound, in seconds. */
export const DELIVERY_BOUND_MS = 60_000;

/** The control's delay: p95 must move past this when it is applied. */
const SLOW_MS = 250;

type Received = {
  readonly id: string;
  readonly seq: number;
  readonly taskType: string;
  readonly at: number;
  readonly verified: boolean;
};

export type ReceiverBox = {
  readonly url: string;
  readonly received: Received[];
  /** Requests whose signature did not match the body. */
  readonly rejected: number;
  /** Accepted requests that repeated an id already stored: at-least-once working. */
  readonly repeats: number;
  readonly close: () => Promise<void>;
};

/**
 * A receiver that behaves like a host: it verifies the MAC over the raw body,
 * de-duplicates by id, and can be told to fail or to be slow.
 */
export async function startReceiver(options: {
  readonly failFirst?: boolean;
  readonly slowAt?: number;
  readonly slowMs?: number;
}): Promise<ReceiverBox> {
  const received: Received[] = [];
  const seen = new Set<string>();
  let rejected = 0;
  let repeats = 0;
  let calls = 0;

  const server: Server = createServer((request, response) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => {
      calls += 1;
      const signature = String(request.headers[SIGNATURE_HEADER.toLowerCase()] ?? '');
      const expected = hmacSha256Hex(SECRET, body);
      if (signature !== expected) {
        rejected += 1;
        response.writeHead(401, { 'content-type': 'application/json' });
        response.end('{"error":"bad signature"}');
        return;
      }
      const event = JSON.parse(body) as { id: string; seq: number; taskType: string };
      if (seen.has(event.id)) {
        repeats += 1;
      } else {
        seen.add(event.id);
        received.push({
          id: event.id,
          seq: event.seq,
          taskType: event.taskType,
          at: performance.now(),
          verified: true,
        });
      }
      // The positive control, and the harder one: the receiver *stores* the event
      // and then loses the acknowledgement. A sender that did not retry would show
      // up as a missed update; a sender that retried with a new id would show up as
      // two stored events. Only at-least-once plus a content-derived id survives.
      if (options.failFirst === true && calls === 1) {
        response.writeHead(503, { 'content-type': 'application/json' });
        response.end('{"error":"ack lost"}');
        return;
      }
      const delay = options.slowAt !== undefined && calls === options.slowAt ? (options.slowMs ?? SLOW_MS) : 0;
      if (delay === 0) {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end('{"ok":true}');
        return;
      }
      setTimeout(() => {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end('{"ok":true}');
      }, delay);
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('the receiver has no port');
  return {
    url: `http://127.0.0.1:${address.port}/microglia/events`,
    received,
    get rejected() {
      return rejected;
    },
    get repeats() {
      return repeats;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.once('close', () => resolve());
        server.close();
      }),
  };
}

/**
 * How many delivered events arrived out of order within their task type.
 *
 * Extracted and exported because the alternative is a number that is always zero:
 * the lane cannot make a correct dispatcher send out of order, so the only way to
 * show this check works is to feed it a log that *is* out of order.
 */
export function countOrderingViolations(
  received: readonly { readonly seq: number; readonly taskType: string }[],
): number {
  let violations = 0;
  const highest = new Map<string, number>();
  for (const entry of received) {
    const previous = highest.get(entry.taskType) ?? 0;
    if (entry.seq <= previous) violations += 1;
    highest.set(entry.taskType, Math.max(previous, entry.seq));
  }
  return violations;
}

export type DeliveryMetrics = {
  readonly corrections: number;
  readonly published: number;
  readonly delivered: number;
  readonly duplicates: number;
  readonly missed: number;
  readonly signatureFailures: number;
  readonly retries: number;
  readonly orderingViolations: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly slowestMs: number;
};

export type DeliveryReport = {
  readonly metrics: DeliveryMetrics;
  readonly gates: readonly { readonly id: string; readonly criterion: string; readonly actual: string; readonly pass: boolean }[];
  readonly missList: readonly string[];
};

/** The `q` quantile of a latency sample. An empty sample is 0, not a throw. */
export function percentile(values: readonly number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor(q * sorted.length));
  return Math.round((sorted[index] as number) * 1000) / 1000;
}

const DOMAINS = ['sales', 'hr', 'finance', 'ops'] as const;
const INTENTS: readonly ChartIntent[] = ['trend', 'comparison', 'distribution', 'correlation'];
const MARKS: readonly ChartMark[] = ['line', 'bar', 'boxplot', 'scatter'];

/**
 * One correction, as the store sees it: a wrong answer, then the right one.
 *
 * The generator is the chart workload the rest of the benchmark uses, because a
 * delivery lane with its own toy payload would prove that JSON can be posted.
 */
async function correct(mg: Microglia, index: number, taskType: string): Promise<void> {
  const domain = DOMAINS[index % DOMAINS.length] as string;
  const intent = INTENTS[index % INTENTS.length] as ChartIntent;
  const mark = MARKS[index % MARKS.length] as ChartMark;
  const input = {
    question: `Question ${index}: how does measure ${index} look for ${domain}?`,
    domain,
    intent,
    field: `measure_${index}`,
    categoryCount: 4,
    grain: 'month',
  };
  const wrong = { mark: 'pie', x: `measure_${index}`, y: 'measure_0', aggregate: 'sum' } as const;
  const right = { ...wrong, mark };
  const run = mg.begin({ task: taskType, input: input as unknown as JsonObject });
  await run.complete(wrong as unknown as Json);
  await run.edit(right as unknown as Json, { note: 'correction' });
}

/**
 * Run the lane.
 *
 * `batches × perBatch` corrections, one distillation and one publish per batch, so
 * the dispatcher sees bursts rather than a single event — a queue that only works
 * one event deep is not a queue.
 */
export async function runDeliveryLane(options: {
  readonly batches?: number;
  readonly perBatch?: number;
} = {}): Promise<DeliveryReport> {
  const batches = options.batches ?? 10;
  const perBatch = options.perBatch ?? 5;
  const receiver = await startReceiver({ failFirst: true, slowAt: 3, slowMs: SLOW_MS });
  const store = await EmbeddedMemory.open(new MemoryJournal());
  const mg = await openMicroglia({
    app: 'microglia-delivery',
    namespace: NAMESPACE,
    store,
    interpreter: async (context) => chartInterpreter(context),
    editSemantics: chartEditDistance,
    clock: steppingClock(CLOCK_START, 1),
    random: mulberry32(20261023),
  });

  const dispatcher = new WebhookDispatcher({
    target: { url: receiver.url, secret: SECRET },
    fetch,
    clock: () => performance.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  });

  // One entry per acknowledged event: its id (for the miss diff) and the
  // sender-side end-to-end latency of the attempt that succeeded.
  const published: { readonly id: string; readonly latencyMs: number }[] = [];
  let snapshot: Record<string, KnowledgeSnapshot> = {};
  let retries = 0;

  for (let batch = 0; batch < batches; batch += 1) {
    for (let index = 0; index < perBatch; index += 1) {
      const taskType = TASK_TYPES[(batch * perBatch + index) % TASK_TYPES.length] as string;
      await correct(mg, batch * perBatch + index, taskType);
    }
    await mg.distill({ generalize: false });
    const items = await mg.store.listKnowledge({ namespace: NAMESPACE, status: 'all' });

    const drafts: DraftEvent[] = [];
    for (const taskType of TASK_TYPES) {
      const scoped = items.filter((item) => item.scope.task === taskType);
      drafts.push(...knowledgeEvents({ namespace: NAMESPACE, taskType, previous: snapshot, current: scoped }));
    }
    snapshot = snapshotOf(items);

    const result = await dispatcher.publish(drafts);
    // Every attempt beyond the first is a retry: the receiver fails one request on
    // purpose, and backoff that never fires is a retry path that was never run.
    retries += result.attempts.filter((attempt) => attempt.attempt > 1).length;
    for (const attempt of result.attempts) {
      if (attempt.ok) published.push({ id: attempt.eventId, latencyMs: attempt.latencyMs });
    }
  }

  await mg.close();
  await receiver.close();

  const deliveredIds = new Set(receiver.received.map((entry) => entry.id));
  const missList = published.filter((entry) => !deliveredIds.has(entry.id)).map((entry) => entry.id);
  const latencies = published.map((entry) => entry.latencyMs);

  const orderingViolations = countOrderingViolations(receiver.received);

  const metrics: DeliveryMetrics = {
    corrections: batches * perBatch,
    published: published.length,
    delivered: receiver.received.length,
    duplicates: receiver.repeats,
    missed: missList.length,
    signatureFailures: receiver.rejected,
    retries,
    orderingViolations,
    p50Ms: percentile(latencies, 0.5),
    p95Ms: percentile(latencies, 0.95),
    slowestMs: percentile(latencies, 1),
  };

  const gate = (id: string, criterion: string, actual: string, pass: boolean) => ({ id, criterion, actual, pass });
  const gates = [
    gate('delivery-nothing-missed', 'every published event was received', `${metrics.missed} missed of ${metrics.published}`, metrics.missed === 0),
    gate('delivery-signatures-verify', 'the receiver accepted every signature', `${metrics.signatureFailures} rejected`, metrics.signatureFailures === 0),
    gate('delivery-ordering', 'per task type, sequence numbers only increase', `${metrics.orderingViolations} violations`, metrics.orderingViolations === 0),
    gate('delivery-retry-exercised', 'at least one retry happened (at-least-once was tested)', `${metrics.retries} retries`, metrics.retries > 0),
    // The receiver stored the first request before rejecting it, so exactly one
    // event must arrive twice with the same id and be stored once.
    gate(
      'delivery-duplicate-recognised',
      'the redelivery carried the same id and was de-duplicated',
      `${metrics.duplicates} repeat(s), ${metrics.delivered} stored`,
      metrics.duplicates >= 1 && metrics.delivered === metrics.published,
    ),
    gate('delivery-latency-control', 'the delayed event is visible in the measurement', `slowest ${metrics.slowestMs}ms >= ${SLOW_MS}ms`, metrics.slowestMs >= SLOW_MS),
    gate('delivery-within-bound', `p95 <= ${DELIVERY_BOUND_MS / 1000}s on loopback`, `${metrics.p95Ms}ms`, metrics.p95Ms <= DELIVERY_BOUND_MS),
  ];

  return { metrics, gates, missList };
}
