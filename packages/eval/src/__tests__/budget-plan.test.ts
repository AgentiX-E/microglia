import { describe, expect, it } from 'vitest';
import { planBudget, type PriorRun } from '../budget-plan.js';

// R72 as it actually ran: 7,829 questions, two arms, 16,876 calls across five folds.
const r72: PriorRun = { calls: 16_876, questions: 7_829, arms: ['none', 'full'], folds: 5 };

describe('planBudget', () => {
  it('reproduces the rate a registration would otherwise carry in its head', () => {
    const plan = planBudget(r72, { arms: ['none', 'full'] });
    // 16,876 / (7,829 × 2) = 1.0777... calls per question per arm.
    expect(plan.ratePerQuestionArm).toBeCloseTo(1.0778, 4);
    expect(plan.unusable).toBeNull();
    expect(plan.measured).toBe(true);
  });

  it('prices a new arm above what a measured rate would project, because the arm is unmeasured', () => {
    // R74's dispatch. The projection from R72's rate is 27,846 and the run measured 29,609, so the
    // ceiling is what carries the difference — 1.3 × 27,846 = 36,200, which covers it.
    const plan = planBudget(r72, { arms: ['none', 'full', 'loo'] });
    expect(plan.projected).toBe(27_846);
    expect(plan.unmeasured).toEqual(['loo']);
    expect(plan.measured).toBe(false);
    expect(plan.ceiling).toBe(36_200);
    expect(plan.ceiling).toBeGreaterThan(29_609);
  });

  it('equates ceiling and projection only when every arm has been measured', () => {
    const known = planBudget(r72, { arms: ['full'] });
    expect(known.ceiling).toBe(known.projected);
    const unknown = planBudget(r72, { arms: ['full', 'brand-new'] });
    expect(unknown.ceiling).toBeGreaterThan(unknown.projected);
  });

  it('scales the population when the request changes it', () => {
    // A dispatch on minidev's 350 questions with the same arms costs a twenty-second of train.
    const plan = planBudget(r72, { arms: ['none', 'full'], questions: 350 });
    expect(plan.projected).toBe(Math.ceil((350 * 2 * (16_876 / (7_829 * 2)) * 110) / 100));
  });

  it('carries the in-run forecast\'s own headroom rather than a second opinion about it', () => {
    // 110% is what `forecastBudget` applies between folds. A registration that budgeted at 100% would
    // be planning for a lane that does not retry.
    const plan = planBudget(r72, { arms: ['none', 'full'] });
    const bare = Math.ceil(7_829 * 2 * plan.ratePerQuestionArm);
    expect(plan.projected).toBeGreaterThan(bare);
    expect(plan.projected).toBeLessThanOrEqual(bare * 1.1 + 1);
  });

  it('refuses to price a prior that measured nothing, and says which number was missing', () => {
    for (const [prior, reason] of [
      [{ ...r72, calls: 0 }, 'no-calls'],
      [{ ...r72, questions: 0 }, 'no-questions'],
      [{ ...r72, arms: [] }, 'no-arms'],
    ] as const) {
      const plan = planBudget(prior, { arms: ['none', 'full'] });
      expect(plan.unusable).toBe(reason);
      expect(plan.projected).toBe(0);
      expect(plan.ceiling).toBe(0);
    }
  });

  it('refuses a request that asks for no arms or no questions', () => {
    expect(planBudget(r72, { arms: [], questions: 100 }).unusable).toBe('no-arms');
    expect(planBudget(r72, { arms: ['full'], questions: 0 }).unusable).toBe('no-questions');
  });

  it('still names the unmeasured arms when the prior is unusable', () => {
    // The caller prints the reason and the arms together: "cannot price this, and the arm to blame
    // would have been this one" is a more useful line than either half.
    const plan = planBudget({ ...r72, calls: 0 }, { arms: ['none', 'loo'] });
    expect(plan.unmeasured).toEqual(['loo']);
  });

  it('is a pure function of its arguments, so two registrations cannot disagree', () => {
    expect(planBudget(r72, { arms: ['none', 'full', 'loo'] })).toEqual(
      planBudget(r72, { arms: ['none', 'full', 'loo'] }),
    );
  });

  it('keeps the projection integral so the ceiling is a number a dispatch form accepts', () => {
    const plan = planBudget({ calls: 7, questions: 3, arms: ['a'], folds: 2 }, { arms: ['a', 'b'] });
    expect(Number.isInteger(plan.projected)).toBe(true);
    expect(Number.isInteger(plan.ceiling)).toBe(true);
  });

  it('honours an explicit safety and unmeasured multiple', () => {
    const plan = planBudget(r72, { arms: ['none', 'new'], safetyPct: 100, unmeasuredPct: 150 });
    const bare = Math.ceil(7_829 * 2 * plan.ratePerQuestionArm);
    expect(plan.projected).toBe(bare);
    expect(plan.ceiling).toBe(Math.ceil(bare * 1.5));
  });
});

describe('planBudget counting draws rather than arms', () => {
  // R68, as it actually went: a prior of two five-draw sampling arms and a request of three of them.
  const r73: PriorRun = { calls: 3_165, questions: 350, arms: ['none', 'full', 'sample-5-first', 'sample-5-assert'], folds: 5 };
  const draws = { none: 1, full: 1, 'sample-5-first': 5, 'sample-5-assert': 5, 'sample-5-exec': 5, 'sample-5-oracle': 5 };

  it('charges a five-draw arm five times what a plain arm costs', () => {
    // The weights apply to the prior as well, which is the whole point: a plan priced with two
    // denominators is a ratio between two different measurements.
    const plain = planBudget(r73, { arms: ['none', 'full'], weights: draws });
    const sampled = planBudget(r73, { arms: ['none', 'full', 'sample-5-first'], weights: draws });
    // Two draws in the first, seven in the second.
    expect(sampled.projected / plain.projected).toBeCloseTo(3.5, 1);
  });

  it('reproduces the improvement over the draw-blind projection that R68 paid for', () => {
    // Blind: 350 × 4 arms × the per-arm rate = 4,179, and the run needed 5,638 — 35% short.
    // Counted: 350 × 16 draws × the per-draw rate = 4,642 — 18% short, and the 130% ceiling covers it.
    const plan = planBudget(r73, {
      arms: ['none', 'sample-5-first', 'sample-5-exec', 'sample-5-oracle'],
      weights: draws,
    });
    expect(plan.projected).toBe(4_642);
    expect(plan.ceiling).toBeGreaterThan(5_638);
  });

  it('prices the prior with the same weights as the request, or the rate is measured against a lie', () => {
    // A prior with twelve draws' worth of arms and a denominator of four would report a rate three
    // times too high, and every later projection would inherit the error.
    const plan = planBudget(r73, { arms: ['none', 'full'], weights: draws });
    expect(plan.ratePerQuestionArm).toBeCloseTo(3_165 / (350 * 12), 6);
  });

  it('treats an absent or nonsense weight as one call rather than as free', () => {
    const plan = planBudget(r73, { arms: ['none', 'full', 'mystery'], weights: { none: 1, full: 1, mystery: 0 } });
    const blind = planBudget(r73, { arms: ['none', 'full', 'mystery'] });
    expect(plan.projected).toBe(blind.projected);
    expect(plan.projected).toBeGreaterThan(0);
  });
});
