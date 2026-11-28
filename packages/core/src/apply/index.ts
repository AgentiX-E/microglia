/**
 * `@agentix-e/microglia-apply` — what reaches the prompt.
 *
 * Kept separate from memory because retrieval policy and rendering policy fail
 * differently: one is about which evidence is relevant, the other about what a
 * model can safely be shown.
 */
export {
  CLOSE_TAG,
  OPEN_TAG,
  appliedIds,
  emptyPack,
  encodeItemLine,
  makePack,
  maxStatementChars,
  packFingerprint,
  renderPack,
  type NoteMode,
  type RenderableItem,
  type RenderOptions,
  type RenderedPack,
  type StatementShape,
} from './render.js';

export { buildPack, type BuildPackOptions } from './pack.js';

export {
  abstractionLifecycle,
  LIFECYCLE_DISPOSITIONS,
  LIFECYCLE_REASONS,
  type AbstractionLifecycleDecision,
  type AbstractionLifecycleInput,
  type AbstractionLifecycleOptions,
  type LifecycleDisposition,
  type LifecycleReason,
} from './abstraction-lifecycle.js';

export {
  classifyCompetitionDomain,
  DOMAIN_ARTIFACTS,
  DOMAIN_REASONS,
  DOMAIN_UNITS,
  DOMAIN_VERDICTS,
  HOST_ARTIFACTS,
  type DomainArtifact,
  type DomainCandidate,
  type DomainClassification,
  type DomainReason,
  type DomainUnit,
  type DomainVerdict,
  type HostArtifact,
} from './competition-domain.js';

export {
  REVISION_INTENTS,
  REVISION_REASONS,
  REVISION_VERDICTS,
  revisionIntegrity,
  SITE_KINDS,
  SITE_STATES,
  type RevisionInput,
  type RevisionIntegrity,
  type RevisionIntent,
  type RevisionReason,
  type RevisionSite,
  type RevisionVerdict,
  type SiteKind,
  type SiteState,
} from './revision-integrity.js';

export {
  EVIDENCE_RELATIONS,
  ITEM_DISPOSITIONS,
  REVOCATION_REASONS,
  REVOCATION_VERDICTS,
  staleRevocation,
  type EvidenceRelation,
  type ItemDisposition,
  type RevocationEvidence,
  type RevocationItem,
  type RevocationReason,
  type RevocationVerdict,
  type StaleRevocation,
  type StaleRevocationInput,
} from './stale-revocation.js';

export {
  VIEW_VERDICTS,
  viewConsensus,
  type ViewConsensus,
  type ViewConsensusOptions,
  type ViewUtility,
  type ViewVerdict,
} from './view-consistency.js';

export {
  STATE_ROLES,
  resolveStates,
  serialOf,
  stateRoleOf,
  subjectKey,
  type StateRole,
  type StateSubject,
} from './state-role.js';

export {
  ADMISSION_REASONS,
  ADMISSION_VERDICTS,
  CONFLICT_KINDS,
  DETAIL_LEVELS,
  DISPOSITIONS,
  LESSON_OUTCOMES,
  memoryAdmission,
  type AdmissionCandidate,
  type AdmissionQuery,
  type AdmissionReason,
  type AdmissionVerdict,
  type ConflictKind,
  type DetailLevel,
  type Disposition,
  type EvidenceLink,
  type LessonOutcome,
  type MemoryAdmission,
  type MemoryAdmissionInput,
} from './memory-admission.js';

export {
  CONFIDENCE_DISPOSITIONS,
  CONFIDENCE_REASONS,
  CONFIDENCE_SOURCES,
  memoryConfidence,
  SOURCE_CREDIBILITY,
  type ConfidenceDisposition,
  type ConfidenceItem,
  type ConfidenceReason,
  type ConfidenceSource,
  type ConfidenceWeights,
  type ConsensusNeighbor,
  type MemoryConfidence,
  type MemoryConfidenceInput,
} from './memory-confidence.js';

export {
  decideSpeak,
  suppressionOf,
  type SpeakInput,
} from './speak.js';

export {
  DEFAULT_FOLD_SUPPORT,
  foldByShape,
  type ShapeFoldOptions,
  type ShapeMode,
} from './shape-fold.js';
