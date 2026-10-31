import { describe, expect, it } from 'vitest';
import { mulberry32 } from '@agentix-e/microglia-core';
import {
  admissionOf,
  keptItemIds,
  probeSummary,
  shuffledSource,
  transferSummary,
  transferTargets,
  transferringItemIds,
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

  it('counts citations, which is not the size of the store the probe was given', () => {
    // The two numbers answer different questions and were once wired into each other. A rule
    // cited by two of its own corrections contributes two to `summary.rules` and one to the four
    // admission buckets, so a gate that compares the buckets against the summary can only pass
    // in a store where no rule is cited twice. V13 is blocking; the substitution would have
    // failed every real run rather than an empty one.
    const trials = [trial('a', ['k1', 'k2'], 'supplied'), trial('b', ['k1'], 'supplied')];
    const summary = probeSummary(trials);
    const admission = admissionOf(
      [
        { id: 'k1', evidence: [{ taskId: 'a' }, { taskId: 'b' }] },
        { id: 'k2', evidence: [{ taskId: 'a' }] },
      ],
      trials,
    );
    expect(summary.rules).toBe(3);
    const counted =
      admission.kept.length +
      admission.noVerifiedSource +
      admission.brokeItsSource +
      admission.unsupported;
    expect(counted).toBe(2);
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

describe('transferTargets', () => {
  const sequence = (values: readonly number[]): (() => number) => {
    let at = 0;
    return () => values[at++ % values.length] as number;
  };

  it('never draws the rule\'s own case', () => {
    // A rule repairing the case it was written from is what the probe already measured, and
    // counting it again here would inflate the transfer rate by construction.
    const targets = transferTargets(['a', 'b', 'c'], 'a', 3, sequence([0]));
    expect(targets).not.toContain('a');
    expect([...targets].sort()).toEqual(['b', 'c']);
  });

  it('returns at most the cases that exist', () => {
    expect(transferTargets(['a', 'b'], 'a', 4, sequence([0])).length).toBe(1);
  });

  it('returns nothing for a count of zero, without consuming the generator', () => {
    let drawn = 0;
    const random = (): number => {
      drawn += 1;
      return 0.5;
    };
    expect(transferTargets(['a', 'b', 'c'], 'a', 0, random)).toEqual([]);
    expect(drawn).toBe(0);
  });

  it('draws distinct targets', () => {
    const targets = transferTargets(['a', 'b', 'c', 'd', 'e'], 'a', 4, sequence([0.1, 0.9, 0.3, 0.7]));
    expect(new Set(targets).size).toBe(targets.length);
    expect(targets.length).toBe(4);
  });

  it('is reproducible for the same generator', () => {
    // Two runs of the same fold must probe the same pairs: a target set that depended on
    // iteration order would make the transfer rate differ between two readings of one store.
    const first = transferTargets(['a', 'b', 'c', 'd'], 'a', 2, mulberry32(7));
    const second = transferTargets(['a', 'b', 'c', 'd'], 'a', 2, mulberry32(7));
    expect(first).toEqual(second);
  });

  it('reaches every candidate when the count allows it', () => {
    // Coverage is a property the artefact reports, so the draw must not systematically
    // ignore the tail of the list.
    const targets = transferTargets(['a', 'b', 'c', 'd'], 'a', 3, mulberry32(11));
    expect([...targets].sort()).toEqual(['b', 'c', 'd']);
  });
});

describe('transferSummary', () => {
  const trial = (
    itemId: string,
    targetId: string,
    blankCorrect: boolean | undefined,
    withRuleCorrect: boolean | undefined,
  ) => ({
    itemId,
    targetId,
    blankCorrect,
    withRuleCorrect,
  });

  it('treats a control call that never returned as a hole, not as a target that needed help', () => {
    // The blank is the denominator of everything a transfer trial claims: "the retry alone was
    // wrong" is what makes a repair attributable to the rule. A hole folded into `false` would put
    // the trial in the informative set and credit the rule with a repair it cannot have caused,
    // which is the one direction this statistic must never be able to move in.
    const summary = transferSummary([
      trial('k1', 'b', undefined, true),
      trial('k1', 'c', undefined, false),
      trial('k1', 'd', false, true),
    ]);
    expect(summary.unmeasured).toBe(2);
    expect(summary.unmeasuredBlank).toBe(2);
    expect(summary.measured).toBe(1);
    expect(summary.informative).toBe(1);
    expect(summary.repaired).toBe(1);
    expect(summary.netPp).toBeCloseTo(100, 6);
  });

  it('counts a blank hole and a treatment hole as the same absence', () => {
    // Two different calls can fail, and both leave the trial unable to speak. They are counted
    // apart only so a run can say which side of the pair its holes are on.
    const summary = transferSummary([
      trial('k1', 'b', undefined, true),
      trial('k1', 'c', false, undefined),
    ]);
    expect(summary.unmeasured).toBe(2);
    expect(summary.unmeasuredBlank).toBe(1);
    expect(summary.measured).toBe(0);
    expect(summary.netPp).toBe(0);
  });

  it('counts a repair only where the target needed one', () => {
    // The distinction the whole measurement rests on: a rule shown to a case that a bare
    // retry already fixes has demonstrated nothing, however right the answer is.
    const summary = transferSummary([
      trial('k1', 'b', false, true),
      trial('k1', 'c', true, true),
      trial('k1', 'd', false, false),
      trial('k1', 'e', false, undefined),
    ]);
    expect(summary.trials).toBe(4);
    expect(summary.informative).toBe(2);
    expect(summary.repaired).toBe(1);
    expect(summary.unchanged).toBe(1);
    expect(summary.blankRight).toBe(1);
    expect(summary.unmeasured).toBe(1);
    expect(summary.rate).toBeCloseTo(0.5, 6);
  });

  it('reports zero rather than dividing by an empty informative set', () => {
    const summary = transferSummary([trial('k1', 'b', true, true)]);
    expect(summary.informative).toBe(0);
    expect(summary.rate).toBe(0);
    expect(Number.isNaN(summary.rate)).toBe(false);
  });

  it('accounts for every trial exactly once', () => {
    const summary = transferSummary([
      trial('k1', 'b', false, true),
      trial('k1', 'c', true, false),
      trial('k1', 'd', true, true),
      trial('k1', 'e', false, undefined),
    ]);
    expect(summary.unmeasured + summary.blankRight + summary.informative).toBe(summary.trials);
    expect(summary.blankRight).toBe(2);
    expect(summary.broke).toBe(1);
  });

  it('counts rules, not trials, when it asks how many rules transferred', () => {
    const summary = transferSummary([
      trial('k1', 'b', false, true),
      trial('k1', 'c', false, true),
      trial('k2', 'b', false, false),
      trial('k3', 'c', false, true),
    ]);
    expect(summary.rules).toBe(3);
    expect(summary.rulesWithRepair).toBe(2);
    expect(summary.repaired).toBe(3);
  });

  it('reports an empty measurement as empty', () => {
    const summary = transferSummary([]);
    expect(summary).toMatchObject({ rules: 0, trials: 0, informative: 0, rate: 0, rulesWithRepair: 0 });
  });

  it('counts a rule that breaks a target the retry had fixed, not only the ones it repairs', () => {
    // The rate the lane published until iteration 99 divides by the targets a bare retry could not
    // fix, which excludes by construction every trial where the rule can do damage. A statistic
    // that cannot go down is not a measurement of value, so the summary carries the whole 2x2.
    const summary = transferSummary([
      trial('k1', 'b', false, true),
      trial('k1', 'c', false, false),
      trial('k1', 'd', true, true),
      trial('k1', 'e', true, false),
    ]);
    expect(summary.measured).toBe(4);
    expect(summary.marginalRepair).toBeCloseTo(0.25, 6);
    expect(summary.marginalBreak).toBeCloseTo(0.25, 6);
    expect(summary.netPp).toBe(0);
    expect(summary.breakRate).toBeCloseTo(0.5, 6);
  });

  it('reads a rule that repairs and never breaks as a positive net effect', () => {
    const summary = transferSummary([
      trial('k1', 'b', false, true),
      trial('k2', 'c', false, true),
      trial('k3', 'd', true, true),
      trial('k3', 'e', true, true),
    ]);
    expect(summary.marginalRepair).toBeCloseTo(0.5, 6);
    expect(summary.marginalBreak).toBe(0);
    expect(summary.netPp).toBeCloseTo(50, 6);
    expect(summary.breakRate).toBe(0);
  });

  it('says no-transfer when the net marginal effect is zero, whatever the conditional rate says', () => {
    // The shape iteration 99 measured: a real repair rate on the hard targets, cancelled by the
    // same number of breaks on the easy ones. Calling that a transfer because the conditional rate
    // is above zero would be reading a ratio whose denominator was chosen after the fact.
    const triples = Array.from({ length: 120 }, (_, at) => {
      const hard = trial(`h${at}`, `t${at}`, false, at < 9);
      const easy = trial(`e${at}`, `u${at}`, true, at >= 9);
      return [hard, easy] as const;
    }).flat();
    const summary = transferSummary(triples);
    expect(summary.rate).toBeCloseTo(9 / 120, 6);
    expect(summary.netPp).toBe(0);
    expect(summary.verdict).toBe('no-transfer');
  });

  it('says unmeasured rather than no-transfer when too few trials could show anything', () => {
    // A verdict is a claim, and a claim drawn from eleven informative trials is not one. The floor
    // is the same hundred the resolvability gate uses.
    const summary = transferSummary([trial('k1', 'b', false, true), trial('k1', 'c', false, false)]);
    expect(summary.informative).toBe(2);
    expect(summary.verdict).toBe('unmeasured');
  });

  it('says transfers only when the net effect survives the floor', () => {
    const trials = Array.from({ length: 200 }, (_, at) => trial(`k${at}`, `t${at}`, false, at < 40));
    const summary = transferSummary(trials);
    expect(summary.informative).toBe(200);
    expect(summary.netPp).toBeCloseTo(20, 6);
    expect(summary.verdict).toBe('transfers');
  });
});

describe('transferringItemIds', () => {
  it('never credits a rule with a repair whose control never returned', () => {
    // Same defect as the summary's, one level down: this list decides which rules survive both
    // gates, so a hole read as a repair would admit a rule on the strength of a missing call.
    const kept = transferringItemIds([
      { itemId: 'k1', targetId: 'b', blankCorrect: undefined, withRuleCorrect: true },
      { itemId: 'k2', targetId: 'c', blankCorrect: false, withRuleCorrect: true },
    ]);
    expect(kept).toEqual(['k2']);
  });
  it('keeps the rules that repaired at least one foreign case, in first-seen order', () => {
    expect(
      transferringItemIds([
        { itemId: 'k2', targetId: 'b', blankCorrect: false, withRuleCorrect: true },
        { itemId: 'k1', targetId: 'c', blankCorrect: false, withRuleCorrect: true },
        { itemId: 'k3', targetId: 'd', blankCorrect: false, withRuleCorrect: false },
      ]),
    ).toEqual(['k2', 'k1']);
  });

  it('names a rule once however many cases it repaired', () => {
    // A rule that repairs three foreign cases is one rule. Listing it three times would make the
    // count of transferring rules a count of trials, and the arm would appear to have more
    // admitted content than the store holds.
    expect(
      transferringItemIds([
        { itemId: 'k1', targetId: 'b', blankCorrect: false, withRuleCorrect: true },
        { itemId: 'k1', targetId: 'c', blankCorrect: false, withRuleCorrect: true },
      ]),
    ).toEqual(['k1']);
  });

  it('keeps a rule that repairs one case and fails another', () => {
    // The store admits a rule for one demonstration and excludes it for one break; a rule that
    // repairs one foreign case and misses another has demonstrated something and broken nothing,
    // which is the same standard the own-case probe applies.
    expect(
      transferringItemIds([
        { itemId: 'k1', targetId: 'b', blankCorrect: false, withRuleCorrect: true },
        { itemId: 'k1', targetId: 'c', blankCorrect: false, withRuleCorrect: false },
      ]),
    ).toEqual(['k1']);
  });
});
