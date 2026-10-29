import { describe, expect, it } from 'vitest';
import { drawsOf, poolFromArtifact, type ArtifactPoolCase } from '../artifact-pool.js';

function row(over: Partial<ArtifactPoolCase> = {}): ArtifactPoolCase {
  return {
    id: 'q1',
    question: 'How many accounts are there?',
    evidence: '',
    pool: [
      { draw: 0, correct: false, resultKey: 0, signature: null },
      { draw: 1, correct: true, resultKey: 1, signature: null },
    ],
    ...over,
  };
}

describe('drawsOf', () => {
  it('reads the sample size from the arm names, because a three-draw run is not a five-draw one', () => {
    expect(drawsOf(['none', 'sample-3-first', 'sample-3-oracle'])).toBe(3);
    expect(drawsOf(['none-replica', 'sample-5-first', 'sample-5-oracle'])).toBe(5);
  });

  it('takes the widest sampling arm when two of them disagree', () => {
    // A run that took five draws and a two-draw shadow arm describing the same pool must not report
    // the pool as having two draws: the collapse share is read against the draws actually taken.
    expect(drawsOf(['sample-2-first', 'sample-5-oracle'])).toBe(5);
  });

  it('reports zero when no sampling arm ran, rather than assuming five', () => {
    expect(drawsOf([])).toBe(0);
    expect(drawsOf(['none', 'full-verified', 'm-schema'])).toBe(0);
  });

  it('ignores an arm whose suffix is not a positive integer', () => {
    expect(drawsOf(['sample-five-first', 'sample-0-first', 'sample--1'])).toBe(0);
  });
});

describe('poolFromArtifact', () => {
  it('keeps every recorded candidate as it was recorded', () => {
    const pool = poolFromArtifact([row()], ['sample-2-first']);
    expect(pool.draws).toBe(2);
    expect(pool.questions).toHaveLength(1);
    expect(pool.questions[0]?.id).toBe('q1');
    expect(pool.questions[0]?.candidates.map((candidate) => candidate.draw)).toEqual([0, 1]);
    expect(pool.questions[0]?.candidates.map((candidate) => candidate.correct)).toEqual([false, true]);
  });

  it('drops questions with no pool, which are the ones no sampling arm reached', () => {
    // Null and empty are different: null means the arm did not run, empty would mean it ran and
    // produced nothing. Neither is a question with a choice in it, and counting either as a
    // collapsed pool would bias the collapse statistic towards narrow.
    const pool = poolFromArtifact([row(), row({ id: 'q2', pool: null }), row({ id: 'q3', pool: [] })], []);
    expect(pool.questions.map((question) => question.id)).toEqual(['q1']);
  });

  it('recomputes the question shape from the text rather than reading an interpretation', () => {
    const pool = poolFromArtifact([row({ question: 'How many accounts are there?' })], []);
    expect(pool.questions[0]?.shape.wantsCount).toBe(true);
    expect(pool.questions[0]?.shape.wantsMany).toBe(false);
  });

  it('reads the evidence as well as the question, because half the intent is in it', () => {
    const pool = poolFromArtifact(
      [row({ question: 'Give me the total.', evidence: 'The ratio is per account.' })],
      [],
    );
    expect(pool.questions[0]?.shape.wantsAverage).toBe(true);
  });

  it('treats a missing evidence field as no evidence rather than as undefined text', () => {
    const pool = poolFromArtifact(
      [
        {
          id: 'q1',
          question: 'How many?',
          pool: [{ draw: 0, correct: false, resultKey: 0, signature: null }],
        },
      ],
      [],
    );
    expect(pool.questions[0]?.shape.wantsCount).toBe(true);
    expect(Number.isNaN(pool.draws)).toBe(false);
  });

  it('reports an empty pool for an artifact with no cases at all', () => {
    const pool = poolFromArtifact([], []);
    expect(pool.questions).toEqual([]);
    expect(pool.draws).toBe(0);
  });
});
