import { describe, expect, it } from 'vitest';
import {
  COMPETITOR_PASS4,
  COMPETITOR_TASKS,
  DEFAULT_MIN_TASKS,
  PUBLISHED_PASS4,
  minTasksOf,
  scenarioBarOf,
  sotaLineOf,
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

describe('the backbone the bar was measured on', () => {
  /**
   * R92's third axis after model, prompt, split and release: the *backbone*.
   *
   * ALTK-Evolve's 57.5% is a GPT-4.1 ReAct agent, and this lane runs `deepseek/deepseek-flash`.
   * Every L4 number in this record — 0.5752, 0.5614, 0.7018, 0.6316 — is therefore a comparison
   * across backbones as well as across prompt and split, and the artefact never said so. The fix is
   * not to delete the bar: a run above `published + 5pp` on a different backbone has still cleared a
   * number, and the sentence a reader needs is *which* number. So the bar keeps its arithmetic and
   * declares whose model it came from.
   */
  it('matches the model the published rows were measured on', () => {
    expect(scenarioBarOf('retail', 'gpt-4.1-2025-04-14').sameBackbone).toBe(true);
    expect(scenarioBarOf('retail', 'gpt-4.1').sameBackbone).toBe(true);
  });

  it('states a mismatch for this lane’s own model rather than hiding it', () => {
    const bar = scenarioBarOf('retail', 'deepseek/deepseek-flash');
    expect(bar.comparable).toBe(true);
    expect(bar.published).toBe(PUBLISHED_PASS4);
    expect(bar.sameBackbone).toBe(false);
    expect(bar.note).toContain('gpt-4.1');
    expect(bar.note).toContain('different backbone');
  });

  it('refuses to match a sibling model that shares a prefix', () => {
    // `gpt-4.1-mini` starts with `gpt-4.1` and is not the model the rows were measured on; a prefix
    // test would certify it, which is how a bar quietly starts to fit.
    expect(scenarioBarOf('retail', 'gpt-4.1-mini').sameBackbone).toBe(false);
  });

  it('reports no backbone at all when it has no number', () => {
    expect(scenarioBarOf('airline', 'gpt-4.1').sameBackbone).toBe(false);
    expect(scenarioBarOf('airline', 'gpt-4.1').model).toBeNull();
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

/**
 * The two numbers the competitor published, and the difference between them.
 *
 * `0.575` is ALTK-Evolve's τ²-retail `pass^4` **before** its guidelines were appended; `0.6754` is what
 * it submitted to the board with them. A lane that reported only the first produced a delta that reads
 * like a lead over the competitor and is in fact a lead over the competitor's no-memory baseline, which
 * is a different claim. Both are reported, and the sample difference is stated rather than smoothed.
 */
describe('sotaLineOf', () => {
  it('reports both bars, and calls each one what it is', () => {
    const line = sotaLineOf('retail', 0.7018, COMPETITOR_TASKS);
    expect(line).toContain('0.7018');
    expect(line).toContain('0.575');
    expect(line).toContain('+12.68pp');
    expect(line).toContain('0.6754');
    expect(line).toContain('+2.64pp');
    expect(line).toContain('baseline');
    expect(line).toContain('submitted');
  });

  it('states the sample difference when the run is not on the competitor s', () => {
    // 0.7018 on 57 tasks and 0.6754 on 114 are not two rows of one ranking, and the line says so
    // rather than leaving the delta to be read as one.
    const line = sotaLineOf('retail', 0.7018, 57);
    expect(line).toContain('cross-sample');
    expect(line).toContain('114');
    expect(line).toContain('57');
  });

  it('does not call a delta a ranking when the samples match', () => {
    expect(sotaLineOf('retail', 0.70, COMPETITOR_TASKS)).not.toContain('cross-sample');
  });

  it('reports a negative delta with its sign rather than dropping it', () => {
    expect(sotaLineOf('retail', 0.50, 57)).toContain('−7.50pp');
  });

  it('says there is no leaderboard bar for a scenario the competitor did not publish', () => {
    const line = sotaLineOf('airline', 0.9, 50);
    expect(line).toContain('no leaderboard bar');
    expect(line).not.toContain('0.6754');
  });

  it('answers an absent pass^4 rather than printing a delta against nothing', () => {
    expect(sotaLineOf('retail', null, 57)).toContain('pass^4 absent');
  });

  it('calls an unstated sample unstated rather than counting it as none', () => {
    // `null` is "the run did not say", not "the run scored zero tasks", and a line that printed 0
    // would read as a split that failed its floor.
    const line = sotaLineOf('retail', 0.70, null);
    expect(line).toContain('an unstated count');
    expect(line).toContain('cross-sample');
  });
});
