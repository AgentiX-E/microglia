/**
 * The configuration this product ships, as data.
 *
 * ## Why a constant rather than a paragraph
 *
 * Every knob in this file has been varied in a registered arm at least once, and the arms live in the eval
 * package while the defaults live here. That split is how a product ends up shipping a configuration no
 * arm ever measured: the lane sets `speakMargin: 0.2` in its own `openMicroglia` call, the win is published
 * as the lane's number, and `createServer` still serves whatever the library default happens to be. Nothing
 * is wrong in either half; the two halves are simply not the same program.
 *
 * So the shipped values are a **record** — five fields, no logic — and both sides read it: the product
 * (`createServer` spreads `serveOptions()`), the ablation host (its control is the profile plus one knob),
 * and `eval/results/serve-profile.json`, which carries the reading that justifies each field or an explicit
 * statement that there is none. `pnpm eval:serve-profile` refuses a record that disagrees with this constant,
 * refuses a `reading` that does not resolve, and refuses a field that claims a reading while shipping the
 * default. A knob can therefore be changed in exactly two ways: with a resolving reading, or by editing this
 * file and the record together — which is a visible diff, not an inherited one.
 *
 * ## Why `null` is a value
 *
 * `null` means "the library's own default", and it is distinct from the default's value on purpose. Two of
 * these knobs are not equivalent to their defaults: `speakMargin: 0` is *not* the same program as an absent
 * margin (`recall` attaches `pack.decision` only when a margin is declared), and `note: 'standard'` is not
 * the same as an absent note if the renderer's default sentence ever moves. Collapsing them here would make
 * `serveOptions()` silently change what a published number measured, so the record keeps "absent" expressible
 * and `serveOptions()` omits those fields rather than filling them in.
 */
import type { RecallQuery } from './types.js';

/** The three note levels, taken from the request type so the two cannot drift. */
export type ServeNote = NonNullable<RecallQuery['note']>;

/** What a host's character budget is charged for. See `RenderOptions.budgetBasis`. */
export type ServeBudgetBasis = 'note-included' | 'note-excluded';

/**
 * The shipped configuration. Every field is a knob the eval package can vary, and every field is absent-able.
 *
 * - `budget` — characters of knowledge per `recall`; `null` is `policy.defaultBudget`.
 * - `note` — the sentence a pack opens with; `null` is the renderer's own default.
 * - `budgetBasis` — what the budget pays for; `null` is `note-included`, the accounting every published
 *   number was produced under.
 * - `speakMargin` — how far ahead the best candidate must be before `recall` speaks; `null` is "always speak".
 * - `credit` — whether feedback is applied to the knowledge that was in the prompt.
 */
export type ServeProfile = {
  readonly budget: number | null;
  readonly note: ServeNote | null;
  readonly budgetBasis: ServeBudgetBasis | null;
  readonly speakMargin: number | null;
  readonly credit: boolean;
};

/** The fields, in the order the audit prints them. Every key of `ServeProfile` appears exactly once. */
export const SERVE_PROFILE_FIELDS = ['budget', 'note', 'budgetBasis', 'speakMargin', 'credit'] as const;

export type ServeField = (typeof SERVE_PROFILE_FIELDS)[number];

/**
 * What the product ships today.
 *
 * Four fields are `null` because the library default *is* the shipped behaviour, and `credit: true` is
 * stated because it is the one knob whose library default is a decision rather than an absence. Changing a
 * value here is a product change: the record in `eval/results/serve-profile.json` has to move with it, and
 * that is the point.
 */
export const SERVE_PROFILE: ServeProfile = Object.freeze({
  budget: null,
  note: null,
  budgetBasis: null,
  speakMargin: null,
  credit: true,
});

/** The subset of `MicrogliaOptions` a profile decides, with absent fields absent rather than defaulted. */
export type ServeOptionValues = {
  readonly budget?: number;
  readonly note?: ServeNote;
  readonly budgetBasis?: ServeBudgetBasis;
  readonly speakMargin?: number;
  readonly credit?: boolean;
};

/**
 * The options a host passes to `openMicroglia`, derived from the profile.
 *
 * Omitted rather than defaulted, for the reason in the module comment: an absent `speakMargin` and a
 * `speakMargin` of `0` are two different programs, so a function that filled in the default would be
 * changing the measurement it is supposed to bind.
 */
export function serveOptions(profile: ServeProfile = SERVE_PROFILE): ServeOptionValues {
  return {
    ...(profile.budget === null ? {} : { budget: profile.budget }),
    ...(profile.note === null ? {} : { note: profile.note }),
    ...(profile.budgetBasis === null ? {} : { budgetBasis: profile.budgetBasis }),
    ...(profile.speakMargin === null ? {} : { speakMargin: profile.speakMargin }),
    credit: profile.credit,
  };
}

export type ServeProfileDivergence = {
  readonly field: ServeField;
  readonly shipped: unknown;
  readonly recorded: unknown;
};

export type ServeProfileDiff = {
  /** Fields the record carries that the product does not: a record cannot invent a knob. */
  readonly unknown: readonly string[];
  /** Fields the product ships that the record does not mention: a shipped knob must be accounted for. */
  readonly missing: readonly ServeField[];
  /** Fields both carry, with different values. */
  readonly differing: readonly ServeProfileDivergence[];
};

/**
 * Compare a record's `profile` block against the shipped profile.
 *
 * Strict inequality on purpose: `1200` and `"1200"` are a divergence, because the second one is a record
 * that parsed its own value loosely and the product would not. A record that is missing a field is a
 * divergence rather than a default, since a defaulted field is exactly the drift this module exists to
 * prevent.
 */
export function diffServeProfile(
  recorded: Readonly<Record<string, unknown>>,
  shipped: ServeProfile = SERVE_PROFILE,
): ServeProfileDiff {
  const known = new Set<string>(SERVE_PROFILE_FIELDS);
  const unknown = Object.keys(recorded).filter((key) => !known.has(key));
  const missing = SERVE_PROFILE_FIELDS.filter((field) => !(field in recorded));
  const differing: ServeProfileDivergence[] = [];
  for (const field of SERVE_PROFILE_FIELDS) {
    if (!(field in recorded)) continue;
    if (recorded[field] !== shipped[field]) {
      differing.push({ field, shipped: shipped[field], recorded: recorded[field] });
    }
  }
  return { unknown, missing, differing };
}

/** Whether a diff says the record and the product agree, which is the only state that ships. */
export function sameServeProfile(diff: ServeProfileDiff): boolean {
  return diff.unknown.length === 0 && diff.missing.length === 0 && diff.differing.length === 0;
}

/**
 * One line per field, for a terminal and for the docs.
 *
 * `null` is rendered as the default it means rather than as `null`: a reader who sees `budget null` learns
 * nothing, and a reader who sees `budget 1200 (policy default)` learns what the product charges.
 */
export function describeServeProfile(profile: ServeProfile = SERVE_PROFILE): readonly string[] {
  const render = (field: ServeField): string => {
    const value = profile[field];
    if (value === null) return field === 'budget' ? 'null (policy.defaultBudget)' : 'null (library default)';
    return String(value);
  };
  return SERVE_PROFILE_FIELDS.map((field) => `${field.padEnd(13)} ${render(field)}`);
}
