import { describe, expect, it } from 'vitest';
import { opportunitiesForEvidence, yieldCensus, yieldLine, type ServeRender } from '../serve-yield.js';

/**
 * What a served record could have done, before asking what it did.
 *
 * Every case here is a way a per-render statistic can be read as a statement about a record when it is a
 * statement about the corpus: a render on a trial the bare agent already passed, a record with nine renders and
 * one opportunity, a break with no opportunity at all, and a quarantine rule that fires on n = 1.
 */
const render = (itemId: string, controlPassed: boolean, memoryPassed: boolean): ServeRender => ({
  itemId,
  controlPassed,
  memoryPassed,
});

describe('yieldCensus', () => {
  it('separates the renders a claim could have repaired from the ones it could only lose', () => {
    // Three renders on trials the control failed (two repaired, one not) and two it passed (one broken, one
    // kept). The opportunity is the three, and the repair rate is over them rather than over all five.
    const census = yieldCensus([
      render('a', false, true),
      render('a', false, false),
      render('a', false, true),
      render('a', true, true),
      render('a', true, false),
    ]);
    expect(census.renders).toBe(5);
    expect(census.opportunity).toBe(3);
    expect(census.repairs).toBe(2);
    expect(census.breaks).toBe(1);
    expect(census.inert).toBe(2);
    expect(census.repairRate).toBeCloseTo(2 / 3, 10);
    expect(census.items[0]).toMatchObject({
      itemId: 'a',
      renders: 5,
      opportunity: 3,
      repairs: 2,
      breaks: 1,
      inert: 2,
    });
    // P(X ≤ 2) at n = 3 and p = 2/3, which is 1 − P(3) = 0.7037: two repairs out of three is below the record's
    // own rate, but not far enough below it to be evidence at five per cent.
    expect(census.items[0]?.inertP).toBeCloseTo(0.7037, 4);
  });

  it('gives a record with no opportunity a tail of one, because it failed at nothing it could do', () => {
    // R141's breaking record: one render, on a trial the bare agent passed, and it broke it. A rule that
    // counted "zero repairs" would read this as the worst record in the store.
    const census = yieldCensus([render('breaker', true, false)]);
    expect(census.items[0]?.opportunity).toBe(0);
    expect(census.items[0]?.breaks).toBe(1);
    expect(census.items[0]?.inertP).toBe(1);
    expect(census.candidates).toEqual([]);
  });

  it('refuses to call a record useless when its renders were overwhelmingly inert by construction', () => {
    // Nine renders, one opportunity — R141's most-served record. A base rate of 0.7 gives a tail of 0.3 on one
    // opportunity, which is not evidence of anything, and that is the whole argument against the counter R138
    // refused: the denominator was the corpus's headroom, not the record's behaviour.
    const rows = [
      ...Array.from({ length: 8 }, () => render('quiet', true, true)),
      render('quiet', false, false),
    ];
    const census = yieldCensus(rows);
    expect(census.items[0]?.renders).toBe(9);
    expect(census.items[0]?.opportunity).toBe(1);
    expect(census.items[0]?.inertP).toBeCloseTo(1, 10);
    expect(census.candidates).toEqual([]);
  });

  it('flags a record that had the opportunities and repaired none of them', () => {
    // Four opportunities, no repair, against a rate of one in two: P(X = 0) = 0.0625, which is under the bar only
    // when the rest of the store repairs half of what it is offered. That is the rule's whole content.
    const rows = [
      render('lazy', false, false),
      render('lazy', false, false),
      render('lazy', false, false),
      render('lazy', false, false),
      render('good', false, true),
      render('good', false, true),
      render('good', false, true),
      render('good', false, true),
    ];
    const census = yieldCensus(rows, 0.1);
    expect(census.repairRate).toBeCloseTo(0.5, 10);
    expect(census.items.find((item) => item.itemId === 'lazy')?.inertP).toBeCloseTo(0.0625, 10);
    expect(census.candidates).toEqual(['lazy']);
  });

  it('says how many opportunities a record needs before zero repairs is evidence at this rate', () => {
    // The number a registration has to plan for, computed from the corpus's own rate rather than tabulated:
    // 0.175 needs seventeen opportunities, which no 40-task arm produces per record.
    expect(opportunitiesForEvidence(0.175)).toBe(16);
    expect(opportunitiesForEvidence(0.5)).toBe(5);
    expect(opportunitiesForEvidence(0)).toBe(Number.POSITIVE_INFINITY);
    expect(opportunitiesForEvidence(1)).toBe(Number.POSITIVE_INFINITY);
  });

  it('orders the records by id so two runs of one artefact print the same table', () => {
    const census = yieldCensus([render('b', false, true), render('a', true, true)]);
    expect(census.items.map((item) => item.itemId)).toEqual(['a', 'b']);
  });
});

describe('yieldLine', () => {
  it('prints the opportunity share and the inert share, which are the two numbers a reader needs', () => {
    const census = yieldCensus([
      render('a', false, true),
      render('a', false, false),
      render('a', true, true),
      render('a', true, true),
    ]);
    const line = yieldLine(census);
    expect(line).toContain('4 render(s) over 1 record(s)');
    expect(line).toContain('2 landed where a repair was possible (50.00%)');
    expect(line).toContain('1 repaired, 0 broke, 3 inert (75.00%)');
    // Rate 0.5, so (1 − 0.5)^n ≤ 0.05 first at n = 5.
    expect(line).toContain('a record needs 5 opportunities before zero repairs is evidence');
  });

  it('says a store that repaired every opportunity has no threshold, instead of printing infinity', () => {
    // (1 − 1)^n = 0 for every n, so no sample can separate a record at this rate. On a one-opportunity arm that
    // is the honest sentence, and `Infinity` is the number a reader would take for a very large requirement.
    const line = yieldLine(yieldCensus([render('a', false, true), render('a', true, true)]));
    expect(line).toContain('no number of opportunities separates a record at this rate');
    expect(line).not.toContain('Infinity');
  });

  it('names the candidates when a record is below its own rate', () => {
    const rows = [
      render('lazy', false, false),
      render('lazy', false, false),
      render('lazy', false, false),
      render('lazy', false, false),
      render('good', false, true),
      render('good', false, true),
      render('good', false, true),
      render('good', false, true),
    ];
    expect(yieldLine(yieldCensus(rows, 0.1))).toContain('1 record(s) below their own rate at 5%: lazy');
  });

  it('says a run that rendered nothing rendered nothing, rather than dividing by zero', () => {
    expect(yieldLine(yieldCensus([]))).toBe('serve yield: no render was made, so no yield can be read');
  });
});
