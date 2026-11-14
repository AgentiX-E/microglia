/**
 * The knobs `/v1/recall` accepts.
 *
 * Two of them (`minEvidence`, `anchoring`) were honoured by the pack layer and absent from the wire, so
 * the first test here is not about parsing: it is that a query carrying them reaches `recall` intact.
 * The rest are about the other half of the same defect — a value that cannot be honoured has to be
 * refused with a reason, because `Number('abc')` is `NaN` and a pack built under `NaN` serves nothing,
 * which downstream is indistinguishable from a store with no match.
 */
import { describe, expect, it } from 'vitest';

import { recallQueryOf } from '../recall-query.js';

function read(params: Record<string, string>) {
  return (name: string) => params[name];
}

const FIXED = { task: 'tau2.act', text: 'cancel my order' };

describe('recallQueryOf', () => {
  it('carries the corroboration floor and the anchoring mode, which the route used to drop', () => {
    const parsed = recallQueryOf(read({ minEvidence: '3', anchoring: 'scope' }), FIXED);
    expect(parsed).toEqual({ query: { ...FIXED, minEvidence: 3, anchoring: 'scope' } });
  });

  it('carries every knob at once, so no field is lost in a spread', () => {
    const parsed = recallQueryOf(
      read({ budget: '400', limit: '8', minCoverage: '0.2', minEvidence: '2', anchoring: 'lexical' }),
      FIXED,
    );
    expect(parsed).toEqual({
      query: { ...FIXED, budget: 400, limit: 8, minCoverage: 0.2, minEvidence: 2, anchoring: 'lexical' },
    });
  });

  it('leaves an absent knob absent rather than inventing the pack layer\'s default', () => {
    // `minEvidence` absent means 1 and `anchoring` absent means 'scope', but those are the pack layer's
    // statements. Restating them here would make this file the second place the policy is written.
    expect(recallQueryOf(read({}), FIXED)).toEqual({ query: { ...FIXED } });
  });

  it('refuses a limit that is not a whole number, because NaN serves nothing quietly', () => {
    expect(recallQueryOf(read({ limit: 'abc' }), FIXED)).toEqual({ error: 'limit is not a positive integer of items' });
    expect(recallQueryOf(read({ limit: '0' }), FIXED)).toEqual({ error: 'limit is not a positive integer of items' });
    expect(recallQueryOf(read({ limit: '2.5' }), FIXED)).toEqual({
      error: 'limit is not a positive integer of items',
    });
  });

  it('refuses a corroboration floor of zero, which would admit a rule with no evidence', () => {
    expect(recallQueryOf(read({ minEvidence: '0' }), FIXED)).toEqual({
      error: 'minEvidence is not a positive count of corrections',
    });
  });

  it('carries the attempt watermark, which only a writer between attempts sets', () => {
    // `before` is the one knob whose absence is a *statement* rather than a default: every offline arm
    // recalls a store frozen before the evaluation, and a watermark invented here would filter those
    // packs against an attempt nothing declared. Attempts are 1-based, so `1` is the first attempt.
    expect(recallQueryOf(read({ before: '2' }), FIXED)).toEqual({ query: { ...FIXED, before: 2 } });
    expect(recallQueryOf(read({ before: '1' }), FIXED)).toEqual({ query: { ...FIXED, before: 1 } });
  });

  it('refuses a watermark that is not an attempt number, because 0 silently serves everything', () => {
    // `before=0` matches every item (no attempt is below zero), so it is not a typo that fails loudly:
    // it is a leak that reads as an empty lesson. `2.5` is refused for the same reason the limit is.
    expect(recallQueryOf(read({ before: '0' }), FIXED)).toEqual({ error: 'before is not an attempt number' });
    expect(recallQueryOf(read({ before: '-1' }), FIXED)).toEqual({ error: 'before is not an attempt number' });
    expect(recallQueryOf(read({ before: '2.5' }), FIXED)).toEqual({ error: 'before is not an attempt number' });
  });

  it('refuses a coverage floor outside a share', () => {
    expect(recallQueryOf(read({ minCoverage: '2' }), FIXED)).toEqual({
      error: 'minCoverage is not a share between 0 and 1',
    });
    expect(recallQueryOf(read({ minCoverage: '-0.1' }), FIXED)).toEqual({
      error: 'minCoverage is not a share between 0 and 1',
    });
    // Zero is a legal floor: it means "any rule the scope allows", which is what the scope-anchored arm
    // asks for. Refusing it would refuse the arm this field exists to make runnable.
    expect(recallQueryOf(read({ minCoverage: '0' }), FIXED)).toEqual({
      query: { ...FIXED, minCoverage: 0 },
    });
  });

  it('refuses an anchoring mode it cannot honour', () => {
    expect(recallQueryOf(read({ anchoring: 'none' }), FIXED)).toEqual({
      error: 'anchoring is not one of lexical, scope',
    });
  });

  it('reports every problem, because the caller is reading a URL they wrote', () => {
    expect(recallQueryOf(read({ limit: '0', minEvidence: 'x', anchoring: 'y' }), FIXED)).toEqual({
      error:
        'limit is not a positive integer of items; minEvidence is not a positive count of corrections; ' +
        'anchoring is not one of lexical, scope',
    });
  });

  it('keeps the scope the route already parsed', () => {
    const scope = { domain: 'retail', reasonCode: 'R1' };
    expect(recallQueryOf(read({}), { ...FIXED, scope })).toEqual({ query: { ...FIXED, scope } });
  });
});
