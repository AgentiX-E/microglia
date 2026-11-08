import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  REVERT_DELTA_BAR_PP,
  REVERT_P_BAR,
  type PairedReading,
  revertRule,
} from '../l4-revert.js';

/**
 * The R45 revert rule is a governance invariant, not an interpretation. It was
 * registered in prereg/R45-admission.md and re-stated unchanged in R46, R47 and
 * R48: "If l4-paired is significantly negative, OR falls below -5pp with a
 * served pack, revert on the reading, not on the explanation."
 *
 * `l4-paired` is the gate in l4-pair.ts that pairs the memory arm against the
 * memory-free reference arm inside ONE dispatch. It is NOT the cross-run delta
 * between two memory arms, which measures a treatment's contribution. The
 * offline R48 verifier once bound this rule to the cross-run delta and wrongly
 * reported `revert=false`; AUDIT 34.35 records that defect. These tests encode
 * the rule against real committed readings so a future verifier cannot repeat
 * the mistake, and the function's type rejects a cross-run reading outright.
 */
const FIXTURE = join(process.cwd(), 'eval/fixtures/tau2-l4-paired-readings.json');
const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8')) as {
  readonly description: string;
  readonly readings: readonly {
    readonly id: string;
    readonly run: string;
    readonly artefact: string;
    readonly l4Paired: PairedReading;
    readonly servedPacks: number;
    readonly expected: { readonly fires: boolean; readonly branch: string };
  }[];
};

const within = (deltaPp: number, p: number, paired = 50): PairedReading => ({
  scope: 'within-run',
  deltaPp,
  p,
  paired,
});

const cross = (deltaPp: number, p: number, paired = 50): PairedReading => ({
  scope: 'cross-run',
  deltaPp,
  p,
  paired,
});

describe('revertRule — the registered R45 invariant', () => {
  it('exports the two registered thresholds', () => {
    expect(REVERT_DELTA_BAR_PP).toBe(-5);
    expect(REVERT_P_BAR).toBe(0.05);
  });

  it('reproduces every real committed reading exactly', () => {
    // R49 (-4.00pp at p=0.6875 with 949 served packs) joined the fixture with
    // R50: it is the reading that fires neither branch, and the one that made
    // the old `delta >= 0 && p < 0.05` gate unreachable.
    expect(fixture.readings).toHaveLength(3);
    for (const row of fixture.readings) {
      const verdict = revertRule(row.l4Paired, row.servedPacks);
      expect({ id: row.id, fires: verdict.fires }, row.id).toEqual({
        id: row.id,
        fires: row.expected.fires,
      });
      expect(verdict.branch, row.id).toBe(row.expected.branch);
    }
  });

  it('R47 +12pp does not fire on either branch', () => {
    const r47 = fixture.readings.find((r) => r.id === 'R47')!;
    const v = revertRule(r47.l4Paired, r47.servedPacks);
    expect(v.fires).toBe(false);
    expect(v.branch).toBe('clear');
  });

  it('R48 -6pp with 965 served packs fires on the below-bar branch even though p=0.4531 is not significant', () => {
    const r48 = fixture.readings.find((r) => r.id === 'R48')!;
    const v = revertRule(r48.l4Paired, r48.servedPacks);
    expect(v.fires).toBe(true);
    expect(v.branch).toBe('below-bar-with-served-pack');
    expect(r48.l4Paired.p).toBeGreaterThan(REVERT_P_BAR);
    expect(v.reason).toMatch(/served/i);
  });

  it('fires on the significant-negative branch for a negative delta at p < 0.05', () => {
    const v = revertRule(within(-2, 0.01), 1491);
    expect(v.fires).toBe(true);
    expect(v.branch).toBe('significantly-negative');
  });

  it('does not fire for a positive delta at p < 0.05', () => {
    const v = revertRule(within(2, 0.01), 1491);
    expect(v.fires).toBe(false);
  });

  it('does not fire for a non-significant negative delta above the -5pp bar', () => {
    const v = revertRule(within(-4, 0.45), 1491);
    expect(v.fires).toBe(false);
    expect(v.branch).toBe('clear');
  });

  it('the -5pp bar is strict: exactly -5 does not fire the below-bar branch', () => {
    const v = revertRule(within(-5, 0.45), 1491);
    expect(v.fires).toBe(false);
  });

  it('the p bar is strict: exactly 0.05 does not fire the significant branch', () => {
    const v = revertRule(within(-2, 0.05), 1491);
    expect(v.fires).toBe(false);
  });

  it('a served pack is required for the below-bar branch', () => {
    const v = revertRule(within(-6, 0.45), 0);
    expect(v.fires).toBe(false);
    expect(v.branch).toBe('clear');
  });

  it('significant-negative branch fires even with zero served packs', () => {
    const v = revertRule(within(-2, 0.01), 0);
    expect(v.fires).toBe(true);
    expect(v.branch).toBe('significantly-negative');
  });

  it('refuses a cross-run reading instead of silently grading it', () => {
    expect(() => revertRule(cross(-4, 0.6875), 965)).toThrow(/cross-run/i);
    expect(() => revertRule(cross(-6, 0.01), 965)).toThrow(/cross-run/i);
  });

  it('refuses a non-finite or out-of-range reading', () => {
    expect(() => revertRule(within(Number.NaN, 0.4), 965)).toThrow(/finite/i);
    expect(() => revertRule(within(-6, 1.5), 965)).toThrow(/range/i);
    expect(() => revertRule(within(-6, -0.1), 965)).toThrow(/range/i);
    expect(() => revertRule(within(-6, 0.4), -1)).toThrow(/served/i);
    expect(() => revertRule(within(-6, 0.4), Number.NaN)).toThrow(/served/i);
  });

  it('a zero paired count is not a reading', () => {
    expect(() => revertRule(within(-6, 0.4, 0), 965)).toThrow(/paired/i);
  });
});
