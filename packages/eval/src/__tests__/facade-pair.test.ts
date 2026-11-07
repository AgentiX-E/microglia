import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  FACADE_PAIR_ENV,
  facadeArmTasks,
  facadePairVerdict,
  facadeScope,
  resolveFacadePairPlan,
  storeFingerprintOf,
  treatmentDelivered,
  facadePairState,
  facadePairSummary,
  pairedFacadeArtifact,
  readFacadePairArtifact,
  type FacadePairPlan,
  type PairedFacadeReading,
} from '../facade-pair.js';
import { AS_IS_FLOOR } from '../tau2-recall-floor.js';
import { COVERAGE_FLOORS } from '../tau2-use-census.js';
import type { PassAtKInput } from '../passk.js';
import type { RunScope, WithinRunPairVerdict } from '../within-run-pair.js';

/**
 * The R49 paired-facade contract, against committed R47/R48 readings.
 *
 * R48 compared two DISPATCHES and called the difference a floor effect. The
 * production invariant `within-run-pair.ts` refuses such a comparison; this
 * module is the layer that turns a dispatch environment and a single driver run
 * into the two `FacadeArm`s that invariant grades. Everything here is pure:
 * the driver owns the subprocesses, and the CI job owns the network. A test
 * therefore exercises the real resolution, mapping and refusal logic on real
 * committed data, with no stand-in for the code under test.
 */
const FIXTURE = join(process.cwd(), 'eval/fixtures/tau2-r49-facade-pair.json');
const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8')) as {
  readonly r48: {
    readonly run: string;
    readonly prereg: string;
    readonly floor: number;
    readonly store: string;
    readonly memoryPass4: number;
    readonly referencePass4: number;
    readonly recallServed: number;
    readonly l4Paired: { readonly deltaPp: number; readonly p: number; readonly paired: number };
    readonly revertRuleFired: boolean;
  };
  readonly r47: { readonly run: string; readonly store: string; readonly recallServed: number };
  readonly identityControl: {
    readonly dispatchId: string;
    readonly preregId: string;
    readonly storeStatements: readonly string[];
    readonly learnSplit: readonly string[];
    readonly testSplit: readonly string[];
    readonly seed: number;
    readonly trials: number;
    readonly model: string;
    readonly servedPacks: number;
    readonly tasks: readonly { readonly id: string; readonly successes: number; readonly trials: number }[];
  };
};

const control = fixture.identityControl;
const tasks: readonly PassAtKInput[] = control.tasks.map((row) => ({
  taskId: row.id,
  successes: row.successes,
  trials: row.trials,
  k: 4,
}));

function scopeOf(): RunScope {
  return facadeScope({
    dispatchId: control.dispatchId,
    preregId: control.preregId,
    storeStatements: control.storeStatements,
    learnSplit: control.learnSplit,
    testSplit: control.testSplit,
    seed: control.seed,
    trials: control.trials,
    model: control.model,
  });
}

function planOf(): Extract<FacadePairPlan, { enabled: true }> {
  const plan = resolveFacadePairPlan({ [FACADE_PAIR_ENV]: 'true', TAU_MIN_COVERAGE: '0.01' });
  if (!plan.enabled) throw new Error('the registered plan must be enabled');
  return plan;
}

function verdictOf(
  overrides: {
    readonly asIsTasks?: readonly PassAtKInput[];
    readonly flooredTasks?: readonly PassAtKInput[];
    readonly asIsServed?: number;
    readonly flooredServed?: number;
    readonly asIsScope?: RunScope;
    readonly flooredScope?: RunScope;
  } = {},
): WithinRunPairVerdict {
  return facadePairVerdict({
    plan: planOf(),
    asIs: {
      scope: overrides.asIsScope ?? scopeOf(),
      tasks: overrides.asIsTasks ?? tasks,
      servedPacks: overrides.asIsServed ?? control.servedPacks,
    },
    floored: {
      scope: overrides.flooredScope ?? scopeOf(),
      tasks: overrides.flooredTasks ?? tasks,
      servedPacks: overrides.flooredServed ?? control.servedPacks,
    },
  });
}

describe('resolveFacadePairPlan', () => {
  it('leaves every dispatch before R49 on the single-facade path', () => {
    for (const value of [undefined, '', '   ', '0', 'false', 'FALSE', ' off ', 'no']) {
      expect(resolveFacadePairPlan({ [FACADE_PAIR_ENV]: value })).toEqual({
        enabled: false,
        reason: 'no paired-facade dispatch was registered',
      });
    }
  });

  it('enables the pair from every declared spelling of the switch', () => {
    for (const value of ['1', 'true', 'TRUE', ' on ', 'as-is-floored', 'AS-IS-FLOORED']) {
      const plan = resolveFacadePairPlan({ [FACADE_PAIR_ENV]: value, TAU_MIN_COVERAGE: '0.01' });
      expect(plan).toEqual({ enabled: true, asIsFloor: AS_IS_FLOOR, flooredFloor: 0.01 });
    }
  });

  it('reads the floored rung from the registered recall floor, not from the switch', () => {
    for (const rung of COVERAGE_FLOORS.filter((value) => value > AS_IS_FLOOR)) {
      const plan = resolveFacadePairPlan({
        [FACADE_PAIR_ENV]: 'true',
        TAU_MIN_COVERAGE: String(rung),
      });
      expect(plan).toEqual({ enabled: true, asIsFloor: AS_IS_FLOOR, flooredFloor: rung });
    }
  });

  it('refuses an enabled pair with no registered floor', () => {
    expect(() => resolveFacadePairPlan({ [FACADE_PAIR_ENV]: 'true' })).toThrow(/TAU_MIN_COVERAGE/);
    expect(() => resolveFacadePairPlan({ [FACADE_PAIR_ENV]: 'true', TAU_MIN_COVERAGE: '  ' })).toThrow(
      /TAU_MIN_COVERAGE/,
    );
  });

  it('refuses an as-is floor as the treatment: a pair needs two different rungs', () => {
    expect(() =>
      resolveFacadePairPlan({ [FACADE_PAIR_ENV]: 'true', TAU_MIN_COVERAGE: '0' }),
    ).toThrow(/strictly above/);
  });

  it('refuses a floor that is not a rung of the registered grid', () => {
    expect(() =>
      resolveFacadePairPlan({ [FACADE_PAIR_ENV]: 'true', TAU_MIN_COVERAGE: '0.07' }),
    ).toThrow(/TAU_MIN_COVERAGE/);
    expect(() =>
      resolveFacadePairPlan({ [FACADE_PAIR_ENV]: 'true', TAU_MIN_COVERAGE: 'NaN' }),
    ).toThrow(/TAU_MIN_COVERAGE/);
  });

  it('refuses a value the dispatch menu never declared', () => {
    expect(() => resolveFacadePairPlan({ [FACADE_PAIR_ENV]: 'maybe' })).toThrow(/TAU_FACADE_PAIR/);
    expect(() => resolveFacadePairPlan({ [FACADE_PAIR_ENV]: '2' })).toThrow(/TAU_FACADE_PAIR/);
  });

  it('uses R48\'s registered floor as the real treatment rung', () => {
    const plan = resolveFacadePairPlan({
      [FACADE_PAIR_ENV]: 'true',
      TAU_MIN_COVERAGE: String(fixture.r48.floor),
    });
    expect(plan).toEqual({ enabled: true, asIsFloor: 0, flooredFloor: fixture.r48.floor });
  });
});

describe('facadeArmTasks', () => {
  it('maps per-task pass^4 inputs onto paired outcomes', () => {
    expect(facadeArmTasks(tasks)).toEqual([
      { id: 'retail/101', passedAll: true },
      { id: 'retail/102', passedAll: false },
      { id: 'retail/103', passedAll: true },
      { id: 'retail/104', passedAll: false },
    ]);
  });

  it('counts a task as passed only when every trial passed', () => {
    expect(
      facadeArmTasks([
        { taskId: 'a', successes: 3, trials: 4, k: 4 },
        { taskId: 'b', successes: 4, trials: 4, k: 4 },
        { taskId: 'c', successes: 0, trials: 0, k: 4 },
      ]),
    ).toEqual([
      { id: 'a', passedAll: false },
      { id: 'b', passedAll: true },
      { id: 'c', passedAll: true },
    ]);
  });

  it('refuses a task the reader could not name rather than inventing an id', () => {
    expect(() => facadeArmTasks([{ successes: 4, trials: 4, k: 4 }])).toThrow(/task id/);
  });

  it('refuses duplicate ids, because a paired test needs one row per task', () => {
    expect(() =>
      facadeArmTasks([
        { taskId: 'a', successes: 4, trials: 4, k: 4 },
        { taskId: 'a', successes: 0, trials: 4, k: 4 },
      ]),
    ).toThrow(/duplicate/);
  });

  it('refuses a negative or non-finite trial count', () => {
    expect(() => facadeArmTasks([{ taskId: 'a', successes: 1, trials: -1, k: 4 }])).toThrow(/trials|trial count/i);
    expect(() =>
      facadeArmTasks([{ taskId: 'a', successes: 1, trials: Number.NaN, k: 4 }]),
    ).toThrow(/trials|trial count/i);
  });

  it('keeps the empty set empty so the pair can report NO_MEASUREMENT', () => {
    expect(facadeArmTasks([])).toEqual([]);
  });
});

describe('storeFingerprintOf', () => {
  it('is deterministic and order independent over the one distilled store', () => {
    expect(storeFingerprintOf(control.storeStatements)).toBe(
      storeFingerprintOf([...control.storeStatements].reverse()),
    );
  });

  it('changes when the store changes, which is what separates two learnings', () => {
    expect(storeFingerprintOf(control.storeStatements)).not.toBe(
      storeFingerprintOf([...control.storeStatements, 'A tenth rule learned on another day.']),
    );
  });

  it('distinguishes the two documented R47 and R48 stores', () => {
    expect(storeFingerprintOf([fixture.r47.store])).not.toBe(storeFingerprintOf([fixture.r48.store]));
  });

  it('names the empty store distinctly rather than throwing', () => {
    expect(storeFingerprintOf([])).toMatch(/^store:/);
    expect(storeFingerprintOf([])).not.toBe(storeFingerprintOf(['one']));
  });

  it('emits a stable, printable digest', () => {
    expect(storeFingerprintOf(control.storeStatements)).toMatch(/^store:[0-9a-f]{8}$/);
  });
});

describe('facadeScope', () => {
  it('attests all eight fields the within-run invariant compares', () => {
    expect(scopeOf()).toEqual({
      dispatchId: control.dispatchId,
      preregId: control.preregId,
      storeFingerprint: storeFingerprintOf(control.storeStatements),
      learnSplit: control.learnSplit,
      testSplit: control.testSplit,
      seed: control.seed,
      trials: control.trials,
      model: control.model,
    });
  });

  it('copies the splits so a later mutation cannot rewrite the attestation', () => {
    const learnSplit = ['retail/001'];
    const scope = facadeScope({
      dispatchId: 'd',
      preregId: 'p',
      storeStatements: ['one distilled rule'],
      learnSplit,
      testSplit: ['retail/002'],
      seed: 300,
      trials: 4,
      model: 'deepseek/deepseek-chat',
    });
    learnSplit.push('retail/999');
    expect(scope.learnSplit).toEqual(['retail/001']);
  });

  it('refuses an empty dispatch, registration or store attestation at the source', () => {
    const base = {
      dispatchId: control.dispatchId,
      preregId: control.preregId,
      storeStatements: control.storeStatements,
      learnSplit: control.learnSplit,
      testSplit: control.testSplit,
      seed: control.seed,
      trials: control.trials,
      model: control.model,
    };
    expect(() => facadeScope({ ...base, dispatchId: '  ' })).toThrow(/dispatchId/);
    expect(() => facadeScope({ ...base, preregId: '' })).toThrow(/preregId/);
    expect(() => facadeScope({ ...base, model: '' })).toThrow(/model/);
    expect(() => facadeScope({ ...base, storeStatements: [] })).toThrow(/store/);
  });

  it('refuses a non-finite seed or a non-positive trial count', () => {
    const base = {
      dispatchId: control.dispatchId,
      preregId: control.preregId,
      storeStatements: control.storeStatements,
      learnSplit: control.learnSplit,
      testSplit: control.testSplit,
      model: control.model,
    };
    expect(() => facadeScope({ ...base, seed: Number.NaN, trials: 4 })).toThrow(/seed/);
    expect(() => facadeScope({ ...base, seed: 300, trials: 0 })).toThrow(/trials|trial count/i);
    expect(() => facadeScope({ ...base, seed: 300, trials: 1.5 })).toThrow(/trials|trial count/i);
  });
});

describe('facadePairVerdict', () => {
  it('grades the structural identity control as a valid paired reading with zero delta', () => {
    const verdict = verdictOf();
    expect(verdict.state).toBe('PAIRED');
    if (verdict.state !== 'PAIRED') return;
    expect(verdict.contrast.kind).toBe('facade-contrast');
    expect(verdict.contrast.floor).toBe(fixture.r48.floor);
    expect(verdict.contrast.comparison.deltaPp).toBe(0);
    expect(verdict.contrast.comparison.paired).toBe(control.tasks.length);
    expect(verdict.contrast.servedPacks).toEqual({
      asIs: control.servedPacks,
      floored: control.servedPacks,
    });
  });

  it('never grades a pair whose two facades learned in different dispatches', () => {
    const r48Scope = facadeScope({
      dispatchId: fixture.r48.run,
      preregId: fixture.r48.prereg,
      storeStatements: [fixture.r48.store],
      learnSplit: control.learnSplit,
      testSplit: control.testSplit,
      seed: control.seed,
      trials: control.trials,
      model: control.model,
    });
    const verdict = verdictOf({ flooredScope: r48Scope });
    expect(verdict.state).toBe('REFUSED_CROSS_RUN');
    if (verdict.state === 'PAIRED') return;
    expect(verdict.reason).toMatch(/dispatchId|storeFingerprint/);
  });

  it('refuses the real R47/R48 store change even with identical declared inputs', () => {
    const r47Scope = scopeOf();
    const r48Scope = { ...r47Scope, storeFingerprint: storeFingerprintOf([fixture.r48.store]) };
    expect(verdictOf({ asIsScope: r47Scope, flooredScope: r48Scope }).state).toBe('REFUSED_CROSS_RUN');
  });

  it('reports NO_MEASUREMENT when one facade scored nothing', () => {
    expect(verdictOf({ flooredTasks: [] }).state).toBe('NO_MEASUREMENT');
    expect(verdictOf({ asIsTasks: [] }).state).toBe('NO_MEASUREMENT');
  });

  it('reports NO_MEASUREMENT when the two facades did not score the same tasks', () => {
    const shorter = tasks.slice(0, 2);
    expect(verdictOf({ flooredTasks: shorter }).state).toBe('NO_MEASUREMENT');
  });

  it('still pairs a floor that served nothing, and says so in the reading', () => {
    const verdict = verdictOf({ flooredServed: 0 });
    expect(verdict.state).toBe('PAIRED');
    if (verdict.state !== 'PAIRED') return;
    expect(verdict.contrast.servedPacks.floored).toBe(0);
    expect(verdict.reason).toMatch(/delivered 0 packs/);
  });

  it('refuses to produce a contrast when the plan is not enabled', () => {
    const verdict = facadePairVerdict({
      plan: { enabled: false, reason: 'no paired-facade dispatch was registered' },
      asIs: { scope: scopeOf(), tasks, servedPacks: control.servedPacks },
      floored: { scope: scopeOf(), tasks, servedPacks: control.servedPacks },
    });
    expect(verdict.state).toBe('NO_MEASUREMENT');
  });

  it('exposes a real contribution instead of R48\'s cross-run -6.00pp artifact', () => {
    const verdict = verdictOf({
      flooredTasks: tasks.map((task) =>
        task.taskId === 'retail/102' ? { ...task, successes: 4 } : task,
      ),
    });
    expect(verdict.state).toBe('PAIRED');
    if (verdict.state !== 'PAIRED') return;
    expect(verdict.contrast.comparison.gained).toBe(1);
    expect(verdict.contrast.comparison.deltaPp).toBeGreaterThan(0);
    expect(verdict.contrast.comparison.deltaPp).not.toBe(fixture.r48.l4Paired.deltaPp);
    expect(verdict.contrast.kind).not.toBe('l4-paired');
  });
});

describe('treatmentDelivered', () => {
  it('is true only for a paired reading whose floored facade served at least one pack', () => {
    expect(treatmentDelivered(verdictOf())).toBe(true);
    expect(treatmentDelivered(verdictOf({ flooredServed: 0 }))).toBe(false);
  });

  it('is false for every terminal state other than PAIRED', () => {
    expect(treatmentDelivered(verdictOf({ flooredTasks: [] }))).toBe(false);
    const crossRun = verdictOf({
      flooredScope: { ...scopeOf(), dispatchId: fixture.r48.run },
    });
    expect(crossRun.state).toBe('REFUSED_CROSS_RUN');
    expect(treatmentDelivered(crossRun)).toBe(false);
  });

  it('does not let R48\'s served 965 packs certify a refused pair', () => {
    const crossRun = verdictOf({
      flooredScope: { ...scopeOf(), storeFingerprint: storeFingerprintOf([fixture.r48.store]) },
      flooredServed: fixture.r48.recallServed,
    });
    expect(crossRun.state).toBe('REFUSED_CROSS_RUN');
    expect(treatmentDelivered(crossRun)).toBe(false);
  });
});

describe('PairedFacadeReading and its readback', () => {
  function readingOf(
    verdict: WithinRunPairVerdict = verdictOf(),
    flooredServed = control.servedPacks,
  ): PairedFacadeReading {
    return {
      dispatchId: control.dispatchId,
      preregId: control.preregId,
      floors: { asIs: AS_IS_FLOOR, floored: fixture.r48.floor },
      scope: scopeOf(),
      servedPacks: { asIs: control.servedPacks, floored: flooredServed },
      pass4: { asIs: 0.5, floored: 0.5 },
      verdict,
      treatmentDelivered: treatmentDelivered(verdict),
      seed: control.seed,
      model: control.model,
    };
  }

  it('states PAIRED with the interval, p-value, paired count and delivered population', () => {
    const line = facadePairSummary(readingOf());
    expect(line).toMatch(/^PAIRED:/);
    expect(line).toMatch(/delta 0\.00pp/);
    expect(line).toMatch(/p=1\.0000/);
    expect(line).toMatch(/n=4/);
    expect(line).toMatch(/served 4\/4/);
    expect(line).toMatch(/delivered=true/);
  });

  it('says delivered=false for a paired reading whose floor served nothing', () => {
    expect(facadePairSummary(readingOf(verdictOf({ flooredServed: 0 }), 0))).toMatch(/delivered=false/);
  });

  it('names REFUSED_CROSS_RUN without quoting any delta', () => {
    const refused = verdictOf({ flooredScope: { ...scopeOf(), dispatchId: fixture.r48.run } });
    const line = facadePairSummary(readingOf(refused));
    expect(line).toMatch(/^REFUSED_CROSS_RUN:/);
    expect(line).not.toMatch(/delta/);
    expect(line).not.toMatch(/revert/);
  });

  it('names NO_MEASUREMENT without quoting any delta', () => {
    const line = facadePairSummary(readingOf(verdictOf({ flooredTasks: [] })));
    expect(line).toMatch(/^NO_MEASUREMENT:/);
    expect(line).not.toMatch(/delta/);
  });

  it('never reproduces R48\'s cross-run -6.00pp as a floor contribution', () => {
    expect(facadePairSummary(readingOf())).not.toContain('-6.00pp');
    expect(facadePairSummary(readingOf())).not.toContain(String(fixture.r48.l4Paired.deltaPp));
  });

  it('exposes exactly the three terminal states the workflow may gate on', () => {
    expect(facadePairState(readingOf())).toBe('PAIRED');
    expect(
      facadePairState(readingOf(verdictOf({ flooredScope: { ...scopeOf(), dispatchId: 'other' } }))),
    ).toBe('REFUSED_CROSS_RUN');
    expect(facadePairState(readingOf(verdictOf({ flooredTasks: [] })))).toBe('NO_MEASUREMENT');
  });
});

describe('the paired-facade artefact and its readback', () => {
  const RAN_AT = '2026-11-07T13:00:00.000Z';

  function artifact(verdict: WithinRunPairVerdict = verdictOf()) {
    const reading: PairedFacadeReading = {
      dispatchId: control.dispatchId,
      preregId: control.preregId,
      floors: { asIs: AS_IS_FLOOR, floored: fixture.r48.floor },
      scope: scopeOf(),
      servedPacks: { asIs: control.servedPacks, floored: control.servedPacks },
      pass4: { asIs: 0.5, floored: 0.5 },
      verdict,
      treatmentDelivered: treatmentDelivered(verdict),
      seed: control.seed,
      model: control.model,
    };
    return pairedFacadeArtifact(reading, RAN_AT);
  }

  it('writes a flat document whose state and summary agree with the verdict', () => {
    const document = artifact();
    expect(document.id).toBe('poc-l4-facade-pair');
    expect(document.ranAt).toBe(RAN_AT);
    expect(document.state).toBe('PAIRED');
    expect(document.summary).toBe(facadePairSummary({ ...document, verdict: document.verdict }));
    expect(document.scope.storeFingerprint).toBe(storeFingerprintOf(control.storeStatements));
    expect(document.floors).toEqual({ asIs: 0, floored: fixture.r48.floor });
    expect(document.notes).toHaveLength(5);
  });

  it('round-trips a PAIRED artefact into a readback with the full interval', () => {
    const back = readFacadePairArtifact(artifact());
    expect(back.state).toBe('PAIRED');
    expect(back.paired).toBe(control.tasks.length);
    expect(back.deltaPp).toBe(0);
    expect(back.p).toBe(1);
    expect(back.ciLowPp).toBe(0);
    expect(back.ciHighPp).toBe(0);
    expect(back.treatmentDelivered).toBe(true);
    expect(back.floor).toBe(fixture.r48.floor);
    expect(back.servedPacks).toEqual({ asIs: 4, floored: 4 });
  });

  it('gives the two non-measurement states no delta, p-value or paired count', () => {
    const refused = verdictOf({ flooredScope: { ...scopeOf(), dispatchId: 'another-run' } });
    for (const verdict of [refused, verdictOf({ flooredTasks: [] })]) {
      const back = readFacadePairArtifact(artifact(verdict));
      expect(['REFUSED_CROSS_RUN', 'NO_MEASUREMENT']).toContain(back.state);
      expect(back.paired).toBeNull();
      expect(back.deltaPp).toBeNull();
      expect(back.p).toBeNull();
      expect(back.ciLowPp).toBeNull();
      expect(back.ciHighPp).toBeNull();
    }
  });

  it('refuses a document that is not an object', () => {
    for (const value of [null, 42, 'PAIRED', []]) {
      expect(() => readFacadePairArtifact(value === null ? null : value)).not.toThrow(
        /Cannot read/,
      );
      if (typeof value === 'number' || typeof value === 'string') {
        expect(() => readFacadePairArtifact(value)).toThrow(/not an object/);
      }
    }
    expect(() => readFacadePairArtifact(null)).toThrow(/not an object/);
  });

  it('refuses a missing or unrecognised terminal state rather than defaulting', () => {
    expect(() => readFacadePairArtifact({ ...artifact(), state: undefined })).toThrow(/terminal state/);
    expect(() => readFacadePairArtifact({ ...artifact(), state: 'GREEN' })).toThrow(/terminal state/);
    expect(() => readFacadePairArtifact({ ...artifact(), state: 1 })).toThrow(/terminal state/);
  });

  it('refuses a document that lost a field the readback must attest', () => {
    const complete = artifact();
    for (const key of ['summary', 'floors', 'servedPacks', 'verdict', 'treatmentDelivered']) {
      const broken: Record<string, unknown> = { ...complete };
      delete broken[key];
      expect(() => readFacadePairArtifact(broken)).toThrow(/missing a field/i);
    }
  });

  it('refuses a PAIRED document with no contrast or no numeric comparison', () => {
    const complete = artifact();
    const noContrast = {
      ...complete,
      verdict: { state: 'PAIRED', reason: 'x' },
    };
    expect(() => readFacadePairArtifact(noContrast)).toThrow(/contrast/);
    const noComparison = {
      ...complete,
      verdict: { ...complete.verdict, contrast: { kind: 'facade-contrast' } },
    };
    expect(() => readFacadePairArtifact(noComparison)).toThrow(/comparison/);
    const badNumbers = {
      ...complete,
      verdict: {
        ...complete.verdict,
        contrast: { ...(complete.verdict as { contrast: object }).contrast, comparison: {} },
      },
    };
    expect(() => readFacadePairArtifact(badNumbers)).toThrow(/PAIRED comparison needs/);
  });

  it('never lets R48\'s cross-run -6.00pp appear in an artefact or a readback', () => {
    const document = artifact();
    expect(JSON.stringify(document)).not.toContain('-6.00pp');
    expect(readFacadePairArtifact(document).deltaPp).toBe(0);
  });
});
