import { describe, expect, it } from 'vitest';
import {
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
