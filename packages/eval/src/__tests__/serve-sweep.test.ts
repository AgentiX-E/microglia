import { describe, expect, it } from 'vitest';
import {
  SWEEP_RUNGS,
  marginRanking,
  marginSweep,
  rankingLine,
  serveSweepLine,
  type PricedRender,
} from '../serve-sweep.js';

/**
 * The rung, priced against outcomes.
 *
 * Every case here is a decision the next dispatch's registration reads: whether a rung is clean, what it
 * costs in repairs, and whether the trials a pack serves one record each can be priced at all. The
 * arithmetic is small and the failure mode is not — a sweep that silently pools two trials, or that treats
 * an unmeasured margin as a withholding, prices a rung the arm never ran at.
 */

function render(input: Partial<PricedRender> & { readonly task: string }): PricedRender {
  return {
    itemId: 'k1',
    controlPassed: false,
    memoryPassed: false,
    ...input,
  };
}

/** A trial the memory repaired: the control failed it and the memory passed it. */
function kept(task: string, margin?: number | null): PricedRender {
  return render({ task, controlPassed: false, memoryPassed: true, ...(margin === undefined ? {} : { margin }) });
}

/** A trial the memory broke: the control passed it and the memory failed it. */
function broke(task: string, margin?: number | null): PricedRender {
  return render({ task, controlPassed: true, memoryPassed: false, ...(margin === undefined ? {} : { margin }) });
}

/** A trial both arms passed, or both failed: the render that could change nothing. */
function inert(task: string, margin?: number | null): PricedRender {
  return render({ task, controlPassed: true, memoryPassed: true, ...(margin === undefined ? {} : { margin }) });
}

describe('the rungs a sweep is priced at', () => {
  it('are the ladder\'s own grid, ascending, starting at zero', () => {
    expect(SWEEP_RUNGS[0]).toBe(0);
    expect([...SWEEP_RUNGS]).toEqual([...SWEEP_RUNGS].sort((left, right) => left - right));
    expect(SWEEP_RUNGS).toContain(0.1);
    expect(SWEEP_RUNGS).toContain(0.3);
  });

  it('prices a caller\'s own rungs in ascending order whatever order they arrive in', () => {
    const reading = marginSweep([kept('a', 0.2), broke('b', 0.05)], [0.2, 0, 0.1]);
    expect(reading.rows.map((row) => row.rung)).toEqual([0, 0.1, 0.2]);
  });

  it('refuses a render with no trial, because a gate acts on a request and this prices trials', () => {
    const anonymous: PricedRender = { itemId: 'k1', controlPassed: false, memoryPassed: true, margin: 0.2 };
    expect(() => marginSweep([anonymous])).toThrow(/served into, and one render carries no task/u);
  });

  it('prices an empty population at zero rather than at a mean of nothing', () => {
    const reading = marginSweep([]);
    expect(reading.trials).toBe(0);
    expect(reading.unpriced).toBe(0);
    expect(reading.firstClean).toBeNull();
    expect(reading.rows.every((row) => row.served === 0 && row.netPp === 0)).toBe(true);
    expect(serveSweepLine(reading)).toBe(
      'serve sweep: no trial carries a priced render, so no rung can be priced',
    );
  });
});

describe('what a rung would have done', () => {
  it('withholds the trial whose margin is below it and keeps the one above', () => {
    const reading = marginSweep([kept('a', 0.2), broke('b', 0.05)], [0, 0.1]);
    const [atZero, atTen] = reading.rows;
    expect(atZero).toMatchObject({ rung: 0, served: 2, withheld: 0, kept: 1, broke: 1, net: 0, partial: 0 });
    expect(atTen).toMatchObject({ rung: 0.1, served: 1, withheld: 1, kept: 1, broke: 0, net: 1, partial: 0 });
    expect(reading.firstClean?.rung).toBe(0.1);
  });

  it('serves a margin exactly at the rung, because the gate withholds only below it', () => {
    const reading = marginSweep([kept('a', 0.1)], [0.1]);
    expect(reading.rows[0]).toMatchObject({ served: 1, withheld: 0, partial: 0 });
  });

  it('leaves an unpriced trial served at every rung and counts it once', () => {
    const reading = marginSweep([kept('a'), broke('b', 0.9)], [0, 0.5, 0.95]);
    expect(reading.unpriced).toBe(1);
    expect(reading.rows.map((row) => row.served)).toEqual([2, 2, 1]);
    expect(reading.rows[2]).toMatchObject({ kept: 1, broke: 0, net: 1 });
  });

  it('treats a measured null as unpriced too, so a one-candidate pack is never withheld', () => {
    const reading = marginSweep([broke('a', null)], [0.3]);
    expect(reading.unpriced).toBe(1);
    expect(reading.rows[0]).toMatchObject({ served: 1, broke: 1, net: -1 });
  });

  it('counts a trial as served while one of its records survives, and names it partial', () => {
    const reading = marginSweep(
      [kept('a', 0.2), { ...kept('a', 0.02), itemId: 'k2' }, broke('b', 0.02)],
      [0.1],
    );
    expect(reading.rows[0]).toMatchObject({ served: 1, withheld: 1, partial: 1, kept: 1, broke: 0 });
  });

  it('divides the net by every trial, not by the served ones, so a rung is comparable with a delta', () => {
    // Three trials, one repaired and one broken and one inert: a rung that withholds the break nets one
    // repair over three trials, which is +33.33pp and not +50pp over the two it served.
    const reading = marginSweep([kept('a', 0.3), broke('b', 0.05), inert('c', 0.3)], [0.1]);
    expect(reading.rows[0]).toMatchObject({ served: 2, kept: 1, broke: 0, net: 1 });
    expect(reading.rows[0]?.netPp).toBeCloseTo(100 / 3, 10);
  });

  it('reports no clean rung when every rung that silences the harm also silences the repairs', () => {
    // Both renders sit below every rung above zero, so the only clean rung is the one that serves nothing.
    const reading = marginSweep([kept('a', 0.01), broke('b', 0.01)], [0, 0.05]);
    expect(reading.rows[1]).toMatchObject({ served: 0, withheld: 2, kept: 0, broke: 0 });
    expect(reading.firstClean).toBeNull();
    expect(serveSweepLine(reading)).toContain('no rung withholds every break and keeps a repair');
  });

  it('names the cheapest clean rung, which is the first one in ascending order', () => {
    const reading = marginSweep([kept('a', 0.2), broke('b', 0.05), broke('c', 0.02)], [0, 0.1, 0.3]);
    expect(reading.firstClean).toMatchObject({ rung: 0.1, kept: 1, broke: 0, served: 1 });
  });
});

describe('the line a readback quotes', () => {
  it('states the rung, what it costs, and the whole table', () => {
    const line = serveSweepLine(marginSweep([kept('a', 0.2), broke('b', 0.05)], [0, 0.1]));
    expect(line).toContain('the first rung that withholds every break is 0.10');
    expect(line).toContain('keeps 1 repair(s) and serves 1 of 2 trial(s)');
    expect(line).toContain('net by rung 0.00 +0.00 / 0.10 +50.00');
    expect(line).toContain('estimated, withholding is priced as the control outcome');
  });

  it('signs a net loss and a net gain differently', () => {
    const loss = serveSweepLine(marginSweep([broke('a', 0.2)], [0]));
    expect(loss).toContain('0.00 -100.00');
    const gain = serveSweepLine(marginSweep([kept('a', 0.2)], [0]));
    expect(gain).toContain('0.00 +100.00');
  });

  it('says how many trials carried no margin at all, and says nothing when none did', () => {
    const withUnpriced = serveSweepLine(marginSweep([kept('a'), broke('b', 0.5)], [0]));
    expect(withUnpriced).toContain('1 trial(s) carried no margin and are served at every rung');
    const fullyPriced = serveSweepLine(marginSweep([kept('a', 0.5), broke('b', 0.5)], [0]));
    expect(fullyPriced).not.toContain('carried no margin');
  });
});

describe('whether the margin orders a repair above a break', () => {
  it('is 1 when every repair outranks every break, and the exact null says how surprising that is', () => {
    const ranking = marginRanking([kept('a', 0.4), kept('b', 0.3), broke('c', 0.2), broke('d', 0.1)]);
    expect(ranking).toMatchObject({ kept: 2, broke: 2, auc: 1, labellings: 6, enumerable: true });
    // Exactly one of the six ways of splitting four margins into two groups of two separates perfectly, and
    // it is the one observed: 1/6 is the smallest p an exact test can report on two against two, which is the
    // arithmetic behind "a single clean pair is not evidence".
    expect(ranking.p).toBeCloseTo(1 / 6, 10);
  });

  it('is 0 when every repair sits below every break, and then no labelling is better than chance', () => {
    const ranking = marginRanking([kept('a', 0.1), broke('b', 0.2)]);
    expect(ranking.auc).toBe(0);
    expect(ranking.p).toBe(1);
  });

  it('counts a tie as half a win, so an all-tied population is exactly chance', () => {
    const ranking = marginRanking([kept('a', 0.2), broke('b', 0.2)]);
    expect(ranking.auc).toBe(0.5);
    expect(ranking.p).toBe(1);
  });

  it('excludes a trial whose margin was never measured, because it cannot be ranked', () => {
    const ranking = marginRanking([kept('a'), kept('b', 0.3), broke('c', 0.1)]);
    expect(ranking).toMatchObject({ kept: 1, broke: 1, auc: 1, labellings: 2 });
  });

  it('ranks the trial once, by its highest margin, not once per record served into it', () => {
    const ranking = marginRanking([
      { ...kept('a', 0.9), itemId: 'k1' },
      { ...kept('a', 0.1), itemId: 'k2' },
      broke('b', 0.5),
    ]);
    expect(ranking).toMatchObject({ kept: 1, broke: 1, auc: 1 });
  });

  it('refuses an exact null it cannot walk, and says how many labellings it would have taken', () => {
    const renders = [
      ...Array.from({ length: 9 }, (_, index) => kept(`k${String(index)}`, 0.5 + index / 100)),
      ...Array.from({ length: 9 }, (_, index) => broke(`b${String(index)}`, 0.1 + index / 100)),
    ];
    const ranking = marginRanking(renders);
    expect(ranking.enumerable).toBe(false);
    expect(ranking.auc).toBe(1);
    expect(ranking.p).toBeNull();
    expect(ranking.labellings).toBe(48620);
    expect(rankingLine(ranking)).toContain('the exact null was not walked (48620 labellings)');
  });

  it('names which side is empty rather than reporting a ranking of nothing', () => {
    const noRepair = rankingLine(marginRanking([broke('a', 0.2)]));
    const noBreak = rankingLine(marginRanking([kept('a', 0.2)]));
    expect(noRepair).toBe('no repaired trial carries a margin, so the ranking has nothing to order');
    expect(noBreak).toBe('no broken trial carries a margin, so the ranking has nothing to order');
  });

  it('is carried by the sweep, so a reader of the line cannot see the rungs without the ranking', () => {
    const reading = marginSweep([kept('a', 0.4), broke('b', 0.1)], [0]);
    expect(reading.ranking).toMatchObject({ kept: 1, broke: 1, auc: 1, labellings: 2 });
    expect(serveSweepLine(reading)).toContain('exact p 0.500 over 2 labelling(s)');
  });
});
