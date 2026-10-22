import { describe, expect, it } from 'vitest';
import { hmacSha256Hex } from '@agentix-e/microglia-core/delivery';
import {
  DELIVERY_BOUND_MS,
  countOrderingViolations,
  percentile,
  runDeliveryLane,
  startReceiver,
} from '../lanes/delivery.js';

describe('the receiver the lane measures against', () => {
  it('refuses a body whose signature does not match', async () => {
    const box = await startReceiver({});
    const response = await fetch(box.url, {
      method: 'POST',
      headers: { 'X-Microglia-Signature': 'sha256=deadbeef' },
      body: JSON.stringify({ id: 'evt_1', seq: 1, taskType: 'chart.recommend' }),
    });
    expect(response.status).toBe(401);
    expect(box.rejected).toBe(1);
    expect(box.received).toHaveLength(0);
    await box.close();
  });

  it('refuses a request that carries no signature at all', async () => {
    const box = await startReceiver({});
    const response = await fetch(box.url, {
      method: 'POST',
      body: JSON.stringify({ id: 'evt_2', seq: 1, taskType: 'chart.recommend' }),
    });
    expect(response.status).toBe(401);
    expect(box.rejected).toBe(1);
    await box.close();
  });

  it('can be told to answer slowly, so the latency control is exercised directly', async () => {
    const box = await startReceiver({ slowAt: 1, slowMs: 40 });
    const body = JSON.stringify({ id: 'evt_3', seq: 1, taskType: 'chart.recommend' });
    const started = performance.now();
    const response = await fetch(box.url, {
      method: 'POST',
      headers: { 'X-Microglia-Signature': hmacSha256Hex('lane-secret-not-a-credential', body) },
      body,
    });
    expect(response.status).toBe(200);
    expect(performance.now() - started).toBeGreaterThanOrEqual(35);
    await box.close();
  });

  it('defaults the slow answer to the control delay', async () => {
    const box = await startReceiver({ slowAt: 1 });
    const body = JSON.stringify({ id: 'evt_4', seq: 1, taskType: 'chart.recommend' });
    const started = performance.now();
    await fetch(box.url, {
      method: 'POST',
      headers: { 'X-Microglia-Signature': hmacSha256Hex('lane-secret-not-a-credential', body) },
      body,
    });
    expect(performance.now() - started).toBeGreaterThanOrEqual(240);
    await box.close();
  });

  it('stores a verified event once, and counts the repeat', async () => {
    const box = await startReceiver({});
    const body = JSON.stringify({ id: 'evt_1', seq: 1, taskType: 'chart.recommend' });
    const headers = { 'X-Microglia-Signature': hmacSha256Hex('lane-secret-not-a-credential', body) };
    await fetch(box.url, { method: 'POST', headers, body });
    await fetch(box.url, { method: 'POST', headers, body });
    expect(box.received).toHaveLength(1);
    expect(box.repeats).toBe(1);
    await box.close();
  });
});

describe('the delivery lane', () => {
  it('delivers every change, survives an ack loss, and sees the delayed event', async () => {
    const report = await runDeliveryLane({ batches: 3, perBatch: 4 });
    const metrics = report.metrics;

    expect(metrics.corrections).toBe(12);
    expect(metrics.published).toBeGreaterThanOrEqual(12);
    expect(metrics.missed).toBe(0);
    expect(report.missList).toEqual([]);
    expect(metrics.delivered).toBe(metrics.published);
    expect(metrics.signatureFailures).toBe(0);
    expect(metrics.orderingViolations).toBe(0);
    // The receiver stores the first request and then loses the ack: one retry, one
    // repeat with the same id, one stored event.
    expect(metrics.retries).toBe(1);
    expect(metrics.duplicates).toBe(1);
    expect(metrics.slowestMs).toBeGreaterThanOrEqual(250);
    expect(metrics.p50Ms).toBeLessThanOrEqual(metrics.slowestMs);
    expect(report.gates.every((gate) => gate.pass)).toBe(true);
  });

  it('runs its default schedule when given no options', async () => {
    // The bin runs this; the test runs it once so the defaults are exercised rather
    // than only the explicit call the other tests make.
    const report = await runDeliveryLane({});
    expect(report.metrics.corrections).toBe(50);
    expect(report.metrics.missed).toBe(0);
    expect(report.gates.every((gate) => gate.pass)).toBe(true);
  }, 20_000);

  it('would notice an out-of-order delivery', async () => {
    // A mutation control: the lane cannot make a correct dispatcher reorder, so the
    // check is given a log that is already out of order.
    expect(
      countOrderingViolations([
        { taskType: 'a', seq: 1 },
        { taskType: 'a', seq: 3 },
        { taskType: 'a', seq: 2 },
        { taskType: 'b', seq: 1 },
      ]),
    ).toBe(1);
    expect(countOrderingViolations([])).toBe(0);
  });

  it('reports a quantile, and an empty sample as zero', async () => {
    expect(percentile([], 0.95)).toBe(0);
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(3);
    expect(percentile([5], 1)).toBe(5);
  });

  it('states the contract bound it cannot demonstrate', () => {
    // Loopback latency is a floor: the lane reports it and says so, rather than
    // claiming it proved a remote host is reached inside a minute.
    expect(DELIVERY_BOUND_MS).toBe(60_000);
  });

  it('names its gates, so a missing one is visible', async () => {
    const report = await runDeliveryLane({ batches: 2, perBatch: 2 });
    expect(report.gates.map((gate) => gate.id)).toEqual([
      'delivery-nothing-missed',
      'delivery-signatures-verify',
      'delivery-ordering',
      'delivery-retry-exercised',
      'delivery-duplicate-recognised',
      'delivery-latency-control',
      'delivery-within-bound',
    ]);
  });
});
