import { describe, expect, it } from 'vitest';
import { DEFAULT_TRACE_CLAIMS, resolveTraceClaims } from '../trace-claims.js';

describe('resolveTraceClaims', () => {
  it('defaults to three, and says the default was not declared', () => {
    const plan = resolveTraceClaims({});
    expect(plan.ceiling).toBe(DEFAULT_TRACE_CLAIMS);
    expect(plan.ceiling).toBe(3);
    // Three is both the default and a legal choice, so the flag is what tells an arm from a control.
    expect(plan.declared).toBe(false);
  });

  it('reads a declared ceiling as declared, even when it is the default value', () => {
    const plan = resolveTraceClaims({ TAU_TRACE_CLAIMS: '3' });
    expect(plan.ceiling).toBe(3);
    expect(plan.declared).toBe(true);
  });

  it('accepts the ends of the range', () => {
    expect(resolveTraceClaims({ TAU_TRACE_CLAIMS: '1' }).ceiling).toBe(1);
    expect(resolveTraceClaims({ TAU_TRACE_CLAIMS: '8' }).ceiling).toBe(8);
    expect(resolveTraceClaims({ TAU_TRACE_CLAIMS: ' 6 ' }).ceiling).toBe(6);
  });

  it('refuses a ceiling the parser could not apply rather than rounding it', () => {
    for (const raw of ['0', '9', '3.5', 'three', '-1', '1e3', 'NaN', 'Infinity']) {
      expect(() => resolveTraceClaims({ TAU_TRACE_CLAIMS: raw }), raw).toThrow(/TAU_TRACE_CLAIMS/);
    }
  });

  it('treats an empty or blank value as unset, which is what an absent repository variable looks like', () => {
    expect(resolveTraceClaims({ TAU_TRACE_CLAIMS: '' }).declared).toBe(false);
    expect(resolveTraceClaims({ TAU_TRACE_CLAIMS: '   ' }).declared).toBe(false);
  });
});
