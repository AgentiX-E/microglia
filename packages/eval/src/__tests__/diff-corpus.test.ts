/**
 * The one join from a committed run to every per-question reading.
 *
 * It is four lines of mapping and it is tested because of what a defect here would do: a corpus built
 * one field short would make every downstream reading agree with itself and with nothing else. The
 * specific field that has already mattered once is `evidence` — the external-knowledge block is what
 * makes a name *grounded*, so a corpus built without it counts every name the benchmark supplied as
 * one the model invented.
 */
import { describe, expect, it } from 'vitest';
import { diffCasesOf } from '../diff-corpus.js';

const QUESTION = {
  id: 'financial#1',
  dbId: 'financial',
  question: 'How many accounts are there?',
  evidence: '',
  predictedSql: 'SELECT count(*) FROM account',
  baselineSql: 'SELECT count(*) FROM account',
  correct: true,
  withoutMemoryCorrect: true,
};

describe('diffCasesOf', () => {
  it('carries the outcome and the difference, which is what every reading pairs', () => {
    const cases = diffCasesOf({ per_case: [QUESTION] });
    expect(cases).toHaveLength(1);
    expect(cases[0]).toMatchObject({
      id: 'financial#1',
      dbId: 'financial',
      correct: true,
      withoutMemoryCorrect: true,
    });
    expect(cases[0]?.delta.relation).toBe('unchanged');
  });

  it('refuses a run with no per_case rather than returning an empty corpus', () => {
    // An empty corpus produces every reading downstream as a zero, and a zero that means "no data"
    // reads exactly like a zero that means "no effect" — the failure this repository has spent the
    // most effort removing.
    expect(() => diffCasesOf({}, 'some artefact')).toThrow(/some artefact carries no per_case rows/);
    expect(() => diffCasesOf({ per_case: [] }, 'some artefact')).toThrow(/no per_case rows/);
  });

  it('passes the evidence through, because grounding depends on it', () => {
    // The predicted query names `county`, the question does not, and the evidence does. Under strict
    // grounding that is a grounded name; a corpus built without the evidence would call it imported
    // and the covariate would count a benchmark annotation as a model invention.
    const withEvidence = diffCasesOf({
      per_case: [
        {
          ...QUESTION,
          question: 'How long was the stop?',
          evidence: 'the county column holds the circuit name',
          predictedSql: 'SELECT count(*) FROM county',
          baselineSql: 'SELECT count(*) FROM race',
        },
      ],
    });
    expect(withEvidence[0]?.delta.ungrounded).toEqual([]);
    const withoutEvidence = diffCasesOf({
      per_case: [
        {
          ...QUESTION,
          question: 'How long was the stop?',
          predictedSql: 'SELECT count(*) FROM county',
          baselineSql: 'SELECT count(*) FROM race',
        },
      ],
    });
    expect(withoutEvidence[0]?.delta.ungrounded).toEqual(['county']);
  });

  it('keeps the run order, because the folds and the bootstrap both depend on it', () => {
    const cases = diffCasesOf({
      per_case: [QUESTION, { ...QUESTION, id: 'financial#2' }, { ...QUESTION, id: 'financial#3' }],
    });
    expect(cases.map((entry) => entry.id)).toEqual(['financial#1', 'financial#2', 'financial#3']);
  });

  it('defaults a missing evidence field to empty rather than to undefined', () => {
    const { evidence: _omitted, ...withoutEvidence } = QUESTION;
    const cases = diffCasesOf({ per_case: [withoutEvidence] });
    expect(cases).toHaveLength(1);
    expect(cases[0]?.delta.ungrounded).toEqual([]);
  });

  it('carries the pack ids through when the lane recorded them', () => {
    // The form reading groups questions by the rules their pack held, and a corpus that dropped the
    // ids would report every question as carrying no pure rule — a verdict about the classifier
    // produced by a missing field.
    const cases = diffCasesOf({ per_case: [{ ...QUESTION, packIdList: ['k_a', 'k_b'] }] });
    expect(cases[0]?.packIdList).toEqual(['k_a', 'k_b']);
  });

  it('leaves the pack ids absent rather than empty when the lane did not record them', () => {
    // Absent and empty are different answers: empty says the pack held no rules, and absent says
    // the run predates the field. The form reading has to be able to tell them apart.
    const cases = diffCasesOf({ per_case: [QUESTION] });
    expect(cases[0]?.packIdList).toBeUndefined();
    expect('packIdList' in (cases[0] ?? {})).toBe(false);
  });
});
