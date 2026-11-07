import { describe, expect, it } from 'vitest';
import {
  inactionCensusOf,
  inactionContrast,
  inactionContrastOrNull,
  inactionRate,
  inactionSummary,
  type InactionCensus,
} from '../inaction.js';

/**
 * Inaction is the mechanism behind a pass^4 delta, not a second score.
 *
 * The two published ablations behind the memory hypothesis (`COMPETITIVE` L.21) disagree about the
 * direction of a memory's effect and agree about the mechanism: on LongMemEval the same question
 * against a focused pack and against a 113,000-token session differs by 15-35pp, and the strongest
 * models express most of that gap as **abstention**. In τ² an episode that abstains does not produce
 * a low score; it produces no action at all, which fails every required action the task named.
 *
 * So a floor's delta has two possible shapes, and they mean different things:
 *
 *   - the agent acted and the pack made it act *wrongly* (a wrong-action delta), or
 *   - the agent stopped acting (an inaction delta).
 *
 * A pair artefact that reports only pass^4 cannot tell them apart, which is why the next floor arm
 * must not be registered until the census is in the artefact. These tests fix the contract for the
 * census itself: what it may claim, what it must refuse, and what it must never invent.
 *
 * The episode rows below are the shape the Python phase emits from upstream's live `SimulationRun`
 * objects (`role` / `tool_calls` on each message). They are structural, not a measurement.
 */

/** One phase's `diagnostics` object, as `run_split.py` prints it on its summary line. */
const diagnostics = (episodes: readonly (readonly [string, number, boolean])[], observable = true) => ({
  agent_turns: episodes.length,
  simulations: episodes.length,
  terminated: { agent_stop: episodes.length },
  inaction: {
    observable,
    episodes: episodes.map(([task, trial, acted]) => ({ task, trial, acted })),
  },
});

describe('inactionCensusOf', () => {
  it('counts inactive trials per task and qualifies the ids with the scenario', () => {
    const census = inactionCensusOf(
      diagnostics([
        ['7', 0, true],
        ['7', 1, false],
        ['9', 0, false],
        ['9', 1, false],
      ]),
      'retail',
    );

    expect(census.state).toBe('OBSERVED');
    if (census.state !== 'OBSERVED') throw new Error('unreachable');
    expect(census.tasks).toEqual([
      { id: 'retail/7', inactive: 1, trials: 2 },
      { id: 'retail/9', inactive: 2, trials: 2 },
    ]);
    expect(census.inactiveTrials).toBe(3);
    expect(census.totalTrials).toBe(4);
  });

  it('orders tasks by id so two runs of the census compare line by line', () => {
    const census = inactionCensusOf(
      diagnostics([
        ['b', 0, false],
        ['a', 0, true],
        ['c', 0, false],
      ]),
      'airline',
    );
    if (census.state !== 'OBSERVED') throw new Error('unreachable');
    expect(census.tasks.map((task) => task.id)).toEqual(['airline/a', 'airline/b', 'airline/c']);
  });

  it('reports a zero rather than an absence when every episode acted', () => {
    const census = inactionCensusOf(
      diagnostics([
        ['1', 0, true],
        ['1', 1, true],
      ]),
      'retail',
    );
    expect(census.state).toBe('OBSERVED');
    if (census.state !== 'OBSERVED') throw new Error('unreachable');
    expect(census.inactiveTrials).toBe(0);
    expect(inactionRate(census)).toBe(0);
  });

  it('refuses to read a phase with no diagnostics as zero inaction', () => {
    const census = inactionCensusOf(undefined, 'retail');
    expect(census).toEqual({ state: 'NOT_OBSERVED', reason: 'the phase reported no diagnostics' });
    expect(inactionRate(census)).toBeNull();
  });

  it('treats an absent census as unobservable, which is every dispatch before this instrument', () => {
    const census = inactionCensusOf({ agent_turns: 40, simulations: 10, terminated: null }, 'retail');
    expect(census.state).toBe('NOT_OBSERVED');
    expect(inactionRate(census)).toBeNull();
  });

  it('honours an explicit unobservable flag from the phase', () => {
    const census = inactionCensusOf(diagnostics([['1', 0, true]], false), 'retail');
    expect(census.state).toBe('NOT_OBSERVED');
    if (census.state !== 'NOT_OBSERVED') throw new Error('unreachable');
    expect(census.reason).toContain('not observable');
  });

  it('refuses an empty episode list instead of reporting 0 of 0', () => {
    const census = inactionCensusOf(diagnostics([]), 'retail');
    expect(census.state).toBe('NOT_OBSERVED');
    if (census.state !== 'NOT_OBSERVED') throw new Error('unreachable');
    expect(census.reason).toContain('no episode');
  });

  it('refuses a repeated (task, trial) rather than counting one episode twice', () => {
    expect(() =>
      inactionCensusOf(
        diagnostics([
          ['7', 0, true],
          ['7', 0, false],
        ]),
        'retail',
      ),
    ).toThrow(/two action records for retail\/7 trial 0/);
  });

  it('refuses an episode with no task id', () => {
    expect(() =>
      inactionCensusOf({ inaction: { observable: true, episodes: [{ trial: 0, acted: true }] } }, 'retail'),
    ).toThrow(/no task id/);
  });

  it('refuses a trial that is not a non-negative integer', () => {
    expect(() =>
      inactionCensusOf({ inaction: { observable: true, episodes: [{ task: '7', trial: -1, acted: true }] } }, 'retail'),
    ).toThrow(/trial/);
    expect(() =>
      inactionCensusOf({ inaction: { observable: true, episodes: [{ task: '7', trial: 1.5, acted: true }] } }, 'retail'),
    ).toThrow(/trial/);
  });

  it('refuses an `acted` flag that is not a boolean', () => {
    expect(() =>
      inactionCensusOf({ inaction: { observable: true, episodes: [{ task: '7', trial: 0, acted: 'yes' }] } }, 'retail'),
    ).toThrow(/acted/);
  });

  it('refuses a census whose observable flag is not a boolean', () => {
    expect(() =>
      inactionCensusOf({ inaction: { observable: 'true', episodes: [] } }, 'retail'),
    ).toThrow(/observable/);
  });

  it('refuses diagnostics that are not an object', () => {
    expect(() => inactionCensusOf('diagnostics', 'retail')).toThrow(/not an object/);
  });

  it('refuses a census that is not an object', () => {
    expect(() => inactionCensusOf({ inaction: 'observable' }, 'retail')).toThrow(
      /census is not an object/,
    );
  });

  it('refuses a census with no episode list', () => {
    expect(() => inactionCensusOf({ inaction: { observable: true, episodes: {} } }, 'retail')).toThrow(
      /no episode list/,
    );
  });

  it('refuses an episode that is not an object', () => {
    expect(() =>
      inactionCensusOf({ inaction: { observable: true, episodes: ['retail/7'] } }, 'retail'),
    ).toThrow(/episode is not an object/);
  });

  it('refuses an empty task id', () => {
    expect(() =>
      inactionCensusOf({ inaction: { observable: true, episodes: [{ task: '  ', trial: 0, acted: true }] } }, 'retail'),
    ).toThrow(/no task id/);
  });

  it('orders an already-descending list ascending', () => {
    const census = inactionCensusOf(
      diagnostics([
        ['c', 0, false],
        ['b', 0, false],
        ['a', 0, false],
      ]),
      'retail',
    );
    if (census.state !== 'OBSERVED') throw new Error('unreachable');
    expect(census.tasks.map((task) => task.id)).toEqual(['retail/a', 'retail/b', 'retail/c']);
  });

  it('has no rate over a population of zero, which a hand-written document can carry', () => {
    expect(inactionRate({ state: 'OBSERVED', tasks: [], inactiveTrials: 0, totalTrials: 0 })).toBeNull();
  });
});

describe('inactionContrast', () => {
  const census = (rows: readonly (readonly [string, number, boolean])[], scenario = 'retail'): InactionCensus =>
    inactionCensusOf(diagnostics(rows), scenario);

  it('reports the treatment minus control share, in percentage points', () => {
    // as-is: 1 of 4 inactive; floored: 2 of 4 inactive -> +25.00pp more inaction.
    const asIs = census([
      ['1', 0, false],
      ['1', 1, true],
      ['2', 0, true],
      ['2', 1, true],
    ]);
    const floored = census([
      ['1', 0, false],
      ['1', 1, false],
      ['2', 0, true],
      ['2', 1, true],
    ]);
    const contrast = inactionContrast(asIs, floored);
    expect(contrast).toBeDefined();
    if (contrast === undefined) throw new Error('unreachable');
    expect(contrast.asIsRate).toBeCloseTo(0.25, 10);
    expect(contrast.flooredRate).toBeCloseTo(0.5, 10);
    expect(contrast.deltaPp).toBeCloseTo(25, 10);
    expect(contrast.inactiveTrials).toEqual({ asIs: 1, floored: 2 });
  });

  it('reports no contrast when either side is unobservable', () => {
    const observed = census([['1', 0, false]]);
    expect(inactionContrast({ state: 'NOT_OBSERVED', reason: 'r' }, observed)).toBeUndefined();
    expect(inactionContrast(observed, { state: 'NOT_OBSERVED', reason: 'r' })).toBeUndefined();
  });

  it('refuses two censuses over different task sets', () => {
    const asIs = census([['1', 0, true]]);
    const floored = census([['2', 0, false]]);
    expect(() => inactionContrast(asIs, floored)).toThrow(/same tasks/);
  });

  it('refuses two censuses over different trial counts for one task', () => {
    const asIs = census([
      ['1', 0, true],
      ['1', 1, true],
    ]);
    const floored = census([['1', 0, false]]);
    expect(() => inactionContrast(asIs, floored)).toThrow(/same tasks/);
  });

  it('turns the boundary refusal into null rather than a throw after an hour of evaluation', () => {
    const asIs = census([['1', 0, true]]);
    const floored = census([['2', 0, false]]);
    expect(inactionContrastOrNull(asIs, floored)).toBeNull();
    expect(inactionContrastOrNull(asIs, census([['1', 0, false]]))?.deltaPp).toBe(100);
    expect(
      inactionContrastOrNull({ state: 'NOT_OBSERVED', reason: 'r' }, census([['1', 0, false]])),
    ).toBeNull();
  });

  it('refuses to divide by a population of zero, which only a hand-written document can carry', () => {
    // `inactionCensusOf` never produces this: an episode list that is empty comes back
    // NOT_OBSERVED. The census also travels as JSON in an artefact, so the reader is allowed to
    // meet a document a person wrote. Two arms over no episode have no share to contrast.
    const empty: InactionCensus = { state: 'OBSERVED', tasks: [], inactiveTrials: 0, totalTrials: 0 };
    expect(inactionContrast(empty, census([['1', 0, false]]))).toBeUndefined();
    expect(inactionContrast(census([['1', 0, false]]), empty)).toBeUndefined();
  });
});

describe('inactionSummary', () => {
  const observed = (rows: readonly (readonly [string, number, boolean])[]): InactionCensus =>
    inactionCensusOf(diagnostics(rows), 'retail');

  it('prints both shares when both facades observed the episodes', () => {
    const asIs = observed([
      ['1', 0, false],
      ['1', 1, true],
    ]);
    const floored = observed([
      ['1', 0, false],
      ['1', 1, false],
    ]);
    expect(inactionSummary(asIs, floored)).toBe('inaction: as-is 1/2 floored 2/2');
  });

  it('names the control as the unobservable side when it is the one that could not see', () => {
    expect(inactionSummary({ state: 'NOT_OBSERVED', reason: 'no diagnostics' }, observed([['1', 0, true]]))).toBe(
      'inaction: NOT_OBSERVED (no diagnostics)',
    );
  });

  it('names the treatment as the unobservable side when it is the one that could not see', () => {
    expect(
      inactionSummary(observed([['1', 0, true]]), { state: 'NOT_OBSERVED', reason: 'hidden messages' }),
    ).toBe('inaction: NOT_OBSERVED (hidden messages)');
  });
});
