/**
 * What a pool of generators could have scored, and whether the pool is actually pooled.
 *
 * R7.1 asks one question — does widening the candidate set raise the ceiling — and it is answerable
 * from the artefact without another dispatch: every arm already records, per question, whether it
 * was correct. The union over arms is the score of a chooser that always picked right, and the
 * control arm's score is the score of not choosing.
 *
 * The interesting number is not the ceiling. It is the ceiling *minus* the control, because that is
 * the headroom a selector would have to work with, and it is the quantity CHASE-SQL reports as
 * 68.84% → 82.79% across three generators against our +3.52pp across five draws of one.
 *
 * Two readings keep the number honest:
 *
 *  - **A question the control already answered contributes nothing**, whatever the other arms did.
 *    Counting it would let a set of generators that agree on the easy half report a ceiling they did
 *    not create.
 *  - **A generator that alone reaches the union is named.** A pool of three where one arm answers
 *    every question the pool answers is one generator with two extra calls per question, and calling
 *    that diversity would be paying for a number rather than measuring one.
 */

import { verdictOf, type PoolVerdict } from './pool-report.js';

export type UnionCase = {
  readonly id: string;
  /** Whether each arm answered this question, keyed by arm name. */
  readonly correct: Readonly<Record<string, boolean>>;
  /**
   * The execution result each arm produced, keyed by arm name; null when it produced none.
   *
   * Correctness says how many arms were right, which is the ceiling. This says how many *answers*
   * the pool contained, which is what a selector has to rank: three arms that are all wrong and all
   * different are a pool of three, and three arms that are all wrong and all identical are a pool of
   * one with three calls per question.
   *
   * The artefact stores a **digest** of each result rather than the result: equality is the only
   * question asked here, and one `card_games` answer is 12 MB of rows. A caller that has the keys
   * themselves can pass them; nothing in this module distinguishes the two.
   */
  readonly keys?: Readonly<Record<string, string | null>>;
};

/** How many different answers the pool produced per question, and whether that is a pool at all. */
export type UnionDistinct = {
  /** False when no case carried result keys, which is not the same as a measured collapse. */
  readonly measured: boolean;
  /** Arms the share is taken against. */
  readonly arms: number;
  readonly mean: number;
  readonly median: number;
  /** Median distinct answers as a share of the arms: the quantity the verdict is read from. */
  readonly share: number;
  readonly verdict: PoolVerdict;
  readonly histogram: Readonly<Record<string, number>>;
};

export type UnionCeiling = {
  readonly arms: readonly string[];
  readonly questions: number;
  /** Questions each arm answered, in the order the arms were named. */
  readonly perArm: Readonly<Record<string, number>>;
  /** Questions at least one arm answered. */
  readonly union: number;
  /** Questions the control arm answered. */
  readonly control: number;
  /** `union - control`, in percentage points: the headroom a selector could work with. */
  readonly ceilingPp: number;
  /** Share of questions where the arms did not all agree. */
  readonly disagreementShare: number;
  /** The arm that alone answers every question the union answers, or null when none does. */
  readonly dominant: string | null;
  /** Distinct answers the armed pool produced, which is what decides whether it is a pool. */
  readonly distinct: UnionDistinct;
};

/** Middle of a list of counts, averaging the two middles when there is an even number of them. */
function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] as number;
  return ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

/**
 * Distinct answers per question, counted from the result keys.
 *
 * An arm that produced nothing contributes nothing: a statement that did not run is not an answer,
 * and counting its absence as one would let a pool of one answer and three errors report four.
 */
function distinctOf(cases: readonly UnionCase[], names: readonly string[]): UnionDistinct {
  const measured = cases.some((item) => item.keys !== undefined);
  const counts: number[] = [];
  const histogram: Record<string, number> = {};
  for (const item of cases) {
    const seen = new Set<string>();
    for (const name of names) {
      const key = item.keys?.[name];
      if (key !== undefined && key !== null) seen.add(key);
    }
    counts.push(seen.size);
    const bucket = String(seen.size);
    histogram[bucket] = (histogram[bucket] ?? 0) + 1;
  }
  const mid = median(counts);
  const share = names.length === 0 ? 0 : mid / names.length;
  return {
    measured,
    arms: names.length,
    mean: counts.length === 0 ? 0 : counts.reduce((sum, count) => sum + count, 0) / counts.length,
    median: mid,
    share,
    // Unmeasured is not a verdict. Reporting `narrow` for a file that predates the field would turn
    // "we did not look" into "we looked and it collapsed", which is the error this whole stage is
    // about.
    verdict: measured ? verdictOf(share) : 'between',
    histogram,
  };
}

export function unionCeiling(
  cases: readonly UnionCase[],
  control: string,
  arms: readonly string[],
): UnionCeiling {
  const names = [...new Set(arms)];
  // Counted into a map rather than an object indexed by a string, because such an index reads as
  // possibly-undefined under `noUncheckedIndexedAccess` and the fallback that satisfies the compiler
  // is a branch that can never be taken — an uncovered line guarding a case that cannot happen.
  const counts = new Map<string, number>(
    names.map((name) => [name, cases.filter((item) => item.correct[name] === true).length]),
  );
  let union = 0;
  let disagreed = 0;
  for (const item of cases) {
    // A case scored before an arm existed has no entry for it. Absence is "this arm did not
    // answer", not "unknown": `undefined` would poison the count into NaN and hide the ceiling.
    const hits = names.map((name) => item.correct[name] === true);
    const right = hits.filter((hit) => hit).length;
    if (right > 0) union += 1;
    if (right > 0 && right < hits.length) disagreed += 1;
  }
  const questions = cases.length;
  const controlCount = cases.filter((item) => item.correct[control] === true).length;
  const ceilingPp = questions === 0 ? 0 : ((union - controlCount) / questions) * 100;
  let dominant: string | null = null;
  if (union > controlCount) {
    for (const [name, count] of counts) {
      if (count === union) {
        dominant = name;
        break;
      }
    }
  }
  return {
    arms: names,
    questions,
    perArm: Object.fromEntries(counts),
    union,
    control: controlCount,
    ceilingPp,
    disagreementShare: questions === 0 ? 0 : disagreed / questions,
    dominant,
    distinct: distinctOf(cases, names),
  };
}
