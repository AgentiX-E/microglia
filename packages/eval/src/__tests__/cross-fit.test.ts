import { describe, expect, it } from 'vitest';
import {
  CROSS_FIT_SEED,
  treatmentOf,
  crossFitLine,
  crossFitPool,
  crossFitRefusalLine,
  foldSplitOf,
  foldTasksOf,
  type CrossFitFold,
} from '../cross-fit.js';
import { detectableDelta } from '../detectable.js';

/**
 * Two folds of one corpus, read as one pair.
 *
 * The arithmetic is one call into the estimator the rest of the record already uses, and the guards are the
 * module. So every case here is a way a cross-fit can be made to say something larger than it measured: the
 * same task counted in both folds, a fold scoring a task its own store learned from, a fold that cannot say
 * what it learned from, two treatments averaged as one, and a pooled delta that is two opposite findings
 * averaged rather than one.
 */

const fold = (
  label: string,
  learned: readonly string[] | undefined,
  rows: readonly (readonly [string, boolean, boolean])[],
  over: Partial<CrossFitFold> = {},
): CrossFitFold => ({
  label,
  learned,
  tasks: rows.map(([id, memoryPassed, controlPassed]) => ({ id, memoryPassed, controlPassed })),
  unit: 'raw',
  form: 'record',
  scope: 'edited',
  model: 'deepseek-chat',
  ...over,
});

/**
 * A tiling two-fold over eight tasks: the first four learned by B and answered by A, the last four the
 * reverse. This is the shape R143 runs, in miniature.
 */
const tiling = (): readonly CrossFitFold[] => [
  fold('A', ['t1', 't2', 't3', 't4'], [
    ['t5', true, false],
    ['t6', true, true],
    ['t7', false, true],
    ['t8', false, false],
  ]),
  fold('B', ['t5', 't6', 't7', 't8'], [
    ['t1', true, false],
    ['t2', false, false],
    ['t3', true, true],
    ['t4', true, false],
  ]),
];

describe('crossFitPool', () => {
  it('pools the two folds into one paired reading over the whole corpus', () => {
    const outcome = crossFitPool(tiling(), CROSS_FIT_SEED, 500);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const { reading } = outcome;
    // 8 pairs, five memory passes and three control passes: the pooled rate is over every task once.
    expect(reading.tasks).toBe(8);
    expect(reading.memoryPass4).toBeCloseTo(5 / 8, 10);
    expect(reading.controlPass4).toBeCloseTo(3 / 8, 10);
    expect(reading.deltaPp).toBeCloseTo(25, 10);
    // Four discordant pairs, three of them the memory's: gained 3, lost 1, and the net is the delta.
    expect(reading.gained).toBe(3);
    expect(reading.lost).toBe(1);
  });

  it('refuses two folds served through two filters, and pools two that carried none', () => {
    // R150. `anchoring=lexical` and the default differ in one parameter and in what may appear inside a pack, so
    // the two folds would be one corpus and two experiments. The knob string is compared rather than an anchor
    // re-derived from it: a pool that parsed the string would have a second reader of the vocabulary.
    const [a, b] = tiling();
    const different = crossFitPool(
      [
        { ...(a as CrossFitFold), knobs: 'anchoring=lexical' },
        { ...(b as CrossFitFold), knobs: '' },
      ],
      CROSS_FIT_SEED,
      200,
    );
    expect(different.ok).toBe(false);
    if (different.ok) return;
    expect(different.refusals.join(' ')).toContain("knobs is 'anchoring=lexical' on A and 'none' on B");

    // Absent and empty are the same reading — this run sent no knob — so a fold written before the field pools
    // with one written after it that declared nothing.
    const same = crossFitPool(
      [{ ...(a as CrossFitFold), knobs: '' }, { ...(b as CrossFitFold) }],
      CROSS_FIT_SEED,
      200,
    );
    expect(same.ok).toBe(true);
  });

  it('reports the folds it pooled, because a pooled number with no per-fold row hides two findings', () => {
    const outcome = crossFitPool(tiling(), CROSS_FIT_SEED, 500);
    if (!outcome.ok) throw new Error('expected a reading');
    expect(outcome.reading.folds.map((row) => row.label)).toEqual(['A', 'B']);
    // Fold A: 2 of 4 against 2 of 4, so level. Fold B: 3 of 4 against 1 of 4, so +50pp. The pooled +25pp is
    // the two of them over the corpus, and a reader who saw only it would think the mechanism was uniform.
    expect(outcome.reading.folds[0]?.deltaPp).toBeCloseTo(0, 10);
    expect(outcome.reading.folds[1]?.deltaPp).toBeCloseTo(50, 10);
    expect(outcome.reading.folds[0]?.gained).toBe(1);
    expect(outcome.reading.folds[0]?.lost).toBe(1);
    expect(outcome.reading.folds[1]?.gained).toBe(2);
    expect(outcome.reading.folds[1]?.lost).toBe(0);
  });

  it('quotes the interval from the estimator the rest of the record uses', () => {
    const outcome = crossFitPool(tiling(), CROSS_FIT_SEED, 2_000);
    if (!outcome.ok) throw new Error('expected a reading');
    const { reading } = outcome;
    expect(reading.ciLowPp).toBeLessThanOrEqual(reading.deltaPp);
    expect(reading.ciHighPp).toBeGreaterThanOrEqual(reading.deltaPp);
    expect(reading.mde80Pp).toBeCloseTo(detectableDelta(reading.tasks, reading.discordance) * 100, 10);
  });

  it('is reproducible from the committed ledgers, because the seed is part of the reading', () => {
    const once = crossFitPool(tiling(), CROSS_FIT_SEED, 1_000);
    const twice = crossFitPool(tiling(), CROSS_FIT_SEED, 1_000);
    if (!once.ok || !twice.ok) throw new Error('expected readings');
    expect(twice.reading.ciLowPp).toBe(once.reading.ciLowPp);
    expect(twice.reading.ciHighPp).toBe(once.reading.ciHighPp);
    expect(twice.reading.p).toBe(once.reading.p);
  });

  it('carries the exact McNemar p-value over the pooled discordant pairs', () => {
    // Six pairs, all of them the memory's and none the control's: 2 x P(X = 0) at Bin(6, 0.5) = 0.03125.
    // A cross-fit that resolved nothing would be a cross-fit that bought nothing, so the p-value has to be
    // the paired one rather than a difference of two proportions.
    const one = fold('A', ['t7', 't8'], [
      ['t1', true, false],
      ['t2', true, false],
      ['t3', true, false],
      ['t4', true, false],
      ['t5', true, false],
      ['t6', true, false],
    ]);
    const two = fold('B', ['t1', 't2', 't3', 't4', 't5', 't6'], [['t7', false, false], ['t8', false, false]]);
    const outcome = crossFitPool([one, two], CROSS_FIT_SEED, 200);
    if (!outcome.ok) throw new Error('expected a reading');
    expect(outcome.reading.gained).toBe(6);
    expect(outcome.reading.lost).toBe(0);
    expect(outcome.reading.p).toBeCloseTo(0.03125, 6);
  });

  it('refuses one fold, because one fold has no other half to have trained it', () => {
    const outcome = crossFitPool([fold('A', ['t5'], [['t5', true, false]])]);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.refusals.join(' ')).toContain('a cross-fit needs two folds');
  });

  it('refuses a fold with no scored tasks rather than dropping it from the pool', () => {
    const outcome = crossFitPool([fold('A', ['t2'], []), fold('B', ['t1'], [['t1', true, false]])]);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.refusals.join(' ')).toContain('fold(s) with no scored tasks: A');
  });

  it('refuses a task evaluated in both folds, rather than counting it twice', () => {
    const both = [
      fold('A', ['t3'], [['t1', true, false]]),
      fold('B', ['t1'], [['t1', false, true]]),
    ];
    const outcome = crossFitPool(both);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.refusals.join(' ')).toContain('the same task is evaluated in two folds: t1 (A, B)');
  });

  it('refuses a fold that scored a task its own store learned from, which is the leak', () => {
    // The expensive kind of wrong: the number comes out better than the truth instead of failing.
    const leaky = [
      fold('A', ['t1', 't2'], [
        ['t1', true, false],
        ['t2', true, false],
      ]),
      fold('B', ['t3'], [['t3', true, false]]),
    ];
    const outcome = crossFitPool(leaky);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.refusals.join(' ')).toContain("fold 'A' evaluates 2 task(s) its store learned from: t1, t2");
  });

  it('refuses a fold that does not say what it learned from, because the leak check cannot run', () => {
    const outcome = crossFitPool([fold('A', undefined, [['t1', true, false]]), fold('B', ['t1'], [['t2', true, true]])]);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.refusals.join(' ')).toContain('fold(s) that do not say what they learned from: A');
  });

  it('refuses two folds of two treatments, whatever the delta between them is', () => {
    const outcome = crossFitPool([
      fold('A', ['t2'], [['t1', true, false]]),
      fold('B', ['t1'], [['t2', false, true]], { model: 'deepseek-flash' }),
    ]);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.refusals.join(' ')).toContain("model is 'deepseek-chat' on A and 'deepseek-flash' on B");
  });

  it('refuses a fold whose treatment is unrecorded, because absence is not agreement', () => {
    const outcome = crossFitPool([
      fold('A', ['t2'], [['t1', true, false]], { scope: undefined }),
      fold('B', ['t1'], [['t2', false, true]]),
    ]);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.refusals.join(' ')).toContain("scope is 'unrecorded' on A and 'edited' on B");
  });

  it('refuses a fold that states none of the treatment, naming every field it left silent', () => {
    // An artefact from before any of these fields existed. Four sentences, not one: a caller that fixed them
    // one round-trip at a time would dispatch twice more than it needed to.
    const outcome = crossFitPool([
      fold('A', ['t2'], [['t1', true, false]], {
        unit: undefined,
        form: undefined,
        scope: undefined,
        model: undefined,
      }),
      fold('B', ['t1'], [['t2', false, true]]),
    ]);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.refusals).toHaveLength(4);
    for (const field of ['unit', 'form', 'scope', 'model']) {
      expect(outcome.refusals.join(' ')).toContain(`${field} is 'unrecorded' on A`);
    }
  });

  it('counts the rest rather than printing a list a reader would skip', () => {
    // Six of each: a leak of forty must stay one sentence, and the count is what a reader acts on.
    const leaky = [
      fold('A', ['t1', 't2', 't3', 't4', 't5', 't6'], [
        ['t1', true, false],
        ['t2', true, false],
        ['t3', true, false],
        ['t4', true, false],
        ['t5', true, false],
        ['t6', true, false],
      ]),
      fold('B', ['t7'], [['t7', false, false]]),
    ];
    const one = crossFitPool(leaky);
    expect(one.ok).toBe(false);
    if (one.ok) return;
    expect(one.refusals.join(' ')).toContain('t1, t2, t3, t4, t5, and 1 more');

    const doubled = crossFitPool([
      fold('A', ['t9'], [
        ['t1', true, false],
        ['t2', true, false],
        ['t3', true, false],
        ['t4', true, false],
        ['t5', true, false],
        ['t6', true, false],
      ]),
      fold('B', ['t7'], [
        ['t1', false, true],
        ['t2', false, true],
        ['t3', false, true],
        ['t4', false, true],
        ['t5', false, true],
        ['t6', false, true],
      ]),
    ]);
    expect(doubled.ok).toBe(false);
    if (doubled.ok) return;
    expect(doubled.refusals.join(' ')).toContain('t5 (A, B); and 1 more');
  });

  it('reports a corpus the two folds do not tile, instead of silently reading a smaller population', () => {
    // t9 is learned by B and evaluated by neither; t7 is evaluated by A and learned by neither. Both leave a
    // valid reading of a smaller population, so neither is a refusal — but the pooled n is not the corpus's.
    const outcome = crossFitPool([
      fold('A', ['t1'], [['t5', true, false]]),
      fold('B', ['t9'], [['t1', false, true]]),
    ]);
    if (!outcome.ok) throw new Error('expected a reading');
    expect(outcome.reading.tiles).toBe(false);
    expect(outcome.reading.neverLearned).toEqual(['t5']);
    expect(outcome.reading.neverScored).toEqual(['t9']);
    expect(outcome.reading.evaluated).toBe(2);
    expect(outcome.reading.learned).toBe(2);
  });

  it('says so when the folds point in opposite directions, because the mean of two findings is neither', () => {
    const outcome = crossFitPool([
      fold('A', ['t2'], [['t1', true, false]]),
      fold('B', ['t1'], [['t2', false, true]]),
    ]);
    if (!outcome.ok) throw new Error('expected a reading');
    expect(outcome.reading.folds[0]?.deltaPp).toBeCloseTo(100, 10);
    expect(outcome.reading.folds[1]?.deltaPp).toBeCloseTo(-100, 10);
    expect(outcome.reading.agreeInSign).toBe(false);
    // The pooled reading is exactly the cancellation, which is why the flag exists: +100 and -100 average to
    // zero, and a reader shown only the mean would conclude the memory did nothing.
    expect(outcome.reading.deltaPp).toBeCloseTo(0, 10);
    expect(outcome.reading.lost).toBe(1);
    expect(outcome.reading.gained).toBe(1);
  });

  it('treats two folds that both sit at zero as agreeing, because neither contradicts the other', () => {
    const outcome = crossFitPool([
      fold('A', ['t2'], [['t1', true, true]]),
      fold('B', ['t1'], [['t2', false, false]]),
    ]);
    if (!outcome.ok) throw new Error('expected a reading');
    expect(outcome.reading.agreeInSign).toBe(true);
    expect(outcome.reading.discordance).toBe(0);
    // No discordant pair detects nothing: `Infinity`, not zero, so a reader cannot read it as "resolves all".
    expect(outcome.reading.mde80Pp).toBe(Number.POSITIVE_INFINITY);
    expect(outcome.reading.p).toBe(1);
  });
});

describe('crossFitLine', () => {
  it('prints the pooled reading, the folds it pooled, and whether they tile', () => {
    const outcome = crossFitPool(tiling(), CROSS_FIT_SEED, 500);
    if (!outcome.ok) throw new Error('expected a reading');
    const line = crossFitLine(outcome.reading);
    expect(line).toContain('[cross-fit] pooled n=8 memory=0.6250 control=0.3750 delta=+25.00pp');
    expect(line).toContain('[cross-fit] folds: A +0.00pp (n=4), B +50.00pp (n=4)');
    expect(line).toContain('tiles 8 of 8 task(s); folds agree in sign');
  });

  it('names the tasks a non-tiling pair leaves out, in the same line as the number it affects', () => {
    const outcome = crossFitPool([
      fold('A', ['t1'], [['t5', true, false]]),
      fold('B', ['t9'], [['t1', false, true]]),
    ]);
    if (!outcome.ok) throw new Error('expected a reading');
    expect(crossFitLine(outcome.reading)).toContain(
      'does not tile: 1 evaluated task(s) learned by neither fold, 1 learned task(s) evaluated by neither',
    );
  });

  it('prints a negative pooled delta with its sign, so a loss cannot be read as a gain', () => {
    const outcome = crossFitPool([
      fold('A', ['t1'], [['t5', false, true]]),
      fold('B', ['t5'], [['t1', false, true]]),
    ]);
    if (!outcome.ok) throw new Error('expected a reading');
    expect(crossFitLine(outcome.reading)).toContain('delta=-100.00pp');
    expect(crossFitLine(outcome.reading)).toContain('folds agree in sign');
  });

  it('says the folds disagree when one gained and the other lost, which a pooled mean cannot show', () => {
    const outcome = crossFitPool([
      fold('A', ['t1'], [['t5', false, true]]),
      fold('B', ['t5'], [['t1', true, false]]),
    ]);
    if (!outcome.ok) throw new Error('expected a reading');
    expect(crossFitLine(outcome.reading)).toContain('folds disagree in sign');
    expect(crossFitLine(outcome.reading)).toContain('delta=+0.00pp');
  });

  it('prefixes every refusal, so a caller cannot print one reason and exit on another', () => {
    expect(crossFitRefusalLine(['first', 'second'])).toBe('[cross-fit] REFUSED: first\n[cross-fit] REFUSED: second');
  });
});

describe('foldSplitOf', () => {
  it('reads the split from the arm that learned, because the control arm states an empty learning half', () => {
    // The shape every pair artefact in this lane actually has. `controlRaw` records `train: []` on purpose —
    // "this arm learned nothing" — while the memory arm records the half its store was built from. A guard
    // that demanded two identical learning halves therefore refused every artefact this lane has ever
    // written: the committed pair carries `foldSplitAbsent` down to today. The halves are the pair's: one
    // evaluation half both arms answered, and the learning half the arm with a store was built from.
    const outcome = foldSplitOf([
      { label: 'reference', train: [], test: ['t3', 't4'] },
      { label: 'memory', train: ['t2', 't1'], test: ['t4', 't3'] },
    ]);
    expect(outcome).toEqual({ ok: true, learned: ['t1', 't2'], evaluated: ['t3', 't4'] });
  });

  it('refuses a pair in which neither arm learned anything, because a fold with no store is not a half', () => {
    const outcome = foldSplitOf([
      { label: 'reference', train: [], test: ['t3'] },
      { label: 'memory', train: [], test: ['t3'] },
    ]);
    expect(outcome).toEqual({
      ok: false,
      reason: 'no arm states a learning half: a fold whose store learned nothing cannot be half of a corpus',
    });
  });

  it('reads the two halves from the arms when they agree, sorted so the record is stable', () => {
    const outcome = foldSplitOf([
      { label: 'reference', train: ['t2', 't1'], test: ['t4', 't3'] },
      { label: 'memory', train: ['t1', 't2'], test: ['t3', 't4'] },
    ]);
    expect(outcome).toEqual({ ok: true, learned: ['t1', 't2'], evaluated: ['t3', 't4'] });
  });

  it('reads a split from an arm that states an evaluation half and no learning half at all', () => {
    // An arm whose `tau2` block predates the key still answers a half; only the memory arm has to state what
    // it learned, because only the memory arm has a store.
    const outcome = foldSplitOf([
      { label: 'reference', train: undefined, test: ['t3'] },
      { label: 'memory', train: ['t1'], test: ['t3'] },
    ]);
    expect(outcome).toEqual({ ok: true, learned: ['t1'], evaluated: ['t3'] });
  });

  it('refuses a third arm that learned a different half, so a pool is never built from two stores', () => {
    const outcome = foldSplitOf([
      { label: 'reference', train: [], test: ['t3'] },
      { label: 'memory', train: ['t1', 't2'], test: ['t3'] },
      { label: 'memory-b', train: ['t1'], test: ['t3'] },
    ]);
    expect(outcome).toEqual({ ok: false, reason: "the arms learned different halves: 'memory-b' learned 1 against 2" });
  });

  it('refuses when an arm records no split at all, because the pair cannot state a boundary alone', () => {
    const outcome = foldSplitOf([
      { label: 'reference', train: undefined, test: undefined },
      { label: 'memory', train: ['t1'], test: ['t2'] },
    ]);
    expect(outcome).toEqual({ ok: false, reason: 'arm(s) record no evaluation half: reference' });
  });

  it('refuses a caller with no arms at all, rather than reading a split over nothing', () => {
    expect(foldSplitOf([])).toEqual({ ok: false, reason: 'no arm to read a split from' });
  });

  it('names every arm that records no evaluation half, so one edit fixes both', () => {
    // `train` absent is not a defect — an arm with no store states no learning half — but `test` absent is:
    // an arm that does not say what it answered cannot be paired on anything.
    const outcome = foldSplitOf([
      { label: 'reference', train: undefined, test: ['t2'] },
      { label: 'memory', train: ['t1'], test: undefined },
    ]);
    expect(outcome).toEqual({ ok: false, reason: 'arm(s) record no evaluation half: memory' });
  });

  it('refuses a split whose halves overlap, which is a leak stated in the artefact itself', () => {
    const outcome = foldSplitOf([{ label: 'memory', train: ['t1', 't2'], test: ['t2', 't3'] }]);
    expect(outcome).toEqual({ ok: false, reason: '1 task(s) are in both halves of the split: t2' });
  });

  it('refuses two arms that learned different halves, which is two runs rather than a pair', () => {
    const outcome = foldSplitOf([
      { label: 'reference', train: ['t1'], test: ['t2'] },
      { label: 'memory', train: ['t1', 't9'], test: ['t2'] },
    ]);
    expect(outcome).toEqual({
      ok: false,
      reason: "the arms learned different halves: 'memory' learned 2 against 1",
    });
  });

  it('refuses two arms that answered different halves, whatever they learned', () => {
    // The evaluation half is the pair's, not one arm's: two arms that scored different task sets have no
    // shared denominator, so no delta between them is a treatment effect.
    const outcome = foldSplitOf([
      { label: 'reference', train: ['t1'], test: ['t2'] },
      { label: 'memory', train: ['t1'], test: ['t3'] },
    ]);
    expect(outcome).toEqual({
      ok: false,
      reason: "the arms answered different halves: 'memory' answered 1 against 1, and the lists differ",
    });
  });
});

const arm = (
  label: string,
  over: Partial<{
    unit: string;
    form: string;
    scope: string;
    model: string;
    traceClaims: number;
    knobs: string;
  }> = {},
): Parameters<typeof treatmentOf>[0][number] => ({
  label,
  unit: 'raw',
  form: 'record',
  scope: 'edited',
  model: 'deepseek-chat',
  traceClaims: 400,
  // R150: absent unless a case states one, which is every artefact written before the field.
  knobs: undefined,
  ...over,
});

describe('treatmentOf', () => {
  it('reads the treatment the two arms agree on, which is what the pool compares', () => {
    expect(treatmentOf([arm('reference'), arm('memory')])).toEqual({
      ok: true,
      treatment: { unit: 'raw', form: 'record', scope: 'edited', model: 'deepseek-chat', traceClaims: 400 },
    });
  });

  it('carries the filter the request ran, and refuses two arms that ran different ones', () => {
    // R150. The knob string is the only record of *what filter ran*: `anchoring=lexical` and the default differ
    // in one parameter and in what may appear in a pack. Two folds of one store served through two filters are
    // two experiments, and a pool that averaged them would report a treatment neither of them ran.
    expect(treatmentOf([arm('reference', { knobs: 'anchoring=lexical' }), arm('memory', { knobs: 'anchoring=lexical' })]))
      .toEqual({
        ok: true,
        treatment: {
          unit: 'raw',
          form: 'record',
          scope: 'edited',
          model: 'deepseek-chat',
          traceClaims: 400,
          knobs: 'anchoring=lexical',
        },
      });
    expect(
      treatmentOf([arm('reference', { knobs: '' }), arm('memory', { knobs: 'anchoring=lexical' })]),
    ).toEqual({
      ok: false,
      reason:
        "the arms are two runs, not one treatment: knobs is '' on reference and 'anchoring=lexical' on memory",
    });
  });

  it('leaves out a field neither arm states, rather than filling it with a default', () => {
    // A default here would reach the pool as a fact, and two runs that both lacked the field would pool as
    // though they had stated the same one.
    const outcome = treatmentOf([
      arm('reference', { traceClaims: undefined }),
      arm('memory', { traceClaims: undefined }),
    ]);
    expect(outcome).toEqual({
      ok: true,
      treatment: { unit: 'raw', form: 'record', scope: 'edited', model: 'deepseek-chat' },
    });
  });

  it('reads a field from the arm that states it, because a control arm has no store to describe', () => {
    // The committed pair artefact carries `treatmentAbsent: "the arms do not both state unit: reference
    // record none"` on every run of this lane, because the reference arm serves no pack and distils nothing:
    // unit, form, scope and knobs cannot exist on it. Demanding they be stated twice made the pair unable to
    // say what treatment it ran, which is the identity a cross-fit pools on. The treatment is the serving
    // arm's, and a disagreement between arms that both state it still refuses.
    expect(
      treatmentOf([
        arm('reference', { unit: undefined, form: undefined, scope: undefined, traceClaims: undefined }),
        arm('memory'),
      ]),
    ).toEqual({
      ok: true,
      treatment: { unit: 'raw', form: 'record', scope: 'edited', model: 'deepseek-chat', traceClaims: 400 },
    });
  });

  it('refuses two arms that state different treatments, whatever the delta between them is', () => {
    expect(treatmentOf([arm('reference'), arm('memory', { model: 'deepseek-flash' })])).toEqual({
      ok: false,
      reason: "the arms are two runs, not one treatment: model is 'deepseek-chat' on reference and 'deepseek-flash' on memory",
    });
  });

  it('carries only the fields the arms state, however few that is', () => {
    // A pair from before any of these fields existed: the treatment it can state is what it recorded, which is
    // nothing, and the pool then refuses it with four sentences naming the four fields nobody compared.
    const bare = { unit: undefined, form: undefined, scope: undefined, model: undefined, traceClaims: undefined };
    expect(treatmentOf([arm('reference', bare), arm('memory', bare)])).toEqual({ ok: true, treatment: {} });
  });

  it('refuses a pair that disagrees about the trace ceiling, which decides the yield', () => {
    expect(treatmentOf([arm('reference'), arm('memory', { traceClaims: 1200 })])).toEqual({
      ok: false,
      reason: "the arms are two runs, not one treatment: traceClaims is '400' on reference and '1200' on memory",
    });
  });

  it('refuses a pair that disagrees about the form asked for', () => {
    expect(treatmentOf([arm('reference'), arm('memory', { form: 'sentence' })])).toEqual({
      ok: false,
      reason: "the arms are two runs, not one treatment: form is 'record' on reference and 'sentence' on memory",
    });
  });

  it('refuses a pair that disagrees about the population distilled from', () => {
    expect(treatmentOf([arm('reference'), arm('memory', { scope: 'accepted' })])).toEqual({
      ok: false,
      reason: "the arms are two runs, not one treatment: scope is 'edited' on reference and 'accepted' on memory",
    });
  });

  it('refuses a pair with one arm, because one arm cannot disagree with itself', () => {
    expect(treatmentOf([arm('reference')])).toEqual({
      ok: false,
      reason: 'a treatment needs two arms: one arm is not a pair',
    });
  });

  it('refuses a caller with no arms at all', () => {
    expect(treatmentOf([])).toEqual({ ok: false, reason: 'no arm to read a treatment from' });
  });
});

describe('foldTasksOf', () => {
  const row = (task: string, blankCorrect: boolean, withMemoryCorrect: boolean): Parameters<typeof foldTasksOf>[0][number] => ({
    task,
    blankCorrect,
    withMemoryCorrect,
  });

  it('counts a task as passed only when every trial passed, which is the lane\'s own reading', () => {
    const outcome = foldTasksOf([
      row('retail/1', true, true),
      row('retail/1', true, false),
      row('retail/2', true, true),
      row('retail/2', true, true),
    ]);
    expect(outcome).toEqual({
      ok: true,
      tasks: [
        { id: 'retail/1', memoryPassed: false, controlPassed: true },
        { id: 'retail/2', memoryPassed: true, controlPassed: true },
      ],
    });
  });

  it('pairs the two arms per trial, so a task the control half-passed is not counted as passed', () => {
    const outcome = foldTasksOf([
      row('retail/9', true, true),
      row('retail/9', false, true),
      row('retail/10', true, true),
    ]);
    expect(outcome).toEqual({
      ok: true,
      tasks: [
        { id: 'retail/10', memoryPassed: true, controlPassed: true },
        { id: 'retail/9', memoryPassed: true, controlPassed: false },
      ],
    });
  });

  it('refuses a ledger with no rows, rather than reading it as a fold that passed everything', () => {
    expect(foldTasksOf([])).toEqual({
      ok: false,
      reason: 'the ledger carries no trial rows, so the fold measured nothing',
    });
  });
});
