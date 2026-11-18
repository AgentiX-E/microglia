import { describe, expect, it } from 'vitest';
import { SWEEP_RUNGS, marginSweep, serveSweepLine, type PricedRender } from '../serve-sweep.js';

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
