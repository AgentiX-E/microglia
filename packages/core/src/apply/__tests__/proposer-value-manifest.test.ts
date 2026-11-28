/**
 * R256 — product / evaluation agreement, pinned field by field.
 *
 * `eval/manifests/proposer-value.json` is derived by the independent Python reader from the fixture's bytes. This
 * test derives the same reading with the product's own `proposerValue` over those same bytes and compares every
 * field. If the product and the evaluation ever disagree about a cost, a firing rung, a verdict or an ablation,
 * exactly one of the two readers fails and the build stops.
 *
 * All fields are integers or strings, so there is no float comparison here.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { proposerValue, type ProposerValueInput } from '../proposer-value.js';

const ROOT = process.cwd() + '/';
const fixture = JSON.parse(readFileSync(`${ROOT}eval/fixtures/proposer-value.json`, 'utf8')) as {
  schema: string;
  cases: { id: string; input: ProposerValueInput; note?: string }[];
};
const manifest = JSON.parse(readFileSync(`${ROOT}eval/manifests/proposer-value.json`, 'utf8')) as {
  schema: string;
  fixtureSchema: string;
  cases: {
    id: string;
    expected: {
      id: string;
      verdict: string;
      reason: string;
      decidingSignal: string;
      estimatedCostMicros: number;
      overBudgetByMicros: number;
      candidateCount: number;
      fragmentationFloorMilli: number;
      witnessFloorMilli: number;
      chainedCeilingMilli: number;
      ablations: {
        id: string;
        removedSignal: string;
        beforeVerdict: string;
        afterVerdict: string;
        changed: boolean;
      }[];
    };
  }[];
};

describe('R256 product-reader agreement', () => {
  it('the manifest describes the same fixture', () => {
    expect(manifest.fixtureSchema).toBe(fixture.schema);
    expect(manifest.cases).toHaveLength(fixture.cases.length);
  });

  it('every verdict and reason is exercised by the fixture', () => {
    const verdicts = new Set(manifest.cases.map((entry) => entry.expected.verdict));
    const reasons = new Set(manifest.cases.map((entry) => entry.expected.reason));
    expect([...verdicts].sort()).toEqual(['abstain', 'admit', 'reject', 'reweight']);
    expect([...reasons].sort()).toEqual([
      'grouping-first',
      'no-candidates',
      'over-budget',
      'prose-not-the-problem',
      'weak-witness',
      'worth-proposing',
    ]);
  });

  it('the product matches the manifest field by field, case by case', () => {
    for (let index = 0; index < fixture.cases.length; index += 1) {
      const source = fixture.cases[index] as { id: string; input: ProposerValueInput };
      const pin = manifest.cases[index];
      expect(pin).toBeDefined();
      expect(pin?.id).toBe(source.id);

      const derived = proposerValue(source.input);
      const expected = pin?.expected;
      expect(derived).toEqual(expected);
    }
  });

  it('the manifest agrees with the product on the registered floors', () => {
    for (const pin of manifest.cases) {
      expect(pin.expected.fragmentationFloorMilli).toBe(300);
      expect(pin.expected.witnessFloorMilli).toBe(500);
      expect(pin.expected.chainedCeilingMilli).toBe(300);
    }
  });
});
