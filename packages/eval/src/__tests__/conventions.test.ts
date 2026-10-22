import { describe, expect, it } from 'vitest';
import { CONVENTIONS, HELD_OUT, buildConventions, trainingSplit, unreachableCases } from '../conventions.js';
import { reachableShare } from '../pairs.js';

describe('the pair-contrast corpus', () => {
  it('gives each domain its own exception, and one domain a convention nobody teaches', () => {
    const cases = buildConventions();
    const comparison = cases.filter((entry) => entry.intent === 'comparison');
    expect(new Set(comparison.map((entry) => entry.gold)).size).toBe(3);
    expect(CONVENTIONS[HELD_OUT]).toBe('scatter');
    expect(trainingSplit(cases).some((entry) => entry.domain === HELD_OUT)).toBe(false);
  });

  it('has a wall: the held-out convention is unreachable, its trend cases are not', () => {
    const cases = buildConventions();
    const train = trainingSplit(cases);
    const heldOut = cases.filter((entry) => entry.domain === HELD_OUT);

    expect(unreachableCases(cases).map((entry) => entry.id)).toEqual([`cv_${HELD_OUT}_comparison`]);
    // The trend control in the same domain is reachable, so a failure there is a
    // mechanism problem rather than the corpus's wall.
    const reachable = reachableShare(
      train.map((entry) => ({ domain: entry.domain, intent: entry.intent })),
      heldOut.filter((entry) => entry.intent === 'trend').map((entry) => ({ domain: entry.domain, intent: entry.intent })),
    );
    expect(reachable).toBe(0);
  });

  it('keeps the control honest: trend agrees with the policy everywhere', () => {
    for (const entry of buildConventions().filter((one) => one.intent === 'trend')) {
      expect(entry.gold).toBe(entry.policy);
    }
  });
});
