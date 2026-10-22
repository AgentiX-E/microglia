import { describe, expect, it } from 'vitest';
import {
  CONVENTIONS,
  HELD_OUT,
  buildConventions,
  holdoutCases,
  trainingSplit,
  unreachableCases,
} from '../conventions.js';
import { reachableShare } from '../pairs.js';

const scopeOf = (entry: { domain: string; intent: string }) => ({
  domain: entry.domain,
  intent: entry.intent,
});

describe('the pair-contrast corpus', () => {
  it('gives each domain its own exception, and one domain a convention nobody teaches', () => {
    const cases = buildConventions();
    const comparison = cases.filter((entry) => entry.intent === 'comparison' && entry.split === 'teach');
    expect(new Set(comparison.map((entry) => entry.goldMark)).size).toBe(3);
    expect(CONVENTIONS[HELD_OUT]).toBe('scatter');
    expect(trainingSplit(cases).some((entry) => entry.domain === HELD_OUT)).toBe(false);
  });

  it('has a wall: the held-out convention is unreachable, its trend case is not', () => {
    const cases = buildConventions();
    const train = trainingSplit(cases);
    const heldOut = holdoutCases(cases).filter((entry) => entry.domain === HELD_OUT);

    expect(unreachableCases(cases).map((entry) => entry.id)).toEqual([`cvho_${HELD_OUT}_comparison`]);
    // The trend question in the same domain shares no scope key with training, so
    // the strict denominator counts it as unreachable as well; widening is what
    // reaches it, and this number deliberately does not credit that.
    const reachable = reachableShare(
      train.map(scopeOf),
      heldOut.filter((entry) => entry.intent === 'trend').map(scopeOf),
    );
    expect(reachable).toBe(0);
  });

  it('splits by question, not only by domain, so the holdout has reachable mass', () => {
    const cases = buildConventions();
    // Without the twin questions every evaluated key would be untaught and the
    // recovery denominator would be zero: this is the property the split exists
    // for, stated as a number rather than as an intention.
    expect(reachableShare(trainingSplit(cases).map(scopeOf), holdoutCases(cases).map(scopeOf))).toBe(0.75);
  });

  it('keeps the control honest: trend agrees with the policy everywhere', () => {
    for (const entry of buildConventions().filter((one) => one.intent === 'trend')) {
      expect(entry.goldMark).toBe(entry.policyMark);
    }
  });
});
