import { describe, expect, it } from 'vitest';
import { execSignatureOf, type ExecSignature, type QuestionShape } from '../exec-signature.js';
import type { PoolCandidate, PoolQuestion, PoolSignalReading } from '../pool.js';
import {
  SHAPE_VOTERS,
  compositeGate,
  compositePicks,
  gateOf,
  holmAdjust,
  normalUpper,
  readComposite,
  readSubsets,
  seOf,
  selectByShape,
} from '../signal-gate.js';

const NO_SHAPE: QuestionShape = {
  wantsMany: false,
  wantsCount: false,
  wantsAverage: false,
  wantsMissing: false,
  wantsDistinct: false,
};

function ran(rows: number): ExecSignature {
  return execSignatureOf({
    rows: Array.from({ length: rows }, (_, index) => [`v${index}`]),
    columns: ['c'],
    failed: false,
  });
}

function empty(): ExecSignature {
  return execSignatureOf({ rows: [], columns: ['c'], failed: false });
}

/** One non-numeric cell: the shape an average was asked for and text was returned. */
function text(): ExecSignature {
  return execSignatureOf({ rows: [['n/a']], columns: ['c'], failed: false });
}

/** One numeric cell: the same question, answered in the unit it asked for. */
function numeric(): ExecSignature {
  return execSignatureOf({ rows: [[1.5]], columns: ['c'], failed: false });
}

function candidate(
  draw: number,
  correct: boolean,
  signature: ExecSignature | null,
  resultKey = draw,
): PoolCandidate {
  return { draw, correct, resultKey, signature };
}

function question(
  id: string,
  candidates: readonly PoolCandidate[],
  shape: QuestionShape = NO_SHAPE,
): PoolQuestion {
  return { id, shape, candidates };
}

/**
 * A question where the first draw is the wrong answer and the second is the right one, told apart
 * by emptiness alone: the exact shape a signal has to be able to rank to be worth anything.
 */
function emptyFirst(id: string): PoolQuestion {
  return question(id, [candidate(0, false, empty()), candidate(1, true, ran(2))]);
}

function reading(over: Partial<PoolSignalReading> & { signal: PoolSignalReading['signal'] }): PoolSignalReading {
  return {
    eligible: 100,
    topPick: 50,
    accuracy: 0.5,
    auc: 0.5,
    aucLow: 0.45,
    aucHigh: 0.55,
    aucSe: 0.05,
    positive: 200,
    negative: 200,
    pairs: 400,
    ...over,
  };
}

describe('normalUpper', () => {
  it('reads one half at zero and the textbook tails above it', () => {
    // The p-value this module reports is a one-sided normal tail, so the two anchor points are the
    // only thing that has to be exact: a wrong tail turns a coin flip into a finding.
    expect(normalUpper(0)).toBeCloseTo(0.5, 6);
    expect(normalUpper(1.959964)).toBeCloseTo(0.025, 5);
    expect(normalUpper(2.326348)).toBeCloseTo(0.01, 5);
    expect(normalUpper(3.090232)).toBeCloseTo(0.001, 6);
  });

  it('mirrors a negative argument instead of reporting a negative probability', () => {
    expect(normalUpper(-1.959964)).toBeCloseTo(0.975, 5);
    expect(normalUpper(-6)).toBeGreaterThan(0.99);
  });

  it('is monotone decreasing and saturates at zero rather than going negative', () => {
    const values = [0, 0.5, 1, 2, 4, 8].map((z) => normalUpper(z));
    for (let at = 1; at < values.length; at += 1) {
      expect(values[at] as number).toBeLessThan(values[at - 1] as number);
    }
    expect(normalUpper(38)).toBeLessThan(1e-300);
    expect(normalUpper(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it('refuses to turn a non-number into evidence', () => {
    expect(normalUpper(Number.NaN)).toBe(1);
  });
});

describe('holmAdjust', () => {
  it('multiplies each p by the number of tests still standing', () => {
    // The classic worked example: three tests, so the smallest is worth three times its p and the
    // largest is worth one. Reporting six uncorrected p-values is how a pool of six coin flips
    // produces a discovery.
    expect(holmAdjust([0.001, 0.04, 0.04])).toEqual([0.003, 0.08, 0.08]);
  });

  it('enforces monotonicity, so a larger raw p cannot end up with a smaller adjusted one', () => {
    const adjusted = holmAdjust([0.04, 0.005, 0.03]);
    expect(adjusted[1]).toBeCloseTo(0.015, 12);
    expect(adjusted[2] as number).toBeGreaterThanOrEqual(0.015);
    expect(adjusted[0] as number).toBeGreaterThanOrEqual(adjusted[2] as number);
  });

  it('caps at one, because a corrected p-value cannot exceed certainty', () => {
    expect(holmAdjust([0.5, 0.6, 0.9])).toEqual([1, 1, 1]);
  });

  it('returns an empty list for no tests rather than a single adjusted value', () => {
    expect(holmAdjust([])).toEqual([]);
  });
});

describe('seOf', () => {
  it('keeps the bootstrap standard error when the resampling saw variation', () => {
    expect(seOf(reading({ signal: 'empty', aucSe: 0.08, positive: 500, negative: 500 }))).toBeCloseTo(
      0.08,
      12,
    );
  });

  it('floors a collapsed bootstrap at the error a perfect coin would have', () => {
    // Every pair concordant means every resample returns the same AUC, so the bootstrap reports a
    // variance of exactly zero and the signal would look infinitely certain. The floor is the
    // standard error the smallest group could have at its own size, which is the largest the AUC of
    // these pairs could have: twenty candidates is not infinite evidence.
    const floored = seOf(reading({ signal: 'empty', aucSe: 0, positive: 25, negative: 25 }));
    expect(floored).toBeCloseTo(Math.sqrt(0.25 / 25), 12);
  });

  it('reports no standard error when one side of the comparison is empty', () => {
    expect(seOf(reading({ signal: 'empty', aucSe: 0, positive: 0, negative: 40 }))).toBe(0);
  });
});

describe('gateOf', () => {
  it('lets a signal through only when it clears two standard errors and the correction', () => {
    const verdicts = gateOf([
      reading({ signal: 'empty', auc: 0.8, aucSe: 0.05 }),
      reading({ signal: 'null-share', auc: 0.52, aucSe: 0.05 }),
    ]);
    const byName = new Map(verdicts.map((verdict) => [verdict.signal, verdict]));
    expect(byName.get('empty')?.survives).toBe(true);
    expect(byName.get('empty')?.z).toBeCloseTo(6, 6);
    expect(byName.get('null-share')?.survives).toBe(false);
  });

  it('refuses a signal whose AUC is above one half but whose interval straddles it', () => {
    // The R7.2a bar in one line: 0.56 with a standard error of 0.09 is z = 0.67, and eleven
    // iterations of composites were built out of exactly this.
    const verdicts = gateOf([reading({ signal: 'row-shape', auc: 0.56, aucSe: 0.09 })]);
    expect(verdicts[0]?.survives).toBe(false);
    expect(verdicts[0]?.z).toBeCloseTo(0.6666, 3);
  });

  it('refuses a signal that points the wrong way, whatever its p-value', () => {
    // An inverted signal is not a weak signal, it is evidence against the direction the composite
    // would use it in. Inverting it on the strength of the same pool is fitting, so it is dropped.
    const verdicts = gateOf([reading({ signal: 'value-type', auc: 0.2, aucSe: 0.02 })]);
    expect(verdicts[0]?.survives).toBe(false);
  });

  it('names the standard error it actually used, not the one the bootstrap offered', () => {
    // Reported because the floor is the reason a small pool fails: reading `aucSe` back from the
    // verdict and finding a floored value says the pool was too small, not that the signal is null.
    const verdicts = gateOf([reading({ signal: 'empty', auc: 1, aucSe: 0, positive: 20, negative: 20 })]);
    expect(verdicts[0]?.se).toBeCloseTo(0.1118, 4);
    expect(verdicts[0]?.survives).toBe(true);
  });

  it('lets a small pool fail on the floor rather than on the point estimate', () => {
    // Four candidates against four is z = 2 at best, which is not evidence of anything at the bar
    // this stage pre-registered. The floor is what stops a unanimous twelve-candidate pool from
    // reporting an infinite z.
    const verdicts = gateOf([reading({ signal: 'empty', auc: 1, aucSe: 0, positive: 4, negative: 4 })]);
    expect(verdicts[0]?.z).toBeCloseTo(2, 6);
    expect(verdicts[0]?.survives).toBe(false);
  });

  it('keeps the baseline out of the family the correction is applied to', () => {
    // `draw-order` is what the signals are measured against, not a hypothesis: correcting it
    // alongside them would change every adjusted p-value by the size of a test nobody is asking.
    const verdicts = gateOf([
      reading({ signal: 'draw-order', auc: 0.9, aucSe: 0.01 }),
      reading({ signal: 'empty', auc: 0.9, aucSe: 0.01 }),
    ]);
    expect(verdicts.map((verdict) => verdict.signal)).toEqual(['empty']);
    expect(verdicts[0]?.holm).toBeCloseTo(verdicts[0]?.p as number, 12);
  });

  it('reports zero for a signal with no standard error instead of dividing by it', () => {
    // A reading with nothing on one side of the comparison has no AUC to speak of; the gate has to
    // report a z of zero rather than an infinity, or a pool where every candidate failed would
    // pass the bar.
    const verdicts = gateOf([reading({ signal: 'empty', auc: 0.5, aucSe: 0, positive: 0, negative: 12 })]);
    expect(verdicts[0]?.se).toBe(0);
    expect(verdicts[0]?.z).toBe(0);
    expect(verdicts[0]?.survives).toBe(false);
  });

  it('drops six tests of exactly two standard errors, which is what the correction is for', () => {
    const six = (['empty', 'row-shape', 'column-shape', 'null-share', 'duplicate-share', 'value-type'] as const).map(
      (signal) => reading({ signal, auc: 0.6, aucSe: 0.05 }),
    );
    const verdicts = gateOf(six);
    for (const verdict of verdicts) {
      expect(verdict.z).toBeCloseTo(2, 6);
      expect(verdict.survives).toBe(false);
    }
    expect(verdicts[0]?.holm).toBeLessThanOrEqual(1);
  });
});

describe('compositePicks', () => {
  it('picks the candidate the surviving signals vote for', () => {
    const picks = compositePicks([emptyFirst('q1')], ['empty']);
    expect(picks).toEqual([1]);
  });

  it('keeps the earlier draw when the votes tie, so an abstaining composite is the baseline', () => {
    // A composite of signals that all abstain must reproduce "take the first draw" exactly. If ties
    // went to the last candidate, the composite would be a different selector wearing the baseline's
    // name and its delta would be a measurement of the tie-break.
    const both = question('q1', [candidate(0, false, ran(2)), candidate(1, true, ran(3))]);
    expect(compositePicks([both], ['null-share'])).toEqual([0]);
  });

  it('votes a draw that produced no query out of the pool, whatever the signals think', () => {
    // A candidate with no signature has no shape at all, so every signal scores it at the floor.
    // Reading it as an empty result instead would let a refusal win a question that asks for an
    // absent value.
    const refused = question('q1', [candidate(0, true, null), candidate(1, false, ran(3))]);
    expect(compositePicks([refused], ['empty'])).toEqual([1]);
    expect(compositePicks([refused], ['value-type'])).toEqual([1]);
  });

  it('returns no pick for a question that produced no candidate', () => {
    expect(compositePicks([question('q1', [])], ['empty'])).toEqual([undefined]);
  });

  it('never reads whether a candidate was correct', () => {
    // The leak check, in the only form that cannot be argued with: the label is made unreadable and
    // the picks have to come out the same. A verifier that peeks at the scorer is a leak with extra
    // steps, and this is the assertion that fails if one is ever wired in.
    const rigged = question('q1', [candidate(0, false, empty()), candidate(1, true, ran(2))]);
    const hostile: PoolQuestion = {
      id: rigged.id,
      shape: rigged.shape,
      candidates: rigged.candidates.map((entry) => {
        const copy = { draw: entry.draw, resultKey: entry.resultKey, signature: entry.signature };
        Object.defineProperty(copy, 'correct', {
          get() {
            throw new Error('composite read the label');
          },
        });
        return copy as PoolCandidate;
      }),
    };
    expect(compositePicks([hostile], ['empty', 'row-shape'])).toEqual([1]);
  });
});

describe('readComposite', () => {
  it('reports the composite as inert when no signal survives its own gate', () => {
    const questions = [emptyFirst('q1'), emptyFirst('q2')];
    const readings = [
      reading({ signal: 'empty', auc: 0.52, aucSe: 0.1 }),
      reading({ signal: 'row-shape', auc: 0.5, aucSe: 0.1 }),
    ];
    const result = readComposite(questions, readings);
    expect(result.verdict).toBe('inert');
    expect(result.kept).toEqual([]);
    expect(result.inert).toEqual(['empty', 'row-shape']);
    expect(result.deltaPp).toBe(0);
  });

  it('keeps only the surviving signals and names the rest as inert', () => {
    const questions = [emptyFirst('q1')];
    const readings = [
      reading({ signal: 'empty', auc: 0.9, aucSe: 0.02 }),
      reading({ signal: 'value-type', auc: 0.5, aucSe: 0.02 }),
    ];
    const result = readComposite(questions, readings);
    expect(result.kept).toEqual(['empty']);
    expect(result.inert).toEqual(['value-type']);
    expect(result.verdict).toBe('usable');
  });

  it('scores the composite against taking the first draw on the same questions', () => {
    // Both numbers on the same population, because a composite measured on the questions it can
    // reorder and a baseline measured on all of them is not a comparison.
    const questions = [emptyFirst('q1'), emptyFirst('q2'), emptyFirst('q3'), emptyFirst('q4')];
    const result = readComposite(questions, [reading({ signal: 'empty', auc: 0.9, aucSe: 0.02 })]);
    expect(result.eligible).toBe(4);
    expect(result.baselineTopPick).toBe(0);
    expect(result.compositeTopPick).toBe(4);
    expect(result.deltaPp).toBeCloseTo(100, 6);
    expect(result.gained).toBe(4);
    expect(result.lost).toBe(0);
  });

  it('counts the questions the composite breaks as well as the ones it fixes', () => {
    const questions = [
      emptyFirst('fixed'),
      // The composite reads emptiness as wrong everywhere, so a question whose right answer is the
      // empty set is a question it breaks. Counting only the fixes is how a net-negative selector
      // reports a positive accuracy.
      question('broken', [candidate(0, true, empty()), candidate(1, false, ran(2))]),
    ];
    const result = readComposite(questions, [reading({ signal: 'empty', auc: 0.6, aucSe: 0.01 })]);
    expect(result.gained).toBe(1);
    expect(result.lost).toBe(1);
    expect(result.deltaPp).toBe(0);
  });

  it('leaves questions with a single outcome out of both numbers', () => {
    // A question where the five draws produced one answer has no choice in it. Counting it as a
    // baseline win inflates every baseline by the collapse rate the pool was measured to have.
    const collapsed = question('q1', [
      candidate(0, true, ran(2), 0),
      candidate(1, true, ran(2), 0),
    ]);
    const result = readComposite([collapsed, emptyFirst('q2')], [
      reading({ signal: 'empty', auc: 0.9, aucSe: 0.01 }),
    ]);
    expect(result.eligible).toBe(1);
    expect(result.compositeTopPick).toBe(1);
  });

  it('reports zeros rather than NaN on an empty pool', () => {
    const result = readComposite([], [reading({ signal: 'empty', auc: 0.9, aucSe: 0.01 })]);
    expect(result.eligible).toBe(0);
    expect(result.compositeAccuracy).toBe(0);
    expect(result.baselineAccuracy).toBe(0);
    expect(result.deltaPp).toBe(0);
  });
});

describe('readSubsets', () => {
  it('prices a subset against the first draw, not against another subset', () => {
    // Every row shares one baseline. Comparing a drop-one composite to the full composite answers
    // "what did this member add"; comparing it to the first draw answers "what is this set worth",
    // and only the second is comparable across rows.
    const questions = [emptyFirst('q1'), emptyFirst('q2')];
    const rows = readSubsets(questions, [['empty'], []]);
    expect(rows[0]?.accuracy).toBe(1);
    expect(rows[0]?.deltaPp).toBeCloseTo(100, 6);
    expect(rows[0]?.gained).toBe(2);
    expect(rows[1]?.accuracy).toBe(0);
    expect(rows[1]?.deltaPp).toBe(0);
  });

  it('shows a member earning its place as a smaller subset scoring worse', () => {
    // A question that asks for an average and is answered with text: only `value-type` objects, so
    // only the subset that contains it can pick the right draw. Dropping it costs both questions.
    const asksForNumber: QuestionShape = { ...NO_SHAPE, wantsAverage: true };
    const questions = [
      question('q1', [candidate(0, false, text()), candidate(1, true, numeric())], asksForNumber),
      question('q2', [candidate(0, false, text()), candidate(1, true, numeric())], asksForNumber),
    ];
    const rows = readSubsets(questions, [['value-type', 'empty'], ['empty'], ['value-type']]);
    expect(rows[0]?.accuracy).toBe(1);
    expect(rows[0]?.gained).toBe(2);
    expect(rows[1]?.accuracy).toBe(0);
    // Nothing lost, because the first draw was already wrong on both: the gap between the two rows
    // is a gain one of them made, not a break the other one caused. Reporting it as a loss would
    // credit the baseline with answers it never had.
    expect(rows[1]?.lost).toBe(0);
    expect(rows[2]?.accuracy).toBe(1);
  });

  it('shows the voters are redundant about emptiness, because every one of them objects to it', () => {
    // `scoreOf` penalises an empty result on every signal it has, not only on the one called
    // `empty`, so a set that loses `empty` still refuses an empty answer. That redundancy is why
    // dropping one voter is a small change on this pool and why the six AUCs sit so close together:
    // they are not six opinions, they are four opinions about shape and two about a shared floor.
    const rows = readSubsets([emptyFirst('q1'), emptyFirst('q2')], [
      ['empty', 'row-shape'],
      ['row-shape'],
      ['empty'],
    ]);
    expect(rows[1]?.accuracy).toBe(rows[0]?.accuracy);
    expect(rows[2]?.accuracy).toBe(rows[0]?.accuracy);
  });

  it('counts a subset that breaks a question the baseline had right', () => {
    const questions = [
      question('broken', [candidate(0, true, empty()), candidate(1, false, ran(2))]),
    ];
    const rows = readSubsets(questions, [['empty']]);
    expect(rows[0]?.gained).toBe(0);
    expect(rows[0]?.lost).toBe(1);
    expect(rows[0]?.deltaPp).toBeCloseTo(-100, 6);
  });

  it('returns one row per subset asked for, and nothing for nothing', () => {
    expect(readSubsets([emptyFirst('q1')], [])).toEqual([]);
    expect(readSubsets([], [['empty']])[0]?.accuracy).toBe(0);
  });
});

describe('compositeGate', () => {
  it('measures the signals on the pool it is given and reports the same numbers twice', () => {
    const questions = Array.from({ length: 40 }, (_, index) => emptyFirst(`q${index}`));
    const first = compositeGate(questions, { resamples: 200, seed: 7 });
    const second = compositeGate(questions, { resamples: 200, seed: 7 });
    expect(second.kept).toEqual(first.kept);
    expect(second.deltaPp).toBe(first.deltaPp);
    expect(second.verdicts.map((verdict) => verdict.auc)).toEqual(
      first.verdicts.map((verdict) => verdict.auc),
    );
  });

  it('lets the emptying signal through a forty-question pool and prices it', () => {
    // The only claim allowed before activation: on a pool where one draw is empty and one is not,
    // the composite built from the surviving signals beats the first draw by the number of
    // questions it fixes. Emptiness is visible to every signal through the shared floor in
    // `scoreOf`, so this asserts the direction and the price rather than a single name.
    const questions = Array.from({ length: 40 }, (_, index) => emptyFirst(`q${index}`));
    const result = compositeGate(questions, { resamples: 200, seed: 7 });
    expect(result.kept).toContain('empty');
    expect(result.eligible).toBe(40);
    expect(result.compositeTopPick).toBe(40);
    expect(result.deltaPp).toBeCloseTo(100, 6);
    expect(result.verdict).toBe('usable');
  });

  it('keeps a signal alone when it is the only one the pool moves', () => {
    // A pool built on repeated rows rather than on emptiness separates the signals: only the
    // duplicate-share reading has an opinion, so the composite is that one reading and the gate is
    // shown to be able to keep a subset instead of waving through everything that correlates with
    // an empty result.
    const repeated = execSignatureOf({ rows: [[1], [1]], columns: ['c'], failed: false });
    const clean = execSignatureOf({ rows: [[1], [2]], columns: ['c'], failed: false });
    const questions = Array.from({ length: 40 }, (_, index) =>
      question(`q${index}`, [candidate(0, false, repeated), candidate(1, true, clean)]),
    );
    const result = compositeGate(questions, { resamples: 200, seed: 7 });
    expect(result.kept).toEqual(['duplicate-share']);
    expect(result.inert).toEqual(['empty', 'row-shape', 'column-shape', 'null-share', 'value-type']);
    expect(result.gained).toBe(40);
    expect(result.lost).toBe(0);
  });

  it('reports every signal in the pool order, so a table cannot quietly omit one', () => {
    const result = compositeGate([emptyFirst('q1')], { resamples: 50, seed: 7 });
    expect(result.verdicts.map((verdict) => verdict.signal)).toEqual([
      'empty',
      'row-shape',
      'column-shape',
      'null-share',
      'duplicate-share',
      'value-type',
    ]);
  });
});

describe('selectByShape', () => {
  it('names the candidate the fixed signal set objects to least', () => {
    // R7.2a's reading, turned into a strategy: the five signals that cleared their own gate vote, and
    // the pick is the candidate with the fewest objections. The set is fixed in code rather than
    // re-derived per fold, because a selector that chooses its own features on the data it is scored
    // on is reporting the fit, not the feature.
    const selection = selectByShape(emptyFirst('q1'));
    expect(selection.chosen).toBe(1);
    expect(selection.reason).toBe('shape');
    expect(selection.votes).toBe(1);
  });

  it('keeps the first draw when nothing objects to anything', () => {
    const indifferent = question('q1', [candidate(0, false, ran(2)), candidate(1, true, ran(3))]);
    const selection = selectByShape(indifferent);
    expect(selection.chosen).toBe(0);
    expect(selection.votes).toBe(0);
    expect(selection.reason).toBe('no-agreement');
  });

  it('counts the distinct answers among the candidates that ran', () => {
    const pool = question('q1', [
      candidate(0, false, ran(2), 0),
      candidate(1, true, ran(3), 1),
      candidate(2, false, null, -1),
    ]);
    expect(selectByShape(pool).groups).toBe(2);
  });

  it('reports an empty pool as a refusal rather than as a pick', () => {
    const selection = selectByShape(question('q1', []));
    expect(selection.reason).toBe('empty');
    expect(selection.groups).toBe(0);
  });

  it('says nothing ran when every candidate failed, and does not call it a preference', () => {
    // A failure is an absent answer, not a worse one. The composite scores it below anything that
    // ran, so it can be chosen — but on a field where nothing ran there is no decision to report, and
    // `selectionStats` counts these apart so a run of broken SQL cannot look like a run of judgement.
    const broken = question('q1', [candidate(0, false, null, -1), candidate(1, true, null, -1)]);
    const selection = selectByShape(broken);
    expect(selection.reason).toBe('nothing-ran');
    expect(selection.votes).toBe(0);
    expect(selection.emptyResult).toBe(false);
  });

  it('says when the candidate it chose returned nothing, because that is a failure worth counting', () => {
    // The one ordering the composite gets wrong on purpose: an empty result on a question that does
    // not ask for absence scores below a query that never ran, so the broken candidate wins. Both are
    // wrong, so the arm's accuracy is unaffected — but the pick is an empty result and the run has to
    // report that rather than leave a reader to infer it.
    const asksForNothing = question(
      'q1',
      [candidate(0, false, empty()), candidate(1, true, null, -1)],
      { ...NO_SHAPE, wantsMissing: true },
    );
    const selection = selectByShape(asksForNothing);
    expect(selection.chosen).toBe(0);
    expect(selection.emptyResult).toBe(true);
    expect(selection.reason).toBe('shape');
  });

  it('cannot prefer an empty result even when the question asks for one', () => {
    // The composite's ceiling, stated as a test rather than as a caveat. No signal returns a positive
    // score, so "the question asks for what is absent" only lifts the penalty; it never becomes
    // evidence. On a level field the tie-break keeps the first draw, and that is why this module needs
    // a signal that can endorse something before its ceiling moves again.
    const asksForNothing = question(
      'q1',
      [candidate(0, false, ran(2)), candidate(1, true, empty())],
      { ...NO_SHAPE, wantsMissing: true },
    );
    const selection = selectByShape(asksForNothing);
    expect(selection.chosen).toBe(0);
    expect(selection.votes).toBe(0);
    expect(selection.reason).toBe('no-agreement');
  });

  it('makes the same choice the simulation priced, on every pool', () => {
    // The arm and the object R7.2a measured have to be one function, or the run's delta is a
    // measurement of a strategy that was never simulated.
    const pools = [
      emptyFirst('q1'),
      question('q2', [candidate(0, false, ran(2)), candidate(1, true, ran(3))]),
      question('q3', [candidate(0, false, empty()), candidate(1, true, null, -1)]),
      question('q4', [
        candidate(0, false, empty()),
        candidate(1, true, ran(2)),
        candidate(2, false, ran(2), 0),
      ]),
    ];
    const simulated = compositePicks(pools, SHAPE_VOTERS);
    expect(pools.map((pool) => selectByShape(pool).chosen)).toEqual(
      pools.map((pool, at) => {
        const draw = simulated[at];
        return pool.candidates.findIndex((item) => item.draw === draw);
      }),
    );
  });

  it('votes with the five signals the gate licensed and not with the one it removed', () => {
    // A signal that failed its own gate is not allowed to influence a public result by the back door.
    expect([...SHAPE_VOTERS].sort()).toEqual([
      'column-shape',
      'duplicate-share',
      'empty',
      'row-shape',
      'value-type',
    ]);
  });
});
