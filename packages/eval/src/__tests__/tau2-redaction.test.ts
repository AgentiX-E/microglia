import { describe, expect, it } from 'vitest';
import { guardReplaces } from '../tau2-redaction.js';

/**
 * The fifth layer, and the one that looked like the first.
 *
 * R88 read `faithfulness 82 of 128` with only two records clipped, and the reconstruction that produced
 * the ceiling kept all 128: the loss was neither the ceiling nor an abstraction. `kernel/guard.ts`
 * redacts before persistence, and its phone rule is ten digits — which is the shape of every τ² retail
 * `product_id`, `item_id` and `new_item_id`. The writer is verbatim; the guard is what removes the
 * identity, and this module is the one definition of that sentence so a census can count it.
 */

describe('guardReplaces', () => {
  it('replaces the identifiers a τ² retail answer is made of', () => {
    // Measured, not invented: these are task 15's own gold arguments. `7363354090` is a product id and
    // matches the guard's North-American phone rule; the rest of the call's values do not.
    expect(guardReplaces('7363354090')).toBe(true);
    expect(guardReplaces('1615379700')).toBe(true);
  });

  it('leaves the identifiers that do not look like a phone number', () => {
    // The half that makes this a finding rather than a bug report: the guard is not broken, it is
    // pattern-matching, and a record keeps every value whose shape it does not recognise.
    expect(guardReplaces('#W5199551')).toBe(false);
    expect(guardReplaces('fatima_johnson_7581')).toBe(false);
    expect(guardReplaces('paypal_5364164')).toBe(false);
    expect(guardReplaces('78712')).toBe(false);
  });

  it('replaces an email address, which is the other rule this corpus trips', () => {
    expect(guardReplaces('daikisanchez1479@example.com')).toBe(true);
  });

  it('is a predicate, so an empty string and a sentence are answered rather than thrown on', () => {
    expect(guardReplaces('')).toBe(false);
    expect(guardReplaces('Q: you want to exchange the boots')).toBe(false);
  });
});
