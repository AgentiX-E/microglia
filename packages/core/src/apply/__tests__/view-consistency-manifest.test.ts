/**
 * R246 — the three-reader agreement, pinned.
 *
 * `eval/manifests/view-consistency.json` is derived by the Python reader (`eval/tools/view_consistency.py
 * --verify`) from the fixture's bytes. This test derives the same reading with the product's own `viewConsensus`
 * over those same bytes and compares every field. If the product and the evaluation ever disagree about whether a
 * candidate is fragile, consistent-help, or insufficient, exactly one of these two readers fails and the build
 * stops. That is the point: "the product ships the gate the measurement read" becomes a checked property.
 *
 * Gains are floats divided by injected counts; both readers use IEEE-754 doubles and the comparison is within a
 * tight absolute tolerance, which is the correct way to compare a quotient computed in two languages.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { viewConsensus, type ViewUtility } from '../view-consistency.js';

const ROOT = process.cwd() + '/';
const fixture = JSON.parse(readFileSync(`${ROOT}eval/fixtures/view-consistency.json`, 'utf8')) as {
  schema: string;
  cases: {
    id: string;
    candidate: string;
    views: ViewUtility[];
    minViews?: number;
  }[];
};
const manifest = JSON.parse(readFileSync(`${ROOT}eval/manifests/view-consistency.json`, 'utf8')) as {
  schema: string;
  fixtureSchema: string;
  cases: {
    id: string;
    expected: {
      verdict: string;
      admit: boolean;
      views: number;
      positive: number;
      negative: number;
      zero: number;
      net: number;
      gains: number[];
      spread: number;
      minViews: number;
    };
  }[];
};

describe('R246 product-reader agreement', () => {
  it('the manifest describes the same fixture', () => {
    expect(manifest.fixtureSchema).toBe(fixture.schema);
    expect(manifest.cases).toHaveLength(fixture.cases.length);
  });

  for (let index = 0; index < fixture.cases.length; index += 1) {
    const source = fixture.cases[index] as (typeof fixture.cases)[number];
    const declared = manifest.cases[index] as (typeof manifest.cases)[number];

    it(`case ${source.id}: product and evaluation agree field by field`, () => {
      expect(declared.id).toBe(source.id);
      const derived = viewConsensus(source.views, { minViews: source.minViews });
      const expected = declared.expected;

      expect(derived.verdict).toBe(expected.verdict);
      expect(derived.admit).toBe(expected.admit);
      expect(derived.views).toBe(expected.views);
      expect(derived.positive).toBe(expected.positive);
      expect(derived.negative).toBe(expected.negative);
      expect(derived.zero).toBe(expected.zero);
      expect(derived.net).toBe(expected.net);
      expect(derived.minViews).toBe(expected.minViews);
      expect(derived.gains).toHaveLength(expected.gains.length);
      for (let i = 0; i < derived.gains.length; i += 1) {
        expect(Math.abs((derived.gains[i] as number) - (expected.gains[i] as number))).toBeLessThan(1e-12);
      }
      expect(Math.abs(derived.spread - expected.spread)).toBeLessThan(1e-12);
    });
  }
});
