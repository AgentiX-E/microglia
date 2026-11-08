import { describe, expect, it } from 'vitest';
import { INJECTION_NOTE_LEVELS, resolveInjectionNotePlan } from '../injection-note-plan.js';

/**
 * The switch R53 varies, and the one thing it must never be able to do.
 *
 * The arm's validity rests on three properties, and each is a test: an unset switch renders
 * the prompt every committed artefact was produced by, a declared level is exactly one of
 * three names, and the artefact can tell a declared `standard` from an unset one. The third
 * is the one that is easy to leave out and impossible to recover later — a readback that sees
 * `standard` and cannot tell whether the arm ran would report three arms from two.
 */
describe('the pack-note switch', () => {
  it('is the standard note when unset, which is every artefact before R53', () => {
    expect(resolveInjectionNotePlan({})).toEqual({ mode: 'standard', declared: false });
  });

  it('reads a blank value as unset, because a workflow variable renders as empty', () => {
    expect(resolveInjectionNotePlan({ TAU_INJECTION_NOTE: '   ' })).toEqual({
      mode: 'standard',
      declared: false,
    });
  });

  it('accepts each of the three levels by name, and marks it declared', () => {
    for (const mode of INJECTION_NOTE_LEVELS) {
      expect(resolveInjectionNotePlan({ TAU_INJECTION_NOTE: mode }), mode).toEqual({
        mode,
        declared: true,
      });
    }
  });

  it('marks an explicitly declared standard as declared, which is the whole point of the flag', () => {
    // `standard` is both the default and an arm. Without this flag the artefact cannot tell
    // "nobody set the switch" from "this run is the standard arm", and a three-level
    // comparison would be reading a default as one of its own levels.
    const implicit = resolveInjectionNotePlan({});
    const explicit = resolveInjectionNotePlan({ TAU_INJECTION_NOTE: 'standard' });
    expect(implicit.mode).toBe(explicit.mode);
    expect(implicit.declared).toBe(false);
    expect(explicit.declared).toBe(true);
  });

  it('trims rather than requiring a spotless environment', () => {
    expect(resolveInjectionNotePlan({ TAU_INJECTION_NOTE: ' hardened ' }).mode).toBe('hardened');
  });

  it('refuses a spelling it does not implement, before a single model call', () => {
    // The failure this prevents is a run that reports a level it did not render: `on`, `off`,
    // `true` and `calibrated` are all plausible typos for a word this module does not know,
    // and every one of them would otherwise become a silent third value.
    for (const bad of ['on', 'off', 'true', 'calibrated', 'Standard']) {
      expect(() => resolveInjectionNotePlan({ TAU_INJECTION_NOTE: bad }), bad).toThrow(
        'TAU_INJECTION_NOTE must be unset or one of',
      );
    }
  });
});
