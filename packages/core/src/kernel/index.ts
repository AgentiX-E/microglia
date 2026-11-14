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
  ErasureReport,
  ErasureSelector,
  ErasureTombstone,
  EvidenceRef,
  FeedbackEvent,
  FeedbackKind,
  FeedbackSignal,
  FoldSupport,
  FoldedGroup,
  Json,
  JsonObject,
  JsonPath,
  KnowledgeItem,
  KnowledgeKind,
  KnowledgePack,
  KnowledgePolarity,
  KnowledgeScope,
  KnowledgeStatus,
  Policy,
  RatingValue,
  RecallQuery,
  RunProvenance,
  RunRecord,
  ProvenanceTier,
  ShapeFold,
  ShapeMode,
  TaskRecord,
  TaskStatus,
  Utility,
  SignalStrength,
} from './types.js';

export { MicrogliaError, isMicrogliaError, type MicrogliaErrorCode } from './errors.js';

/**
 * The wire's field list, beside the type it reflects.
 *
 * Moved here from the HTTP package in R109: the driver that grades the shape arm builds its own facade
 * and has to parse the same knobs, and a second copy of the list is the defect this file exists to
 * prevent. A seventh knob added to `RecallQuery` arrives as a compile error one directory from the type
 * rather than one package away.
 */
export {
  recallQueryOf,
  type RecallFixed,
  type RecallParsed,
} from './recall-query.js';

/** Value, not a type: the ordering the promotion gate compares tiers with. */
export { TIER_RANK } from './types.js';
/** Value, not a type: the two names a `shape` knob may carry, in the order a table lists them. */
export { SHAPE_MODES } from './types.js';
export { tierFor } from './provenance.js';
/** Value, not a type: the side an event's signal sits on, derived from the signal rather than the kind. */
export { polarityFor } from './provenance.js';

export {
  contentKey,
  mulberry32,
  newId,
  type RandomSource,
} from './ids.js';

export { fixedClock, steppingClock, systemClock, type Clock } from './clock.js';

export { canonicalize, hashJson, hashText, jsonEqual } from './hash.js';

export { withoutEvidence } from './knowledge.js';

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
  recallText,
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

export { present } from './present.js';

export {
  WRITE_ADMISSION_THRESHOLD,
  WRITE_ADMISSION_TOP_S,
  admitWrite,
  neighbourhood,
  type WriteAdmissionOptions,
  type WriteDecision,
  type WriteNeighbour,
} from './write-admission.js';

export {
  applyOutcome,
  corroborationShare,
  createKnowledgeItem,
  observationsOf,
  decideStatus,
  dedupeKeyOf,
  countDistinctTasks,
  distinctTasks,
  expireKnowledge,
  isInlinePayload,
  mergeEvidence,
  isEventKind,
  recordContradiction,
  reinstate,
  scopeKey,
  scopeMatches,
  scoreKnowledge,
  specificity,
  statementIdentity,
  wouldChange,
  validityDecay,
  visibleBefore,
  type AdmissionDecision,
} from './knowledge.js';
