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
  /** `meets` from `compareToPublished`, or `undefined` when no published number applies. */
  readonly published: { readonly meets: boolean } | undefined;
  readonly bar: number;
};

export function sampleGates(input: SampleGateInput): readonly SampleGate[] {
  return [
    // The published bar is a statement about the treatment. Omitting the gate is a statement, not a
    // pass: the metric carries `published_bar_applies: 0` and the note says which arm this is.
    ...(input.published === undefined || input.arm !== 'memory' || input.planted !== undefined
      ? []
      : [
          {
            id: 'l4-pass4',
            pass: input.published.meets,
            actual: input.pass4,
            criterion: `>= published + ${String(input.bar)}`,
          },
        ]),
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
