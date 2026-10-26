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
  WIDENING_TASKS,
  canGeneralize,
  endorsingTasks,
  generalizationPlan,
  generalizedScope,
  payloadsEqual,
  pickGeneralizationTarget,
  widenedScopeOf,
  withoutDomain,
  type GeneralizationPlan,
} from './generalize.js';
export {
  buildDistillPrompt,
  createLlmInterpreter,
  parseDistillResponse,
  type DistillForm,
  type LlmInterpreterOptions,
  type LlmPort,
} from './llm.js';
