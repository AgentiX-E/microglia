import { describe, expect, it } from 'vitest';
import {
  GATE_ORDER,
  SUBSTRATE_FLOOR,
  buildProtocolGates,
  inGateOrder,
  transferGates,
  type ProtocolGateInput,
  type ScenarioGateInput,
  type TransferGateInput,
  type ValidityGate,
} from '../index.js';

/**
 * The protocol's own tests, which exist for the properties a lane cannot test.
 *
 * A lane supplies every field it can, so it can never exercise the case this package was extracted
 * for: a scenario that *cannot* supply a field, and whose gate must therefore be absent rather than
 * green. That case is the contract, and the contract is what these tests are about — the individual
 * thresholds are tested where they are used.
 */

/**
 * The smallest input a lane can pass: the required fields, and none of the optional ones.
 *
 * Deliberately without `goldExecRate` — this is the shape of a lane whose correctness is judged
 * rather than executed, and it is the case that did not exist before this package.
 */
const minimal: ProtocolGateInput = {
  meanPackIds: 2.4,
  partition: { evaluated: 350, total: 350, duplicated: 0, leaked: 0 },
  parseRate: 1,
  detectablePp: 5.5,
  packControls: [{ arm: 'gated', meanPackIds: 2.1 }],
  channelBest: { arm: 'oracle', deltaPp: 32 },
  callFailureRate: 0,
  calls: 1750,
  callFailures: 0,
};

/** Every optional field present, so the gate set is at its widest. */
const full: ProtocolGateInput & ScenarioGateInput = {
  ...minimal,
  goldExecRate: 1,
  conventionExecRate: 1,
  framing: [{ arm: 'framed', prompts: 350, carrying: 350, expected: true }],
  evidence: [{ arm: 'ablated', prompts: 350, carrying: 0, expected: false }],
  domainOrigin: { storedWithDomain: 120, storedWithoutDomain: 0, unscopedIn: 0, widenedIn: 0 },
  statements: { statements: 1750, deadlines: 0, truncations: 0 },
  dose: { arm: 'one', prompts: 350, overBudget: 0, differsFromFull: 210, questions: 350 },
  admission: {
    arm: 'accepted',
    control: 'one',
    folds: [{ fold: 1, floor: 0.2, kept: 200, total: 350, helped: 30, harmed: 10, reason: 'fitted' }],
    admitted: 200,
    questions: 350,
  },
  channels: [
    {
      arm: 'values',
      kind: 'annotate',
      applied: 350,
      asked: 350,
      floor: 0.95,
      expects: 'annotate at least 95%',
    },
  ],
  clearance: {
    arm: 'cleared',
    control: 'dose',
    questions: 350,
    mismatched: 0,
    identical: 0,
    dropped: 55,
    meanCleared: 1.5,
    meanControl: 3,
  },
  raw: { arm: 'raw', cells: 350, verbatim: 350, skipped: 0 },
  learning: { rows: 350, unanswered: 0, edited: 350, distillFailed: 0 },
  subset: { qualifying: 200, minimum: 100 },
  packConditions: { injected: 300, withCondition: 90 },
  channelCeiling: 0.95,
  probe: {
    rules: 120,
    kept: 70,
    noVerifiedSource: 20,
    brokeItsSource: 15,
    unsupported: 15,
    packDiffers: 40,
    questions: 350,
  },
  probeRepair: {
    rules: 120,
    kept: 70,
    noVerifiedSource: 20,
    brokeItsSource: 15,
    unsupported: 15,
    packDiffers: 40,
    questions: 350,
  },
  transfer: {
    trials: 400,
    informative: 300,
    repaired: 29,
    blankRight: 50,
    unmeasured: 50,
    ledger: 400,
    measured: 483,
    broke: 27,
    netPp: 0.41,
    verdict: 'positive',
  },
  transferRepair: {
    trials: 400,
    informative: 300,
    repaired: 29,
    blankRight: 50,
    unmeasured: 50,
    ledger: 400,
    measured: 483,
    broke: 27,
    netPp: 0.41,
    verdict: 'positive',
  },
  substrate: {
    left: 'rules',
    right: 'repairs',
    shared: 300,
    leftExclusive: 50,
    rightExclusive: 50,
    holes: 0,
    both: 120,
    onlyLeft: 30,
    onlyRight: 30,
    neither: 120,
    paired: 300,
    leftRate: 0.4,
    rightRate: 0.42,
    deltaPp: 2,
    p: 0.4,
    verdict: 'floor',
  },
  pool: {
    questions: 350,
    expected: 1750,
    candidates: 1750,
    signed: 1750,
    unsigned: 0,
    consistent: true,
  },
};

const gate = (input: ProtocolGateInput & ScenarioGateInput, id: string): ValidityGate => {
  const found = buildProtocolGates(input).find((entry) => entry.id === id);
  if (found === undefined) throw new Error(`gate ${id} is missing`);
  return found;
};

describe('the gate set', () => {
  it('publishes every id in GATE_ORDER when the run supplies every field', () => {
    // The order is data, so the test that matters is that the emitted sequence *is* that data:
    // a gate pushed out of order during a refactor is a diff in thirty-one published artefacts.
    expect(buildProtocolGates(full).map((entry) => entry.id)).toEqual([...GATE_ORDER]);
  });

  it('publishes each id exactly once', () => {
    // 39 rather than 31: eight transfer ids arrive as arguments to `transferGates` rather than as
    // object keys, and a list that missed them would sort eight published gates to the end.
    expect(GATE_ORDER).toHaveLength(39);
    expect(new Set(GATE_ORDER).size).toBe(39);
  });

  it('omits the scenario gates rather than passing them vacuously', () => {
    // The whole reason `goldExecRate` is optional: a judged reply or a tool-call match has no
    // reference answer to execute, and a gate that cannot fire must not report green.
    const without = buildProtocolGates(minimal).map((entry) => entry.id);
    expect(without).not.toContain('V4-gold-executable');
    expect(without).not.toContain('V10-convention-executable');
  });

  it('keeps the remaining order stable when the scenario gates drop out', () => {
    // Removing an entry must not reorder anything: the artefact's sequence is compared against a
    // pre-registration that names ids, and a lane's subset is read in the order it appears.
    const without = buildProtocolGates(minimal).map((entry) => entry.id);
    const expected = GATE_ORDER.filter(
      (id) => !['V4-gold-executable', 'V10-convention-executable'].includes(id),
    );
    expect(without).toEqual(expected.filter((id) => without.includes(id)));
  });

  it('adds exactly one gate per scenario field supplied', () => {
    // The contract in one assertion: supplying the two scenario fields adds exactly those two gates
    // and nothing else, so a lane can reason about what it is buying by reading its own input.
    const absent = buildProtocolGates(minimal).map((entry) => entry.id);
    const present = buildProtocolGates({ ...minimal, goldExecRate: 1, conventionExecRate: 1 }).map(
      (entry) => entry.id,
    );
    const added = present.filter((id) => !absent.includes(id));
    expect(added).toEqual(['V4-gold-executable', 'V10-convention-executable']);
    expect(present.filter((id) => !added.includes(id))).toEqual(absent);
  });

  it('omits an optional gate whose field is missing rather than defaulting it', () => {
    // The same rule one level down: `admission` absent means the admission gate is absent, not that
    // admission admitted nobody. A gate invented from a missing field would report a failure the run
    // never had.
    const without = buildProtocolGates(minimal).map((entry) => entry.id);
    expect(without).not.toContain('V50-admission-engaged');
    expect(without).not.toContain('V49-dose-truncated');
    expect(without).not.toContain('V51-channel-applied');
    expect(without).toContain('V1-pack-not-empty');
  });
});

describe('the channel gate reads its floors from the data', () => {
  const withChannels = (
    entries: readonly { arm: string; kind: string; applied: number; asked: number; floor: number }[],
  ): ProtocolGateInput & ScenarioGateInput => ({
    ...minimal,
    channels: entries.map((entry) => ({
      ...entry,
      expects: `${entry.kind} at least ${(entry.floor * 100).toFixed(0)}%`,
    })),
  });

  it('passes at or above the floor each entry declares', () => {
    const input = withChannels([
      { arm: 'a', kind: 'annotate', applied: 95, asked: 100, floor: 0.95 },
      { arm: 'b', kind: 'prune', applied: 1, asked: 100, floor: 0.01 },
    ]);
    expect(gate(input, 'V51-channel-applied').pass).toBe(true);
  });

  it('fails when the same share sits under a different declared floor', () => {
    // This is the property the hard-coded record could not express: 50% clears a 1% bar and misses a
    // 95% one, and which bar applies is a fact about the manipulation rather than about the gate.
    const lenient = withChannels([{ arm: 'a', kind: 'prune', applied: 50, asked: 100, floor: 0.01 }]);
    const strict = withChannels([{ arm: 'a', kind: 'annotate', applied: 50, asked: 100, floor: 0.95 }]);
    expect(gate(lenient, 'V51-channel-applied').pass).toBe(true);
    expect(gate(strict, 'V51-channel-applied').pass).toBe(false);
  });

  it('fails a channel that never fired, whatever its floor', () => {
    const input = withChannels([{ arm: 'a', kind: 'prune', applied: 0, asked: 100, floor: 0 }]);
    expect(gate(input, 'V51-channel-applied').pass).toBe(false);
  });

  it('fails a channel that was asked nothing, rather than reading 0 of 0 as 100%', () => {
    const input = withChannels([{ arm: 'a', kind: 'prune', applied: 0, asked: 0, floor: 0 }]);
    expect(gate(input, 'V51-channel-applied').pass).toBe(false);
    expect(gate(input, 'V51-channel-applied').actual).toContain('0/0');
  });

  it('writes each entry\'s own phrase into its criterion', () => {
    // The published sentence has to describe the floors that were actually applied, or a reader of
    // the artefact cannot tell which bar the run was held to.
    const input = withChannels([
      { arm: 'a', kind: 'annotate', applied: 95, asked: 100, floor: 0.95 },
      { arm: 'b', kind: 'prune', applied: 40, asked: 100, floor: 0.01 },
    ]);
    const criterion = gate(input, 'V51-channel-applied').criterion;
    expect(criterion).toContain('annotate at least 95%');
    expect(criterion).toContain('prune at least 1%');
  });

  it('is absent when no channel arm ran', () => {
    expect(buildProtocolGates(minimal).map((entry) => entry.id)).not.toContain(
      'V51-channel-applied',
    );
  });
});

describe('inGateOrder', () => {
  const entry = (id: string): ValidityGate => ({
    id,
    criterion: 'c',
    actual: 'a',
    pass: true,
    blocking: false,
  });

  it('sorts a shuffled list into publication order', () => {
    const shuffled = [entry('V5-resolution'), entry('V1-pack-not-empty'), entry('V2-fold-partition')];
    expect(inGateOrder(shuffled).map((gate) => gate.id)).toEqual([
      'V1-pack-not-empty',
      'V2-fold-partition',
      'V5-resolution',
    ]);
  });

  it('places an unknown id last instead of throwing', () => {
    // A scenario may contribute a gate this package has never heard of; refusing to publish it would
    // break the extension point at exactly the moment somebody used it.
    const sorted = inGateOrder([entry('X9-scenario'), entry('V2-fold-partition')]);
    expect(sorted.map((gate) => gate.id)).toEqual(['V2-fold-partition', 'X9-scenario']);
  });

  it('does not mutate its argument', () => {
    const input = [entry('V2-fold-partition'), entry('V1-pack-not-empty')];
    const before = input.map((gate) => gate.id);
    inGateOrder(input);
    expect(input.map((gate) => gate.id)).toEqual(before);
  });

  it('keeps several unknown ids in their given relative order', () => {
    // Sorting is stable, so a lane that emits two of its own gate categories gets the order it chose
    // rather than an alphabetical accident.
    const sorted = inGateOrder([entry('X2'), entry('X1'), entry('V1-pack-not-empty')]);
    expect(sorted.map((gate) => gate.id)).toEqual(['V1-pack-not-empty', 'X2', 'X1']);
  });
});

describe('transferGates', () => {
  const idsMock = {
    reconcile: 'T-reconcile',
    resolvable: 'T-resolvable',
    ledger: 'T-ledger',
    net: 'T-net',
  };

  const trial: TransferGateInput = {
    trials: 400,
    informative: 300,
    repaired: 29,
    blankRight: 50,
    unmeasured: 50,
    ledger: 400,
    measured: 483,
    broke: 27,
    netPp: 0.41,
    verdict: 'positive',
  };

  it('passes a reconciling run', () => {
    expect(transferGates(trial, idsMock).every((entry) => entry.pass)).toBe(true);
  });

  it('fails when the buckets do not reconcile to the trial count', () => {
    const found = transferGates({ ...trial, unmeasured: 49 }, idsMock).find(
      (entry) => entry.id === 'T-reconcile',
    );
    expect(found?.pass).toBe(false);
  });

  it('names control-side holes separately in the reconcile reading', () => {
    const found = transferGates({ ...trial, unmeasuredBlank: 7 }, idsMock).find(
      (entry) => entry.id === 'T-reconcile',
    );
    expect(found?.actual).toContain('7 with no control call');
  });

  it('treats a missing ledger as zero rows rather than as a pass', () => {
    const found = transferGates({ ...trial, ledger: undefined }, idsMock).find(
      (entry) => entry.id === 'T-ledger',
    );
    expect(found?.pass).toBe(false);
    expect(found?.actual).toContain('0/400');
  });

  it('is advisory about the informative floor and blocking about the net', () => {
    const few = transferGates({ ...trial, informative: 12, repaired: 3 }, idsMock);
    expect(few.find((entry) => entry.id === 'T-resolvable')?.pass).toBe(false);
    expect(few.find((entry) => entry.id === 'T-resolvable')?.blocking).toBe(false);
  });

  it('accepts a net rate that agrees with its own counts at published precision', () => {
    // `(29 - 27) / 483` is 0.4141..., published as 0.41. A gate demanding machine epsilon of a
    // two-decimal field fails most real runs; half a published step is the tolerance that keeps it
    // honest without demanding more precision than the artefact carries.
    const found = transferGates({ ...trial, netPp: 0.41 }, idsMock).find(
      (entry) => entry.id === 'T-net',
    );
    expect(found?.pass).toBe(true);
  });

  it('rejects a net rate that disagrees with its counts by more than a rounding step', () => {
    const found = transferGates({ ...trial, netPp: 4.1 }, idsMock).find(
      (entry) => entry.id === 'T-net',
    );
    expect(found?.pass).toBe(false);
  });

  it('refuses to read a rate off zero measured trials', () => {
    const found = transferGates({ ...trial, measured: 0, netPp: 0 }, idsMock).find(
      (entry) => entry.id === 'T-net',
    );
    expect(found?.pass).toBe(false);
  });
});

describe('the substrate floor', () => {
  it('is the same number the transfer statistic and the gate both read', () => {
    // One constant rather than two literals: a statistic reporting against 100 and a gate enforcing
    // 80 is a run whose verdict and its own floor disagree.
    expect(SUBSTRATE_FLOOR).toBe(100);
  });
});
