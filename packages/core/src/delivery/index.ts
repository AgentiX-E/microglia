/**
 * `@agentix-e/microglia-core/delivery` — push, as a contract rather than a feature.
 *
 * A host that wants to know when knowledge changed can poll `GET /v1/knowledge` or
 * subscribe. This module is the subscription half: what changed (events), how it
 * is proven (HMAC over the posted bytes), and what happens when the receiver is
 * down (retry, then a resync the host owns).
 *
 * It ships separately from the facade because a host that never pushes should not
 * pay for it: exporting it from the root would put the signer in every bundle,
 * and the browser entry point exists to stay small.
 */
export {
  knowledgeEvents,
  snapshotOf,
  taskCompleted,
  type DeliveryEvent,
  type DeliveryItem,
  type DeliveryType,
  type DraftEvent,
  type KnowledgeSnapshot,
} from './events.js';
export {
  SIGNATURE_HEADER,
  WebhookDispatcher,
  eventId,
  type DeliveryAttempt,
  type DeliveryResult,
  type DeliveryTarget,
  type DispatcherOptions,
  type FetchLike,
  type HttpResponseLike,
} from './dispatcher.js';
export { hmacSha256Hex, sha256Hex } from './sha256.js';
