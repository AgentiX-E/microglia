/**
 * R255 — product / evaluation agreement, pinned field by field.
 *
 * `eval/manifests/consistency-admission.json` is derived by the independent Python reader from the fixture's
 * bytes. This test derives the same reading with the product's own `consistencyAdmission` over those same bytes
 * and compares every field. If the product and the evaluation ever disagree about a threshold, a support score
 * or an admission decision, exactly one of the two readers fails and the build stops.
 *
 * All fields are integers or strings, so there is no float comparison here.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  consistencyAdmission,
  type ConsistencyAdmissionInput,
} from '../consistency-admission.js';

const ROOT = process.cwd() + '/';
const fixture = JSON.parse(readFileSync(`${ROOT}eval/fixtures/consistency-admission.json`, 'utf8')) as {
  schema: string;
  cases: { id: string; input: ConsistencyAdmissionInput; note?: string }[];
};
const manifest = JSON.parse(readFileSync(`${ROOT}eval/manifests/consistency-admission.json`, 'utf8')) as {
  schema: string;
  fixtureSchema: string;
  cases: {
    id: string;
    expected: {
      id: string;
      verdict: string;
      reason: string;
      decidingId: string;
      decidingReason: string;
      decidingSupportMilli: number;
      thresholdMilli: number;
      candidateCount: number;
      admitCount: number;
      rejectCount: number;
      ablations: {
        id: string;
        removedCandidateId: string;
        beforeVerdict: string;
        afterVerdict: string;
        changed: boolean;
      }[];
    };
  }[];
};

describe('R255 product-reader agreement', () => {
  it('the manifest describes the same fixture', () => {
    expect(manifest.fixtureSchema).toBe(fixture.schema);
    expect(manifest.cases).toHaveLength(fixture.cases.length);
  });

  it('every verdict and reason is exercised by the fixture', () => {
    const verdicts = new Set(manifest.cases.map((entry) => entry.expected.verdict));
    const reasons = new Set(manifest.cases.map((entry) => entry.expected.reason));
    expect([...verdicts].sort()).toEqual(['admit', 'reject']);
    expect([...reasons].sort()).toEqual(['contradicted', 'insufficient-support', 'supported']);
  });

  it('binds the >= threshold boundary explicitly', () => {
    const entry = manifest.cases.find((c) => c.id === 'boundary-at-threshold');
    expect(entry?.expected.verdict).toBe('admit');
    expect(entry?.expected.decidingSupportMilli).toBe(700);
    expect(entry?.expected.thresholdMilli).toBe(700);
  });

  it('binds the occupancy-only flip from adaptive thresholding', () => {
    const sparse = manifest.cases.find((c) => c.id === 'adaptive-sparse-memory');
    const full = manifest.cases.find((c) => c.id === 'adaptive-full-memory');
    expect(sparse?.expected.thresholdMilli).toBe(400);
    expect(sparse?.expected.verdict).toBe('admit');
    expect(full?.expected.thresholdMilli).toBe(800);
    expect(full?.expected.verdict).toBe('reject');
  });

  it('binds the single-pass logprob readings', () => {
    const yes = manifest.cases.find((c) => c.id === 'logprob-supported');
    const no = manifest.cases.find((c) => c.id === 'logprob-contradicted');
    expect(yes?.expected.decidingSupportMilli).toBe(900);
    expect(no?.expected.decidingSupportMilli).toBe(100);
  });

  it('binds the ablation that flips the mixed set', () => {
    const entry = manifest.cases.find((c) => c.id === 'mixed-set-one-contradiction-dominates');
    expect(entry?.expected.ablations).toHaveLength(2);
    expect(entry?.expected.ablations[0]).toMatchObject({ id: 'drop-bad', beforeVerdict: 'reject', afterVerdict: 'admit', changed: true });
    expect(entry?.expected.ablations[1]).toMatchObject({ id: 'drop-good', changed: false });
  });

  for (let index = 0; index < fixture.cases.length; index += 1) {
    const source = fixture.cases[index] as (typeof fixture.cases)[number];
    const declared = manifest.cases[index] as (typeof manifest.cases)[number];

    it(`case ${source.id}: product and evaluation agree field by field`, () => {
      expect(declared.id).toBe(source.id);
      const derived = consistencyAdmission(source.input);
      const expected = declared.expected;

      expect(derived.id).toBe(expected.id);
      expect(derived.verdict).toBe(expected.verdict);
      expect(derived.reason).toBe(expected.reason);
      expect(derived.decidingId).toBe(expected.decidingId);
      expect(derived.decidingReason).toBe(expected.decidingReason);
      expect(derived.decidingSupportMilli).toBe(expected.decidingSupportMilli);
      expect(derived.thresholdMilli).toBe(expected.thresholdMilli);
      expect(derived.candidateCount).toBe(expected.candidateCount);
      expect(derived.admitCount).toBe(expected.admitCount);
      expect(derived.rejectCount).toBe(expected.rejectCount);
      expect(derived.ablations).toEqual(expected.ablations);
    });
  }
});
