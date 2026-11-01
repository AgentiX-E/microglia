/**
 * Whether the read-time filter is a property of the *query* or only of the *diff*.
 *
 * Every measurement of the filter so far — §140 through §147 — compared two statements: the bare
 * attempt and the memory-served one, and flagged the served one when it named something the bare one
 * and the question did not. That establishes that the difference carries the signal. It does not
 * establish that a query does, and a deployment without rules has no difference to look at.
 *
 * R33 stage 0 asks the narrower question directly: point the same grounding rule at a single query,
 * anchor it on the question alone, and see whether the flag still finds the attempts that failed. This
 * module is that reading, and it costs no model call — `per_case` already stores both queries.
 *
 * The rule is deliberately not re-implemented. `diffQueries('', sql, …)` is the same tokeniser and the
 * same two grounding modes the F1 covariate used, with an empty baseline, so the only thing that
 * differs between this reading and §146's is the anchor. A second implementation of "is this name
 * implied" would differ from the first by exactly the thing that is under test.
 */
import { clusteredGapOf, fisherExact, type ScoredRow } from './query-diff.js';
import { diffQueries, type GroundingMode } from './sql-diff.js';

/** One attempt, its question, and whether it was right. */
export type ValidityCase = {
  readonly id: string;
  readonly dbId: string;
  readonly question: string;
  /** The external-knowledge block, which grounds a name because the solver may read it. */
  readonly evidence: string;
  /** The single query under test — the bare attempt, or the served one. */
  readonly sql: string;
  readonly correct: boolean;
};

/** What one side of the flag looks like. */
export type ValidityArm = {
  readonly n: number;
  readonly share: number;
  readonly wrong: number;
  /** `null` when the arm is empty: a rate over nothing is not zero. */
  readonly accuracyPp: number | null;
};

export type ValidityReading = {
  /** The grounding rule this reading used, carried so two readings cannot be compared across rules. */
  readonly rule: GroundingMode;
  /** Cases the rule could be asked about: every case with a query for this arm. */
  readonly n: number;
  /** Cases dropped because the arm holds no query at all, which is a fact about the artefact. */
  readonly excluded: number;
  readonly databases: number;
  readonly accuracyPp: number | null;
  readonly flagged: ValidityArm;
  readonly clean: ValidityArm;
  /** `accuracy(flagged) − accuracy(clean)`. Negative when the flag finds the failures. */
  readonly gapPp: number | null;
  readonly gapHalfWidthPp: number | null;
  /** Percentile interval over databases, or `null` when the corpus has fewer than two. */
  readonly clusterLowPp: number | null;
  readonly clusterHighPp: number | null;
  /** Exact Fisher test on the 2×2 of flag against outcome. */
  readonly fisherP: number;
  readonly resolves: boolean;
  /** `P(flag | wrong)`: of the attempts that failed, the share the rule caught. */
  readonly sensitivity: number | null;
  /** `P(no flag | right)`: of the attempts that passed, the share the rule left alone. */
  readonly specificity: number | null;
  /** `sensitivity + specificity − 1`. Zero for a rule that fires independently of the outcome. */
  readonly youdenJ: number | null;
};

/**
 * The names a query uses that its question does not imply.
 *
 * An empty baseline is the whole of the difference from §146's covariate: `diffQueries` reports what
 * the second query *adds* to the first, so against nothing it reports everything the query uses, and
 * the grounding test then decides which of those the text supports.
 */
export function importedNamesOf(
  sql: string,
  question: string,
  evidence: string,
  rule: GroundingMode = 'strict',
): readonly string[] {
  const delta = diffQueries('', sql, question, evidence);
  return rule === 'strict' ? delta.ungrounded : delta.ungroundedLoose;
}

/** Whether the rule would hold this attempt back. */
export function flagOf(entry: ValidityCase, rule: GroundingMode = 'strict'): boolean {
  return importedNamesOf(entry.sql, entry.question, entry.evidence, rule).length > 0;
}

function armOf(rows: readonly ValidityCase[], total: number): ValidityArm {
  const wrong = rows.filter((entry) => !entry.correct).length;
  return {
    n: rows.length,
    share: total === 0 ? 0 : rows.length / total,
    wrong,
    accuracyPp: rows.length === 0 ? null : ((rows.length - wrong) / rows.length) * 100,
  };
}

/**
 * Score one corpus twice: with the flag, and without it.
 *
 * The interval resamples databases for the reason §143 established — one package of rules, or one
 * schema, reaches every question in a database, so questions inside one are not independent — and
 * `withoutMemoryCorrect` is set to `false` for every row because there is no second arm here: the
 * paired difference of an attempt against nothing is its own correctness, which is what makes
 * `clusteredGapOf` resample accuracy rather than a contrast.
 */
export function validityReadingOf(
  cases: readonly ValidityCase[],
  options: { readonly rule?: GroundingMode; readonly resamples?: number; readonly seed?: number } = {},
): ValidityReading {
  const rule = options.rule ?? 'strict';
  const resamples = options.resamples ?? 10_000;
  const seed = options.seed ?? 12345;
  // A case with no query cannot be judged: the rule's predicate is undefined on the empty string,
  // and counting it as unflagged would put the artifact's parse failures into the clean group and
  // bias the gap toward zero. The count travels with the reading so the exclusion is visible.
  const judgeable = cases.filter((entry) => entry.sql.trim() !== '');
  const excluded = cases.length - judgeable.length;
  const flagged = judgeable.filter((entry) => flagOf(entry, rule));
  const clean = judgeable.filter((entry) => !flagOf(entry, rule));
  const row = (entry: ValidityCase): ScoredRow => ({
    dbId: entry.dbId,
    correct: entry.correct,
    withoutMemoryCorrect: false,
  });
  const present = flagged.map(row);
  const absent = clean.map(row);
  const flaggedArm = armOf(flagged, judgeable.length);
  const cleanArm = armOf(clean, judgeable.length);
  const databases = new Set(judgeable.map((entry) => entry.dbId)).size;
  const wrongFlagged = flaggedArm.wrong;
  const wrongClean = cleanArm.wrong;
  const rightFlagged = flagged.length - wrongFlagged;
  const rightClean = clean.length - wrongClean;
  const share = (part: number, whole: number): number | null => (whole === 0 ? null : part / whole);
  const gapPp =
    flaggedArm.accuracyPp === null || cleanArm.accuracyPp === null
      ? null
      : flaggedArm.accuracyPp - cleanArm.accuracyPp;
  const interval = clusteredGapOf(present, absent, resamples, seed);
  const sensitivity = share(wrongFlagged, wrongFlagged + wrongClean);
  const specificity = share(rightClean, rightFlagged + rightClean);
  const correct = judgeable.length - wrongFlagged - wrongClean;
  return {
    rule,
    n: judgeable.length,
    excluded,
    databases,
    accuracyPp: judgeable.length === 0 ? null : (correct / judgeable.length) * 100,
    flagged: flaggedArm,
    clean: cleanArm,
    gapPp,
    gapHalfWidthPp:
      interval === null ? null : (Math.abs((interval.highPp as number) - (interval.lowPp as number)) / 2),
    clusterLowPp: interval === null ? null : interval.lowPp,
    clusterHighPp: interval === null ? null : interval.highPp,
    fisherP: fisherExact(wrongFlagged, rightFlagged, wrongClean, rightClean),
    resolves:
      interval !== null && ((interval.lowPp as number) > 0 || (interval.highPp as number) < 0),
    sensitivity,
    specificity,
    youdenJ: sensitivity === null || specificity === null ? null : sensitivity + specificity - 1,
  };
}

/**
 * The bar the registration turns into a threshold, computed rather than transcribed.
 *
 * The memory filter's Youden index out of sample: 76 of 237 breaks caught, 40 of 187 repairs given
 * up. Deriving it here rather than writing `0.107` means the threshold moves if the filter's own
 * numbers ever move, which is the only version of this that cannot go stale.
 */
export const MEMORY_FILTER_YOUDEN = 76 / 237 + (187 - 40) / 187 - 1;

/** The floors `prereg/R33.md` registered. One constant per prediction, so a test can name them. */
export const R33_BARS = {
  /** P2: the strict rule fires on at least this share of bare attempts. */
  strictFlagShare: 0.6,
  /** P2: and the morphological rule on at least this share. */
  looseFlagShare: 0.4,
  /** P3: flagged attempts are at least this much less accurate, in percentage points. */
  gapPp: -5,
  /** P4: dev's gap is within this distance of train's. */
  agreementPp: 4,
  /** P6: the served query is flagged at least this much more often than the bare one. */
  addedShare: 0.05,
} as const;

/** One arm of one split: the corpus, and the two rules it was read under. */
export type ValiditySplit = {
  readonly n: number;
  /** Cases with no bare query at all. Zero on a clean artefact; ten out of sample. */
  readonly bareMissing: number;
  /** Cases with no served query, which is what a parse failure looks like in this format. */
  readonly servedMissing: number;
  /**
   * Whether every missing query is one the run already records as a failure.
   *
   * This is P1 as amended, and it is deliberately not "no case is missing a query": ten rows out of
   * sample carry no bare query at all, which is a defect in the source artefact rather than in this
   * reading, and a gate that cannot tell the two apart would either block on a data fact or hide it.
   */
  readonly complete: boolean;
  readonly bare: ValidityReading;
  readonly served: ValidityReading;
  readonly bareLoose: ValidityReading;
  readonly servedLoose: ValidityReading;
};

export type R33Verdict = {
  readonly id: string;
  readonly claim: string;
  readonly observed: string;
  readonly holds: boolean;
};

const pp = (value: number | null): string => (value === null ? 'n/a' : `${value.toFixed(2)}pp`);
// Not nullable, unlike `pp`: every share this file formats comes from a bar or a corpus that has one,
// and a null branch here would be a branch no corpus can reach.
const pc = (value: number): string => `${(value * 100).toFixed(1)}%`;
const jay = (value: number | null): string => (value === null ? 'n/a' : value.toFixed(4));

/**
 * Adjudicate the six registrations against two splits.
 *
 * Each verdict reports the number it was decided on, so a reader can disagree with the threshold
 * without having to recompute the reading. `holds` is the registration's, not the author's: the
 * sentences lived in `prereg/R33.md` before any of these numbers existed.
 */
export function adjudicateR33(input: { readonly train: ValiditySplit; readonly dev: ValiditySplit }): readonly R33Verdict[] {
  const { train, dev } = input;
  const strictBare = train.bare.flagged.share;
  const looseBare = train.bareLoose.flagged.share;
  const gapTrain = train.bare.gapPp;
  const gapDev = dev.bare.gapPp;
  const jTrain = train.bare.youdenJ;
  const jDev = dev.bare.youdenJ;
  const added = train.served.flagged.share - train.bare.flagged.share;
  const instrument = train.complete && dev.complete && train.n === 7000 && dev.n === 1534;
  const missing = (split: ValiditySplit): string =>
    `${split.bareMissing} bare, ${split.servedMissing} served`;
  return [
    {
      id: 'P1',
      claim: 'both corpora load at the registered sizes, and every missing query is one the run already records as a failure',
      observed: `${train.n} train (${missing(train)}), ${dev.n} dev (${missing(dev)})`,
      holds: instrument,
    },
    {
      id: 'P2',
      claim: `the strict rule flags at least ${pc(R33_BARS.strictFlagShare)} of bare attempts and the loose rule ${pc(R33_BARS.looseFlagShare)}`,
      observed: `${pc(strictBare)} strict, ${pc(looseBare)} morphological`,
      holds: strictBare >= R33_BARS.strictFlagShare && looseBare >= R33_BARS.looseFlagShare,
    },
    {
      id: 'P3',
      claim: `flagged bare attempts are at least ${Math.abs(R33_BARS.gapPp)}pp less accurate, on an interval that excludes zero`,
      observed: `${pp(gapTrain)} [${pp(train.bare.clusterLowPp)}, ${pp(train.bare.clusterHighPp)}], ${train.bare.resolves ? 'excludes zero' : 'covers zero'}`,
      holds: gapTrain !== null && gapTrain <= R33_BARS.gapPp && train.bare.resolves,
    },
    {
      id: 'P4',
      claim: `dev's gap has the same sign and is within ${R33_BARS.agreementPp}pp of train's`,
      observed: `${pp(gapDev)} against ${pp(gapTrain)}`,
      holds: gapDev !== null && gapTrain !== null && gapDev < 0 && Math.abs(gapDev - gapTrain) <= R33_BARS.agreementPp,
    },
    {
      id: 'P5',
      claim: `the question-only check clears the memory filter's Youden of ${MEMORY_FILTER_YOUDEN.toFixed(4)} on both splits`,
      observed: `${jay(jTrain)} train, ${jay(jDev)} dev`,
      holds: jTrain !== null && jDev !== null && jTrain >= MEMORY_FILTER_YOUDEN && jDev >= MEMORY_FILTER_YOUDEN,
    },
    {
      id: 'P6',
      claim: `the served query is flagged at least ${pc(R33_BARS.addedShare)} more often than the bare one`,
      observed: `${pp(added * 100)}`,
      holds: added >= R33_BARS.addedShare,
    },
  ];
}
