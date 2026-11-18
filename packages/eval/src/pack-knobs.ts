/**
 * The three axes of a serve, joined into the one form the lane can carry: a query fragment.
 *
 * The fragment crosses two language boundaries — this process, the workflow's child environment, the Python
 * agent's HTTP call — so it is built here, once, and the command that prints it is a wrapper. A bin that owned
 * this join could only be tested by spawning a process, and a rule this lane relies on would then be checked by
 * four process launches instead of four assertions.
 *
 * | axis | question | module |
 * | --- | --- | --- |
 * | `packMode` | *where* a pack is served from | `pack-mode-plan.ts` |
 * | `packShape` | *what unit* it is written in | `pack-mode-plan.ts` |
 * | `serveAnchor` | *what may appear inside it* | `serve-anchor.ts` |
 *
 * The join refuses one combination: a prefix arm renders every admitted entry, so a lexical anchor has nothing
 * to filter, and the two knobs would contradict each other on the wire (`anchoring=scope` from the mode,
 * `anchoring=lexical` from the anchor, last key wins). Silently honouring the second is how an arm is published
 * under a treatment it did not run.
 */
import { resolvePackModePlan, resolvePackShapePlan } from './pack-mode-plan.js';
import { resolveServeAnchorPlan, type ServeAnchor } from './serve-anchor.js';

export type KnobInput = {
  /** The declared pack mode, or empty for "nobody declared one". */
  readonly mode: string;
  /** The declared pack shape, or empty. */
  readonly shape: string;
  /** The label anchor the environment names, if any. */
  readonly anchor?: string;
};

/**
 * The fragment, `name=value` pairs joined with `&`, empty when no axis adds a knob.
 *
 * Empty is a fact worth preserving byte for byte: the retrieved arm's request must stay identical to the one
 * every committed artefact was written with, and a fragment that said anything at all would move the lane's
 * history sideways.
 */
export function knobFragment(input: KnobInput): string {
  const mode = resolvePackModePlan(input.mode.trim() === '' ? {} : { TAU_PACK_MODE: input.mode.trim() });
  const shape = resolvePackShapePlan(input.shape.trim() === '' ? {} : { TAU_PACK_SHAPE: input.shape.trim() });
  const anchor = resolveServeAnchorPlan(
    input.anchor === undefined || input.anchor.trim() === '' ? {} : { TAU_SERVE_ANCHOR: input.anchor },
  );
  if (mode.mode === 'prefix' && anchor.anchor === 'lexical') {
    throw new Error(
      'a prefix arm renders every admitted entry, so a lexical anchor has nothing to filter: ' +
        'TAU_PACK_MODE=prefix and TAU_SERVE_ANCHOR=lexical cannot both be honoured',
    );
  }
  const knobs = { ...mode.knobs, ...shape.knobs, ...anchor.knobs };
  return Object.entries(knobs)
    .map(([name, value]) => `${name}=${value}`)
    .join('&');
}

/** The anchors this build can honour, re-exported so a caller has one import for the vocabulary. */
export type { ServeAnchor };
