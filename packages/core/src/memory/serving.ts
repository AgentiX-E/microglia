/**
 * The configuration the evaluation measured as best, exported where a product can import it.
 *
 * **The gap this closes.** Until this file existed the measured configuration lived in three places: a constant in
 * the Python driver, a default in a workflow input, and whatever the last round's notes said. The product surface is
 * TypeScript and read none of them, so nothing compared the two — and "the product ships the configuration the
 * number was measured at" was a promise about two codebases rather than a property a build could check.
 *
 * `eval/manifests/serving-defaults.json` is the single source. This constant restates it, and
 * `serving.test.ts` reads the file and fails if the two disagree: **change `placement` in the manifest and exactly
 * one test fails in each repository.** That is the whole mechanism, and it is deliberately mechanical — a review
 * cannot catch a divergence, and a test can.
 *
 * **What this is not.** It is not an implementation of the placements. `packages/eval/src/cache-placement.ts` owns
 * the probe and the prompt shapes for the five placements it prices, `tail` among them since R220b — before that
 * round this file recommended a position no reading had measured, which is the same divergence as the three places
 * above, one level down. The probe's `tail` shape is built with `writtenOnCall`, because behind the conversation the
 * block's position is a function of when it was written, and with `revision`, because held still every placement
 * pays the same and the difference lives in what a change re-bills.
 *
 * A product that imports `SERVING_DEFAULTS.placement` and passes it to a call site that does not accept it fails to
 * compile, which is the correct outcome: the recommendation cannot silently outrun the implementation.
 */

/** The placements the probe and the driver know between them. `tail` is measured, not yet priced by the probe. */
export const SERVING_PLACEMENTS = ['control', 'front', 'tail', 'system-second', 'system-merged', 'first-turn'] as const;

export type ServingPlacement = (typeof SERVING_PLACEMENTS)[number];

/** Where a block's contents come from: the request, or every tool result. */
export const ASK_SOURCES = ['request', 'receipt'] as const;

export type AskSource = (typeof ASK_SOURCES)[number];

/**
 * A settlement grade. `name` is containment of the product the ask names; `overlap` is at least one shared content
 * word and half the shorter side, which is what a set-shaped ask needs to settle at all.
 */
export const SETTLEMENT_GRADES = ['name', 'overlap'] as const;

export type SettlementGrade = (typeof SETTLEMENT_GRADES)[number];

export type ServingDefaults = {
  /** Where the block sits: `tail` behind the conversation, so a change does not re-bill the prompt. */
  readonly placement: ServingPlacement;
  /** Where the asks come from: `request` only, which took the list from 10.6 a turn to 1.96. */
  readonly askSource: AskSource;
  /** The grades a settlement may carry, widest last. */
  readonly settlementGrades: readonly SettlementGrade[];
  /** The mechanism gate's ceiling on the block, in characters. Above it, the block is a transcript. */
  readonly blockCeilingChars: number;
  /** The mechanism gate's ceiling on open asks a turn. Above it, the block is a list of everything. */
  readonly openAskCeiling: number;
  /** Attempts per task the numbers were measured at. One; the reliability reading is a separate round. */
  readonly trials: number;
};

/**
 * The measured configuration. Every field here is quoted by a round that measured it, and the manifest carries the
 * provenance; this constant carries the value.
 */
export const SERVING_DEFAULTS: ServingDefaults = {
  placement: 'tail',
  askSource: 'request',
  settlementGrades: ['name', 'overlap'],
  blockCeilingChars: 500,
  openAskCeiling: 3,
  trials: 1,
} as const;
