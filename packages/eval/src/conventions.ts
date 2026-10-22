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
 */
import { DOMAINS, goldMark } from './scenario.js';
import type { ChartIntent, ChartMark } from './workload/index.js';

/** Per-domain exceptions to the policy. A domain absent here uses `goldMark`. */
export const CONVENTIONS: Readonly<Record<string, ChartMark>> = {
  sales: 'line',
  hr: 'bar',
  ops: 'scatter',
};

/** The domain whose convention is never taught, so it cannot be reached. */
export const HELD_OUT = 'ops';

export type ConventionCase = {
  readonly id: string;
  readonly domain: string;
  readonly intent: ChartIntent;
  readonly gold: ChartMark;
  /** What a model that learned the global policy would answer here. */
  readonly policy: ChartMark;
};

/**
 * One `comparison` case per domain, plus a `trend` case per domain as a control:
 * `trend` has no exception, so it *is* reachable and a lane that fails there has
 * a mechanism problem rather than a corpus wall.
 */
export function buildConventions(): readonly ConventionCase[] {
  const cases: ConventionCase[] = [];
  for (const domain of DOMAINS) {
    const name = domain.name;
    const exception = CONVENTIONS[name];
    cases.push({
      id: `cv_${name}_comparison`,
      domain: name,
      intent: 'comparison',
      gold: exception ?? goldMark('comparison', 4),
      policy: goldMark('comparison', 4),
    });
    cases.push({
      id: `cv_${name}_trend`,
      domain: name,
      intent: 'trend',
      gold: goldMark('trend', 4),
      policy: goldMark('trend', 4),
    });
  }
  return cases;
}

/** The teaching split: every case except the held-out domain. */
export function trainingSplit(cases: readonly ConventionCase[]): readonly ConventionCase[] {
  return cases.filter((entry) => entry.domain !== HELD_OUT);
}

/** Evaluated cases whose convention no training case could teach. */
export function unreachableCases(cases: readonly ConventionCase[]): readonly ConventionCase[] {
  return cases.filter(
    (entry) => entry.domain === HELD_OUT && entry.gold !== entry.policy,
  );
}
