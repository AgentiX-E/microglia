import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DECISIVE,
  DEFAULT_RETIREMENT,
  clearanceFromDecisive,
  creditHistogram,
  decisiveHistogram,
  parseDecisivePolicy,
  parseRetirementPolicy,
  outcomeCredit,
  retireeFrom,
  retireeFromDecisive,
  type ValidationCredit,
} from '../validation.js';

const creditOf = (entries: Record<string, ValidationCredit>): Map<string, ValidationCredit> =>
  new Map(Object.entries(entries));

describe('retireeFrom', () => {
  it('retires a rule that failed every time it was injected', () => {
    expect(retireeFrom(creditOf({ a: { trials: 2, failures: 2 } }))).toEqual(['a']);
  });

  it('keeps a rule that succeeded more often than it failed', () => {
    // 1 of 3 is a rule present at a mistake, not a rule that causes one.
    expect(retireeFrom(creditOf({ a: { trials: 3, failures: 1 } }))).toEqual([]);
  });

  it('retires at exactly the policy share, so the boundary is the stated one', () => {
    const policy = { minTrials: 2, failureRate: 0.5 };
    expect(retireeFrom(creditOf({ a: { trials: 2, failures: 1 } }), policy)).toEqual(['a']);
    expect(retireeFrom(creditOf({ a: { trials: 2, failures: 1 } }), { minTrials: 2, failureRate: 0.6 })).toEqual([]);
  });

  it('refuses to act on a single trial however it went', () => {
    // The regression this exists for: the first version retired on one failure, and a
    // stand-in endpoint that always answered wrongly retired every rule it touched.
    expect(retireeFrom(creditOf({ a: { trials: 1, failures: 1 } }))).toEqual([]);
    expect(retireeFrom(creditOf({ a: { trials: 1, failures: 1 } }), { minTrials: 1, failureRate: 0.5 })).toEqual([
      'a',
    ]);
  });

  it('sorts, so the same credit always produces the same deletion', () => {
    const credit = creditOf({
      c: { trials: 2, failures: 2 },
      a: { trials: 2, failures: 2 },
      b: { trials: 4, failures: 4 },
    });
    expect(retireeFrom(credit)).toEqual(['a', 'b', 'c']);
  });

  it('retires nothing when nothing was ever injected', () => {
    expect(retireeFrom(new Map())).toEqual([]);
  });

  it('applies the default policy when none is given', () => {
    const credit = creditOf({ a: { trials: 2, failures: 2 }, b: { trials: 5, failures: 1 } });
    expect(retireeFrom(credit)).toEqual(['a']);
    expect(retireeFrom(credit, DEFAULT_RETIREMENT)).toEqual(['a']);
  });
});

describe('parseRetirementPolicy', () => {
  it('defaults both knobs when they are absent', () => {
    expect(parseRetirementPolicy({})).toEqual(DEFAULT_RETIREMENT);
  });

  it('treats an empty string as absent, because a workflow passes one for unset inputs', () => {
    expect(parseRetirementPolicy({ minTrials: '', failureRate: '' })).toEqual(DEFAULT_RETIREMENT);
  });

  it('reads both knobs', () => {
    expect(parseRetirementPolicy({ minTrials: '4', failureRate: '0.75' })).toEqual({ minTrials: 4, failureRate: 0.75 });
  });

  it('refuses a trial floor that is not a whole number', () => {
    expect(() => parseRetirementPolicy({ minTrials: '2.5' })).toThrow(/whole number/);
    expect(() => parseRetirementPolicy({ minTrials: '0' })).toThrow(/whole number/);
    expect(() => parseRetirementPolicy({ minTrials: 'many' })).toThrow(/whole number/);
  });

  it('refuses a share outside the interval, including a zero that would retire everything', () => {
    expect(() => parseRetirementPolicy({ failureRate: '0' })).toThrow(/share/);
    expect(() => parseRetirementPolicy({ failureRate: '1.5' })).toThrow(/share/);
    expect(() => parseRetirementPolicy({ failureRate: 'half' })).toThrow(/share/);
  });

  it('accepts a share of exactly one, which retires only the never-successful', () => {
    expect(parseRetirementPolicy({ failureRate: '1' })).toEqual({ minTrials: 2, failureRate: 1 });
  });
});

describe('creditHistogram', () => {
  it('counts rules by observed share, so a threshold that retired nothing is explainable', () => {
    const credit = creditOf({
      a: { trials: 2, failures: 0 },
      b: { trials: 2, failures: 1 },
      c: { trials: 2, failures: 1 },
      d: { trials: 3, failures: 1 },
    });
    expect(creditHistogram(credit)).toEqual({ '0/2': 1, '1/2': 2, '1/3': 1 });
  });

  it('is empty when no rule was injected', () => {
    expect(creditHistogram(new Map())).toEqual({});
  });
});

describe('retireeFromDecisive', () => {
  it('retires a rule that won the questions it changed, in the wrong direction', () => {
    expect(retireeFromDecisive(new Map([['a', { helped: 0, harmed: 2 }]]))).toEqual(['a']);
  });

  it('keeps a rule that changed outcomes for the better', () => {
    expect(retireeFromDecisive(new Map([['a', { helped: 2, harmed: 0 }]]))).toEqual([]);
  });

  it('keeps a rule whose record is tied, because a tie is not a verdict', () => {
    // The absolute policy retired at exactly one half and produced a random pruning; the
    // default here is two thirds for that reason, and the boundary is asserted both ways.
    expect(retireeFromDecisive(new Map([['a', { helped: 1, harmed: 1 }]]))).toEqual([]);
    expect(retireeFromDecisive(new Map([['a', { helped: 1, harmed: 1 }]]), { minDecisive: 2, harmShare: 0.5 })).toEqual(
      ['a'],
    );
  });

  it('retires at two harms to one help, which is the stated boundary', () => {
    expect(retireeFromDecisive(new Map([['a', { helped: 1, harmed: 2 }]]))).toEqual(['a']);
    expect(retireeFromDecisive(new Map([['a', { helped: 2, harmed: 3 }]]))).toEqual([]);
  });

  it('needs the decisive floor before it will act at all', () => {
    // One comparison that went badly is one coin flip, and this is the whole reason the
    // counterfactual exists: a single trial is what the absolute score got wrong.
    expect(retireeFromDecisive(new Map([['a', { helped: 0, harmed: 1 }]]))).toEqual([]);
    expect(retireeFromDecisive(new Map([['a', { helped: 0, harmed: 1 }]]), { minDecisive: 1, harmShare: 1 })).toEqual([
      'a',
    ]);
  });

  it('ignores rules no comparison ever touched', () => {
    expect(retireeFromDecisive(new Map([['a', { helped: 0, harmed: 0 }]]))).toEqual([]);
  });

  it('sorts, so a store digest is a function of the data rather than of map order', () => {
    const credit = new Map([
      ['c', { helped: 0, harmed: 2 }],
      ['a', { helped: 0, harmed: 2 }],
      ['b', { helped: 0, harmed: 3 }],
    ]);
    expect(retireeFromDecisive(credit)).toEqual(['a', 'b', 'c']);
  });

  it('retires a rule that lost three of four, and keeps one that lost two of five', () => {
    expect(retireeFromDecisive(new Map([['a', { helped: 1, harmed: 3 }]]))).toEqual(['a']);
    expect(retireeFromDecisive(new Map([['a', { helped: 3, harmed: 2 }]]))).toEqual([]);
  });
});

describe('clearanceFromDecisive', () => {
  it('removes a rule with a net harm record', () => {
    expect(clearanceFromDecisive(new Map([['a', { helped: 0, harmed: 1 }]]))).toEqual(['a']);
    expect(clearanceFromDecisive(new Map([['a', { helped: 1, harmed: 3 }]]))).toEqual(['a']);
  });

  it('keeps a rule with a net help record, which is the half retirement also keeps', () => {
    expect(clearanceFromDecisive(new Map([['a', { helped: 2, harmed: 1 }]]))).toEqual([]);
    expect(clearanceFromDecisive(new Map([['a', { helped: 1, harmed: 0 }]]))).toEqual([]);
  });

  it('keeps a tied record, because a tie is not evidence of harm', () => {
    // The one place clearance and retirement part company on the same input. Retirement keeps a tie
    // because two thirds is the bar for "earned removal"; clearance keeps it because the drop is a
    // claim that an item *was measured* to hurt, and a tie is a measurement of nothing.
    expect(clearanceFromDecisive(new Map([['a', { helped: 1, harmed: 1 }]]))).toEqual([]);
    expect(retireeFromDecisive(new Map([['a', { helped: 1, harmed: 1 }]]), { minDecisive: 2, harmShare: 0.5 })).toEqual([
      'a',
    ]);
  });

  it('keeps a rule nothing was ever measured about, which is what makes the arm a clearance', () => {
    // The difference from `full-verified`: an item with no record is not innocent, it is unmeasured,
    // and dropping the unmeasured would shrink the pack to almost nothing and measure dose instead.
    expect(clearanceFromDecisive(new Map([['a', { helped: 0, harmed: 0 }]]))).toEqual([]);
  });

  it('acts on a single decisive comparison, unlike retirement', () => {
    expect(clearanceFromDecisive(new Map([['a', { helped: 0, harmed: 1 }]]))).toEqual(['a']);
    expect(retireeFromDecisive(new Map([['a', { helped: 0, harmed: 1 }]]))).toEqual([]);
  });

  it('honours a raised floor, which is the setting that makes it stricter', () => {
    const credit = new Map([['a', { helped: 1, harmed: 2 }]]);
    expect(clearanceFromDecisive(credit, { minDecisive: 4 })).toEqual([]);
    expect(clearanceFromDecisive(credit, { minDecisive: 3 })).toEqual(['a']);
  });

  it('sorts, for the same digest reason as its siblings', () => {
    const credit = new Map([
      ['c', { helped: 0, harmed: 1 }],
      ['a', { helped: 0, harmed: 1 }],
      ['b', { helped: 0, harmed: 2 }],
    ]);
    expect(clearanceFromDecisive(credit)).toEqual(['a', 'b', 'c']);
  });
});

describe('parseDecisivePolicy', () => {
  it('defaults both knobs', () => {
    expect(parseDecisivePolicy({})).toEqual(DEFAULT_DECISIVE);
    expect(parseDecisivePolicy({ minDecisive: '', harmShare: '' })).toEqual(DEFAULT_DECISIVE);
  });

  it('reads both knobs', () => {
    expect(parseDecisivePolicy({ minDecisive: '3', harmShare: '0.75' })).toEqual({ minDecisive: 3, harmShare: 0.75 });
  });

  it('refuses a floor that is not a whole number of at least one', () => {
    expect(() => parseDecisivePolicy({ minDecisive: '0' })).toThrow(/decisive floor/);
    expect(() => parseDecisivePolicy({ minDecisive: '1.5' })).toThrow(/decisive floor/);
  });

  it('refuses a share outside the interval', () => {
    expect(() => parseDecisivePolicy({ harmShare: '0' })).toThrow(/harm share/);
    expect(() => parseDecisivePolicy({ harmShare: '-0.5' })).toThrow(/harm share/);
    expect(() => parseDecisivePolicy({ harmShare: '2' })).toThrow(/harm share/);
  });
});

describe('decisiveHistogram', () => {
  it('counts rules by the share of the comparisons they lost', () => {
    const credit = new Map([
      ['a', { helped: 2, harmed: 0 }],
      ['b', { helped: 1, harmed: 1 }],
      ['c', { helped: 1, harmed: 1 }],
      ['d', { helped: 0, harmed: 3 }],
    ]);
    expect(decisiveHistogram(credit)).toEqual({ '0/2': 1, '1/2': 2, '3/3': 1 });
  });

  it('omits rules no comparison touched, rather than counting them as unharmed', () => {
    expect(decisiveHistogram(new Map([['a', { helped: 0, harmed: 0 }]]))).toEqual({});
  });
});

describe('outcomeCredit', () => {
  it('credits a rule with a help when the answer was wrong without it', () => {
    expect(outcomeCredit(true, false)).toBe('helped');
  });

  it('credits a rule with a harm when the answer was right without it', () => {
    expect(outcomeCredit(false, true)).toBe('harmed');
  });

  it('says nothing when both answers agree, in either direction', () => {
    // This is the case the absolute score counted as evidence: a rule present at a wrong
    // answer. Here it is explicitly uninformative, because the answer was wrong anyway.
    expect(outcomeCredit(false, false)).toBe('uninformative');
    expect(outcomeCredit(true, true)).toBe('uninformative');
  });

  it('says nothing when a call failed, because a failed call is not an outcome', () => {
    expect(outcomeCredit(undefined, false)).toBe('uninformative');
    expect(outcomeCredit(true, undefined)).toBe('uninformative');
    expect(outcomeCredit(undefined, undefined)).toBe('uninformative');
  });
});
