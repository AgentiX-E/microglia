/**
 * R251 — product / evaluation agreement, pinned field by field.
 *
 * `eval/manifests/memory-admission.json` is derived by the independent Python reader from the fixture's bytes. This
 * test derives the same reading with the product's own `memoryAdmission` over those same bytes and compares every
 * field. If the product and the evaluation ever disagree about an admission decision — admit vs escalate vs reject,
 * or which reason and candidate decided it — exactly one of the two readers fails and the build stops.
 *
 * All fields are integers or strings, so there is no float comparison here.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { memoryAdmission, type MemoryAdmissionInput } from '../memory-admission.js';

const ROOT = process.cwd() + '/';
const fixture = JSON.parse(readFileSync(`${ROOT}eval/fixtures/memory-admission.json`, 'utf8')) as {
  schema: string;
  cases: { id: string; input: MemoryAdmissionInput; note?: string }[];
};
const manifest = JSON.parse(readFileSync(`${ROOT}eval/manifests/memory-admission.json`, 'utf8')) as {
  schema: string;
  fixtureSchema: string;
  cases: {
    id: string;
    expected: {
      id: string;
      queryKey: string;
      verdict: string;
      reason: string;
      decidingId: string;
      candidateCount: number;
      admitCount: number;
      escalateCount: number;
      rejectCount: number;
    };
  }[];
};

describe('R251 product-reader agreement', () => {
  it('the manifest describes the same fixture', () => {
    expect(manifest.fixtureSchema).toBe(fixture.schema);
    expect(manifest.cases).toHaveLength(fixture.cases.length);
  });

  it('every verdict and reason is exercised by the fixture', () => {
    const verdicts = new Set(manifest.cases.map((entry) => entry.expected.verdict));
    const reasons = new Set(manifest.cases.map((entry) => entry.expected.reason));
    expect([...verdicts].sort()).toEqual(['admit', 'escalate', 'reject']);
    expect([...reasons].sort()).toEqual([
      'task-boundary-violation',
      'unverifiable-conflict',
      'unverifiable-detail',
      'unverifiable-failed-source',
      'valid-lesson',
      'verify-conflict',
      'verify-details',
      'verify-failed-source',
    ]);
  });

  it('binds the MemTrapBench task-boundary scenario explicitly', () => {
    const entry = manifest.cases.find((c) => c.id === 'task-boundary-trap');
    expect(entry).toBeDefined();
    expect(entry?.expected.verdict).toBe('reject');
    expect(entry?.expected.reason).toBe('task-boundary-violation');
  });

  it('binds the mixed set where one trap dominates', () => {
    const entry = manifest.cases.find((c) => c.id === 'mixed-reject-dominates');
    expect(entry).toBeDefined();
    expect(entry?.expected.verdict).toBe('reject');
    expect(entry?.expected.decidingId).toBe('trap');
    expect(entry?.expected.admitCount).toBe(1);
    expect(entry?.expected.escalateCount).toBe(1);
    expect(entry?.expected.rejectCount).toBe(1);
  });

  for (let index = 0; index < fixture.cases.length; index += 1) {
    const source = fixture.cases[index] as (typeof fixture.cases)[number];
    const declared = manifest.cases[index] as (typeof manifest.cases)[number];

    it(`case ${source.id}: product and evaluation agree field by field`, () => {
      expect(declared.id).toBe(source.id);
      const derived = memoryAdmission(source.input);
      const expected = declared.expected;

      expect(derived.id).toBe(expected.id);
      expect(derived.queryKey).toBe(expected.queryKey);
      expect(derived.verdict).toBe(expected.verdict);
      expect(derived.reason).toBe(expected.reason);
      expect(derived.decidingId).toBe(expected.decidingId);
      expect(derived.candidateCount).toBe(expected.candidateCount);
      expect(derived.admitCount).toBe(expected.admitCount);
      expect(derived.escalateCount).toBe(expected.escalateCount);
      expect(derived.rejectCount).toBe(expected.rejectCount);
    });
  }
});
