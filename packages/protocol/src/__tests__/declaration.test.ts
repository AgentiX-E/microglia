/**
 * The declaration tests, written as the three readings a control arm can produce.
 *
 * R101's registration named two gates to invert and the run failed three more (§34.128). The repair
 * is not a longer list: each gate says what it reads where it is built, and the arm's declaration
 * decides the disposition of the whole set at once. These tests are the three sentences that
 * disposition has to make true, and they are written as a decision table rather than gate by gate
 * because a table of ids is the defect the module removes:
 *
 * | declaration | store | the gates that read it | why |
 * |---|---|---|---|
 * | declared empty | zero | **green** | the zero is the arm agreeing with its declaration |
 * | declared empty | non-zero | **red** | the declaration and the run disagree |
 * | not declared | zero | **red** | an empty store nobody declared is the defect `V0` exists for |
 *
 * A module that passed all three would be a module that passes anything, so the middle row is the
 * one that makes the other two mean something.
 */
import { describe, expect, it } from 'vitest';
import {
  GATE_ORDER,
  buildProtocolGates,
  buildProtocolGatesWithScope,
  scopeGates,
  storeReading,
  subjectOf,
  type ProtocolGateInput,
  type ScenarioGateInput,
  type ValidityGate,
} from '../index.js';

/** Every optional field present, so the store-reading half of the catalogue is at its widest. */
const populated: ProtocolGateInput & ScenarioGateInput = {
  meanPackIds: 2.4,
  partition: { evaluated: 350, total: 350, duplicated: 0, leaked: 0 },
  parseRate: 1,
  detectablePp: 5.5,
  packControls: [{ arm: 'gated', meanPackIds: 2.1 }],
  channelBest: { arm: 'oracle', deltaPp: 32 },
  callFailureRate: 0,
  calls: 1750,
  callFailures: 0,
  domainOrigin: { storedWithDomain: 120, storedWithoutDomain: 0, unscopedIn: 0, widenedIn: 0 },
  learning: { rows: 350, unanswered: 0, edited: 350, distillFailed: 0 },
  packConditions: { injected: 300, withCondition: 90 },
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
  dose: { arm: 'one', prompts: 350, overBudget: 0, differsFromFull: 210, questions: 350 },
  admission: {
    arm: 'accepted',
    control: 'one',
    folds: [{ fold: 1, floor: 0.2, kept: 200, total: 350, helped: 30, harmed: 10, reason: 'fitted' }],
    admitted: 200,
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

/**
 * The same run, on an arm that declares its store empty.
 *
 * Every field a store could fill is zero and every gate that reads one has an empty population to
 * read. The transfer block is left populated on purpose: R101 carried `18 informative trial(s), 11
 * repair(s)` on its declared-empty arm, from the reference half of the pair, and a fixture that
 * zeroed them would not be the case the module was written for.
 */
const declaredEmpty: ProtocolGateInput & ScenarioGateInput = {
  ...populated,
  meanPackIds: 0,
  // No pack-based control exists on an arm that serves no pack.
  packControls: [],
  domainOrigin: { storedWithDomain: 0, storedWithoutDomain: 0, unscopedIn: 0, widenedIn: 0 },
  learning: { rows: 0, unanswered: 0, edited: 0, distillFailed: 0 },
  packConditions: { injected: 0, withCondition: 0 },
  probe: {
    rules: 0,
    kept: 0,
    noVerifiedSource: 0,
    brokeItsSource: 0,
    unsupported: 0,
    packDiffers: 0,
    questions: 350,
  },
  probeRepair: {
    rules: 0,
    kept: 0,
    noVerifiedSource: 0,
    brokeItsSource: 0,
    unsupported: 0,
    packDiffers: 0,
    questions: 350,
  },
  clearance: {
    arm: 'cleared',
    control: 'dose',
    questions: 350,
    mismatched: 0,
    identical: 350,
    dropped: 0,
    meanCleared: 0,
    meanControl: 0,
  },
  raw: { arm: 'raw', cells: 0, verbatim: 0, skipped: 0 },
  dose: { arm: 'one', prompts: 350, overBudget: 0, differsFromFull: 0, questions: 350 },
  admission: {
    arm: 'accepted',
    control: 'one',
    folds: [],
    admitted: 0,
    questions: 350,
  },
  funnel: {
    corrections: 0,
    candidates: 0,
    admitted: 0,
    stored: 0,
    servable: 0,
    refused: 0,
    failed: 0,
  },
  declaredEmptyStore: true,
};

const failures = (gates: readonly ValidityGate[]): string[] =>
  gates.filter((gate) => !gate.pass).map((gate) => gate.id);

describe('a declaration decides the disposition of the gates that read a store', () => {
  it('reads a declared-empty arm that carried nothing as agreeing with its declaration', () => {
    const { gates, omitted } = buildProtocolGatesWithScope(declaredEmpty);
    // Nothing red, anywhere. Before this module R101 was red on three gates and one of them blocked.
    expect(failures(gates)).toEqual([]);
    // The gates are still *there* — inverted, not waived. A report that dropped them would be the
    // silence §34.124 refused.
    const ids = gates.map((gate) => gate.id);
    expect(ids).toContain('V1-pack-not-empty');
    expect(ids).toContain('V44-domain-accounted');
    // And the ones with no subject are named rather than dropped.
    expect(omitted.map((entry) => entry.id)).toContain('V16-transfer-resolvable');
  });

  it('refuses a declared-empty arm that carried anything, which is what makes the inversion falsifiable', () => {
    const { gates } = buildProtocolGatesWithScope({ ...declaredEmpty, meanPackIds: 1.4 });
    const pack = gates.find((gate) => gate.id === 'V1-pack-not-empty');
    expect(pack?.pass).toBe(false);
    // Blocking, and not the gate's own flag: a run that contradicts its own strongest claim has no
    // numbers worth reading.
    expect(pack?.blocking).toBe(true);
    expect(pack?.actual).toContain('the declaration and the run disagree');
  });

  it('refuses an empty store that nobody declared', () => {
    // The same counts, read by an arm that made no claim about them. `V0` and `V1` are the two gates
    // this case existed for before the module; the rest are the three R101 found plus their
    // neighbours, and all of them have to stay red here or the table above proves nothing.
    const { gates } = buildProtocolGatesWithScope({ ...declaredEmpty, declaredEmptyStore: undefined });
    const red = failures(gates);
    for (const id of [
      'V0-instrument-ready',
      'V1-pack-not-empty',
      'V12-shape-present',
      'V14-probe-applied',
      'V44-domain-accounted',
      'V45-clearance-dose-matched',
      'V46-raw-is-verbatim',
      'V49-dose-truncated',
      'V50-admission-engaged',
    ]) {
      expect(red).toContain(id);
    }
  });

  it('leaves an arm that declared nothing byte-identical to what it published before', () => {
    // The declaration must cost an ordinary arm nothing: same ids, same sentences, same order.
    const scoped = buildProtocolGatesWithScope(populated);
    expect(scoped.omitted).toEqual([]);
    expect(JSON.stringify(scoped.gates)).toBe(JSON.stringify(buildProtocolGates(populated)));
  });

  it('grades a declared-empty arm on the gates that are about the run rather than the store', () => {
    // `V3-parse-rate` reads replies, not the store; it is the arm's own property and stays as it was.
    const { gates } = buildProtocolGatesWithScope(declaredEmpty);
    const parse = gates.find((gate) => gate.id === 'V3-parse-rate');
    expect(parse?.pass).toBe(true);
    expect(parse?.criterion).not.toContain('declared its store empty');
  });
});

describe('the set is derived from each gate, not listed by the registration', () => {
  it('marks every gate that reads a store, and each of them states its own empty form', () => {
    const { gates } = buildProtocolGatesWithScope(populated);
    const storeGates = gates.filter((gate) => subjectOf(gate) === 'store').map((gate) => gate.id);
    // The catalogue, not a registration: these are the gates whose numbers the store itself
    // supplies. A gate added to `gates.ts` without a `storeReading` call is invisible here, which is
    // why the next test exists.
    expect(storeGates.sort()).toEqual(
      [
        'V13-probe-reconciles',
        'V14-probe-applied',
        'V32-fold-learning-intact',
        'V37-repair-probe-reconciles',
        'V38-repair-probe-applied',
        'V44-domain-accounted',
        'V50-admission-engaged',
      ].sort(),
    );
    // Every one of them is in the publication order, so a derived set cannot silently publish last.
    for (const id of storeGates) expect(GATE_ORDER).toContain(id);
  });

  it('marks the gates that read the pack the store fills, which the declaration reaches the same way', () => {
    // Four more depend on the store through the pack rather than directly: an arm that served no
    // rule has an empty pack, and each of these reads how full it was. They are a separate subject
    // because the sentence differs — "the pack carried nothing" is not "the store held nothing" —
    // and both are inverted by the same declaration.
    const { gates } = buildProtocolGatesWithScope(populated);
    const packGates = gates.filter((gate) => subjectOf(gate) === 'pack').map((gate) => gate.id);
    expect(packGates.sort()).toEqual(
      [
        'V12-shape-present',
        'V1-pack-not-empty',
        'V45-clearance-dose-matched',
        'V46-raw-is-verbatim',
        'V49-dose-truncated',
        'V6-controls-inject',
      ].sort(),
    );
    for (const id of packGates) expect(GATE_ORDER).toContain(id);
  });

  it('marks the pack and trial gates too, which is how a declaration reaches them', () => {
    const { gates } = buildProtocolGatesWithScope(populated);
    expect(subjectOf(gates.find((gate) => gate.id === 'V1-pack-not-empty') as ValidityGate)).toBe('pack');
    expect(subjectOf(gates.find((gate) => gate.id === 'V16-transfer-resolvable') as ValidityGate)).toBe(
      'trial',
    );
    expect(subjectOf(gates.find((gate) => gate.id === 'V3-parse-rate') as ValidityGate)).toBe('run');
  });

  it('refuses to grade a store gate that never said what its empty form is', () => {
    // A gate somebody will add next month: it reads the store, it does not state its null, and the
    // harness has to say so rather than grade it against a population of zero. The symbol is the
    // module's own — `Symbol.for` is the registry, so a test can stand in for a future gate.
    const unstated: ValidityGate = {
      id: 'V99-store-reading',
      criterion: 'a gate that reads a store nobody asked it about',
      actual: '0 of 0',
      pass: true,
      blocking: true,
    };
    Object.defineProperty(unstated, Symbol.for('microglia.gate.subject'), {
      value: 'store',
      enumerable: false,
    });
    expect(() => scopeGates([unstated], { declaredEmptyStore: true })).toThrow(
      /declares no empty form/,
    );
    // On an arm that declared nothing it is graded as it stands, which is every arm that came before.
    expect(scopeGates([unstated], { declaredEmptyStore: false }).gates).toEqual([unstated]);
  });

  it('keeps the reason an omission is an omission', () => {
    const { omitted } = buildProtocolGatesWithScope(declaredEmpty);
    const transfer = omitted.find((entry) => entry.id === 'V16-transfer-resolvable');
    expect(transfer?.reason).toContain('presupposes a rule');
    // Eight transfer ids, one pack-control gate: the omissions are counted rather than inferred from
    // an absence, which is the difference between a record and a silence.
    expect(omitted).toHaveLength(9);
  });

  it('says the inversion once, so a gate cannot phrase its own zero as a pass', () => {
    const { gates } = buildProtocolGatesWithScope(declaredEmpty);
    const inverted = gates.filter((gate) => gate.criterion.includes('declared its store empty'));
    expect(inverted.length).toBeGreaterThan(0);
    for (const gate of inverted) {
      expect(gate.blocking).toBe(true);
      expect(gate.actual).toContain('declared empty, so this must be 0');
    }
  });
});

describe('storeReading is the only way to say a gate reads a store', () => {
  it('carries the form without changing the published shape of the gate', () => {
    const gate: ValidityGate = {
      id: 'V98',
      criterion: 'c',
      actual: 'a',
      pass: true,
      blocking: false,
    };
    const marked = storeReading(gate, { kind: 'null', measure: 0, reading: 'nothing' });
    // The marker is a non-enumerable symbol: an artefact is compared byte for byte, and a gate that
    // serialised its own bookkeeping would have rewritten thirty-one committed reports.
    expect(JSON.stringify(marked)).toBe(JSON.stringify(gate));
    expect(subjectOf(marked)).toBe('store');
  });
});
