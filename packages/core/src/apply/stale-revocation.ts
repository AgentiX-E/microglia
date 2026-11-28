/**
 * Stale-revocation gate: decide whether a new piece of evidence has actually displaced the older memories it
 * contradicts, before those older memories are allowed to stay in the retrieval set (R250).
 *
 * ## The negative effect this prevents
 *
 * R249 gates whether an *explicit* revision (retract / correct) reached every derived site. It does not cover the
 * case that matters most in a long-lived agent: a new observation arrives, implicitly invalidates an older memory,
 * and nobody issues a retraction. TEPA (arXiv 2608.07429) measures the damage directly — under a full reversal,
 * append-only memory and last-write-wins both fall to 0.210 success, *below* the no-memory baseline of 0.309
 * (pollution index 0.318), while revoking the stale precedent holds 0.950. Its Proposition 2 bounds the excess
 * risk of append-only over revocable memory by q·eta: the probability a stale item stays exposed times the chance
 * the decision follows it. STALE (arXiv 2605.06527) explains how the invalidation happens without anyone saying
 * "that is wrong" — a new value can logically exclude an old one over the same attribute (co-reference conflict)
 * or reach a related attribute through a dependency chain (propagation conflict). MMA (arXiv 2602.16493) adds
 * that agents treat retrieved items as uniformly trustworthy despite staleness, so an exposed stale item is not
 * merely noise, it is a commitment the agent will act on. The user's standing concern (question 8) — that what we
 * remember and how we use it causes the negative effect — is exactly this: the correct new value was written, but
 * the stale one was never revoked and is still retrieved.
 *
 * ## The model
 *
 * An episode carries one `evidence` item (the new value, with a `serial` and a conflict `key`) and the list of
 * `items` currently in the retrieval set. Each item has a `key`, a `serial`, and a `disposition`: `active` (still
 * exposed), `revoked` (marked withdrawn) or `superseded` (replaced by a newer value). A relation says how the
 * evidence relates to the past: `extend` only adds information (older values legitimately coexist), `co-reference`
 * means the new value on the same key excludes older values on that key, and `propagation` also invalidates the
 * keys listed in `invalidates` through a dependency chain.
 *
 * Current items share the evidence key and serial. Stale items are older items on the evidence key for a
 * co-reference or propagation relation, plus every item on an invalidated key for propagation; an `extend`
 * relation creates no stale items. A stale item is *exposed* while its disposition is `active`.
 *
 * ## Verdict ladder (strict priority)
 *
 * Pollution dominates, then over-revocation, then a missing current value, then clean. Exposing a stale item is
 * the measured harm, so it is reported first even when the current value was also revoked or is absent. Within
 * pollution, an exposed invalidated (propagated) key is the more specific finding and outranks a plain stale
 * value on the evidence key, while the count still includes both.
 *
 * ## Discipline
 *
 * Pure and deterministic; no clock, no network, no model, ¥0. Every guard refuses rather than defaults — a
 * duplicate item id or a negative serial would otherwise make the readback counts silently wrong. The module
 * audits a description supplied by the caller; it neither edits the store nor fetches any memory.
 */
import { MicrogliaError } from '../kernel/index.js';

/** Closed, ordered vocabulary of how new evidence relates to the memories it meets. */
export const EVIDENCE_RELATIONS = ['extend', 'co-reference', 'propagation'] as const;
export type EvidenceRelation = (typeof EVIDENCE_RELATIONS)[number];

/** Closed, ordered vocabulary of what the store did to a retrieved item. */
export const ITEM_DISPOSITIONS = ['active', 'revoked', 'superseded'] as const;
export type ItemDisposition = (typeof ITEM_DISPOSITIONS)[number];

/** Closed, ordered vocabulary of verdicts. */
export const REVOCATION_VERDICTS = ['clean', 'polluted', 'over-revoked', 'unresolved'] as const;
export type RevocationVerdict = (typeof REVOCATION_VERDICTS)[number];

/** Closed, ordered vocabulary of reasons. */
export const REVOCATION_REASONS = [
  'extend-safe',
  'co-reference-resolved',
  'propagation-resolved',
  'stale-still-active',
  'propagated-still-active',
  'current-removed',
  'no-current-evidence',
] as const;
export type RevocationReason = (typeof REVOCATION_REASONS)[number];

export type RevocationItem = {
  readonly id: string;
  readonly key: string;
  readonly serial: number;
  readonly disposition: ItemDisposition;
};

export type RevocationEvidence = {
  readonly id: string;
  readonly key: string;
  readonly relation: EvidenceRelation;
  readonly serial: number;
  readonly invalidates?: readonly string[];
};

export type StaleRevocationInput = {
  readonly id: string;
  readonly evidence: RevocationEvidence;
  readonly items: readonly RevocationItem[];
};

export type StaleRevocation = {
  readonly id: string;
  readonly relation: EvidenceRelation;
  readonly verdict: RevocationVerdict;
  readonly reason: RevocationReason;
  readonly itemCount: number;
  readonly currentCount: number;
  readonly currentActive: boolean;
  readonly staleCount: number;
  readonly activeStaleCount: number;
  readonly handledStaleCount: number;
  readonly propagationKeys: number;
};

const RELATION_SET = new Set<string>(EVIDENCE_RELATIONS);
const DISPOSITION_SET = new Set<string>(ITEM_DISPOSITIONS);

const validSerial = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

/**
 * Audit whether new evidence displaced the memories it invalidated.
 *
 * Current items share the evidence key and serial; stale items are older values on that key (except for `extend`)
 * plus, for propagation, any item on an invalidated key. Pollution is reported first, then over-revocation, then
 * a missing current value, then clean.
 */
export function staleRevocation(input: StaleRevocationInput): StaleRevocation {
  if (typeof input.id !== 'string' || input.id.trim() === '') {
    throw new MicrogliaError('MG_E_CONFIG', 'episode id must be a non-blank string', { id: input.id });
  }
  const evidence = input.evidence;
  if (typeof evidence !== 'object' || evidence === null || Array.isArray(evidence)) {
    throw new MicrogliaError('MG_E_CONFIG', `episode '${input.id}': evidence must be an object`, { id: input.id });
  }
  if (typeof evidence.id !== 'string' || evidence.id.trim() === '') {
    throw new MicrogliaError('MG_E_CONFIG', `episode '${input.id}': evidence id must be non-blank`, {
      id: input.id,
    });
  }
  if (typeof evidence.key !== 'string' || evidence.key.trim() === '') {
    throw new MicrogliaError('MG_E_CONFIG', `episode '${input.id}': evidence key must be non-blank`, {
      id: input.id,
    });
  }
  if (typeof evidence.relation !== 'string' || !RELATION_SET.has(evidence.relation)) {
    throw new MicrogliaError(
      'MG_E_CONFIG',
      `episode '${input.id}': unknown relation '${evidence.relation}'`,
      { id: input.id, relation: evidence.relation },
    );
  }
  if (!validSerial(evidence.serial)) {
    throw new MicrogliaError('MG_E_CONFIG', `episode '${input.id}': evidence serial must be finite and >= 0`, {
      id: input.id,
      serial: evidence.serial,
    });
  }
  const invalidates: readonly string[] = evidence.invalidates ?? [];
  if (!Array.isArray(invalidates)) {
    throw new MicrogliaError('MG_E_CONFIG', `episode '${input.id}': invalidates must be an array`, {
      id: input.id,
    });
  }
  for (const key of invalidates) {
    if (typeof key !== 'string' || key.trim() === '') {
      throw new MicrogliaError('MG_E_CONFIG', `episode '${input.id}': invalidated key must be non-blank`, {
        id: input.id,
      });
    }
    if (key === evidence.key) {
      throw new MicrogliaError('MG_E_CONFIG', `episode '${input.id}': invalidated key equals evidence key '${key}'`, {
        id: input.id,
        key,
      });
    }
  }
  if (invalidates.length > 0 && evidence.relation !== 'propagation') {
    throw new MicrogliaError(
      'MG_E_CONFIG',
      `episode '${input.id}': invalidates only applies to a propagation relation`,
      { id: input.id },
    );
  }

  if (!Array.isArray(input.items)) {
    throw new MicrogliaError('MG_E_CONFIG', `episode '${input.id}': items must be an array`, { id: input.id });
  }
  if (input.items.length === 0) {
    throw new MicrogliaError('MG_E_CONFIG', `episode '${input.id}': items must not be empty`, { id: input.id });
  }

  const invalidated = new Set<string>(invalidates);
  const seen = new Set<string>();
  let currentCount = 0;
  let currentActive = false;
  let staleCount = 0;
  let activeStaleCount = 0;
  let handledStaleCount = 0;
  let propagatedActive = false;

  for (const item of input.items) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new MicrogliaError('MG_E_CONFIG', `episode '${input.id}': every item must be an object`, {
        id: input.id,
      });
    }
    if (typeof item.id !== 'string' || item.id.trim() === '') {
      throw new MicrogliaError('MG_E_CONFIG', `episode '${input.id}': item id must be non-blank`, { id: input.id });
    }
    if (seen.has(item.id)) {
      throw new MicrogliaError('MG_E_CONFIG', `episode '${input.id}': duplicate item id '${item.id}'`, {
        id: input.id,
        itemId: item.id,
      });
    }
    seen.add(item.id);
    if (typeof item.key !== 'string' || item.key.trim() === '') {
      throw new MicrogliaError('MG_E_CONFIG', `episode '${input.id}': item key must be non-blank`, {
        id: input.id,
        itemId: item.id,
      });
    }
    if (!validSerial(item.serial)) {
      throw new MicrogliaError('MG_E_CONFIG', `episode '${input.id}': item serial must be finite and >= 0`, {
        id: input.id,
        itemId: item.id,
      });
    }
    if (typeof item.disposition !== 'string' || !DISPOSITION_SET.has(item.disposition)) {
      throw new MicrogliaError(
        'MG_E_CONFIG',
        `episode '${input.id}': unknown disposition '${item.disposition}'`,
        { id: input.id, itemId: item.id },
      );
    }

    if (item.key === evidence.key && item.serial === evidence.serial) {
      currentCount += 1;
      if (item.disposition === 'active') currentActive = true;
    }

    // An extend relation only adds information, so older values on the same key legitimately coexist.
    const sameKeyStale =
      evidence.relation !== 'extend' && item.key === evidence.key && item.serial < evidence.serial;
    const propagatedStale = invalidated.has(item.key);
    if (sameKeyStale || propagatedStale) {
      staleCount += 1;
      if (item.disposition === 'active') {
        activeStaleCount += 1;
        if (propagatedStale) propagatedActive = true;
      } else {
        handledStaleCount += 1;
      }
    }
  }

  let verdict: RevocationVerdict;
  let reason: RevocationReason;
  if (activeStaleCount > 0) {
    verdict = 'polluted';
    reason = propagatedActive ? 'propagated-still-active' : 'stale-still-active';
  } else if (currentCount > 0 && !currentActive) {
    verdict = 'over-revoked';
    reason = 'current-removed';
  } else if (currentCount === 0) {
    verdict = 'unresolved';
    reason = 'no-current-evidence';
  } else {
    verdict = 'clean';
    reason =
      evidence.relation === 'extend'
        ? 'extend-safe'
        : evidence.relation === 'propagation'
          ? 'propagation-resolved'
          : 'co-reference-resolved';
  }

  return {
    id: input.id,
    relation: evidence.relation,
    verdict,
    reason,
    itemCount: input.items.length,
    currentCount,
    currentActive,
    staleCount,
    activeStaleCount,
    handledStaleCount,
    propagationKeys: invalidates.length,
  };
}
