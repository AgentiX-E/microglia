import { describe, expect, it } from 'vitest';
import {
  NOTE_LEVELS,
  PRIMARY_NOTE,
  noteFacadeReading,
  noteFacadeState,
  noteFacadeSummary,
  notedFacadeArtifact,
  packIdentity,
  readNotedFacadeArtifact,
  resolveFacadeNotePlan,
  type NoteArmReading,
} from '../note-facade.js';
import type { ArmTask } from '../l4.js';
import type { RunScope } from '../within-run-pair.js';
import type { InactionCensus } from '../inaction.js';

/**
 * R53's three-level note arm.
 *
 * These are the contract tests for the capability the registration was blocked on: the note
 * has to be a rendering option of one recall and the three levels have to run over ONE
 * store, because three dispatches of one configuration distil different stores and their
 * delivery censuses cannot be equal to the digit. What the module must refuse is as
 * important as what it must compute — a dispatch that varies two things, an unknown switch,
 * and a run whose arms served different items are all readings this lane has already paid
 * for once.
 */

const scope: RunScope = {
  dispatchId: '42463064049',
  preregId: 'R53-use-time-calibration',
  storeFingerprint: 'store:deadbeef',
  learnSplit: ['retail/1', 'retail/2'],
  testSplit: ['retail/3', 'retail/4'],
  seed: 300,
  trials: 4,
  model: 'deepseek-chat',
};

const quiet: InactionCensus = {
  episodes: 8,
  acted: 8,
  abstained: 0,
  perTask: [{ taskId: 'retail/3', episodes: 4, acted: 4 }],
};

function tasks(prefix: string, passed: readonly boolean[]): readonly ArmTask[] {
  return passed.map((passedAll, index) => ({ id: `${prefix}/${String(index)}`, passedAll }));
}

function arm(
  note: NoteArmReading['note'],
  overrides: Partial<NoteArmReading> = {},
): NoteArmReading {
  return {
    note,
    servedPacks: 12,
    recallRequests: 16,
    unscored: 0,
    tasks: tasks('retail', [true, false, true, false]),
    inaction: quiet,
    observations: [
      { query: 'cancel my order', statements: ['a', 'b'] },
      { query: 'where is my parcel', statements: ['c'] },
    ],
    ...overrides,
  };
}

describe('the three-level note dispatch is registered, never toggled', () => {
  it('is off when nothing declares it', () => {
    const plan = resolveFacadeNotePlan({}, { enabled: false });
    expect(plan.enabled).toBe(false);
  });

  it('declares the arm off explicitly, and stays on the single-note path', () => {
    // `off` is a declaration, not an absence: a registration that says so is readable as one
    // that considered the arm, which a missing key is not.
    const plan = resolveFacadeNotePlan({ TAU_FACADE_NOTES: 'off' }, { enabled: false });
    expect(plan.enabled).toBe(false);
  });

  it('refuses a value that is neither on nor off', () => {
    // A misspelling must not be read as "off": a silently disabled experiment is
    // indistinguishable from a completed one in a CI log.
    expect(() => resolveFacadeNotePlan({ TAU_FACADE_NOTES: '3' }, { enabled: false })).toThrow(
      /TAU_FACADE_NOTES/,
    );
  });

  it('refuses to vary the note and the floor in one dispatch', () => {
    // R49's pair varies minCoverage; this varies the sentence. Both at once makes every
    // delta a difference of two treatments and the primary arm ambiguous.
    expect(() => resolveFacadeNotePlan({ TAU_FACADE_NOTES: 'three-level' }, { enabled: true })).toThrow(
      /one dispatch measures one variable/,
    );
  });

  it('resolves the three registered levels with standard as the primary arm', () => {
    const plan = resolveFacadeNotePlan({ TAU_FACADE_NOTES: 'three-level' }, { enabled: false });
    expect(plan.enabled).toBe(true);
    if (!plan.enabled) return;
    expect(plan.arms).toEqual(['none', 'standard', 'hardened']);
    expect(plan.primary).toBe('standard');
    // The basis is part of the plan rather than a driver detail: without it the longer
    // sentence buys its room by dropping the last rule, and the arms differ in their packs.
    expect(plan.budgetBasis).toBe('note-excluded');
  });

  it('registers the level every artefact ran as the one the lane grades', () => {
    expect(PRIMARY_NOTE).toBe('standard');
    expect(NOTE_LEVELS).toContain(PRIMARY_NOTE);
  });
});

describe('the pack-identity control', () => {
  it('reports the shared requests and no mismatch when the arms served one pack', () => {
    const identity = packIdentity([arm('none'), arm('standard'), arm('hardened')]);
    expect(identity).toEqual({ compared: 2, mismatched: 0, examples: [] });
  });

  it('counts a request whose items differ between arms', () => {
    // The failure this exists for: an arm that quietly applied a different floor, or a
    // recall whose note leaked into selection. The comparison is abandoned, not reinterpreted.
    const identity = packIdentity([
      arm('none'),
      arm('standard'),
      arm('hardened', {
        observations: [
          { query: 'cancel my order', statements: ['a'] },
          { query: 'where is my parcel', statements: ['c'] },
        ],
      }),
    ]);
    expect(identity.mismatched).toBe(1);
    expect(identity.examples).toEqual(['cancel my order']);
  });

  it('counts one arm answering one request two ways as a mismatch', () => {
    // The same request against one store cannot produce two packs, so two signatures are a
    // broken instrument rather than a level effect.
    const identity = packIdentity([
      arm('none'),
      arm('standard', {
        observations: [
          { query: 'cancel my order', statements: ['a', 'b'] },
          { query: 'cancel my order', statements: ['a'] },
        ],
      }),
    ]);
    expect(identity.mismatched).toBe(1);
  });

  it('ignores requests only one arm asked', () => {
    // The agent chooses its own requests, and a licence to disregard a rule can change which
    // ones it chooses. That side cannot be held; what can be held is the pack for a request
    // both arms made.
    const identity = packIdentity([
      arm('none'),
      arm('hardened', {
        observations: [
          { query: 'cancel my order', statements: ['a', 'b'] },
          { query: 'where is my parcel', statements: ['c'] },
          { query: 'a request only this arm made', statements: ['d'] },
        ],
      }),
    ]);
    expect(identity).toEqual({ compared: 2, mismatched: 0, examples: [] });
  });
});

describe('the reading carries one store and three arms', () => {
  const reading = noteFacadeReading({
    dispatchId: '42463064049',
    preregId: 'R53-use-time-calibration',
    scope,
    arms: [arm('none'), arm('standard'), arm('hardened')],
    seed: 300,
    model: 'deepseek-chat',
  });

  it('contrasts every other level against the standard arm, never against each other', () => {
    expect(reading.contrasts.map((contrast) => `${contrast.arm} vs ${contrast.baseline}`)).toEqual([
      'none vs standard',
      'hardened vs standard',
    ]);
    for (const contrast of reading.contrasts) {
      expect(contrast.kind).toBe('note-contrast');
      expect(contrast.comparison.paired).toBe(4);
    }
  });

  it('reports the delivery census R53 wants held constant, per arm', () => {
    expect(reading.arms.map((entry) => entry.note)).toEqual(['none', 'standard', 'hardened']);
    for (const entry of reading.arms) {
      // Two statements on one request and one on the other, over two requests.
      expect(entry.itemsPerRequest).toBe(1.5);
      expect(entry.servedPacks).toBe(12);
      expect(entry.pass4).toBe(0.5);
      // The parse rate is (scored - unscored) / scored per arm: a level that costs the model
      // its tool-call format has to be visible as that, not as a lower score.
      expect(entry.scoredTasks).toBe(4);
      expect(entry.unscoredTasks).toBe(0);
    }
  });

  it('reports no contrast for an arm that scored nothing, instead of a delta against zero', () => {
    const empty = noteFacadeReading({
      dispatchId: 'x',
      preregId: 'y',
      scope,
      arms: [arm('none', { tasks: [] }), arm('standard'), arm('hardened')],
      seed: 300,
      model: 'deepseek-chat',
    });
    expect(empty.contrasts.map((contrast) => contrast.arm)).toEqual(['hardened']);
  });

  it('is MEASURED only when the arms served items and served the same ones', () => {
    expect(noteFacadeState(reading)).toBe('MEASURED');
    const broken = noteFacadeReading({
      dispatchId: 'x',
      preregId: 'y',
      scope,
      arms: [
        arm('none', { observations: [{ query: 'cancel my order', statements: ['z'] }] }),
        arm('standard'),
        arm('hardened'),
      ],
      seed: 300,
      model: 'deepseek-chat',
    });
    // Not a failed hypothesis: a run whose arms differed in something the registration did
    // not name, so no delta from it is interpretable.
    expect(noteFacadeState(broken)).toBe('IDENTITY_BROKEN');
  });

  it('is NO_DELIVERY when no arm ever served a pack', () => {
    const undelivered = noteFacadeReading({
      dispatchId: 'x',
      preregId: 'y',
      scope,
      arms: [
        arm('none', { servedPacks: 0 }),
        arm('standard', { servedPacks: 0 }),
        arm('hardened', { servedPacks: 0 }),
      ],
      seed: 300,
      model: 'deepseek-chat',
    });
    expect(noteFacadeState(undelivered)).toBe('NO_DELIVERY');
  });
});

describe('the summary and the artefact', () => {
  const reading = noteFacadeReading({
    dispatchId: '42463064049',
    preregId: 'R53-use-time-calibration',
    scope,
    arms: [arm('none'), arm('standard'), arm('hardened')],
    seed: 300,
    model: 'deepseek-chat',
  });

  it('prints one line a job summary can carry without the nested document', () => {
    const line = noteFacadeSummary(reading);
    expect(line).toContain('MEASURED:');
    expect(line).toContain('items/req 1.500');
    expect(line).toContain('packs identical on 2 shared request(s), 0 mismatch');
  });

  it('states the control and the basis inside the artefact, not only in a document', () => {
    const artefact = notedFacadeArtifact(reading, '2026-11-08T00:00:00.000Z');
    expect(artefact.id).toBe('poc-l4-facade-notes');
    expect(artefact.state).toBe('MEASURED');
    expect(artefact.budgetBasis).toBe('note-excluded');
    expect(artefact.notes.join(' ')).toContain('note-excluded');
    expect(artefact.notes.join(' ')).toContain('control, not a result');
  });
});

describe('the two note declarations cannot disagree', () => {
  it('refuses a single declared level beside a three-level arm', () => {
    // `TAU_INJECTION_NOTE` says "this dispatch is one level"; `TAU_FACADE_NOTES` says "this
    // dispatch is three". Both are recorded in artefacts, so a run that honoured one would
    // publish a record that contradicts its own treatment.
    expect(() =>
      resolveFacadeNotePlan(
        { TAU_FACADE_NOTES: 'three-level', TAU_INJECTION_NOTE: 'hardened' },
        { enabled: false },
      ),
    ).toThrow(/disagree about how many arms/);
  });
});

describe('the artefact is read back into three states, and refuses what it cannot attest', () => {
  const reading = noteFacadeReading({
    dispatchId: '42463064049',
    preregId: 'R53-use-time-calibration',
    scope,
    arms: [arm('none'), arm('standard'), arm('hardened')],
    seed: 300,
    model: 'deepseek-chat',
  });
  const artefact = notedFacadeArtifact(reading, '2026-11-08T00:00:00.000Z') as unknown as Record<
    string,
    unknown
  >;

  it('reads a MEASURED artefact into its arms and contrasts', () => {
    const back = readNotedFacadeArtifact(artefact);
    expect(back.state).toBe('MEASURED');
    expect(back.levels).toEqual(['none', 'standard', 'hardened']);
    expect(back.arms.map((entry) => entry.note)).toEqual(['none', 'standard', 'hardened']);
    expect(back.contrasts.map((contrast) => contrast.arm)).toEqual(['none', 'hardened']);
    expect(back.identity).toEqual({ compared: 2, mismatched: 0 });
  });

  it('refuses a missing or unknown state rather than inferring one', () => {
    // The state is what the run decided about itself; recomputing it here would let a
    // reader's arithmetic disagree with the artefact it is reading.
    expect(() => readNotedFacadeArtifact({ ...artefact, state: undefined })).toThrow(/no recognised state/);
    expect(() => readNotedFacadeArtifact({ ...artefact, state: 'PAIRED' })).toThrow(/no recognised state/);
  });

  it('reports no contrast in the two states that measured nothing', () => {
    const broken = readNotedFacadeArtifact({ ...artefact, state: 'IDENTITY_BROKEN' });
    expect(broken.contrasts).toEqual([]);
    expect(broken.arms).toHaveLength(3);
    const undelivered = readNotedFacadeArtifact({ ...artefact, state: 'NO_DELIVERY' });
    expect(undelivered.contrasts).toEqual([]);
  });

  it('requires a MEASURED artefact to carry the numbers it claims', () => {
    expect(() => readNotedFacadeArtifact({ ...artefact, contrasts: [] })).toThrow(/at least one contrast/);
    expect(() =>
      readNotedFacadeArtifact({
        ...artefact,
        contrasts: [{ kind: 'note-contrast', arm: 'hardened', comparison: { deltaPp: 1 } }],
      }),
    ).toThrow(/interval low/);
  });
});

describe('the reading refuses to invent an arm or a contrast', () => {
  const base = {
    dispatchId: '42463064049',
    preregId: 'R53-use-time-calibration',
    scope,
    seed: 300,
    model: 'deepseek-chat',
  };

  it('reports zero items per request for an arm no request reached', () => {
    // A facade that served nothing has no population to average; `0` is the honest value and
    // the served-pack count beside it is what says the arm was never exercised.
    const reading = noteFacadeReading({
      ...base,
      arms: [arm('standard', { observations: [], servedPacks: 0, recallRequests: 0 })],
    });
    expect(reading.arms[0]?.itemsPerRequest).toBe(0);
  });

  it('computes no contrast when the primary arm is absent', () => {
    // Nothing in the artefact can say what "above standard" means if standard did not run.
    const reading = noteFacadeReading({ ...base, arms: [arm('none'), arm('hardened')] });
    expect(reading.contrasts).toEqual([]);
    expect(noteFacadeSummary(reading)).not.toContain(' vs standard');
  });

  it('computes no contrast between two arms that scored no common task', () => {
    const reading = noteFacadeReading({
      ...base,
      arms: [
        arm('standard', { tasks: tasks('a', [true, false]) }),
        arm('hardened', { tasks: tasks('b', [true, false]) }),
      ],
    });
    expect(reading.contrasts).toEqual([]);
  });
});

describe('the readback refuses every shape it cannot attest', () => {
  const artefact = notedFacadeArtifact(
    noteFacadeReading({
      dispatchId: 'd',
      preregId: 'p',
      scope,
      arms: [arm('none'), arm('standard'), arm('hardened')],
      seed: 300,
      model: 'm',
    }),
    '2026-11-08T00:00:00.000Z',
  ) as unknown as Record<string, unknown>;

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const cases: readonly (readonly [string, Record<string, unknown>, RegExp])[] = [
    ['no summary', { ...artefact, summary: undefined }, /no summary/],
    ['no control', { ...artefact, packIdentity: undefined }, /pack-identity control/],
    ['arms not a list', { ...artefact, arms: {} }, /no arms/],
    ['an arm that is not an object', { ...artefact, arms: [null] }, /arm is not an object/],
    ['an arm with no level', { ...artefact, arms: [{ servedPacks: 0 }] }, /names no note level/],
    [
      'a non-numeric count',
      { ...artefact, arms: [{ note: 'none', servedPacks: 'x', itemsPerRequest: 0, pass4: 0 }] },
      /served pack count/,
    ],
    ['contrasts not a list', { ...artefact, contrasts: 'none' }, /at least one contrast/],
    ['a contrast that is not an object', { ...artefact, contrasts: [3] }, /contrast is not an object/],
    [
      'a contrast with no arm',
      { ...artefact, contrasts: [{ comparison: {} }] },
      /contrast names no arm/,
    ],
    [
      'a contrast with no comparison',
      { ...artefact, contrasts: [{ arm: 'hardened' }] },
      /carries no comparison/,
    ],
    [
      'a comparison with no p-value',
      { ...artefact, contrasts: [{ arm: 'hardened', comparison: { deltaPp: 1, ciLowPp: 0, ciHighPp: 2, paired: 3 } }] },
      /p-value/,
    ],
  ];

  for (const [name, value, pattern] of cases) {
    it(`refuses ${name}`, () => {
      expect(() => readNotedFacadeArtifact(value)).toThrow(pattern);
    });
  }

  it('refuses a non-object value outright', () => {
    expect(() => readNotedFacadeArtifact(null)).toThrow(/not an object/);
    expect(() => readNotedFacadeArtifact('artefact')).toThrow(/not an object/);
  });

  it('falls back to the arms when the artefact predates the levels list', () => {
    // Tolerance for one field only: the levels are recoverable from the arms, so an older
    // artefact is readable rather than refused. Everything else is strict.
    const back = readNotedFacadeArtifact({ ...artefact, levels: undefined });
    expect(back.levels).toEqual(['none', 'standard', 'hardened']);
  });
  /* eslint-enable @typescript-eslint/no-explicit-any */
});
