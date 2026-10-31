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
} from '../kernel/index.js';
import type { MemoryPort } from '../memory/index.js';

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
 *
 * `prefetch` is optional and carries no semantics: it is told the contexts the
 * batch is about to be interpreted with, and is free to do nothing. An
 * interpreter whose work is a model call uses it to pay the latency of the batch
 * concurrently while the results are still applied in corpus order, because a
 * serial loop over one call per event is dominated by the round trips rather
 * than by the reasoning.
 */
export type Interpreter = ((
  context: InterpretContext,
) => readonly DistillCandidate[] | Promise<readonly DistillCandidate[]>) & {
  prefetch?: (contexts: readonly InterpretContext[]) => Promise<void>;
};;

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
  /**
   * Abort on the first interpreter failure instead of counting it. Default false:
   * one unparseable model response should not discard the other two hundred
   * lessons in the batch, and the count is reported either way.
   */
  readonly strict?: boolean;
  /**
   * Which interpreter failures are about the run rather than about the event.
   *
   * A spent budget, an expired deadline, a revoked credential: these stop the batch instead of
   * becoming a `failed` count, because a batch that continued past one of them would write a
   * thinner store and report it as a store. The distinction cannot be drawn here — only the host
   * knows which errors its own interpreter raises — so the host supplies the test.
   */
  readonly fatal?: (error: unknown) => boolean;
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
  /** Claims citing an event other than the one being interpreted. */
  readonly rejectedBorrowed: number;
  readonly rejectedByHost: number;
  /** Events whose interpreter threw. Non-strict runs count them and continue. */
  readonly failed: number;
  /**
   * Claims that arrived with a condition the stored item already had, and a
   * different one.
   *
   * The merge keeps the first condition, so this count is the only place a reader
   * can see that the rule was learned under two descriptions of when it applies.
   */
  readonly conditionConflicts: number;
  /**
   * Claims that arrived with no domain.
   *
   * The store's share of domain-free items used to be one number with two causes: the interpreter
   * declined to scope the claim at the door, or generalisation earned the widening by finding it in
   * a second domain. They call for opposite fixes — a prompt or a host default on one side, a
   * widening policy on the other — so they are counted apart here and reconciled in the lane that
   * reports the store's shape.
   */
  readonly incomingWithoutDomain: number;
};

export type { Clock, DistillCandidate, FeedbackEvent, KnowledgeItem, Policy, RandomSource, RunRecord };
export type { MemoryPort };
