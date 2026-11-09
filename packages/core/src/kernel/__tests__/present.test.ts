import { describe, expect, it } from 'vitest';

import { present } from '../present.js';

describe('present', () => {
  it('returns the value it was given, unchanged and without copying', () => {
    const item = { id: 'k1' };
    expect(present(item, 'the item')).toBe(item);
    expect(present(0, 'a zero')).toBe(0);
    expect(present('', 'an empty string')).toBe('');
    expect(present(false, 'false')).toBe(false);
  });

  it('refuses undefined with a message naming what went missing', () => {
    // The message is the whole point: a `TypeError: Cannot read properties of undefined` four frames
    // later says where the value was used, and this says which invariant broke.
    expect(() => present(undefined, 'the bucket for "invoice"')).toThrow(
      'invariant violated: the bucket for "invoice"',
    );
  });

  it('refuses null as well, because `Map.get` and `JSON` both produce it', () => {
    expect(() => present(null, 'the address')).toThrow('invariant violated: the address');
  });

  it('does not treat a falsy value as missing, which is the bug the fallbacks it replaces carried', () => {
    // `items[0]?.status ?? 'missing'` could not tell an absent item from a present one whose status
    // is the empty string. A guard that conflates those is not a guard.
    expect(present('', 'an empty status')).toBe('');
  });
});
