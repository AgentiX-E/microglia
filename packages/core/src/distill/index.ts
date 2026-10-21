/**
 * `@agentix-e/microglia-distill` — feedback to knowledge.
 *
 * Exports the domain-blind pipeline plus the two interpreters that ship: the
 * rule fallback and the optional model-backed one.
 */
export type {
  Clock,
  DistillCandidate,
  DistillOptions,
  DistillReport,
  FeedbackEvent,
  InterpretContext,
  Interpreter,
  KnowledgeItem,
  MemoryPort,
  Policy,
  RandomSource,
  RunRecord,
} from './types.js';

export { distill } from './distiller.js';
export { combineInterpreters, ruleBasedCandidates, ruleInterpreter } from './rules.js';
export {
  canGeneralize,
  generalizedScope,
  payloadsEqual,
  pickGeneralizationTarget,
  withoutDomain,
} from './generalize.js';
export {
  buildDistillPrompt,
  createLlmInterpreter,
  parseDistillResponse,
  type LlmInterpreterOptions,
  type LlmPort,
} from './llm.js';
