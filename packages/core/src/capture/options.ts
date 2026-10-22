/**
 * The host-facing surface.
 *
 * The API is deliberately small: `begin`, `recall`, `feedback`, `distill`,
 * `export`, `doctor`. A host should be able to integrate in one screen and
 * discover the rest when it needs it. Nothing here renders UI, opens a socket,
 * or knows what a "user" is beyond a hashed actor type.
 */
import type {
  Actor,
  Clock,
  Json,
  JsonObject,
  KnowledgePack,
  Policy,
  RandomSource,
  RatingValue,
} from '../kernel/index.js';
import type { MemoryPort } from '../memory/index.js';
import type { Interpreter } from '../distill/index.js';

export type MicrogliaOptions = {
  /** Stable application identifier, used in exports and diagnostics. */
  readonly app: string;
  /**
   * Tenancy boundary. One deployment is one tenant; scopes inside it separate
   * tasks and domains. Retrieval never crosses this string.
   */
  readonly namespace: string;
  readonly store: MemoryPort;
  readonly policy?: Partial<Policy>;
  readonly clock?: Clock;
  readonly random?: RandomSource;
  /** Domain pack. Defaults to the rule-based fallback. */
  readonly interpreter?: Interpreter;
  /** Character budget for `recall`; defaults to `policy.defaultBudget`. */
  readonly budget?: number;
  /** Element name used by the renderer; defaults to `microglia-knowledge`. */
  readonly tag?: string;
  /** Apply feedback to the knowledge that was in the run's prompt. Default true. */
  readonly credit?: boolean;
  /**
   * Domain-supplied semantic distance for an edit, in [0, 1], or `undefined` to
   * fall back to the structural distance. A chart-type change is one field of
   * four but a different chart, and only the domain pack knows that.
   */
  readonly editSemantics?: (before: Json, after: Json) => number | undefined;
};

export type RunStart = {
  readonly task: string;
  readonly input: JsonObject;
  readonly sessionId?: string;
  /** Set by `openTask().begin()`; absent for a host that never opens a task. */
  readonly taskId?: string;
  /** 1-based attempt number within the task. */
  readonly attempt?: number;
  /** The attempt this one revises. */
  readonly parentRunId?: string;
  /** The pack that was (or will be) injected; its ids become the run's provenance. */
  readonly pack?: KnowledgePack;
  readonly model?: string;
  readonly promptVersion?: string;
  readonly appVersion?: string;
  readonly domainPack?: string;
  readonly schemaDigest?: string;
  readonly metadata?: JsonObject;
};

export type TaskOpen = {
  readonly taskId: string;
  /** The workflow step, in the host's vocabulary. */
  readonly taskType: string;
  readonly sessionId?: string;
};

export type TaskDecision = {
  readonly status: 'accepted' | 'abandoned' | 'escalated';
  /** Defaults to the last committed attempt. */
  readonly finalRunId?: string;
  readonly reasonCode?: string;
};

export type FeedbackInput =
  | { readonly type: 'rating'; readonly value: RatingValue; readonly reasons?: readonly string[]; readonly comment?: string }
  | { readonly type: 'edit'; readonly after: Json; readonly note?: string }
  | { readonly type: 'preference'; readonly chosenRunId: string; readonly rejectedRunId: string; readonly criterion?: string }
  | { readonly type: 'outcome'; readonly ok: boolean; readonly code?: string; readonly detail?: string }
  | { readonly type: 'clarification'; readonly question: string; readonly answer: string }
  | { readonly type: 'abstain'; readonly reason: string };

export type FeedbackOptions = {
  readonly actor?: Actor;
  /** Override the event time; defaults to the injected clock. */
  readonly at?: number;
  /**
   * A ceiling the host asserts on how much this observation may count.
   *
   * The host knows where the feedback came from; the library only knows what
   * shape it has. A value below `Policy.quarantineBelowTrust` routes the
   * resulting knowledge to quarantine, which is how untrusted input is kept
   * out of prompts without dropping the evidence on the floor.
   */
  readonly trustCeiling?: number;
};

export type ExportFormat = 'sft' | 'dpo' | 'kto' | 'eval';

export type DatasetRow = {
  readonly id: string;
  readonly task: string;
  /** Present for SFT/DPO/KTO; absent for eval rows, which use `input`. */
  readonly prompt?: Json;
  readonly [key: string]: Json | undefined;
};

export type DiagnosisIssue = {
  readonly code:
    | 'MG_D_ORPHAN_EVIDENCE'
    | 'MG_D_ACTIVE_WITHOUT_SUPPORT'
    | 'MG_D_ACTIVE_BELOW_THRESHOLD'
    | 'MG_D_NO_KNOWLEDGE'
    | 'MG_D_HIGH_QUARANTINE'
    | 'MG_D_CONFLICTED'
    | 'MG_D_AWAITING_CORROBORATION';
  readonly severity: 'info' | 'warn' | 'error';
  readonly detail: string;
  readonly ids?: readonly string[];
};

export type Diagnosis = {
  readonly ok: boolean;
  readonly issues: readonly DiagnosisIssue[];
  readonly stats: { readonly events: number; readonly runs: number; readonly knowledge: number; readonly active: number };
};
