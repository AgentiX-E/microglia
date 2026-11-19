/**
 * Whether the two arms of a pair were scored at the same `k`, and whether that `k` is the bar's.
 *
 * ## The defect this exists for
 *
 * R152c's arm wrote `metrics.k = 1` beside a field named `pass4`. Nothing read it. The pairing step
 * handed the protocol `trialCount: first.metrics?.k ?? 4`, and `trialCount` is read by no gate in the
 * table at all — so an arm scored at one trial per task was paired, published, and compared against a
 * bar registered at `pass^4`, and **none of the three files said so**. That is the second of the two
 * comparative invalidities this record counts: the first is the backbone (`bar_backbone_matches = 0`),
 * and it is the one the artefact has always been able to state.
 *
 * `pass^k` at two different `k` are two different statistics. They have different expectations on the
 * same agent: for a per-trial rate `p`, `pass^1` is `p` and `pass^4` is `p⁴`, so at `p = 0.95` the
 * first reads 95% and the second 81%. A delta across a pair that mixes them is a difference in the
 * metric wearing a treatment's name, and it is not visible in the delta, the interval, or the counts —
 * only in a field nobody divided by.
 *
 * ## What the artefact owes
 *
 * Three different situations, and the gate says which one it is in rather than collapsing them:
 *
 *  - both arms state a `k` and they agree — the gate passes, and the protocol records the level;
 *  - both state a `k` and they differ — the gate **fails and blocks**, because the two arms were not
 *    scored by one statistic and no pairing step can repair that after the fact;
 *  - an arm states none — the gate is **absent**, and the reason names the arm. Absent is not green:
 *    every arm this lane has written since R120 carries `metrics.k`, so a pair without one is a pair
 *    of artefacts written before the field, and the honest reading of it is "the metric was never
 *    stated", not "the metrics matched".
 *
 * ## Why the bar is a field and not a second condition on the gate
 *
 * `barK` is the `k` the published reference was measured at. A pair scored at `k = 1` on the published
 * scenario is internally consistent — its two arms do agree — and grading it red would be charging the
 * pair for the comparison's defect. So the mismatch is carried as `barKMismatch` beside the pair's own
 * `k`, the same way an arm artefact carries `bar_backbone_matches` beside its delta, and the gate keeps
 * saying one thing.
 */

import type { ValidityGate } from '@agentix-e/microglia-protocol';

/** The `k` a driver is allowed to have scored an arm at: a positive whole number of trials per task. */
function readK(value: number | null | undefined, field: string): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${field} must be a positive integer number of trials, got ${String(value)}`);
  }
  return value;
}

export type MetricParityInput = {
  /** `metrics.k` from the first (reference) arm, or null when the artefact states none. */
  readonly kFirst: number | null | undefined;
  /** `metrics.k` from the second (treatment) arm. */
  readonly kSecond: number | null | undefined;
  /** The `k` the published bar was measured at, when this pair is on the bar's scenario. */
  readonly barK?: number | null;
  /** What to call each arm in the sentences, so a reader knows which file to open. */
  readonly firstArm?: string;
  readonly secondArm?: string;
};

/**
 * The reading, in the two states it can be in.
 *
 * A union rather than two nullable fields, because "there is no gate" and "here is why" are one fact:
 * with both optional, every reader has to handle `gate === null && absent === null`, which no input
 * produces and which a branch would then have to be tested — or, worse, exempted.
 */
export type MetricParity =
  | {
      /** The level both arms share, or null when they stated different ones. */
      readonly k: number | null;
      readonly kFirst: number;
      readonly kSecond: number;
      readonly barK: number | null;
      /** Whether the pair's shared `k` differs from the bar's; `null` when no bar applies or no `k`. */
      readonly barKMismatch: boolean | null;
      readonly gate: ValidityGate;
      readonly absent: null;
    }
  | {
      readonly k: null;
      readonly kFirst: number | null;
      readonly kSecond: number | null;
      readonly barK: number | null;
      readonly barKMismatch: null;
      readonly gate: null;
      /** Why there is no gate — which arm stayed silent, and what that costs the pair. */
      readonly absent: string;
    };

export function metricParityOf(input: MetricParityInput): MetricParity {
  const kFirst = readK(input.kFirst, 'kFirst');
  const kSecond = readK(input.kSecond, 'kSecond');
  const barK = readK(input.barK, 'barK');
  const first = input.firstArm ?? 'first';
  const second = input.secondArm ?? 'second';
  const shared = kFirst !== null && kFirst === kSecond ? kFirst : null;
  const barKMismatch = barK === null || shared === null ? null : shared !== barK;

  // Nothing to grade when either arm is silent, and the silence is named per arm: `null` in the
  // projection and "not stated" in the sentence are the same fact, and a reader looking at one should
  // not have to infer it from the other. The test is written as the two null checks rather than as a
  // list of the silent arms, because that is also what narrows the types below.
  if (kFirst === null || kSecond === null) {
    const silent = [...(kFirst === null ? [first] : []), ...(kSecond === null ? [second] : [])];
    return {
      k: null,
      kFirst,
      kSecond,
      barK,
      barKMismatch: null,
      gate: null,
      absent:
        `${silent.join(' and ')} stated no \`metrics.k\`, so the pair cannot say whether its two arms were ` +
        'scored by one statistic; every artefact written since R120 carries the field',
    };
  }

  const actual =
    kFirst === kSecond
      ? `both arms at k = ${String(kFirst)}` +
        (barK === null
          ? ', and no published bar applies to this scenario'
          : barK === kFirst
            ? `, which is the bar's k = ${String(barK)}`
            : `, and the bar is k = ${String(barK)} — the delta is a different statistic from the bar's`)
      : `first at k = ${String(kFirst)}, second at k = ${String(kSecond)}`;
  return {
    k: shared,
    kFirst,
    kSecond,
    barK,
    barKMismatch,
    gate: {
      id: 'l4-same-k',
      criterion:
        'both arms were scored by one statistic: `pass^k` at the same k, because pass^1 and pass^4 are not one measurement',
      actual,
      pass: kFirst === kSecond,
      blocking: true,
    },
    absent: null,
  };
}

/**
 * The same per-trial rate, restated at another `k`.
 *
 * `pass^k` at one level and `pass^j` at another are the same underlying quantity raised to different
 * powers: writing `p` for the per-trial success probability, a task passes `pass^k` with probability
 * `p^k`. So a reading of `r` at `fromK` implies `r^(toK/fromK)` at `toK` **under independence between
 * trials of a task** — and that assumption is the whole content of the conversion. Where trials
 * correlate — a task whose setup fails fails every trial — the restated value is an over-estimate, and
 * the arm's own `rate_to_the_k` field is the same caveat one level down.
 *
 * It exists because this lane compared `pass^1` readings to `pass^4` bars for four rounds: every one of
 * the four registrations behind `poc-l4-pair-*` declares `trials: 1`, so 0.925 is the share of tasks that
 * passed their one trial, and it is not the number the bar is written in.
 */
export function restateAtLevel(rate: number, fromK: number, toK: number): number {
  if (!Number.isFinite(rate) || rate < 0 || rate > 1) {
    throw new Error(`rate must be a share in [0, 1], got ${String(rate)}`);
  }
  for (const [name, value] of [
    ['fromK', fromK],
    ['toK', toK],
  ] as const) {
    if (!Number.isInteger(value) || value < 1) {
      throw new Error(`${name} must be a positive integer number of trials, got ${String(value)}`);
    }
  }
  return rate ** (toK / fromK);
}

/** The reading as one line, or the omission when the pair could not state a level. */
export function metricParityLine(parity: MetricParity): string {
  if (parity.gate === null) return `metric: ${parity.absent}`;
  const shared = parity.k === null ? 'the arms disagree' : `k = ${String(parity.k)}`;
  const bar =
    parity.barKMismatch === null
      ? ''
      : parity.barKMismatch
        ? `; the bar is k = ${String(parity.barK)}, so a delta against it is cross-metric as well as cross-sample`
        : `; the bar's k = ${String(parity.barK)} matches`;
  return `metric: ${shared}${bar}`;
}
