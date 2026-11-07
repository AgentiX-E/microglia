import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  PAIR_RESAMPLES,
  PAIR_SEED,
  scopeDifference,
  withinRunPair,
  type FacadeArm,
  type RunScope,
} from '../within-run-pair.js';
import { COVERAGE_FLOORS } from '../tau2-use-census.js';
import { AS_IS_FLOOR } from '../tau2-recall-floor.js';

/**
 * Defect 29 as a runtime invariant.
 *
 * R48 measured U3 by comparing its floored memory arm with R47's as-is arm.
 * They were two dispatches: 8 vs 12 distilled items and a memory-free
 * reference that drifted from 0.30 to 0.44. The `-6.00pp` therefore could not
 * be attributed to the floor. The next arm must be a WITHIN-RUN pair, and this
 * module refuses every reading that is not one.
 *
 * The real committed R47/R48 readings drive the cross-run cases. The identity
 * control is a structural counterpart, explicitly not a measurement: it proves
 * the invariant admits a valid pair without inventing an experimental result.
 */
const FIXTURE = join(process.cwd(), 'eval/fixtures/tau2-facade-scopes.json');
const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8')) as {
  readonly description: string;
  readonly r47: {
    readonly run: string;
    readonly prereg: string;
    readonly store: string;
    readonly referencePass4: number;
    readonly recallServed: number;
    readonly l4Paired: { readonly scope: string; readonly deltaPp: number; readonly p: number; readonly paired: number };
  };
  readonly r48: {
    readonly run: string;
    readonly prereg: string;
    readonly store: string;
    readonly referencePass4: number;
    readonly recallServed: number;
    readonly l4Paired: { readonly scope: string; readonly deltaPp: number; readonly p: number; readonly paired: number };
  };
  readonly identityControl: {
    readonly dispatchId: string;
    readonly preregId: string;
    readonly storeFingerprint: string;
    readonly learnSplit: readonly string[];
    readonly testSplit: readonly string[];
    readonly seed: number;
    readonly trials: number;
    readonly model: string;
    readonly servedPacks: number;
    readonly tasks: readonly { readonly id: string; readonly passedAll: boolean }[];
  };
};

const ic = fixture.identityControl;
const scope = (): RunScope => ({
  dispatchId: ic.dispatchId,
  preregId: ic.preregId,
  storeFingerprint: ic.storeFingerprint,
  learnSplit: [...ic.learnSplit],
  testSplit: [...ic.testSplit],
  seed: ic.seed,
  trials: ic.trials,
  model: ic.model,
});
const tasks = () => ic.tasks.map((task) => ({ ...task }));

const arm = (kind: 'as-is' | 'floored', overrides: Partial<FacadeArm> = {}): FacadeArm => ({
  arm: kind,
  floor: kind === 'as-is' ? AS_IS_FLOOR : 0.01,
  scope: scope(),
  servedPacks: ic.servedPacks,
  tasks: tasks(),
  ...overrides,
});

const pair = (overrides: Partial<FacadeArm> = {}, flooredOverrides: Partial<FacadeArm> = {}) =>
  withinRunPair(arm('as-is', overrides), arm('floored', flooredOverrides));

/**
 * A broken instrument is broken on BOTH arms of one run. Changing only one
 * arm's scope is a different defect (a cross-run pair) and is deliberately
 * graded first, so these cases must apply the same scope to both facades.
 */
const pairOnSameScope = (change: Partial<RunScope>) => {
  const shared = { ...scope(), ...change } as RunScope;
  return withinRunPair(arm('as-is', { scope: shared }), arm('floored', { scope: shared }));
};

describe('the committed readings that make a cross-run pair invalid', () => {
  it('R47 and R48 really are different dispatches with different stores', () => {
    expect(fixture.r47.run).not.toBe(fixture.r48.run);
    expect(fixture.r47.store).toBe('R47:8-distilled-items');
    expect(fixture.r48.store).toBe('R48:12-distilled-items');
    expect(fixture.r48.referencePass4 - fixture.r47.referencePass4).toBeCloseTo(0.14, 10);
  });

  it('the within-run gate is a different quantity from a facade contribution', () => {
    expect(fixture.r47.l4Paired.scope).toBe('within-run');
    expect(fixture.r48.l4Paired.scope).toBe('within-run');
    // R48's -6.00pp fired the R45 revert rule on the memory-vs-reference gate.
    // A facade contrast must never be graded by that rule.
    expect(fixture.r48.l4Paired.deltaPp).toBe(-6);
    expect(fixture.r48.l4Paired.p).toBeGreaterThan(0.05);
  });
});

describe('scopeDifference', () => {
  it('returns undefined for one run', () => {
    expect(scopeDifference(scope(), scope())).toBeUndefined();
  });

  const drifts: readonly (readonly [keyof RunScope, unknown])[] = [
    ['dispatchId', 'another-dispatch'],
    ['preregId', 'another-registration'],
    ['storeFingerprint', 'R48:12-distilled-items'],
    ['learnSplit', ['retail/999']],
    ['testSplit', ['airline/999']],
    ['seed', 8],
    ['trials', 5],
    ['model', 'gpt-5.5'],
  ];

  for (const [field, value] of drifts) {
    it(`names '${field}' when only that field drifts`, () => {
      const changed = { ...scope(), [field]: value } as RunScope;
      expect(scopeDifference(scope(), changed)).toBe(field);
      expect(scopeDifference(changed, scope())).toBe(field);
    });
  }

  it('compares split contents, not array identity', () => {
    const other = scope();
    expect(scopeDifference(scope(), other)).toBeUndefined();
    expect(scopeDifference(scope(), { ...other, testSplit: [...ic.testSplit, 'airline/004'] })).toBe('testSplit');
  });
});

describe('withinRunPair accepts exactly one run', () => {
  it('pairs the identity control with a zero delta', () => {
    const verdict = pair();
    expect(verdict.state).toBe('PAIRED');
    if (verdict.state !== 'PAIRED') return;
    expect(verdict.contrast.kind).toBe('facade-contrast');
    expect(verdict.contrast.comparison.paired).toBe(ic.tasks.length);
    expect(verdict.contrast.comparison.deltaPp).toBe(0);
    expect(verdict.contrast.comparison.p).toBe(1);
    expect(verdict.contrast.comparison.onlyFirst).toBe(0);
    expect(verdict.contrast.comparison.onlySecond).toBe(0);
    expect(verdict.contrast.floor).toBe(0.01);
    expect(verdict.contrast.servedPacks).toEqual({ asIs: ic.servedPacks, floored: ic.servedPacks });
    expect(verdict.reason).toContain('within-run pair');
  });

  it('keeps the pairing constants identical to l4-pair.ts', () => {
    expect(PAIR_SEED).toBe(7);
    expect(PAIR_RESAMPLES).toBe(10_000);
  });

  it('tags the contribution so revertRule cannot consume it', () => {
    const verdict = pair();
    if (verdict.state !== 'PAIRED') throw new Error('expected a pair');
    // A PairedReading carries `scope`. This contrast deliberately does not.
    expect(verdict.contrast).not.toHaveProperty('scope');
    expect(verdict.contrast.kind).toBe('facade-contrast');
  });

  it('accepts every registered floor rung above zero', () => {
    for (const floor of COVERAGE_FLOORS.filter((rung) => rung > AS_IS_FLOOR)) {
      expect(pair({}, { floor }).state).toBe('PAIRED');
    }
  });
});

describe('withinRunPair refuses two dispatches', () => {
  it('refuses the real R47/R48 scope pair even when the task rows match', () => {
    const asIs = arm('as-is', {
      scope: {
        ...scope(),
        dispatchId: fixture.r47.run,
        preregId: fixture.r47.prereg,
        storeFingerprint: fixture.r47.store,
      },
      servedPacks: fixture.r47.recallServed,
    });
    const floored = arm('floored', {
      scope: {
        ...scope(),
        dispatchId: fixture.r48.run,
        preregId: fixture.r48.prereg,
        storeFingerprint: fixture.r48.store,
      },
      servedPacks: fixture.r48.recallServed,
    });
    const verdict = withinRunPair(asIs, floored);
    expect(verdict.state).toBe('REFUSED_CROSS_RUN');
    if (verdict.state !== 'REFUSED_CROSS_RUN') return;
    expect(verdict.reason).toContain('dispatchId');
    expect(verdict.reason).toContain('cross-run');
  });

  it('refuses a changed store even on one dispatch and one registration', () => {
    const verdict = pair({}, { scope: { ...scope(), storeFingerprint: fixture.r48.store } });
    expect(verdict.state).toBe('REFUSED_CROSS_RUN');
    if (verdict.state !== 'REFUSED_CROSS_RUN') return;
    expect(verdict.reason).toContain('storeFingerprint');
  });

  it('refuses a scope drift before grading a missing measurement', () => {
    const verdict = pair(
      {},
      { scope: { ...scope(), seed: 8 }, tasks: [] },
    );
    expect(verdict.state).toBe('REFUSED_CROSS_RUN');
  });

  it('refuses a mirror case whose cross-run delta looks catastrophic', () => {
    // A large, significant-looking delta is exactly the reading that tempted
    // the R48 readback. Significance must not launder a cross-run comparison.
    const verdict = pair(
      { tasks: tasks().map((task) => ({ ...task, passedAll: true })) },
      {
        scope: { ...scope(), dispatchId: fixture.r48.run },
        tasks: tasks().map((task) => ({ ...task, passedAll: false })),
      },
    );
    expect(verdict.state).toBe('REFUSED_CROSS_RUN');
  });
});

describe('withinRunPair reports no measurement for a broken instrument', () => {
  it('rejects swapped arm labels', () => {
    expect(withinRunPair(arm('floored'), arm('as-is')).state).toBe('NO_MEASUREMENT');
  });

  it('rejects an as-is arm that carries a floor', () => {
    expect(pair({ floor: 0.01 }).state).toBe('NO_MEASUREMENT');
  });

  it('rejects a floored arm at zero', () => {
    expect(pair({}, { floor: AS_IS_FLOOR }).state).toBe('NO_MEASUREMENT');
  });

  it('rejects a floor that is not a registered grid rung', () => {
    expect(pair({}, { floor: 0.07 }).state).toBe('NO_MEASUREMENT');
    expect(pair({}, { floor: 0.0100001 }).state).toBe('NO_MEASUREMENT');
  });

  it('rejects a missing dispatch, registration or store attestation', () => {
    expect(pairOnSameScope({ dispatchId: '  ' }).state).toBe('NO_MEASUREMENT');
    expect(pairOnSameScope({ preregId: '' }).state).toBe('NO_MEASUREMENT');
    expect(pairOnSameScope({ storeFingerprint: '' }).state).toBe('NO_MEASUREMENT');
  });

  it('rejects an empty split, a bad trial count, a missing seed or a missing model', () => {
    expect(pairOnSameScope({ learnSplit: [] }).state).toBe('NO_MEASUREMENT');
    expect(pairOnSameScope({ testSplit: [] }).state).toBe('NO_MEASUREMENT');
    expect(pairOnSameScope({ trials: 0 }).state).toBe('NO_MEASUREMENT');
    expect(pairOnSameScope({ trials: 1.5 }).state).toBe('NO_MEASUREMENT');
    expect(pairOnSameScope({ seed: Number.NaN }).state).toBe('NO_MEASUREMENT');
    expect(pairOnSameScope({ model: '' }).state).toBe('NO_MEASUREMENT');
  });

  it('rejects an invalid served pack count', () => {
    expect(pair({ servedPacks: -1 }).state).toBe('NO_MEASUREMENT');
    expect(pair({}, { servedPacks: Number.NaN }).state).toBe('NO_MEASUREMENT');
  });

  it('accepts a zero served count on the as-is arm without calling it a pair failure', () => {
    // Zero is a valid measurement of a facade that served nothing; the paired
    // population is what decides whether a delta can be quoted.
    expect(pair({ servedPacks: 0 }).state).toBe('PAIRED');
  });

  it('rejects empty, duplicated or mismatched task rows', () => {
    expect(pair({ tasks: [] }).state).toBe('NO_MEASUREMENT');
    expect(pair({ tasks: [...tasks(), { ...tasks()[0]! }] }).state).toBe('NO_MEASUREMENT');
    expect(pair({}, { tasks: tasks().slice(1) }).state).toBe('NO_MEASUREMENT');
    expect(pair({}, { tasks: tasks().map((task, index) => ({ ...task, id: index === 0 ? 'airline/999' : task.id })) }).state).toBe('NO_MEASUREMENT');
  });
});
