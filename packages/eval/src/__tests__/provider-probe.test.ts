import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  PROBE_MIN_SUCCESSES,
  classifyProviderProbe,
  isProviderOutage,
  noMeasurementMarker,
  isNoMeasurementRefusal,
  noMeasurementRefusal,
  probeGate,
  ProviderNoMeasurementError,
  type ProbeAttempt,
} from '../provider-probe.js';

/**
 * Defect 27 as a typed pre-flight rule.
 *
 * R48's first dispatch (`42350304597`) spent an hour on a DeepSeek endpoint
 * that answered 500 on every call. Both arms failed, the evidence zip carried
 * zero arm entries, and the readback had to declare NO_MEASUREMENT after the
 * fact. A provider that never answered is not a zero, not a revert and not a
 * negative delta. This probe makes that decision BEFORE the run is paid for,
 * and emits the marker the lane can write when it stops.
 *
 * The fixture holds the real failed-dispatch shape. The healthy shape is
 * synthetic and labelled as such: no probe existed before R49, so there is no
 * recorded healthy probe to import.
 */
const FIXTURE = join(process.cwd(), 'eval/fixtures/tau2-r49-facade-pair.json');
const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8')) as {
  readonly providerOutage: { readonly attempts: readonly ProbeAttempt[] };
  readonly healthyProbe: { readonly attempts: readonly ProbeAttempt[] };
};

const outage = fixture.providerOutage.attempts;
const healthy = fixture.healthyProbe.attempts;
const ok = (latencyMs = 200): ProbeAttempt => ({ ok: true, status: 200, latencyMs });
const bad = (status = 500): ProbeAttempt => ({ ok: false, status, latencyMs: 1200 });

describe('classifyProviderProbe', () => {
  it('declares the real R48 outage NO_MEASUREMENT, never a graded result', () => {
    const verdict = classifyProviderProbe(outage);
    expect(verdict.state).toBe('NO_MEASUREMENT');
    if (verdict.state !== 'NO_MEASUREMENT') return;
    expect(verdict.attempts).toBe(3);
    expect(verdict.outage).toBe('provider-5xx');
    expect(verdict.reason).toMatch(/5xx/);
  });

  it('accepts a fully healthy pre-flight', () => {
    const verdict = classifyProviderProbe(healthy);
    expect(verdict.state).toBe('READY');
    if (verdict.state !== 'READY') return;
    expect(verdict.attempts).toBe(3);
    expect(verdict.maxLatencyMs).toBe(210);
  });

  it('reports no attempts as an absent instrument, not a healthy one', () => {
    const verdict = classifyProviderProbe([]);
    expect(verdict.state).toBe('NO_MEASUREMENT');
    if (verdict.state !== 'NO_MEASUREMENT') return;
    expect(verdict.outage).toBe('no-attempts');
  });

  it('separates a client-side 4xx refusal from a provider outage', () => {
    const verdict = classifyProviderProbe([bad(401), bad(401), bad(401)]);
    expect(verdict.state).toBe('NO_MEASUREMENT');
    if (verdict.state !== 'NO_MEASUREMENT') return;
    expect(verdict.outage).toBe('client-4xx');
  });

  it('reports a mixed outage as mixed rather than guessing a category', () => {
    const verdict = classifyProviderProbe([bad(500), bad(429), bad(503)]);
    expect(verdict.state).toBe('NO_MEASUREMENT');
    if (verdict.state !== 'NO_MEASUREMENT') return;
    expect(verdict.outage).toBe('mixed-failures');
  });

  it('marks a partially successful probe DEGRADED, still not READY', () => {
    const verdict = classifyProviderProbe([ok(), bad(), ok()]);
    expect(verdict.state).toBe('DEGRADED');
    if (verdict.state !== 'DEGRADED') return;
    expect(verdict.failures).toBe(1);
    expect(verdict.attempts).toBe(3);
  });

  it('refuses a probe with fewer than the registered consecutive successes', () => {
    expect(PROBE_MIN_SUCCESSES).toBe(3);
    const verdict = classifyProviderProbe([ok(), ok()]);
    expect(verdict.state).toBe('NO_MEASUREMENT');
    if (verdict.state !== 'NO_MEASUREMENT') return;
    expect(verdict.outage).toBe('insufficient-successes');
  });

  it('honours an explicitly registered minimum success count', () => {
    expect(classifyProviderProbe([ok()], { minSuccesses: 1 }).state).toBe('READY');
    expect(classifyProviderProbe([ok(), ok()], { minSuccesses: 2 }).state).toBe('READY');
    expect(classifyProviderProbe([ok()], { minSuccesses: 2 }).state).toBe('NO_MEASUREMENT');
  });

  it('refuses a malformed instrument before it can look healthy', () => {
    const malformed: readonly ProbeAttempt[] = [
      { ok: true, status: 200, latencyMs: Number.NaN },
      ok(),
      ok(),
    ];
    const verdict = classifyProviderProbe(malformed);
    expect(verdict.state).toBe('NO_MEASUREMENT');
    if (verdict.state !== 'NO_MEASUREMENT') return;
    expect(verdict.outage).toBe('malformed');
  });

  it('refuses a negative latency and a non-integer status', () => {
    for (const attempt of [
      { ok: true, status: 200, latencyMs: -1 },
      { ok: false, status: 500.5, latencyMs: 100 },
      { ok: 'yes', status: 200, latencyMs: 100 },
    ] as unknown as readonly ProbeAttempt[]) {
      const verdict = classifyProviderProbe([attempt, ok(), ok()]);
      expect(verdict.state).toBe('NO_MEASUREMENT');
      if (verdict.state === 'NO_MEASUREMENT') expect(verdict.outage).toBe('malformed');
    }
  });

  it('refuses a nonsensical registered minimum', () => {
    expect(() => classifyProviderProbe(healthy, { minSuccesses: 0 })).toThrow(/minSuccesses/);
    expect(() => classifyProviderProbe(healthy, { minSuccesses: 1.5 })).toThrow(/minSuccesses/);
  });

  it('does not let a single late success certify an outage', () => {
    const verdict = classifyProviderProbe([...outage, ok()]);
    expect(verdict.state).toBe('DEGRADED');
  });
});

describe('isProviderOutage', () => {
  it('recognises the documented R48 failure shape', () => {
    expect(isProviderOutage(outage)).toBe(true);
  });

  it('is false for a healthy probe, an empty probe and a client refusal', () => {
    expect(isProviderOutage(healthy)).toBe(false);
    expect(isProviderOutage([])).toBe(false);
    expect(isProviderOutage([bad(401), bad(403), bad(401)])).toBe(false);
  });

  it('is false when any attempt succeeded', () => {
    expect(isProviderOutage([bad(), bad(), ok()])).toBe(false);
  });
});

describe('probeGate and noMeasurementMarker', () => {
  it('lets only READY start a measurement', () => {
    expect(probeGate(classifyProviderProbe(healthy))).toEqual({ proceed: true });
  });

  it('stops every non-READY state and carries an explicit marker', () => {
    for (const attempts of [outage, [], [ok(), bad(), ok()]]) {
      const gate = probeGate(classifyProviderProbe(attempts));
      expect(gate.proceed).toBe(false);
      if (gate.proceed) continue;
      expect(gate.marker.status_no_measurement).toBe(1);
      expect(gate.marker.status_not_run).toBe(0);
      expect(gate.marker.claim).toBe('none');
      expect(gate.marker.reason.length).toBeGreaterThan(0);
    }
  });

  it('marks an outage as infrastructure, not as a zero or a revert', () => {
    const gate = probeGate(classifyProviderProbe(outage));
    expect(gate.proceed).toBe(false);
    if (gate.proceed) return;
    expect(gate.marker.reason).toMatch(/5xx/);
    expect(gate.marker).not.toHaveProperty('delta');
    expect(gate.marker).not.toHaveProperty('revertRuleFired');
  });

  it('builds a marker that cannot be mistaken for a not-run environment', () => {
    const marker = noMeasurementMarker('the provider refused every pre-flight call');
    expect(marker).toEqual({
      status_no_measurement: 1,
      status_not_run: 0,
      claim: 'none',
      reason: 'the provider refused every pre-flight call',
    });
  });

  it('refuses an empty reason, which would make the marker unreadable', () => {
    expect(() => noMeasurementMarker('  ')).toThrow(/reason/);
  });

  it('carries diagnostics only when a caller has some, so absence stays readable', () => {
    // R111. A marker without diagnostics is every refusal before this field, and a refusal that
    // wrote `diagnostics: {}` would be indistinguishable from one that had nothing to say.
    expect(noMeasurementMarker('empty store')).not.toHaveProperty('diagnostics');
    const carried = noMeasurementMarker('empty store', { funnel: { asked: 15 } });
    expect(carried.diagnostics).toEqual({ funnel: { asked: 15 } });
  });
});

describe('ProviderNoMeasurementError', () => {
  it('carries the marker across the dynamic-import boundary', () => {
    const gate = probeGate(classifyProviderProbe(outage));
    expect(gate.proceed).toBe(false);
    if (gate.proceed) return;
    const error = new ProviderNoMeasurementError(gate.marker);
    expect(error.name).toBe('ProviderNoMeasurementError');
    expect(error.message).toBe(gate.marker.reason);
    expect(error.marker.status_no_measurement).toBe(1);
    expect(error.marker.status_not_run).toBe(0);
  });

  it('is recognisable by name alone, the way l4.ts must catch it', () => {
    const error = new ProviderNoMeasurementError(noMeasurementMarker('the provider answered 5xx'));
    expect((error as { name: string }).name).toBe('ProviderNoMeasurementError');
  });
});

describe('the no-measurement refusal is a structural contract', () => {
  it('builds a refusal that carries the marker and a distinct name', () => {
    const error = noMeasurementRefusal('the distilled store is empty: no treatment existed');
    expect(error.name).toBe('NoMeasurementError');
    expect(error.message).toMatch(/distilled store is empty/);
    expect(error.marker.status_no_measurement).toBe(1);
    expect(error.marker.status_not_run).toBe(0);
    expect(error.marker.claim).toBe('none');
  });

  it('refuses an empty reason, because an unlabelled refusal is a bare crash', () => {
    expect(() => noMeasurementRefusal('   ')).toThrow(/needs a reason/);
  });

  it('recognises every refusal the lane may raise, by structure rather than by class', () => {
    expect(isNoMeasurementRefusal(noMeasurementRefusal('empty store'))).toBe(true);
    // R111: diagnostics ride on the marker without changing what the marker is. `l4.ts` decides by
    // structure, so a field it does not know must not be able to turn a refusal into a crash.
    expect(isNoMeasurementRefusal(noMeasurementRefusal('empty store', { funnel: { asked: 0 } }))).toBe(
      true,
    );
    // The provider refusal is one case of the contract, not the contract itself.
    const gate = probeGate(classifyProviderProbe(outage));
    expect(gate.proceed).toBe(false);
    if (gate.proceed) return;
    expect(isNoMeasurementRefusal(new ProviderNoMeasurementError(gate.marker))).toBe(true);
    // A marker-shaped object that crossed a JSON boundary must still count:
    // the driver is dynamically imported, so class identity is not a contract.
    expect(
      isNoMeasurementRefusal({
        name: 'NoMeasurementError',
        marker: { status_no_measurement: 1, status_not_run: 0, claim: 'none', reason: 'x' },
      }),
    ).toBe(true);
  });

  it('does not mistake an ordinary failure, a not-run or a fake marker for a refusal', () => {
    expect(isNoMeasurementRefusal(new Error('boom'))).toBe(false);
    expect(isNoMeasurementRefusal({ name: 'NoMeasurementError' })).toBe(false);
    expect(
      isNoMeasurementRefusal({
        name: 'NoMeasurementError',
        marker: { status_no_measurement: 0, status_not_run: 1, claim: 'none', reason: 'x' },
      }),
    ).toBe(false);
    for (const value of [null, undefined, 'NoMeasurementError', 42, []]) {
      expect(isNoMeasurementRefusal(value)).toBe(false);
    }
  });
});
