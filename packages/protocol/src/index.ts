/**
 * `@agentix-e/microglia-protocol` — the measurement apparatus, independent of what is measured.
 *
 * The library (`core`) is the product. This package is the instrument that decides whether a claim
 * about the product may be published at all, and it is separate because the two have different
 * customers: a host embeds `core`, while a **scenario lane** embeds this.
 *
 *   import { buildProtocolGates, GATE_ORDER, inGateOrder } from '@agentix-e/microglia-protocol';
 *   import type { LaneAdapter } from '@agentix-e/microglia-protocol/adapter';
 *
 * ## What it holds
 *
 *  - **31 validity gates**, of which 29 depend on nothing scenario-specific and 2 take an optional
 *    scenario field and are then absent rather than green;
 *  - the **publication order** of those gates, as data, because a committed artefact's gate sequence
 *    is compared against its pre-registration and re-rendered byte for byte on every push;
 *  - the **`LaneAdapter` contract** — five methods — which is how a second scenario is measured by the
 *    same apparatus instead of writing a weaker one beside itself.
 *
 * ## What it deliberately does not hold
 *
 * Execution, parsing, scoring, and every type named after a scenario. Those live in the adapter, so
 * that "this protocol is scenario-agnostic" is a fact about the imports rather than an intention:
 * this package has no runtime dependency and cannot name a scenario even if someone wanted it to.
 */
export {
  buildProtocolGates,
  inGateOrder,
  GATE_ORDER,
  SUBSTRATE_FLOOR,
  transferGates,
  type EvidenceDelivery,
  type FramingDelivery,
  type ProtocolGateInput,
  type ScenarioGateInput,
  type TransferGateInput,
  type ValidityGate,
} from './gates.js';

export {
  blockingFailure,
  mergeGates,
  type LaneAdapter,
  type ScenarioGate,
} from './adapter.js';
