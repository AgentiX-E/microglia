/**
 * R250 — the three-reader agreement, pinned.
 *
 * `eval/manifests/stale-revocation.json` is derived by the Python reader (`eval/tools/stale_revocation.py --verify`)
 * from the fixture's bytes. This test derives the same reading with the product's own `staleRevocation` over those
 * same bytes and compares every field. If the product and the evaluation ever disagree about whether a new value
 * displaced the stale ones — polluted vs over-revoked vs unresolved vs clean — exactly one of these two readers
 * fails and the build stops. That is the point: "the product ships the revocation reading the measurement read"
 * becomes a checked property.
 *
 * All fields are integers, strings or booleans, so there is no float comparison here.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { staleRevocation, type StaleRevocationInput } from '../stale-revocation.js';

const ROOT = process.cwd() + '/';
const fixture = JSON.parse(readFileSync(`${ROOT}eval/fixtures/stale-revocation.json`, 'utf8')) as {
  schema: string;
  cases: { id: string; input: StaleRevocationInput; note?: string }[];
};
const manifest = JSON.parse(readFileSync(`${ROOT}eval/manifests/stale-revocation.json`, 'utf8')) as {
  schema: string;
  fixtureSchema: string;
  cases: {
    id: string;
    expected: {
      id: string;
      relation: string;
      verdict: string;
      reason: string;
      itemCount: number;
      currentCount: number;
      currentActive: boolean;
      staleCount: number;
      activeStaleCount: number;
      handledStaleCount: number;
      propagationKeys: number;
    };
  }[];
};

describe('R250 product-reader agreement', () => {
  it('the manifest describes the same fixture', () => {
    expect(manifest.fixtureSchema).toBe(fixture.schema);
    expect(manifest.cases).toHaveLength(fixture.cases.length);
  });

  it('every verdict and reason is exercised by the fixture', () => {
    const verdicts = new Set(manifest.cases.map((entry) => entry.expected.verdict));
    const reasons = new Set(manifest.cases.map((entry) => entry.expected.reason));
    expect([...verdicts].sort()).toEqual(['clean', 'over-revoked', 'polluted', 'unresolved']);
    expect([...reasons].sort()).toEqual([
      'co-reference-resolved',
      'current-removed',
      'extend-safe',
      'no-current-evidence',
      'propagated-still-active',
      'propagation-resolved',
      'stale-still-active',
    ]);
  });

  it('binds the TEPA append-only scenario explicitly', () => {
    const entry = manifest.cases.find((c) => c.id === 'append-only-pollution');
    expect(entry).toBeDefined();
    expect(entry?.expected.verdict).toBe('polluted');
    expect(entry?.expected.reason).toBe('stale-still-active');
    expect(entry?.expected.activeStaleCount).toBe(1);
  });

  it('binds the STALE propagation scenario explicitly', () => {
    const entry = manifest.cases.find((c) => c.id === 'propagated-still-active');
    expect(entry).toBeDefined();
    expect(entry?.expected.verdict).toBe('polluted');
    expect(entry?.expected.reason).toBe('propagated-still-active');
  });

  for (let index = 0; index < fixture.cases.length; index += 1) {
    const source = fixture.cases[index] as (typeof fixture.cases)[number];
    const declared = manifest.cases[index] as (typeof manifest.cases)[number];

    it(`case ${source.id}: product and evaluation agree field by field`, () => {
      expect(declared.id).toBe(source.id);
      const derived = staleRevocation(source.input);
      const expected = declared.expected;

      expect(derived.id).toBe(expected.id);
      expect(derived.relation).toBe(expected.relation);
      expect(derived.verdict).toBe(expected.verdict);
      expect(derived.reason).toBe(expected.reason);
      expect(derived.itemCount).toBe(expected.itemCount);
      expect(derived.currentCount).toBe(expected.currentCount);
      expect(derived.currentActive).toBe(expected.currentActive);
      expect(derived.staleCount).toBe(expected.staleCount);
      expect(derived.activeStaleCount).toBe(expected.activeStaleCount);
      expect(derived.handledStaleCount).toBe(expected.handledStaleCount);
      expect(derived.propagationKeys).toBe(expected.propagationKeys);
    });
  }
});
