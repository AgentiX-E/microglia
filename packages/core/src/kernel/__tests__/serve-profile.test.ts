/**
 * The shipping contract, pinned.
 *
 * These cases exist for one failure: the product and the eval drifting apart without anyone editing a line
 * that looks like a configuration. So the assertions are deliberately boring — every key accounted for, the
 * shipped values pinned, `null` distinguishable from the default it means — because a test that checks the
 * arithmetic of a table of five constants is a test that fails the day someone changes one of them in
 * passing.
 */
import { describe, expect, it } from 'vitest';

import {
  SERVE_PROFILE,
  SERVE_PROFILE_FIELDS,
  describeServeProfile,
  diffServeProfile,
  sameServeProfile,
  serveOptions,
  type ServeProfile,
} from '../serve-profile.js';

const ALL_ON: ServeProfile = {
  budget: 1200,
  note: 'standard',
  budgetBasis: 'note-included',
  speakMargin: 0.2,
  credit: false,
};

describe('SERVE_PROFILE', () => {
  it('carries exactly the fields the audit walks, in the order it prints them', () => {
    expect([...SERVE_PROFILE_FIELDS]).toEqual(Object.keys(SERVE_PROFILE));
  });

  it('is frozen, so no import site can become a configuration site', () => {
    expect(Object.isFrozen(SERVE_PROFILE)).toBe(true);
  });

  it('ships the defaults this round measured, and changing one is a record change', () => {
    // Four absences and one stated decision: `credit` is the only knob whose library default is not an
    // absence. If this expectation moves, `eval/results/serve-profile.json` has to move with it.
    expect(SERVE_PROFILE).toEqual({
      budget: null,
      note: null,
      budgetBasis: null,
      speakMargin: null,
      credit: true,
    });
  });
});

describe('serveOptions', () => {
  it('omits an absent knob instead of filling in its default', () => {
    expect(serveOptions()).toEqual({ credit: true });
  });

  it('keeps a zero margin, which is a different program from an absent one', () => {
    // `recall` attaches `pack.decision` when a margin is declared, so `0` and `undefined` differ in the
    // bytes a host receives. A helper that treated 0 as "nothing to say" would erase that difference.
    expect(serveOptions({ ...SERVE_PROFILE, speakMargin: 0 })).toEqual({ speakMargin: 0, credit: true });
    expect(serveOptions()).not.toHaveProperty('speakMargin');
  });

  it('passes every stated field through unchanged', () => {
    expect(serveOptions(ALL_ON)).toEqual(ALL_ON);
  });

  it('carries a note level the renderer knows, not a string of its own', () => {
    expect(serveOptions({ ...SERVE_PROFILE, note: 'hardened' }).note).toBe('hardened');
  });
});

describe('diffServeProfile', () => {
  it('says nothing when the record and the product agree', () => {
    expect(sameServeProfile(diffServeProfile({ ...SERVE_PROFILE }))).toBe(true);
  });

  it('names a field the record carries and the product does not', () => {
    const diff = diffServeProfile({ ...SERVE_PROFILE, retries: 3 });
    expect(diff.unknown).toEqual(['retries']);
    expect(sameServeProfile(diff)).toBe(false);
  });

  it('names a field the product ships and the record does not mention', () => {
    const { credit: _credit, ...withoutCredit } = SERVE_PROFILE;
    const diff = diffServeProfile(withoutCredit);
    expect(diff.missing).toEqual(['credit']);
  });

  it('names a field both carry with different values, keeping the reading rather than the winner', () => {
    const diff = diffServeProfile({ ...SERVE_PROFILE, budget: 800 });
    expect(diff.differing).toEqual([{ field: 'budget', shipped: null, recorded: 800 }]);
  });

  it('treats a loosely parsed number as a divergence', () => {
    // JSON that arrived as a string is a record whose parser was lenient; the product would not be.
    expect(diffServeProfile({ ...SERVE_PROFILE, budget: '1200' }).differing).toEqual([
      { field: 'budget', shipped: null, recorded: '1200' },
    ]);
  });

  it('treats an explicitly undefined field as present and wrong, not as absent', () => {
    const diff = diffServeProfile({ budget: null, note: undefined, budgetBasis: null, speakMargin: null, credit: true });
    expect(diff.missing).toEqual([]);
    expect(diff.differing).toEqual([{ field: 'note', shipped: null, recorded: undefined }]);
  });

  it('compares against a profile other than the shipped one, which is how a candidate is priced', () => {
    expect(sameServeProfile(diffServeProfile({ ...ALL_ON }, ALL_ON))).toBe(true);
    expect(diffServeProfile({ ...ALL_ON }, SERVE_PROFILE).differing).toHaveLength(5);
  });
});

describe('describeServeProfile', () => {
  it('renders an absence as the default it means rather than as null', () => {
    const lines = describeServeProfile();
    expect(lines).toHaveLength(5);
    expect(lines[0]).toBe('budget        null (policy.defaultBudget)');
    expect(lines[1]).toBe('note          null (library default)');
    expect(lines[4]).toBe('credit        true');
  });

  it('renders a stated value as the value', () => {
    expect(describeServeProfile(ALL_ON)).toEqual([
      'budget        1200',
      'note          standard',
      'budgetBasis   note-included',
      'speakMargin   0.2',
      'credit        false',
    ]);
  });
});
