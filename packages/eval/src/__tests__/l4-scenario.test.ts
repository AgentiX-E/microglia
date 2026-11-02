import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MIN_TASKS,
  PUBLISHED_PASS4,
  minTasksOf,
  scenarioBarOf,
} from '../l4-scenario.js';

/**
 * The bar, and the scenario it is a bar for.
 *
 * Both halves are refusals in disguise: a bar that applies to every scenario turns a scenario
 * difference into a memory difference, and a floor chosen for one scenario reports every smaller one
 * as short.
 */

describe('scenarioBarOf', () => {
  it('grades the published scenario against the published number', () => {
    const bar = scenarioBarOf('retail');
    expect(bar.comparable).toBe(true);
    expect(bar.published).toBe(PUBLISHED_PASS4);
    expect(bar.note).toContain('ALTK-Evolve');
  });

  it('states that a second scenario has no bar rather than borrowing one', () => {
    const bar = scenarioBarOf('airline');
    expect(bar.comparable).toBe(false);
    expect(bar.published).toBeNull();
    expect(bar.note).toContain('τ²-airline');
    // The sentence a reader needs is *why*, not only *that*: the two numbers would differ by the
    // scenario, and a delta over them would be attributed to the memory.
    expect(bar.note).toContain('paired one');
  });
});

describe('minTasksOf', () => {
  it('defaults to the floor the lane shipped with', () => {
    expect(minTasksOf(undefined)).toBe(DEFAULT_MIN_TASKS);
    expect(minTasksOf('  ')).toBe(DEFAULT_MIN_TASKS);
  });

  it('takes the floor from the dispatch when it states one', () => {
    expect(minTasksOf('40')).toBe(40);
  });

  it('refuses a floor that is not a count of tasks', () => {
    expect(() => minTasksOf('0')).toThrow(/positive integer/);
    expect(() => minTasksOf('-5')).toThrow(/positive integer/);
    expect(() => minTasksOf('many')).toThrow(/positive integer/);
  });
});
