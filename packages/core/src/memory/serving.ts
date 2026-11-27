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
 * A settlement grade, widest last.
 *
 * `name` is containment of the product the ask names; `overlap` is at least one shared content word and half the
 * shorter side, which is what a set-shaped ask needs to settle at all. `record` and `handle` are the two grades whose
 * evidence is an **identifier** rather than a product, and they had been produced by the evaluation's board since R238
 * while this vocabulary still named two — a divergence no test could see, because nothing compared the declaration with
 * what the rule emits. R241 made that comparison (`goal_board`'s self-test asserts this exact set against its own
 * four return values) and closed it:
 *
 *   `record`  the ask spells the identifier the receipt carries (`return the sneaker from order #W7449508`), and the
 *             receipt names no product at all. R238 measured this at 28 refusals recovered.
 *   `handle`  the ask spells a handle the database has no identifier for — a phone number — and the episode's own read
 *             resolved it to a record. R241 measured the third domain at 0 of 8 writes reached before this grade and 8
 *             of 8 after, with no sibling line credited.
 */
export const SETTLEMENT_GRADES = ['name', 'overlap', 'record', 'handle'] as const;

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
  /**
   * How many lines a rendered block may spend, which is also the pack's default `limit`.
   *
   * One integer, and it had been written down four times before R236: `buildPack`'s `options.limit ?? query.limit ??
   * 8`, the parser's `MAX_ITEMS`, the instrument's `CAP`, and the R232 registration's arithmetic. Four copies of a
   * constant is four chances to change one, and a window that is eight lines in the measurement and nine in the
   * product is a number that stops being about the shipped artefact. R232 measured what the window hides at this
   * value (14 of 636 reached writes), R233 four, R234 none after the fold — so the value is measured even though it
   * was never chosen, and it is now stated once.
   */
  readonly blockLines: number;
};

/**
 * The measured configuration. Every field here is quoted by a round that measured it, and the manifest carries the
 * provenance; this constant carries the value.
 */
export const SERVING_DEFAULTS: ServingDefaults = {
  placement: 'tail',
  askSource: 'request',
  settlementGrades: ['name', 'overlap', 'record', 'handle'],
  blockCeilingChars: 500,
  openAskCeiling: 3,
  trials: 1,
  blockLines: 8,
} as const;
