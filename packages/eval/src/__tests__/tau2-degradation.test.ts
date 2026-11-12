import { describe, expect, it } from 'vitest';
import { degradationOfPair, degradationLineOf } from '../tau2-degradation.js';

/**
 * The field's headline metric, reported on every pair rather than only on a transfer.
 *
 * `Don't Just Trust Your Memory` (KAIST / DeepAuto.ai, 2026-11-10) defines **memory-induced
 * degradation** as an agent failing a task *it would have solved with no memory at all*, and reports
 * that 52% of the failures on such tasks trace to one memory item, 20% of them an item that is itself
 * wrong. `MemTrapBench` (arXiv:2608.20202) found every strategy underperforming no-memory across two
 * model families and five frameworks.
 *
 * This lane has computed `breakRate = broke / blankRight` since the BIRD transfer lane, and it is
 * exactly that share. The arithmetic is therefore **not written again here**: `transferSummary` owns
 * it, and this module supplies the one thing a within-domain pair lacks — a `store` label, which the
 * transfer reader needs to name the treatment in its ledger. A second implementation of a share that
 * two lanes publish would be two definitions of one number waiting to drift apart.
 */

type Row = { readonly id: string; readonly trial: number; readonly reward: number };

function rows(entries: readonly (readonly [string, number, number])[]): readonly Row[] {
  return entries.map(([id, trial, reward]) => ({ id, trial, reward }));
}

describe('degradationOfPair', () => {
  it('reads a trial the memory arm failed and the reference passed as a break', () => {
    // The definition at the grain the field defines it at. `pass^4` calls this task lost, which is true
    // and hides that three of four trials were unharmed — the difference between a treatment that
    // occasionally misfires and one that does not work.
    const reading = degradationOfPair(
      rows([
        ['retail/1', 0, 1],
        ['retail/1', 1, 1],
      ]),
      rows([
        ['retail/1', 0, 0],
        ['retail/1', 1, 1],
      ]),
    );
    expect(reading?.broke).toBe(1);
    expect(reading?.blankRight).toBe(2);
    expect(reading?.breakRate).toBe(0.5);
    expect(reading?.measured).toBe(2);
  });

  it('counts a repair separately, because a net of zero has two very different shapes', () => {
    const reading = degradationOfPair(
      rows([
        ['a', 0, 0],
        ['b', 0, 1],
      ]),
      rows([
        ['a', 0, 1],
        ['b', 0, 0],
      ]),
    );
    expect(reading?.broke).toBe(1);
    expect(reading?.repaired).toBe(1);
    expect(reading?.netPp).toBe(0);
    // Both numbers are true and they answer different questions: on the trials the reference passed,
    // the treatment destroyed all of them; it also fixed one it would have failed.
    expect(reading?.breakRate).toBe(1);
  });

  it('refuses a pair whose ledgers are not the same trials, rather than subtracting two samples', () => {
    // The rule `poolArms` applies to two experiments and the transfer reader applies to two domains:
    // a difference across different trials is a number about the union of those trials.
    expect(degradationOfPair(rows([['a', 0, 1]]), rows([['b', 0, 1]]))).toBeUndefined();
    expect(degradationOfPair(rows([['a', 0, 1]]), [])).toBeUndefined();
    expect(degradationOfPair([], rows([['a', 0, 1]]))).toBeUndefined();
  });

  it('treats an unscored trial as a hole on both sides rather than as a failure', () => {
    // `per_trial` writes `null` for a trial the harness never scored. Folding it into `false` would file
    // it as a reference failure and credit the memory arm with a repair nobody measured — so the hole
    // maps to `undefined` and stays out of every denominator.
    const holes: readonly { readonly id: string; readonly trial: number; readonly reward: number | null }[] = [
      { id: 'a', trial: 0, reward: null },
      { id: 'b', trial: 0, reward: 1 },
    ];
    const reading = degradationOfPair(holes, holes);
    expect(reading?.blankRight).toBe(1);
    expect(reading?.broke).toBe(0);
    expect(reading?.unmeasured).toBe(1);
  });

  it('refuses a ledger that names one trial twice, on either side', () => {
    // A duplicated key is an instrument fault rather than a data point: `per_trial` is one row per
    // (task, trial), so two rows for one key means the file is two runs concatenated, and the share
    // would be taken over a population that exists only in the file.
    expect(degradationOfPair(rows([['a', 0, 1]]), rows([['a', 0, 1], ['a', 0, 0]]))).toBeUndefined();
    expect(degradationOfPair(rows([['a', 0, 1], ['a', 0, 0]]), rows([['a', 0, 1]]))).toBeUndefined();
  });

  it('leaves a trial whose partner is missing out of the denominator', () => {
    // A hole on the other side is the absence of a denominator, not a negative result -- the same rule
    // the transfer reader applies, and the reason `unmeasured` exists beside `blankRight`.
    const reading = degradationOfPair(rows([['a', 0, 1]]), rows([['a', 0, 1], ['b', 0, 1]]));
    expect(reading).toBeUndefined();
  });
});

describe('degradationLineOf', () => {
  it('quotes the share with the population behind it, so the field 52% is comparable', () => {
    const reading = degradationOfPair(
      rows([
        ['a', 0, 1],
        ['b', 0, 1],
        ['c', 0, 1],
        ['d', 0, 1],
      ]),
      rows([
        ['a', 0, 0],
        ['b', 0, 1],
        ['c', 0, 1],
        ['d', 0, 1],
      ]),
    );
    expect(degradationLineOf(reading)).toBe(
      'degradation: 1 of 4 trial(s) the reference passed, the memory arm failed (25.00%); ' +
        'repaired 0, unmeasured 0',
    );
  });

  it('says not-measurable rather than printing a rate over nothing', () => {
    expect(degradationLineOf(undefined)).toContain('no measurement');
  });

  it('says the denominator is absent when the reference passed nothing', () => {
    const reading = degradationOfPair(rows([['a', 0, 0]]), rows([['a', 0, 0]]));
    expect(degradationLineOf(reading)).toContain('the reference passed nothing');
  });
});
