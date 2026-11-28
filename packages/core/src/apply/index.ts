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
