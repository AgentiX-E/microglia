/**
 * The conditions a paired arm comparison is graded by, and which of them a planted arm owes.
 *
 * `l4-paired` states the treatment's hypothesis: the memory does not cost accuracy. It is the R45
 * revert rule read from `paired-verdict.ts`, and it blocks — a pair whose memory arm is significantly
 * worse is a lane that published a harm. `l4-effect-resolved` reports whether the pair can support the
 * sentence it prints, and does not block, because an unresolvable effect is a fact about the sample.
 * `l4-same-split` blocks: two arms scored on different tasks are not a pair.
 *
 * R57 added a third kind of arm and the first two conditions are not that arm's. A planted distractor
 * puts one authored rule in every pack *because* its registered hypothesis is that the rule costs
 * something: `near` predicts it breaks more episodes than it repairs, `adversarial` predicts it more
 * strongly, and `far`'s registration accepts either a small negative or a larger one. For those arms a
 * `HARM` verdict is the arm agreeing with its registration — the same shape as the memory-free control
 * being held to `published + 5pp` (AUDIT 34.84's neighbour, 34.86), and the same repair: the condition
 * that does not belong to the arm is **omitted and the omission is recorded**, not weakened until the
 * arm goes green.
 *
 * What replaces them is not here. The distractor's price is read per episode by
 * `eval/verifiers/r57_readback.py` against the plant census and the paired ledger, which is the
 * reading R57 registered; a `pass^4` mean over 57 tasks could not carry it in either direction.
 *
 * `l4-same-split` stays for every arm, because it is a property of the two files on disk rather than a
 * hypothesis about either of them: an arm that dropped tasks leaves the pair incomparable whoever it is.
 *
 * Extracted out of `bin/l4-pair.ts` for the reason `sample-gates.ts` was extracted out of `bin/l4.ts`:
 * a `bin/` file is excluded from coverage, and these three gates have never had a test.
 */

import type { ValidityGate } from '@agentix-e/microglia-protocol';
import type { PairedVerdictState } from './paired-verdict.js';

export type PairGateInput = {
  /** What the pair established, from `pairedVerdict`. */
  readonly state: PairedVerdictState;
  /** The claim the verdict supports, when it supports one. */
  readonly claim: string | null;
  readonly deltaPp: number;
  readonly p: number;
  readonly paired: number;
  /** Served packs on the memory arm, which the revert rule's second branch reads. */
  readonly served: number;
  /** The pair's minimum detectable difference, or undefined when it cannot be estimated. */
  readonly detectablePp: number | undefined;
  readonly splitMatches: boolean;
  readonly onlyFirst: number;
  readonly onlySecond: number;
  /**
   * The distractor the memory arm planted, when it planted one.
   *
   * Read from the arm's own artefact rather than from the dispatch's environment, because the
   * artefact is what the pair is about: a directory filed under `near` that carries no plant census
   * is a control arm with a misleading name, and its pair should be graded as one.
   */
  readonly plantedArm?: string | undefined;
  /**
   * The interval the pair registered for its own delta, when it registered one.
   *
   * A control pair does not claim an effect, it claims a *band*: R101 registered `[−7.5, +2.5]pp`
   * around the reference arm and read −5.00pp, which is the arm agreeing with its registration.
   * Grading that with `l4-effect-resolved` asks a significance question the pair never posed — R101
   * came back `UNRESOLVED: |-5.00pp| against 24.27pp minimum detectable difference`, which is true
   * and is not a defect. When a band is present it replaces the resolution question rather than
   * sitting beside it, because two conditions on one gate is how a gate stops saying one thing.
   */
  readonly registeredBand?: { readonly loPp: number; readonly hiPp: number } | undefined;
};

/** Whether an arm planted a distractor. `none` is the control arm's own name for planting nothing. */
function planted(arm: string | undefined): boolean {
  return arm !== undefined && arm !== '' && arm !== 'none';
}

export function pairGates(input: PairGateInput): readonly ValidityGate[] {
  const distractor = planted(input.plantedArm);
  const measured =
    `${input.deltaPp.toFixed(2)}pp (p=${input.p.toFixed(4)}, n=${input.paired}, ` +
    `${String(input.served)} served pack(s)): ${input.state}` +
    (distractor ? `, planted ${String(input.plantedArm)}` : '');

  return [
    // The treatment's finding. Omitted for a distractor arm, whose `HARM` verdict is its registered
    // prediction — reported in the artefact's `comparison` and graded arm by arm by the readback.
    ...(distractor
      ? []
      : [
          {
            id: 'l4-paired',
            criterion: 'the memory does not cost accuracy: neither R45 revert branch fires',
            actual: measured,
            pass: input.state !== 'HARM',
            blocking: true,
          },
          {
            id: 'l4-effect-resolved',
            criterion:
              input.registeredBand === undefined
                ? 'the pair resolves the effect it reports: |delta| >= minimum detectable difference, or no direction is claimed'
                : 'the pair landed inside the interval it registered before the dispatch, which is the only claim a control pair makes',
            actual:
              input.registeredBand !== undefined
                ? `${input.deltaPp.toFixed(2)}pp against the registered band ` +
                  `[${input.registeredBand.loPp.toFixed(2)}, ${input.registeredBand.hiPp.toFixed(2)}]pp` +
                  (input.deltaPp >= input.registeredBand.loPp &&
                  input.deltaPp <= input.registeredBand.hiPp
                    ? ''
                    : ' — outside it, which is a finding about the arm rather than a defect in it')
                : input.state === 'UNRESOLVED'
                  ? `UNRESOLVED: |${input.deltaPp.toFixed(2)}pp| against ${
                      input.detectablePp === undefined
                        ? 'an unestimable'
                        : `${input.detectablePp.toFixed(2)}pp`
                    } minimum detectable difference`
                  : (input.claim ?? input.state),
            // Non-blocking in both readings, and for the same reason: an effect the sample could not
            // resolve and a delta outside its registered band are facts about the arm, and R45's
            // revert rule is the gate that blocks a pair for costing accuracy.
            pass:
              input.registeredBand === undefined
                ? input.state !== 'UNRESOLVED'
                : input.deltaPp >= input.registeredBand.loPp &&
                  input.deltaPp <= input.registeredBand.hiPp,
            blocking: false,
          },
        ]),
    {
      id: 'l4-same-split',
      criterion: 'both arms scored exactly the same tasks',
      actual: `${String(input.onlyFirst)} only in first, ${String(input.onlySecond)} only in second`,
      pass: input.splitMatches,
      blocking: true,
    },
  ];
}

/**
 * The sentence a pair artefact carries about why the treatment's conditions are absent.
 *
 * Undefined when the arm is the treatment, so a reader of any earlier artefact sees the shape it had.
 * A field that says "not planted" on every normal run would be a column nobody reads.
 */
export function plantedBarNote(arm: string | undefined): { readonly planted_arm: string } | undefined {
  return planted(arm) ? { planted_arm: String(arm) } : undefined;
}
