/**
 * R247 — the three-reader agreement, pinned.
 *
 * `eval/manifests/abstraction-lifecycle.json` is derived by the Python reader (`eval/tools/abstraction_lifecycle.py
 * --verify`) from the fixture's bytes. This test derives the same reading with the product's own
 * `abstractionLifecycle` over those same bytes and compares every field. If the product and the evaluation ever
 * disagree about whether an item is retained, ephemeral or discarded, exactly one of these two readers fails and
 * the build stops. That is the point: "the product ships the decision the measurement read" becomes a checked
 * property.
 *
 * All fields are integers or strings, so there is no float comparison here — unlike the view-consistency binding.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { abstractionLifecycle, type AbstractionLifecycleInput } from '../abstraction-lifecycle.js';

const ROOT = process.cwd() + '/';
const fixture = JSON.parse(readFileSync(`${ROOT}eval/fixtures/abstraction-lifecycle.json`, 'utf8')) as {
  schema: string;
  cases: {
    id: string;
    item: AbstractionLifecycleInput;
    options?: { minInjections?: number };
  }[];
};
const manifest = JSON.parse(readFileSync(`${ROOT}eval/manifests/abstraction-lifecycle.json`, 'utf8')) as {
  schema: string;
  fixtureSchema: string;
  cases: {
    id: string;
    expected: {
      disposition: string;
      reason: string;
      id: string;
      kind: string;
      delta: number;
      injected: number;
      minInjections: number;
    };
  }[];
};

describe('R247 product-reader agreement', () => {
  it('the manifest describes the same fixture', () => {
    expect(manifest.fixtureSchema).toBe(fixture.schema);
    expect(manifest.cases).toHaveLength(fixture.cases.length);
  });

  it('every disposition and reason is exercised by the fixture', () => {
    const dispositions = new Set(manifest.cases.map((entry) => entry.expected.disposition));
    const reasons = new Set(manifest.cases.map((entry) => entry.expected.reason));
    expect([...dispositions].sort()).toEqual(['discard', 'ephemeral', 'retain']);
    expect([...reasons].sort()).toEqual([
      'event-record',
      'harmful-abstraction',
      'insufficient-outcomes',
      'no-signal',
      'stable-help',
    ]);
  });

  for (let index = 0; index < fixture.cases.length; index += 1) {
    const source = fixture.cases[index] as (typeof fixture.cases)[number];
    const declared = manifest.cases[index] as (typeof manifest.cases)[number];

    it(`case ${source.id}: product and evaluation agree field by field`, () => {
      expect(declared.id).toBe(source.id);
      const derived = abstractionLifecycle(source.item, source.options);
      const expected = declared.expected;

      expect(derived.disposition).toBe(expected.disposition);
      expect(derived.reason).toBe(expected.reason);
      expect(derived.id).toBe(expected.id);
      expect(derived.kind).toBe(expected.kind);
      expect(derived.delta).toBe(expected.delta);
      expect(derived.injected).toBe(expected.injected);
      expect(derived.minInjections).toBe(expected.minInjections);
    });
  }
});
