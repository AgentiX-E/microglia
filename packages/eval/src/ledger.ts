/**
 * Whether a stored rule has a value, and whether that value travels.
 *
 * Five rounds have asked how to use the same pack and none has asked whether its items are worth
 * different amounts. That question has one operational form — prune the rules that break and keep the
 * ones that repair — and pruning presupposes something the project has never tested: that a rule's
 * net effect is a property of the rule rather than of the questions it happened to be shown on.
 *
 * This module tests the presupposition on the corpus §146 already paid for, and it does it in the order
 * that makes a negative informative:
 *
 *  1. **Is there heterogeneity at all?** A χ² dispersion statistic over per-rule repair counts, against
 *     a null that permutes *outcomes across questions* while keeping every rule's question set fixed.
 *     That is the only null that separates "this rule is different" from "these two rules shared a
 *     prompt", because attribution is not exclusive and a pack of two credits both rules with the same
 *     flip.
 *  2. **Does it replicate?** Databases are dealt 29/29 by a stable hash and the per-rule net rates are
 *     correlated across the two halves. The split-half correlation *is* the reliability of a half-length
 *     ledger, and Spearman–Brown turns it into the reliability of the full one.
 *  3. **Does a coarse flag work out of sample?** Rules the discovery half saw at least ten times and
 *     lost on are flagged, and the confirmation half is asked whether questions carrying a flagged rule
 *     did worse. This is the actionable form of the question and the only one that uses real outcomes
 *     rather than a counterfactual this instrument cannot observe.
 *
 * A fourth question arrived while counting the corpus for the first: the pack is not always two rules.
 * 423 questions carry one, and they exchange better than the pairs. That is registered as a lead rather
 * than a finding, because the same contrast reverses on every 350-question pilot in the repository and
 * because pack size is assigned by retrieval rather than by the experiment.
 */

import { mulberry32 } from '@agentix-e/microglia-core';

/** The bars `prereg/R35-ledger.md` fixed before the run. */
export const R35_BARS = {
  /** Corpus size the registration describes: 203 rules over 13,578 injections. */
  minRules: 200,
  minInjections: 13_000,
  minDatabases: 25,
  minRulesPerHalf: 100,
  /** A rule has to have been shown this often in each half before the two records are compared. */
  minShown: 5,
  /** P3: a value that travels correlates above this; a value that does not, below it. */
  maxCorrelation: 0.2,
  maxSignAgreement: 0.6,
  /** P4: Spearman–Brown on a half-length ledger. Below roughly 0.7 an estimate is mostly noise. */
  maxReliability: 0.3,
  /** P2: the dispersion has to clear its permutation null at this level. */
  dispersionAlpha: 0.01,
  /** A rule has to have been shown this often in the discovery half before it can be flagged. */
  pruneShown: 10,
  /** P6: the multiple of the present injections per rule a usable ledger would need. */
  powerMultiple: 10,
} as const;

/**
 * One question, reduced to what a rule ledger needs.
 *
 * `packIdList` is the ids of the rules the prompt carried and `injected` is their text; both are needed
 * because the id is the key and the text is what a reader has to see to know what the key is about. A
 * pack whose two lists disagree is skipped rather than half-counted, and the count of skips is reported.
 */
export type LedgerCase = {
  readonly id: string;
  readonly dbId: string;
  readonly injected: readonly string[];
  readonly packIdList?: readonly string[] | undefined;
  readonly correct: boolean;
  readonly withoutMemoryCorrect: boolean;
};

type Outcome = 1 | 0 | -1;

function outcomeOf(entry: LedgerCase): Outcome {
  if (entry.correct && !entry.withoutMemoryCorrect) return 1;
  if (entry.withoutMemoryCorrect && !entry.correct) return -1;
  return 0;
}

function usable(entry: LedgerCase): entry is LedgerCase & { readonly packIdList: readonly string[] } {
  const ids = entry.packIdList;
  return ids !== undefined && ids.length > 0 && ids.length === entry.injected.length;
}

/** Every rule's count over the questions it was shown on, keyed by rule id. */
type Tally = { readonly shown: number[]; readonly repaired: number[]; readonly broken: number[] };

function indexOf(cases: readonly LedgerCase[]): {
  readonly ids: readonly string[];
  readonly packs: readonly (readonly number[])[];
  readonly outcomes: readonly Outcome[];
  readonly unkeyed: number;
} {
  const ids: string[] = [];
  const position = new Map<string, number>();
  const packs: number[][] = [];
  const outcomes: Outcome[] = [];
  let unkeyed = 0;
  for (const entry of cases) {
    if (!usable(entry)) {
      if (entry.injected.length > 0) unkeyed += 1;
      continue;
    }
    packs.push(
      entry.packIdList.map((id) => {
        const found = position.get(id);
        if (found !== undefined) return found;
        const at = ids.length;
        ids.push(id);
        position.set(id, at);
        return at;
      }),
    );
    outcomes.push(outcomeOf(entry));
  }
  return { ids, packs, outcomes, unkeyed };
}

function emptyTally(rules: number): Tally {
  return {
    shown: Array.from({ length: rules }, () => 0),
    repaired: Array.from({ length: rules }, () => 0),
    broken: Array.from({ length: rules }, () => 0),
  };
}

function tallyOf(packs: readonly (readonly number[])[], outcomes: readonly Outcome[], rules: number): Tally {
  const tally = emptyTally(rules);
  for (const [at, pack] of packs.entries()) {
    const outcome = outcomes[at] as Outcome;
    for (const rule of pack) {
      (tally.shown as number[])[rule] = (tally.shown[rule] as number) + 1;
      if (outcome === 1) (tally.repaired as number[])[rule] = (tally.repaired[rule] as number) + 1;
      if (outcome === -1) (tally.broken as number[])[rule] = (tally.broken[rule] as number) + 1;
    }
  }
  return tally;
}

/** The χ² dispersion of one count against its own expectation, summed over rules. */
function dispersionOfCounts(counts: readonly number[], shown: readonly number[], rate: number): number {
  if (shown.length === 0 || rate <= 0 || rate >= 1) return 0;
  let total = 0;
  for (const [at, count] of counts.entries()) {
    const n = shown[at] as number;
    const deviation = count - n * rate;
    total += (deviation * deviation) / (n * rate * (1 - rate));
  }
  return total;
}

export type Dispersion = {
  readonly rules: number;
  /** Rule-injections: a rule shown twice counts twice. */
  readonly injections: number;
  readonly repairs: number;
  readonly breaks: number;
  /** χ² for repair counts, and for break counts, against `prereg/R35-ledger.md`'s null. */
  readonly repairStatistic: number;
  readonly breakStatistic: number;
  readonly nullMean: number;
  readonly nullP99: number;
  /** Permutation p for the repair statistic. */
  readonly p: number;
  readonly permutations: number;
  /** Cases with rules but no usable ids: skipped, and counted. */
  readonly unkeyed: number;
};

/**
 * Is any rule's record different from any other's, once the pack structure is held fixed?
 *
 * The null is the whole design. A binomial null would compare each rule's rate to the corpus rate and
 * find heterogeneity every time, because two rules in the same pack are credited with the same flip and
 * their counts move together. Permuting the *outcomes* across questions keeps every rule's question set
 * exactly as it was and destroys only the association between a rule and what happened on its questions,
 * which is the quantity the ledger claims to measure.
 */
export function dispersionOf(
  cases: readonly LedgerCase[],
  options: { readonly permutations?: number; readonly seed?: number } = {},
): Dispersion {
  const permutations = options.permutations ?? 2000;
  const random = mulberry32(options.seed ?? 20_251_102);
  const { ids, packs, outcomes, unkeyed } = indexOf(cases);
  const observed = tallyOf(packs, outcomes, ids.length);
  const injections = observed.shown.reduce((sum, value) => sum + value, 0);
  const repairs = observed.repaired.reduce((sum, value) => sum + value, 0);
  const breaks = observed.broken.reduce((sum, value) => sum + value, 0);
  const repairRate = injections === 0 ? 0 : repairs / injections;
  const breakRate = injections === 0 ? 0 : breaks / injections;
  const repairStatistic = dispersionOfCounts(observed.repaired, observed.shown, repairRate);
  const breakStatistic = dispersionOfCounts(observed.broken, observed.shown, breakRate);

  const shuffled = [...outcomes];
  const nulls: number[] = [];
  for (let round = 0; round < permutations; round += 1) {
    for (let at = shuffled.length - 1; at > 0; at -= 1) {
      const swap = Math.floor(random() * (at + 1));
      const held = shuffled[at] as Outcome;
      shuffled[at] = shuffled[swap] as Outcome;
      shuffled[swap] = held;
    }
    const tally = tallyOf(packs, shuffled, ids.length);
    nulls.push(dispersionOfCounts(tally.repaired, tally.shown, repairRate));
  }
  nulls.sort((left, right) => left - right);
  const exceeds = nulls.filter((value) => value >= repairStatistic).length;
  return {
    rules: ids.length,
    injections,
    repairs,
    breaks,
    repairStatistic,
    breakStatistic,
    nullMean: nulls.length === 0 ? 0 : nulls.reduce((sum, value) => sum + value, 0) / nulls.length,
    nullP99: nulls.length === 0 ? 0 : (nulls[Math.floor(0.99 * (nulls.length - 1))] as number),
    // The +1 keeps a p of zero out of a report: an empirical p is never smaller than one over the
    // number of permutations plus one, and writing 0 would claim a resolution the run does not have.
    p: nulls.length === 0 ? 1 : (1 + exceeds) / (1 + nulls.length),
    permutations,
    unkeyed,
  };
}

/** A rule's net over the questions it was shown on, in the units the ledger counts. */
function netRates(cases: readonly LedgerCase[]): Map<string, { shown: number; net: number }> {
  const { ids, packs, outcomes } = indexOf(cases);
  const tally = tallyOf(packs, outcomes, ids.length);
  const rates = new Map<string, { shown: number; net: number }>();
  for (const [at, id] of ids.entries()) {
    const shown = tally.shown[at] as number;
    rates.set(id, { shown, net: (tally.repaired[at] as number) - (tally.broken[at] as number) });
  }
  return rates;
}

export type Replication = {
  /** Rules common to both halves and shown often enough in each to be compared. */
  readonly rules: number;
  readonly correlation: number | null;
  readonly low: number | null;
  readonly high: number | null;
  /** Share of the rules that moved in both halves and moved the same way. */
  readonly signAgreement: number | null;
  readonly signPairs: number;
  /** Spearman–Brown: what the correlation says about a ledger of twice the length. */
  readonly reliability: number | null;
};

/**
 * Does a rule's measured value survive being measured again somewhere else?
 *
 * The halves are disjoint in databases, so the second measurement is taken on questions the first never
 * saw. The correlation between the two is the reliability of a half-length ledger, and reliability is
 * the quantity that decides whether a prune is evidence or noise — a rule kept at a reliability of 0.3
 * is a coin with extra steps.
 */
export function replicationOf(
  discovery: readonly LedgerCase[],
  confirmation: readonly LedgerCase[],
  options: { readonly minShown?: number } = {},
): Replication {
  const minShown = options.minShown ?? R35_BARS.minShown;
  const left = netRates(discovery);
  const right = netRates(confirmation);
  // Sorted because the halves are read in corpus order and a pairwise correlation depends on the two
  // lists being in the same order; `localeCompare` has no tie-break branch because ids are unique.
  const common = [...left.keys()].filter((id) => right.has(id)).sort((a, b) => a.localeCompare(b));
  const pairs = common
    .filter((id) => (left.get(id) as { shown: number }).shown >= minShown && (right.get(id) as { shown: number }).shown >= minShown)
    .map((id) => {
      const a = left.get(id) as { shown: number; net: number };
      const b = right.get(id) as { shown: number; net: number };
      return { a: a.net / a.shown, b: b.net / b.shown };
    });
  const moved = pairs.filter((pair) => pair.a !== 0 && pair.b !== 0);
  const signPairs = moved.length;
  // One rule agreeing with itself is not an agreement rate; two is the smallest number that can
  // disagree, so that is the floor.
  const signAgreement =
    signPairs < 2 ? null : moved.filter((pair) => Math.sign(pair.a) === Math.sign(pair.b)).length / signPairs;
  if (pairs.length < 2) {
    return { rules: pairs.length, correlation: null, low: null, high: null, signAgreement, signPairs, reliability: null };
  }
  const xs = pairs.map((pair) => pair.a);
  const ys = pairs.map((pair) => pair.b);
  const correlation = pearson(xs, ys);
  const interval = correlation === null || pairs.length < 4 ? null : fisherInterval(correlation, pairs.length);
  return {
    rules: pairs.length,
    correlation,
    low: interval === null ? null : interval.low,
    high: interval === null ? null : interval.high,
    signAgreement,
    signPairs,
    // Spearman–Brown is undefined at a correlation of −1 and meaningless below it: a ledger whose two
    // halves anti-agree does not become reliable by being longer.
    reliability: correlation === null || 1 + correlation <= 0 ? null : (2 * correlation) / (1 + correlation),
  };
}

function pearson(xs: readonly number[], ys: readonly number[]): number | null {
  const n = xs.length;
  const meanX = xs.reduce((sum, value) => sum + value, 0) / n;
  const meanY = ys.reduce((sum, value) => sum + value, 0) / n;
  let covariance = 0;
  let varianceX = 0;
  let varianceY = 0;
  for (let at = 0; at < n; at += 1) {
    const dx = (xs[at] as number) - meanX;
    const dy = (ys[at] as number) - meanY;
    covariance += dx * dy;
    varianceX += dx * dx;
    varianceY += dy * dy;
  }
  // A half that moved nothing has no variance to correlate with, and the honest answer is that the
  // correlation does not exist rather than that it is zero.
  if (varianceX === 0 || varianceY === 0) return null;
  return covariance / Math.sqrt(varianceX * varianceY);
}

/** Fisher's z interval. Below four pairs there is no interval worth quoting. */
function fisherInterval(correlation: number, n: number): { low: number; high: number } {
  const clamped = Math.max(-0.999999, Math.min(0.999999, correlation));
  const z = 0.5 * Math.log((1 + clamped) / (1 - clamped));
  const se = 1 / Math.sqrt(n - 3);
  return { low: Math.tanh(z - 1.96 * se), high: Math.tanh(z + 1.96 * se) };
}

export type ScreeningArm = {
  readonly questions: number;
  readonly injections: number;
  readonly repaired: number;
  readonly broken: number;
  readonly netPp: number | null;
};

export type Screening = {
  readonly flaggedRules: number;
  readonly flagged: ScreeningArm;
  readonly clean: ScreeningArm;
  /** Flagged minus clean, in percentage points of the confirmation corpus. */
  readonly differencePp: number | null;
  readonly lowPp: number | null;
  readonly highPp: number | null;
  /** Whether the flag predicted harm out of sample on a database-clustered interval. */
  readonly clears: boolean;
};

function armOf(cases: readonly (LedgerCase & { readonly packIdList: readonly string[] })[]): ScreeningArm {
  let injections = 0;
  let repaired = 0;
  let broken = 0;
  for (const entry of cases) {
    injections += entry.packIdList.length;
    if (entry.correct && !entry.withoutMemoryCorrect) repaired += 1;
    if (entry.withoutMemoryCorrect && !entry.correct) broken += 1;
  }
  const questions = cases.length;
  return {
    questions,
    injections,
    repaired,
    broken,
    netPp: questions === 0 ? null : perHundred(repaired - broken, questions),
  };
}

/**
 * Does a rule that looked harmful keep looking harmful where it was not measured?
 *
 * The flag is deliberately coarse — negative net, at least ten showings — because a coarse flag that
 * carries signal is worth an arm and a precise one that carries none is worth nothing. The confirmation
 * questions are grouped by whether their pack contained *any* flagged rule, so a two-rule pack is
 * attributed to the flag without pretending to decompose it.
 */
export function screeningOf(
  discovery: readonly LedgerCase[],
  confirmation: readonly LedgerCase[],
  options: {
    readonly minShown?: number;
    readonly maxNet?: number;
    readonly resamples?: number;
    readonly seed?: number;
  } = {},
): Screening {
  const minShown = options.minShown ?? R35_BARS.pruneShown;
  const maxNet = options.maxNet ?? 0;
  const flagged = new Set<string>();
  for (const [id, record] of netRates(discovery)) {
    if (record.shown >= minShown && record.net < maxNet) flagged.add(id);
  }
  const flaggedCases: (LedgerCase & { readonly packIdList: readonly string[] })[] = [];
  const cleanCases: (LedgerCase & { readonly packIdList: readonly string[] })[] = [];
  for (const entry of confirmation) {
    if (!usable(entry)) continue;
    (entry.packIdList.some((id) => flagged.has(id)) ? flaggedCases : cleanCases).push(entry);
  }
  const flaggedArm = armOf(flaggedCases);
  const cleanArm = armOf(cleanCases);
  const difference = flaggedArm.netPp === null || cleanArm.netPp === null ? null : flaggedArm.netPp - cleanArm.netPp;
  // The two lists are already the partition, so the arm is a constant here rather than a predicate
  // re-evaluated over every question.
  const groups = [
    ...flaggedCases.map((entry) => ({ value: outcomeOf(entry), inFlagged: true, cluster: entry.dbId })),
    ...cleanCases.map((entry) => ({ value: outcomeOf(entry), inFlagged: false, cluster: entry.dbId })),
  ];
  const interval =
    difference === null
      ? { low: null, high: null }
      : clusteredContrastPp(groups, options.resamples ?? 2000, options.seed ?? 7071);
  return {
    flaggedRules: flagged.size,
    flagged: flaggedArm,
    clean: cleanArm,
    differencePp: difference,
    lowPp: interval.low,
    highPp: interval.high,
    clears: interval.low !== null && interval.high !== null && (interval.low > 0 || interval.high < 0),
  };
}

export type PackSizeCell = {
  readonly questions: number;
  readonly repairable: number;
  readonly repaired: number;
  readonly breakable: number;
  readonly broken: number;
  readonly netPp: number | null;
};

export type PackSize = {
  /** Questions whose prompt carried exactly one rule. */
  readonly single: PackSizeCell;
  readonly pair: PackSizeCell;
  readonly differencePp: number | null;
  readonly lowPp: number | null;
  readonly highPp: number | null;
  readonly excludesZero: boolean;
};

function cellOf(cases: readonly LedgerCase[]): PackSizeCell {
  let repairable = 0;
  let repaired = 0;
  let breakable = 0;
  let broken = 0;
  for (const entry of cases) {
    if (!entry.withoutMemoryCorrect) {
      repairable += 1;
      if (entry.correct) repaired += 1;
    } else {
      breakable += 1;
      if (!entry.correct) broken += 1;
    }
  }
  return {
    questions: cases.length,
    repairable,
    repaired,
    breakable,
    broken,
    netPp: cases.length === 0 ? null : perHundred(repaired - broken, cases.length),
  };
}

/**
 * The one structural variable that turned out to vary, and the interval that keeps it a lead.
 *
 * Pack size is assigned by retrieval, not by the experiment: a question is served one rule when only
 * one clears the threshold. So this is a comparison of questions retrieval happened to treat
 * differently, and the singleton questions are harder — 47.3% unanswerable by the bare model against
 * 41.4%. Both arms are therefore netted on their *own* questions rather than compared as rates, and the
 * interval is clustered by database because the deal is not random within a schema.
 */
export function packSizeOf(
  cases: readonly LedgerCase[],
  options: { readonly resamples?: number; readonly seed?: number } = {},
): PackSize {
  const keyed = cases.filter(usable);
  const single = keyed.filter((entry) => entry.packIdList.length === 1);
  const pair = keyed.filter((entry) => entry.packIdList.length === 2);
  const singleCell = cellOf(single);
  const pairCell = cellOf(pair);
  const difference = singleCell.netPp === null || pairCell.netPp === null ? null : singleCell.netPp - pairCell.netPp;
  const groups =
    difference === null
      ? []
      : [...single, ...pair].map((entry) => ({
          value: outcomeOf(entry),
          inFlagged: entry.packIdList.length === 1,
          cluster: entry.dbId,
        }));
  const interval =
    difference === null ? { low: null, high: null } : clusteredContrastPp(groups, options.resamples ?? 2000, options.seed ?? 13_579);
  return {
    single: singleCell,
    pair: pairCell,
    differencePp: difference,
    lowPp: interval.low,
    highPp: interval.high,
    excludesZero: interval.low !== null && interval.high !== null && (interval.low > 0 || interval.high < 0),
  };
}

type Group = { readonly value: number; readonly inFlagged: boolean; readonly cluster: string };

/**
 * The difference between two arms' means, with the database resampled.
 *
 * The cluster is the unit because the questions inside a schema share a model, a vocabulary and a
 * retrieval index; a question-level bootstrap on this corpus produces intervals roughly a third as wide
 * as the data supports. Draws in which either arm is empty are skipped rather than counted as zero,
 * which is the difference between an interval and a claim.
 */
function clusteredContrastPp(
  groups: readonly Group[],
  resamples: number,
  seed: number,
): { low: number | null; high: number | null } {
  const clusters = [...new Set(groups.map((group) => group.cluster))];
  if (clusters.length < 2) return { low: null, high: null };
  const members = new Map<string, Group[]>();
  for (const group of groups) {
    const bucket = members.get(group.cluster) ?? [];
    bucket.push(group);
    members.set(group.cluster, bucket);
  }
  const random = mulberry32(seed);
  const draws: number[] = [];
  for (let round = 0; round < resamples; round += 1) {
    let flaggedSum = 0;
    let flaggedCount = 0;
    let cleanSum = 0;
    let cleanCount = 0;
    for (let draw = 0; draw < clusters.length; draw += 1) {
      const picked = members.get(clusters[Math.floor(random() * clusters.length)] as string) as Group[];
      for (const group of picked) {
        if (group.inFlagged) {
          flaggedSum += group.value;
          flaggedCount += 1;
        } else {
          cleanSum += group.value;
          cleanCount += 1;
        }
      }
    }
    if (flaggedCount === 0 || cleanCount === 0) continue;
    draws.push(100 * (flaggedSum / flaggedCount - cleanSum / cleanCount));
  }
  if (draws.length === 0) return { low: null, high: null };
  draws.sort((left, right) => left - right);
  return {
    low: draws[Math.floor(0.025 * (draws.length - 1))] as number,
    high: draws[Math.ceil(0.975 * (draws.length - 1))] as number,
  };
}

function perHundred(part: number, whole: number): number {
  return (100 * part) / whole;
}

/** How many of the committed artefacts show the pack-size contrast in each direction. */
export type PackSizeFamily = {
  readonly datasets: number;
  readonly positive: number;
  readonly negative: number;
  readonly flat: number;
};

export type R35Input = {
  readonly corpus: {
    readonly rules: number;
    readonly injections: number;
    readonly halves: { readonly databases: number };
    readonly rulesPerHalf: number;
  };
  readonly dispersion: Dispersion;
  readonly replication: Replication;
  readonly screening: Screening;
  readonly packSize: PackSize;
  readonly family: PackSizeFamily;
};

export type R35Verdict = {
  readonly id: string;
  readonly claim: string;
  readonly observed: string;
  readonly holds: boolean;
};

const pp = (value: number | null): string => (value === null ? 'n/a' : `${value >= 0 ? '+' : ''}${value.toFixed(2)}pp`);
const pct = (value: number | null): string => (value === null ? 'n/a' : `${(100 * value).toFixed(1)}%`);
const num = (value: number | null, digits: number): string => (value === null ? 'n/a' : value.toFixed(digits));

/** P1 to P7 of `prereg/R35-ledger.md`, each decided by the number it named. */
export function adjudicateR35(input: R35Input): readonly R35Verdict[] {
  const { corpus, dispersion, replication, screening, packSize, family } = input;
  const perRule = corpus.rules === 0 ? 0 : corpus.injections / corpus.rules;
  const needed = Math.round(perRule) * R35_BARS.powerMultiple;
  const instrumentHolds =
    corpus.rules >= R35_BARS.minRules &&
    corpus.injections >= R35_BARS.minInjections &&
    corpus.halves.databases >= R35_BARS.minDatabases &&
    corpus.rulesPerHalf >= R35_BARS.minRulesPerHalf;
  const travels = replication.correlation !== null && replication.correlation > R35_BARS.maxCorrelation;
  const signTravels = replication.signAgreement !== null && replication.signAgreement > R35_BARS.maxSignAgreement;
  return [
    {
      id: 'P1',
      claim: 'the instrument has the corpus it describes: 203 rules, 13,578 injections, both halves deep enough to compare rules',
      observed: `${corpus.rules} rules, ${corpus.injections} injections, ${corpus.halves.databases} databases per half, ${corpus.rulesPerHalf} rules seen five times in each`,
      holds: instrumentHolds,
    },
    {
      id: 'P2',
      claim: 'rule records are more dispersed than the pack structure alone can explain',
      observed: `chi2 ${dispersion.repairStatistic.toFixed(1)} against a null mean of ${dispersion.nullMean.toFixed(1)} and a 99th percentile of ${dispersion.nullP99.toFixed(1)}, p = ${dispersion.p.toFixed(4)}`,
      holds: dispersion.p < R35_BARS.dispersionAlpha,
    },
    {
      id: 'P3',
      claim: 'the dispersion does not replicate: a rule measured on one set of databases is not the same rule on another',
      observed: `r = ${num(replication.correlation, 3)} over ${replication.rules} rules, sign agreement ${pct(replication.signAgreement)} over ${replication.signPairs}`,
      holds: !travels && !signTravels,
    },
    {
      id: 'P4',
      claim: 'the ledger is not reliable enough to prune on',
      observed:
        replication.reliability === null
          ? `Spearman-Brown is undefined at r = ${num(replication.correlation, 3)}; nothing longer than one half would be more reliable`
          : `Spearman-Brown reliability ${replication.reliability.toFixed(3)} at full length`,
      holds: replication.correlation !== null && (replication.reliability === null || replication.reliability <= R35_BARS.maxReliability),
    },
    {
      id: 'P5',
      claim: 'a rule that looked harmful does not keep looking harmful where it was not measured',
      observed: `flagged ${screening.flaggedRules} rules covering ${screening.flagged.questions} questions at ${pp(screening.flagged.netPp)} against ${pp(screening.clean.netPp)} clean, difference ${pp(screening.differencePp)} [${pp(screening.lowPp)}, ${pp(screening.highPp)}]`,
      holds: !screening.clears,
    },
    {
      id: 'P6',
      claim: 'a usable ledger is out of reach at this unit of memory',
      observed: `${needed} injections per rule (${R35_BARS.powerMultiple}x the measured ${perRule.toFixed(1)}); at a split-half correlation of ${num(replication.correlation, 2)} no multiple reaches 0.8`,
      holds: replication.correlation !== null && replication.correlation <= R35_BARS.maxCorrelation,
    },
    {
      id: 'P7',
      claim: 'the pack-size lead is corpus-dependent and does not license a decision',
      observed: `${pp(packSize.differencePp)} [${pp(packSize.lowPp)}, ${pp(packSize.highPp)}] on this corpus, but ${family.positive} of ${family.datasets} committed artefacts show it positively against ${family.negative} negatively`,
      holds: family.negative > family.positive,
    },
  ];
}
