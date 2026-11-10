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

describe('the learning pass, which does not scale with the question count', () => {
  // R77's first dispatch: 2,000 questions over `none,full,loo` priced at R74's measured 1.0416 calls
  // per question per draw, which came to 6,875 and was authorised at 7,600. Fold 1 spent 1,952 —
  // 1,200 evaluation calls and **700 learning calls** — and the run was refused permission to finish a
  // bill that would have come to about 10,541.
  const r74 = {
    calls: 24_465,
    questions: 7_829,
    arms: ['none', 'full', 'loo'],
    folds: 5,
    learningPerFold: 700,
    // 2,624 of its 3,500 learning requests were answered by the cache.
    learningHitShare: 2_624 / 3_500,
  };

  it('takes the prior learning pass out of the rate it charges per question', () => {
    // The prior's learning cost 876 calls of its 24,465. Charging those 876 to the questions would
    // price the next dispatch's questions at a cost they do not incur.
    const plan = planBudget(r74, { arms: ['none', 'full', 'loo'], questions: 7_829 });
    expect(plan.ratePerQuestionArm).toBeCloseTo((24_465 - 876) / (7_829 * 3), 6);
    expect(plan.ratePerQuestionArm).toBeLessThan(24_465 / (7_829 * 3));
  });

  it('projects the same dispatch onto 2,000 questions and prices its learning separately', () => {
    const plan = planBudget(r74, { arms: ['none', 'full', 'loo'], questions: 2_000, learningPerFold: 700 });
    const marginal = (24_465 - 876) / (7_829 * 3);
    // 1,200 questions per draw at the marginal rate, plus the learning the cache does not answer.
    expect(plan.projected).toBe(Math.ceil(1.1 * (2_000 * 3 * marginal + 700 * 5 * (1 - 2_624 / 3_500))));
    // And the bound is the cold case: every learning request paid in full, with its own headroom.
    expect(plan.ceiling).toBeGreaterThan(plan.projected);
    expect(plan.ceiling).toBeGreaterThanOrEqual(Math.ceil(1.1 * (2_000 * 3 * marginal + 700 * 5)));
    expect(plan.amortisedLearning).toBe(false);
  });

  it('bounds a learning dispatch above the number the run itself will forecast', () => {
    // The run extrapolates the remaining folds at the dearest fold's price, which is the first fold
    // and the one whose cache is cold: 5 × 1,952 ≈ 9,760, and 10,541 with its own safety. A
    // registration sized below that is a registration the ceiling will stop after four fifths of its
    // bill has been paid for one fifth of its data.
    const plan = planBudget(r74, { arms: ['none', 'full', 'loo'], questions: 2_000, learningPerFold: 700 });
    expect(plan.ceiling).toBeGreaterThan(10_541);
  });

  it('says when the projection is still a ratio over a mixture', () => {
    // A prior that states only its total cannot separate the two costs. The projection is then the
    // number that was wrong, and it says so rather than looking like the number that was right.
    const unstated = { ...r74, learningPerFold: undefined, learningHitShare: undefined };
    const plan = planBudget(unstated, { arms: ['none', 'full', 'loo'], questions: 2_000, learningPerFold: 700 });
    expect(plan.amortisedLearning).toBe(true);
    // Nothing to subtract, so the ratio is the whole bill — R77's 6,875.
    expect(plan.projected).toBe(Math.ceil(1.1 * (2_000 * 3 * (24_465 / (7_829 * 3)) + 700 * 5)));
  });

  it('does not claim a mixture when the dispatch does not learn', () => {
    const plan = planBudget(r74, { arms: ['none', 'full'], questions: 1_534 });
    expect(plan.amortisedLearning).toBe(false);
    expect(plan.ceiling).toBe(plan.projected);
  });

  it('clamps a hit share that is not a share', () => {
    // Above one would credit the prior with more free calls than it made; below zero would charge it
    // for more learning than it can have done. Both are read as the nearest real share rather than
    // refused, because the number comes from two counts and a rounded quotient is not a corruption.
    const all = planBudget({ ...r74, learningHitShare: 5 }, { arms: ['none'], questions: 100 });
    const paid = planBudget({ ...r74, learningHitShare: 0 }, { arms: ['none'], questions: 100 });
    const whole = planBudget({ ...r74, learningHitShare: 1 }, { arms: ['none'], questions: 100 });
    const negative = planBudget({ ...r74, learningHitShare: -2 }, { arms: ['none'], questions: 100 });
    expect(all.ratePerQuestionArm).toBe(whole.ratePerQuestionArm);
    expect(negative.ratePerQuestionArm).toBe(paid.ratePerQuestionArm);
    // And the two ends differ, or the clamp would be untestable.
    expect(all.ratePerQuestionArm).toBeGreaterThan(paid.ratePerQuestionArm);
  });
});
