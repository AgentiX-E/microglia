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
/**
 * ALTK-Evolve, τ²-retail, `pass^4` on the split it published.
 *
 * A registered snapshot, not the board's current top: the τ²-retail leaderboard has since moved past it
 * (an open submission reports 67.5), and a lane that chased the top would be re-registering its bar after
 * every dispatch. What the number is *for* is the one thing a moving top cannot do — comparing a run to
 * the row that was published for the scenario it ran.
 */
export const PUBLISHED_PASS4 = 0.575;
/**
 * The same competitor's **submitted** number, and the reason the one above is not the only bar.
 *
 * ALTK-Evolve's `0.575` is what a GPT-4.1 ReAct agent scores on τ²-retail *before* its learned
 * guidelines are appended. With them (292 rules, `lossless`) it submitted `pass^4 = 0.6754` to the
 * board — PR #542, 114 base-split tasks, four trials, tau2-bench v1.0.1, $0.1084 per conversation.
 * A lane that reports only the first number produces a delta that reads like a lead over the
 * competitor and is in fact a lead over the competitor's **no-memory baseline**, which is a different
 * claim and a much easier one.
 *
 * This is reported as a second comparison and **not** as a gate. The samples differ — 114 tasks for
 * the submission, 57 in this lane's dispatch — so a delta between them is cross-sample, and a gate on
 * a cross-sample number would fail arms for the dispatch's task count rather than for their memory.
 */
export const COMPETITOR_PASS4 = 0.6754;
/** The number of tasks the submission above covers, so a delta can say whether it is cross-sample. */
export const COMPETITOR_TASKS = 114;
/**
 * The backbone the published rows were measured on.
 *
 * ALTK-Evolve's retail cell is a GPT-4.1 ReAct agent (with `gpt-5.5` as the customer simulator), and
 * this lane runs `deepseek/deepseek-flash`. Every L4 delta in this record therefore compares two
 * models as well as two prompts, and the artefact said nothing about it — the same defect R92 found
 * one axis over, where the release turned out to move the reward while the sample stood still.
 *
 * The bar is kept rather than withdrawn: "above 57.5 + 5pp" is still a fact about a run, and a gate
 * that disappears whenever the backbone differs would be unfalsifiable on the lane's only published
 * reference. What changes is that the comparison now names both models, so a reader can rank the arm
 * against its own backbone's paired control instead of against a number a different model produced.
 */
export const PUBLISHED_MODEL = 'gpt-4.1';

/**
 * Whether a run's model is the one the published rows were measured on.
 *
 * Matched exactly, with the release's dated spelling allowed: `gpt-4.1-2025-04-14` is the same model
 * as `gpt-4.1` in the row, while `gpt-4.1-mini` is not — and a prefix test would certify the second
 * one, which is how a bar quietly starts to fit.
 */
export function backboneMatches(model: string | undefined): boolean {
  const normalized = (model ?? '').trim().toLowerCase();
  if (normalized === '') return false;
  return /^gpt-4\.1(-\d{4}-\d{2}-\d{2})?$/.test(normalized);
}

/** The floor the lane shipped with, and the default for a dispatch that says nothing. */
export const DEFAULT_MIN_TASKS = 60;

export type ScenarioBar = {
  readonly scenario: string;
  /** Whether a published number is a bar for this scenario at all. */
  readonly comparable: boolean;
  /** The bar, or `null` when this scenario has none. */
  readonly published: number | null;
  /** The model the bar belongs to, or `null` when this scenario has no bar at all. */
  readonly model: string | null;
  /** Whether the run this bar is applied to used that model. */
  readonly sameBackbone: boolean;
  /** One sentence a report can print without its reader knowing this module. */
  readonly note: string;
};

export function scenarioBarOf(scenario: string, model?: string): ScenarioBar {
  if (scenario === PUBLISHED_SCENARIO) {
    const sameBackbone = backboneMatches(model);
    return {
      scenario,
      comparable: true,
      published: PUBLISHED_PASS4,
      model: PUBLISHED_MODEL,
      sameBackbone,
      note: sameBackbone
        ? `The published bar is ALTK-Evolve's ${PUBLISHED_PASS4.toFixed(3)} on τ²-${PUBLISHED_SCENARIO} pass^4, measured on ${PUBLISHED_MODEL} — the backbone this run used.`
        : `The published bar is ALTK-Evolve's ${PUBLISHED_PASS4.toFixed(3)} on τ²-${PUBLISHED_SCENARIO} pass^4, and it was measured on ${PUBLISHED_MODEL}: this run used ${(model ?? '').trim() === '' ? 'an unstated model' : (model as string).trim()}, so the delta is a different backbone as well as a different prompt. The comparable quantity is the paired control.`,
    };
  }
  return {
    scenario,
    comparable: false,
    published: null,
    model: null,
    sameBackbone: false,
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

/** A delta in percentage points, with an explicit sign and a typographic minus for the negative case. */
function signedPoints(against: number, value: number): string {
  const points = (value - against) * 100;
  return `${points >= 0 ? '+' : '−'}${Math.abs(points).toFixed(2)}pp`;
}

/**
 * One line stating what a run's `pass^4` is against **both** numbers the competitor published.
 *
 * Two comparisons, because they answer two questions and only one of them is the competitive one:
 * beating `0.575` says a memory beat no memory, and beating `0.6754` says it beat the competitor. The
 * second is printed with its sample caveat rather than suppressed — a number a reader has to go and
 * find is a number that gets quoted without the caveat.
 */
export function sotaLineOf(scenario: string, pass4: number | null, tasks: number | null): string {
  if (scenario !== PUBLISHED_SCENARIO) return `sota: no leaderboard bar for τ²-${scenario}`;
  if (pass4 === null) return 'sota: pass^4 absent';
  const head =
    `sota: ${pass4.toFixed(4)} against ALTK-Evolve's baseline ${PUBLISHED_PASS4.toFixed(3)} ` +
    `(${signedPoints(PUBLISHED_PASS4, pass4)}) and its submitted ${COMPETITOR_PASS4.toFixed(4)} ` +
    `(${signedPoints(COMPETITOR_PASS4, pass4)})`;
  if (tasks === COMPETITOR_TASKS) return head;
  const counted = tasks === null ? 'an unstated count' : String(tasks);
  return (
    `${head} — the submission covers ${String(COMPETITOR_TASKS)} tasks and this run ${counted}, ` +
    'so that delta is cross-sample, not a ranking'
  );
}
