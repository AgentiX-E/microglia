import { describe, expect, it } from 'vitest';
import { SERVE_PROFILE, serveOptions } from '@agentix-e/microglia-core';
import { armServeLine, armServeOf } from '../arm-serve.js';

/**
 * The arm as `profile + the fields the dispatch named`.
 *
 * The property under test is not "the function returns what it was given" — it is that a treatment arm
 * cannot silently be a different program from the one the product serves. Two refusals and one preserved
 * distinction carry it: a field named twice has no single value, a moved field with no reason has no
 * account, and a field named at the shipped value is kept as *named and unmoved* rather than dropped,
 * because "asked for the default" and "never mentioned it" are different dispatches.
 */
describe('an arm derived from the profile', () => {
  it('is the product when the dispatch named nothing', () => {
    const arm = armServeOf();
    expect(arm.options).toEqual(serveOptions());
    expect(arm.moved).toEqual([]);
    expect(arm.unmoved).toEqual([]);
    expect(armServeLine(arm)).toBe("arm = the product's profile");
  });

  it('moves one field and leaves the rest of the profile alone', () => {
    const arm = armServeOf([{ field: 'speakMargin', value: 0.2, reason: 'TAU_SPEAK_MARGIN (R123)' }]);
    expect(arm.options).toEqual({ ...serveOptions(), speakMargin: 0.2 });
    expect(arm.moved).toEqual([{ field: 'speakMargin', value: 0.2, reason: 'TAU_SPEAK_MARGIN (R123)' }]);
    expect(arm.unmoved).toEqual([]);
  });

  it('keeps a field named at the shipped value, as named and unmoved', () => {
    const arm = armServeOf([
      { field: 'note', value: null, reason: 'the dispatch asked for the renderer default' },
      { field: 'credit', value: SERVE_PROFILE.credit, reason: 'stated, not changed' },
    ]);
    expect(arm.moved).toEqual([]);
    expect(arm.unmoved).toEqual(['note', 'credit']);
    expect(arm.options).toEqual(serveOptions());
    expect(armServeLine(arm)).toContain('nothing moved');
    expect(armServeLine(arm)).toContain('note, credit');
  });

  it('prints the delta in profile order, whichever order the dispatch named the fields in', () => {
    const arm = armServeOf([
      { field: 'speakMargin', value: 0.05, reason: 'R123' },
      { field: 'budget', value: 1500, reason: 'TAU_PACK_BUDGET' },
    ]);
    expect(arm.moved.map((override) => override.field)).toEqual(['budget', 'speakMargin']);
    expect(armServeLine(arm)).toBe('arm = profile + budget 1500 (TAU_PACK_BUDGET) + speakMargin 0.05 (R123)');
  });

  it('renders a null override and a boolean override as what they are', () => {
    const arm = armServeOf([{ field: 'credit', value: false, reason: 'the credit arm' }], {
      ...SERVE_PROFILE,
      credit: true,
    });
    expect(arm.options.credit).toBe(false);
    expect(armServeLine(arm)).toBe('arm = profile + credit false (the credit arm)');
    const note = armServeOf([{ field: 'note', value: null, reason: 'x' }], {
      ...SERVE_PROFILE,
      note: 'hardened',
    });
    expect(armServeLine(note)).toBe('arm = profile + note null (default) (x)');
    // A named level is a string, and a line that quoted `[object Object]` for one would be a line nobody reads.
    const level = armServeOf([{ field: 'note', value: 'hardened', reason: 'R53' }]);
    expect(armServeLine(level)).toBe('arm = profile + note hardened (R53)');
  });

  it('compares against the profile it was given, not the shipped one', () => {
    const arm = armServeOf([{ field: 'budget', value: 1200, reason: 'the lane default' }], {
      ...SERVE_PROFILE,
      budget: 1200,
    });
    expect(arm.moved).toEqual([]);
    expect(arm.unmoved).toEqual(['budget']);
  });

  it('refuses one field named twice, because one arm has one value', () => {
    expect(() =>
      armServeOf([
        { field: 'speakMargin', value: 0.05, reason: 'R123' },
        { field: 'speakMargin', value: 0.2, reason: 'a second opinion' },
      ]),
    ).toThrow(/names 'speakMargin' twice/);
  });

  it('refuses a moved field that cannot say what moved it', () => {
    expect(() => armServeOf([{ field: 'note', value: 'none', reason: '' }])).toThrow(/without a reason/);
    expect(() => armServeOf([{ field: 'note', value: 'none', reason: '   ' }])).toThrow(/without a reason/);
  });
});
