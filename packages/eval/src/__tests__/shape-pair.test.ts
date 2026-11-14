import { describe, expect, it } from 'vitest';
import {
  PRIMARY_SHAPE,
  SHAPE_ARMS_ENV,
  SHAPE_UNITS,
  readShapeArmArtifact,
  resolveShapeArmPlan,
  shapeObservationOf,
  shapeArmArtifact,
  shapeArmReading,
  shapeArmState,
  shapeArmSummary,
  shapeContainment,
  type ShapeArmReading,
  type ShapeObservation,
} from '../shape-pair.js';
import type { ArmTask } from '../l4.js';
import type { RunScope } from '../within-run-pair.js';
import type { InactionCensus } from '../inaction.js';

/**
 * R109a's two-unit arm.
 *
 * The contract these tests hold is the one the fold cannot hold for itself: R109 shipped a *switch*
 * (`TAU_PACK_SHAPE`), and a switch renders one dispatch's packs in one unit. A comparison needs both
 * units over one store, because a dispatch's corrections are made by the model at run time and two
 * dispatches distil two stores. What the module must refuse matters as much as what it computes — two
 * treatments in one dispatch, an unknown switch, a declared single unit beside the pair, and a
 * treatment pack that is not the control's under the fold are all readings this lane has already paid
 * for once.
 */

const scope: RunScope = {
  dispatchId: '44000000000',
  preregId: 'R109a-the-unit-pair',
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

function pack(
  query: string,
  ids: readonly string[],
  overrides: Partial<ShapeObservation> = {},
): ShapeObservation {
  return { query, ids, chars: ids.length * 100, folded: 0, truncated: 0, ...overrides };
}

function arm(
  shape: ShapeArmReading['shape'],
  overrides: Partial<ShapeArmReading> = {},
): ShapeArmReading {
  return {
    shape,
    servedPacks: 4,
    recallRequests: 6,
    unscored: 0,
    tasks: tasks('retail', [true, false, true, true]),
    inaction: quiet,
    observations: [pack('q1', ['a', 'b']), pack('q2', ['c'])],
    ...overrides,
  };
}

describe('resolveShapeArmPlan', () => {
  const noPair = { pair: { enabled: false }, notes: { enabled: false } };

  it('leaves a dispatch that never heard of the arm on the single-facade path', () => {
    expect(resolveShapeArmPlan({}, noPair)).toEqual({
      enabled: false,
      reason: 'no two-unit dispatch was registered',
    });
  });

  it('treats an explicit off as off, because a registration may say so', () => {
    expect(resolveShapeArmPlan({ [SHAPE_ARMS_ENV]: 'off' }, noPair).enabled).toBe(false);
    expect(resolveShapeArmPlan({ [SHAPE_ARMS_ENV]: '' }, noPair).enabled).toBe(false);
  });

  it('runs both units, control first, when the registration names the arm', () => {
    const plan = resolveShapeArmPlan({ [SHAPE_ARMS_ENV]: 'two-unit' }, noPair);
    expect(plan).toEqual({
      enabled: true,
      arms: ['per-failure', 'collapse'],
      primary: 'per-failure',
    });
    // The grid is two values and the primary is the one every committed artefact ran.
    expect([...SHAPE_UNITS]).toEqual(['per-failure', 'collapse']);
    expect(PRIMARY_SHAPE).toBe('per-failure');
  });

  it('refuses a switch value it cannot honour', () => {
    expect(() => resolveShapeArmPlan({ [SHAPE_ARMS_ENV]: 'collapse' }, noPair)).toThrow(
      /must be a declared shape switch, received 'collapse'/,
    );
  });

  it('refuses one unit declared beside the pair, which would be two declarations of one variable', () => {
    expect(() =>
      resolveShapeArmPlan({ [SHAPE_ARMS_ENV]: 'true', TAU_PACK_SHAPE: 'collapse' }, noPair),
    ).toThrow(/TAU_PACK_SHAPE names 'collapse'/);
  });

  it('refuses a dispatch that would vary a second treatment at the same time', () => {
    expect(() =>
      resolveShapeArmPlan(
        { [SHAPE_ARMS_ENV]: 'true' },
        { pair: { enabled: true }, notes: { enabled: false } },
      ),
    ).toThrow(/paired recall facade both vary a treatment/);
    expect(() =>
      resolveShapeArmPlan(
        { [SHAPE_ARMS_ENV]: 'true' },
        { pair: { enabled: false }, notes: { enabled: true } },
      ),
    ).toThrow(/three-level note facade both vary a treatment/);
  });
});

describe('shapeObservationOf', () => {
  it('reads a served pack in the terms the control compares', () => {
    expect(
      shapeObservationOf('q1', {
        ids: ['a', 'b'],
        rendered: 'x'.repeat(120),
        truncated: 0,
        fold: { folded: 1, groups: [], refused: 0, support: { max: 2, atLeastTwo: 1, atLeastThree: 0 }, items: [] },
      }),
    ).toEqual({ query: 'q1', ids: ['a', 'b'], chars: 120, folded: 1, truncated: 0 });
  });

  it('reads a pack from a host with no vocabulary as unfolded, which is not a fold that did nothing', () => {
    // The field is absent rather than zero on such a host; the observation says zero because a control
    // that never folds and a host that cannot name a shape are the same number of folded items.
    expect(shapeObservationOf('q1', { ids: ['a'], rendered: 'x', truncated: 0 }).folded).toBe(0);
  });
});

describe('shapeContainment', () => {
  it('holds when the treatment pack is the control pack minus exactly what the fold removed', () => {
    const control = arm('per-failure', {
      observations: [pack('q1', ['a', 'b', 'c']), pack('q2', ['d'])],
    });
    const treatment = arm('collapse', {
      observations: [pack('q1', ['a', 'c'], { folded: 1 }), pack('q2', ['d'])],
    });
    expect(shapeContainment([control, treatment])).toEqual({
      compared: 2,
      mismatched: 0,
      excluded: 0,
      examples: [],
    });
  });

  it('breaks on an item the control never served, which is the fold inventing one', () => {
    const control = arm('per-failure', { observations: [pack('q1', ['a', 'b'])] });
    const treatment = arm('collapse', { observations: [pack('q1', ['a', 'z'], { folded: 0 })] });
    const control2 = shapeContainment([control, treatment]);
    expect(control2.compared).toBe(1);
    expect(control2.mismatched).toBe(1);
    expect(control2.examples).toEqual(['q1']);
  });

  it('breaks when the size difference is not the count the fold reported', () => {
    // The fold removed nothing according to itself, and the treatment is a pack shorter anyway.
    const control = arm('per-failure', { observations: [pack('q1', ['a', 'b', 'c'])] });
    const treatment = arm('collapse', { observations: [pack('q1', ['a', 'b'])] });
    expect(shapeContainment([control, treatment]).mismatched).toBe(1);
  });

  it('breaks when the control arm reports a fold, which means the switch reached one facade and not the other', () => {
    const control = arm('per-failure', { observations: [pack('q1', ['a'], { folded: 1 })] });
    const treatment = arm('collapse', { observations: [pack('q1', ['a'], { folded: 1 })] });
    expect(shapeContainment([control, treatment]).mismatched).toBe(1);
  });

  it('excludes a request either arm had cut, and counts it rather than skipping it silently', () => {
    const control = arm('per-failure', {
      observations: [pack('q1', ['a', 'b'], { truncated: 1 }), pack('q2', ['c'])],
    });
    const treatment = arm('collapse', {
      observations: [pack('q1', ['a'], { folded: 1, truncated: 1 }), pack('q2', ['c'])],
    });
    const containment = shapeContainment([control, treatment]);
    // The cut request is not compared — a shorter unit can leave room for an item the control dropped,
    // so containment is not true by construction there — and it is not silently dropped either.
    expect(containment).toEqual({ compared: 1, mismatched: 0, excluded: 1, examples: [] });
  });

  it('compares only the requests both arms answered', () => {
    const control = arm('per-failure', {
      observations: [pack('q1', ['a']), pack('q2', ['b'])],
    });
    const treatment = arm('collapse', { observations: [pack('q1', ['a'])] });
    expect(shapeContainment([control, treatment]).compared).toBe(1);
  });

  it('reads one request once when an arm answered it twice', () => {
    // The driver asks a handful of questions repeatedly. Copies of one request would inflate the
    // population the control claims to have verified.
    const control = arm('per-failure', {
      observations: [pack('q1', ['a']), pack('q1', ['a'])],
    });
    const treatment = arm('collapse', { observations: [pack('q1', ['a'])] });
    expect(shapeContainment([control, treatment]).compared).toBe(1);
  });

  it('reports nothing when an arm did not run, rather than reporting a clean comparison', () => {
    expect(shapeContainment([arm('per-failure')])).toEqual({
      compared: 0,
      mismatched: 0,
      excluded: 0,
      examples: [],
    });
  });
});

describe('shapeArmReading', () => {
  it('reads the delivery census of each unit and the fold it performed', () => {
    const reading = shapeArmReading({
      dispatchId: scope.dispatchId,
      preregId: scope.preregId,
      scope,
      arms: [
        arm('per-failure', {
          observations: [pack('q1', ['a', 'b'], { chars: 400 }), pack('q2', ['c'], { chars: 200 })],
        }),
        arm('collapse', {
          observations: [
            pack('q1', ['a'], { chars: 200, folded: 1 }),
            pack('q2', ['c'], { chars: 200 }),
          ],
        }),
      ],
      seed: 300,
      model: 'deepseek-chat',
    });
    const control = reading.arms[0];
    const treatment = reading.arms[1];
    expect(control).toMatchObject({ itemsPerRequest: 1.5, charsPerRequest: 300, folded: 0 });
    expect(treatment).toMatchObject({ itemsPerRequest: 1, charsPerRequest: 200, folded: 1 });
    expect(reading.units).toEqual(['per-failure', 'collapse']);
  });

  it('contrasts the treatment against the control on the tasks both scored', () => {
    const reading = shapeArmReading({
      dispatchId: scope.dispatchId,
      preregId: scope.preregId,
      scope,
      arms: [
        arm('per-failure'),
        arm('collapse', {
          tasks: tasks('retail', [true, true, true, false]),
          observations: [pack('q1', ['a'], { folded: 1 }), pack('q2', ['c'])],
        }),
      ],
      seed: 300,
      model: 'deepseek-chat',
    });
    expect(reading.contrasts).toHaveLength(1);
    const contrast = reading.contrasts[0];
    expect(contrast?.kind).toBe('shape-contrast');
    expect(contrast?.baseline).toBe('per-failure');
    expect(contrast?.arm).toBe('collapse');
    expect(contrast?.comparison.paired).toBe(4);
  });

  it('reports no contrast for an arm that scored nothing or shares no task', () => {
    // The treatment's folded observation is what makes the state MEASURED: without it these readings are
    // suppressed earlier, for the NO_TREATMENT reason, and the two refusals here would never be reached.
    const folded = [pack('q1', ['a'], { folded: 1 }), pack('q2', ['c'])];
    const empty = shapeArmReading({
      dispatchId: scope.dispatchId,
      preregId: scope.preregId,
      scope,
      arms: [
        arm('per-failure'),
        arm('collapse', { tasks: [], observations: folded }),
      ],
      seed: 300,
      model: 'deepseek-chat',
    });
    expect(empty.contrasts).toEqual([]);
    // Now the other side of the same guard: the control scored nothing, so there is no denominator.
    const noControl = shapeArmReading({
      dispatchId: scope.dispatchId,
      preregId: scope.preregId,
      scope,
      arms: [arm('per-failure', { tasks: [] }), arm('collapse', { observations: folded })],
      seed: 300,
      model: 'deepseek-chat',
    });
    expect(noControl.contrasts).toEqual([]);
    const disjoint = shapeArmReading({
      dispatchId: scope.dispatchId,
      preregId: scope.preregId,
      scope,
      arms: [
        arm('per-failure'),
        arm('collapse', {
          tasks: tasks('airline', [true, true, true, true]),
          observations: folded,
        }),
      ],
      seed: 300,
      model: 'deepseek-chat',
    });
    expect(disjoint.contrasts).toEqual([]);
  });

  it('reports no contrast when the control arm did not run, rather than contrasting the treatment with itself', () => {
    const reading = shapeArmReading({
      dispatchId: scope.dispatchId,
      preregId: scope.preregId,
      scope,
      arms: [arm('collapse', { observations: [pack('q1', ['a'], { folded: 1 })] })],
      seed: 300,
      model: 'deepseek-chat',
    });
    expect(reading.units).toEqual(['collapse']);
    expect(reading.contrasts).toEqual([]);
    expect(reading.containment.compared).toBe(0);
  });

  it('carries the containment control on the reading, so no reader can compute it separately', () => {
    const reading = shapeArmReading({
      dispatchId: scope.dispatchId,
      preregId: scope.preregId,
      scope,
      arms: [arm('per-failure'), arm('collapse', { observations: [pack('q1', ['a'], { folded: 1 }), pack('q2', ['c'])] })],
      seed: 300,
      model: 'deepseek-chat',
    });
    expect(reading.containment).toEqual({ compared: 2, mismatched: 0, excluded: 0, examples: [] });
  });
});

describe('shapeArmState', () => {
  const reading = (arms: readonly ShapeArmReading[], extra = {}) =>
    shapeArmReading({
      dispatchId: scope.dispatchId,
      preregId: scope.preregId,
      scope,
      arms,
      seed: 300,
      model: 'deepseek-chat',
      ...extra,
    });

  it('is MEASURED when the treatment folded something and both arms served packs', () => {
    expect(
      shapeArmState(
        reading([
          arm('per-failure'),
          arm('collapse', { observations: [pack('q1', ['a'], { folded: 1 }), pack('q2', ['c'])] }),
        ]),
      ),
    ).toBe('MEASURED');
  });

  it('is CONTAINMENT_BROKEN when a treatment pack is not the control under the fold', () => {
    expect(
      shapeArmState(
        reading([
          arm('per-failure', { observations: [pack('q1', ['a', 'b'])] }),
          arm('collapse', { observations: [pack('q1', ['z'], { folded: 0 })] }),
        ]),
      ),
    ).toBe('CONTAINMENT_BROKEN');
  });

  it('is NO_DELIVERY when no pack reached the model, which makes the score the agent\'s', () => {
    expect(
      shapeArmState(
        reading([
          arm('per-failure', { servedPacks: 0, observations: [] }),
          arm('collapse', { servedPacks: 0, observations: [] }),
        ]),
      ),
    ).toBe('NO_DELIVERY');
  });

  it('is NO_TREATMENT when both arms served packs and the fold removed nothing', () => {
    // The distinction this state exists for: a registered mechanism that never fired is a finding about
    // the store, not evidence that the unit does not matter, and a run reporting `MEASURED` here would
    // have published a null result about a treatment it never applied.
    expect(shapeArmState(reading([arm('per-failure'), arm('collapse')]))).toBe('NO_TREATMENT');
  });
});

describe('shapeArmSummary', () => {
  it('prints both units\' delivery, both units\' cost, and the control\'s population', () => {
    const reading = shapeArmReading({
      dispatchId: scope.dispatchId,
      preregId: scope.preregId,
      scope,
      arms: [
        arm('per-failure', { observations: [pack('q1', ['a', 'b'], { chars: 400 })], servedPacks: 1, recallRequests: 1 }),
        arm('collapse', { observations: [pack('q1', ['a'], { chars: 200, folded: 1 })], servedPacks: 1, recallRequests: 1 }),
      ],
      seed: 300,
      model: 'deepseek-chat',
    });
    const summary = shapeArmSummary(reading);
    expect(summary).toContain('MEASURED:');
    expect(summary).toContain('per-failure pass4 75.00% served 1/1 items/req 2.000 chars/req 400 folded 0');
    expect(summary).toContain('collapse pass4 75.00% served 1/1 items/req 1.000 chars/req 200 folded 1');
    expect(summary).toContain('containment on 1 request(s), 0 mismatch, 0 excluded for a cut pack');
  });

  it('omits the contrast clause in a state that reports no contribution', () => {
    const reading = shapeArmReading({
      dispatchId: scope.dispatchId,
      preregId: scope.preregId,
      scope,
      arms: [arm('per-failure', { servedPacks: 0 }), arm('collapse', { servedPacks: 0 })],
      seed: 300,
      model: 'deepseek-chat',
    });
    const summary = shapeArmSummary(reading);
    expect(summary.startsWith('NO_DELIVERY:')).toBe(true);
    expect(summary).not.toContain('vs per-failure');
  });
});

describe('the artefact', () => {
  const measured = shapeArmReading({
    dispatchId: scope.dispatchId,
    preregId: scope.preregId,
    scope,
    arms: [
      arm('per-failure', { observations: [pack('q1', ['a', 'b'], { chars: 400 })] }),
      arm('collapse', { observations: [pack('q1', ['a'], { chars: 200, folded: 1 })] }),
    ],
    seed: 300,
    model: 'deepseek-chat',
  });

  it('names itself, states itself and travels with the reasons it is not a gate', () => {
    const artefact = shapeArmArtifact(measured, '2026-11-14T06:00:00.000Z');
    expect(artefact.id).toBe('poc-l4-facade-shapes');
    expect(artefact.title).toContain('two units');
    expect(artefact.ranAt).toBe('2026-11-14T06:00:00.000Z');
    expect(artefact.state).toBe('MEASURED');
    expect(artefact.notes.join(' ')).toContain('NOT the l4-paired memory-versus-reference gate');
  });

  it('reads back into the same numbers it was written with', () => {
    const back = readShapeArmArtifact(shapeArmArtifact(measured, '2026-11-14T06:00:00.000Z'));
    expect(back.state).toBe('MEASURED');
    expect(back.units).toEqual(['per-failure', 'collapse']);
    expect(back.arms.map((entry) => entry.shape)).toEqual(['per-failure', 'collapse']);
    expect(back.arms[1]).toMatchObject({ folded: 1, charsPerRequest: 200 });
    expect(back.contrasts).toHaveLength(1);
    expect(back.contrasts[0]?.baseline).toBe('per-failure');
    expect(back.containment).toEqual({ compared: 1, mismatched: 0, excluded: 0 });
  });

  it('carries no contrast in any state that reports no contribution', () => {
    for (const state of ['CONTAINMENT_BROKEN', 'NO_DELIVERY', 'NO_TREATMENT'] as const) {
      const back = readShapeArmArtifact({ ...shapeArmArtifact(measured, 'now'), state });
      expect(back.state).toBe(state);
      expect(back.contrasts).toEqual([]);
    }
  });

  it('falls back to the arms\' own names when the document does not list its units', () => {
    const done = shapeArmArtifact(measured, 'now');
    const { units: _units, ...withoutUnits } = done;
    expect(readShapeArmArtifact(withoutUnits).units).toEqual(['per-failure', 'collapse']);
  });

  it('refuses a document it cannot attest, rather than defaulting a readback', () => {
    const done = shapeArmArtifact(measured, 'now');
    expect(() => readShapeArmArtifact(null)).toThrow(/has no document/);
    expect(() => readShapeArmArtifact({ ...done, state: 'FINE' })).toThrow(
      /no recognised state, received 'FINE'/,
    );
    expect(() => readShapeArmArtifact({ ...done, summary: 7 })).toThrow(/no summary/);
    expect(() => readShapeArmArtifact({ ...done, containment: undefined })).toThrow(
      /no containment control/,
    );
    expect(() => readShapeArmArtifact({ ...done, arms: 'both' })).toThrow(/no arms/);
    expect(() => readShapeArmArtifact({ ...done, arms: [{ servedPacks: 1 }] })).toThrow(
      /names no unit/,
    );
    expect(() =>
      readShapeArmArtifact({ ...done, arms: [{ ...done.arms[0], folded: null }] }),
    ).toThrow(/no numeric folded count/);
    expect(() => readShapeArmArtifact({ ...done, contrasts: [] })).toThrow(
      /must carry at least one contrast/,
    );
    expect(() => readShapeArmArtifact({ ...done, contrasts: [{ comparison: {} }] })).toThrow(
      /names no arm/,
    );
    expect(() =>
      readShapeArmArtifact({ ...done, contrasts: [{ arm: 'collapse', comparison: {} }] }),
    ).toThrow(/names no baseline/);
    expect(() =>
      readShapeArmArtifact({
        ...done,
        contrasts: [{ arm: 'collapse', baseline: 'per-failure', comparison: { deltaPp: 1 } }],
      }),
    ).toThrow(/no numeric interval low/);
  });
});
