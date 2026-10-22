/**
 * The corpus L2b needs: conventions that live in a domain, and one domain that
 * has none.
 *
 * The controlled study saturates because every convention in it is learnable
 * from a correction somewhere else — widening reaches the unseen domain, which is
 * the point of that lane. A pair-contrast lane needs the opposite property: a
 * rule whose correct answer exists only for a domain nobody taught, so the
 * oracle's advantage over the loop is real and the recovery denominator is not
 * inflated by knowledge no correction could supply.
 *
 * Each domain gets one exception to the global policy for `comparison`: `sales`
 * and `hr` differ from each other, and `ops` differs from both. A model that
 * learned "comparison → bar" in two domains and widened it will be wrong in the
 * third, and no amount of feedback about `sales` can fix it.
 *
 * ## Why every key has two questions
 *
 * A holdout that contains only the untaught domain has no reachable mass: every
 * evaluated case fails the `reachableShare` test by construction, so the recovery
 * denominator is zero and a verdict computed over it says nothing about the
 * loop. The corpus therefore states each `(domain, intent)` key twice — a
 * teaching question and a holdout question that differ in the columns the
 * question names, the same way `buildCorpus` separates its two phases.
 *
 * That makes the split informative in both directions: a rule learned on
 * `sales`'s comparison question is *reachable* for `sales`'s holdout question
 * (the scope matches, the field does not, so this is transfer rather than
 * memorisation), and it is *unreachable* for `ops`, whose convention no other
 * domain shares. A lane can then report recovery over mass it could have
 * reached, separately from the wall it could not.
 */
import {
  DOMAINS,
  baselineMark,
  goldMark,
  questionText,
  resolveRegistry,
  specFor,
  type CorpusItem,
  type DomainSlot,
  type Query,
} from './scenario.js';
import type { ChartIntent, ChartMark } from './workload/index.js';

/** Per-domain exceptions to the policy. A domain absent here uses `goldMark`. */
export const CONVENTIONS: Readonly<Record<string, ChartMark>> = {
  sales: 'line',
  hr: 'bar',
  ops: 'scatter',
};

/** The domain whose convention is never taught, so it cannot be reached. */
export const HELD_OUT = 'ops';

/** Which side of the split a question is on. */
export type ConventionSplit = 'teach' | 'holdout';

/**
 * One question, with everything a lane needs to run it.
 *
 * It *is* a `CorpusItem` — `id`, `query`, `gold` and `baseline` are the study's
 * own shape — so `applyKnowledge` reads it without an adapter. The two marks are
 * carried beside the specs because a lane compares marks far more often than it
 * compares specs, and deriving one from the other at every call site is how the
 * two disagree.
 */
export type ConventionCase = CorpusItem & {
  readonly domain: string;
  readonly intent: ChartIntent;
  /** The answer the domain's convention demands. */
  readonly goldMark: ChartMark;
  /** What a model that learned the global policy would answer here. */
  readonly policyMark: ChartMark;
  readonly split: ConventionSplit;
};

/** Fixed per question: the corpus varies the columns, not the grain or the count. */
const GRAIN = 'month' as const;
const CATEGORIES = 4;

/**
 * The intents the corpus carries: the exception, and the control that has none.
 *
 * `trend` is a control because no domain overrides it, so it *is* reachable by
 * widening and a lane that fails there has a mechanism problem rather than a
 * corpus wall.
 */
const INTENTS = ['comparison', 'trend'] as const;

const SPLITS = ['teach', 'holdout'] as const;

/**
 * The convention a question is judged against.
 *
 * Only `comparison` has per-domain exceptions; every other intent follows the
 * policy, which is what makes the trend case a control rather than a second
 * exception.
 */
function conventionFor(domain: string, intent: ChartIntent): ChartMark {
  if (intent !== 'comparison') return goldMark(intent, CATEGORIES);
  return CONVENTIONS[domain] ?? goldMark(intent, CATEGORIES);
}

/**
 * Build one question for a key.
 *
 * The two splits read *different* category and measure columns from the same
 * schema. A holdout question that reused the teaching columns would let a store
 * pass by memorising `revenue`; this way the scope is the only thing that
 * transfers, which is the claim under test.
 */
function conventionCase(
  slot: DomainSlot,
  intent: ChartIntent,
  split: ConventionSplit,
): ConventionCase {
  const holdout = split === 'holdout';
  const measure = slot.measures[holdout ? 1 : 0];
  const measureB = slot.measures[holdout ? 0 : 1];
  const category = slot.categories[holdout ? 1 : 0];
  const id = holdout ? `cvho_${slot.name}_${intent}` : `cv_${slot.name}_${intent}`;
  const query: Query = {
    id,
    text: questionText(intent, slot.name, measure.name, category.name, measureB.name, GRAIN),
    domain: slot.name,
    intent,
    field: measure.name,
    measureB: measureB.name,
    category: category.name,
    temporal: slot.temporal.name,
    categoryCount: CATEGORIES,
    grain: GRAIN,
  };
  const goldMark = conventionFor(slot.name, intent);
  return {
    id,
    domain: slot.name,
    intent,
    query,
    gold: specFor(query, goldMark),
    baseline: specFor(query, baselineMark(intent, slot.name)),
    goldMark,
    policyMark: goldMarkOf(intent),
    split,
  };
}

/** The policy's answer for an intent, independent of domain. */
function goldMarkOf(intent: ChartIntent): ChartMark {
  return goldMark(intent, CATEGORIES);
}

/**
 * Every question in the corpus, both splits, every domain.
 *
 * The generator is uniform: the held-out domain gets its teaching question too,
 * and `trainingSplit` is the single place that decides what teaches. Skipping it
 * here would move that decision into the loop index, where it is invisible and
 * where a lane could teach the wall by accident.
 */
export function buildConventions(): readonly ConventionCase[] {
  const cases: ConventionCase[] = [];
  for (const slot of resolveRegistry(DOMAINS)) {
    for (const intent of INTENTS) {
      for (const split of SPLITS) cases.push(conventionCase(slot, intent, split));
    }
  }
  return cases;
}

/** The teaching split: what may be corrected, which excludes the held-out domain. */
export function trainingSplit(cases: readonly ConventionCase[]): readonly ConventionCase[] {
  return cases.filter((entry) => entry.split === 'teach' && entry.domain !== HELD_OUT);
}

/** The evaluated split: one question per key, none of them taught. */
export function holdoutCases(cases: readonly ConventionCase[]): readonly ConventionCase[] {
  return cases.filter((entry) => entry.split === 'holdout');
}

/**
 * Evaluated cases whose convention no training case could teach.
 *
 * Narrower than "the held-out domain" on purpose: the domain's `trend` question
 * has no exception, so it is reachable through the widened global rule and does
 * not belong in the wall. Only the question whose answer contradicts every
 * taught domain does.
 */
export function unreachableCases(cases: readonly ConventionCase[]): readonly ConventionCase[] {
  return cases.filter(
    (entry) =>
      entry.split === 'holdout' && entry.domain === HELD_OUT && entry.goldMark !== entry.policyMark,
  );
}
