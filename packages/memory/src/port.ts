/**
 * The memory port.
 *
 * This interface is the only thing `capture`, `distill` and `apply` know about
 * storage. Cortex, SQLite, a remote service, or a JSONL directory are all
 * interchangeable behind it — which is what lets the product ship without
 * choosing a vendor for the host.
 */
import type {
  FeedbackEvent,
  KnowledgeItem,
  KnowledgeStatus,
  RecallQuery,
  RunRecord,
} from '@agentix-e/microglia-core';

export type EventFilter = {
  readonly namespace?: string;
  readonly runId?: string;
  readonly sessionId?: string;
  readonly since?: number;
  readonly limit?: number;
};

export type KnowledgeFilter = {
  readonly namespace?: string;
  readonly task?: string;
  readonly status?: KnowledgeStatus | 'all';
  readonly limit?: number;
};

export type SearchHit = {
  readonly item: KnowledgeItem;
  readonly score: number;
  readonly lexical: number;
};

export type MemoryStats = {
  readonly events: number;
  readonly runs: number;
  readonly knowledge: number;
  readonly active: number;
};

export interface MemoryPort {
  appendEvent(event: FeedbackEvent): Promise<void>;
  getEvent(id: string): Promise<FeedbackEvent | undefined>;
  listEvents(filter?: EventFilter): Promise<readonly FeedbackEvent[]>;

  putRun(run: RunRecord): Promise<void>;
  getRun(id: string): Promise<RunRecord | undefined>;

  putKnowledge(item: KnowledgeItem): Promise<void>;
  getKnowledge(id: string): Promise<KnowledgeItem | undefined>;
  listKnowledge(filter?: KnowledgeFilter): Promise<readonly KnowledgeItem[]>;

  /** Active knowledge only, namespace-scoped, ranked, and scope-filtered. */
  search(query: RecallQuery, now?: number): Promise<readonly SearchHit[]>;

  stats(): Promise<MemoryStats>;
  close(): Promise<void>;
}
