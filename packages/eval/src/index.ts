/**
 * `@agentix-e/microglia-eval` — measurement, not marketing.
 *
 * The package contains the paired statistics, the controlled workload, the
 * ablation runner, and the gate definitions. A release that cannot reproduce
 * these numbers from source has no business quoting them.
 */
export { clusterBootstrapCI, comparePaired, type PairedResult } from './stats.js';
export {
  forecastBudget,
  type BudgetForecast,
  type BudgetLedger,
  type FoldSpend,
} from './call-budget.js';
export {
  DISTILL_REPAIR_TOKENS,
  DISTILL_TOKENS,
  THINKING_HEADROOM,
  answerBudget,
  distillBudget,
  type ThinkingMode,
} from './decoding.js';
export {
  DEFAULT_MODEL_HOST,
  hostOf,
  planCredential,
  type CredentialInput,
  type CredentialPlan,
  type CredentialSource,
} from './credential.js';
export {
  RETRY_POPULATION_FLOOR,
  RETRY_REASONS,
  retryTriggerFor,
  retryTriggerOf,
  summariseRetryPopulation,
  type RetryEvidence,
  type RetryPopulation,
  type RetryPopulationRow,
  type RetryReason,
  type RetryTrigger,
} from './retry-trigger.js';
export {
  classifyEmptyAttempt,
  summariseEmptyAttempts,
  type EmptyAttempt,
  type EmptyCause,
  type EmptySummary,
} from './empty-result.js';
export {
  VALUE_BLOCK_BUDGET,
  VALUE_FLOOR,
  VALUE_NEAREST,
  editDistance,
  nearestValues,
  sqlLiterals,
  summariseValues,
  valueCorrections,
  valueGate,
  type ColumnValues,
  type ValueCorrection,
  type ValueCorrectionInput,
  type ValueCorrectionOptions,
  type ValueRow,
  type ValueSummary,
} from './value-correction.js';
export {
  EXEMPLAR_FLOOR,
  exemplarGate,
  exemplarIndexOf,
  nearestExemplars,
  renderExemplars,
  summariseExemplars,
  type ExemplarRow,
  type ExemplarPool,
  type ExemplarSummary,
  type RenderedExemplars,
} from './exemplars.js';

export {
  anchorTables,
  annotateSchema,
  linkSchema,
  orderSchema,
  questionTokens,
  schemaBlocks,
  type AnnotatedSchema,
  type LinkedSchema,
  type OrderSource,
  type OrderedSchema,
  type SchemaAnchors,
  type SchemaBlock,
} from '@agentix-e/microglia-sql';
export {
  assertionPrompt,
  choicePrompt,
  choicePromptWithResults,
  parseChoice,
  renderRows,
  selectByConsistency,
  selectByModel,
  selectFirst,
  selectRandom,
  selectionStats,
  signatureOf,
  type Candidate,
  type CandidateWithResult,
  type Selection,
  type SelectionReason,
  type SelectionStats,
} from './selector.js';

export {
  ASSERTION_KINDS,
  ASSERTION_SIGNALS,
  MAX_ASSERTIONS_PER_KIND,
  NO_ASSERTIONS,
  assertAnything,
  assertionHitsOf,
  assertionPopulation,
  assertionReadings,
  assertionScoreOf,
  assertionSignalOf,
  parseAssertions,
  selectByAssertions,
  type AssertedQuestion,
  type AssertionKind,
  type AssertionSignalName,
  type Assertions,
} from './assertion.js';
export { recoveryRatio, type RecoveryInput } from './recovery.js';
export {
  TRANSFER_FLOOR,
  admissionOf,
  keptItemIds,
  probeSummary,
  shuffledSource,
  transferSummary,
  transferTargets,
  transferringItemIds,
  transferLedgerOf,
  verdictOf,
  type Admission,
  type LedgerFold,
  type PackCell,
  type ProbedItem,
  type ProbeSummary,
  type ProbeTrial,
  type ProbeVerdict,
  type TransferSummary,
  type TransferTrial,
  type TransferVerdict,
} from './rule-probe.js';
export {
  SUBSTRATE_FLOOR,
  compareSubstrates,
  poolSubstrates,
  reproducedBy,
  type CompareOptions,
  type PooledSubstrate,
  type SubstrateComparison,
  type SubstrateVerdict,
} from './probe-pair.js';
export {
  collectMschema,
  renderMschema,
  type CollectOptions,
  type MschemaColumn,
  type MschemaForeignKey,
  type MschemaTable,
  type RenderOptions,
} from '@agentix-e/microglia-sql';
export {
  unionCeiling,
  type UnionCase,
  type UnionCeiling,
  type UnionDistinct,
} from './union.js';
export {
  discriminationOf,
  ruleLedger,
  storeReport,
  type Discrimination,
  type InjectedCase,
  type RuleLedgerEntry,
  type StoreRun,
  type StoreTotals,
} from './store-report.js';
export {
  drawsOf,
  poolFromArtifact,
  type ArtifactPool,
  type ArtifactPoolCandidate,
  type ArtifactPoolCase,
} from './artifact-pool.js';
export { artefactArgument, noArguments } from './artefact-arg.js';
export { PROVIDER_ALIASES, splitProvider } from './model-id.js';
export {
  consolidatedMemoryOf,
  type ConsolidatedMemory,
  type MemoryShape,
} from './consolidated.js';
export {
  catalogueIdsOf,
  catalogueLine,
  catalogueNoteOf,
  catalogueVerdictOf,
  modelsUrlOf,
  probeBackbone,
  type CatalogueNote,
  type CatalogueReading,
  type CatalogueVerdict,
  type ProbeInput,
} from './backbone.js';
export {
  poolReport,
  type PoolReport,
  type PoolReportQuestion,
  type PoolVerdict,
} from './pool-report.js';
export {
  PRIOR_SCOPES,
  keyOf,
  priorPicks,
  priorReading,
  priorTable,
  type PriorCandidate,
  type PriorCase,
  type PriorPick,
  type PriorReading,
  type PriorScope,
} from './memory-prior.js';
export {
  poolSummary,
  signalReading,
  signalReadings,
  outcomesOf,
  type PoolCandidate,
  type PoolQuestion,
  type PoolSignalReading,
  type PoolSummary,
  type SignalChoice,
} from './pool.js';
export {
  ALPHA,
  SHAPE_VOTERS,
  VALUE_VOTERS,
  Z_BAR,
  compositeGate,
  compositePicks,
  gateOf,
  holmAdjust,
  normalUpper,
  readComposite,
  readSubsets,
  seOf,
  selectByShape,
  type CompositeReading,
  type CompositeVerdict,
  type SignalVerdict,
  type SubsetReading,
} from './signal-gate.js';
export {
  FAILED_SIGNATURE,
  SIGNALS,
  scoreOf,
  shapeOf,
  execSignatureOf,
  type ExecOutcome,
  type QuestionShape,
  type ExecSignature,
  type SignalName,
} from './exec-signature.js';
export {
  renderValue,
  schemaWithValues,
  type TableValues,
  type ValueSample,
} from '@agentix-e/microglia-sql';
export {
  ARTEFACT_IDS,
  DEV_SPLIT_NAME,
  MINIDEV_SPLIT_NAME,
  artefactIdOf,
  artefactPathOf,
  artefactWriteIdOf,
  chooseArtefact,
  preregIdOf,
  splitNameOf,
  splitOfName,
  type ArtefactChoice,
} from './artefacts.js';

export {
  VOLATILE_KEYS,
  splitClaim,
  volatileKeysIn,
  type ClaimSplit,
  type VolatilePath,
} from './claim.js';

export {
  BirdDataError,
  archiveVerdict,
  dedupeQuestions,
  missingDatabases,
  unreachableDatabases,
  parseManifest,
  poolOf,
  populationOf,
  requirePopulated,
  sha256OfFile,
  isSimple,
  SPLITS,
  splitFrom,
  withinDatabases,
  type BirdDataErrorReason,
  type BirdManifest,
  type Split,
  type Deduped,
  type QuestionIdentity,
} from './bird-data.js';

export {
  compareGold,
  normaliseRow,
  parseGoldLines,
  parseRows,
  questionsDigest,
  type BirdRow,
  type GoldAgreement,
} from './bird-rows.js';

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
  ceilingOf,
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
  type ResolutionCeiling,
  type TauRun,
  type TauTrial,
  type TaskTrials,
} from './l4.js';

export {
  compareToPublished,
  l4Verdict,
  holdRate,
  meanPassAtK,
  passAtK,
  type L4Verdict,
  type HoldInput,
  type HoldRate,
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

export {
  LlmClient,
  attemptTimeoutMs,
  restModelOf,
  retryAfterMs,
  type ChatReply,
  type LlmClientOptions,
  type LlmStats,
} from './model-client.js';

/**
 * The rate card, and the arithmetic that turns tokens into a bill.
 *
 * Exported because every lane that spends money prints one of these lines, and a lane that
 * assembled its own would be a second implementation of a number that appears in a report.
 */
export {
  EMPTY_BANDED,
  EMPTY_USAGE,
  RATE_CARD,
  addToBand,
  addUsage,
  bandOf,
  bandsUsed,
  billOf,
  cacheHitRate,
  costOf,
  bandsFor,
  isPeak,
  nextOffPeak,
  pricedModels,
  pricingFor,
  totalUsage,
  usageLine,
  type BandRates,
  type BandedUsage,
  type BillReading,
  type CostReading,
  type PeakWindow,
  type PricingBasis,
  type RateBand,
  type TokenUsage,
} from './cost.js';

/**
 * The schema-ordering measurement: what an ordering signal can put in front of a reader, computed
 * from gold queries rather than from model calls. It decides whether a schema arm is worth a
 * dispatch, which is the cheapest place in this repository to answer that question.
 */
export {
  TABLE_SIGNALS,
  goldIndex,
  namedBy,
  orderOf,
  readOrdering,
  recalledFor,
  recalledTables,
  summariseOrderings,
  tableRecallOf,
  type GoldNeighbours,
  type GoldRow,
  type SignalSummary,
  type TableOrdering,
  type TableQuestion,
  type TableRecall,
  type TableSignal,
} from './table-recall.js';

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

export { parseContrastArgs, type ContrastPair } from './arm-contrast.js';

export {
  HALF_WIDTH_Z,
  pairedWidths,
  powerOf,
  readPower,
  type PairedCase,
  type PairedWidths,
  type PowerRow,
  type PowerSummary,
} from './power.js';

export {
  armReadingOf,
  coverageGate,
  designFloors,
  priceGate,
  readResolution,
  reconcileGate,
  replicationsOf,
  median,
  requiredSampleSize,
  round4,
  shrinkageOf,
  type ArmReading,
  type DesignFloor,
  type PublishedArm,
  type ContrastReplication,
  type ResolutionGate,
  type ResolutionLedger,
  type Shrinkage,
  type ShrinkagePoint,
} from './resolution.js';

export {
  STRATUM_EDGES,
  byDifficulty,
  charGrams,
  characterOverlapOf,
  discordantOf,
  overlapOf,
  readStrata,
  stratify,
  type DifficultyStrata,
  type Stratum,
  type StratumCase,
  type StratumCriterion,
  type StratumReading,
} from './strata.js';

export {
  SQL_KEYWORDS,
  contextTokens,
  diffQueries,
  gateKeepsMemoryQuery,
  isGrounded,
  kindOf,
  sqlShapeOf,
  tokenizeSql,
  type DeltaKind,
  type GroundingMode,
  type QueryDelta,
  type SqlShape,
  type SqlToken,
} from '@agentix-e/microglia-sql';

export {
  diffCasesOf,
  type CommittedRun,
  type QueryCaseRecord,
} from './diff-corpus.js';

export {
  featureOverlapOf,
  type FeatureOverlap,
} from './feature-overlap.js';

export {
  bridgesOf,
  databaseShares,
  frontierGate,
  keysForShare,
  keyStats,
  keysOf,
  orderedKeys,
  reachCurve,
  reachOf,
  vocabularyKeys,
  type Bridge,
  type BridgeCase,
  type CurvePoint,
  type DatabaseShare,
  type FrontierGate,
  type KeyStat,
} from './frontier.js';

export {
  admitLexicon,
  lexiconGate,
  lexiconPackOf,
  licensedLines,
  looksLikeQuery,
  occursIn,
  questionTextOf,
  screenLexicon,
  termOf,
  termOfLine,
  type LexiconEntry,
  type LexiconPack,
  type LexiconRefusal,
  type LexiconRun,
  type LexiconVerdict,
} from './lexicon.js';

export {
  bucketOf,
  referentOf,
  referentSplitOf,
  type ReferentBucket,
  type ReferentReading,
  type ReferentStratum,
} from './referent.js';

export {
  PRECISION_BAR_TOLERANCE,
  R34_BARS,
  admissionGainOf,
  adjudicateR34,
  admitsOf,
  compareIds,
  exchangeOf,
  precisionBarOf,
  quantilesOf,
  selfKnowledgeOf,
  similarityOf,
  splitByDatabase,
  tokensOf,
  type AdmissionCase,
  type AdmissionReading,
  type ExchangeCase,
  type ExchangeReading,
  type GateId,
  type GateThreshold,
  type HalfShape,
  type R34Input,
  type R34Verdict,
} from './admission.js';

export {
  R35_BARS,
  adjudicateR35,
  dispersionOf,
  packSizeOf,
  replicationOf,
  screeningOf,
  type Dispersion,
  type LedgerCase,
  type PackSize,
  type PackSizeCell,
  type PackSizeFamily,
  type R35Input,
  type R35Verdict,
  type Replication,
  type Screening,
  type ScreeningArm,
} from './ledger.js';

export {
  armRecordFromDriver,
  storeCensus,
  type AdmissionCensus,
  type RecallTally,
  type StoreCensus,
  type Tau2Raw,
} from './tau2-instrument.js';
export { isGoldVerifiedCorrection, tau2EditSemantics } from './tau2-admission.js';
export {
  COVERAGE_FLOORS,
  coverageHistogram,
  coverageMedians,
  coverageProfile,
  useCensus,
  zeroCoverageShare,
  type CoverageFloorRow,
  type CoverageHistogram,
  type CoverageMedians,
  type CoverageProfile,
  type CoverageQuantiles,
  type UseArm,
  type UseCensus,
  type UseObservation,
} from './tau2-use-census.js';
export {
  decideFloor,
  type CostWeights,
  type FloorCostRow,
  type FloorDecision,
  type FloorTieBreak,
} from './u3-decision.js';
export {
  AS_IS_FLOOR,
  U3_COST_WEIGHTS,
  committedFloor,
  resolveRecallFloor,
} from './tau2-recall-floor.js';

export {
  storeItemSample,
  type StoreItemRecord,
  type StoreItemSample,
} from './store-items.js';

export { gateRows, renderMatrix, type GateRow } from './gate-matrix.js';

// The funnel predicate travels with the lane so the driver can stop a run on the same condition the
// gate publishes and a readback refuses on. Re-exported rather than re-implemented: three callers
// with three definitions is the defect the funnel exists to remove.
export { funnelReading, funnelVerdict, type FunnelVerdict } from '@agentix-e/microglia-protocol';

export {
  resolveDistillForm,
  guardAgainstToolNames,
  matchesToolName,
  toolInventoryOf,
  toolNameCensus,
  type ToolNameCensus,
  type ToolNameGuard,
} from './tau2-register.js';

export {
  recurrenceCensus,
  recurrenceGate,
  type RecurrenceCensus,
  type RecurrenceGate,
} from './recurrence.js';
export {
  endpointsAgree,
  pairedRateDelta,
  tasksForEffectPp,
  type EndpointAgreement,
  type RateDelta,
  type TaskRate,
} from './paired-rate.js';
export { claimsPerCorrection, yieldCensus, type CorrectionYield, type YieldCensus } from './tau2-yield.js';
export {
  DEFAULT_TRACE_CLAIMS,
  TRACE_CLAIM_RANGE,
  resolveTraceClaims,
  type TraceClaimsPlan,
} from './trace-claims.js';

export {
  TRACE_CALL_CAP,
  parseTraceCalls,
  resolveDistillUnit,
  traceOf,
  tracesOf,
  type DistillUnit,
  type TaskTrace,
  type TraceCall,
} from './tau2-trace.js';

// R62: which trajectories teach. Exported beside the unit because the two are the round's two
// switches -- one says what shape a record has, the other says which tasks produce one -- and a
// driver that could import one and not the other would decide the population by accident.
export { resolveDistillScope, type DistillScope } from './tau2-scope.js';
// R91: the store is a draw unless it is pinned. Exported as one unit -- the parser, the reward map and
// the corpus wrapper -- because a caller that took the parser alone could build a store from a list it
// never validated, which is the failure the module exists to refuse.
export {
  parseStorePin,
  pinRewards,
  pinnedLearn,
  tasksDocumentOf,
  type PinnedLearn,
  type StorePin,
} from './tau2-pin.js';
// R92: the query is the second draw. Exported as one unit for the same reason as the store pin: a
// caller that took the pin alone could replay a list it never checked against its own phase.
export {
  assertQueryPinCovers,
  parseQueryPin,
  pinnedQueryText,
  queryCensusOf,
  type QueryCensus,
  type QueryPin,
  type RecallInput,
} from './tau2-queries.js';
export {
  provenanceCensus,
  type ProvenanceCensus,
  type ProvenanceItem,
  type ProvenanceRecord,
} from './tau2-provenance.js';

export {
  INJECTION_NOTE_LEVELS,
  resolveInjectionNotePlan,
  type InjectionNotePlan,
} from './injection-note-plan.js';

export {
  WRITE_ADMISSION_MODE,
  resolveWriteAdmissionPlan,
  type WriteAdmissionMode,
  type WriteAdmissionPlan,
} from './write-admission-plan.js';
export {
  REVERT_DELTA_BAR_PP,
  REVERT_P_BAR,
  revertRule,
  type PairedReading,
  type RevertBranch,
  type RevertVerdict,
} from './l4-revert.js';
export {
  pairedVerdict,
  type PairedVerdict,
  type PairedVerdictInput,
  type PairedVerdictState,
} from './paired-verdict.js';
export {
  PAIR_RESAMPLES,
  PAIR_SEED,
  scopeDifference,
  withinRunPair,
  type FacadeArm,
  type FacadeContrast,
  type WithinRunPairVerdict,
  type RunScope,
} from './within-run-pair.js';
export {
  inactionCensusOf,
  inactionContrast,
  inactionContrastOrNull,
  inactionRate,
  inactionSummary,
  type InactionCensus,
  type InactionContrast,
  type TaskInaction,
} from './inaction.js';
export {
  FACADE_FLOOR_ENV,
  FACADE_PAIR_ENV,
  attestPairScope,
  facadeArmTasks,
  facadePairState,
  facadePairSummary,
  facadePairVerdict,
  pairedFacadeArtifact,
  readFacadePairArtifact,
  facadeScope,
  resolveFacadePairPlan,
  storeFingerprintOf,
  treatmentDelivered,
  type FacadePairPlan,
  type FacadeReading,
  type FacadeShared,
  type PairedFacadeArtifact,
  type FacadePairReadback,
  type PairedFacadeReading,
} from './facade-pair.js';
export {
  sampleGates,
  type SampleGate,
  type SampleGateInput,
} from './sample-gates.js';
export {
  pairGates,
  plantedBarNote,
  type PairGateInput,
} from './pair-gates.js';
export {
  FACADE_NOTES_ENV,
  NOTE_LEVELS,
  PRIMARY_NOTE,
  noteFacadeReading,
  noteFacadeState,
  noteFacadeSummary,
  notedFacadeArtifact,
  packIdentity,
  readNotedFacadeArtifact,
  resolveFacadeNotePlan,
  type FacadeNotePlan,
  type NoteArmReading,
  type NoteContrast,
  type NotedFacadeArtifact,
  type NotedFacadeReading,
  type NoteFacadeReadback,
  type PackIdentity,
} from './note-facade.js';
export {
  NO_MEASUREMENT_ERROR_NAME,
  PROBE_MIN_SUCCESSES,
  ProviderNoMeasurementError,
  classifyProviderProbe,
  isNoMeasurementRefusal,
  isProviderOutage,
  noMeasurementMarker,
  noMeasurementRefusal,
  probeGate,
  type NoMeasurementMarker,
  type ProbeAttempt,
  type ProbeGate,
  type ProbeOutage,
  type NoMeasurementRefusal,
  type ProviderProbeVerdict,
} from './provider-probe.js';
export {
  resilientInterpreter,
  stampDomain,
  type InterpreterFaults,
  type ResilientInterpreter,
} from './tau2-distill.js';
export {
  detectablePp,
  halfWidthOf,
  poolArms,
  poolLine,
  type PoolArm,
  type PoolArmReading,
  type PoolOutcome,
  type PoolReading,
  type PoolTask,
} from './l4-pool.js';
export {
  ENTITY_MAX_CHARS,
  ENTITY_MIN_CHARS,
  entitiesOf,
  faithfulnessLine,
  faithfulnessOf,
  faithfulnessRate,
  type FaithfulnessCensus,
  type FaithfulnessItem,
  type FaithfulnessRow,
} from './tau2-faithfulness.js';
export {
  RAWLOG_STATEMENT_CEILING,
  RAWLOG_TRUNCATION_MARK,
  RAWLOG_TRUST,
  rawLogCensus,
  rawLogInterpreter,
  rawLogInterpreterFor,
  rawLogItemShape,
  rawLogStatement,
  rawLogTruncated,
  type RawLogCensus,
} from './tau2-rawlog.js';
export { degradationLineOf, degradationOfPair } from './tau2-degradation.js';
export { guardReplaces } from './tau2-redaction.js';
export {
  DEFAULT_PACK_BUDGET,
  CEILING_ABOVE_PACK,
  CEILING_ABSENT,
  CEILING_FITS,
  ceilingLineOf,
  ceilingVerdictOf,
  packCensus,
  packLineOf,
  type CeilingVerdict,
  type PackCensus,
  type PackReading,
} from './tau2-pack.js';
export { stoppedRun } from './stopped-run.js';
export {
  COMPETITOR_PASS4,
  COMPETITOR_TASKS,
  DEFAULT_MIN_TASKS,
  PUBLISHED_PASS4,
  PUBLISHED_SCENARIO,
  minTasksOf,
  scenarioBarOf,
  sotaLineOf,
  type ScenarioBar,
} from './l4-scenario.js';
export {
  labelCensus,
  readLabelCensusTasks,
  UPSTREAM_DEFAULT_BASIS,
  type LabelCensus,
  type LabelCensusTask,
} from './label-census.js';
export {
  heldOutPlan,
  qualifiedId,
  splitFromOfficial,
  type HeldOutPlan,
  type HeldOutPlanInput,
  type TaskSplit,
} from './tau2-plan.js';
export {
  pairKey,
  transferReadingOf,
  holdRateOfTrials,
  trialRowsOf,
  type TauTrialRow,
  type PackTransferEpisode,
  type PackTransferReading,
} from './tau2-transfer.js';

export {
  R36_BARS,
  adjudicateR36,
  assignmentOf,
  foldPairsOf,
  foldsOf,
  packAssignCasesOf,
  singleSlotOf,
  type ArmExchange,
  type AssignRow,
  type FoldPair,
  type FoldReading,
  type AssignmentCase,
  type AssignmentReading,
  type MarginalReading,
  type R36Input,
  type R36Verdict,
  type SlotBasis,
} from './assignment.js';

export {
  MEMORY_FILTER_YOUDEN,
  R33_BARS,
  addedByPackOf,
  adjudicateR33,
  flagOf,
  importedNamesOf,
  validityReadingOf,
  type AddedByPack,
  type R33Verdict,
  type ValidityArm,
  type ValidityCase,
  type ValidityReading,
  type ValiditySplit,
} from './validity.js';

export {
  OUT_OF_SAMPLE_PREDICTIONS,
  adjudicateOutOfSample,
  clusteredDeltaOf,
  foldSignTestOf,
  memoryDiscordanceOf,
  outOfSampleReadingOf,
  powerVerdictOf,
  sideBySideOf,
  type CellPair,
  type ClusteredDelta,
  type FoldSignTest,
  type MemoryDiscordance,
  type OutOfSampleReading,
  type PowerVerdict,
  type PredictionVerdict,
} from './out-of-sample.js';

export {
  RELAXED_MARKERS,
  SEPARATION_BAR as RULE_FORM_SEPARATION_BAR,
  STRICT_MARKERS,
  censusOf,
  coverageOf,
  formSplitOf,
  packFormOf,
  ruleFormOf,
  rulePoolOf,
  type FormCensus,
  type FormCoverage,
  type FormMarkers,
  type FormSplit,
  type PackForm,
  type RuleForm,
  type RulePool,
} from './rule-form.js';

export {
  cellOf,
  clusteredGap,
  clusteredGapOf,
  discardSetOf,
  featureOf,
  fisherExact,
  gateReadingOf,
  improvementOf,
  readQueryDiff,
  readingOf,
  type CellReading,
  type DiffCase,
  type DiffCriterion,
  type DiscordantReading,
  type FeatureReading,
  type GateReading,
  type KindReading,
  type QueryDiffInput,
  type QueryDiffReading,
} from './query-diff.js';

export {
  corpusOf,
  packTextOf,
  type CommittedArtefact,
  type CommittedCase,
  type CommittedRule,
  type LoadedCorpus,
  type MediationEntry,
  type PackTextSource,
} from './corpus.js';

export {
  PACK_SHARE_FLOOR,
  importSourceOf,
  mediationOf,
  mentionsOf,
  type ImportSource,
  type MediationCriterion,
  type MediationReading,
  type MediationStratum,
  type MentionDetector,
  type NameCounts,
  type NameMention,
} from './pack-mediation.js';

export {
  HALF_FLOOR_PP,
  halvesOf,
  stabilityFramingOf,
  stabilityOf,
  type GateStability,
  type HalfReading,
  type JackknifeRow,
  type PermutationReading,
  type StabilityCriterion,
  type StabilityFraming,
  type StabilityGap,
  type StabilityOptions,
} from './gate-stability.js';

export {
  CONTRASTS,
  HOUSE_CONVENTIONS,
  OPTIONAL_ARMS,
  PROMPT_VERSION,
  GenerationCache,
  armPairBetween,
  armPairsAgainstFull,
  type ArmOutcomes,
  contrastTable,
  SAMPLING_SELECTORS,
  priorScopeOf,
  samplingSpecOf,
  type ContrastRow,
  type ContrastSpec,
  type SamplingSelector,
  buildValidityGates,
  ceilingAmong,
  armCoverageGate,
  armCoverageOf,
  looIndex,
  targetedLooIndex,
  BASELINE_ARM,
  canonicalRows,
  type ResultComparison,
  conventionOf,
  extractSql,
  judgeScalar,
  matches,
  parseArms,
  anchorPromptFor,
  doseMatchedDrop,
  rawEventBlock,
  renderRawPack,
  rawEventVerbatim,
  type RawEvent,
  failureKind,
  ADVISORY_SENTENCE,
  ARM_STANDING,
  EVIDENCE_LABEL,
  PROHIBITIVE_HEADING,
  evidenceBlockOf,
  mentionsAny,
  mismatchNote,
  promptFor,
  type GeneratorKind,
  relevanceSplit,
  sqlIdentifiers,
  retryPromptFor,
  retrySubset,
  schemaLinkSplit,
  type FailureKind,
  type EvidenceDelivery,
  type FramingDelivery,
  type PackKind,
  type PackStanding,
  type RelevanceSplit,
  type ResultShape,
  type RetryInput,
  type RetrySubsetRow,
  type SchemaLinkGroup,
  type SchemaLinkSplit,
  type AnchorInput,
  type AnchorMode,
  reportedSql,
  type ArmPair,
  type ArmRow,
  type ConventionName,
  type ConventionSpec,
  type GateInput,
  type PromptInput,
  type SqlArm,
  type TransferGateInput,
  type ValidityGate,
} from './sota.js';

export {
  actionSentence,
  taskCorrection,
  correctionEdit,
  driverArgs,
  learnableCorrections,
  parseTauTasks,
  splitTaskIds,
  unansweredTasks,
  type Correction,
  type CorrectionProvenance,
  type DriverCommand,
  type TauAction,
  type TauTask,
} from './tau2.js';

export {
  createTau2Adapter,
  parseTau2Candidate,
  renderTau2Pack,
  scoreTau2Candidate,
  tau2Strata,
  tau2Tasks,
  type Tau2Candidate,
  type Tau2Pack,
  type Tau2Task,
} from './lanes/tau2.js';

export {
  TAU2_GATE_INDEX,
  tau2ArmRecordOf,
  tau2DetectablePp,
  tau2GateAudit,
  tau2ProtocolInput,
  type Tau2ArmArtefact,
  type Tau2ArmRecord,
  type Tau2ComparisonRecord,
  type Tau2Evidence,
  type Tau2Field,
  type Tau2GateAudit,
  type Tau2Projection,
} from './tau2-gates.js';

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

export {
  executeQuery,
  groundedItems,
  outcomeOf,
  resolveDatabase,
  rowsDiffer,
  schemaIndex,
  schemaSql,
  tableShapes,
  unexecuted,
  type ColumnShape,
  type ExecuteOptions,
  type QueryOutcome,
  type SchemaIndex,
  type TableShape,
} from '@agentix-e/microglia-sql';

export {
  CONTENT_SIGNALS,
  contentPopulation,
  contentReadings,
  contentScoreOf,
  contentWordsOf,
  literalTokensOf,
  type ContentSignalName,
} from './content-signal.js';

export {
  OVERLAP_ROUTED_THRESHOLD,
  OVERLAP_THRESHOLD,
  crossFittedThresholds,
  overlapTerciles,
  overlapWordsOf,
  packOverlapOf,
  tercileVerdicts,
  type NetReading,
  type OverlapRow,
} from './overlap.js';

export { planBudget, type BudgetPlan, type BudgetRequest, type PriorRun } from './budget-plan.js';

export {
  GoldRevisionError,
  parseGoldRevision,
  reviseGold,
  revisionDigest,
  type GoldRevisionEntry,
  type GoldRevisionReading,
  type GoldRevisionResult,
  type RevisionDrop,
} from './gold-revision.js';

export {
  drawSpread,
  drawsToResolve,
  inertReading,
  liveShareBuckets,
  normaliseSql,
  parseSilencePlan,
  planCoverage,
  silenceReading,
  silenceTargets,
  type InertPair,
  type InertReading,
  type PlanCoverage,
  type RuleInertness,
  type SilencePlan,
  type SilenceReading,
  type SilenceTarget,
} from './inert.js';

export {
  relabelReading,
  relabelSubgroup,
  relabelVerdict,
  type GradedArm,
  type GradedPair,
  type RelabelArm,
  type RelabelCase,
  type RelabelReading,
  type RelabelSubgroup,
  type RelabelVerdict,
} from './relabel.js';

export {
  looCrossFitted,
  looDraws,
  looGroups,
  looOverall,
  ruleClassOf,
  observationalLedger,
  type LooReading,
  type LooRow,
  type RuleClass,
  type RuleVerdict,
} from './loo.js';

export { BoundedSql, type BoundedSqlOptions, type StatementResult } from '@agentix-e/microglia-sql';

export {
  DEFERRALS,
  LAYER_ORDER,
  SCENARIO_WORDS,
  coreGate,
  coupledShare,
  importEdges,
  layerGate,
  layerTotals,
  moduleNameOf,
  moduleRow,
  scenarioWords,
  stripComments,
  totalityGate,
  wordsOf,
  type CouplingGate,
  type ImportEdge,
  type Layer,
  type LayerTotal,
  type ModuleRow,
  type ModuleSource,
  type Verdict,
} from './coupling.js';

export {
  DEFAULT_CLEARANCE,
  DEFAULT_DECISIVE,
  DEFAULT_RETIREMENT,
  clearanceFromDecisive,
  creditHistogram,
  decisiveHistogram,
  parseDecisivePolicy,
  outcomeCredit,
  retireeFromDecisive,
  type ClearancePolicy,
  type DecisiveCredit,
  type DecisivePolicy,
  type OutcomeCredit,
  parseRetirementPolicy,
  retireeFrom,
  type RetirementPolicy,
  type ValidationCredit,
} from './validation.js';

export {
  DEFAULT_ADMISSION,
  admissionFloor,
  admitsAt,
  parseAdmissionPolicy,
  type AdmissionFit,
  type AdmissionPolicy,
  type AdmissionSample,
} from './dose.js';

export { DistillCache, type DistillCacheStats } from './distill-cache.js';

export {
  classify,
  crossFit,
  densityGates,
  densityReport,
  evidenceCurve,
  foreignPanels,
  identifierTokens,
  mentionsTerms,
  policyTable,
  ruleTerms,
  ruleDensityRows,
  selectDensityRules,
  signPersistence,
  stratumOf,
  targetPanels,
  transferOf,
  type CrossFitRow,
  type DensityInput,
  type DensityReport,
  type DensityRule,
  type DensityTarget,
  type DensityTrial,
  type EvidenceRow,
  type ForeignTarget,
  type PolicyName,
  type PolicyRow,
  type RuleDensityRow,
  type SignPersistence,
  type StratumSummary,
  type StoredRuleInput,
  type TransferKind,
  type TransferReading,
  type TransferRow,
} from './density.js';

export {
  bindTemplate,
  bindingCensus,
  injectionFormOf,
  MIN_NAME_SCORE,
  nameScore,
  templateCoverage,
  templateOf,
  transferStatement,
  type Binding,
  type BindingCensus,
  type BoundSlot,
  type CensusRule,
  type InjectionForm,
  type RuleTemplate,
  type SchemaNames,
  type SlotKind,
  type TemplateAttempt,
  type TemplateCoverage,
  type TemplateOutcome,
  type TemplateSlot,
} from './template.js';

export {
  bindLinked,
  linkedCensus,
  linkTargetOf,
  namesOf,
  transferLinked,
  typeFamily,
  type LinkedCensus,
  type LinkedQuestion,
  type LinkTarget,
  type TypeFamily,
} from './link-bind.js';

export {
  CANDIDATE_CONTRACT,
  DEFAULT_CASE_TIMEOUT_MS,
  assertGenerator,
  generatorProblems,
  loadGenerator,
  readReply,
  runGenerator,
  runOne,
  sameRows,
  type CandidateGenerator,
  type CandidateReply,
  type CandidateRequest,
  type GeneratorProblem,
  type LoadedGenerator,
  type LoadOptions,
  type PluginCase,
  type RunInput,
  type Scorer,
} from './plugin.js';

export {
  RUN_ARTIFACT_SCHEMA,
  runArtifactJson,
  runArtifactReport,
  validateRunArtifact,
  type ArtifactProblem,
  type ArtifactVerdict,
  type RunArtifact,
  type RunCase,
  type RunGate,
  type RunGenerator,
  type RunMetrics,
} from './artifact-schema.js';

export {
  facadePairSwitch,
  preregGate,
  preregGateAgreement,
  readPrereg,
  type GateAgreement,
  type Prereg,
  type PreregProblem,
  type PreregReading,
  plantedArmMatrix,
} from './prereg.js';

export {
  PUBLISHED_CELLS,
  cellGate,
  compareCell,
  publishedCell,
  requireCell,
  samplingSdPp,
  wilsonInterval,
  type CellComparison,
  type CellGate,
  type CellSplit,
  type CellVerdict,
  type Estimate,
  type PublishedCell,
} from './reproduction.js';

export {
  DECLINE,
  parseGuidance,
  reconstructPrompt,
  reconstructReading,
  type GuidanceItem,
  type ParsedGuidance,
  type ReconstructReading,
} from './reconstruct.js';

export {
  ceilingFromPool,
  DEFAULT_SELECTED_ARM,
  selectedArmProblem,
  sharedCases,
  widthArguments,
  widthCases,
  widthShare,
  type WidthArmNames,
  type WidthArguments,
  type WidthCaseOptions,
  type WidthRow,
  type WidthCase,
  type WidthShare,
} from './width.js';
