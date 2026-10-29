/**
 * Memory as a verifier prior, priced before it is built.
 *
 * Four positions for memory have now been measured on this harness. As a prompt prefix it costs
 * `-3.14pp` (p = 0.071) and has cost that in every run since R4. On retry it is worth `+0.29pp` over a
 * retry with an empty pack — nothing, once the retry itself is controlled. As a selection feature its
 * content never enters, because the selectors read result shapes. And as an oracle over the pool it
 * is worth at most the ceiling, which is 7.14pp and which no selector has ever captured.
 *
 * What is left is the position nobody has put a number on: memory *judging* a candidate rather than
 * proposing one. That is a different question from "is the rule relevant", and it is the one this
 * module prices — with no model call, because the price can be computed from a pool an earlier run
 * already recorded.
 *
 * The prior is deliberately the strongest version of the idea. It assumes extraction and retrieval
 * are perfect: it does not read the rule text, does not filter by relevance, does not consult an
 * embedding. It asks only "on this database, how often did a result of this shape turn out right",
 * answered from the *other* folds. If a verifier with perfect recall cannot beat the first draw, no
 * verifier built out of the same signal can, and the next iteration should not be spent on one.
 *
 * Three keys, one function. `db-signature` is the memory-shaped key — a database and a result shape.
 * `signature` drops the database, `db` drops the shape; the three together say whether the effect is
 * the schema or the shape or just the base rate of a database, which is the difference between
 * memory and a lookup table of "which databases are hard".
 *
 * Two decisions fixed here rather than fitted later:
 *
 *  - **The key rounds the continuous fields to two decimals.** `nullShare` and `duplicateShare` are
 *    ratios in [0, 1]; keeping full precision would give every candidate its own key and the prior
 *    would have no support anywhere. Two decimals collapses 1,750 candidates on BIRD Mini-Dev to 124
 *    keys, which is the coarseness the idea needs to exist at all — the claim is about shapes, not
 *    about individual answers.
 *  - **The share is Jeffreys-smoothed, `(wrong + 0.5) / (n + 1)`.** An unseen key reads exactly 0.5,
 *    which is neutral, which the tie-break resolves as the first draw. A prior that abstains
 *    therefore reproduces the baseline instead of inventing a preference, and the arm's delta is a
 *    measurement of the keys that had support rather than of the tie-break.
 */

import { mcnemarExact } from '@agentix-e/microglia-core';
import { FAILED_SIGNATURE, type ExecSignature } from './exec-signature.js';

/** Which part of a candidate identifies the memory it is looked up under. */
export const PRIOR_SCOPES = ['db-signature', 'signature', 'db'] as const;

export type PriorScope = (typeof PRIOR_SCOPES)[number];

/** A candidate, reduced to what a prior can see. */
export type PriorCandidate = {
  readonly draw: number;
  readonly correct: boolean;
  readonly signature: ExecSignature | null;
};

/** A case, reduced to what a prior can see. */
export type PriorCase = {
  readonly id: string;
  readonly dbId: string;
  readonly fold: number;
  readonly candidates: readonly PriorCandidate[];
};

/** One question's decision, and how much support the winner had behind it. */
export type PriorPick = {
  /** Index into `candidates`, or -1 when the question offered no choice to make. */
  readonly chosen: number;
  /** Candidates in other folds that share the winner's key. */
  readonly support: number;
  /** Jeffreys-smoothed share of those that were wrong; 0.5 when there were none. */
  readonly share: number;
};

export type PriorReading = {
  readonly scope: PriorScope;
  /** False when the artefact lacks the fields the key needs, in which case nothing is measured. */
  readonly measurable: boolean;
  /** Cases the reading saw. */
  readonly questions: number;
  /** Questions where the candidates fall under at least two keys, so a choice exists. */
  readonly choices: number;
  /** Questions where the winner's key appeared in another fold. */
  readonly covered: number;
  /** Distinct keys in the corpus: how much memory there is to look anything up in. */
  readonly keys: number;
  /** Accuracy of the prior on `choices`. */
  readonly accuracy: number;
  /** Accuracy of the first draw on the same subset. */
  readonly baseline: number;
  readonly deltaPp: number;
  readonly gained: number;
  readonly lost: number;
  readonly p: number;
};

/**
 * The key a candidate is remembered under.
 *
 * A candidate that produced no statement is keyed as `none` rather than skipped: "on this database,
 * a draw that failed" is a frequency worth knowing, and dropping those candidates would make the
 * prior silently prefer whichever shape survived the filter.
 */
export function keyOf(scope: PriorScope, dbId: string, signature: ExecSignature | null): string {
  const shape = signature ?? FAILED_SIGNATURE;
  const signatureKey =
    signature === null
      ? 'none'
      : [
          shape.failed ? 'F' : 'ok',
          shape.empty ? 'E' : 'ne',
          shape.rowCount,
          shape.columnCount,
          shape.nullShare.toFixed(2),
          shape.duplicateShare.toFixed(2),
          shape.numericOnly ? 'N' : 'x',
          shape.scalar ? 'S' : 's',
        ].join('|');
  if (scope === 'signature') return signatureKey;
  if (scope === 'db') return dbId;
  return `${dbId}\u0001${signatureKey}`;
}

type Tally = { readonly wrong: number; readonly total: number };

/** One key's record: the corpus total, and the same total split by fold so a fold can be removed. */
type Group = { readonly all: Tally; readonly byFold: Map<number, Tally> };

function bumped(tally: Tally, correct: boolean): Tally {
  return { wrong: tally.wrong + (correct ? 0 : 1), total: tally.total + 1 };
}

/**
 * Scores every candidate against the outcomes of the other folds.
 *
 * The subtraction is what keeps the protocol honest: the totals include the question's own fold, and
 * the per-fold table is removed before the share is computed, so a question can never be helped by
 * its own answer. Building the prior from the other folds only, then reading it, is the same
 * cross-fitting the rules go through; a prior that had seen the fold it scores would be reporting a
 * lookup rather than a memory.
 */
export function priorPicks(cases: readonly PriorCase[], scope: PriorScope): readonly PriorPick[] {
  // The keys are computed once and kept beside the candidates they came from. Looking them up a
  // second time from a rebuilt signature would be the same string computed twice, and the two
  // computations are exactly the kind of pair that drifts when a field is added to `ExecSignature`.
  const keys = cases.map((entry) =>
    entry.candidates.map((candidate) => keyOf(scope, entry.dbId, candidate.signature)),
  );
  const groups = new Map<string, Group>();
  for (const [at, entry] of cases.entries()) {
    for (const [which, candidate] of entry.candidates.entries()) {
      const key = (keys[at] as readonly string[])[which] as string;
      const group = groups.get(key) ?? { all: { wrong: 0, total: 0 }, byFold: new Map() };
      const own = group.byFold.get(entry.fold) ?? { wrong: 0, total: 0 };
      group.byFold.set(entry.fold, bumped(own, candidate.correct));
      groups.set(key, { all: bumped(group.all, candidate.correct), byFold: group.byFold });
    }
  }

  return cases.map((entry, at) => {
    const own = keys[at] as readonly string[];
    if (new Set(own).size < 2) return { chosen: -1, support: 0, share: 0.5 };
    const scored = own.map((key) => {
      const group = groups.get(key) as Group;
      const here = group.byFold.get(entry.fold) as Tally;
      const support = group.all.total - here.total;
      const wrong = group.all.wrong - here.wrong;
      // Jeffreys: an unseen key sits at exactly one half, which is a tie, which the comparison below
      // resolves as the first draw. Abstaining and agreeing behave the same way, on purpose.
      return { support, share: (wrong + 0.5) / (support + 1) };
    });
    let chosen = 0;
    for (let index = 1; index < scored.length; index += 1) {
      if ((scored[index] as { share: number }).share < (scored[chosen] as { share: number }).share) {
        chosen = index;
      }
    }
    const winner = scored[chosen] as { support: number; share: number };
    return { chosen, support: winner.support, share: winner.share };
  });
}

/** The prior's accuracy against the first draw's, on the questions where it could decide. */
export function priorReading(cases: readonly PriorCase[], scope: PriorScope): PriorReading {
  const measurable = cases.every(
    (entry) => entry.dbId.length > 0 && Number.isInteger(entry.fold) && entry.candidates.length > 0,
  );
  const picks = priorPicks(cases, scope);
  const keys = new Set<string>();
  let choices = 0;
  let covered = 0;
  let right = 0;
  let baselineRight = 0;
  let gained = 0;
  let lost = 0;
  for (const [at, entry] of cases.entries()) {
    for (const candidate of entry.candidates) keys.add(keyOf(scope, entry.dbId, candidate.signature));
    const pick = picks[at] as PriorPick;
    const first = entry.candidates[0] as PriorCandidate;
    const picked = entry.candidates[pick.chosen];
    if (picked === undefined) continue;
    choices += 1;
    if (pick.support > 0) covered += 1;
    if (picked.correct) right += 1;
    if (first.correct) baselineRight += 1;
    if (picked.correct && !first.correct) gained += 1;
    if (!picked.correct && first.correct) lost += 1;
  }
  const accuracy = choices === 0 ? 0 : right / choices;
  const baseline = choices === 0 ? 0 : baselineRight / choices;
  return {
    scope,
    measurable,
    questions: cases.length,
    choices,
    covered,
    keys: keys.size,
    accuracy,
    baseline,
    deltaPp: (accuracy - baseline) * 100,
    gained,
    lost,
    p: gained + lost === 0 ? 1 : mcnemarExact(lost, gained),
  };
}

/** Every scope at once, because one row cannot say whether the effect is the schema or the shape. */
export function priorTable(cases: readonly PriorCase[]): readonly PriorReading[] {
  return PRIOR_SCOPES.map((scope) => priorReading(cases, scope));
}
