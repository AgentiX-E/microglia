/**
 * What a dispatch will cost, derived from a run that already happened.
 *
 * Four consecutive registrations discovered that the estimate was the moving part: R72 budgeted
 * 44,000 and spent 16,876, R73 budgeted 4,000 and was stopped at 851, R73's amendment budgeted 5,600
 * for a run that needed 3,165, and R74 budgeted 28,000 for a run that measured 29,609 on its first
 * fold. Every one of those numbers was arithmetic written into a Markdown table by hand, and every
 * one of them was wrong in a different direction, because "calls per question per arm" is a property
 * of the *lane at that moment* — its repair rate, its cache temperature, its distillation share — and
 * not a constant anyone can carry in their head.
 *
 * This module makes the estimate a function of an artefact. It reads one finished run and answers the
 * only question a registration asks: given a population, an arm list and a fold count, how much will
 * the lane spend, and what is the most it should be authorised to spend.
 *
 * Two properties are the point.
 *
 *  - **The rate is measured, not assumed.** `calls / (questions × arms)` over a real run already
 *    averages the repair rate, the distillation share and the cache temperature that run had. It is
 *    not a per-arm model, because the artefact does not attribute calls to arms and inventing that
 *    attribution would be a second guess stacked on the first.
 *  - **An unmeasured arm costs a multiple, not a number.** R74's third arm was new, and a new arm is
 *    exactly the case where a measured rate cannot apply: `loo` renders a degraded pack, degraded SQL
 *    errors more often, and the repair call is what turns a failure into a second attempt. The lane
 *    measured 1.167 calls per question-arm against R72's 1.078 — 8% above the rate the estimate
 *    assumed. When any requested arm has no measured rate, the ceiling is a multiple of the
 *    projection rather than the projection itself, and the registration says which arm caused it.
 */

/** A finished run, reduced to the four numbers a projection needs. */
export type PriorRun = {
  /** Model calls the run spent, retries included. */
  readonly calls: number;
  /** Questions it evaluated — the denominator of the rate, not the fold-level count. */
  readonly questions: number;
  /** The arms it evaluated, by name. */
  readonly arms: readonly string[];
  /** Folds it cross-fitted over, which scales nothing but is worth reporting. */
  readonly folds: number;
};

export type BudgetRequest = {
  /** The arms the new dispatch will evaluate. */
  readonly arms: readonly string[];
  /**
   * How many model calls one question costs in each arm.
   *
   * **The per-arm rate was the second defect in this module and R68 found it.** The first version
   * priced an arm as an arm, so a dispatch of three five-draw sampling arms projected 4,179 calls and
   * measured 5,638: the arms cost five draws each, and the count that matters is draws rather than
   * arms. A `sample-5-*` arm is five calls per question and a `full` arm is one, so a run of three
   * sampling arms costs fifteen times a question and a run of two costs ten.
   *
   * Absent means every arm costs one call, which is right for the plain arms and is what the
   * single-draw runs in this repository actually did.
   */
  readonly weights?: Readonly<Record<string, number>>;
  /** Questions to draw; defaults to the prior run's population. */
  readonly questions?: number;
  /** Folds; defaults to the prior run's. */
  readonly folds?: number;
  /**
   * Headroom over the measured rate, in percent. Defaults to 110, matching the in-run forecast's
   * own safety allowance — the two numbers are the same claim about the same lane and a registration
   * that quoted a different one would be quoting a different lane.
   */
  readonly safetyPct?: number;
  /**
   * The multiple applied when part of the arm list has no measured rate. Defaults to 130.
   *
   * Two cases are on record and they are different sizes. R74 added one plain arm to a plain pair and
   * cost 8% more than the projection; R68 replaced a two-sampling-arm run with a three-sampling-arm
   * one and cost 35% more, or 18% once the projection learned to count draws rather than arms. A
   * multiple has to cover the *next* miss rather than the last one, and the misses so far have been
   * structural — a new arm is exactly the case where a measured rate cannot apply — so the default is
   * 130: enough for both cases on record with room for a third, and still a bound rather than an
   * unlimited licence, since a run that exceeds it is a run whose registration was wrong about its own
   * shape.
   */
  readonly unmeasuredPct?: number;
};

export type BudgetPlan = {
  /** Measured calls per question per draw in the prior run; zero when the prior is unusable. */
  readonly ratePerQuestionArm: number;
  /** Calls the new dispatch is expected to spend. */
  readonly projected: number;
  /** The most it should be authorised to spend, which is above the projection when it is a guess. */
  readonly ceiling: number;
  /** Requested arms the prior run never evaluated. */
  readonly unmeasured: readonly string[];
  /** Whether every requested arm was measured, which is what makes the ceiling equal the projection. */
  readonly measured: boolean;
  /** The reason the projection is zero, when it is. */
  readonly unusable: 'no-calls' | 'no-questions' | 'no-arms' | null;
};

const DEFAULT_SAFETY_PCT = 110;
const DEFAULT_UNMEASURED_PCT = 130;

export function planBudget(prior: PriorRun, request: BudgetRequest): BudgetPlan {
  const questions = request.questions ?? prior.questions;
  const arms = [...request.arms];
  const unmeasured = arms.filter((arm) => !prior.arms.includes(arm));
  const measured = unmeasured.length === 0;

  const unusable =
    prior.calls <= 0 ? 'no-calls' : prior.questions <= 0 ? 'no-questions' : prior.arms.length === 0 ? 'no-arms' : null;
  if (unusable !== null || questions <= 0 || arms.length === 0) {
    // A prior with no measurement cannot price anything, and a projection of zero is the only
    // honest number. It is reported with the reason rather than as a zero the caller might read as
    // "free", because a dispatch sized from an unusable prior is a dispatch sized from nothing.
    return {
      ratePerQuestionArm: 0,
      projected: 0,
      ceiling: 0,
      unmeasured,
      measured,
      unusable: unusable ?? (questions <= 0 ? 'no-questions' : 'no-arms'),
    };
  }

  // The prior's own weights, so a sampling run is not measured with a draw-blind denominator. A prior
  // whose arms do not all cost one call is priced by the same weighting the request will be.
  const weightOf = (arm: string): number => {
    const weighted = request.weights?.[arm];
    return weighted !== undefined && weighted > 0 ? weighted : 1;
  };
  const priorWeight = prior.arms.reduce((sum, arm) => sum + weightOf(arm), 0);
  const requestWeight = arms.reduce((sum, arm) => sum + weightOf(arm), 0);
  const rate = prior.calls / (prior.questions * priorWeight);
  const safetyPct = request.safetyPct ?? DEFAULT_SAFETY_PCT;
  // Ceiled once, on the product, so the projected number and the ceiling cannot disagree about the
  // rounding of an intermediate figure. `Math.round` per term would let a four-fold projection
  // differ from four single-fold projections by a call, which reads as a lane that is inconsistent
  // with itself.
  const projected = Math.ceil((questions * requestWeight * rate * safetyPct) / 100);
  const unmeasuredPct = request.unmeasuredPct ?? DEFAULT_UNMEASURED_PCT;
  const ceiling = measured ? projected : Math.ceil((projected * unmeasuredPct) / 100);

  return { ratePerQuestionArm: rate, projected, ceiling, unmeasured, measured, unusable: null };
}
