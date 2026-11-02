/**
 * Whether the leaderboard bar applies to the scenario this run answered.
 *
 * ## The defect this module exists for
 *
 * The lane has one published reference — ALTK-Evolve, `pass^4 = 0.575` on τ²-retail — and it graded
 * every arm against it. On a second scenario that is not a strict bar, it is a category error: an
 * airline run compared to a retail number produces a delta that measures the two scenarios, not the
 * memory, and a `l4-pass4` gate that fails for that reason tells a reader the arm underperformed
 * when the truth is that nothing comparable was measured.
 *
 * R29 stage 2 is the first dispatch that answers a scenario other than the published one, so the
 * distinction has to exist before the run is paid for. The rule is narrow on purpose: the bar is
 * graded only on the scenario it was published for, and elsewhere the artefact states that it has no
 * leaderboard bar rather than passing one it never checked.
 *
 * ## Why the split floor is a parameter
 *
 * `60 tasks` was chosen for τ²-retail's 68-task held-out half. A smaller scenario cannot clear a
 * floor chosen for a larger one, and a lane that kept 60 would report every small scenario as too
 * short — a fact about the scenario dressed as a fact about the instrument. The floor therefore
 * comes from the dispatch (`TAU_MIN_TASKS`), and the registration states the number it was run at.
 */

/** The scenario the published number belongs to. */
export const PUBLISHED_SCENARIO = 'retail';
/** ALTK-Evolve, τ²-retail, pass^4 on the split it published. */
export const PUBLISHED_PASS4 = 0.575;
/** The floor the lane shipped with, and the default for a dispatch that says nothing. */
export const DEFAULT_MIN_TASKS = 60;

export type ScenarioBar = {
  readonly scenario: string;
  /** Whether a published number is a bar for this scenario at all. */
  readonly comparable: boolean;
  /** The bar, or `null` when this scenario has none. */
  readonly published: number | null;
  /** One sentence a report can print without its reader knowing this module. */
  readonly note: string;
};

export function scenarioBarOf(scenario: string): ScenarioBar {
  if (scenario === PUBLISHED_SCENARIO) {
    return {
      scenario,
      comparable: true,
      published: PUBLISHED_PASS4,
      note: `The published bar is ALTK-Evolve's ${PUBLISHED_PASS4.toFixed(3)} on τ²-${PUBLISHED_SCENARIO} pass^4.`,
    };
  }
  return {
    scenario,
    comparable: false,
    published: null,
    note:
      `No published pass^4 exists for τ²-${scenario}, so this run is not graded against a leaderboard: ` +
      `ALTK-Evolve's ${PUBLISHED_PASS4.toFixed(3)} is a τ²-${PUBLISHED_SCENARIO} number, and comparing a ` +
      `${scenario} run to it would report a difference between two scenarios as a difference the memory made. ` +
      'The comparison this run supports is the paired one.',
  };
}

/** The split floor, from the dispatch, refusing a value that is not a count of tasks. */
export function minTasksOf(value: string | undefined, fallback = DEFAULT_MIN_TASKS): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new RangeError(`TAU_MIN_TASKS must be a positive integer, received '${value}'`);
  }
  return parsed;
}
