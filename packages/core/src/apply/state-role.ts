/**
 * Read-time state roles, and a deterministic serial-max over the versions of one claim (R244).
 *
 * The store is already bitemporal: every `KnowledgeItem` carries `validFrom/validUntil` (world time) and
 * `systemFrom/systemUntil` (system time), plus a contradiction count. Graphiti expires contradictions rather than
 * deleting them, DISCERN preserves at write and resolves at read, and A-TMA and Freshness both show that the decisive
 * step is the *assembly* — what the reader is told about an item's state — not the storage. This module is that
 * assembly step, and it is a pure function of the store plus one injected clock: no model is asked to decide which
 * version of a claim is current.
 *
 * Freshness measured a deterministic `max(serial)` at 78% / 94.8% fact-consolidation accuracy against 7% for a
 * graph store that delegated the decision to a model. A-TMA measured an explicit state role lifting conflict
 * accuracy from 0.425 to 0.725. Neither figure is imported here as a claim about this corpus — neither benchmark
 * has a microglia submission — but both locate the mechanism this module implements.
 *
 * ## The three roles
 *
 *  - `transition` — the claim is contested (`contradictions > 0`) or `status === 'conflicted'`. A contested claim is
 *    never silently current: transition wins over every clock, because a disagreement the reader cannot see is how a
 *    correct-but-stale rule anchors a model to the wrong frame (MemTrapBench).
 *  - `historical` — world time or system time has ended (`now > validUntil` or `now > systemUntil`), or the claim is
 *    not yet assertable (`now < validFrom`). `validityDecay` deliberately keeps such an item `active` so fresh
 *    evidence can re-assert it; the state role says so to the reader instead of dropping it.
 *  - `current` — asserted, uncontested, and inside both clocks. Boundaries are inclusive: expiry is strictly after.
 *
 * ## Why serial-max lives here, not in the store
 *
 * The store keys by id, not by claim: two revisions of one statement are two items, and `dedupeKeyOf` is deliberately
 * not the item id. Superseding at write would change the store contents and break replay. Superseding at *read* is
 * reversible per request, which is what lets one dispatch carry both the serial-max arm and its control over one
 * identical store — the same design discipline `foldByShape` uses for the shape fold.
 *
 * The serial is the item's `updatedAt`, rendered as a fixed-width decimal so a lexical comparison is a numeric one,
 * with the id as a stable tie-break. The winner of a subject group is the maximum serial. A revision that loses is
 * reported `historical` (superseded) unless it is contested, in which case its transition is preserved — age does
 * not resolve a disagreement.
 *
 * Nothing here changes the default pack. A caller opts in by attaching `stateRole` to the render/build options, so
 * every artefact committed before R244 re-renders byte-for-byte identically. That is the same switch discipline as
 * `note`, `budgetBasis`, `shape` and `decision`.
 */
import type { KnowledgeItem, KnowledgeScope, KnowledgeStatus } from '../kernel/index.js';
import { scopeKey } from '../kernel/index.js';

/** The closed vocabulary the renderer may print as an item's state. */
export const STATE_ROLES = ['current', 'historical', 'transition'] as const;

export type StateRole = (typeof STATE_ROLES)[number];

/**
 * The narrowest view of an item a state decision reads.
 *
 * Declared explicitly rather than taking `KnowledgeItem`, so a caller that only has a projection — the evaluation's
 * ledger reader, a replay from a manifest — can ask the same question the product asks, and a new field on the full
 * record cannot silently enter this decision.
 */
export type StateSubject = {
  readonly id: string;
  readonly namespace: string;
  readonly kind: string;
  readonly scope: KnowledgeScope;
  readonly validFrom: number;
  readonly validUntil: number;
  readonly systemFrom: number;
  readonly systemUntil: number;
  readonly contradictions: number;
  readonly status: KnowledgeStatus;
  readonly updatedAt: number;
};

/** Fixed-width clock: `999` sorts before `1000`, and the id breaks an exact tie. */
const SERIAL_WIDTH = 16;

/**
 * A stable, lexically-comparable serial for a revision. The maximum is the newest revision; equal clocks break by
 * id so the winner never depends on iteration order.
 */
export function serialOf(item: Pick<StateSubject, 'updatedAt' | 'id'>): string {
  return `${String(item.updatedAt).padStart(SERIAL_WIDTH, '0')}|${item.id}`;
}

/**
 * The claim a set of revisions belongs to. Revisions of one statement share a subject even when their ids differ;
 * two different claims in one scope do not. Built from `scopeKey` so it agrees with the store's own notion of a
 * scope, with the kind joined in — a negative and a constraint over one scope are opposite claims, not two versions
 * of one.
 */
export function subjectKey(item: Pick<StateSubject, 'namespace' | 'kind' | 'scope'>): string {
  return `${item.namespace}|${item.kind}|${scopeKey(item.scope)}`;
}

/**
 * The state of one item at `now`, before any serial-max.
 *
 * Transition is checked first on purpose: `validityDecay` keeps a conflicted-but-not-yet-expired rule live, and
 * reporting it `current` because its clock has not run out would hide the very disagreement the reader needs to see.
 */
export function stateRoleOf(item: StateSubject, now: number): StateRole {
  if (item.contradictions > 0 || item.status === 'conflicted') return 'transition';
  if (now > item.validUntil || now > item.systemUntil || now < item.validFrom || now < item.systemFrom) {
    return 'historical';
  }
  return 'current';
}

/**
 * The serial-max resolution over a set of candidate items.
 *
 * Returns one role per item id. Within a subject group the maximum serial is the current revision; the rest are
 * `historical` because a newer revision supersedes them — except a contested one, whose transition is preserved. A
 * group of one keeps its own state: an expired lone item is historical, not a phantom winner promoted to current.
 *
 * The result is a `Map` so an item that lost on serial is still present with its downgraded role: the renderer can
 * show it as historical rather than silently dropping evidence the store still holds.
 */
export function resolveStates(
  items: readonly (KnowledgeItem | StateSubject)[],
  now: number,
): ReadonlyMap<string, StateRole> {
  const bySubject = new Map<string, StateSubject[]>();
  for (const item of items) {
    const key = subjectKey(item);
    const group = bySubject.get(key);
    if (group === undefined) bySubject.set(key, [item]);
    else group.push(item);
  }

  const resolved = new Map<string, StateRole>();
  for (const group of bySubject.values()) {
    let winner = group[0] as StateSubject;
    for (const item of group) {
      if (serialOf(item) > serialOf(winner)) winner = item;
    }
    for (const item of group) {
      const own = stateRoleOf(item, now);
      if (own === 'transition' || item.id === winner.id) resolved.set(item.id, own);
      else resolved.set(item.id, 'historical');
    }
  }
  return resolved;
}
