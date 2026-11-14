/**
 * Where a pack is served from, resolved once per dispatch.
 *
 * R55.1's single variable, and the only difference between the second arm and the first. It is not a
 * formatting choice: the SOTA holder's published cell injects **every** admitted guideline into the
 * system prompt in both ReAct phases, with no retrieval and no budget — 31 bullets, billed twice a turn
 * — while this lane serves 1.42 items a request through a 1,200-character pack. Serving a different
 * number of items on a different schedule is a different treatment, and until this module the lane
 * could not express the second one at all.
 *
 * Two rules, and they are the family's:
 *
 *  1. **Unset means `retrieved`.** Every committed artefact was produced by a recall that selected by
 *     relevance under a budget, so the default must reproduce that request byte for byte or the lane's
 *     history stops being comparable to its future.
 *  2. **A set value must be one of two names.** No spelling of "all" that quietly means something
 *     else, and no boolean: the thing being varied is a place, and the two places are words.
 *
 * The knobs are returned as strings rather than as a rendered query, because they cross two language
 * boundaries (this process, the driver's child environment, the Python agent's HTTP call) and a
 * pre-rendered string would have to be parsed at the far end to be checked. A mapping from name to
 * value survives the crossing without knowing what either means.
 */
export type PackMode = 'retrieved' | 'prefix';

export type PackModePlan = {
  readonly mode: PackMode;
  /**
   * Whether this dispatch *is* the arm.
   *
   * `retrieved` is both the default and one of the two modes, so a plan that merely resolved to
   * `retrieved` could mean either "this run is the retrieved arm" or "nobody set the switch". The
   * artefact records which, because a readback that cannot tell them apart cannot tell an arm from a
   * control — R53's third refutation, one switch over.
   */
  readonly declared: boolean;
  /**
   * The recall knobs this mode adds, by query name.
   *
   * Empty for `retrieved`: the lane's own request is the one every artefact was written with, and
   * restating its defaults here would make this file a second home for the pack layer's policy.
   */
  readonly knobs: Readonly<Record<string, string>>;
};

export const PACK_MODES: readonly PackMode[] = ['retrieved', 'prefix'];

/**
 * The ceiling the prefix arm renders under, in items and in characters.
 *
 * "No budget" has to be a number, because the renderer's contract is a budget. These two are chosen so
 * that neither can bite at this store's scale — the learning half is 57 tasks and the store holds
 * tens of items, so 999 items and 200,000 characters bound a store that does not exist rather than a
 * pack that might. They are recorded in the artefact for the same reason: an arm that claims "every
 * admitted item" has to be checkable against the items the store actually held.
 */
export const PREFIX_ITEM_CEILING = 999;
export const PREFIX_CHAR_CEILING = 200_000;

export function resolvePackModePlan(
  env: Readonly<Record<string, string | undefined>>,
): PackModePlan {
  const raw = (env['TAU_PACK_MODE'] ?? '').trim();
  if (raw === '') return { mode: 'retrieved', declared: false, knobs: {} };
  if (!PACK_MODES.includes(raw as PackMode)) {
    throw new Error(
      `TAU_PACK_MODE must be unset or one of ${PACK_MODES.join(', ')}, not '${raw}': ` +
        'an unknown spelling would run a pack that reports a place it did not serve from',
    );
  }
  if (raw === 'retrieved') return { mode: 'retrieved', declared: true, knobs: {} };
  return {
    mode: 'prefix',
    declared: true,
    // `scope` anchoring is the only mode in this codebase that serves a rule without a lexical anchor,
    // and `minCoverage=0` is the floor that stops the coverage gate from doing the retrieving instead.
    // Together they are "no retrieval"; the ceiling is what makes "no budget" renderable.
    knobs: {
      anchoring: 'scope',
      minCoverage: '0',
      limit: String(PREFIX_ITEM_CEILING),
      budget: String(PREFIX_CHAR_CEILING),
    },
  };
}

/**
 * Where the pack's *unit* comes from: one line per failure, or one line per routine.
 *
 * R109's switch, and the second of the family. `TAU_PACK_MODE` decides which items are served; this
 * decides what one served item *is*. They are separate variables rather than one because the arms they
 * carry answer different questions — a prefix arm asks "every admitted rule or a retrieved pack", and a
 * shape arm asks "one record per failure or one per routine, over the same store" — and a single
 * variable with four values would make the two questions one experiment that cannot be read as either.
 *
 * Both rules of the family apply unchanged: unset means `per-failure`, which is what every committed
 * artefact measured, and a set value must be one of two names.
 */
export type PackShape = 'per-failure' | 'collapse';

export type PackShapePlan = {
  readonly shape: PackShape;
  /** Whether this dispatch *is* the arm rather than a dispatch nobody set the switch on. */
  readonly declared: boolean;
  /** The recall knobs this shape adds, by query name. Empty for `per-failure`. */
  readonly knobs: Readonly<Record<string, string>>;
};

export const PACK_SHAPES: readonly PackShape[] = ['per-failure', 'collapse'];

export function resolvePackShapePlan(
  env: Readonly<Record<string, string | undefined>>,
): PackShapePlan {
  const raw = (env['TAU_PACK_SHAPE'] ?? '').trim();
  if (raw === '') return { shape: 'per-failure', declared: false, knobs: {} };
  if (!PACK_SHAPES.includes(raw as PackShape)) {
    throw new Error(
      `TAU_PACK_SHAPE must be unset or one of ${PACK_SHAPES.join(', ')}, not '${raw}': ` +
        'a spelling that is not one of the two would render a pack whose unit nobody declared',
    );
  }
  if (raw === 'per-failure') return { shape: 'per-failure', declared: true, knobs: {} };
  // The fold's own knob and nothing else: the support floor, the medoid and the kind guard are the
  // library's decisions, and restating any of them here would be a second home for the mechanism.
  return { shape: 'collapse', declared: true, knobs: { shape: 'collapse' } };
}
