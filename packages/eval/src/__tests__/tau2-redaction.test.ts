import { describe, expect, it } from 'vitest';
import { guardReplaces } from '../tau2-redaction.js';

/**
 * The fifth layer, and the one that looked like the first.
 *
 * R88 read `faithfulness 82 of 128` with only two records clipped, and the reconstruction that produced
 * the ceiling kept all 128: the loss was neither the ceiling nor an abstraction. `kernel/guard.ts`
 * redacted before persistence, and its phone rule is ten digits — which is the shape of every τ² retail
 * `product_id`, `item_id` and `new_item_id`.
 *
 * The guard has since been taught the difference — a bare digit run under a reference key is a row key —
 * so this predicate answers a narrower question than it used to: not "would the guard replace this
 * string", which a reference would answer yes to and be wrong, but "would the guard take it **in the
 * slot it came from**". Every entity a census counts came from a tool argument, so the slot is known.
 */

describe('guardReplaces', () => {
  it('no longer replaces the identifiers a τ² retail answer is made of', () => {
    // Measured, not invented: these are task 15's own gold arguments. They arrive as
    // `product_id="7363354090"` and `item_ids=["1615379700"]`, and the key is what tells the guard they
    // are references rather than telephone numbers.
    expect(guardReplaces('7363354090')).toBe(false);
    expect(guardReplaces('1615379700')).toBe(false);
  });

  it('still replaces an email address, which is personal data in every position', () => {
    // τ² retail's `user_id` really is an address. Keeping it would trade a real privacy property for a
    // benchmark number, so the census reports this as the guard's loss and the arm is graded with it
    // lost: 127 of 128, not 128 of 128.
    expect(guardReplaces('daikisanchez1479@example.com')).toBe(true);
  });

  it('still replaces anything the guard would take outside a reference slot too', () => {
    // The case that keeps this predicate from becoming an alibi: a value the guard objects to on its own
    // merits is a real redaction wherever it sits.
    expect(guardReplaces('+1 415-555-2671')).toBe(true);
    expect(guardReplaces(`sk-${'a'.repeat(24)}`)).toBe(true);
  });

  it('leaves the identifiers that do not look like a phone number', () => {
    // The half that makes this a finding rather than a bug report: the guard is pattern-matching, and a
    // record keeps every value whose shape it does not recognise.
    expect(guardReplaces('#W5199551')).toBe(false);
    expect(guardReplaces('fatima_johnson_7581')).toBe(false);
    expect(guardReplaces('paypal_5364164')).toBe(false);
    expect(guardReplaces('78712')).toBe(false);
  });

  it('cannot tell a bare phone number from a reference, and does not pretend to', () => {
    // Ten digits with no separators is the one case the field name cannot settle: `user_id="4155552671"`
    // reads exactly like `product_id="7363354090"`. The exemption is decided by the key, so this
    // survives — the price of not eating every product id in the corpus. A formatted number, or the
    // same digits under `phone`, is still redacted.
    expect(guardReplaces('4155552671')).toBe(false);
  });

  it('is a predicate, so an empty string and a sentence are answered rather than thrown on', () => {
    expect(guardReplaces('')).toBe(false);
    expect(guardReplaces('Q: you want to exchange the boots')).toBe(false);
  });
});
