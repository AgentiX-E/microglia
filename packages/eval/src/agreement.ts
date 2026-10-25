/**
 * How much a criterion agrees with a reference.
 *
 * This exists because a judge is not validated by agreeing with itself, and it is
 * not validated by agreement alone. Cohen's kappa is prevalence-sensitive: two
 * criteria with the same raw accuracy carry very different kappas depending on how
 * many positives the set happens to contain, and MCC answers a different question
 * again (it weights all four cells instead of chance-correcting the diagonal).
 * Every report therefore carries kappa, MCC and raw accuracy together, plus the
 * confusion matrix they were computed from. A lane that quotes one of the three
 * without the others is quoting the most flattering one.
 *
 * `undefined` rather than a number wherever an estimate does not exist: chance
 * agreement of 1 leaves nothing to divide by, and returning 0 there would read as
 * "no better than chance" when the truth is "this set cannot answer the question".
 * The reason travels with the report so a caller can say which of the two it has.
 */
import { bootstrapCI, mulberry32, type Interval } from '@agentix-e/microglia-core';

/** One item, judged twice: once by the reference, once by the criterion under test. */
export type JudgedPair = {
  readonly reference: boolean;
  readonly measured: boolean;
};

/**
 * The four cells, named by which rater said true rather than by tp/fp.
 *
 * "true positive" presumes a rater is wrong, and in a calibration study neither
 * side is an oracle: the reference is a committee, and the criterion is what we are
 * asking about. Naming the cells `both` / `measuredOnly` / `referenceOnly` /
 * `neither` keeps the arithmetic readable without smuggling in a verdict.
 */
export type Confusion = {
  readonly both: number;
  readonly measuredOnly: number;
  readonly referenceOnly: number;
  readonly neither: number;
};

export type AgreementReport = {
  readonly n: number;
  /** Share of items on which the two raters agree. */
  readonly accuracy: number;
  /** Agreement corrected for what chance would produce. Undefined when chance is all there is. */
  readonly kappa: number | undefined;
  /** Matthews correlation: balanced even when one label dominates. */
  readonly mcc: number | undefined;
  /** Raw agreement, `accuracy`. */
  readonly observed: number;
  /** What independent raters with these marginals would agree on by chance. */
  readonly expected: number;
  readonly prevalence: { readonly reference: number; readonly measured: number };
  readonly confusion: Confusion;
  /** Bootstrap interval over items, absent when kappa itself is. */
  readonly kappaCI: Interval | undefined;
  /** Why kappa is absent, or undefined when it is present. */
  readonly notEstimable: string | undefined;
};

export function confusionOf(pairs: readonly JudgedPair[]): Confusion {
  let both = 0;
  let measuredOnly = 0;
  let referenceOnly = 0;
  let neither = 0;
  for (const pair of pairs) {
    if (pair.reference) {
      if (pair.measured) both += 1;
      else referenceOnly += 1;
    } else if (pair.measured) measuredOnly += 1;
    else neither += 1;
  }
  return { both, measuredOnly, referenceOnly, neither };
}

/** Cohen's kappa for two binary raters, or undefined when chance agreement is total. */
export function cohenKappa(pairs: readonly JudgedPair[]): number | undefined {
  const n = pairs.length;
  if (n === 0) return undefined;
  const { both, measuredOnly, referenceOnly, neither } = confusionOf(pairs);
  const observed = (both + neither) / n;
  const referenceRate = (both + referenceOnly) / n;
  const measuredRate = (both + measuredOnly) / n;
  const expected = referenceRate * measuredRate + (1 - referenceRate) * (1 - measuredRate);
  // Both raters constant with the same label: agreement is perfect and unexplained,
  // and every resample of such a set divides zero by zero. Not estimable, not 1.
  if (expected === 1) return undefined;
  return (observed - expected) / (1 - expected);
}

/** Matthews correlation coefficient, or undefined when a whole row or column is empty. */
export function mccOf(confusion: Confusion): number | undefined {
  const { both, measuredOnly, referenceOnly, neither } = confusion;
  const numerator = both * neither - measuredOnly * referenceOnly;
  const denominator =
    (both + measuredOnly) * (both + referenceOnly) * (neither + measuredOnly) * (neither + referenceOnly);
  if (denominator === 0) return undefined;
  return numerator / Math.sqrt(denominator);
}

/**
 * The three numbers together, with an interval on the one that needs it.
 *
 * `resamples` is a parameter rather than a constant because the study this backs
 * fixes it in its protocol; a silent default would make two reports incomparable
 * while both called themselves "bootstrapped".
 */
export function agreementReport(
  pairs: readonly JudgedPair[],
  options: { readonly seed?: number; readonly resamples?: number } = {},
): AgreementReport {
  const n = pairs.length;
  const confusion = confusionOf(pairs);
  const observed = n === 0 ? 0 : (confusion.both + confusion.neither) / n;
  const referenceRate = n === 0 ? 0 : (confusion.both + confusion.referenceOnly) / n;
  const measuredRate = n === 0 ? 0 : (confusion.both + confusion.measuredOnly) / n;
  const expected = referenceRate * measuredRate + (1 - referenceRate) * (1 - measuredRate);
  const kappa = cohenKappa(pairs);
  const random = mulberry32(options.seed ?? 20261025);
  const resamples = options.resamples ?? 2000;

  let kappaCI: Interval | undefined;
  let notEstimable: string | undefined;
  if (n === 0) {
    notEstimable = 'no-items';
  } else if (kappa === undefined) {
    notEstimable = 'chance-agreement-is-total';
  } else {
    // Resample items, not verdicts: the interval is about which questions this set
    // happens to contain, so a draw must move whole pairs.
    //
    // A draw that contains neither label is constant and contributes no kappa. That
    // cannot empty the interval: with at least one minority item the chance a draw of
    // n misses every one of them is at most (1 - 1/n)^n < 1/e, so more than half of
    // the draws survive for any set on which kappa was estimable at all. The check
    // that would guard an empty array is therefore dead, and is not written.
    const kappas: number[] = [];
    for (let draw = 0; draw < resamples; draw += 1) {
      const sample: JudgedPair[] = [];
      for (let pick = 0; pick < n; pick += 1) {
        sample.push(pairs[Math.floor(random() * n)] as JudgedPair);
      }
      const value = cohenKappa(sample);
      if (value !== undefined) kappas.push(value);
    }
    kappas.sort((a, b) => a - b);
    const lowIndex = Math.floor(0.025 * (kappas.length - 1));
    const highIndex = Math.ceil(0.975 * (kappas.length - 1));
    kappaCI = {
      low: kappas[lowIndex] as number,
      high: kappas[highIndex] as number,
      point: kappa,
    };
  }

  return {
    n,
    accuracy: observed,
    kappa,
    mcc: mccOf(confusion),
    observed,
    expected,
    prevalence: { reference: referenceRate, measured: measuredRate },
    confusion,
    kappaCI,
    notEstimable,
  };
}

/** One rater's verdicts, keyed by item id, so raters that saw different items can be paired. */
export type RaterLabels = ReadonlyMap<string, boolean>;

export type PairwiseAgreement = {
  readonly left: number;
  readonly right: number;
  readonly n: number;
  readonly kappa: number | undefined;
};

export type RaterAgreement = {
  /** Only items rated by at least two raters can contribute a pair. */
  readonly raters: number;
  readonly sharedItems: number;
  readonly pairs: readonly PairwiseAgreement[];
  /** Mean of the estimable pairs, or undefined when none were. */
  readonly meanKappa: number | undefined;
};

/**
 * Agreement between the annotators themselves.
 *
 * This is the number that decides whether a "human" target is a target at all. Before
 * a criterion is held to kappa >= 0.7 against a committee, the committee has to clear
 * 0.7 against itself; a set where they do not is one where the bar describes the
 * annotation, not the judge.
 */
export function raterAgreement(raters: readonly RaterLabels[]): RaterAgreement {
  const pairs: PairwiseAgreement[] = [];
  for (let left = 0; left < raters.length; left += 1) {
    for (let right = left + 1; right < raters.length; right += 1) {
      const a = raters[left] as RaterLabels;
      const b = raters[right] as RaterLabels;
      const judged: JudgedPair[] = [];
      for (const [id, verdict] of a) {
        const other = b.get(id);
        if (other === undefined) continue;
        judged.push({ reference: verdict, measured: other });
      }
      pairs.push({ left, right, n: judged.length, kappa: cohenKappa(judged) });
    }
  }
  const estimable = pairs.filter((pair) => pair.kappa !== undefined);
  const shared = new Set<string>();
  const counts = new Map<string, number>();
  for (const rater of raters) {
    for (const id of rater.keys()) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  for (const [id, count] of counts) if (count >= 2) shared.add(id);
  return {
    raters: raters.length,
    sharedItems: shared.size,
    pairs,
    meanKappa:
      estimable.length === 0
        ? undefined
        : estimable.reduce((sum, pair) => sum + (pair.kappa as number), 0) / estimable.length,
  };
}

/** Re-exported so a study can plug the same interval into a hand-rolled statistic. */
export { bootstrapCI };
