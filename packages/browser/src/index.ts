/**
 * `@agentix-e/microglia-browser` — the client half of the library.
 *
 * It carries no store and no model call: a browser holds neither credentials nor a
 * durable journal. What it does carry is the outbox, because the correction a user
 * just typed is the one thing worth not losing.
 */
export { createClient, MicrogliaClient, type ClientOptions, type RecallResult, type SendResult } from './client.js';
export {
  memoryOutbox,
  persistedOutbox,
  type FeedbackPayload,
  type Outbox,
  type OutboxEntry,
  type StorageLike,
} from './outbox.js';
