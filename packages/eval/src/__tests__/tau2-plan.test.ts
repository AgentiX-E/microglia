import { describe, expect, it } from 'vitest';
import { heldOutPlan, qualifiedId, splitFromOfficial } from '../tau2-plan.js';

/**
 * The plan a cross-domain arm runs on.
 *
 * Two properties matter more than the rest and neither is visible in a run: a held-out task must
 * never be one the store learned from, and a task id must survive the trip between two scenarios
 * that number their tasks independently. τ² names its tasks `0`, `1`, `2` … in every domain, so a
 * plan that carries bare ids across a domain boundary produces an intersection of two unrelated
 * sets, and the projection reads every one of them as a leak.
 */

const base = {
  learnScenario: 'retail',
  testScenario: 'retail',
  trainShare: 0.5,
} as const;

describe('qualifiedId', () => {
  it('names the scenario in front of the task, because the task does not', () => {
    expect(qualifiedId('airline', '12')).toBe('airline/12');
  });

  it('is injective across scenarios for the same raw id', () => {
    // The whole reason this function exists: τ²-retail and τ²-airline both have a task `3`.
    expect(qualifiedId('retail', '3')).not.toBe(qualifiedId('airline', '3'));
  });
});

describe('heldOutPlan on one scenario', () => {
  it('splits the pool deterministically into a train half and a held-out half', () => {
    const plan = heldOutPlan({
      ...base,
      learnIds: ['3', '1', '2', '4'],
      evalIds: ['3', '1', '2', '4'],
    });
    expect(plan.crossDomain).toBe(false);
    expect(plan.train).toEqual(['retail/1', 'retail/2']);
    expect(plan.test).toEqual(['retail/3', 'retail/4']);
  });

  it('keeps the two halves disjoint and complete over the pool', () => {
    const ids = Array.from({ length: 20 }, (_, index) => String(index));
    const plan = heldOutPlan({ ...base, learnIds: ids, evalIds: ids });
    const union = new Set([...plan.train, ...plan.test]);
    expect(plan.train.filter((id) => plan.test.includes(id))).toEqual([]);
    expect(union.size).toBe(20);
  });

  it('applies a cap to each half after the split, not to the pool before it', () => {
    const ids = Array.from({ length: 20 }, (_, index) => String(index).padStart(2, '0'));
    const plan = heldOutPlan({ ...base, learnIds: ids, evalIds: ids, trainCap: 3, evalCap: 2 });
    expect(plan.train).toEqual(['retail/00', 'retail/01', 'retail/02']);
    expect(plan.test).toEqual(['retail/10', 'retail/11']);
  });

  it('treats a cap of zero as no cap, and one larger than the list as no cap either', () => {
    const plan = heldOutPlan({
      ...base,
      learnIds: ['1', '2'],
      evalIds: ['1', '2'],
      trainCap: 0,
      evalCap: 99,
    });
    expect(plan.train).toEqual(['retail/1']);
    expect(plan.test).toEqual(['retail/2']);
  });

  it('refuses a train share that leaves nothing on one side', () => {
    expect(() => heldOutPlan({ ...base, trainShare: 1, learnIds: ['1'], evalIds: ['1'] })).toThrow(
      /strictly between 0 and 1/,
    );
  });
});

describe('heldOutPlan across two scenarios', () => {
  it('learns from one scenario and answers the other, with no split of the evaluated set', () => {
    const plan = heldOutPlan({
      learnScenario: 'retail',
      testScenario: 'airline',
      trainShare: 0.5,
      learnIds: ['5', '6', '7'],
      evalIds: ['1', '2', '3'],
    });
    expect(plan.crossDomain).toBe(true);
    expect(plan.train).toEqual(['retail/5', 'retail/6', 'retail/7']);
    expect(plan.test).toEqual(['airline/1', 'airline/2', 'airline/3']);
    // The share describes a split inside one scenario; across two it has no denominator to act on.
    expect(plan.train).toHaveLength(3);
  });

  it('does not read a colliding raw id as leakage', () => {
    // The defect this test is written against: both scenarios own a task `2`, and a projection that
    // compared bare ids reported the whole evaluated set as leaked into the training half.
    const plan = heldOutPlan({
      learnScenario: 'retail',
      testScenario: 'airline',
      trainShare: 0.5,
      learnIds: ['2'],
      evalIds: ['2'],
    });
    const trained = new Set(plan.train);
    expect(plan.test.filter((id) => trained.has(id))).toEqual([]);
    expect(plan.test).toEqual(['airline/2']);
  });

  it('ignores a train share that is out of range, having no split to apply it to', () => {
    // Validating a knob that the cross-domain path never reads would fail a run over an input it
    // does not use, which is the kind of refusal that teaches a caller to lie about the config.
    const plan = heldOutPlan({
      learnScenario: 'retail',
      testScenario: 'airline',
      trainShare: 1,
      learnIds: ['1', '2'],
      evalIds: ['3', '4'],
    });
    expect(plan.train).toEqual(['retail/1', 'retail/2']);
    expect(plan.test).toEqual(['airline/3', 'airline/4']);
  });

  it('caps the learned side and the evaluated side separately', () => {
    const plan = heldOutPlan({
      learnScenario: 'retail',
      testScenario: 'airline',
      trainShare: 0.5,
      learnIds: ['1', '2', '3', '4'],
      evalIds: ['1', '2', '3', '4'],
      trainCap: 2,
      evalCap: 1,
    });
    expect(plan.train).toEqual(['retail/1', 'retail/2']);
    expect(plan.test).toEqual(['airline/1']);
  });
});

describe('heldOutPlan invariants', () => {
  it('de-duplicates repeated ids rather than paying for the same task twice', () => {
    const plan = heldOutPlan({ ...base, learnIds: ['2', '2', '1'], evalIds: ['1', '2'] });
    expect(plan.train).toEqual(['retail/1']);
    expect(plan.test).toEqual(['retail/2']);
  });

  it('refuses a cap that is not a whole count of tasks', () => {
    expect(() => heldOutPlan({ ...base, learnIds: ['1'], evalIds: ['2'], evalCap: -1 })).toThrow(
      /must be a non-negative integer/,
    );
    expect(() => heldOutPlan({ ...base, learnIds: ['1'], evalIds: ['2'], trainCap: 2.5 })).toThrow(
      /must be a non-negative integer/,
    );
  });

  it('returns an empty test half rather than inventing one, so the caller can refuse the run', () => {
    // A plan that silently promoted a learned task to the held-out half would publish a leak as a
    // measurement; an empty half is the driver's cue to stop.
    const plan = heldOutPlan({ ...base, learnIds: [], evalIds: [] });
    expect(plan.test).toEqual([]);
  });
});

describe('the split the benchmark publishes', () => {
  const ids = ['0', '1', '2', '3', '4', '5'];

  it('is used as it is stated, and the share is not applied on top of it', () => {
    // The defect this replaces: `TRAIN_SHARE = 0.5` cut the corpus itself, so the held-out half was a
    // set the benchmark does not define and no competitor's number was ever measured on it.
    const plan = heldOutPlan({
      ...base,
      learnIds: ids,
      evalIds: ids,
      official: { train: ['0', '1', '2', '3'], test: ['4', '5'] },
    });
    expect(plan.train).toEqual(['retail/0', 'retail/1', 'retail/2', 'retail/3']);
    expect(plan.test).toEqual(['retail/4', 'retail/5']);
    expect(plan.crossDomain).toBe(false);
  });

  it('refuses a published split that names a task this corpus does not hold', () => {
    // A corpus mismatch that a run would otherwise absorb by evaluating fewer tasks than the
    // registration states -- the same defect class as a percentage on an unstated denominator.
    expect(() =>
      heldOutPlan({
        ...base,
        learnIds: ids,
        evalIds: ids,
        official: { train: ['0', '1'], test: ['9'] },
      }),
    ).toThrow(/this corpus does not hold/);
  });

  it('refuses an official split on a transfer arm, where no document states the halves', () => {
    expect(() =>
      heldOutPlan({
        learnIds: ['0', '1'],
        evalIds: ['0', '1'],
        learnScenario: 'airline',
        testScenario: 'retail',
        trainShare: 0.5,
        official: { train: ['0'], test: ['1'] },
      }),
    ).toThrow(/transfer arm has no published halves/);
  });

  it('still applies the caps, because a smoke run is a cap on a split rather than another split', () => {
    const plan = heldOutPlan({
      ...base,
      learnIds: ids,
      evalIds: ids,
      trainCap: 2,
      evalCap: 1,
      official: { train: ['0', '1', '2', '3'], test: ['4', '5'] },
    });
    expect(plan.train).toEqual(['retail/0', 'retail/1']);
    expect(plan.test).toEqual(['retail/4']);
  });
});

describe('splitFromOfficial', () => {
  it('reads the two halves', () => {
    expect(splitFromOfficial({ train: ['0'], test: ['1'] })).toEqual({ train: ['0'], test: ['1'] });
  });

  it('refuses a document that is not an object, or names no half', () => {
    expect(() => splitFromOfficial([])).toThrow(/not an object/);
    expect(() => splitFromOfficial({ train: ['0'] })).toThrow(/names no `test` tasks/);
    expect(() => splitFromOfficial({ train: [], test: ['1'] })).toThrow(/names no `train` tasks/);
  });

  it('refuses a half that is not made of ids', () => {
    expect(() => splitFromOfficial({ train: ['0', 1], test: ['2'] })).toThrow(/not an id/);
    expect(() => splitFromOfficial({ train: [''], test: ['2'] })).toThrow(/not an id/);
  });

  it('refuses a repeated id, because the halves would then be a different size', () => {
    expect(() => splitFromOfficial({ train: ['0', '0'], test: ['1'] })).toThrow(/repeats a `train` task/);
  });

  it('refuses a split whose halves intersect', () => {
    // A leak in the published file would be published as a leak in the run; the plan cannot fix it and
    // must not absorb it.
    expect(() => splitFromOfficial({ train: ['0', '1'], test: ['1', '2'] })).toThrow(/in both halves: 1/);
  });
});
