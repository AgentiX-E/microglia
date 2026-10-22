/**
 * The memory port.
 *
 * This interface is the only thing `capture`, `distill` and `apply` know about
 * storage. Cortex, SQLite, a remote service, or a JSONL directory are all
 * interchangeable behind it — which is what lets the product ship without
 * choosing a vendor for the host.
 */
import type {
  ErasureReport,
  ErasureSelector,
  FeedbackEvent,
  KnowledgeItem,
  KnowledgeStatus,
  Policy,
  RecallQuery,
  RunRecord,
} from '../kernel/index.js';

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

  /**
   * Erase the records a selector covers, and re-derive what cited them.
   *
   * Required rather than optional: a store that cannot delete is not shippable
   * to a host with deletion obligations, and an optional method is a promise the
   * default implementation keeps and a replacement quietly drops. The policy is a
   * parameter because re-scoring a claim whose evidence was erased is an
   * admission decision, and the store does not own one.
   */
  forget(selector: ErasureSelector, policy: Policy, at: number): Promise<ErasureReport>;

  stats(): Promise<MemoryStats>;
  close(): Promise<void>;
}
