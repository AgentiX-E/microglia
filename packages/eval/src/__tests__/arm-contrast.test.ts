import { describe, expect, it } from 'vitest';
import { parseContrastArgs } from '../arm-contrast.js';

describe('reading a contrast from a command line', () => {
  it('pairs left with right in order', () => {
    expect(parseContrastArgs(['--left', 'full-accepted', '--right', 'full-one'])).toEqual([
      { left: 'full-accepted', right: 'full-one' },
    ]);
  });

  it('reads several contrasts in one command', () => {
    // The case the first version of this parser could not express: it scanned the argument list once
    // per flag and refused the flag it was not looking for, so `--right` after `--left` threw and the
    // tool could only ever hold one arm name.
    expect(
      parseContrastArgs(['--left', 'a', '--right', 'b', '--left', 'c', '--right', 'd']),
    ).toEqual([
      { left: 'a', right: 'b' },
      { left: 'c', right: 'd' },
    ]);
  });

  it('accepts the flags in either order', () => {
    // A shell loop generates them in whatever order the loop is written; the pairing is positional,
    // not syntactic.
    expect(parseContrastArgs(['--right', 'b', '--left', 'a'])).toEqual([{ left: 'a', right: 'b' }]);
  });

  it('refuses a flag it does not read', () => {
    // A silently ignored argument is a contrast the run reported and the reader never saw.
    expect(() => parseContrastArgs(['--left', 'a', '--against', 'b'])).toThrow(/unknown flag/);
  });

  it('refuses a bare positional argument', () => {
    expect(() => parseContrastArgs(['full-one'])).toThrow(/unexpected argument/);
  });

  it('refuses a flag with no arm name', () => {
    expect(() => parseContrastArgs(['--left'])).toThrow(/needs an arm name/);
    expect(() => parseContrastArgs(['--left', '--right', 'b'])).toThrow(/needs an arm name/);
  });

  it('refuses a command with nothing to pair', () => {
    expect(() => parseContrastArgs([])).toThrow(/at least one --left/);
    expect(() => parseContrastArgs(['--right', 'b'])).toThrow(/at least one --left/);
  });

  it('refuses unequal sides rather than dropping the extra', () => {
    // Two lefts and one right is a typo, and pairing the second left with nothing would silently
    // measure one contrast where two were asked for.
    expect(() => parseContrastArgs(['--left', 'a', '--left', 'b', '--right', 'c'])).toThrow(
      /they pair in order/,
    );
  });
});
