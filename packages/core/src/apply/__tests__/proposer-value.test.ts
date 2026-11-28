/**
 * Behaviour tests for R256 proposer value — the zero-cost gate in front of a paid model arm.
 *
 * Every numeric expectation is derived by hand from the registered ladder, not read back from the
 * implementation, so a wrong ladder fails here before it can reach the three-reader contract.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  proposerValue,
  FRAGMENTATION_FLOOR_MILLI,
  WITNESS_FLOOR_MILLI,
  CHAINED_CEILING_MILLI,
  type ProposerValueInput,
} from '../proposer-value.js';

const ROOT = process.cwd() + '/';
const fixture = JSON.parse(
  readFileSync(`${ROOT}eval/fixtures/proposer-value.json`, 'utf8'),
) as { cases: readonly { id: string; input: ProposerValueInput }[] };

const inputOf = (id: string): ProposerValueInput => {
  const found = fixture.cases.find((c) => c.id === id);
  if (!found) throw new Error(`fixture case not found: ${id}`);
  return found.input;
};

describe('proposerValue — registered ladder', () => {
  it('admits a high-fragmentation, high-witness, low-chaining, under-budget set', () => {
    const r = proposerValue(inputOf('worth-proposing'));
    expect(r.verdict).toBe('admit');
    expect(r.reason).toBe('worth-proposing');
    expect(r.estimatedCostMicros).toBe(150000);
    expect(r.overBudgetByMicros).toBe(0);
  });

  it('rejects when fragmentation is below floor — the deterministic fold already won', () => {
    const r = proposerValue(inputOf('prose-not-the-problem'));
    expect(r.verdict).toBe('reject');
    expect(r.reason).toBe('prose-not-the-problem');
  });

  it('rejects an over-budget set and reports by how much', () => {
    const r = proposerValue(inputOf('over-budget'));
    expect(r.verdict).toBe('reject');
    expect(r.reason).toBe('over-budget');
    expect(r.estimatedCostMicros).toBe(300000);
    expect(r.overBudgetByMicros).toBe(100000);
  });

  it('rejects an empty candidate set rather than treating it as a free win', () => {
    const r = proposerValue(inputOf('no-candidates'));
    expect(r.verdict).toBe('reject');
    expect(r.reason).toBe('no-candidates');
    expect(r.estimatedCostMicros).toBe(0);
  });

  it('abstains on weak witness — uncertainty is not a rejection', () => {
    const r = proposerValue(inputOf('weak-witness'));
    expect(r.verdict).toBe('abstain');
    expect(r.reason).toBe('weak-witness');
  });

  it('reweights to the cheaper split arm when chaining dominates', () => {
    const r = proposerValue(inputOf('grouping-first'));
    expect(r.verdict).toBe('reweight');
    expect(r.reason).toBe('grouping-first');
  });

  it('admits exactly at the fragmentation floor (>= not >)', () => {
    expect(proposerValue(inputOf('boundary-fragmentation')).verdict).toBe('admit');
  });

  it('admits exactly at the budget ceiling (over-budget is strict >)', () => {
    const r = proposerValue(inputOf('boundary-budget'));
    expect(r.verdict).toBe('admit');
    expect(r.overBudgetByMicros).toBe(0);
  });

  it('admits exactly at the chaining ceiling (grouping-first is strict >)', () => {
    expect(proposerValue(inputOf('boundary-chained')).verdict).toBe('admit');
  });

  it('applies the fixed priority when several rungs fire', () => {
    const r = proposerValue(inputOf('priority-prose-before-witness'));
    expect(r.verdict).toBe('reject');
    expect(r.reason).toBe('prose-not-the-problem');
  });
});

describe('proposerValue — ablation attribution', () => {
  it('names the decisive gate: removing fragmentation flips, removing cost does not', () => {
    const r = proposerValue(inputOf('ablation-decisive-fragmentation'));
    expect(r.ablations).toHaveLength(2);
    const frag = r.ablations.find((a) => a.id === 'a-frag');
    const cost = r.ablations.find((a) => a.id === 'a-cost');
    expect(frag).toMatchObject({
      removedSignal: 'fragmentation',
      beforeVerdict: 'reject',
      afterVerdict: 'admit',
      changed: true,
    });
    expect(cost).toMatchObject({
      removedSignal: 'cost',
      beforeVerdict: 'reject',
      afterVerdict: 'reject',
      changed: false,
    });
  });
});

describe('proposerValue — registered constants', () => {
  it('uses the pre-registered floors', () => {
    expect(FRAGMENTATION_FLOOR_MILLI).toBe(300);
    expect(WITNESS_FLOOR_MILLI).toBe(500);
    expect(CHAINED_CEILING_MILLI).toBe(300);
  });
});

describe('proposerValue — guards refuse, never default', () => {
  const base = inputOf('worth-proposing');

  it('refuses a blank id', () => {
    expect(() => proposerValue({ ...base, id: ' ' })).toThrow();
  });
  it('refuses a non-integer fragmentation', () => {
    expect(() => proposerValue({ ...base, fragmentationMilli: 600.5 })).toThrow();
  });
  it('refuses a fragmentation above 1000', () => {
    expect(() => proposerValue({ ...base, fragmentationMilli: 1001 })).toThrow();
  });
  it('refuses a negative fragmentation', () => {
    expect(() => proposerValue({ ...base, fragmentationMilli: -1 })).toThrow();
  });
  it('refuses a non-integer witness', () => {
    expect(() => proposerValue({ ...base, witnessMilli: 700.5 })).toThrow();
  });
  it('refuses a chained share above 1000', () => {
    expect(() => proposerValue({ ...base, chainedShareMilli: 1001 })).toThrow();
  });
  it('refuses a negative candidate count', () => {
    expect(() => proposerValue({ ...base, candidateCount: -1 })).toThrow();
  });
  it('refuses a non-integer candidate count', () => {
    expect(() => proposerValue({ ...base, candidateCount: 1.5 })).toThrow();
  });
  it('refuses a negative unit cost', () => {
    expect(() => proposerValue({ ...base, unitCostMicros: -1 })).toThrow();
  });
  it('refuses a negative budget', () => {
    expect(() => proposerValue({ ...base, budgetMicros: -1 })).toThrow();
  });
  it('refuses a non-array ablation list', () => {
    expect(() => proposerValue({ ...base, ablations: 'no' as never })).toThrow();
  });
  it('refuses a non-object ablation', () => {
    expect(() => proposerValue({ ...base, ablations: ['no' as never] })).toThrow();
  });
  it('refuses a blank ablation id', () => {
    expect(() => proposerValue({ ...base, ablations: [{ id: ' ', removedSignal: 'cost' }] })).toThrow();
  });
  it('refuses an unknown removed signal', () => {
    expect(() =>
      proposerValue({ ...base, ablations: [{ id: 'a', removedSignal: 'unknown' as never }] }),
    ).toThrow();
  });
  it('refuses a duplicate ablation id', () => {
    expect(() =>
      proposerValue({
        ...base,
        ablations: [
          { id: 'a', removedSignal: 'cost' },
          { id: 'a', removedSignal: 'fragmentation' },
        ],
      }),
    ).toThrow();
  });
});
