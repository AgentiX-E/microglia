import { describe, expect, it } from 'vitest';
import { execSignatureOf, type ExecSignature } from '../exec-signature.js';
import { keyOf, priorPicks, priorReading, priorTable } from '../memory-prior.js';
import type { PriorCase, PriorCandidate } from '../memory-prior.js';

/** A scalar shape: the answer a count has. */
function scalar(): ExecSignature {
  return execSignatureOf({ rows: [[7]], columns: ['n'], failed: false });
}

/** A multi-row shape: the answer a list has. */
function listed(): ExecSignature {
  return execSignatureOf({ rows: [[1], [2], [3]], columns: ['n'], failed: false });
}

/** An empty result: the answer "none" has. */
function nothing(): ExecSignature {
  return execSignatureOf({ rows: [], columns: ['n'], failed: false });
}

function candidate(
  draw: number,
  correct: boolean,
  signature: ExecSignature | null = scalar(),
): PriorCandidate {
  return { draw, correct, signature };
}

function entry(
  id: string,
  fold: number,
  candidates: readonly PriorCandidate[],
  dbId = 'db_a',
): PriorCase {
  return { id, dbId, fold, candidates };
}

describe('keyOf', () => {
  it('separates two databases under the memory-shaped key', () => {
    expect(keyOf('db-signature', 'db_a', scalar())).not.toBe(
      keyOf('db-signature', 'db_b', scalar()),
    );
  });

  it('ignores the database when the scope is the shape alone', () => {
    expect(keyOf('signature', 'db_a', scalar())).toBe(keyOf('signature', 'db_b', scalar()));
  });

  it('ignores the shape when the scope is the database alone', () => {
    expect(keyOf('db', 'db_a', scalar())).toBe(keyOf('db', 'db_a', listed()));
  });

  it('rounds the continuous fields, so shapes that differ in the third decimal are one key', () => {
    const five = execSignatureOf({
      rows: [['a', null], ['b', null]],
      columns: ['x', 'y'],
      failed: false,
    });
    const three = execSignatureOf({
      rows: [['a', null], ['b', null], ['c', 'd']],
      columns: ['x', 'y'],
      failed: false,
    });
    // 0.50 nullable share against 0.33: different keys, because the rounding is coarse enough to
    // merge near-identical shapes and not so coarse that a half-null result looks like a full one.
    expect(keyOf('signature', 'db_a', five)).not.toBe(keyOf('signature', 'db_a', three));
  });

  it('gives a failed execution a key of its own, apart from both a refusal and an empty answer', () => {
    const failed = execSignatureOf({ rows: [], columns: [], failed: true });
    expect(keyOf('signature', 'db_a', failed)).not.toBe('none');
    expect(keyOf('signature', 'db_a', failed)).not.toBe(keyOf('signature', 'db_a', nothing()));
  });

  it('gives a draw that produced no statement its own key rather than sharing one', () => {
    const absent = keyOf('signature', 'db_a', null);
    expect(absent).toBe('none');
    expect(absent).not.toBe(keyOf('signature', 'db_a', nothing()));
  });
});

/** A corpus where one shape is usually wrong and another usually right, spread over five folds. */
function skewed(): readonly PriorCase[] {
  return [
    entry('q1', 0, [candidate(0, false, scalar()), candidate(1, true, listed())]),
    entry('q2', 1, [candidate(0, false, scalar()), candidate(1, true, listed())]),
    entry('q3', 2, [candidate(0, false, scalar()), candidate(1, true, listed())]),
    entry('q4', 3, [candidate(0, false, scalar()), candidate(1, true, listed())]),
    entry('q5', 4, [candidate(0, true, scalar()), candidate(1, false, listed())]),
    entry('q6', 0, [candidate(0, false, scalar()), candidate(1, true, listed())]),
  ];
}

describe('priorPicks', () => {
  it('prefers the shape that was right in the other folds over the one that was wrong', () => {
    const picks = priorPicks(skewed(), 'signature');
    // q1 sees `listed` right three times and wrong once outside fold 0 - support 4, share 0.3 -
    // against `scalar` wrong three times and right once, share 0.7. It moves to the second draw.
    expect(picks[0]?.chosen).toBe(1);
    expect(picks[0]?.support).toBe(4);
  });

  it('never lets a question be helped by its own answer', () => {
    // One case only. Every key it could look up has support zero outside its own fold, so the prior
    // has nothing to prefer and keeps the first draw - which is what makes the arm's delta a
    // measurement of the other folds rather than of the question itself.
    const cases = [entry('q1', 0, [candidate(0, false, scalar()), candidate(1, true, listed())])];
    const picks = priorPicks(cases, 'signature');
    expect(picks[0]?.chosen).toBe(0);
    expect(picks[0]?.support).toBe(0);
    expect(picks[0]?.share).toBe(0.5);
  });

  it('refuses to choose when every candidate shares one key', () => {
    // Two draws of the same shape are one memory, not two candidates: a prior keyed on shape has no
    // basis to separate them, and inventing one would be reporting the tie-break as a preference.
    const cases = [
      entry('q1', 0, [candidate(0, false, scalar()), candidate(1, true, scalar())]),
      entry('q2', 1, [candidate(0, true, scalar())]),
    ];
    const picks = priorPicks(cases, 'signature');
    expect(picks[0]?.chosen).toBe(-1);
  });

  it('breaks an exact tie towards the first draw, so abstaining reproduces the baseline', () => {
    // A balanced corpus: each shape is right half the time outside every fold, so every smoothed
    // share is identical and the strict comparison leaves the question where the baseline had it.
    const cases = [
      entry('q1', 0, [candidate(0, false, scalar()), candidate(1, true, listed())]),
      entry('q2', 1, [candidate(0, true, scalar()), candidate(1, false, listed())]),
      entry('q3', 2, [candidate(0, false, scalar()), candidate(1, true, listed())]),
      entry('q4', 3, [candidate(0, true, scalar()), candidate(1, false, listed())]),
    ];
    const picks = priorPicks(cases, 'signature');
    expect(picks[0]?.chosen).toBe(0);
    expect(picks[0]?.share).toBeCloseTo(0.375, 12);
  });
});

describe('priorReading', () => {
  it('scores the prior on the questions where a choice existed, and nothing else', () => {
    const cases = [
      ...skewed(),
      // One key only: no choice, so it is out of the denominator on both sides.
      entry('q7', 0, [candidate(0, true, scalar()), candidate(1, false, scalar())]),
    ];
    const reading = priorReading(cases, 'signature');
    expect(reading.questions).toBe(7);
    expect(reading.choices).toBe(6);
    expect(reading.accuracy).toBeCloseTo(5 / 6, 10);
    expect(reading.baseline).toBeCloseTo(1 / 6, 10);
  });

  it('counts a gain and a loss once each, and prices them with the exact test', () => {
    const reading = priorReading(skewed(), 'signature');
    // Five questions move from wrong to right and one moves the other way: the corpus is skewed, and
    // the one question whose minority shape was correct is the price of trusting the majority.
    expect(reading.gained).toBe(5);
    expect(reading.lost).toBe(1);
    expect(reading.deltaPp).toBeCloseTo(66.667, 2);
    expect(reading.p).toBeCloseTo(0.219, 3);
  });

  it('reports an empty corpus as a measurement of zero questions rather than as a failure', () => {
    const reading = priorReading([], 'signature');
    expect(reading.measurable).toBe(true);
    expect(reading.questions).toBe(0);
    expect(reading.accuracy).toBe(0);
    expect(reading.p).toBe(1);
  });

  it('says so when the artefact cannot be keyed, instead of reporting a number about nothing', () => {
    // An artefact written before `dbId` and `fold` were recorded: every case would key under the
    // empty string and fold zero, and the prior would "explain" a corpus it never saw.
    const cases = [entry('q1', 0, [candidate(0, false, scalar())], '')];
    expect(priorReading(cases, 'db-signature').measurable).toBe(false);
  });

  it('reports a question with no candidates as not measurable, because it has no draw to score', () => {
    const reading = priorReading([entry('q1', 0, [])], 'signature');
    expect(reading.measurable).toBe(false);
    expect(reading.choices).toBe(0);
  });

  it('counts the keys it had to look anything up in', () => {
    const cases = [
      entry('q1', 0, [candidate(0, false, scalar()), candidate(1, true, listed())]),
      entry('q2', 1, [candidate(0, false, nothing()), candidate(1, true, listed())], 'db_b'),
    ];
    expect(priorReading(cases, 'db-signature').keys).toBe(4);
    expect(priorReading(cases, 'signature').keys).toBe(3);
    expect(priorReading(cases, 'db').keys).toBe(2);
  });
});

describe('the two keys disagree when the database is what carried the outcome', () => {
  it('prefers the shape that worked here, and the shape that worked anywhere', () => {
    // Same two shapes throughout, but the second database is where the list shape was wrong. A key
    // that remembers the database follows the local record; a key that forgets it follows the global
    // one. Which of the two is worth having is the question the two arms are for.
    const cases = [
      entry('q1', 0, [candidate(0, false, scalar()), candidate(1, true, listed())], 'db_a'),
      entry('q2', 1, [candidate(0, false, scalar()), candidate(1, true, listed())], 'db_a'),
      entry('q3', 0, [candidate(0, false, listed()), candidate(1, true, scalar())], 'db_b'),
      entry('q4', 1, [candidate(0, false, listed()), candidate(1, true, scalar())], 'db_b'),
    ];
    const local = priorPicks(cases, 'db-signature');
    const global = priorPicks(cases, 'signature');
    // On db_b the local record endorses the scalar and the local key agrees; the global key has seen
    // `listed` right twice and `scalar` wrong twice, so it abstains between them.
    expect(local[2]?.chosen).toBe(1);
    expect(global[2]?.chosen).toBe(0);
  });
});

describe('priorTable', () => {
  it('reads all three scopes, so a reader can tell the schema from the shape', () => {
    const rows = priorTable([entry('q1', 0, [candidate(0, false, scalar())])]);
    expect(rows.map((row) => row.scope)).toEqual(['db-signature', 'signature', 'db']);
  });
});
