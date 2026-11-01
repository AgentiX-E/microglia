/**
 * What the out-of-sample split says about a hypothesis that was formed on dev.
 *
 * Every estimate this record has of its own memory mechanism was formed and measured on the same
 * 1,534 questions, so "the hypothesis is the corpus" was not a caveat but a structural fact. R30
 * stage 2 paid 14,479 model calls to measure the same contrast on 7,000 questions over 58
 * databases that dev does not contain.
 *
 * This module holds the arithmetic that verdict needs, and the verdicts themselves as data, so that
 * a prediction cannot be quietly re-read once its number is in. The three pieces:
 *
 *  - **a clustered interval.** `comparePaired` resamples questions, and questions inside a database
 *    are not independent — the same package of rules reaches every one of them. The interval that
 *    decides this round resamples databases, which is the check that closed R32's first axis and
 *    that no headline number had been through.
 *  - **a fold sign test.** Five folds, each with its own learned store. A direction that 3 of 5
 *    folds contradict is not a direction, however small the pooled interval is.
 *  - **the registrations, as predicates.** P1–P5 were written before the dispatch, in
 *    `prereg/R30-stage2.md`, and are transcribed here rather than summarised afterwards.
 */
import { mulberry32 } from '@agentix-e/microglia-core';
import { comparePaired } from './stats.js';
import {
  cellOf,
  discardSetOf,
  featureOf,
  gateReadingOf,
  type CellReading,
  type DiffCase,
  type FeatureReading,
  type GateReading,
} from './query-diff.js';

/** A paired contrast, resampled over the unit that is actually independent. */
export type ClusteredDelta = {
  readonly questions: number;
  readonly clusters: number;
  /** `null` rather than zero for an empty corpus: zero would read as "no effect". */
  readonly pointPp: number | null;
  readonly lowPp: number | null;
  readonly highPp: number | null;
  /** Whether the interval excludes zero. `false` when there is no interval to speak of. */
  readonly resolved: boolean;
};

/**
 * The arm contrast with the interval taken over databases.
 *
 * Each draw selects databases with replacement and keeps every question they carry, so a database
 * of 1,400 questions counts once as a cluster rather than 1,400 times as evidence. The point
 * estimate deliberately keeps the question weighting — it is the quantity being estimated, and the
 * cluster bootstrap is a statement about its sampling variability, not a different estimator.
 */
export function clusteredDeltaOf(
  cases: readonly DiffCase[],
  options: { readonly resamples?: number; readonly seed?: number } = {},
): ClusteredDelta {
  const resamples = options.resamples ?? 10_000;
  const byCluster = new Map<string, number[]>();
  let signed = 0;
  for (const entry of cases) {
    const value = (entry.correct ? 1 : 0) - (entry.withoutMemoryCorrect ? 1 : 0);
    signed += value;
    const bucket = byCluster.get(entry.dbId) ?? [];
    bucket.push(value);
    byCluster.set(entry.dbId, bucket);
  }
  const groups = [...byCluster.values()];
  const questions = cases.length;
  if (questions === 0 || groups.length === 0) {
    return { questions, clusters: groups.length, pointPp: null, lowPp: null, highPp: null, resolved: false };
  }
  const pointPp = (signed / questions) * 100;
  // One cluster cannot be resampled: every draw is the same cluster, so the interval would have
  // zero width and every effect would "resolve". Refusing is the only honest reading.
  if (groups.length < 2) {
    return { questions, clusters: groups.length, pointPp, lowPp: null, highPp: null, resolved: false };
  }
  const random = mulberry32(options.seed ?? 20261101);
  const draws: number[] = [];
  for (let draw = 0; draw < resamples; draw += 1) {
    let total = 0;
    let count = 0;
    for (let pick = 0; pick < groups.length; pick += 1) {
      const bucket = groups[Math.floor(random() * groups.length)] as number[];
      for (const value of bucket) {
        total += value;
        count += 1;
      }
    }
    draws.push((total / count) * 100);
  }
  draws.sort((left, right) => left - right);
  const lowPp = draws[Math.floor(0.025 * (draws.length - 1))] as number;
  const highPp = draws[Math.floor(0.975 * (draws.length - 1))] as number;
  return {
    questions,
    clusters: groups.length,
    pointPp,
    lowPp,
    highPp,
    resolved: (lowPp > 0 && highPp > 0) || (lowPp < 0 && highPp < 0),
  };
}

/** How many folds agree with the pooled sign, and what a coin would say. */
export type FoldSignTest = {
  readonly negative: number;
  readonly positive: number;
  readonly ties: number;
  /** Two-sided exact binomial over the folds that are not ties. `1` when nothing is left. */
  readonly p: number;
};

/**
 * Choose `k` of `n`, for the exact binomial over a handful of folds.
 *
 * No bounds guard: the only caller iterates `k` from the larger count to their sum, so `0 <= k <= n`
 * holds by construction and a branch that cannot be taken is a branch no test can reach. The
 * alternative — a `return 0` nobody can trigger — would sit in the coverage report forever looking
 * like protection.
 */
function binomial(n: number, k: number): number {
  let result = 1;
  for (let i = 1; i <= k; i += 1) result = (result * (n - k + i)) / i;
  return result;
}

/**
 * The sign test over folds, two-sided and exact.
 *
 * A pooled interval can be narrow while the folds disagree — that is what correlation inside a
 * fold buys — so the number of folds pointing the same way is the independent check on it. Five
 * folds is small enough that the exact binomial is the only defensible version: a normal
 * approximation would report a p-value for a test it cannot support.
 */
export function foldSignTestOf(deltas: readonly number[]): FoldSignTest {
  const negative = deltas.filter((value) => value < 0).length;
  const positive = deltas.filter((value) => value > 0).length;
  const ties = deltas.length - negative - positive;
  const decided = negative + positive;
  if (decided === 0) return { negative, positive, ties, p: 1 };
  const extreme = Math.max(negative, positive);
  let tail = 0;
  for (let at = extreme; at <= decided; at += 1) tail += binomial(decided, at);
  const twoSided = (2 * tail) / 2 ** decided;
  return { negative, positive, ties, p: Math.min(1, twoSided) };
}

/** What a registration said, and whether the number it named arrived. */
export type PredictionVerdict = {
  readonly id: string;
  readonly registered: string;
  readonly observed: string;
  readonly holds: boolean;
};

/** The readings a registration is adjudicated against. */
export type OutOfSampleReading = {
  readonly deltaPp: number;
  readonly clustered: ClusteredDelta;
  readonly folds: FoldSignTest;
  readonly gate: GateReading;
  readonly imported: FeatureReading;
  readonly runsMeasured: boolean;
  /** The arm contrast as the power audit sees it, so the two cannot disagree about resolution. */
  readonly measured: CellReading;
};

/**
 * Which of the two bars a delta clears, named the way `eval:power` names it.
 *
 * The project has two bars and they are not the same: a 95% interval that excludes zero, and the
 * design's own 80%-power resolution (`2.802 · SE`). A delta can clear the first and miss the second,
 * and every artefact in this repository is filed under exactly this vocabulary. The out-of-sample run
 * is such a case — −0.71pp against a 0.82pp resolution — and it was briefly written up as though
 * clearing the interval settled it. Naming the category in the artefact is the only way that mistake
 * cannot be made twice.
 */
export type PowerVerdict = {
  readonly halfWidthPp: number | null;
  readonly minDetectablePp: number | null;
  /** `|delta|` exceeds the 95% half-width. */
  readonly significant95: boolean;
  /** `|delta|` exceeds the design's 80%-power resolution. The stricter bar. */
  readonly resolvable: boolean;
  readonly label: 'resolvable' | 'within 95% but under 80% power' | 'underpowered' | 'no discordant pair';
};

/** Adjudicate an arm contrast against both bars, with the label the power audit would print. */
export function powerVerdictOf(cell: CellReading): PowerVerdict {
  const delta = cell.deltaPp;
  const significant95 = delta !== null && cell.halfWidthPp !== null && Math.abs(delta) > cell.halfWidthPp;
  const resolvable = delta !== null && cell.minDetectablePp !== null && Math.abs(delta) > cell.minDetectablePp;
  const label =
    cell.halfWidthPp === null && cell.minDetectablePp === null && cell.helped + cell.harmed === 0
      ? 'no discordant pair'
      : resolvable
        ? 'resolvable'
        : significant95
          ? 'within 95% but under 80% power'
          : 'underpowered';
  return { halfWidthPp: cell.halfWidthPp, minDetectablePp: cell.minDetectablePp, significant95, resolvable, label };
}

const range = (value: number, low: number, high: number): boolean => value >= low && value <= high;
const show = (value: number | null): string => (value === null ? 'n/a' : `${value.toFixed(2)}pp`);

/**
 * The five predictions of `prereg/R30-stage2.md`, transcribed.
 *
 * Each carries the sentence it was registered as, so the documentation can quote the registration
 * and the reading together rather than paraphrase one into the other. `applies` decides from the
 * numbers; nothing here is edited after the fact.
 */
export const OUT_OF_SAMPLE_PREDICTIONS: readonly {
  readonly id: string;
  readonly registered: string;
  readonly applies: (reading: OutOfSampleReading) => boolean;
  readonly observed: (reading: OutOfSampleReading) => string;
}[] = [
  {
    id: 'P1',
    registered: 'the run is measurable: every question evaluated once, gold executable, no leaks',
    applies: (reading) => reading.runsMeasured,
    observed: (reading) => (reading.runsMeasured ? 'both gates passed as registered' : 'a gate failed'),
  },
  {
    id: 'P2',
    registered: 'the full arm is not positive, and not significantly different from the none arm',
    applies: (reading) => reading.deltaPp <= 0 && !reading.clustered.resolved,
    observed: (reading) =>
      `${show(reading.deltaPp)} clustered [${show(reading.clustered.lowPp)}, ${show(reading.clustered.highPp)}]`,
  },
  {
    id: 'P3',
    registered: 'the read-time gate is worth between +0.2pp and +2.0pp on train',
    applies: (reading) => reading.gate.improvementPp !== null && range(reading.gate.improvementPp, 0.2, 2.0),
    observed: (reading) => show(reading.gate.improvementPp),
  },
  {
    id: 'P4',
    registered: 'the gate shrinks and by less than half: a point estimate in [0.49, 0.98]',
    applies: (reading) => reading.gate.improvementPp !== null && range(reading.gate.improvementPp, 0.49, 0.98),
    observed: (reading) => show(reading.gate.improvementPp),
  },
  {
    id: 'P5',
    registered: 'an imported identifier is still a negative covariate',
    applies: (reading) => reading.imported.present.deltaPp !== null && reading.imported.present.deltaPp < 0,
    observed: (reading) => `${show(reading.imported.present.deltaPp)} against ${show(reading.imported.absent.deltaPp)}`,
  },
];

/** Adjudicate every registered prediction against one run's readings. */
export function adjudicateOutOfSample(reading: OutOfSampleReading): readonly PredictionVerdict[] {
  return OUT_OF_SAMPLE_PREDICTIONS.map((prediction) => ({
    id: prediction.id,
    registered: prediction.registered,
    observed: prediction.observed(reading),
    holds: prediction.applies(reading),
  }));
}

/** The gate's own reading, the arm contrast and the imported-name cohort, computed from one run. */
export function outOfSampleReadingOf(
  cases: readonly DiffCase[],
  foldDeltas: readonly number[],
  options: { readonly runsMeasured: boolean },
): OutOfSampleReading {
  const baseline = cases.map((entry) => entry.withoutMemoryCorrect);
  const treatment = cases.map((entry) => entry.correct);
  const paired = comparePaired(baseline, treatment);
  return {
    deltaPp: cases.length === 0 ? 0 : paired.delta * 100,
    clustered: clusteredDeltaOf(cases),
    folds: foldSignTestOf(foldDeltas),
    gate: gateReadingOf(cases),
    imported: featureOf('F1', 'imported name', cases, (delta) => delta.ungrounded.length > 0),
    runsMeasured: options.runsMeasured,
    measured: cellOf(cases),
  };
}

/** One cell of the comparison between the in-sample and the out-of-sample reading. */
export type CellPair = {
  readonly label: string;
  readonly dev: string;
  readonly train: string;
};

/**
 * The two corpora side by side, formatted once so the artefact and the console cannot disagree.
 *
 * A string rather than a number because the two splits are not on the same scale: dev and train
 * share no database, so their absolute accuracies are different quantities. Only the paired
 * differences are comparable, and the table says so in its own column headers.
 */
export function sideBySideOf(input: {
  readonly dev: { readonly deltaPp: number; readonly clustered: ClusteredDelta; readonly folds: FoldSignTest; readonly gate: GateReading; readonly imported: FeatureReading };
  readonly train: { readonly deltaPp: number; readonly clustered: ClusteredDelta; readonly folds: FoldSignTest; readonly gate: GateReading; readonly imported: FeatureReading };
}): readonly CellPair[] {
  // Three states, not two: no estimate at all, an estimate whose corpus is one cluster and
  // therefore has no interval, and an estimate with one. Printing `[0.00, 0.00]` for the middle
  // case would read as a perfectly resolved zero-width interval, which is the opposite of what a
  // single-cluster corpus supports.
  const interval = (value: ClusteredDelta): string => {
    if (value.pointPp === null) return 'n/a';
    if (value.lowPp === null || value.highPp === null) return `${value.pointPp.toFixed(2)}pp (no interval)`;
    return `${value.pointPp.toFixed(2)}pp [${value.lowPp.toFixed(2)}, ${value.highPp.toFixed(2)}]`;
  };
  return [
    { label: 'questions', dev: String(input.dev.clustered.questions), train: String(input.train.clustered.questions) },
    { label: 'databases', dev: String(input.dev.clustered.clusters), train: String(input.train.clustered.clusters) },
    { label: 'arm delta, clustered', dev: interval(input.dev.clustered), train: interval(input.train.clustered) },
    {
      label: 'folds agreeing with the sign',
      dev: 'n/a (no folds)',
      train: `${Math.max(input.train.folds.negative, input.train.folds.positive)} of ${input.train.folds.negative + input.train.folds.positive}, p=${input.train.folds.p.toFixed(4)}`,
    },
    { label: 'gate improvement', dev: show(input.dev.gate.improvementPp), train: show(input.train.gate.improvementPp) },
    { label: 'gated arm delta', dev: show(input.dev.gate.gated.deltaPp), train: show(input.train.gate.gated.deltaPp) },
    {
      label: 'imported-name delta',
      dev: show(input.dev.imported.present.deltaPp),
      train: show(input.train.imported.present.deltaPp),
    },
  ];
}

/**
 * The two ways a memory query can differ from the bare attempt, and what a filter can see of each.
 *
 * This is the reading that makes the out-of-sample result a product decision rather than a verdict.
 * The arm's delta is one number, and one number invites "memory is bad". The two rates behind it say
 * something quite different. On the out-of-sample corpus the pack repairs **6.39%** of the questions
 * the bare attempt gets wrong and breaks **5.82%** of the ones it gets right: it is a reshuffle with
 * a slightly heavier bad side, not a drag.
 *
 * Which then makes the filter's precision the thing that decides. A filter that could see every break
 * would remove 237 of 7,000 questions and be worth 3.39pp. This one removes 548 and is worth 0.51pp:
 * it catches a third of the breaks and throws away a fifth of the repairs, so it spends fifteen
 * questions per net error it prevents, and realises **15%** of the ceiling.
 *
 * `discardedPerNetError` is `null` rather than infinite when the filter removes nothing net: a
 * filter that catches no net error has no ratio, and JSON writes that as `null` for the same reason
 * `minDetectablePp` does.
 *
 * The name carries a `memory` prefix because `protocol.discordanceOf` already means something else
 * in this package: the rate at which two arms disagree on the same question, which is the input to
 * every power calculation. That is a property of a *pair of arms*; this is a property of what a
 * *filter* can see of that disagreement, and the two must not be conflated by a shared name.
 */
export type MemoryDiscordance = {
  /** Questions the bare attempt got wrong, which the pack can only help. */
  readonly attempted: { readonly n: number; readonly repaired: number; readonly ratePp: number | null };
  /** Questions the bare attempt got right, which the pack can only harm. */
  readonly correct: { readonly n: number; readonly broken: number; readonly ratePp: number | null };
  /** `repaired − broken`, in questions. */
  readonly net: number;
  /**
   * `repaired / broken`: how many questions the pack repairs for each one it breaks.
   *
   * This is the ratio of counts, not the ratio of the two rates, and on this corpus the two point
   * different ways. Per question, help is the likelier outcome — 6.39% of the wrong answers are
   * repaired against 5.82% of the right ones broken. Per hundred questions of the corpus, harm wins,
   * because the bases are not the same size: 4,075 questions could only be harmed and 2,925 could
   * only be helped. Dev sits on the other side of one (67 repairs against 62 breaks), which is how
   * the arm flips sign while both mechanisms stay the same size.
   *
   * `null` when the pack breaks nothing, because then there is no exchange to quote.
   */
  readonly helpPerHarm: number | null;
  readonly filter: {
    readonly discarded: number;
    readonly discardedShare: number | null;
    readonly caughtOfBroken: number;
    readonly caughtOfRepaired: number;
    readonly caughtShareOfBroken: number | null;
    readonly caughtShareOfRepaired: number | null;
    readonly netRemoved: number;
    readonly discardedPerNetError: number | null;
  };
  /** What removing every break and no repair would be worth, in percentage points of the corpus. */
  readonly ceilingPp: number | null;
  /** What the filter realises, in percentage points of the corpus. */
  readonly realisedPp: number | null;
  /** `realisedPp / ceilingPp`, which is how much of the available gain the signal finds. */
  readonly shareOfCeiling: number | null;
};

/**
 * Every ratio in this reading is `null` when its denominator is zero, for the reason the rest of the
 * package writes `null`: a rate over nothing is not zero, and JSON has one spelling for "no ratio".
 * The corpus that matters here has no such denominators, so the nulls cost nothing at the reading and
 * stop a degenerate corpus from reporting a confident 0%.
 *
 * Split a corpus by what memory did, and ask the filter what it can see of each half.
 *
 * The gate mode is `strict`, the same one `outOfSampleReadingOf` measures through `gateReadingOf`,
 * so `realisedPp` and the reading's own `gate.improvementPp` are the same quantity computed two
 * ways. They are both kept: one says what the gate is worth, the other says what fraction of the
 * available gain it is worth, and only the second is stable across corpora of different sizes.
 */
export function memoryDiscordanceOf(cases: readonly DiffCase[]): MemoryDiscordance {
  const repaired = cases.filter((entry) => entry.correct && !entry.withoutMemoryCorrect);
  const broken = cases.filter((entry) => !entry.correct && entry.withoutMemoryCorrect);
  const attempted = cases.filter((entry) => !entry.withoutMemoryCorrect);
  const correct = cases.filter((entry) => entry.withoutMemoryCorrect);
  const discardSet = discardSetOf(cases, 'strict');
  const flagged = (group: readonly DiffCase[]): number =>
    group.filter((entry) => discardSet.has(entry.id)).length;
  const caughtOfBroken = flagged(broken);
  const caughtOfRepaired = flagged(repaired);
  const netRemoved = caughtOfBroken - caughtOfRepaired;
  const share = (part: number, whole: number): number | null => (whole === 0 ? null : part / whole);
  const perHundred = (part: number, whole: number): number | null => (whole === 0 ? null : (part / whole) * 100);
  const n = cases.length;
  const ceilingPp = perHundred(broken.length, n);
  const realisedPp = perHundred(netRemoved, n);
  return {
    attempted: { n: attempted.length, repaired: repaired.length, ratePp: perHundred(repaired.length, attempted.length) },
    correct: { n: correct.length, broken: broken.length, ratePp: perHundred(broken.length, correct.length) },
    net: repaired.length - broken.length,
    helpPerHarm: share(repaired.length, broken.length),
    filter: {
      discarded: discardSet.size,
      discardedShare: share(discardSet.size, n),
      caughtOfBroken,
      caughtOfRepaired,
      caughtShareOfBroken: share(caughtOfBroken, broken.length),
      caughtShareOfRepaired: share(caughtOfRepaired, repaired.length),
      netRemoved,
      discardedPerNetError: share(discardSet.size, netRemoved),
    },
    ceilingPp,
    realisedPp,
    shareOfCeiling: ceilingPp === null || realisedPp === null || ceilingPp === 0 ? null : realisedPp / ceilingPp,
  };
}
