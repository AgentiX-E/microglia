/**
 * R248 — the three-reader agreement, pinned.
 *
 * `eval/manifests/competition-domain.json` is derived by the Python reader (`eval/tools/competition_domain.py
 * --verify`) from the fixture's bytes. This test derives the same reading with the product's own
 * `classifyCompetitionDomain` over those same bytes and compares every field. If the product and the evaluation
 * ever disagree about which field a system belongs to — memory (microglia) vs host (nl2charts) vs amplifier —
 * exactly one of these two readers fails and the build stops. That is the point: "the product ships the domain
 * reading the measurement read" becomes a checked property.
 *
 * All fields are integers, strings or booleans, so there is no float comparison here.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { classifyCompetitionDomain, type DomainCandidate } from '../competition-domain.js';

const ROOT = process.cwd() + '/';
const fixture = JSON.parse(readFileSync(`${ROOT}eval/fixtures/competition-domain.json`, 'utf8')) as {
  schema: string;
  cases: { id: string; candidate: DomainCandidate; note?: string }[];
};
const manifest = JSON.parse(readFileSync(`${ROOT}eval/manifests/competition-domain.json`, 'utf8')) as {
  schema: string;
  fixtureSchema: string;
  cases: {
    id: string;
    expected: {
      verdict: string;
      reason: string;
      amplifierRole: boolean;
      name: string;
      unit: string;
      memorySignals: number;
      hostSignals: number;
    };
  }[];
};

describe('R248 product-reader agreement', () => {
  it('the manifest describes the same fixture', () => {
    expect(manifest.fixtureSchema).toBe(fixture.schema);
    expect(manifest.cases).toHaveLength(fixture.cases.length);
  });

  it('every verdict and reason is exercised by the fixture', () => {
    const verdicts = new Set(manifest.cases.map((entry) => entry.expected.verdict));
    const reasons = new Set(manifest.cases.map((entry) => entry.expected.reason));
    expect([...verdicts].sort()).toEqual(['ambiguous', 'host', 'memory', 'other']);
    expect([...reasons].sort()).toEqual([
      'host-artifact',
      'host-task-score',
      'measured-memory-gain',
      'memory-benchmark',
      'mixed-signals',
      'no-signal',
    ]);
  });

  it('binds the amplifier scenario explicitly: memory gain inside a SQL host', () => {
    const entry = manifest.cases.find((c) => c.id === 'microglia-in-nl2charts');
    expect(entry).toBeDefined();
    expect(entry?.expected.verdict).toBe('memory');
    expect(entry?.expected.amplifierRole).toBe(true);
  });

  for (let index = 0; index < fixture.cases.length; index += 1) {
    const source = fixture.cases[index] as (typeof fixture.cases)[number];
    const declared = manifest.cases[index] as (typeof manifest.cases)[number];

    it(`case ${source.id}: product and evaluation agree field by field`, () => {
      expect(declared.id).toBe(source.id);
      const derived = classifyCompetitionDomain(source.candidate);
      const expected = declared.expected;

      expect(derived.verdict).toBe(expected.verdict);
      expect(derived.reason).toBe(expected.reason);
      expect(derived.amplifierRole).toBe(expected.amplifierRole);
      expect(derived.name).toBe(expected.name);
      expect(derived.unit).toBe(expected.unit);
      expect(derived.memorySignals).toBe(expected.memorySignals);
      expect(derived.hostSignals).toBe(expected.hostSignals);
    });
  }
});
