/**
 * Claims per correction: the number that decides whether a store can recur at all.
 *
 * The competitive record keeps about five guidelines per learning task. R58's store held 15 claims
 * from 7 corrections, which is 2.14 per correction and roughly 0.5 per learning task — an order of
 * magnitude. That difference cannot be read from an aggregate, because the aggregate hides the shape:
 * a distiller that writes three claims from one trace and none from nine, and one that writes one
 * claim from each of three, have the same mean and different stores.
 *
 * These tests state the arithmetic, the shape, and the two ways the census must refuse to invent a
 * number: over no corrections, and over a correction that yielded nothing.
 */
import { describe, expect, it } from 'vitest';
import { claimsPerCorrection, yieldCensus, type CorrectionYield } from '../tau2-yield.js';

const row = (taskId: string, assertions: number, claims: number): CorrectionYield => ({
  taskId,
  assertions,
  claims,
});

describe('yieldCensus', () => {
  it('sums the claims and the assertions the corrections carried', () => {
    const census = yieldCensus([row('retail/0', 2, 3), row('retail/1', 1, 1)]);
    expect(census).toMatchObject({ corrections: 2, claims: 4, assertions: 3, maxClaims: 3 });
    expect(census.perCorrection).toHaveLength(2);
  });

  it('reports the median, because the mean hides a distiller that writes nothing from most traces', () => {
    // Nine corrections that yielded nothing and one that yielded three: the mean is 0.3 and the
    // median is 0. A store built the second way cannot recur, and the mean is the reading that
    // would let a reader believe otherwise.
    const rows = [row('t0', 1, 3), ...Array.from({ length: 9 }, (_, index) => row(`t${index + 1}`, 1, 0))];
    const census = yieldCensus(rows);
    expect(census.claims).toBe(3);
    expect(census.medianClaims).toBe(0);
    expect(census.maxClaims).toBe(3);
  });

  it('takes the lower middle for an even count, so the reading is a value the store holds', () => {
    const census = yieldCensus([row('t0', 1, 1), row('t1', 1, 4), row('t2', 1, 2), row('t3', 1, 3)]);
    // Sorted 1,2,3,4 — 2 rather than 2.5. A median interpolated between two counts is a number no
    // correction produced.
    expect(census.medianClaims).toBe(2);
  });

  it('reports zero over no corrections rather than dividing by nothing', () => {
    const census = yieldCensus([]);
    expect(census).toMatchObject({ corrections: 0, claims: 0, assertions: 0, maxClaims: 0, medianClaims: 0 });
    expect(census.perCorrection).toEqual([]);
  });

  it('keeps a correction that yielded nothing, because its absence is the finding', () => {
    // Dropping zero-claim corrections would turn "nine corrections produced nothing" into "three
    // corrections produced three claims", which reads as a healthy yield.
    const census = yieldCensus([row('t0', 4, 0), row('t1', 4, 0), row('t2', 4, 1)]);
    expect(census.corrections).toBe(3);
    expect(census.claims).toBe(1);
    expect(census.perCorrection.map((entry) => entry.claims)).toEqual([0, 0, 1]);
  });

  it('carries the assertions beside the claims, so a yield can be read per failed rubric item', () => {
    const census = yieldCensus([row('t0', 6, 3), row('t1', 1, 3)]);
    expect(census.assertions).toBe(7);
    // Two corrections with the same claim count and six times the material are not the same yield,
    // which is why the assertion count travels with the row rather than being summed alone.
    expect(census.perCorrection[0]).toEqual(row('t0', 6, 3));
  });

  it('copies the rows rather than aliasing the caller’s list', () => {
    const rows = [row('t0', 1, 1)];
    const census = yieldCensus(rows);
    rows.push(row('t1', 1, 5));
    expect(census.perCorrection).toHaveLength(1);
    expect(census.corrections).toBe(1);
  });
});

describe('claimsPerCorrection', () => {
  const captured = [
    { taskId: 'retail/0', runId: 'run_1', assertions: 2 },
    { taskId: 'retail/1', runId: 'run_2', assertions: 1 },
  ];
  const item = (runIds: readonly string[]): { readonly evidence: readonly { readonly runId: string }[] } => ({
    evidence: runIds.map((runId) => ({ runId })),
  });

  it('attributes an item to the correction whose run it cites', () => {
    const rows = claimsPerCorrection(captured, [item(['run_1']), item(['run_1']), item(['run_2'])]);
    expect(rows.map((row) => row.claims)).toEqual([2, 1]);
    expect(rows.map((row) => row.taskId)).toEqual(['retail/0', 'retail/1']);
  });

  it('counts an item once however many of its evidence rows name the same run', () => {
    // Two citations of one run is one claim with two rows of evidence, which is what a re-distilled
    // correction produces. Counting citations would report a yield the store does not hold.
    const rows = claimsPerCorrection(captured, [item(['run_1', 'run_1'])]);
    expect(rows[0]?.claims).toBe(1);
  });

  it('counts a retired item, because a claim folded into a paraphrase was still written', () => {
    const rows = claimsPerCorrection(captured, [item(['run_1']), item(['run_1'])]);
    expect(rows[0]?.claims).toBe(2);
  });

  it('joins on the run and not on the task, so two corrections of one task do not share claims', () => {
    const twoOfOneTask = [
      { taskId: 'retail/0', runId: 'run_1', assertions: 1 },
      { taskId: 'retail/0', runId: 'run_2', assertions: 1 },
    ];
    const rows = claimsPerCorrection(twoOfOneTask, [item(['run_1'])]);
    expect(rows.map((row) => row.claims)).toEqual([1, 0]);
  });

  it('reports a correction that wrote nothing as zero rather than dropping it', () => {
    const rows = claimsPerCorrection(captured, []);
    expect(rows.map((row) => row.claims)).toEqual([0, 0]);
    expect(yieldCensus(rows).medianClaims).toBe(0);
  });
});
