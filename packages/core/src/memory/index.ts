/**
 * `@agentix-e/microglia-memory` — embedded storage and retrieval.
 *
 * The default is a directory of JSONL files plus an in-process index. No native
 * dependency, no service, and no migration: a host can inspect the store with
 * `tail`. Larger deployments swap the journal, not the API.
 */
export type {
  EventFilter,
  KnowledgeFilter,
  MemoryPort,
  MemoryStats,
  SearchHit,
} from './port.js';

export {
  MemoryJournal,
  JsonlJournal,
  ensureParent,
  journalPath,
  type Journal,
  type JournalSnapshot,
  type JsonlJournalOptions,
} from './journal.js';

export { LexicalIndex } from './lexical-index.js';
export { EmbeddedMemory, rehydrateKnowledge } from './store.js';
