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
  BirdDataError,
  archiveVerdict,
  dedupeQuestions,
  missingDatabases,
  parseManifest,
  populationOf,
  requirePopulated,
  sha256OfFile,
  type BirdDataErrorReason,
  type BirdManifest,
  type Deduped,
  type QuestionIdentity,
} from './bird-data.js';

export {
  DELIVERY_BOUND_MS,
  TASK_TYPES,
  countOrderingViolations,
  percentile,
  runDeliveryLane,
  startReceiver,
  type DeliveryMetrics,
  type DeliveryReport,
  type ReceiverBox,
} from './lanes/delivery.js';

export {
  L4ParseError,
  compareArms,
  parseTauResults,
  perTaskRows,
  resolutionOf,
  taskTrials,
  toPassAtK,
  type ArmComparison,
  type ArmTask,
  type L4ParseReason,
  type Resolution,
  type TauRun,
  type TauTrial,
  type TaskTrials,
} from './l4.js';

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
  REVISIONS,
  buildConventions,
  holdoutCases,
  revisionCases,
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
  diffRuleStates,
  correctionFor,
  featuresFor,
  laneSetup,
  predictAll,
  runL2b,
  runPairArm,
  ruleStates,
  shareOf,
  staleActive,
  teachCase,
  teachingSchedule,
  type ArmReport,
  type LaneSetup,
  type L2bArm,
  type L2bGate,
  type L2bReport,
  type RoundReport,
  type RuleDiff,
  type RuleState,
  type TeachingOutcome,
  type TeachingRound,
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
  CircuitBreaker,
  backoffMs,
  mapPool,
} from './concurrency.js';

export { LlmClient, type ChatReply, type LlmClientOptions, type LlmStats } from './model-client.js';

export {
  conditionText,
  creditedWith,
  embeddingText,
  pairsOf,
  separationOf,
  type CaseRecord,
  type Credited,
  type Separation,
  type SimilarityPair,
} from './embed-probe.js';

export {
  HOUSE_CONVENTIONS,
  OPTIONAL_ARMS,
  PROMPT_VERSION,
  GenerationCache,
  armPairsAgainstFull,
  buildValidityGates,
  canonicalRows,
  type ResultComparison,
  conventionOf,
  extractSql,
  judgeScalar,
  matches,
  parseArms,
  anchorPromptFor,
  promptFor,
  reportedSql,
  type ArmPair,
  type ArmRow,
  type ConventionName,
  type ConventionSpec,
  type GateInput,
  type PromptInput,
  type SqlArm,
  type ValidityGate,
} from './sota.js';

export {
  actionSentence,
  taskCorrection,
  driverArgs,
  learnableCorrections,
  parseTauTasks,
  splitTaskIds,
  type Correction,
  type DriverCommand,
  type TauAction,
  type TauTask,
} from './tau2.js';

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
  harnessInterpreter,
  judge,
  markOf,
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

export {
  agreementReport,
  cohenKappa,
  confusionOf,
  mccOf,
  raterAgreement,
  type AgreementReport,
  type Confusion,
  type JudgedPair,
  type PairwiseAgreement,
  type RaterAgreement,
  type RaterLabels,
} from './agreement.js';

export {
  RoseVecError,
  consensusOf,
  judgedPairs,
  labelDisputes,
  parseRater,
  parseRoseVec,
  rowsEqual,
  type RoseVecErrorReason,
  type RoseVecRow,
} from './rose-vec.js';

export {
  JUDGE_PROMPT_VERSION,
  REFUTER_PROMPT_VERSION,
  buildJudgePrompt,
  buildRefuterPrompt,
  cascadeVerdict,
  evidencedVerdict,
  parseRefuterReply,
  judgePairs,
  parseJudgeReply,
  sampleRows,
  type JudgeInput,
  type JudgeVerdict,
  type RefuterDiagnosis,
  type RefuterInput,
  type RefuterVerdict,
} from './judge.js';

export { executeQuery, resolveDatabase, rowsDiffer, type ExecuteOptions, type QueryOutcome } from './sql-exec.js';

export {
  DEFAULT_DECISIVE,
  DEFAULT_RETIREMENT,
  creditHistogram,
  decisiveHistogram,
  parseDecisivePolicy,
  outcomeCredit,
  retireeFromDecisive,
  type DecisiveCredit,
  type DecisivePolicy,
  type OutcomeCredit,
  parseRetirementPolicy,
  retireeFrom,
  type RetirementPolicy,
  type ValidationCredit,
} from './validation.js';
