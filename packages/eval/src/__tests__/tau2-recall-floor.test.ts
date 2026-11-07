import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  COVERAGE_FLOORS,
  type CoverageHistogram,
  type UseCensus,
} from '../tau2-use-census.js';
import {
  AS_IS_FLOOR,
  U3_COST_WEIGHTS,
  committedFloor,
  resolveRecallFloor,
} from '../tau2-recall-floor.js';

/**
 * The recall floor is the one knob U3 is allowed to turn. These tests pin down
 * what may enter it: only a value on the registered grid, and only the floor
 * recomputed from the committed R47 artefact with registered cost weights. A
 * dispatch that cannot name its floor before it runs stays on the as-is floor.
 */
const fixture = JSON.parse(
  readFileSync(join(process.cwd(), 'eval/fixtures/tau2-r47-coverage-histogram.json'), 'utf8'),
) as {
  readonly source: { readonly run: string; readonly pinnedCommit: string; readonly arm: string };
  readonly coverage: CoverageHistogram;
  readonly use: UseCensus;
};

describe('resolveRecallFloor', () => {
  it('defaults to the as-is floor when the variable is absent, empty or blank', () => {
    expect(resolveRecallFloor({})).toBe(AS_IS_FLOOR);
    expect(resolveRecallFloor({ TAU_MIN_COVERAGE: '' })).toBe(AS_IS_FLOOR);
    expect(resolveRecallFloor({ TAU_MIN_COVERAGE: '   ' })).toBe(AS_IS_FLOOR);
  });

  it('accepts every rung of the registered grid, including zero', () => {
    for (const floor of COVERAGE_FLOORS) {
      expect(resolveRecallFloor({ TAU_MIN_COVERAGE: String(floor) })).toBe(floor);
    }
  });

  it('accepts a trimmed numeric value', () => {
    expect(resolveRecallFloor({ TAU_MIN_COVERAGE: ' 0.01 ' })).toBe(0.01);
  });

  it('refuses a value that is not a number', () => {
    expect(() => resolveRecallFloor({ TAU_MIN_COVERAGE: 'high' })).toThrow(/finite/);
    expect(() => resolveRecallFloor({ TAU_MIN_COVERAGE: 'NaN' })).toThrow(/finite/);
    expect(() => resolveRecallFloor({ TAU_MIN_COVERAGE: 'Infinity' })).toThrow(/finite/);
  });

  it('refuses a value outside the unit interval', () => {
    expect(() => resolveRecallFloor({ TAU_MIN_COVERAGE: '-0.01' })).toThrow(/interval/);
    expect(() => resolveRecallFloor({ TAU_MIN_COVERAGE: '1.5' })).toThrow(/interval/);
  });

  it('refuses a value that is not on the registered grid', () => {
    expect(() => resolveRecallFloor({ TAU_MIN_COVERAGE: '0.07' })).toThrow(/grid/);
    expect(() => resolveRecallFloor({ TAU_MIN_COVERAGE: '0.0100001' })).toThrow(/grid/);
  });
});

describe('committedFloor over the real R47 artefact', () => {
  it('computes 0.01 from the committed curve with the registered weights', () => {
    expect(committedFloor(fixture.coverage, fixture.use)).toBe(0.01);
  });

  it('uses the registered false-positive-averse weights by default', () => {
    expect(U3_COST_WEIGHTS.gamma).toBeGreaterThan(U3_COST_WEIGHTS.alpha);
    expect(U3_COST_WEIGHTS.alpha).toBeGreaterThan(U3_COST_WEIGHTS.beta);
    expect(committedFloor(fixture.coverage, fixture.use, U3_COST_WEIGHTS)).toBe(0.01);
  });

  it('returns the as-is floor under abstention-averse weights, so weights cannot be hidden', () => {
    expect(committedFloor(fixture.coverage, fixture.use, { alpha: 1, gamma: 0.5, beta: 3 })).toBe(0);
  });

  it('refuses a broken committed population instead of inventing a floor', () => {
    const broken: UseCensus = { ...fixture.use, injectedPairs: fixture.use.injectedPairs + 1 };
    expect(() => committedFloor(fixture.coverage, broken)).toThrow(/cannot compute a floor/);
  });
});
