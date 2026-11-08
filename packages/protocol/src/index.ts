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
 *  - **39 validity gates**, of which 8 are scenario-bound (`V4`, `V10` take an optional scenario
 *    field; the eight transfer ids arrive as arguments) and 31 are always present;
 *  - the **publication order** of those gates, as data, because a committed artefact's gate sequence
 *    is compared against its pre-registration and re-rendered byte for byte on every push;
 *  - the **`LaneAdapter` contract** — five methods — which is how a second scenario is measured by the
 *    same apparatus instead of writing a weaker one beside itself.
 *
 * ## What the second scenario changed
 *
 * Stage 1 measured portability by asking each gate's signature whether it names a scenario type, and
 * got 37 of 39. Stage 2 ran a second scenario through the apparatus and found that the question was
 * about the wrong noun: **a gate is evaluable when the lane ran the arm whose bookkeeping it reads**,
 * and that is a property of the arm inventory, not of the type. `V45-clearance-dose-matched` names no
 * scenario type and is unreachable for a lane that ran no clearance arm. The apparatus is
 * scenario-agnostic — τ² is measured by it with zero edits — and the gate *set* is a catalogue of
 * conditions, of which each lane instantiates the subset its arms can support.
 *
 * The same run found the input type's other defect: eight fields were mandatory, two of them
 * knowable only to a lane whose model runs in-process, so a lane that could prove four gates could
 * not call this function at all. Every one of those eight is now optional, and a gate whose field is
 * missing is absent rather than green — the rule this package already applied to its scenario half.
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
  POWER_TARGET_PP,
  SUBSTRATE_FLOOR,
  transferGates,
  type EvidenceDelivery,
  type FramingDelivery,
  type FunnelInput,
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
