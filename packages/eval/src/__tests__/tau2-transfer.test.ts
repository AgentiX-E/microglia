import { describe, expect, it } from 'vitest';
import { TRANSFER_FLOOR } from '../rule-probe.js';
import { pairKey, transferReadingOf, trialRowsOf, type TauTrialRow } from '../tau2-transfer.js';

/**
 * The transfer reading over a second scenario.
 *
 * On BIRD a transfer trial is one rule shown to one foreign question, with two calls: the question
 * without the rule and the question with it. τ² does not have per-rule calls — the treatment is the
 * whole pack and the two verdicts come from two arms of the same episode — so the pair that the
 * four transfer gates reconcile is `(reference verdict, memory verdict)` for one `(task, trial)`.
 *
 * The mapping has to be exact or the gates become arithmetic over nothing: `blankCorrect` is the
 * reference arm's episode and `withRuleCorrect` is the memory arm's, and a hole on either side is a
 * hole rather than a failure.
 */

const ref = (rows: readonly (readonly [string, number, number | null])[]): TauTrialRow[] =>
  rows.map(([id, trial, reward]) => ({ id, trial, reward }));

describe('trialRowsOf', () => {
  it('names every episode by the scenario that owns the task', () => {
    const rows = trialRowsOf(
      [
        { taskId: '3', trial: 0, reward: 1 },
        { taskId: '3', trial: 1, reward: null },
      ],
      'airline',
    );
    expect(rows).toEqual([
      { id: 'airline/3', trial: 0, reward: 1 },
      { id: 'airline/3', trial: 1, reward: null },
    ]);
  });
});

describe('pairKey', () => {
  it('separates the task from the trial without letting either side collide', () => {
    expect(pairKey('airline/2', 3)).toBe('airline/2\u00003');
    expect(pairKey('airline/2', 3)).not.toBe(pairKey('airline/23', 0));
  });
});

describe('transferReadingOf', () => {
  const reference = ref([
    ['airline/1', 0, 0],
    ['airline/1', 1, 0],
    ['airline/2', 0, 1],
    ['airline/3', 0, 1],
  ]);
  const memory = ref([
    ['airline/1', 0, 1],
    ['airline/1', 1, 0],
    ['airline/2', 0, 0],
    ['airline/3', 0, 1],
  ]);

  it('counts the four cells the transfer gates read, one episode at a time', () => {
    const reading = transferReadingOf({ reference, memory, store: 'retail' });
    expect(reading.paired).toBe(4);
    expect(reading.gate.trials).toBe(4);
    // Informative: the reference failed, so the pack had something to repair.
    expect(reading.gate.informative).toBe(2);
    expect(reading.gate.repaired).toBe(1);
    // The control side: the reference passed, so the pack could only break it.
    expect(reading.gate.blankRight).toBe(2);
    expect(reading.gate.broke).toBe(1);
    expect(reading.gate.measured).toBe(4);
    expect(reading.gate.unmeasured).toBe(0);
  });

  it('states its net marginal effect over the measured episodes, signed', () => {
    // One repair of four measured episodes and one break of four: the net is zero, which is a
    // finding rather than an absence, and V17 reads exactly this number.
    expect(transferReadingOf({ reference, memory, store: 'retail' }).gate.netPp).toBeCloseTo(0, 12);
    const helped = transferReadingOf({
      reference: ref([['a/1', 0, 0]]),
      memory: ref([['a/1', 0, 1]]),
      store: 'retail',
    });
    expect(helped.gate.netPp).toBeCloseTo(100, 12);
    const harmed = transferReadingOf({
      reference: ref([['a/1', 0, 1]]),
      memory: ref([['a/1', 0, 0]]),
      store: 'retail',
    });
    expect(harmed.gate.netPp).toBeCloseTo(-100, 12);
  });

  it('carries one ledger row per trial, including the ones with a hole in them', () => {
    // V33 fails a run whose rate arrived without its pairs. The row is what survives; a hole is a
    // row with an `undefined` verdict, not a row that was never written.
    const reading = transferReadingOf({
      reference: ref([['a/1', 0, 0], ['a/1', 1, null]]),
      memory: ref([['a/1', 0, 1], ['a/1', 1, 1]]),
      store: 'retail',
    });
    expect(reading.gate.ledger).toBe(2);
    expect(reading.gate.trials).toBe(2);
    expect(reading.rows).toHaveLength(2);
    expect(reading.rows[1]?.blankCorrect).toBeUndefined();
    // The ledger keeps the trial number, which is what makes a paired episode addressable after the
    // run: `a/1` appears twice and only the trial tells the two rows apart.
    expect(reading.episodes[1]).toEqual({
      task: 'a/1',
      trial: 1,
      blankCorrect: undefined,
      withMemoryCorrect: true,
    });
  });

  it('treats a missing or unscored trial as unmeasured rather than as a failure', () => {
    const reading = transferReadingOf({
      reference: ref([['a/1', 0, null], ['a/2', 0, 1]]),
      memory: ref([['a/1', 0, 1]]),
      store: 'retail',
    });
    expect(reading.gate.unmeasured).toBe(2);
    expect(reading.gate.measured).toBe(0);
    // The control half of the hole is named separately: it is the denominator's own absence.
    expect(reading.gate.unmeasuredBlank).toBe(1);
    expect(reading.gate.netPp).toBe(0);
    // Nothing was repaired and nothing was broken, so a summary that reported either would be
    // reading a call that never returned as a verdict about the pack.
    expect(reading.gate.repaired).toBe(0);
    expect(reading.gate.broke).toBe(0);
  });

  it('keeps the reference arm\u2019s order, so two readings of one artefact agree', () => {
    const reading = transferReadingOf({
      reference: ref([['a/3', 0, 0], ['a/1', 0, 0], ['a/2', 0, 0]]),
      memory: ref([['a/1', 0, 1], ['a/2', 0, 1], ['a/3', 0, 1]]),
      store: 'retail',
    });
    expect(reading.rows.map((row) => row.targetId)).toEqual(['a/3', 'a/1', 'a/2']);
    expect(reading.gate.repaired).toBe(3);
  });

  it('counts a memory episode the reference never ran as an orphan, not as a pair', () => {
    const reading = transferReadingOf({
      reference: ref([['a/1', 0, 0]]),
      memory: ref([['a/1', 0, 1], ['a/2', 0, 1]]),
      store: 'retail',
    });
    expect(reading.paired).toBe(1);
    expect(reading.orphanMemory).toBe(1);
    expect(reading.gate.trials).toBe(1);
  });

  it('refuses two verdicts for one episode in the treatment arm', () => {
    // The reader refuses a duplicate trial upstream; this is the second line, because the ledger is
    // keyed by the pair and a duplicate would silently overwrite the verdict it was published with.
    expect(() =>
      transferReadingOf({
        reference: ref([['a/1', 0, 0]]),
        memory: ref([['a/1', 0, 1], ['a/1', 0, 0]]),
        store: 'retail',
      }),
    ).toThrow(/two verdicts/);
  });

  it('names the treatment as the store, since the pack is what was transferred', () => {
    const reading = transferReadingOf({ reference, memory, store: 'retail' });
    expect(new Set(reading.rows.map((row) => row.itemId))).toEqual(new Set(['pack@retail']));
  });

  it('holds the verdict to the floor before it holds it to the sign', () => {
    const bulk = (repaired: boolean): { reference: TauTrialRow[]; memory: TauTrialRow[] } => ({
      reference: Array.from({ length: TRANSFER_FLOOR }, (_, index) => ({
        id: `a/${String(index)}`,
        trial: 0,
        reward: 0,
      })),
      memory: Array.from({ length: TRANSFER_FLOOR }, (_, index) => ({
        id: `a/${String(index)}`,
        trial: 0,
        reward: repaired ? 1 : 0,
      })),
    });
    expect(transferReadingOf({ ...bulk(true), store: 'retail' }).gate.verdict).toBe('transfers');
    expect(transferReadingOf({ ...bulk(false), store: 'retail' }).gate.verdict).toBe('no-transfer');
    // One short of the floor is a direction, not a rate, whatever its sign.
    const short = bulk(true);
    expect(
      transferReadingOf({
        reference: short.reference.slice(1),
        memory: short.memory.slice(1),
        store: 'retail',
      }).gate.verdict,
    ).toBe('unmeasured');
  });

  it('reports an empty comparison as measured nothing rather than as a divide by zero', () => {
    const reading = transferReadingOf({ reference: [], memory: [], store: 'retail' });
    expect(reading.paired).toBe(0);
    expect(reading.gate.ledger).toBe(0);
    expect(reading.gate.netPp).toBe(0);
    expect(reading.gate.verdict).toBe('unmeasured');
  });
});
