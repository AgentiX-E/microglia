/**
 * Revision-integrity gate: decide whether a memory revision (retract or correct) actually took effect across every
 * derived site, and whether the method used matches the intent (R249).
 *
 * ## The negative effect this prevents
 *
 * Writing a memory and revising one are not symmetric. Deploy-Time Memory (arXiv 2606.10062) measures a Forgetting
 * Residual Score: removing only the raw record leaves derived summaries recoverable in about 20% of instances, and
 * only a full-pipeline purge or a tombstone redaction drives the residual to zero. LongMemEval (ICLR 2025,
 * arXiv 2410.10813) measures the correction direction: fact-augmented keys that *keep* the original value and attach
 * a fact (K=V+fact) raise Recall@5 from 0.582 to 0.644, while *replacing* the original with the fact alone drops to
 * 0.530. The user's standing concern (question 8) is that what we remember and how we use it causes the negative
 * effect; a revision that silently leaves a stale derived copy, or that overwrites provenance, is exactly such a cause.
 *
 * ## The two axes
 *
 * A revision names an intent (retract / correct) and lists every site where the claim lives, with how each site was
 * handled: `live` (untouched, still carries the pre-revision value), `augmented` (original kept + a new fact/key
 * attached), `tombstoned` (marked withdrawn, excluded from retrieval) or `purged` (bytes removed).
 *
 *  - **Coverage** — an untouched `live` site still carries the old value, so it is a residual for either intent.
 *  - **Method** — a retract must make the claim unretrievable, so an `augmented` site retains it (residual); a
 *    correct must preserve provenance by augmenting the source, so a missing or non-augmented source violates the
 *    method (LongMemEval's replace-loss).
 *
 * The verdict ladder is priority-ordered: residual dominates method, and method dominates completion. Reporting a
 * correction as `complete` while a derived summary is still live would recreate the very asymmetry this gate exists
 * to stop, so coverage is checked first.
 *
 * ## Discipline
 *
 * Pure and deterministic; no clock, no network, no model, ¥0. Every guard refuses rather than defaults — a
 * duplicate site id or an unknown state would otherwise make the readback counts silently wrong. The module audits a
 * description supplied by the caller; it neither edits the store nor fetches any memory.
 */
import { MicrogliaError } from '../kernel/index.js';

/** Closed, ordered vocabulary of revision intents. */
export const REVISION_INTENTS = ['retract', 'correct'] as const;
export type RevisionIntent = (typeof REVISION_INTENTS)[number];

/** Closed, ordered vocabulary of the kinds of site a claim can live in. */
export const SITE_KINDS = ['source', 'summary', 'fact-key', 'embedding', 'citation'] as const;
export type SiteKind = (typeof SITE_KINDS)[number];

/** Closed, ordered vocabulary of how a site was handled by the revision. */
export const SITE_STATES = ['live', 'augmented', 'tombstoned', 'purged'] as const;
export type SiteState = (typeof SITE_STATES)[number];

/** Closed, ordered vocabulary of verdicts. */
export const REVISION_VERDICTS = ['complete', 'residual', 'method-violation'] as const;
export type RevisionVerdict = (typeof REVISION_VERDICTS)[number];

/** Closed, ordered vocabulary of reasons. */
export const REVISION_REASONS = [
  'full-purge',
  'tombstone-coverage',
  'augmented-and-covered',
  'live-site',
  'augment-retains-claim',
  'no-source-to-augment',
  'replace-drops-provenance',
] as const;
export type RevisionReason = (typeof REVISION_REASONS)[number];

export type RevisionSite = {
  readonly id: string;
  readonly kind: SiteKind;
  readonly state: SiteState;
};

export type RevisionInput = {
  readonly id: string;
  readonly intent: RevisionIntent;
  readonly sites: readonly RevisionSite[];
};

export type RevisionIntegrity = {
  readonly id: string;
  readonly intent: RevisionIntent;
  readonly verdict: RevisionVerdict;
  readonly reason: RevisionReason;
  readonly siteCount: number;
  readonly liveSites: number;
  readonly augmentedSites: number;
  readonly tombstonedSites: number;
  readonly purgedSites: number;
  /** Sites that still carry the pre-revision value: live for both intents, augmented for a retract. */
  readonly residualSites: number;
  readonly hasSource: boolean;
};

const INTENT_SET = new Set<string>(REVISION_INTENTS);
const KIND_SET = new Set<string>(SITE_KINDS);
const STATE_SET = new Set<string>(SITE_STATES);

/**
 * Audit a revision's integrity across every derived site.
 *
 * Priority order: residual (an old value still surfaces) beats method, method beats completion. A full purge is a
 * complete retract; a tombstone-covered retract is complete; a correct is complete only when the source was augmented
 * and no derived site is still live.
 */
export function revisionIntegrity(input: RevisionInput): RevisionIntegrity {
  if (typeof input.id !== 'string' || input.id.trim() === '') {
    throw new MicrogliaError('MG_E_CONFIG', 'revision id must be a non-blank string', { id: input.id });
  }
  if (typeof input.intent !== 'string' || !INTENT_SET.has(input.intent)) {
    throw new MicrogliaError('MG_E_CONFIG', `revision '${input.id}': unknown intent '${input.intent}'`, {
      id: input.id,
      intent: input.intent,
    });
  }
  if (!Array.isArray(input.sites)) {
    throw new MicrogliaError('MG_E_CONFIG', `revision '${input.id}': sites must be an array`, { id: input.id });
  }
  if (input.sites.length === 0) {
    throw new MicrogliaError('MG_E_CONFIG', `revision '${input.id}': sites must not be empty`, { id: input.id });
  }

  const seen = new Set<string>();
  let liveSites = 0;
  let augmentedSites = 0;
  let tombstonedSites = 0;
  let purgedSites = 0;
  let hasSource = false;
  let sourceAugmented = false;
  let allPurged = true;

  for (const site of input.sites) {
    if (typeof site.id !== 'string' || site.id.trim() === '') {
      throw new MicrogliaError('MG_E_CONFIG', `revision '${input.id}': site id must be non-blank`, {
        id: input.id,
        site,
      });
    }
    if (seen.has(site.id)) {
      throw new MicrogliaError('MG_E_CONFIG', `revision '${input.id}': duplicate site id '${site.id}'`, {
        id: input.id,
        siteId: site.id,
      });
    }
    seen.add(site.id);
    if (typeof site.kind !== 'string' || !KIND_SET.has(site.kind)) {
      throw new MicrogliaError('MG_E_CONFIG', `revision '${input.id}': unknown site kind '${site.kind}'`, {
        id: input.id,
        siteId: site.id,
        kind: site.kind,
      });
    }
    if (typeof site.state !== 'string' || !STATE_SET.has(site.state)) {
      throw new MicrogliaError('MG_E_CONFIG', `revision '${input.id}': unknown site state '${site.state}'`, {
        id: input.id,
        siteId: site.id,
        state: site.state,
      });
    }
    if (site.kind === 'source') {
      hasSource = true;
      sourceAugmented = site.state === 'augmented';
    }
    if (site.state === 'live') liveSites += 1;
    else if (site.state === 'augmented') augmentedSites += 1;
    else if (site.state === 'tombstoned') tombstonedSites += 1;
    else purgedSites += 1;
    if (site.state !== 'purged') allPurged = false;
  }

  let verdict: RevisionVerdict;
  let reason: RevisionReason;
  let residualSites: number;

  if (input.intent === 'retract' && augmentedSites > 0) {
    // Augmenting keeps the original value, so a retracted claim still surfaces through that site.
    verdict = 'residual';
    reason = 'augment-retains-claim';
    residualSites = liveSites + augmentedSites;
  } else if (liveSites > 0) {
    // Coverage first: an untouched site still carries the pre-revision value for either intent.
    verdict = 'residual';
    reason = 'live-site';
    residualSites = liveSites;
  } else if (input.intent === 'correct' && !hasSource) {
    verdict = 'method-violation';
    reason = 'no-source-to-augment';
    residualSites = 0;
  } else if (input.intent === 'correct' && !sourceAugmented) {
    // LongMemEval: replacing (or removing) the source drops the provenance that makes the fact trustworthy.
    verdict = 'method-violation';
    reason = 'replace-drops-provenance';
    residualSites = 0;
  } else {
    verdict = 'complete';
    residualSites = 0;
    if (allPurged) {
      reason = 'full-purge';
    } else if (input.intent === 'correct') {
      reason = 'augmented-and-covered';
    } else {
      reason = 'tombstone-coverage';
    }
  }

  return {
    id: input.id,
    intent: input.intent,
    verdict,
    reason,
    siteCount: input.sites.length,
    liveSites,
    augmentedSites,
    tombstonedSites,
    purgedSites,
    residualSites,
    hasSource,
  };
}
