/**
 * Distillation: feedback events in, scoped knowledge out.
 *
 * The package is deliberately domain-blind. A domain pack supplies an
 * `Interpreter` that turns one event into zero or more claims; this layer owns
 * the parts that must behave identically in every domain — redaction, injection
 * screening, dedupe, generalisation, and the merge that accumulates evidence.
 */
import type {
  Clock,
  DistillCandidate,
  FeedbackEvent,
  KnowledgeItem,
  Policy,
  RandomSource,
  RunRecord,
} from '@agentix-e/microglia-core';
import type { MemoryPort } from '@agentix-e/microglia-memory';

export type InterpretContext = {
  readonly event: FeedbackEvent;
  readonly run: RunRecord | undefined;
};

/**
 * A domain pack's only required implementation.
 *
 * Returning `[]` is a valid answer and must not be treated as an error: most
 * feedback carries no reusable lesson, and a distiller that manufactures one
 * from every click is how a prompt becomes noise.
 */
export type Interpreter = (
  context: InterpretContext,
) => readonly DistillCandidate[] | Promise<readonly DistillCandidate[]>;

export type DistillOptions = {
  readonly memory: MemoryPort;
  readonly policy: Policy;
  readonly clock: Clock;
  readonly random: RandomSource;
  readonly interpreter: Interpreter;
  /** Only events at or after this timestamp are read. */
  readonly since?: number;
  /** Safety valve for a first run over a large backlog. */
  readonly limit?: number;
  /** Allow a host to veto a claim before it is stored (e.g. policy filters). */
  readonly accept?: (candidate: DistillCandidate) => boolean;
  /**
   * Widen a claim to a domain-free scope when the same claim recurs in another
   * domain. Default true. Disabling it is how the ablation measures whether
   * generalisation contributes anything at all.
   */
  readonly generalize?: boolean;
  /**
   * Demote an active rule that a trusted new claim contradicts. Default true.
   *
   * Disabling it is how the ablation measures the module: with resolution off,
   * two conflicting rules both stay active and both reach the prompt.
   */
  readonly resolveContradictions?: boolean;
};

export type DistillReport = {
  readonly events: number;
  readonly candidates: number;
  readonly created: number;
  readonly merged: number;
  readonly generalized: number;
  readonly superseded: number;
  readonly contradicted: number;
  readonly quarantined: number;
  readonly rejectedUnsafe: number;
  readonly rejectedByHost: number;
};

export type { Clock, DistillCandidate, FeedbackEvent, KnowledgeItem, Policy, RandomSource, RunRecord };
export type { MemoryPort };
