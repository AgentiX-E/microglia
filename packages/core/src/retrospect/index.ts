/**
 * Retrospection: turning corrections into reviewed guidelines.
 *
 * The public surface is four steps, and each is separately testable because each answers a
 * different question:
 *
 *   sourcesOf(items)            what in the store is a correction, and what is only a success
 *   clusterSources(sources)     which corrections are about the same situation
 *   admissibilityOf(proposal)   whether a proposal covers what it claims, and what else it hits
 *   applyDecision(batch, …)     what a human decided, recorded so the human is a variable too
 *
 * `toDistillCandidate` is the exit: an accepted guideline re-enters the store through the
 * write path a distilled correction takes, so retrospection is a derivation rather than a
 * second, privileged way to write knowledge.
 */
export {
  DEFAULT_CLUSTER_OPTIONS,
  clusterSources,
  deterministicProposal,
  seedTriggerOf,
  sourcesOf,
  type ClusterOptions,
  type RetrospectCluster,
  type SourcesOptions,
} from './cluster.js';
export {
  applyDecision,
  applyDecisions,
  buildBatch,
  summaryOf,
  toDistillCandidate,
  type ReviewAction,
  type ReviewBatch,
  type ReviewDecision,
  type ReviewItem,
  type ReviewState,
  type ReviewSummary,
} from './ledger.js';
export {
  DEFAULT_RETROSPECT_POLICY,
  admissibilityOf,
  contentWords,
  isNegated,
  verdictOf,
  witnessOf,
  type AdmissibilityReport,
  type RetrospectPolicy,
} from './witness.js';
export type {
  Admissibility,
  CollateralFinding,
  GuidelineProposal,
  RetrospectSource,
  WitnessFinding,
  WitnessReport,
  WitnessVerdict,
} from './types.js';
