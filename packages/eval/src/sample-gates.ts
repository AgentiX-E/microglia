/**
 * The sample gates an L4 arm is graded by, as a function rather than as a list in the driver.
 *
 * Two arms run per dispatch and they are not graded against the same bar. The memory arm may be
 * held to a published number; the **memory-free reference arm** cannot be, because it is the
 * control the memory arm is paired against and its job is to be a valid measurement, not a
 * competitive one. Grading it against `published + 5pp` made every dispatch end red: six
 * consecutive `sota` runs concluded `failure` with the memory arm green and only the control
 * failing a bar no control can pass. A status that is always red is a status nobody reads, and the
 * real failure it is supposed to signal — a run that produced no artefacts, a provider outage, a
 * split that leaked — becomes indistinguishable from the expected one.
 *
 * The replacement for the control is not "no gate". It is the gate that says what the control owes
 * the pairing step: every task it claims to have scored was scored. An arm with unscored tasks
 * contributes a per-task row the pairing step cannot join on, and a pair computed over the
 * intersection hides exactly the tasks that were dropped.
 *
 * Extracted here so the decision is testable: a gate that can never pass is a defect this project
 * has paid for before (AUDIT 34.57, 34.59), and a `bin/` file is excluded from coverage.
 */

import { scoreHalfWidthPp } from './power.js';

export type SampleGate = {
  readonly id: string;
  readonly pass: boolean;
  readonly actual: string | number;
  readonly criterion: string;
};

export type SampleGateInput = {
  /**
   * Which arm this is. The distinction is the whole point of this module.
   *
   * `scaffold` is R101's wrapper-only arm: the same agent as the memory arm over a store that is empty
   * by construction. It is a control for the same reason `reference` is — no bar in the published table
   * is a statement about a wrapper with no rules — and it owes the pairing step the same complete
   * per-task record, so it is graded by the control gate with its own sentence rather than by the
   * treatment's bar.
   */
  readonly arm: 'memory' | 'reference' | 'scaffold';
  /**
   * The distractor this arm planted, when it planted one.
   *
   * A third kind of arm, and the same argument as the control's one paragraph up: a planted arm's
   * hypothesis is *what an irrelevant or misleading rule costs*, so `>= published + 5pp` is a bar its
   * own registration says it should fail. R57's `far` arm measured `pass^4` 0.5789 against a published
   * 0.575 — a net-zero ledger, exactly as registered — and the step concluded `failure` anyway, which
   * is the shape that makes a red status unreadable: the arm was right and the gate was wrong.
   *
   * The replacement is not a gate here. The plant census and the paired ledger live in the artefact,
   * and `eval/verifiers/r57_readback.py` grades them arm by arm; what this file owes a planted arm is
   * that the bar does not apply, stated in `published_bar_applies` rather than silently omitted.
   */
  readonly planted?: { readonly arm: string } | undefined;
  readonly pass4: number;
  readonly tasks: number;
  readonly unscored: number;
  readonly minTasks: number;
  /**
   * The published number this arm may be held to, or `undefined` when none applies.
   *
   * R120. This used to carry the **verdict** (`{ meets: boolean }`) rather than the number, and the
   * defect that hid in that shape was found by reading R119's own output: the registration states the
   * bar as "the interval's lower bound must clear 0.575", the caller computed `meets` with a point
   * comparison, and the gate printed `criterion: '>= published + 0.05'` beside it. One dispatch, two
   * bars, and the gate's was the lenient one — a run at 0.63 would have been green under a file that
   * says the claim needs 0.75. A gate that cannot compute its own verdict cannot state which ruler it
   * used, so this file now takes the number, the ruler, and the count.
   */
  readonly published: { readonly value: number } | undefined;
  readonly bar: number;
  /**
   * Which bar the registration named: a point estimate, or an interval's lower bound.
   *
   * `point` is the default because it is what every dispatch before R120 ran, and an artefact's verdict
   * must not change retrospectively because a second ruler was added to the file. `interval` subtracts
   * the sample's own binomial half-width from the score before comparing, so the same score clears a
   * lower bar at a larger `n` — which is the only sense in which a bar is about evidence rather than
   * about luck.
   */
  readonly ruler?: 'point' | 'interval';
};

/**
 * The one gate the two rulers disagree about, computed here so the criterion cannot disagree with it.
 *
 * The point ruler is the default and is byte-for-byte what every dispatch before R120 ran: a score is
 * compared to `published + bar`, and `bar` is a share (0.05 → five points). The interval ruler asks a
 * strictly harder question — does the score minus its own 95% half-width still clear the published
 * number — and the two are the same test only at infinite `n`. A registration that states the interval
 * is stating a claim about evidence, and grading it by the point would be answering a different
 * question with a lenient instrument.
 */
function publishedGate(input: SampleGateInput, published: number): SampleGate {
  if (input.ruler !== 'interval') {
    return {
      id: 'l4-pass4',
      pass: input.pass4 >= published + input.bar,
      actual: input.pass4,
      criterion: `>= published + ${String(input.bar)}`,
    };
  }
  const halfWidthPp = scoreHalfWidthPp(input.pass4, input.tasks);
  return {
    id: 'l4-pass4',
    // Strictly greater: the registration says the lower bound must *clear* the published number, and a
    // lower bound exactly equal to it is a tie between "the claim holds" and "the sample cannot tell".
    pass: input.pass4 - halfWidthPp / 100 > published,
    actual: input.pass4,
    criterion: `> published + the sample's half-width (${halfWidthPp.toFixed(2)}pp at n=${String(input.tasks)})`,
  };
}

export function sampleGates(input: SampleGateInput): readonly SampleGate[] {
  return [
    // The published bar is a statement about the treatment. Omitting the gate is a statement, not a
    // pass: the metric carries `published_bar_applies: 0` and the note says which arm this is.
    ...(input.published === undefined || input.arm !== 'memory' || input.planted !== undefined
      ? []
      : [publishedGate(input, input.published.value)]),
    // What the control owes the pairing step, in place of a bar it cannot be held to.
    ...(input.arm === 'memory'
      ? []
      : [
          {
            id: 'l4-control-arm',
            pass: input.unscored === 0 && input.tasks > 0,
            actual: `${String(input.tasks)} scored, ${String(input.unscored)} unscored`,
            criterion:
              input.arm === 'scaffold'
                ? 'the wrapper-only control scored every task it claims, so the pair separates the wrapper from the pack'
                : 'the memory-free control scored every task it claims, so the pairing step joins on all of them',
          },
        ]),
    {
      id: 'l4-coverage',
      pass: input.tasks >= input.minTasks,
      actual: input.tasks,
      criterion: `>= ${String(input.minTasks)} tasks`,
    },
    // A score is only a split result if the whole grid was scored: the reader drops
    // infrastructure failures from the denominator, so the count has to be stated.
    {
      id: 'l4-fully-scored',
      pass: input.unscored === 0,
      actual: input.unscored,
      criterion: '= 0 unscored tasks',
    },
  ];
}
