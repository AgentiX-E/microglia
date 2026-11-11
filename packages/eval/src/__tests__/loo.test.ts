import { describe, expect, it } from 'vitest';
import {
  looCrossFitted,
  looDraws,
  looGroups,
  looOverall,
  observationalLedger,
  ruleClassOf,
  type LooRow,
} from '../loo.js';

/**
 * A split where the observational verdict and the causal one disagree on purpose.
 *
 * Twelve questions. Four injected rule `harmful` and were wrong with it and right without, four
 * injected rule `helpful` and were right with it and wrong without, and four injected nothing. The
 * `loo` arm restores exactly the four that withheld `harmful` and breaks exactly the four that
 * withheld `helpful`, so the pooled delta is zero while both groups are enormous — which is the
 * outcome the design exists to be able to see, and the one a whole-split number hides.
 */
const rows: readonly LooRow[] = [
  ...Array.from({ length: 4 }, (_, index) => ({
    fold: 0,
    correct: true,
    injectedCorrect: false,
    dropped: 'harmful',
    packIds: ['harmful'],
  })),
  ...Array.from({ length: 4 }, (_, index) => ({
    fold: 0,
    correct: false,
    injectedCorrect: true,
    dropped: 'helpful',
    packIds: ['helpful'],
  })),
  ...Array.from({ length: 4 }, (_, index) => ({
    fold: 0,
    correct: true,
    injectedCorrect: true,
    dropped: null,
    packIds: [],
  })),
];

const withoutMemory = rows.map((row, index) => (index < 4 ? true : index < 8 ? false : true));

describe('observationalLedger', () => {
  it('counts a rule from the questions that injected it, sorted by its own net', () => {
    const ledger = observationalLedger(rows, withoutMemory);
    expect(ledger.map((verdict) => verdict.rule)).toEqual(['harmful', 'helpful']);
    expect(ledger[0]).toMatchObject({ injected: 4, gained: 0, lost: 4, net: -4 });
    expect(ledger[1]).toMatchObject({ injected: 4, gained: 4, lost: 0, net: 4 });
  });

  it('charges a rule only when the verdict moved against the no-memory baseline', () => {
    // A question right with the pack and right without it is not evidence for the rule, which is why
    // the third group contributes nothing to either rule's ledger rather than cancelling out.
    const ledger = observationalLedger(
      [{ injectedCorrect: true, packIds: ['a'] }, { injectedCorrect: false, packIds: ['a'] }],
      [true, false],
    );
    expect(ledger[0]).toMatchObject({ injected: 2, gained: 0, lost: 0, net: 0 });
  });

  it('is empty for a split that injected nothing', () => {
    expect(observationalLedger([], [])).toEqual([]);
  });
});

describe('ruleClassOf', () => {
  it('puts a negative net in harmful, a positive one in helpful and zero in neutral', () => {
    expect(ruleClassOf({ net: -1 })).toBe('harmful');
    expect(ruleClassOf({ net: 1 })).toBe('helpful');
    expect(ruleClassOf({ net: 0 })).toBe('neutral');
  });
});

describe('looOverall', () => {
  it('pairs only the questions that withheld a rule and counts the rest', () => {
    const overall = looOverall(rows);
    expect(overall.pairs).toBe(8);
    expect(overall.nothingToWithhold).toBe(4);
    expect(overall.reading.baselineAccuracy).toBeCloseTo(4 / 8, 5);
    expect(overall.reading.treatmentAccuracy).toBeCloseTo(4 / 8, 5);
  });

  it('reports a zero delta when the two groups cancel, rather than a number with a sign', () => {
    expect(looOverall(rows).reading.delta).toBeCloseTo(0, 10);
  });
});

describe('looGroups', () => {
  it('reads the two rule classes apart, which is the whole point of the arm', () => {
    const groups = looGroups(rows, withoutMemory);
    const harmful = groups.find((group) => group.name === 'harmful');
    const helpful = groups.find((group) => group.name === 'helpful');
    // Withholding a harmful rule recovered all four; withholding a helpful one broke all four.
    expect(harmful?.reading.delta).toBeCloseTo(1, 5);
    expect(helpful?.reading.delta).toBeCloseTo(-1, 5);
    expect(harmful?.pairs).toBe(4);
  });

  it('omits a class the split never withheld, rather than printing a zero for it', () => {
    const groups = looGroups(rows, withoutMemory);
    expect(groups.some((group) => group.name === 'neutral')).toBe(false);
  });

  it('counts a rule the ledger never saw injected as neutral, and says which table that is', () => {
    // The withheld rule is in no pack in this split, so no observational verdict exists for it.
    // `looCrossFitted` calls that `unseen` and excludes it from the class readings; this pooled table
    // calls it `neutral`, which is the label R77 published. The case is here so the difference is a
    // recorded decision rather than a fallback nobody looked at.
    const ghost: readonly LooRow[] = [
      { fold: 0, correct: false, injectedCorrect: false, dropped: 'ghost', packIds: ['harmful'] },
      { fold: 0, correct: false, injectedCorrect: false, dropped: 'harmful', packIds: ['harmful'] },
    ];
    const groups = looGroups(ghost, [true, true]);
    expect(groups.map((group) => group.name)).toEqual(['harmful', 'neutral', '1 rule(s)']);
    const neutral = groups.find((group) => group.name === 'neutral');
    expect(neutral?.pairs).toBe(1);
    // The ghost's withheld draw changed nothing, so its own segment reads zero rather than absent.
    expect(neutral?.reading.delta).toBeCloseTo(0, 10);
  });

  it('buckets pack size with the third bucket open at the top', () => {
    const sized: readonly LooRow[] = [
      { fold: 0, correct: true, injectedCorrect: false, dropped: 'a', packIds: ['a'] },
      { fold: 0, correct: true, injectedCorrect: false, dropped: 'b', packIds: ['a', 'b'] },
      { fold: 0, correct: true, injectedCorrect: false, dropped: 'c', packIds: ['a', 'b', 'c'] },
      { fold: 0, correct: true, injectedCorrect: false, dropped: 'd', packIds: ['a', 'b', 'c', 'd'] },
    ];
    const groups = looGroups(sized, [false, false, false, false]);
    const names = groups.map((group) => group.name);
    expect(names).toContain('1 rule(s)');
    expect(names).toContain('2 rule(s)');
    // Three and four both land in the open bucket, because a pack of nine is not a different claim.
    expect(groups.find((group) => group.name === '3+ rule(s)')?.pairs).toBe(2);
  });

  it('is empty when nothing was withheld', () => {
    expect(looGroups(rows.filter((row) => row.dropped === null), withoutMemory.slice(8))).toEqual([]);
  });
});

describe('looDraws', () => {
  it('reports how concentrated the withholding is, which bounds a per-rule claim', () => {
    const draws = looDraws(rows);
    expect(draws.withheld).toBe(8);
    expect(draws.rules).toBe(2);
    expect(draws.median).toBe(4);
    expect(draws.max).toBe(4);
    expect(draws.mean).toBeCloseTo(4, 5);
  });

  it('is all zeros for a split that withheld nothing', () => {
    expect(looDraws([])).toEqual({ withheld: 0, rules: 0, median: 0, max: 0, mean: 0 });
  });
});

describe('looCrossFitted', () => {
  it('folds a damaged record into fold zero instead of giving it a fold of its own', () => {
    // `NaN % 5` is `NaN`, and `NaN` is a legal map key that the other-fold filter can never equal, so a
    // row with a non-integer fold would sit alone in its own fold *and* contribute to every other
    // fold's ledger — inflating a class reading silently. Three rows in fold zero with one damaged and
    // no other fold to learn from must therefore report three unseen rules and no readings at all.
    const damaged: readonly LooRow[] = [
      { fold: 0, correct: true, injectedCorrect: false, dropped: 'r', packIds: ['r'] },
      { fold: 0, correct: true, injectedCorrect: false, dropped: 'r', packIds: ['r'] },
      { fold: Number.NaN, correct: true, injectedCorrect: false, dropped: 'r', packIds: ['r'] },
    ];
    const crossFitted = looCrossFitted(damaged, [false, false, false]);
    expect(crossFitted.readings).toEqual([]);
    expect(crossFitted.unseen).toBe(3);
  });

  /**
   * A rule that looks harmful only inside the fold it was judged on.
   *
   * Eight questions across four folds. Rule `r` is injected on two questions per fold, and in fold 0
   * the model happened to fail both of them — so an in-sample ledger calls `r` harmful and then
   * measures a large "improvement" when it is withheld. In folds 1–3 the same rule is injected on
   * questions the full arm got right, so the other folds call it helpful or neutral, and the
   * cross-fitted reading is the one that says the fold-0 effect was the fold.
   */
  const foldShaped: LooRow[] = [
    // Fold 0: the model failed all six questions that injected `r`, and the withheld arm got them.
    ...Array.from({ length: 6 }, (): LooRow => ({
      fold: 0,
      correct: true,
      injectedCorrect: false,
      dropped: 'r',
      packIds: ['r'],
    })),
    // Folds 1-3: eighteen questions the full arm got right. They contribute nothing to `r`'s net —
    // net counts flips — which is why the out-of-fold ledger sees only fold 0's six losses.
    ...([1, 2, 3] as const).flatMap((fold): LooRow[] =>
      Array.from({ length: 6 }, (): LooRow => ({
        fold,
        correct: true,
        injectedCorrect: true,
        dropped: 'r',
        packIds: ['r'],
      })),
    ),
  ];
  const allRight = foldShaped.map(() => true);

  it('reads the class effect on folds the class was not decided on', () => {
    // In sample, `r` is harmful (net −6) and every pair that withheld it improved: the withheld arm is
    // right on 24 of 24, the full arm on 18 of 24.
    const inSample = looGroups(foldShaped, allRight).find((group) => group.name === 'harmful');
    expect(inSample?.pairs).toBe(24);
    expect(inSample?.reading.delta).toBeCloseTo(0.25, 6);
    // Cross-fitted, the eighteen pairs whose own fold produced no losses are judged by a ledger that
    // sees only fold 0's six — and on those eighteen the withheld arm and the full arm agree, so the
    // class carries nothing. The fold-0 pairs, whose out-of-fold ledger is flat, fall outside the
    // class entirely. The effect the in-sample table reported was the fold that produced its label.
    const fitted = looCrossFitted(foldShaped, allRight, 4);
    const harmful = fitted.readings.find((reading) => reading.name.startsWith('harmful'));
    expect(harmful?.pairs).toBe(18);
    expect(Math.abs(harmful?.reading.delta ?? 1)).toBeLessThan(Math.abs(inSample?.reading.delta ?? 0));
    expect(harmful?.reading.delta).toBeCloseTo(0, 6);
  });

  it('keeps a rule that every fold calls harmful', () => {
    // The same shape with the misfire in every fold: now the out-of-fold evidence agrees, and the
    // cross-fitted reading has to keep the effect rather than erase it.
    const everywhere: LooRow[] = ([0, 1, 2, 3] as const).flatMap((fold): LooRow[] => [
      { fold, correct: true, injectedCorrect: false, dropped: 'r', packIds: ['r'] },
      { fold, correct: true, injectedCorrect: false, dropped: 'r', packIds: ['r'] },
    ]);
    const fitted = looCrossFitted(everywhere, everywhere.map(() => true), 4);
    const harmful = fitted.readings.find((reading) => reading.name.startsWith('harmful'));
    expect(harmful?.pairs).toBe(8);
    expect(harmful?.reading.delta).toBeCloseTo(1, 6);
  });

  it('counts a rule no other fold saw instead of calling it neutral', () => {
    // Neutral is a measurement; unseen is the absence of one. Filing an unseen rule with the neutral
    // group would let a fold's unique rule vote on a class it has no evidence about.
    const oneFold: LooRow[] = [
      { fold: 0, correct: true, injectedCorrect: false, dropped: 'only-here', packIds: ['only-here'] },
      { fold: 1, correct: false, injectedCorrect: false, dropped: null, packIds: [] },
    ];
    const fitted = looCrossFitted(oneFold, [true, false], 2);
    expect(fitted.unseen).toBe(1);
    expect(fitted.readings).toEqual([]);
  });

  it('is defined for a single fold, where no out-of-fold evidence exists', () => {
    const fitted = looCrossFitted([{ fold: 0, correct: true, injectedCorrect: true, dropped: 'r', packIds: ['r'] }], [true], 1);
    expect(fitted.readings).toEqual([]);
    expect(fitted.unseen).toBe(1);
  });
});
