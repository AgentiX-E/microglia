/**
 * Whether a scope-matched rule needs a word in common with the request.
 *
 * ## The axis, and why it is not a `PackMode`
 *
 * `pack-mode-plan.ts` answers a different question: **where** a pack is served from — retrieved by relevance,
 * or every admitted entry into the system prompt. Its contract says the names are places, and adding a third
 * name for a filter would make one axis claim two meanings. Anchoring is a filter on what may appear inside a
 * pack that is already served, so it is resolved here, on its own axis, with its own default.
 *
 * ## What it is for
 *
 * The product has always had the knob: `RecallQuery.anchoring`, `'scope' | 'lexical'`, honoured by `buildPack`
 * and reachable on `GET /v1/recall`. The τ² lane has only ever run `'scope'`, under which a rule that matched
 * on structure and shares no word with the request may still be injected — and that is the failure class the
 * 2026 literature attributes most memory harm to: WikiTrace (arXiv 2611.14320) traces **52%** of degradation
 * events to a followed memory entry, and **80%** of those to a *valid* insight applied outside its scope.
 *
 * ## The default, stated once
 *
 * Unset means **the request carries no `anchoring` parameter at all**, which is what every committed artefact
 * was written with. Restating the pack layer's default here would be a second home for its policy, and the
 * lane's history would stop being comparable to its future the first time that policy changed. `'scope'`
 * may be declared explicitly — a registration is allowed to say what it relies on — and declaring it still
 * sends nothing, because the wire must not move for a word that changes no behaviour.
 */
export type ServeAnchor = 'lexical' | 'scope';

export type ServeAnchorPlan = {
  /** The anchor this dispatch declared, absent when nobody declared one. */
  readonly anchor?: ServeAnchor;
  /**
   * Whether the switch was set at all.
   *
   * The distinction the artefact needs: an arm that *is* the default and an arm that merely did not name a
   * value produce the same request and are different experiments.
   */
  readonly declared: boolean;
  /** The recall knobs this anchor adds, by query name. Empty for `'scope'`, which changes no parameter. */
  readonly knobs: Readonly<Record<string, string>>;
};

export const SERVE_ANCHORS: readonly ServeAnchor[] = ['lexical', 'scope'];

export function resolveServeAnchorPlan(
  env: Readonly<Record<string, string | undefined>>,
): ServeAnchorPlan {
  const raw = (env['TAU_SERVE_ANCHOR'] ?? '').trim();
  if (raw === '') return { declared: false, knobs: {} };
  if (!SERVE_ANCHORS.includes(raw as ServeAnchor)) {
    throw new Error(
      `TAU_SERVE_ANCHOR must be unset or one of ${SERVE_ANCHORS.join(', ')}, not '${raw}': ` +
        'an unknown spelling would run a filter that reports one it did not apply',
    );
  }
  if (raw === 'scope') return { anchor: 'scope', declared: true, knobs: {} };
  return { anchor: 'lexical', declared: true, knobs: { anchoring: 'lexical' } };
}
