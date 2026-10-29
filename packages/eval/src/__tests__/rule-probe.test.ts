import { describe, expect, it } from 'vitest';
import {
  admissionOf,
  keptItemIds,
  probeSummary,
  shuffledSource,
  verdictOf,
  type ProbeTrial,
} from '../rule-probe.js';

const trial = (
  taskId: string,
  itemIds: readonly string[],
  verdict: ProbeTrial['verdict'],
): ProbeTrial => ({ taskId, itemIds, verdict });

describe('verdictOf', () => {
  it('says the rules supplied the correction when they turn a failure into a success', () => {
    // The whole population of the experiment: the retry alone failed, the retry with the
    // rules distilled from this very question succeeded. That is the only verdict which
    // says the extraction captured something.
    expect(verdictOf(false, true)).toBe('supplied');
  });

  it('says the rules broke the case when the retry alone was right', () => {
    // The sharpest available evidence that a rule is wrong rather than merely useless: the
    // question needed no help, and the help is what made it wrong.
    expect(verdictOf(true, false)).toBe('broke');
  });

  it('says redundant when both attempts were right', () => {
    // The correction was reachable from the failure message alone, so the rules added
    // nothing here. Kept separate from `broke` because the two call for opposite action.
    expect(verdictOf(true, true)).toBe('redundant');
  });

  it('says useless when neither attempt was right', () => {
    expect(verdictOf(false, false)).toBe('useless');
  });

  it('refuses a verdict when either call never returned', () => {
    // A missing call is not a failed attempt. Crediting `undefined` as a failure would count
    // every provider hiccup as evidence against the rules, which is how a transient error
    // becomes a finding.
    expect(verdictOf(undefined, true)).toBeUndefined();
    expect(verdictOf(true, undefined)).toBeUndefined();
    expect(verdictOf(undefined, undefined)).toBeUndefined();
  });
});

describe('probeSummary', () => {
  it('counts every verdict and the questions it could not measure', () => {
    const summary = probeSummary([
      trial('a', ['k1'], 'supplied'),
      trial('b', ['k2'], 'supplied'),
      trial('c', ['k3'], 'redundant'),
      trial('d', ['k4'], 'broke'),
      trial('e', ['k5'], 'useless'),
      trial('f', ['k6'], undefined),
    ]);
    expect(summary.sourceQuestions).toBe(6);
    expect(summary.measured).toBe(5);
    expect(summary.unmeasured).toBe(1);
    expect(summary.supplied).toBe(2);
    expect(summary.redundant).toBe(1);
    expect(summary.broke).toBe(1);
    expect(summary.useless).toBe(1);
    expect(summary.rules).toBe(6);
  });

  it('reports how often the retry alone was already enough', () => {
    // `blankFixRate` is the retry channel's own ceiling on this population. Without it, a
    // `supplied` count looks like the rules doing work when part of it is the retry.
    const summary = probeSummary([
      trial('a', ['k1'], 'supplied'),
      trial('b', ['k2'], 'redundant'),
      trial('c', ['k3'], 'broke'),
      trial('d', ['k4'], 'useless'),
    ]);
    expect(summary.blankFixRate).toBeCloseTo(0.5, 6);
  });

  it('reports zero rather than dividing by an empty population', () => {
    const summary = probeSummary([]);
    expect(summary.sourceQuestions).toBe(0);
    expect(summary.measured).toBe(0);
    expect(summary.blankFixRate).toBe(0);
    expect(Number.isNaN(summary.blankFixRate)).toBe(false);
  });

  it('counts the rules a trial carried, not the trials', () => {
    // One correction can distil more than one rule, and the artefact has to be able to say
    // how much of the store the probe actually covered.
    const summary = probeSummary([trial('a', ['k1', 'k2', 'k3'], 'supplied')]);
    expect(summary.rules).toBe(3);
  });
});

describe('admissionOf', () => {
  const item = (id: string, taskIds: readonly string[]) => ({
    id,
    evidence: taskIds.map((taskId) => ({ taskId })),
  });

  it('keeps a rule whose source question reproduced its correction', () => {
    const admission = admissionOf([item('k1', ['a'])], [trial('a', ['k1'], 'supplied')]);
    expect(admission.kept).toEqual(['k1']);
    expect(admission.noVerifiedSource).toBe(0);
  });

  it('drops a rule that broke the case it was learned from', () => {
    // Even when another source reproduced, because a rule with one demonstration and one
    // counter-demonstration is not a rule this project can defend.
    const admission = admissionOf(
      [item('k1', ['a', 'b'])],
      [trial('a', ['k1'], 'supplied'), trial('b', ['k1'], 'broke')],
    );
    expect(admission.kept).toEqual([]);
    expect(admission.brokeItsSource).toBe(1);
  });

  it('drops a rule whose correction was reachable without it', () => {
    const admission = admissionOf(
      [item('k1', ['a'])],
      [trial('a', ['k1'], 'redundant'), trial('b', ['k2'], 'supplied')],
    );
    expect(admission.kept).toEqual([]);
    expect(admission.unsupported).toBe(1);
  });

  it('drops a rule no probe reached, and says so', () => {
    // The distinction between "the probe judged this rule unhelpful" and "the probe never
    // saw it" is the difference between a finding and a hole in the measurement.
    const admission = admissionOf([item('k1', ['z']), item('k2', [])], [trial('a', ['k3'], 'supplied')]);
    expect(admission.kept).toEqual([]);
    expect(admission.noVerifiedSource).toBe(2);
  });

  it('treats an unmeasured trial as no source at all', () => {
    // The pair whose calls failed reached no verdict, so a rule it carried has not been shown
    // to be anything. Crediting it as unsupported would blame the rule for our outage.
    const admission = admissionOf([item('k1', ['a'])], [trial('a', ['k1'], undefined)]);
    expect(admission.kept).toEqual([]);
    expect(admission.noVerifiedSource).toBe(1);
    expect(admission.unsupported).toBe(0);
  });

  it('ignores an evidence entry that names no task', () => {
    // The evidence shape allows it: a caller that never opened a task leaves the field out, and
    // the run id stands in everywhere else. Admission cannot look a verdict up by run id.
    const admission = admissionOf([{ id: 'k1', evidence: [{}, { taskId: 'a' }] }], [trial('a', ['k1'], 'supplied')]);
    expect(admission.kept).toEqual(['k1']);
  });

  it('accounts for every item it was given', () => {
    const items = [item('k1', ['a']), item('k2', ['a']), item('k3', ['b']), item('k4', ['z'])];
    const admission = admissionOf(items, [trial('a', ['k1'], 'supplied'), trial('b', ['k3'], 'broke')]);
    expect(admission.kept.length + admission.noVerifiedSource + admission.brokeItsSource + admission.unsupported).toBe(
      items.length,
    );
  });
});

describe('keptItemIds', () => {
  it('returns the kept ids in the store order they arrived in', () => {
    const items = [
      { id: 'k3', evidence: [{ taskId: 'a' }] },
      { id: 'k1', evidence: [{ taskId: 'a' }] },
      { id: 'k2', evidence: [{ taskId: 'b' }] },
    ];
    expect(keptItemIds(items, [trial('a', ['k1', 'k3'], 'supplied'), trial('b', ['k2'], 'broke')])).toEqual([
      'k3',
      'k1',
    ]);
  });
});

describe('shuffledSource', () => {
  const cell = (position: number, db: string, items: number) => ({ position, db, items });

  it('never returns the question itself', () => {
    // A pack drawn from its own question is `full` under another name, and the arm would
    // report zero difference as a measurement.
    const library = [cell(0, 'a', 2), cell(1, 'a', 2)];
    expect(shuffledSource(library, cell(0, 'a', 2))).toBe(1);
    expect(shuffledSource(library, cell(1, 'a', 2))).toBe(0);
  });

  it('draws only from the same database', () => {
    // The comparison is about specificity inside one workspace. A foreign database's rules
    // are already the `wrong-scope` arm, and they are ignored rather than followed.
    const library = [cell(0, 'a', 2), cell(1, 'b', 2)];
    expect(shuffledSource(library, cell(0, 'a', 2))).toBeUndefined();
  });

  it('prefers a pack of the same size, so the arm is not also a dosage test', () => {
    const library = [cell(0, 'a', 3), cell(1, 'a', 1), cell(2, 'a', 3)];
    expect(shuffledSource(library, cell(0, 'a', 3))).toBe(2);
  });

  it('breaks a size tie by position, so the pick is reproducible', () => {
    const library = [cell(0, 'a', 2), cell(5, 'a', 2), cell(9, 'a', 2)];
    expect(shuffledSource(library, cell(5, 'a', 2))).toBe(0);
  });

  it('reports nothing when the database holds one question', () => {
    expect(shuffledSource([cell(0, 'a', 2)], cell(0, 'a', 2))).toBeUndefined();
  });

  it('accepts a question whose pack is empty', () => {
    // An empty pack has zero items, and a source is still chosen for it: the arm must be
    // scored on every question, not only on the ones with something to swap.
    const library = [cell(0, 'a', 0), cell(1, 'a', 2)];
    expect(shuffledSource(library, cell(0, 'a', 0))).toBe(1);
  });
});
