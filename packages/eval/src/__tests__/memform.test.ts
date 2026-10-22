import { describe, expect, it } from 'vitest';
import { defaultPolicy } from '@agentix-e/microglia-core';
import { MEMFORM_ARMS, markOf, policyFor, runMemform } from '../memform.js';

describe('the attack harness', () => {
  it('maps each ablation arm to the one policy it changes', () => {
    expect(policyFor('full')).toBe(defaultPolicy);
    expect(policyFor('no-quarantine').quarantineBelowTrust).toBe(0);
    // Everything else stays at the default: an ablation that changes two things
    // attributes nothing.
    expect({ ...policyFor('no-quarantine'), quarantineBelowTrust: 0.35 }).toEqual(defaultPolicy);
    expect(MEMFORM_ARMS).toEqual(['full', 'no-quarantine']);
  });

  it('runs every route at every trust ceiling and scores them', async () => {
    const report = await runMemform({ perRoute: 3 });
    expect(report.attempts).toBe(15);
    expect(report.matrix).toHaveLength(15);
    expect(Object.keys(report.perRoute)).toHaveLength(5);
    expect(Object.keys(report.perTrust).sort()).toEqual(['0.3', '0.6', '0.9']);

    const total = Object.values(report.perRoute).reduce((sum, row) => sum + row.attempts, 0);
    expect(total).toBe(15);
    const successes = Object.values(report.perRoute).reduce((sum, row) => sum + row.successes, 0);
    expect(successes).toBe(report.successes);
    expect(report.attackSuccess).toBeCloseTo(successes / 15, 6);
  });

  it('blocks every route at or below the corroboration band', async () => {
    const report = await runMemform({ perRoute: 9 });
    for (const row of report.matrix.filter((entry) => entry.trust <= 0.6)) {
      expect(row.success).toBe(0);
    }
    // The positive control: a fully trusted editor still wins, which is what
    // proves the harness is looking at the store rather than at nothing.
    expect(report.perTrust['0.9']?.successes).toBeGreaterThan(0);
  });

  it('names the mechanism that stopped each attempt', async () => {
    const report = await runMemform({ perRoute: 9 });
    const blocked = report.attempts - report.successes;
    const attributed = Object.values(report.reasons).reduce((sum, count) => sum + count, 0);
    expect(attributed).toBe(blocked);
    expect(report.reasons['rejected-borrowed']).toBeGreaterThan(0);
    expect(report.reasons['never-stored']).toBeUndefined();
  });

  it('is deterministic: the same seed replays the same attacks', async () => {
    const first = await runMemform({ perRoute: 6, seed: 5 });
    const second = await runMemform({ perRoute: 6, seed: 5 });
    expect(second).toEqual(first);
  });

  it('defaults to the full arm, one hundred attempts per route, and a fixed seed', async () => {
    const report = await runMemform();
    expect(report.attempts).toBe(500);
    expect(await runMemform()).toEqual(report);
  });

  it('reads the mark from the signal, and refuses a shape the generator cannot make', () => {
    expect(
      markOf({ type: 'edit', beforeHash: 'a', afterHash: 'b', ops: [], distance: 0.5, after: { mark: 'pie' } }),
    ).toBe('pie');
    expect(markOf({ type: 'clarification', question: 'q', answer: 'bar' })).toBe('bar');
    expect(() => markOf({ type: 'rating', value: 'up', reasons: [] })).toThrow(/unsupported signal/);
  });

  it('handles an empty sweep without dividing by zero', async () => {
    const report = await runMemform({ perRoute: 0 });
    expect(report).toMatchObject({ attempts: 0, successes: 0, attackSuccess: 0 });
    expect(report.matrix.every((row) => row.attempts === 0 && row.success === 0)).toBe(true);
    expect(report.reasons).toEqual({});
  });
});
