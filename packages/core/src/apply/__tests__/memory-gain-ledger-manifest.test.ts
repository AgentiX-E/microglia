/**
 * R253 - product / evaluation agreement, pinned field by field.
 *
 * `eval/manifests/memory-gain-ledger.json` is derived by the independent Python reader from the fixture's
 * bytes. This test derives the same reading with the product's own `memoryGainLedger` over those same bytes
 * and compares every field. If the product and the evaluation ever disagree about a net gain, a refusal or
 * an ablation delta, exactly one of the two readers fails and the build stops.
 *
 * All fields are integers or strings, so there is no float comparison here.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { memoryGainLedger, type MemoryGainInput } from '../memory-gain-ledger.js';

const ROOT = process.cwd() + '/';
const fixture = JSON.parse(readFileSync(`${ROOT}eval/fixtures/memory-gain-ledger.json`, 'utf8')) as {
  schema: string;
  cases: { id: string; input: MemoryGainInput; note?: string }[];
};
const manifest = JSON.parse(readFileSync(`${ROOT}eval/manifests/memory-gain-ledger.json`, 'utf8')) as {
  schema: string;
  fixtureSchema: string;
  cases: {
    id: string;
    expected: {
      id: string;
      verdict: string;
      reason: string;
      decidingId: string;
      decidingNetGainMilli: number;
      armCount: number;
      admitCount: number;
      rejectCount: number;
      contributions: { id: string; poisonDeltaMilli: number; followDeltaMilli: number }[];
    };
  }[];
};

describe('R253 memoryGainLedger - product / evaluation field agreement', () => {
  it('binds the fixture schema and case count', () => {
    expect(fixture.schema).toBe('microglia/memory-gain-ledger@1');
    expect(manifest.fixtureSchema).toBe(fixture.schema);
    expect(manifest.cases).toHaveLength(fixture.cases.length);
  });

  for (let index = 0; index < fixture.cases.length; index += 1) {
    const testCase = fixture.cases[index]!;
    const expected = manifest.cases[index]!;

    it(`agrees on '${testCase.id}'`, () => {
      expect(expected.id).toBe(testCase.id);
      const reading = memoryGainLedger(testCase.input);
      expect(reading.id).toBe(expected.expected.id);
      expect(reading.verdict).toBe(expected.expected.verdict);
      expect(reading.reason).toBe(expected.expected.reason);
      expect(reading.decidingId).toBe(expected.expected.decidingId);
      expect(reading.decidingNetGainMilli).toBe(expected.expected.decidingNetGainMilli);
      expect(reading.armCount).toBe(expected.expected.armCount);
      expect(reading.admitCount).toBe(expected.expected.admitCount);
      expect(reading.rejectCount).toBe(expected.expected.rejectCount);
      expect(reading.contributions).toEqual(expected.expected.contributions);
    });
  }
});
