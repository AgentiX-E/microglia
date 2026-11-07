import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import {
  COVERAGE_FLOORS,
  type CoverageHistogram,
  type UseCensus,
} from '../tau2-use-census.js';
import { decideFloor, type CostWeights } from '../u3-decision.js';

/**
 * U3's floor decision, tested against the R47 committed artefact. The fixture
 * is the real `arms/memory/poc-l4.json` coverage/use pair from run 42337250684
 * on bc0a39eb, fingerprinted so a silent population change fails the suite.
 * No mock: every assertion runs on the committed measurement.
 */
const FIXTURE = join(process.cwd(), 'eval/fixtures/tau2-r47-coverage-histogram.json');
const fixtureBytes = readFileSync(FIXTURE);
const fixture = JSON.parse(fixtureBytes.toString('utf8')) as {
  readonly source: { readonly run: string; readonly pinnedCommit: string; readonly arm: string };
  readonly coverage: CoverageHistogram;
  readonly use: UseCensus;
};
const coverage = fixture.coverage;
const use = fixture.use;

/** Registered cost weights; the real curve is sensitive to them, so no default. */
const FALSE_POSITIVE_AVERSE: CostWeights = { alpha: 1, gamma: 3, beta: 0.5 };
const SYMMETRIC: CostWeights = { alpha: 1, gamma: 1, beta: 0.5 };
const ABSTENTION_AVERSE: CostWeights = { alpha: 1, gamma: 0.5, beta: 3 };

function withFloors(rows: CoverageHistogram['floors']): CoverageHistogram {
  return { ...coverage, floors: rows };
}

describe('the R47 committed fixture', () => {
  it('is the fingerprinted real artefact, not a synthetic substitute', () => {
    expect(fixtureBytes.length).toBe(2239);
    expect(createHash('sha256').update(fixtureBytes).digest('hex')).toBe(
      '33d2006acb8d0c66fa732d16a5e0d42f5c26370efc65def01857a0371c3f5b9c',
    );
    expect(fixture.source.run).toBe('42337250684');
    expect(fixture.source.pinnedCommit).toBe('bc0a39eb');
    expect(fixture.source.arm).toBe('memory');
  });

  it('carries the ten-rung grid and the reconciled populations', () => {
    expect(coverage.floors).toHaveLength(COVERAGE_FLOORS.length);
    expect(coverage.measuredPairs + coverage.unmeasurablePairs).toBe(use.injectedPairs);
    expect(coverage.floors[0]?.retainedPacks! + coverage.floors[0]?.emptiedPacks! + coverage.unmeasurablePacks).toBe(
      use.recallServed,
    );
  });
});

describe('decideFloor over the committed curve', () => {
  it('takes only committed structure and registered weights, never accuracy', () => {
    expect(decideFloor.length).toBe(3);
    const d = decideFloor(coverage, use, FALSE_POSITIVE_AVERSE);
    expect(d.reason).toMatch(/structure/i);
  });

  it('is deterministic over the same committed input', () => {
    expect(decideFloor(coverage, use, FALSE_POSITIVE_AVERSE)).toEqual(
      decideFloor(coverage, use, FALSE_POSITIVE_AVERSE),
    );
  });

  it('returns one cost row per rung and reconciles each row to the histogram', () => {
    const d = decideFloor(coverage, use, FALSE_POSITIVE_AVERSE);
    expect(d.curve).toHaveLength(COVERAGE_FLOORS.length);
    d.curve.forEach((row, i) => {
      const rung = coverage.floors[i]!;
      expect(row.minCoverage).toBe(rung.minCoverage);
      expect(row.relevantPairs + row.falsePositivePairs).toBe(rung.retainedPairs);
      expect(row.abstainedPacks).toBe(rung.emptiedPacks);
      expect(Number.isFinite(row.net)).toBe(true);
    });
  });

  it('derives the zero-rung false positives from the census and the histogram', () => {
    const d = decideFloor(coverage, use, FALSE_POSITIVE_AVERSE);
    const measurableZero = use.zeroCoveragePairs - coverage.unmeasurablePairs;
    expect(d.curve[0]?.falsePositivePairs).toBe(measurableZero);
    expect(d.curve[0]?.relevantPairs + d.curve[0]?.falsePositivePairs).toBe(coverage.measuredPairs);
    for (const row of d.curve.slice(1)) expect(row.falsePositivePairs).toBe(0);
  });

  it('selects 0.01 under false-positive-averse and symmetric weights on the real curve', () => {
    expect(decideFloor(coverage, use, FALSE_POSITIVE_AVERSE).admissible).toEqual([0.01]);
    expect(decideFloor(coverage, use, SYMMETRIC).admissible).toEqual([0.01]);
    expect(decideFloor(coverage, use, FALSE_POSITIVE_AVERSE).chosen).toBe(0.01);
  });

  it('records that the real curve is NOT cost-robust: abstention-averse weights keep the as-is floor', () => {
    const d = decideFloor(coverage, use, ABSTENTION_AVERSE);
    expect(d.admissible).toEqual([0]);
    expect(d.chosen).toBe(0);
  });

  it('exposes the least-aggressive tie-break when a plateau ties', () => {
    // Copy rung 1's counts onto rungs 2 and 3, KEEPING their minCoverage so the
    // grid and pack identities still hold. The three rungs then carry identical
    // net cost and must form the admissible plateau.
    const one = coverage.floors[1]!;
    const rows = coverage.floors.map((r, i) =>
      i === 2 || i === 3
        ? { minCoverage: r.minCoverage, retainedPairs: one.retainedPairs, retainedPacks: one.retainedPacks, emptiedPacks: one.emptiedPacks }
        : r,
    );
    const d = decideFloor(withFloors(rows), use, FALSE_POSITIVE_AVERSE);
    expect(d.admissible.length).toBeGreaterThan(1);
    expect(d.chosen).toBe(Math.min(...d.admissible));
    expect(d.tieBreak).toBe('least-aggressive');
  });

  it('marks a unique argmax as unique', () => {
    expect(decideFloor(coverage, use, FALSE_POSITIVE_AVERSE).tieBreak).toBe('unique');
  });
});

describe('decideFloor refuses an invalid committed population', () => {
  const refuse = (c: CoverageHistogram, u: UseCensus = use) =>
    decideFloor(c, u, FALSE_POSITIVE_AVERSE);

  it('refuses a wrong grid length', () => {
    const d = refuse(withFloors(coverage.floors.slice(1)));
    expect(d.chosen).toBeUndefined();
    expect(d.admissible).toHaveLength(0);
    expect(d.reason).toMatch(/grid/i);
  });

  it('refuses a grid whose first rung is not zero', () => {
    const rows = coverage.floors.map((r, i) => (i === 0 ? { ...r, minCoverage: 0.005 } : r));
    expect(refuse(withFloors(rows)).reason).toMatch(/grid/i);
  });

  it('refuses grid values that are not the registered COVERAGE_FLOORS', () => {
    const rows = coverage.floors.map((r, i) => (i === 4 ? { ...r, minCoverage: 0.06 } : r));
    expect(refuse(withFloors(rows)).reason).toMatch(/grid/i);
  });

  it('refuses a broken pair-population identity', () => {
    expect(refuse(coverage, { ...use, injectedPairs: use.injectedPairs + 1 }).reason).toMatch(/pair/i);
  });

  it('refuses a broken pack-population identity', () => {
    expect(refuse(coverage, { ...use, recallServed: use.recallServed + 1 }).reason).toMatch(/pack/i);
  });

  it('refuses a zero rung that does not retain measuredPairs', () => {
    const rows = coverage.floors.map((r, i) => (i === 0 ? { ...r, retainedPairs: r.retainedPairs - 1 } : r));
    expect(refuse(withFloors(rows)).reason).toMatch(/zero rung/i);
  });

  it('refuses a zero rung that empties a pack', () => {
    // Keep the pack identity intact (retainedPacks down by one, emptiedPacks up
    // by one) so the refusal comes from the zero-rung rule, not the pack rule.
    const rows = coverage.floors.map((r, i) =>
      i === 0 ? { ...r, retainedPacks: r.retainedPacks - 1, emptiedPacks: 1 } : r,
    );
    expect(refuse(withFloors(rows)).reason).toMatch(/zero rung/i);
  });

  it('refuses an inverted quantile sequence', () => {
    const bad: CoverageHistogram = {
      ...coverage,
      nonzeroQuantiles: { ...coverage.nonzeroQuantiles, p50: -0.1 },
    };
    expect(refuse(bad).reason).toMatch(/quantile/i);
  });

  it('refuses a negative measurable zero-coverage count', () => {
    expect(refuse(coverage, { ...use, zeroCoveragePairs: 0 }).reason).toMatch(/zero-coverage/i);
  });

  it('refuses a non-monotone retention curve', () => {
    const rows = coverage.floors.map((r, i) => (i === 5 ? { ...r, retainedPairs: coverage.floors[4]!.retainedPairs + 10 } : r));
    expect(refuse(withFloors(rows)).reason).toMatch(/monoton/i);
  });

  it('never returns a floor outside the registered grid', () => {
    const d = decideFloor(coverage, use, FALSE_POSITIVE_AVERSE);
    for (const f of d.admissible) expect(COVERAGE_FLOORS).toContain(f);
  });
});
