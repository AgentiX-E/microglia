import { describe, expect, it } from 'vitest';
import { pairGates, plantedBarNote, type PairGateInput } from '../pair-gates.js';

/**
 * The pair gates belong to the arm whose hypothesis they state.
 *
 * R57's `far` arm measured `pass^4` 0.5789 against a published 0.575 with a paired ledger of nine
 * broken and nine repaired episodes — net zero — and the L4 step concluded `failure` because the
 * treatment's published bar was applied to a distractor. The sample gates were repaired for that; the
 * second place the same bar lives is here, where `l4-paired` would fail a planted arm the moment its
 * registered prediction (harm) came true, and where `l4-effect-resolved` would grade a claim the arm
 * never makes.
 */

const treatment: PairGateInput = {
  state: 'BENEFIT',
  claim: '+5.26pp, above a 4.00pp minimum detectable difference',
  deltaPp: 5.26,
  p: 0.031,
  paired: 57,
  served: 57,
  detectablePp: 4,
  splitMatches: true,
  onlyFirst: 0,
  onlySecond: 0,
};

function ids(gates: readonly { id: string }[]): string[] {
  return gates.map((gate) => gate.id);
}

describe('a treatment pair', () => {
  it('carries the finding gate and the resolution report', () => {
    const gates = pairGates(treatment);
    expect(ids(gates)).toEqual(['l4-paired', 'l4-effect-resolved', 'l4-same-split']);
    expect(gates.every((gate) => gate.pass)).toBe(true);
  });

  it('blocks when the memory cost accuracy', () => {
    // The finding gate is the R45 revert rule: a significant negative delta is a harm, and a lane that
    // published one has published the thing the rule exists to stop.
    const gates = pairGates({ ...treatment, state: 'HARM', deltaPp: -8, p: 0.002 });
    const paired = gates.find((gate) => gate.id === 'l4-paired');
    expect(paired?.pass).toBe(false);
    expect(paired?.blocking).toBe(true);
  });

  it('reports an unresolvable pair without blocking on it', () => {
    // An unresolvable effect is a fact about the sample, and `V5-resolution` already blocks on it from
    // the protocol's side; a second blocking copy would print the same red line twice.
    const gates = pairGates({
      ...treatment,
      state: 'UNRESOLVED',
      claim: null,
      deltaPp: 1.02,
      detectablePp: 14.59,
    });
    const resolved = gates.find((gate) => gate.id === 'l4-effect-resolved');
    expect(resolved?.pass).toBe(false);
    expect(resolved?.blocking).toBe(false);
    expect(resolved?.actual).toContain('14.59pp');
  });

  it('says an unestimable resolution is unestimable rather than printing NaN', () => {
    const gates = pairGates({
      ...treatment,
      state: 'UNRESOLVED',
      claim: null,
      detectablePp: undefined,
    });
    expect(gates.find((gate) => gate.id === 'l4-effect-resolved')?.actual).toContain('an unestimable');
  });

  it('falls back to the state when a resolved verdict carries no sentence', () => {
    // A verdict that reports a direction but composes no claim still has to fill the `actual` field:
    // an empty one reads as a gate that measured nothing.
    const gates = pairGates({ ...treatment, claim: null });
    expect(gates.find((gate) => gate.id === 'l4-effect-resolved')?.actual).toBe('BENEFIT');
  });

  it('always grades the split, because a pair on two splits is not a pair', () => {
    const gates = pairGates({ ...treatment, splitMatches: false, onlyFirst: 3, onlySecond: 1 });
    const split = gates.find((gate) => gate.id === 'l4-same-split');
    expect(split?.pass).toBe(false);
    expect(split?.blocking).toBe(true);
    expect(split?.actual).toBe('3 only in first, 1 only in second');
  });
});

describe('a planted distractor pair', () => {
  const planted: PairGateInput = { ...treatment, plantedArm: 'near', state: 'HARM', deltaPp: -3.5 };

  it('drops the treatment bar, whose hypothesis is not this arm`s', () => {
    // `near` predicts it breaks more episodes than it repairs. A pair verdict of `HARM` is that
    // prediction confirmed, and the gate that reads it as a defect would turn the arm being right into
    // a red job — the seventh instance of one defect class (AUDIT 34.86).
    expect(ids(pairGates(planted))).toEqual(['l4-same-split']);
  });

  it('keeps the split gate, which is about the two files rather than about either arm', () => {
    const gates = pairGates({ ...planted, splitMatches: false });
    expect(gates.find((gate) => gate.id === 'l4-same-split')?.pass).toBe(false);
  });

  it('names the distractor in the note the artefact carries, so the omission has a reason', () => {
    expect(plantedBarNote('near')).toEqual({ planted_arm: 'near' });
    // Undefined for the treatment: a field that said "not planted" on every normal run is a column
    // nobody reads, and every artefact before R57 would grow one.
    expect(plantedBarNote(undefined)).toBeUndefined();
    // `none` is the control arm's own name for planting nothing, and the census writes it.
    expect(plantedBarNote('none')).toBeUndefined();
    expect(plantedBarNote('')).toBeUndefined();
  });

  it('still reports the verdict it measured, in the artefact rather than in a gate', () => {
    // The gate is omitted; the number is not. `comparison` and `verdict` are written either way, and
    // `r57_readback.py` grades the plant census and the ledger from them.
    expect(pairGates(planted).some((gate) => gate.id === 'l4-paired')).toBe(false);
  });
});
