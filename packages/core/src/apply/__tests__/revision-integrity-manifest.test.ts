/**
 * R249 — the three-reader agreement, pinned.
 *
 * `eval/manifests/revision-integrity.json` is derived by the Python reader (`eval/tools/revision_integrity.py
 * --verify`) from the fixture's bytes. This test derives the same reading with the product's own
 * `revisionIntegrity` over those same bytes and compares every field. If the product and the evaluation ever
 * disagree about whether a revision covered every derived site — residual vs method-violation vs complete —
 * exactly one of these two readers fails and the build stops. That is the point: "the product ships the revision
 * reading the measurement read" becomes a checked property.
 *
 * All fields are integers, strings or booleans, so there is no float comparison here.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { revisionIntegrity, type RevisionInput } from '../revision-integrity.js';

const ROOT = process.cwd() + '/';
const fixture = JSON.parse(readFileSync(`${ROOT}eval/fixtures/revision-integrity.json`, 'utf8')) as {
  schema: string;
  cases: { id: string; input: RevisionInput; note?: string }[];
};
const manifest = JSON.parse(readFileSync(`${ROOT}eval/manifests/revision-integrity.json`, 'utf8')) as {
  schema: string;
  fixtureSchema: string;
  cases: {
    id: string;
    expected: {
      id: string;
      intent: string;
      verdict: string;
      reason: string;
      siteCount: number;
      liveSites: number;
      augmentedSites: number;
      tombstonedSites: number;
      purgedSites: number;
      residualSites: number;
      hasSource: boolean;
    };
  }[];
};

describe('R249 product-reader agreement', () => {
  it('the manifest describes the same fixture', () => {
    expect(manifest.fixtureSchema).toBe(fixture.schema);
    expect(manifest.cases).toHaveLength(fixture.cases.length);
  });

  it('every verdict and reason is exercised by the fixture', () => {
    const verdicts = new Set(manifest.cases.map((entry) => entry.expected.verdict));
    const reasons = new Set(manifest.cases.map((entry) => entry.expected.reason));
    expect([...verdicts].sort()).toEqual(['complete', 'method-violation', 'residual']);
    expect([...reasons].sort()).toEqual([
      'augment-retains-claim',
      'augmented-and-covered',
      'full-purge',
      'live-site',
      'no-source-to-augment',
      'replace-drops-provenance',
      'tombstone-coverage',
    ]);
  });

  it('binds the FRS scenario explicitly: source purged but summary live', () => {
    const entry = manifest.cases.find((c) => c.id === 'frs-summary-residual');
    expect(entry).toBeDefined();
    expect(entry?.expected.verdict).toBe('residual');
    expect(entry?.expected.reason).toBe('live-site');
    expect(entry?.expected.residualSites).toBe(1);
  });

  for (let index = 0; index < fixture.cases.length; index += 1) {
    const source = fixture.cases[index] as (typeof fixture.cases)[number];
    const declared = manifest.cases[index] as (typeof manifest.cases)[number];

    it(`case ${source.id}: product and evaluation agree field by field`, () => {
      expect(declared.id).toBe(source.id);
      const derived = revisionIntegrity(source.input);
      const expected = declared.expected;

      expect(derived.id).toBe(expected.id);
      expect(derived.intent).toBe(expected.intent);
      expect(derived.verdict).toBe(expected.verdict);
      expect(derived.reason).toBe(expected.reason);
      expect(derived.siteCount).toBe(expected.siteCount);
      expect(derived.liveSites).toBe(expected.liveSites);
      expect(derived.augmentedSites).toBe(expected.augmentedSites);
      expect(derived.tombstonedSites).toBe(expected.tombstonedSites);
      expect(derived.purgedSites).toBe(expected.purgedSites);
      expect(derived.residualSites).toBe(expected.residualSites);
      expect(derived.hasSource).toBe(expected.hasSource);
    });
  }
});
