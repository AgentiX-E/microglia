/**
 * Default policy, and the reasoning for each number.
 *
 * The defaults are tuned for an embedded, single-tenant deployment in which one
 * trusted user corrects one host application. A multi-user deployment should
 * raise `minSupport` and `singleObservationTrust`; the evaluation harness treats
 * those two as the knobs that trade cold-start speed against poisoning risk.
 */
import type { Policy } from './types.js';

export const defaultPolicy: Policy = {
  // A single well-trusted correction clears this; a thumbs-down alone does not.
  activationThreshold: 0.6,
  // Retirement sits below activation so an item cannot oscillate on one event.
  retirementThreshold: 0.45,
  // One trusted edit (weight 0.9) must clear this; two thumbs-down (0.5 each) do not.
  minSupport: 0.8,
  // One contradiction is tolerated; the second is not noise.
  maxContradictions: 1,
  minApplicationsForRetirement: 3,
  failureRateThreshold: 0.4,
  singleObservationTrust: 0.7,
  // Below this, evidence is held for review rather than allowed to steer output.
  quarantineBelowTrust: 0.35,
  // One contradiction is a real signal but not a refutation; two are not noise.
  contradictionPenalty: 1.0,
  priorSuccess: 1,
  priorFailure: 1,
  defaultBudget: 1200,
  rejectUnsafeKnowledge: true,
};

export function resolvePolicy(overrides: Partial<Policy> = {}): Policy {
  return { ...defaultPolicy, ...overrides };
}
