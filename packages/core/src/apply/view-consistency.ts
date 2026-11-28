/**
 * Cross-view utility consistency: a write-side gate that refuses a correction whose usefulness depends on how it
 * is analysed (R246).
 *
 * ## The question this answers
 *
 * The store decides what to keep with `admitWrite` — a candidate is compared with its nearest neighbours by
 * lexical or embedding similarity, and merged or added. That is a question about *duplicates*. It cannot ask a
 * different question: given one correction, is the rule itself durable, or is it an artifact of the one way this
 * project happened to distil it? A rule that helps under one analysis and hurts under another is not a duplicate
 * to merge; it is a fragile claim that should never have been persisted, because the next analysis re-derives it
 * with the opposite sign and the two then contradict each other in the pack.
 *
 * Three 2026 results put a number on this failure and locate the mechanism here:
 *
 *  - **SPLICE** (arXiv 2610.30790): analysing the same experience different ways yields knowledge with
 *    *substantially different utility*; keeping only candidates whose utility gain is consistent across views
 *    is the admission rule that survives. This module is that rule, as a pure function over utility readings a
 *    caller already collected — no model is called, no benchmark number is imported.
 *  - **Anti-Persistence** (arXiv 2610.27406): an error stored as an abstraction regenerates through the
 *    abstraction → execution → re-abstraction loop even after the original entry is removed. A sign-flipping
 *    candidate is exactly such an error caught before it is stored.
 *  - **Faulty Memory** (UIUC): consolidating a trajectory into a reusable lesson made GPT-5.4 fall from 100% to
 *    54% on ARC-AGI; the original episode was more valuable than the abstraction. The gain here is not claimed
 *    on that benchmark; the mechanism — abstraction that does not survive re-analysis — is the same one.
 *
 * ## What a "view" is, and why the caller supplies it
 *
 * A view is one independent analysis of the same experience: a temperature, a prompt, an interpreter. Each yields
 * a `Utility` reading — how many times the item was injected and how often the outcome flipped up or down. The
 * caller collects those readings (the product does not run a model here); this module only decides what they
 * jointly say. Net gain per view is `(flippedUp - flippedDown) / injected`, and the *sign* of the net flip is the
 * durable signal: a view with injected = 0 or equal flips is an abstention, not a contradiction.
 *
 * ## The verdicts, and the decision they license
 *
 *  - `consistent-help` — at least `minViews` informative views, all with a positive net. **Admit.**
 *  - `fragile` — some views positive and some negative. The same rule helped and hurt depending on the lens;
 *    refuse it before it becomes a contradiction in the store.
 *  - `consistent-harm` — informative views exist and all lose on net. Refuse: this rule makes things worse.
 *  - `no-signal` — enough views, but none has a net gain either way. Refuse: there is no evidence to persist.
 *  - `insufficient` — fewer than `minViews` views. Refuse: consistency over one view is not consistency.
 *
 * Only `consistent-help` sets `admit`. This is deliberately stricter than "not shown to hurt": SPLICE's result is
 * about *keeping* consistent candidates, and an abstention-equivalent rule is not one we have evidence to keep.
 *
 * ## Discipline
 *
 * Pure and deterministic. The verdict does not depend on view order (counts and sums are order-free), gains and
 * spread are reported for a readback but never gate the decision, and every guard refuses rather than defaults —
 * a malformed reading would otherwise quietly become a vote. Like `stateRole`, nothing is wired into the default
 * write path: a caller opts in by calling this gate, so every committed artefact stays byte-identical.
 */
import { MicrogliaError } from '../kernel/index.js';

/** The closed, ordered vocabulary of verdicts. Order is part of the contract. */
export const VIEW_VERDICTS = [
  'consistent-help',
  'consistent-harm',
  'fragile',
  'no-signal',
  'insufficient',
] as const;

export type ViewVerdict = (typeof VIEW_VERDICTS)[number];

/**
 * One independent analysis's utility reading for the same candidate.
 *
 * The three counts mirror `Utility`: `injected` is how many outcomes saw the item, `flippedUp` how many of those
 * improved, `flippedDown` how many worsened. `view` is a caller-supplied label (temperature, prompt id), used only
 * to refuse duplicates and to name a guard violation — it never enters the decision.
 */
export type ViewUtility = {
  readonly view: string;
  readonly injected: number;
  readonly flippedUp: number;
  readonly flippedDown: number;
};

export type ViewConsensusOptions = {
  /** Minimum number of views required before consistency is claimable. Default 2, integer >= 1. */
  readonly minViews?: number;
};

export type ViewConsensus = {
  readonly verdict: ViewVerdict;
  /** True only for `consistent-help`. */
  readonly admit: boolean;
  /** Number of views read. */
  readonly views: number;
  readonly positive: number;
  readonly negative: number;
  readonly zero: number;
  /** Sum of net flips across all views. */
  readonly net: number;
  /** Per-view gain rate `(flippedUp - flippedDown) / injected` in input order; 0 for injected = 0. */
  readonly gains: readonly number[];
  /** Largest gain minus smallest gain; 0 when fewer than two views. Reported, never gated. */
  readonly spread: number;
  /** The floor that was applied. */
  readonly minViews: number;
};

function integerIn(value: number, name: string, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    // The label is in the message, not only in details: a host that logs the error (the common case) sees
    // which analysis produced the bad reading without having to know this error's detail schema.
    throw new MicrogliaError(
      'MG_E_CONFIG',
      `view '${label}': ${name} must be a non-negative integer`,
      { view: label, value },
    );
  }
}

/**
 * Reduce several view readings to one admission decision.
 *
 * Refuses malformed input rather than treating it as a vote: a duplicate label would let one analysis count
 * twice, and `flippedUp + flippedDown > injected` is impossible if the counts describe real outcomes — letting it
 * through would let a fabricated reading steer the gate.
 */
export function viewConsensus(
  views: readonly ViewUtility[],
  options: ViewConsensusOptions = {},
): ViewConsensus {
  const minViews = options.minViews ?? 2;
  if (!Number.isInteger(minViews) || minViews < 1) {
    throw new MicrogliaError('MG_E_CONFIG', 'minViews must be a positive integer', { minViews });
  }

  const seen = new Set<string>();
  for (const reading of views) {
    if (typeof reading.view !== 'string' || reading.view.trim() === '') {
      throw new MicrogliaError('MG_E_CONFIG', 'view label must be a non-blank string', {
        view: reading.view,
      });
    }
    if (seen.has(reading.view)) {
      throw new MicrogliaError('MG_E_CONFIG', `duplicate view label '${reading.view}'`, {
        view: reading.view,
      });
    }
    seen.add(reading.view);
    integerIn(reading.injected, 'injected', reading.view);
    integerIn(reading.flippedUp, 'flippedUp', reading.view);
    integerIn(reading.flippedDown, 'flippedDown', reading.view);
    if (reading.flippedUp + reading.flippedDown > reading.injected) {
      throw new MicrogliaError(
        'MG_E_CONFIG',
        `view '${reading.view}': flips cannot exceed injected`,
        {
          view: reading.view,
          injected: reading.injected,
          flippedUp: reading.flippedUp,
          flippedDown: reading.flippedDown,
        },
      );
    }
  }

  let positive = 0;
  let negative = 0;
  let zero = 0;
  let net = 0;
  const gains: number[] = [];
  for (const reading of views) {
    const delta = reading.flippedUp - reading.flippedDown;
    net += delta;
    gains.push(reading.injected === 0 ? 0 : delta / reading.injected);
    if (delta > 0) positive += 1;
    else if (delta < 0) negative += 1;
    else zero += 1;
  }

  const spread = gains.length < 2 ? 0 : Math.max(...gains) - Math.min(...gains);

  let verdict: ViewVerdict;
  if (views.length < minViews) verdict = 'insufficient';
  else if (positive > 0 && negative > 0) verdict = 'fragile';
  else if (negative > 0) verdict = 'consistent-harm';
  else if (positive > 0) verdict = 'consistent-help';
  else verdict = 'no-signal';

  return {
    verdict,
    admit: verdict === 'consistent-help',
    views: views.length,
    positive,
    negative,
    zero,
    net,
    gains,
    spread,
    minViews,
  };
}
