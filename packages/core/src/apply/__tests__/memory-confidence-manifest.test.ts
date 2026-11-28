/**
 * R252 — product / evaluation agreement, pinned field by field.
 *
 * `eval/manifests/memory-confidence.json` is derived by the independent Python reader from the fixture's
 * bytes. This test derives the same reading with the product's own `memoryConfidence` over those same bytes
 * and compares every field. If the product and the evaluation ever disagree about a confidence score or an
 * abstention decision, exactly one of the two readers fails and the build stops.
 *
 * All fields are integers or strings, so there is no float comparison here.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { memoryConfidence, type MemoryConfidenceInput } from '../memory-confidence.js';

const ROOT = process.cwd() + '/';
const fixture = JSON.parse(readFileSync(`${ROOT}eval/fixtures/memory-confidence.json`, 'utf8')) as {
  schema: string;
  cases: { id: string; input: MemoryConfidenceInput; note?: string }[];
};
const manifest = JSON.parse(readFileSync(`${ROOT}eval/manifests/memory-confidence.json`, 'utf8')) as {
  schema: string;
  fixtureSchema: string;
  cases: {
    id: string;
    expected: {
      id: string;
      verdict: string;
      reason: string;
      decidingId: string;
      decidingScoreMilli: number;
      itemCount: number;
      admitCount: number;
      reweightCount: number;
      abstainCount: number;
    };
  }[];
};

describe('R252 product-reader agreement', () => {
  it('the manifest describes the same fixture', () => {
    expect(manifest.fixtureSchema).toBe(fixture.schema);
    expect(manifest.cases).toHaveLength(fixture.cases.length);
  });

  it('every verdict and reason is exercised by the fixture', () => {
    const verdicts = new Set(manifest.cases.map((entry) => entry.expected.verdict));
    const reasons = new Set(manifest.cases.map((entry) => entry.expected.reason));
    expect([...verdicts].sort()).toEqual(['abstain', 'admit', 'reweight']);
    expect([...reasons].sort()).toEqual([
      'below-threshold',
      'conflict-overwhelms',
      'marginal',
      'reliable',
    ]);
  });

  it('binds the MMA conflict-overwhelms scenario explicitly', () => {
    const entry = manifest.cases.find((c) => c.id === 'conflict-overwhelms');
    expect(entry).toBeDefined();
    expect(entry?.expected.verdict).toBe('abstain');
    expect(entry?.expected.reason).toBe('conflict-overwhelms');
    expect(entry?.expected.decidingScoreMilli).toBe(75);
  });

  it('binds the weighted-consensus arithmetic', () => {
    const entry = manifest.cases.find((c) => c.id === 'weighted-consensus');
    expect(entry?.expected.decidingScoreMilli).toBe(790);
  });

  it('binds the mixed set where one conflict dominates', () => {
    const entry = manifest.cases.find((c) => c.id === 'reject-dominates-mixed');
    expect(entry?.expected.decidingId).toBe('bad');
    expect(entry?.expected.admitCount).toBe(1);
    expect(entry?.expected.reweightCount).toBe(1);
    expect(entry?.expected.abstainCount).toBe(1);
  });

  for (let index = 0; index < fixture.cases.length; index += 1) {
    const source = fixture.cases[index] as (typeof fixture.cases)[number];
    const declared = manifest.cases[index] as (typeof manifest.cases)[number];

    it(`case ${source.id}: product and evaluation agree field by field`, () => {
      expect(declared.id).toBe(source.id);
      const derived = memoryConfidence(source.input);
      const expected = declared.expected;

      expect(derived.id).toBe(expected.id);
      expect(derived.verdict).toBe(expected.verdict);
      expect(derived.reason).toBe(expected.reason);
      expect(derived.decidingId).toBe(expected.decidingId);
      expect(derived.decidingScoreMilli).toBe(expected.decidingScoreMilli);
      expect(derived.itemCount).toBe(expected.itemCount);
      expect(derived.admitCount).toBe(expected.admitCount);
      expect(derived.reweightCount).toBe(expected.reweightCount);
      expect(derived.abstainCount).toBe(expected.abstainCount);
    });
  }
});
