/**
 * `@agentix-e/microglia-core` — contracts and pure algorithms.
 *
 * No I/O, no clock reads, no provider SDKs. Everything here can run in Node, a
 * browser, a worker, or a test with a pinned clock. That constraint is what
 * makes the rest of the monorepo testable without mocks.
 */

export type {
  Actor,
  ActorType,
  CorrectionOp,
  DistillCandidate,
  EvidenceRef,
  FeedbackEvent,
  FeedbackKind,
  FeedbackSignal,
  Json,
  JsonObject,
  JsonPath,
  KnowledgeItem,
  KnowledgeKind,
  KnowledgePack,
  KnowledgeScope,
  KnowledgeStatus,
  Policy,
  RatingValue,
  RecallQuery,
  RunProvenance,
  RunRecord,
  TaskRecord,
  TaskStatus,
  SignalStrength,
} from './types.js';

export { MicrogliaError, isMicrogliaError, type MicrogliaErrorCode } from './errors.js';

export {
  contentKey,
  mulberry32,
  newId,
  type RandomSource,
} from './ids.js';

export { fixedClock, steppingClock, systemClock, type Clock } from './clock.js';

export { canonicalize, hashJson, hashText, jsonEqual } from './hash.js';

export {
  applyOps,
  countLeaves,
  diffJson,
  editDistance,
  opCount,
} from './diff.js';

export {
  bm25Score,
  diceSimilarity,
  jaccardSimilarity,
  mmrSelect,
  queryCoverage,
  tokenize,
} from './similarity.js';

export {
  bootstrapCI,
  clamp01,
  logBinomialPmf,
  logGamma,
  logit,
  mcnemarExact,
  mean,
  sigmoid,
  smoothedRate,
  stddev,
  variance,
  wilsonLower,
  type Interval,
} from './stats.js';

export {
  hasHighSeverity,
  redact,
  redactJson,
  scanForInjection,
  type GuardFinding,
  type RedactionResult,
} from './guard.js';

export { defaultPolicy, resolvePolicy } from './policy.js';

export {
  applyOutcome,
  createKnowledgeItem,
  decideStatus,
  dedupeKeyOf,
  expireKnowledge,
  isInlinePayload,
  mergeEvidence,
  recordContradiction,
  reinstate,
  scopeKey,
  scopeMatches,
  scoreKnowledge,
  specificity,
  statementIdentity,
  validityDecay,
  type AdmissionDecision,
} from './knowledge.js';
