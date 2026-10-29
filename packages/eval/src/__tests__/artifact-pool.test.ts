import { describe, expect, it } from 'vitest';
import { drawsOf, poolFromArtifact, type ArtifactPoolCase } from '../artifact-pool.js';
import { shapeOf } from '../exec-signature.js';

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

  it('distinguishes a file that never had the field from a run that produced no pool', () => {
    // Both yield no questions and they mean different things. The commands print different lines
    // because of this flag, and a reader deciding what to dispatch next needs to know which one they
    // are looking at.
    const old = poolFromArtifact([{ id: 'old', question: 'How many?' }], []);
    const empty = poolFromArtifact([{ id: 'new', question: 'How many?', pool: null }], []);
    expect(old.recorded).toBe(false);
    expect(empty.recorded).toBe(true);
    expect(old.questions).toEqual([]);
    expect(empty.questions).toEqual([]);
  });

  it('skips a case written before the field existed instead of throwing on it', () => {
    // The artefact this lane most needs to re-read is an old one: a file written before R7.0 has no
    // `pool` key at all, and a reader that assumes the key exists would make every past run
    // unanalysable by the measurement that was built to analyse them.
    const pool = poolFromArtifact([{ id: 'old', question: 'How many?' }], ['sample-5-first']);
    expect(pool.questions).toEqual([]);
    expect(pool.draws).toBe(5);
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

  it('reproduces the run\'s shape exactly when the artefact carries the evidence', () => {
    // The writer's half of the contract. The first artefact that carried a pool did not carry the
    // evidence, so every re-analysis read each question against an empty string and reported signal
    // readings that were not the run's — `empty` came back at 0.5719 where the run had computed
    // 0.5653. The field on `CaseOutcome` is required, which is what stops the writer dropping it
    // again; this test says what the field is for.
    const question = 'Give me the total.';
    const evidence = 'The ratio is per account.';
    expect(shapeOf(question, evidence).wantsAverage).toBe(true);
    expect(shapeOf(question, '').wantsAverage).toBe(false);
    const pool = poolFromArtifact([row({ question, evidence })], []);
    expect(pool.questions[0]?.shape).toEqual(shapeOf(question, evidence));
  });

  it('carries the database and the fold, which is what a memory prior is keyed on', () => {
    const pool = poolFromArtifact([row({ dbId: 'california_schools', fold: 3 })], []);
    expect(pool.questions[0]?.dbId).toBe('california_schools');
    expect(pool.questions[0]?.fold).toBe(3);
  });

  it('omits the database rather than inventing one when the file predates the field', () => {
    // A prior keyed on `undefined` would report a number about a corpus it never saw; the fields
    // being absent is information, and the reader keeps them absent.
    const pool = poolFromArtifact([row()], []);
    expect('dbId' in (pool.questions[0] ?? {})).toBe(false);
    expect('fold' in (pool.questions[0] ?? {})).toBe(false);
  });

  it('reports an empty pool for an artifact with no cases at all', () => {
    const pool = poolFromArtifact([], []);
    expect(pool.questions).toEqual([]);
    expect(pool.draws).toBe(0);
  });
});
