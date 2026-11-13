import { describe, expect, it } from 'vitest';
import {
  GATE_ORDER,
  POWER_TARGET_PP,
  SUBSTRATE_FLOOR,
  buildProtocolGates,
  declaredEmptyVerdict,
  funnelVerdict,
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
  funnel: {
    corrections: 350,
    candidates: 340,
    admitted: 240,
    stored: 240,
    servable: 200,
    refused: 60,
    failed: 5,
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
    // 40 rather than 31: eight transfer ids arrive as arguments to `transferGates` rather than as
    // object keys, and a list that missed them would sort eight published gates to the end. The
    // fortieth is `V0`, which grades the pipeline rather than a number it produced.
    expect(GATE_ORDER).toHaveLength(40);
    expect(new Set(GATE_ORDER).size).toBe(40);
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

/**
 * The half of the input that used to be mandatory, and what the second scenario did to it.
 *
 * These five tests exist because of a measured failure rather than a hypothetical one. The first
 * version of `ProtocolGateInput` made eight fields required, which meant a lane that could not count
 * its recalled items or its agent's calls could not call `buildProtocolGates` **at all** — not even
 * to evaluate the thirty-one gates whose own fields it had. τ², whose agent is another process,
 * could prove four gates and was allowed to publish none. A requirement that turns a partial report
 * into no report is not a standard; it is an all-or-nothing gate on the whole instrument.
 */
describe('a lane is graded on what it can prove, not on what it cannot state', () => {
  /** The minimal input with some fields deleted, which is what an out-of-process lane produces. */
  const without = (...keys: readonly (keyof ProtocolGateInput)[]): ProtocolGateInput => {
    const input: Record<string, unknown> = { ...minimal };
    for (const key of keys) delete input[key];
    return input as unknown as ProtocolGateInput;
  };
  const ids = (input: ProtocolGateInput): readonly string[] =>
    buildProtocolGates(input).map((entry) => entry.id);

  it('omits the pack gate when the lane cannot count what it recalled', () => {
    expect(ids(without('meanPackIds'))).not.toContain('V1-pack-not-empty');
  });

  it('omits the partition gate when the lane cannot show its split', () => {
    expect(ids(without('partition'))).not.toContain('V2-fold-partition');
  });

  it('omits the parse gate when the lane reports no replies', () => {
    expect(ids(without('parseRate'))).not.toContain('V3-parse-rate');
  });

  it('omits the resolution gate when the lane cannot estimate its detectable difference', () => {
    expect(ids(without('detectablePp'))).not.toContain('V5-resolution');
  });

  it("omits the reliability gate when the lane's calls belong to another process", () => {
    expect(ids(without('callFailureRate', 'calls', 'callFailures'))).not.toContain(
      'V8-call-reliability',
    );
  });

  it('still publishes every other gate, which is the point of the change', () => {
    const five = [
      'V1-pack-not-empty',
      'V2-fold-partition',
      'V3-parse-rate',
      'V5-resolution',
      'V8-call-reliability',
    ];
    const published = ids(
      without(
        'meanPackIds',
        'partition',
        'parseRate',
        'detectablePp',
        'callFailureRate',
        'calls',
        'callFailures',
      ),
    );
    // Exactly five gates leave and nothing else moves: the cost of a lane that cannot state those
    // seven fields is five gates, not the whole report.
    expect(published).toEqual(ids(minimal).filter((id) => !five.includes(id)));
    expect(published).toContain('V6-controls-inject');
    expect(published).toContain('V7-channel');
  });

  it('keeps the reliability sentence readable when the rate arrives without its tally', () => {
    // A lane may know the rate and not the counts — a provider that reports failures as a fraction.
    // Printing `(NaN/undefined calls)` beside the rate would make a valid gate look like a bug.
    const gate = buildProtocolGates(without('calls', 'callFailures')).find(
      (entry) => entry.id === 'V8-call-reliability',
    );
    expect(gate?.actual).toBe('0.00%');
  });
});

/**
 * The resolution gate became blocking in stage 2, and this is the arithmetic that forced it.
 *
 * Every one of the seventeen published artefacts that carry `V5-resolution` passes it, at 1.96pp to
 * 4.87pp, so the flag had never been exercised. The first run it would have protected is τ² at
 * n = 68 with 27 discordant pairs, where the minimum detectable difference is 21.41pp against a 6pp
 * bar — a design that could not have seen the effect it went looking for, publishing a delta anyway.
 */
describe('the resolution gate stops a run rather than annotating it', () => {
  it('is blocking', () => {
    const gate = buildProtocolGates(minimal).find((entry) => entry.id === 'V5-resolution');
    expect(gate?.blocking).toBe(true);
  });

  it('fails a design that could not resolve the effect it reports', () => {
    // 68 paired tasks with 27 discordant ones: sqrt(2.802² × 0.3971 / 68) = 0.2141, i.e. 21.41pp.
    const gate = buildProtocolGates({ ...minimal, detectablePp: 21.41 }).find(
      (entry) => entry.id === 'V5-resolution',
    );
    expect(gate?.pass).toBe(false);
  });

  it('passes the published BIRD readings it has always passed', () => {
    // The change is falsifiable in one direction: no committed artefact may change its verdict.
    // These are the two ends of the range the seventeen artefacts occupy.
    for (const detectablePp of [1.96, 4.87]) {
      const gate = buildProtocolGates({ ...minimal, detectablePp }).find(
        (entry) => entry.id === 'V5-resolution',
      );
      expect(gate?.pass).toBe(true);
    }
  });

  /**
   * R52: the gate grades the run's claim, not the scenario's population.
   *
   * `detectablePp <= 6` is unreachable for τ² retail at any n — 9.05pp over all 115 tasks — so the
   * gate was red on every dispatch for a reason no mechanism could fix. The three states of
   * `claimPp` are what replaced it, and the third one is the one that keeps the old condition for
   * every lane that never thought about claims.
   */
  it('passes a run that measured and concluded nothing, at a resolution it cannot narrow', () => {
    const gate = buildProtocolGates({ ...minimal, detectablePp: 9.05, claimPp: null }).find(
      (entry) => entry.id === 'V5-resolution',
    );
    expect(gate?.pass).toBe(true);
    expect(gate?.actual).toBe(
      'minimum detectable 9.05pp against a 6.00pp target; the run claims no direction',
    );
  });

  it('fails a run that claims either direction more finely than its sample can resolve', () => {
    for (const claimPp of [4, -4, 9.04]) {
      const gate = buildProtocolGates({ ...minimal, detectablePp: 9.05, claimPp }).find(
        (entry) => entry.id === 'V5-resolution',
      );
      expect(gate?.pass, String(claimPp)).toBe(false);
    }
  });

  it('passes a claim it could have resolved, and the exact boundary', () => {
    for (const claimPp of [9.05, 12, -20]) {
      const gate = buildProtocolGates({ ...minimal, detectablePp: 9.05, claimPp }).find(
        (entry) => entry.id === 'V5-resolution',
      );
      expect(gate?.pass, String(claimPp)).toBe(true);
    }
  });

  it('keeps the old condition for a lane that reports no claims at all', () => {
    // Absence is not "claimed nothing". A lane that never mentions the question must not pass by
    // omitting it, which is the vacuous pass R50 spent an iteration removing.
    const gate = buildProtocolGates({ ...minimal, detectablePp: 9.05 }).find(
      (entry) => entry.id === 'V5-resolution',
    );
    expect(gate?.pass).toBe(false);
    expect(gate?.actual).toBe(
      'minimum detectable 9.05pp against a 6.00pp target; this lane reports no claims',
    );
  });

  it('refuses a claim made against a resolution the run never estimated', () => {
    const gate = buildProtocolGates({
      ...minimal,
      detectablePp: Number.POSITIVE_INFINITY,
      claimPp: 3,
    }).find((entry) => entry.id === 'V5-resolution');
    expect(gate?.pass).toBe(false);
    expect(gate?.actual).toBe('not estimable: no question changed hands');
  });

  it('names the target it is measuring against, which is the protocol constant', () => {
    const gate = buildProtocolGates({ ...minimal, detectablePp: 9.05, claimPp: null }).find(
      (entry) => entry.id === 'V5-resolution',
    );
    expect(gate?.actual).toContain(`${POWER_TARGET_PP.toFixed(2)}pp target`);
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

/**
 * `V0`: the only gate whose subject is the machine rather than a number the machine produced.
 *
 * Every other gate here grades a reading. A run can pass all of them and have measured nothing —
 * `V1` passes on one rule per question, `V32` passes on a store whose every item was quarantined —
 * and three published rounds were read as "the mechanism does not work" when the stage that had
 * failed was upstream of every gate the report carried. So the funnel is graded for a zero first.
 */
/**
 * The two gates an empty store inverts, and the declaration that inverts them.
 *
 * R93 measured the wrapper-plus-pack arm at `pass^4` 0.700 against 0.725 for τ²'s stock agent, and the
 * two arms differ in two things at once: the pack, and the wrapper that carries it. R101's arm is the
 * wrapper with a store that is empty by construction, and it is only a control if the two gates that
 * exist to catch an empty store neither pass it by accident nor fail it by definition. Both directions
 * are asserted here, because an exemption that only ever passes is the vacuous gate this project keeps
 * finding: a declared-empty arm that carries one item must be refused.
 */
describe('the declared-empty arm', () => {
  const emptyFunnel = { corrections: 0, candidates: 0, admitted: 0, stored: 0, servable: 0 };

  it('is ready only when every stage carried nothing, and names the stage that did not', () => {
    expect(declaredEmptyVerdict(emptyFunnel)).toEqual({
      ready: true,
      reason: 'every stage carried nothing, which is what a declared-empty arm asserts',
    });
    const carried = declaredEmptyVerdict({ ...emptyFunnel, servable: 3 });
    expect(carried.ready).toBe(false);
    expect(carried.reason).toContain('servable stage carried 3');
    expect(carried.reason).toContain('no longer the control');
  });

  it('grades the same zero two opposite ways, depending on who declared it', () => {
    // The identical funnel, read twice: a memory arm that produced nothing has a broken pipeline, and a
    // scaffold arm that produced nothing has done exactly what it was bought to do.
    const undeclared = gate({ ...minimal, funnel: emptyFunnel }, 'V0-instrument-ready');
    expect(undeclared.pass).toBe(false);
    expect(undeclared.criterion).toBe(
      'every stage from a correction to a servable rule carried something, and the stages reconcile',
    );
    const declared = gate(
      { ...minimal, funnel: emptyFunnel, declaredEmptyStore: true },
      'V0-instrument-ready',
    );
    expect(declared.pass).toBe(true);
    expect(declared.criterion).toBe('a declared-empty arm carried nothing at every stage, which is what it declared');
  });

  it('inverts the pack gate, so a scaffold arm that injects a rule fails it', () => {
    const scaffold = gate({ ...minimal, meanPackIds: 0, declaredEmptyStore: true }, 'V1-pack-not-empty');
    expect(scaffold.pass).toBe(true);
    expect(scaffold.criterion).toBe(
      'the scaffold arm injected no rule at all, so what it measures is the wrapper',
    );
    // The arm is no longer the control the moment one rule reaches it, and the gate says so instead of
    // tolerating the difference the way a waiver would.
    expect(gate({ ...minimal, meanPackIds: 1.4, declaredEmptyStore: true }, 'V1-pack-not-empty').pass).toBe(
      false,
    );
    // And the memory arm's own direction is unchanged: absence of the declaration keeps the old reading.
    expect(gate({ ...minimal, meanPackIds: 0 }, 'V1-pack-not-empty').pass).toBe(false);
    expect(gate({ ...minimal, meanPackIds: 1.4 }, 'V1-pack-not-empty').pass).toBe(true);
  });
});

describe('the instrument-readiness gate', () => {
  const withFunnel = (funnel: NonNullable<ProtocolGateInput['funnel']>) =>
    gate({ ...minimal, funnel }, 'V0-instrument-ready');

  it('passes a chain that carried something at every stage', () => {
    const found = withFunnel({ corrections: 32, candidates: 30, admitted: 20, stored: 20, servable: 16 });
    expect(found.pass).toBe(true);
    expect(found.blocking).toBe(true);
    expect(found.actual).toContain('32 correction(s) -> 30 candidate(s) -> 20 admitted -> 20 stored -> 16 servable');
  });

  it('names the refusals beside the chain, so a narrowing is explainable', () => {
    const found = withFunnel({
      corrections: 32,
      candidates: 30,
      admitted: 20,
      stored: 20,
      servable: 16,
      refused: 6,
      failed: 2,
    });
    expect(found.actual).toContain('(6 refused, 2 failed)');
  });

  it('says nothing about refusals when the lane counted none', () => {
    // Absent is not zero: a lane that never counted refusals must not read as a lane that had none.
    const found = withFunnel({ corrections: 4, candidates: 4, admitted: 4, stored: 4, servable: 4 });
    expect(found.actual).not.toContain('refused');
    expect(found.pass).toBe(true);
  });

  it('fails when the learning half had nothing to teach from', () => {
    const found = withFunnel({ corrections: 0, candidates: 0, admitted: 0, stored: 0, servable: 0 });
    expect(found.pass).toBe(false);
    expect(found.actual).toContain('no correctable episode');
  });

  it('fails when every correction produced no candidate', () => {
    const found = withFunnel({ corrections: 32, candidates: 0, admitted: 0, stored: 0, servable: 0 });
    expect(found.pass).toBe(false);
    expect(found.actual).toContain('proposed no candidate');
  });

  it('separates "the model said nothing" from "the parser threw it away"', () => {
    // R56's re-dispatch produced 12 corrections, 0 candidates and 0 failures, and its refusal blamed
    // the interpreter. `candidates` is counted after the parse, so that number cannot tell the two
    // apart — the lane had no count of what the parser dropped, and no count of what it was asked.
    const silent = withFunnel({
      corrections: 12,
      asked: 12,
      dropped: {},
      candidates: 0,
      admitted: 0,
      stored: 0,
      servable: 0,
    });
    expect(silent.pass).toBe(false);
    expect(silent.actual).toContain('answered all 12 event(s) with no claim');
    expect(silent.actual).not.toContain('proposed no candidate');

    const thrownAway = withFunnel({
      corrections: 12,
      asked: 12,
      dropped: { 'unknown-kind': 9, 'statement-too-long': 3, 'empty-statement': 3 },
      candidates: 0,
      admitted: 0,
      stored: 0,
      servable: 0,
    });
    expect(thrownAway.pass).toBe(false);
    expect(thrownAway.actual).toContain('dropped every claim the model wrote');
    // Largest first, and ties broken by name so two runs that dropped the same claims print the same
    // sentence: a reading whose order depends on insertion order is a reading nobody can diff.
    expect(thrownAway.actual).toContain('unknown-kind 9, empty-statement 3, statement-too-long 3');
  });

  it('names the batch when the events never reached the interpreter', () => {
    // A correction the journal never carried is a different break from a model with nothing to say:
    // the first is upstream of every model call, and its sentence has to say so.
    const found = withFunnel({
      corrections: 12,
      asked: 0,
      candidates: 0,
      admitted: 0,
      stored: 0,
      servable: 0,
    });
    expect(found.pass).toBe(false);
    expect(found.actual).toContain('asked about none of them');
  });

  it('reports a partial drop beside the chain without failing on it', () => {
    // Nine of sixteen refused and the store still stands: a drop count is a reading, and a gate that
    // failed on any drop would fail every run whose statement ceiling is real.
    const found = withFunnel({
      corrections: 16,
      asked: 16,
      dropped: { 'statement-too-long': 2 },
      candidates: 14,
      admitted: 14,
      stored: 14,
      servable: 14,
    });
    expect(found.pass).toBe(true);
    expect(found.actual).toContain('2 dropped');
  });

  it('fails when the write path admitted nothing it was offered', () => {
    const found = withFunnel({ corrections: 32, candidates: 30, admitted: 0, stored: 0, servable: 0 });
    expect(found.pass).toBe(false);
    expect(found.actual).toContain('every candidate was refused');
  });

  it('fails when an admission left no item in the store', () => {
    // Reachable through a merge that found its own candidate, so the population question is real:
    // a store that reports nothing after admitting something is a counter that lost an item.
    const found = withFunnel({ corrections: 32, candidates: 30, admitted: 4, stored: 0, servable: 0 });
    expect(found.pass).toBe(false);
    expect(found.actual).toContain('the store holds no item');
  });

  it('fails when items exist and none is reachable by the recall scope', () => {
    const found = withFunnel({ corrections: 32, candidates: 30, admitted: 20, stored: 20, servable: 0 });
    expect(found.pass).toBe(false);
    expect(found.actual).toContain('none is reachable by the recall scope');
  });

  it('fails a chain whose stages do not reconcile, and says why', () => {
    // 40 admitted out of 30 candidates: two counts taken over different populations. That is an
    // instrument defect, and the gate has to be able to say so rather than report the last number.
    const found = withFunnel({ corrections: 32, candidates: 30, admitted: 40, stored: 40, servable: 40 });
    expect(found.pass).toBe(false);
    expect(found.actual).toContain('a stage is larger than the one before it');
    expect(found.actual).toContain('different population');
  });

  it('fails a store holding more items than were admitted', () => {
    const found = withFunnel({ corrections: 32, candidates: 30, admitted: 20, stored: 25, servable: 10 });
    expect(found.pass).toBe(false);
    expect(found.actual).toContain('different population');
  });

  it('fails more servable items than the store holds', () => {
    const found = withFunnel({ corrections: 32, candidates: 30, admitted: 20, stored: 10, servable: 12 });
    expect(found.pass).toBe(false);
    expect(found.actual).toContain('different population');
  });

  it('is absent, not green, when the lane never counted the funnel', () => {
    // Twenty artefacts exist without this field. A default of "ready" would have certified every
    // one of them with a reading nobody took.
    const ids = buildProtocolGates(minimal).map((entry) => entry.id);
    expect(ids).not.toContain('V0-instrument-ready');
  });
});

/**
 * The predicate behind `V0`, held on its own because it has three callers.
 *
 * The gate publishes it, the driver stops a run on it, and a readback returns `NO_MEASUREMENT` from
 * it. Three callers that each decided for themselves would be three definitions of "the pipeline
 * carried something", and the first divergence would be found in a published number.
 */
describe('the funnel verdict', () => {
  const healthy = { corrections: 32, candidates: 30, admitted: 20, stored: 20, servable: 16 };

  it('is ready when every stage carried something and the chain reconciles', () => {
    expect(funnelVerdict(healthy)).toEqual({ ready: true, reason: 'every stage carried something' });
  });

  it('names the stage that stopped, not merely that one did', () => {
    expect(funnelVerdict({ ...healthy, corrections: 0 }).reason).toContain('no correctable episode');
    expect(funnelVerdict({ ...healthy, candidates: 0, admitted: 0, stored: 0, servable: 0 }).reason).toContain(
      'proposed no candidate',
    );
    expect(
      funnelVerdict({ ...healthy, asked: 0, candidates: 0, admitted: 0, stored: 0, servable: 0 }).reason,
    ).toContain('asked about none of them');
    expect(
      funnelVerdict({
        ...healthy,
        asked: 32,
        dropped: { 'empty-statement': 4 },
        candidates: 0,
        admitted: 0,
        stored: 0,
        servable: 0,
      }).reason,
    ).toContain('dropped every claim');
    expect(funnelVerdict({ ...healthy, admitted: 0, stored: 0, servable: 0 }).reason).toContain(
      'every candidate was refused',
    );
    expect(funnelVerdict({ ...healthy, admitted: 4, stored: 0, servable: 0 }).reason).toContain(
      'the store holds no item',
    );
    expect(funnelVerdict({ ...healthy, servable: 0 }).reason).toContain('none is reachable by the recall scope');
  });

  it('is not ready when two counts describe different populations, whatever their size', () => {
    const verdict = funnelVerdict({ ...healthy, candidates: 10 });
    expect(verdict.ready).toBe(false);
    expect(verdict.reason).toContain('different population');
  });

  it('agrees with the gate it feeds', () => {
    // The gate's `pass` is this value: a caller that read one and not the other would be reading two
    // answers to one question, which is the class of defect the funnel was built to expose.
    const gateOf = (funnel: Parameters<typeof funnelVerdict>[0]) =>
      buildProtocolGates({ ...minimal, funnel }).find((entry) => entry.id === 'V0-instrument-ready');
    for (const funnel of [healthy, { ...healthy, servable: 0 }, { ...healthy, stored: 25 }]) {
      expect(gateOf(funnel)?.pass).toBe(funnelVerdict(funnel).ready);
    }
  });
});
