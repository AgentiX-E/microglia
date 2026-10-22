/**
 * `@agentix-e/microglia-eval` — measurement, not marketing.
 *
 * The package contains the paired statistics, the controlled workload, the
 * ablation runner, and the gate definitions. A release that cannot reproduce
 * these numbers from source has no business quoting them.
 */
export { comparePaired, type PairedResult } from './stats.js';
export { recoveryRatio, type RecoveryInput } from './recovery.js';
export {
  compareToPublished,
  l4Verdict,
  meanPassAtK,
  passAtK,
  type L4Verdict,
  type PassAtKInput,
} from './passk.js';
export {
  pairVerdict,
  reachableRecovery,
  reachableShare,
  scopePair,
  type PairVerdict,
  type Scoped,
} from './pairs.js';
export {
  CONVENTIONS,
  HELD_OUT,
  buildConventions,
  holdoutCases,
  trainingSplit,
  unreachableCases,
  type ConventionCase,
  type ConventionSplit,
} from './conventions.js';

export {
  L2B_BAR,
  baselineCorrect,
  buildL2bGates,
  citedCorrections,
  correctionFor,
  featuresFor,
  predictAll,
  runL2b,
  runPairArm,
  shareOf,
  teachCase,
  type ArmReport,
  type L2bArm,
  type L2bGate,
  type L2bReport,
  type TeachingOutcome,
  type WallCase,
} from './lanes/pairs.js';

export {
  attributeRules,
  type AttributionCase,
  type AttributionItem,
  type AttributionSummary,
  type RuleAttribution,
} from './attribution.js';

export {
  assignFolds,
  detectableDelta,
  discordanceOf,
  interleaveByKey,
} from './protocol.js';

export {
  DOMAINS,
  INTENTS,
  applyKnowledge,
  baselineMark,
  buildCorpus,
  goldMark,
  queryFeatures,
  questionText,
  specFor,
  type CorpusItem,
  type Query,
} from './scenario.js';

export {
  ARMS,
  DEFAULT_CONFIG,
  L0_CASES,
  L0_CONFIG,
  TASK,
  buildBatches,
  buildGates,
  evaluateHoldout,
  knowledgePrecision,
  measureLeakage,
  scoreByDomain,
  runArm,
  runStudy,
  type ArmConfig,
  type ArmName,
  type ArmResult,
  type CompetitorResult,
  type Competitors,
  type DomainScore,
  type Gate,
  type RoundMetrics,
  type StudyConfig,
  type StudyResult,
} from './study.js';

export { FactStore, runFactStore, type Fact, type FactStoreOptions, type FactStoreResult } from './competitor.js';

export { renderJson, renderMarkdown, summarise } from './report.js';

export {
  ATTACK_ROUTES,
  MEMFORM_ARMS,
  TRUST_LEVELS,
  policyFor,
  runMemform,
  type AttackOutcome,
  type AttackRoute,
  type MemformArm,
  type MemformOptions,
  type MemformReport,
  type RouteScore,
} from './memform.js';

export {
  replayStore,
  reverseOrderView,
  runIntegrity,
  shuffle,
  stateOf,
  type IntegrityCase,
  type IntegrityReport,
  type Replay,
} from './integrity.js';
