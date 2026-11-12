/**
 * The pack-mode switch, and the property that makes the two arms comparable.
 *
 * The plan's output crosses two boundaries — out of this process into the driver's child environment,
 * and from there into the Python agent's HTTP call — so the tests below are not about a string. They are
 * about two claims: that the default reproduces the request every committed artefact was written with,
 * and that the prefix arm's knobs are the ones that actually stop retrieval. The second claim is the one
 * that can fail silently: a prefix arm whose `minCoverage` was left at a policy default would retrieve,
 * report a place it did not serve from, and read as "the prefix protocol does not help".
 */
import { describe, expect, it } from 'vitest';

import {
  PACK_MODES,
  PREFIX_CHAR_CEILING,
  PREFIX_ITEM_CEILING,
  resolvePackModePlan,
} from '../pack-mode-plan.js';

describe('resolvePackModePlan', () => {
  it('defaults to the retrieval every committed artefact ran, and says it was not declared', () => {
    // Both halves matter: the empty knob record is what keeps the request byte-identical, and
    // `declared: false` is what lets a readback know this was not the arm.
    expect(resolvePackModePlan({})).toEqual({ mode: 'retrieved', declared: false, knobs: {} });
  });

  it('treats a declared retrieval as the arm rather than as the default', () => {
    expect(resolvePackModePlan({ TAU_PACK_MODE: 'retrieved' })).toEqual({
      mode: 'retrieved',
      declared: true,
      knobs: {},
    });
  });

  it('stops retrieval in the prefix arm rather than asking for it politely', () => {
    const plan = resolvePackModePlan({ TAU_PACK_MODE: 'prefix' });
    expect(plan.mode).toBe('prefix');
    expect(plan.declared).toBe(true);
    // `scope` anchoring admits a scope-matched rule with no shared term, and a coverage floor of zero
    // means the gate cannot exclude what the anchoring admitted. Either one alone still retrieves.
    expect(plan.knobs['anchoring']).toBe('scope');
    expect(plan.knobs['minCoverage']).toBe('0');
    expect(plan.knobs['limit']).toBe(String(PREFIX_ITEM_CEILING));
    expect(plan.knobs['budget']).toBe(String(PREFIX_CHAR_CEILING));
    expect(Object.keys(plan.knobs).sort()).toEqual(['anchoring', 'budget', 'limit', 'minCoverage']);
  });

  it('bounds "no budget" with a ceiling a real store cannot reach, rather than with infinity', () => {
    // The renderer's contract is a number of characters and there is no spelling of "unbounded" that
    // survives it. 999 items against a store of tens is the guard; the test states the gap so the
    // number cannot drift down to a value that silently truncates the arm.
    expect(PREFIX_ITEM_CEILING).toBeGreaterThan(200);
    expect(PREFIX_CHAR_CEILING).toBeGreaterThan(100_000);
  });

  it('refuses a mode it cannot honour, with the two names it accepts', () => {
    expect(() => resolvePackModePlan({ TAU_PACK_MODE: 'all' })).toThrowError(
      "TAU_PACK_MODE must be unset or one of retrieved, prefix, not 'all'",
    );
    expect(() => resolvePackModePlan({ TAU_PACK_MODE: 'Prefix' })).toThrowError(/not 'Prefix'/);
  });

  it('has exactly the two modes the registration header accepts', () => {
    // The header validator in `prereg.ts` holds its own set, and the two lists drifting would mean a
    // registration declaring a mode the resolver refuses — a dispatch that dies before its first call
    // with a message about a typo nobody made.
    expect([...PACK_MODES]).toEqual(['retrieved', 'prefix']);
  });
});
