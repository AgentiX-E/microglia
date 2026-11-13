/**
 * The use-side census: what a delivered pack actually put in front of the model.
 *
 * ## Why this instrument exists
 *
 * `V1-pack-not-empty` answers one question — *did the memory inject at least one
 * rule per question, on average?* R45 (run `42131391874`) was the first dispatch
 * to pass it: 1480 of 1480 recall requests carried an item. But the arm record
 * counted only the *size* of each pack and the rewards that followed. It never
 * recorded which statements were injected, nor whether any of them shared a
 * content term with the question they were served to. So R45's `+6.00pp [-6,
 * +20] p=0.5488` has two indistinguishable explanations: an effect too small
 * for 50 paired tasks (MDE 18.59pp), or a pack whose rules were mostly about a
 * different domain. `AUDIT` §34.23 measured the second offline on structural
 * proxies (75.88% of cross-domain pairs have zero lexical overlap against
 * 20.77% within-domain); this instrument lets a dispatch measure it on the real
 * distilled statements instead.
 *
 * ## What it deliberately does not do
 *
 * It changes no threshold, no scope, no pack content and no gate. It is a pure
 * function over what the recall facade already saw: one question, and the
 * statements of the items in the pack it served. The `UseCensus` type is the
 * seven-field shape registered in `TECH-DESIGN` §17.89, verbatim; the finer
 * coverage profile is a separate derived reading so the registered contract is
 * not silently widened. No mock and no model call: `queryCoverage` and
 * `tokenize` are the same kernel functions `buildPack` uses for its
 * `minCoverage` floor.
 *
 * `arm` names the policy under which the observations were made, so one census
 * can be attached to each use-side arm (`as-is`, `domain-faithful`,
 * `widening-enabled`, `coverage-floored`) without changing its shape.
 * `widenedItems` comes from the store's domain ledger, not from the pairs: a
 * widened item is a property of what was stored, and counting it per pair would
 * multiply it by the number of questions.
 */
import { queryCoverage, tokenize } from '@agentix-e/microglia-core/kernel';

/** The use policy an observation set was collected under (§17.89). */
export type UseArm = 'as-is' | 'domain-faithful' | 'widening-enabled' | 'coverage-floored';

/**
 * One recall request, exactly as the `/v1/recall` facade saw it.
 *
 * `statements` is empty when the pack was empty. It holds the rendered
 * statements of the items in the pack, not their ids, because the question this
 * instrument answers is about *content*: whether a rule mentions anything the
 * question is about.
 */
export type UseObservation = {
  readonly query: string;
  readonly statements: readonly string[];
  /**
   * What each injected item is *recalled by*: its condition followed by its statement.
   *
   * R51 made `recallText` the document the lexical index, the `minCoverage` floor and MMR all
   * read, and this instrument kept measuring the statement alone — so a run whose floor was
   * applied to condition-plus-statement was reported as though the floor and the measurement
   * had seen the same text. They had not: the floor kept a rule the histogram then scored at
   * 0.02, and the retention curve simulated a floor that no run applied.
   *
   * Absent on every observation written before this field, which reads as `statements` and is
   * exactly what those runs measured.
   */
  readonly documents?: readonly string[];
  /**
   * The store ids of the items the pack rendered, in render order.
   *
   * R93. The facade has carried `pack.ids` since R45 and the driver has always pushed them into its
   * in-memory `packReadings` — the artefact carried the *size* of each pack and never which item was
   * in it. So no readback could answer the two questions every store experiment turns on: which
   * record earned its place, and whether the record served to a failed task was the one that had
   * anything to do with it. A store of fifteen records served over 162 requests is a distribution,
   * and a distribution that is never recorded can only be described by its mean.
   *
   * Absent when the caller did not record them, which reads as "this arm cannot say" rather than as
   * "the pack was empty". Ids are the store's own (`k_…`), so they join to `storeItems` and to the
   * provenance payload without a second mapping.
   */
  readonly ids?: readonly string[];
};

/** The registered seven-field shape (§17.89). */
export type UseCensus = {
  readonly arm: UseArm;
  readonly recallRequests: number;
  /** Requests whose pack carried at least one item. */
  readonly recallServed: number;
  /** Mean items per request, including empty packs. A mean over no request is 0. */
  readonly meanPackIds: number;
  /** Total (question, injected statement) pairs across all requests. */
  readonly injectedPairs: number;
  /** Pairs whose statement covers none of the question's content terms. */
  readonly zeroCoveragePairs: number;
  /** Widened (`domain === undefined`) items in the store, from its domain ledger. */
  readonly widenedItems: number;
};

/** A finer reading derived from the same observations, for choosing a floor. */
export type CoverageProfile = {
  /** Pairs whose question has at least one content term. */
  readonly measuredPairs: number;
  /** Pairs whose question has no content term; coverage is undefined for them. */
  readonly unmeasurablePairs: number;
  /** Mean coverage over measured pairs; 0 when there are none. */
  readonly meanCoverage: number;
  readonly buckets: {
    /** coverage === 0 */
    readonly zero: number;
    /** 0 < coverage < 1 */
    readonly partial: number;
    /** coverage === 1 */
    readonly full: number;
  };
};

type PairRow = { readonly coverage: number; readonly measurable: boolean };

/**
 * Flatten observations once, so the census and the profile cannot disagree
 * about how many pairs exist or which of them are measurable.
 */
/**
 * The document each item is scored on, which is the one it was recalled by.
 *
 * One function rather than an expression at each call site, because the whole defect this
 * field repairs was three call sites deciding for themselves and all three choosing the
 * statement.
 */
function recallDocuments(observation: UseObservation): readonly string[] {
  return observation.documents ?? observation.statements;
}

function flatten(observations: readonly UseObservation[]): {
  readonly pairs: readonly PairRow[];
  readonly served: number;
  readonly packTotal: number;
} {
  const pairs: PairRow[] = [];
  let served = 0;
  let packTotal = 0;
  for (const observation of observations) {
    if (observation.statements.length > 0) served += 1;
    packTotal += observation.statements.length;
    const measurable = tokenize(observation.query).length > 0;
    for (const document of recallDocuments(observation)) {
      pairs.push({ coverage: queryCoverage(observation.query, document), measurable });
    }
  }
  return { pairs, served, packTotal };
}

/**
 * Reduce what the facade saw to the registered census.
 *
 * `zeroCoveragePairs` counts every pair whose `queryCoverage` is 0, including
 * pairs with a content-free question (the kernel returns 0 there). They are
 * *reported separately* in `coverageProfile` rather than silently dropped, so a
 * reader can subtract them; dropping them would make `injectedPairs` and the
 * zero count describe different populations.
 */
export function useCensus(
  observations: readonly UseObservation[],
  arm: UseArm,
  widenedItems: number,
): UseCensus {
  const { pairs, served, packTotal } = flatten(observations);
  const requests = observations.length;
  return {
    arm,
    recallRequests: requests,
    recallServed: served,
    meanPackIds: requests === 0 ? 0 : packTotal / requests,
    injectedPairs: pairs.length,
    zeroCoveragePairs: pairs.filter((pair) => pair.coverage === 0).length,
    widenedItems,
  };
}

/**
 * The distribution behind the zero count, over measurable pairs only.
 *
 * A content-free question has no defined coverage: `queryCoverage` would return
 * 0, which is a statement about the question, not about the rule's relevance.
 * Bucketing those as `zero` would inflate the apparent share of unrelated
 * rules, so they are counted in `unmeasurablePairs` and excluded from the mean
 * and the buckets.
 */
export function coverageProfile(observations: readonly UseObservation[]): CoverageProfile {
  const { pairs } = flatten(observations);
  const measured = pairs.filter((pair) => pair.measurable);
  const buckets = { zero: 0, partial: 0, full: 0 };
  let total = 0;
  for (const pair of measured) {
    total += pair.coverage;
    if (pair.coverage === 0) buckets.zero += 1;
    else if (pair.coverage >= 1) buckets.full += 1;
    else buckets.partial += 1;
  }
  return {
    measuredPairs: measured.length,
    unmeasurablePairs: pairs.length - measured.length,
    meanCoverage: measured.length === 0 ? 0 : total / measured.length,
    buckets,
  };
}

/** Share of injected pairs with zero coverage; 0 when nothing was injected. */
export function zeroCoverageShare(census: UseCensus): number {
  return census.injectedPairs === 0 ? 0 : census.zeroCoveragePairs / census.injectedPairs;
}

/**
 * Which records were served, and how often — the use-side counterpart of the store's own census.
 *
 * `storeItems` says what the store holds and `pack.summary` says how many items a pack carried; both
 * are means over a run, and neither can answer "was this record ever used, and where". A store of
 * fifteen records over 162 requests has a shape, and the shape is the only way to tell a record that
 * is load-bearing from one that has never been rendered. R92's own numbers make the case: 1,119
 * candidates were refused for size and the pack still averaged 1.09 items, so at most two of the
 * fifteen could have been doing any work in any single request — which ones, nothing recorded.
 *
 * `distinct` counts ids seen at least once; `byItem` is sorted by id so two arms compare without a
 * second sort, and `meanPerRequest` is `null` over no request because `0` would read as a measurement.
 * `unidentified` is the count of requests whose caller recorded no ids, so a partially instrumented
 * run says so instead of reporting its own gap as a zero.
 */
export type ServedCensus = {
  readonly requests: number;
  /** Requests that recorded ids at all. Lower than `requests` when the caller did not instrument. */
  readonly identified: number;
  /** Distinct item ids served anywhere in the run. */
  readonly distinct: number;
  /** Mean ids per identified request; `null` when no request was identified. */
  readonly meanPerRequest: number | null;
  /** The largest pack the run served, in items. */
  readonly maxPerRequest: number;
  /** Requests served each id, ascending by id. Only ids that were served at least once. */
  readonly byItem: readonly { readonly id: string; readonly requests: number }[];
};

/**
 * Reduce the facade's observations to the served-id census.
 *
 * A request that recorded `ids: []` is identified and empty — the pack rendered nothing — which is a
 * different fact from a request that recorded no ids at all, and the two are counted separately.
 */
export function servedCensus(observations: readonly UseObservation[]): ServedCensus {
  const counts = new Map<string, number>();
  let identified = 0;
  let total = 0;
  let max = 0;
  for (const observation of observations) {
    if (observation.ids === undefined) continue;
    identified += 1;
    total += observation.ids.length;
    if (observation.ids.length > max) max = observation.ids.length;
    // A pack that rendered the same item twice is one item in the prompt and two entries here; the
    // count is of *renders*, because the census grades what the model read.
    for (const id of observation.ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return {
    requests: observations.length,
    identified,
    distinct: counts.size,
    meanPerRequest: identified === 0 ? null : total / identified,
    maxPerRequest: max,
    byItem: [...counts.entries()]
      // Map keys are distinct, so a tie cannot occur and the comparator needs no third arm: the
      // `0` a three-way compare would carry is a branch no run can reach, and an unreachable branch
      // in a comparator reads as an untested case rather than as an impossible one.
      .sort(([left], [right]) => (left < right ? -1 : 1))
      .map(([id, requests]) => ({ id, requests })),
  };
}

/**
 * A fixed, ascending grid of candidate `minCoverage` values.
 *
 * This is a *measurement ladder*, not a chosen floor. It is fixed in source
 * before any dispatch and never derived from `l4-paired`, so the histogram
 * committed by an observation round is the population from which U3's floor is
 * computed BEFORE its own dispatch, as AUDIT 34.22 requires. Zero is the
 * as-is configuration (`buildPack` keeps every hit when `floor <= 0`). The
 * upper points bracket the non-zero lexical coverage mass measured offline on
 * the pinned corpus (p50 about 0.069, p90 about 0.14, max about 0.33).
 */
export const COVERAGE_FLOORS = [0, 0.01, 0.02, 0.03, 0.05, 0.08, 0.1, 0.15, 0.2, 0.3] as const;

/** One grid point: what a floor does to the delivered population. */
export type CoverageFloorRow = {
  readonly minCoverage: number;
  /** Measurable pairs whose coverage is at least this floor. */
  readonly retainedPairs: number;
  /** Served, measurable packs keeping at least one statement. */
  readonly retainedPacks: number;
  /** Served, measurable packs a floor at this level would empty. */
  readonly emptiedPacks: number;
};

/** Quantiles of the non-zero coverage of measurable pairs, in [0, 1]. */
export type CoverageQuantiles = {
  readonly min: number;
  readonly p10: number;
  readonly p25: number;
  readonly p50: number;
  readonly p75: number;
  readonly p90: number;
  readonly max: number;
};

/**
 * The committed use-side population behind the seven-field census.
 *
 * R46 (run `42317807270`) committed `injectedPairs 3016`,
 * `zeroCoveragePairs 1175` — one scalar, a zero share of 0.3896. TECH-DESIGN
 * 17.89 requires U3's floor to be computed from a committed histogram, and one
 * number cannot support that: two populations with the same zero share can
 * empty a different number of packs under the same floor, and the retention
 * curve over candidate floors is not recoverable from a scalar. This shape is
 * additive and optional; older artefacts carry none and read as "not measured".
 */
export type CoverageHistogram = {
  /** Measurable pairs, from `coverageProfile` so the two readings cannot drift. */
  readonly measuredPairs: number;
  /** Pairs whose question has no content term; coverage is undefined for them. */
  readonly unmeasurablePairs: number;
  /** Served packs whose question has no content term, excluded from every floor. */
  readonly unmeasurablePacks: number;
  readonly nonzeroQuantiles: CoverageQuantiles;
  /** One row per `COVERAGE_FLOORS` entry, in the same order. */
  readonly floors: readonly CoverageFloorRow[];
  /**
   * The two medians a "coverage p50" claim can mean, over this same population.
   *
   * Nested here rather than written beside the histogram, because a median built
   * from a different observation list than the curve would be a second
   * population rather than a second reading, and one block is one source.
   * Absent on artefacts written before it, which read as "not measured".
   */
  readonly medians?: CoverageMedians;
};

function quantileOf(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] as number;
}

type MeasuredRows = {
  /** Served packs whose question has at least one content term, with their coverages. */
  readonly measured: readonly { readonly coverages: readonly number[] }[];
  /** Served packs a floor cannot judge, because the question has no content term. */
  readonly unmeasurablePacks: number;
};

/**
 * The one population every coverage reading is over.
 *
 * `coverageHistogram` and `coverageMedians` disagreeing about which packs are
 * measurable would be the same defect as the three call sites that used to
 * decide for themselves whether a rule says its condition. They are two
 * reductions of this single pass.
 */
function measuredRows(observations: readonly UseObservation[]): MeasuredRows {
  const rows = observations.map((observation) => ({
    served: observation.statements.length > 0,
    measurable: tokenize(observation.query).length > 0,
    coverages: recallDocuments(observation).map((document) =>
      queryCoverage(observation.query, document),
    ),
  }));
  return {
    measured: rows.filter((row) => row.served && row.measurable),
    unmeasurablePacks: rows.filter((row) => row.served && !row.measurable).length,
  };
}

/**
 * The two medians a registration can mean when it says "coverage p50".
 *
 * R54's third prediction is written as "coverage p50 at least 12%", and the
 * committed verifier grades it against `nonzeroQuantiles.p50` — the median over
 * the pairs that cleared zero. R49 read `4.7%` and R51 read `4.88%` that way, so
 * the series is defined by where the field sits. What the artefact never carried
 * is the other population: R47 committed 750 zeros in 2,188 injected pairs, so
 * the median over every delivered pair is that population's 24th non-zero
 * percentile, about `0.027`, and it is in no field at all.
 *
 * The zeros were delivered. A bar met on the survivors is compatible with a
 * delivery that is eight-tenths unrelated, which is exactly the state R54's
 * third refutation has to tell apart from a distiller that names the situation.
 * Both are reported because neither is the right one alone: a floor acts only on
 * the survivors, while the model saw the zeros too.
 *
 * Both are upper medians — index `floor(0.5 * n)` — matching `quantileOf` and
 * therefore `nonzeroQuantiles`, so the two shapes cannot disagree about the
 * convention either.
 */
export type CoverageMedians = {
  /** Delivered pairs from measurable packs; the population of both medians. */
  readonly pairs: number;
  /** Pairs whose delivered coverage is exactly zero. */
  readonly zeroPairs: number;
  /** Median over every delivered pair, zeros included. */
  readonly medianAllPairs: number;
  /** Median over the non-zero pairs only; 0 when every pair is zero. */
  readonly medianNonzero: number;
};

/**
 * Both medians over the population `coverageHistogram` commits a curve for.
 *
 * No model call and no new threshold: the same `tokenize`, `queryCoverage` and
 * `recallDocuments` the floor uses, reduced to two numbers instead of seven
 * quantiles.
 */
export function coverageMedians(observations: readonly UseObservation[]): CoverageMedians {
  return mediansOf(measuredRows(observations).measured);
}

/** The same reduction over rows a caller already has, so no reading re-measures. */
function mediansOf(measured: MeasuredRows['measured']): CoverageMedians {
  const all: number[] = [];
  let zeroPairs = 0;
  for (const row of measured) {
    for (const coverage of row.coverages) {
      all.push(coverage);
      if (coverage === 0) zeroPairs += 1;
    }
  }
  const nonzero = all.filter((coverage) => coverage > 0).sort((a, b) => a - b);
  return {
    pairs: all.length,
    zeroPairs,
    medianAllPairs: quantileOf([...all].sort((a, b) => a - b), 0.5),
    medianNonzero: quantileOf(nonzero, 0.5),
  };
}

/**
 * Reduce the facade's observations to a persistable histogram.
 *
 * Pure over what `/v1/recall` already saw, using the same `queryCoverage` and
 * `tokenize` kernel functions as `buildPack`'s `minCoverage` floor. No model
 * call, no mock, no new threshold and no change to any pack: this only measures
 * what a floor WOULD do, on a fixed grid, so a floor can be registered before
 * the dispatch that applies it. `coverageProfile` is called here — the profile
 * and the histogram share one population by construction.
 */
export function coverageHistogram(observations: readonly UseObservation[]): CoverageHistogram {
  const profile = coverageProfile(observations);
  const { measured, unmeasurablePacks } = measuredRows(observations);
  const nonzero = measured
    .flatMap((row) => row.coverages)
    .filter((coverage) => coverage > 0)
    .sort((a, b) => a - b);

  const floors = COVERAGE_FLOORS.map((minCoverage): CoverageFloorRow => {
    let retainedPairs = 0;
    let retainedPacks = 0;
    let emptiedPacks = 0;
    for (const row of measured) {
      // buildPack keeps every hit when floor <= 0 and otherwise keeps coverage
      // >= floor; coverage is always >= 0, so `>= minCoverage` covers both.
      const kept = row.coverages.filter((coverage) => coverage >= minCoverage).length;
      retainedPairs += kept;
      if (kept > 0) retainedPacks += 1;
      else emptiedPacks += 1;
    }
    return { minCoverage, retainedPairs, retainedPacks, emptiedPacks };
  });

  return {
    measuredPairs: profile.measuredPairs,
    unmeasurablePairs: profile.unmeasurablePairs,
    unmeasurablePacks,
    nonzeroQuantiles: {
      min: quantileOf(nonzero, 0),
      p10: quantileOf(nonzero, 0.1),
      p25: quantileOf(nonzero, 0.25),
      p50: quantileOf(nonzero, 0.5),
      p75: quantileOf(nonzero, 0.75),
      p90: quantileOf(nonzero, 0.9),
      max: nonzero.length === 0 ? 0 : (nonzero[nonzero.length - 1] as number),
    },
    floors,
    // A "coverage p50" claim in a registration has two possible subjects and the
    // artefact now answers both, from the rows this call already measured.
    medians: mediansOf(measured),
  };
}
