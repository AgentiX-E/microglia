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
    for (const statement of observation.statements) {
      pairs.push({ coverage: queryCoverage(observation.query, statement), measurable });
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
