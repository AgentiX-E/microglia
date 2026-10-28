import { describe, expect, it } from 'vitest';
import {
  selectByConsistency,
  selectFirst,
  selectRandom,
  selectionStats,
  signatureOf,
  type Candidate,
} from '../selector.js';

const candidate = (signature: string | undefined): Candidate => ({
  signature,
  rows: signature === undefined ? 0 : signature.split('\u0001').length,
});

describe('signatureOf', () => {
  it('treats row order as irrelevant and duplication as meaningful', () => {
    // The same two rows in a different order are the same answer; two copies of one row are a
    // different answer from one copy, which is the distinction the official comparison makes.
    const left = signatureOf({ ok: true, tuples: [[1], [2]] });
    const right = signatureOf({ ok: true, tuples: [[2], [1]] });
    expect(left).toBe(right);
    expect(signatureOf({ ok: true, tuples: [[1], [1]] })).not.toBe(left);
  });

  it('says nothing about a query that did not run', () => {
    // `undefined` rather than the empty string: a failure has not agreed with anything, and two
    // failures are not two votes for an empty answer.
    expect(signatureOf({ ok: false, tuples: [] })).toBeUndefined();
  });

  it('gives the empty result a signature of its own', () => {
    expect(signatureOf({ ok: true, tuples: [] })).toBe('');
  });
});

describe('selectByConsistency', () => {
  it('takes the largest agreeing group', () => {
    // Three draws agree on A, one says B, one says C. The selector has one job.
    const selection = selectByConsistency([
      candidate('A'),
      candidate('B'),
      candidate('A'),
      candidate('C'),
      candidate('A'),
    ]);
    expect(selection).toMatchObject({ chosen: 0, votes: 3, groups: 3, reason: 'majority' });
  });

  it('chooses the earliest member of the winning group', () => {
    // Determinism over cleverness: a selector that moves between two identical runs cannot be
    // compared with a control.
    const selection = selectByConsistency([
      candidate('B'),
      candidate('A'),
      candidate('A'),
      candidate('B'),
      candidate('B'),
    ]);
    expect(selection.chosen).toBe(0);
    expect(selection.votes).toBe(3);
  });

  it('falls back to the first draw when every candidate differs', () => {
    const selection = selectByConsistency([candidate('A'), candidate('B'), candidate('C')]);
    expect(selection).toMatchObject({ chosen: 0, votes: 1, groups: 3, reason: 'no-agreement' });
  });

  it('does not count failures as agreement', () => {
    // Two broken queries and one that ran: the one that ran wins even though it is alone, because
    // a failure has said nothing about the answer.
    const selection = selectByConsistency([
      candidate(undefined),
      candidate('A'),
      candidate(undefined),
    ]);
    expect(selection).toMatchObject({ chosen: 1, votes: 1, groups: 1, reason: 'no-agreement' });
  });

  it('falls back to the first draw when nothing ran', () => {
    const selection = selectByConsistency([candidate(undefined), candidate(undefined)]);
    expect(selection).toMatchObject({ chosen: 0, reason: 'nothing-ran', groups: 0 });
  });

  it('flags a winning group that is the empty result', () => {
    // A wrong join commonly returns nothing, so a selector that groups empty results can amplify
    // the failure it was meant to average out. The flag is what makes that visible.
    const selection = selectByConsistency([
      candidate(''),
      candidate(''),
      candidate('"3"'),
    ]);
    expect(selection).toMatchObject({ chosen: 0, votes: 2, emptyResult: true });
    expect(selectByConsistency([candidate('A'), candidate('A')])?.emptyResult).toBe(false);
  });

  it('reports an empty input rather than inventing a choice', () => {
    expect(selectByConsistency([])).toMatchObject({ chosen: 0, votes: 0, reason: 'empty' });
  });
});

describe('selectRandom', () => {
  it('draws uniformly from the candidates the caller supplied', () => {
    const pool = [candidate('A'), candidate('B'), candidate('C')];
    expect(selectRandom(pool, () => 0).chosen).toBe(0);
    expect(selectRandom(pool, () => 0.5).chosen).toBe(1);
    expect(selectRandom(pool, () => 0.99).chosen).toBe(2);
  });

  it('cannot step past the last candidate when the source returns 1', () => {
    // A generator that yields exactly 1 is legal for `Math.random`-shaped sources, and an index of
    // `length` would read `undefined` — which the judge would score as an unanswered question and
    // the arm would report as a loss.
    expect(selectRandom([candidate('A'), candidate('B')], () => 1).chosen).toBe(1);
  });

  it('reports an empty input', () => {
    expect(selectRandom([], () => 0.5).reason).toBe('empty');
  });
});

describe('selectFirst', () => {
  it('is the arm that differs from no-memory only in its temperature', () => {
    expect(selectFirst([candidate('A'), candidate('B')])).toMatchObject({
      chosen: 0,
      votes: 1,
      reason: 'no-agreement',
    });
    expect(selectFirst([])).toMatchObject({ chosen: 0, votes: 0, reason: 'empty' });
  });
});

describe('selectionStats', () => {
  it('counts agreement, empty winners and unanswered questions', () => {
    const stats = selectionStats([
      { chosen: 0, votes: 3, groups: 2, reason: 'majority', emptyResult: false },
      { chosen: 1, votes: 2, groups: 2, reason: 'majority', emptyResult: true },
      { chosen: 0, votes: 1, groups: 3, reason: 'no-agreement', emptyResult: false },
      { chosen: 0, votes: 1, groups: 0, reason: 'nothing-ran', emptyResult: false },
    ]);
    expect(stats).toEqual({
      questions: 4,
      agreed: 2,
      choseEmpty: 1,
      nothingRan: 1,
      meanVotes: 7 / 4,
    });
  });

  it('reports zeroes rather than dividing by an empty run', () => {
    expect(selectionStats([])).toEqual({
      questions: 0,
      agreed: 0,
      choseEmpty: 0,
      nothingRan: 0,
      meanVotes: 0,
    });
  });
});
