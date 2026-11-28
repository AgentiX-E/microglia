/**
 * Abstraction lifecycle: decide whether one knowledge item is accumulated as a durable record or applied only
 * for the current task and then discarded (Anti-Persistence, R247).
 *
 * ## The question this answers
 *
 * Memory-based self-improvement has a central design choice: retain only observed trajectories and outcomes, or
 * also retain the rules, summaries and skills inferred from them. Keeping abstractions lets a later task reuse a
 * strategy without re-deriving it; but a wrong abstraction does more than mislead the one task that retrieves it.
 * It shapes that task's execution, and the resulting trajectory becomes input to the next synthesis round, which
 * can re-derive the same error even after the original rule is removed. Anti-Persistence (arXiv 2610.27406, IU +
 * Tencent) calls this *error reproduction* and reports that retaining trajectories while reconstructing guidance
 * on demand — discarding it after execution — gives higher held-out success at the lowest average LLM-call cost
 * across three benchmarks and three backbones.
 *
 * This module is that separation, as a pure function over one item:
 *  - an **event record** (`exemplar`) is experience — accumulated, never discarded;
 *  - an **abstraction** (any claim kind) is temporary guidance by default — reconstructed on demand and thrown
 *    away, unless the item's own observed outcomes license persisting it.
 *
 * ## The decision ladder
 *
 *  1. `exemplar` → `retain` / `event-record`. A record of one episode is not a claim about a class; two records
 *     cannot contradict, so there is nothing to reproduce and no reason to throw either away.
 *  2. abstraction with a negative net flip → `discard` / `harmful-abstraction`. Error reproduction starts from a
 *     rule that hurt; such a rule is not even safe to synthesise on demand. Harm is checked *before* the injection
 *     floor — a rule that hurt once can regenerate, so volume does not excuse it.
 *  3. abstraction with a positive net flip at or above `minInjections` → `retain` / `stable-help`. Enough outcomes
 *     observed the rule help; it has earned the right to be a stored object.
 *  4. abstraction with a positive net flip below the floor → `ephemeral` / `insufficient-outcomes`. A hint, not
 *     evidence; rebuild it when needed, do not persist it.
 *  5. abstraction with no net flip (or no utility) → `ephemeral` / `no-signal`. No evidence to persist.
 *
 * ## Discipline
 *
 * Pure and deterministic; no clock, no network, no model. `delta`, `injected` and the applied floor are reported
 * for a readback but only the sign of the net flip and the floor gate the decision. Every guard refuses rather than
 * defaults — a malformed id, an unknown kind or an impossible utility would otherwise quietly steer persistence.
 * Like `stateRole` and `viewConsensus`, nothing is wired into the default write path: a caller opts in, so every
 * artefact committed before R247 renders byte-identically.
 */
import { MicrogliaError } from '../kernel/index.js';

/** The closed, ordered vocabulary of dispositions. Order is part of the contract. */
export const LIFECYCLE_DISPOSITIONS = ['retain', 'ephemeral', 'discard'] as const;
export type LifecycleDisposition = (typeof LIFECYCLE_DISPOSITIONS)[number];

/** The closed, ordered vocabulary of reasons. Order is part of the contract. */
export const LIFECYCLE_REASONS = [
  'event-record',
  'stable-help',
  'harmful-abstraction',
  'insufficient-outcomes',
  'no-signal',
] as const;
export type LifecycleReason = (typeof LIFECYCLE_REASONS)[number];

/** The kinds whose instances are claims (temporary abstractions), mirroring `isEventKind`. */
const CLAIM_KINDS = new Set(['constraint', 'negative', 'lexicon', 'procedure', 'abstention']);
const ALL_KINDS = new Set([...CLAIM_KINDS, 'exemplar']);

/** The minimal shape the decision needs; deliberately structural, not the full `KnowledgeItem`. */
export type AbstractionLifecycleInput = {
  readonly id: string;
  readonly kind: string;
  readonly utility?: {
    readonly injected: number;
    readonly flippedUp: number;
    readonly flippedDown: number;
  };
};

export type AbstractionLifecycleOptions = {
  /** Minimum injected outcomes before a positive abstraction may be persisted. Default 3, integer >= 1. */
  readonly minInjections?: number;
};

export type AbstractionLifecycleDecision = {
  readonly disposition: LifecycleDisposition;
  readonly reason: LifecycleReason;
  readonly id: string;
  readonly kind: string;
  /** Net flip: `flippedUp - flippedDown`, 0 when no utility is present. */
  readonly delta: number;
  readonly injected: number;
  readonly minInjections: number;
};

function integerIn(value: number, name: string, id: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new MicrogliaError(
      'MG_E_CONFIG',
      `item '${id}': ${name} must be a non-negative integer`,
      { id, name, value },
    );
  }
}

/**
 * Decide the lifecycle of one knowledge item under Anti-Persistence.
 *
 * Refuses malformed input rather than treating it as evidence: an unknown kind would silently classify a record as
 * a claim (or vice versa), and an impossible utility could fabricate stable help or hide harm.
 */
export function abstractionLifecycle(
  item: AbstractionLifecycleInput,
  options: AbstractionLifecycleOptions = {},
): AbstractionLifecycleDecision {
  if (typeof item.id !== 'string' || item.id.trim() === '') {
    throw new MicrogliaError('MG_E_CONFIG', 'item id must be a non-blank string', { id: item.id });
  }
  if (typeof item.kind !== 'string' || !ALL_KINDS.has(item.kind)) {
    throw new MicrogliaError('MG_E_CONFIG', `item '${item.id}': unknown kind '${item.kind}'`, {
      id: item.id,
      kind: item.kind,
    });
  }

  const minInjections = options.minInjections ?? 3;
  if (!Number.isInteger(minInjections) || minInjections < 1) {
    throw new MicrogliaError('MG_E_CONFIG', 'minInjections must be a positive integer', {
      minInjections,
    });
  }

  const utility = item.utility;
  let injected = 0;
  let delta = 0;
  if (utility !== undefined) {
    integerIn(utility.injected, 'injected', item.id);
    integerIn(utility.flippedUp, 'flippedUp', item.id);
    integerIn(utility.flippedDown, 'flippedDown', item.id);
    if (utility.flippedUp + utility.flippedDown > utility.injected) {
      throw new MicrogliaError(
        'MG_E_CONFIG',
        `item '${item.id}': flips cannot exceed injected`,
        {
          id: item.id,
          injected: utility.injected,
          flippedUp: utility.flippedUp,
          flippedDown: utility.flippedDown,
        },
      );
    }
    injected = utility.injected;
    delta = utility.flippedUp - utility.flippedDown;
  }

  // CLAIM_KINDS is the complement of the single event kind; ALL_KINDS was validated above, so membership here
  // is exactly "this is an abstraction". Kept as a named set so a future event kind cannot be misclassified.
  const isEvent = !CLAIM_KINDS.has(item.kind);

  let disposition: LifecycleDisposition;
  let reason: LifecycleReason;
  if (isEvent) {
    disposition = 'retain';
    reason = 'event-record';
  } else if (delta < 0) {
    disposition = 'discard';
    reason = 'harmful-abstraction';
  } else if (delta > 0 && injected >= minInjections) {
    disposition = 'retain';
    reason = 'stable-help';
  } else if (delta > 0) {
    disposition = 'ephemeral';
    reason = 'insufficient-outcomes';
  } else {
    disposition = 'ephemeral';
    reason = 'no-signal';
  }

  return {
    disposition,
    reason,
    id: item.id,
    kind: item.kind,
    delta,
    injected,
    minInjections,
  };
}
