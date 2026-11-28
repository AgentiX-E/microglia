/**
 * R254 — product / evaluation agreement, pinned field by field.
 *
 * `eval/manifests/experience-gate.json` is derived by the independent Python reader from the fixture's bytes.
 * This test derives the same reading with the product's own `experienceGate` over those same bytes and compares
 * every field — including each ablation's before/after/changed triple. If the product and the evaluation ever
 * disagree about a gate verdict, deciding stage, count or ablation contribution, exactly one of the two readers
 * fails and the build stops. All fields are integers or strings, so there is no float comparison here.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { experienceGate, type ExperienceGateInput } from '../experience-gate.js';

const ROOT = process.cwd() + '/';
const fixture = JSON.parse(readFileSync(`${ROOT}eval/fixtures/experience-gate.json`, 'utf8')) as {
  schema: string;
  cases: { id: string; input: ExperienceGateInput; note?: string }[];
};
const manifest = JSON.parse(readFileSync(`${ROOT}eval/manifests/experience-gate.json`, 'utf8')) as {
  schema: string;
  fixtureSchema: string;
  cases: {
    id: string;
    expected: {
      id: string;
      verdict: string;
      reason: string;
      decidingStageId: string;
      decidingReason: string;
      decidingScoreMilli: number;
      stageCount: number;
      admitCount: number;
      reweightCount: number;
      abstainCount: number;
      rejectCount: number;
      ablations: {
        id: string;
        removedStageId: string;
        beforeVerdict: string;
        afterVerdict: string;
        changed: boolean;
      }[];
    };
  }[];
};

describe('R254 product-reader agreement', () => {
  it('the manifest describes the same fixture', () => {
    expect(manifest.fixtureSchema).toBe(fixture.schema);
    expect(manifest.cases).toHaveLength(fixture.cases.length);
  });

  it('every verdict and reason family is exercised by the fixture', () => {
    const verdicts = new Set(manifest.cases.map((entry) => entry.expected.verdict));
    const reasons = new Set(manifest.cases.map((entry) => entry.expected.reason));
    expect([...verdicts].sort()).toEqual(['abstain', 'admit', 'reject', 'reweight']);
    expect([...reasons].sort()).toEqual([
      'abstention-required',
      'all-admitted',
      'hard-gate-rejected',
      'reweight-required',
    ]);
  });

  it('binds the advisory downgrade scenario explicitly', () => {
    const entry = manifest.cases.find((c) => c.id === 'advisory-reject-downgraded');
    expect(entry).toBeDefined();
    expect(entry?.expected.verdict).toBe('reweight');
    expect(entry?.expected.rejectCount).toBe(0);
    expect(entry?.expected.decidingReason).toBe('out-of-domain');
  });

  it('binds the ablation attribution', () => {
    const entry = manifest.cases.find((c) => c.id === 'ablation-decisive');
    expect(entry?.expected.ablations).toHaveLength(2);
    expect(entry?.expected.ablations[0].changed).toBe(true);
    expect(entry?.expected.ablations[1].changed).toBe(false);
  });

  for (let index = 0; index < fixture.cases.length; index += 1) {
    const source = fixture.cases[index] as (typeof fixture.cases)[number];
    const declared = manifest.cases[index] as (typeof manifest.cases)[number];

    it(`case ${source.id}: product and evaluation agree field by field`, () => {
      expect(declared.id).toBe(source.id);
      const derived = experienceGate(source.input);
      const expected = declared.expected;

      expect(derived.id).toBe(expected.id);
      expect(derived.verdict).toBe(expected.verdict);
      expect(derived.reason).toBe(expected.reason);
      expect(derived.decidingStageId).toBe(expected.decidingStageId);
      expect(derived.decidingReason).toBe(expected.decidingReason);
      expect(derived.decidingScoreMilli).toBe(expected.decidingScoreMilli);
      expect(derived.stageCount).toBe(expected.stageCount);
      expect(derived.admitCount).toBe(expected.admitCount);
      expect(derived.reweightCount).toBe(expected.reweightCount);
      expect(derived.abstainCount).toBe(expected.abstainCount);
      expect(derived.rejectCount).toBe(expected.rejectCount);
      expect(derived.ablations).toHaveLength(expected.ablations.length);
      for (let a = 0; a < derived.ablations.length; a += 1) {
        expect(derived.ablations[a]).toEqual(expected.ablations[a]);
      }
    });
  }
});
