/**
 * Defect 27: a bounded pre-flight provider probe, made before a run is paid for.
 *
 * R48's first dispatch (`42350304597`) spent an hour of model calls on a
 * DeepSeek endpoint that answered 500 on every request. Both arms failed, the
 * evidence zip carried zero arm entries, and the offline verifier had to
 * declare NO_MEASUREMENT after the fact. Worse, the same missing artefact can
 * be misread as a zero, a negative delta or a revert. `AUDIT` 34.34 records
 * the failure; this module makes the decision a typed rule.
 *
 * Three states, deliberately matching the paired-facade terminal states:
 *
 *  - READY          every probe succeeded and the registered minimum was met.
 *  - DEGRADED       some probes succeeded and some failed. Not a measurement:
 *                   an endpoint that answers intermittently would turn a
 *                   provider outage into an accuracy difference.
 *  - NO_MEASUREMENT no probe succeeded, the instrument was malformed, or too
 *                   few probes were made. The `outage` field names which.
 *
 * `probeGate` is the only place that decides whether a measurement may start,
 * and `noMeasurementMarker` is what the lane writes when it stops: an explicit
 * `status_no_measurement` that is distinct from `status_not_run` (a missing
 * environment) and from any graded result. No delta and no revert flag are
 * ever produced here.
 *
 * The HTTP calls belong to the driver. This module classifies their recorded
 * outcomes, which is why it is pure and fully testable on committed readings.
 */

/** One bounded pre-flight completion. */
export type ProbeAttempt = {
  readonly ok: boolean;
  readonly status?: number;
  readonly latencyMs?: number;
};

/** Consecutive successes required before a provider is trusted with a run. */
export const PROBE_MIN_SUCCESSES = 3;

export type ProbeOutage =
  | 'provider-5xx'
  | 'client-4xx'
  | 'mixed-failures'
  | 'no-attempts'
  | 'malformed'
  | 'insufficient-successes';

export type ProviderProbeVerdict =
  | {
      readonly state: 'READY';
      readonly attempts: number;
      readonly maxLatencyMs: number;
      readonly reason: string;
    }
  | {
      readonly state: 'DEGRADED';
      readonly attempts: number;
      readonly failures: number;
      readonly reason: string;
    }
  | {
      readonly state: 'NO_MEASUREMENT';
      readonly attempts: number;
      readonly outage: ProbeOutage;
      readonly reason: string;
    };

/** A malformed instrument is never classified as a provider outcome. */
function malformed(attempt: ProbeAttempt): boolean {
  if (typeof attempt.ok !== 'boolean') return true;
  if (
    attempt.status !== undefined &&
    (!Number.isInteger(attempt.status) || attempt.status < 100 || attempt.status > 599)
  ) {
    return true;
  }
  if (
    attempt.latencyMs !== undefined &&
    (!Number.isFinite(attempt.latencyMs) || attempt.latencyMs < 0)
  ) {
    return true;
  }
  // A successful completion without a latency has no population behind the
  // `maxLatencyMs` READY reports, so it is an incomplete observation.
  return attempt.ok && attempt.latencyMs === undefined;
}

function noMeasurement(
  attempts: number,
  outage: ProbeOutage,
  reason: string,
): ProviderProbeVerdict {
  return { state: 'NO_MEASUREMENT', attempts, outage, reason };
}

/**
 * Classify a bounded series of pre-flight completions.
 *
 * The order is the order of failure modes R48 exposed: a malformed observation
 * is refused first, because a `NaN` latency or a `500.5` status says the
 * recorder is broken and nothing downstream can be trusted; an empty series
 * is an absent instrument; then the three outcome families are separated.
 * A mixed series is DEGRADED even when it happens to meet the success minimum:
 * intermittent availability is a confound, not a healthy provider.
 */
export function classifyProviderProbe(
  attempts: readonly ProbeAttempt[],
  options: { readonly minSuccesses?: number } = {},
): ProviderProbeVerdict {
  const minSuccesses = options.minSuccesses ?? PROBE_MIN_SUCCESSES;
  if (!Number.isInteger(minSuccesses) || minSuccesses < 1) {
    throw new Error(`minSuccesses must be a positive integer, received '${String(minSuccesses)}'`);
  }
  const size = attempts.length;
  if (attempts.some(malformed)) {
    return noMeasurement(size, 'malformed', 'a pre-flight observation was malformed');
  }
  if (size === 0) {
    return noMeasurement(0, 'no-attempts', 'no pre-flight probe was made');
  }

  const successes = attempts.filter((attempt) => attempt.ok).length;
  const failures = size - successes;

  if (successes === 0) {
    const statuses = attempts
      .map((attempt) => attempt.status)
      .filter((status): status is number => status !== undefined);
    const complete = statuses.length === size;
    const all5xx = complete && statuses.every((status) => status >= 500);
    const all4xx = complete && statuses.every((status) => status >= 400 && status < 500);
    const outage: ProbeOutage = all5xx
      ? 'provider-5xx'
      : all4xx
        ? 'client-4xx'
        : 'mixed-failures';
    const detail =
      outage === 'provider-5xx'
        ? 'the provider answered 5xx on every pre-flight call'
        : outage === 'client-4xx'
          ? 'the provider refused every pre-flight call with a 4xx status'
          : 'every pre-flight call failed with mixed statuses';
    return noMeasurement(size, outage, `${detail}: this is an infrastructure failure, not a measurement`);
  }

  if (failures > 0) {
    return {
      state: 'DEGRADED',
      attempts: size,
      failures,
      reason: `${failures} of ${size} pre-flight calls failed: an intermittent provider is not a controlled measurement`,
    };
  }
  if (successes < minSuccesses) {
    return noMeasurement(
      size,
      'insufficient-successes',
      `only ${successes} consecutive successes, ${minSuccesses} are registered before a run may start`,
    );
  }
  const maxLatencyMs = Math.max(...attempts.map((attempt) => attempt.latencyMs as number));
  return {
    state: 'READY',
    attempts: size,
    maxLatencyMs,
    reason: `${successes} consecutive pre-flight completions, slowest ${maxLatencyMs.toFixed(0)}ms`,
  };
}

/**
 * Was this an all-5xx provider outage, as opposed to a client refusal or a
 * partially healthy endpoint? Used to name the failure in the lane's marker.
 */
export function isProviderOutage(attempts: readonly ProbeAttempt[]): boolean {
  if (attempts.length === 0 || attempts.some((attempt) => attempt.ok)) return false;
  return attempts.every(
    (attempt) =>
      attempt.status !== undefined && attempt.status >= 500 && attempt.status < 600,
  );
}

/**
 * The explicit marker a lane writes when it stops before measuring.
 *
 * `status_not_run` is deliberately 0: a provider that refused every call is
 * not an environment that was never configured, and conflating the two is how
 * an infrastructure failure quietly becomes a green skip. `claim: 'none'`
 * states what the run is allowed to conclude.
 */
export type NoMeasurementMarker = {
  readonly status_no_measurement: 1;
  readonly status_not_run: 0;
  readonly claim: 'none';
  readonly reason: string;
};

export function noMeasurementMarker(reason: string): NoMeasurementMarker {
  if (reason.trim() === '') throw new Error('a no-measurement marker needs a reason');
  return { status_no_measurement: 1, status_not_run: 0, claim: 'none', reason };
}

export type ProbeGate =
  | { readonly proceed: true }
  | { readonly proceed: false; readonly marker: NoMeasurementMarker };

/** The single decision point: only READY may start a paid measurement. */
export function probeGate(verdict: ProviderProbeVerdict): ProbeGate {
  if (verdict.state === 'READY') return { proceed: true };
  return { proceed: false, marker: noMeasurementMarker(verdict.reason) };
}

/**
 * Thrown by the driver when the pre-flight gate refuses to start a run.
 *
 * `l4.ts` catches this by `name` (the driver is dynamically imported, so the
 * class identity is not shared across the module boundary) and writes the
 * marker instead of a zero, a delta or a not-run. Carrying the marker on the
 * error keeps the decision and the artefact in one place.
 */
export class ProviderNoMeasurementError extends Error {
  readonly marker: NoMeasurementMarker;

  constructor(marker: NoMeasurementMarker) {
    super(marker.reason);
    this.name = 'ProviderNoMeasurementError';
    this.marker = marker;
  }
}
