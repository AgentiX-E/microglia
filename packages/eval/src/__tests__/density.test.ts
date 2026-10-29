import { describe, expect, it } from 'vitest';
import {
  classify,
  densityGates,
  densityReport,
  policyTable,
  selectDensityRules,
  stratumOf,
  targetPanels,
  type DensityRule,
  type DensityTarget,
  type DensityTrial,
  type StoredRuleInput,
} from '../density.js';

function stored(overrides: Partial<StoredRuleInput> & { id: string }): StoredRuleInput {
  return {
    status: 'active',
    statement: `rule ${overrides.id}`,
    when: null,
    domain: 'db_a',
    ...overrides,
  };
}

function rule(id: string, domain = 'db_a', statement?: string, when: string | null = null): DensityRule {
  return { id, domain, statement: statement ?? `rule ${id}`, when };
}

function target(
  id: string,
  dbId = 'db_a',
  overrides: Partial<DensityTarget> = {},
): DensityTarget {
  return {
    id,
    dbId,
    question: '',
    evidence: '',
    goldSql: '',
    baselineCorrect: true,
    ...overrides,
  };
}

/** One rule shown on one target, with the verdicts the ledger reads. */
function trial(overrides: Partial<DensityTrial> & { ruleId: string; targetId: string }): DensityTrial {
  return {
    domain: 'db_a',
    order: 0,
    correct: false,
    baselineCorrect: false,
    relevant: false,
    cued: false,
    ...overrides,
  };
}

describe('selectDensityRules', () => {
  it('keeps only active rules that name a database', () => {
    const selected = selectDensityRules(
      [
        stored({ id: 'a1' }),
        stored({ id: 'a2', status: 'retired' }),
        stored({ id: 'a3', domain: null }),
        stored({ id: 'a4', statement: '   ' }),
        stored({ id: 'a5', domain: '' }),
      ],
      3,
    );
    expect(selected.map((entry) => entry.id)).toEqual(['a1']);
  });

  it('caps each database and leaves every database represented', () => {
    const items = [
      ...['a1', 'a2', 'a3', 'a4'].map((id) => stored({ id, domain: 'db_a' })),
      stored({ id: 'b1', domain: 'db_b' }),
    ];
    const selected = selectDensityRules(items, 2);
    expect(selected.filter((entry) => entry.domain === 'db_a')).toHaveLength(2);
    expect(selected.filter((entry) => entry.domain === 'db_b').map((entry) => entry.id)).toEqual(['b1']);
  });

  it('selects the same rules whatever order the store listed them in', () => {
    const items = Array.from({ length: 12 }, (_unused, index) =>
      stored({ id: `a${index}`, statement: `claim number ${index}` }),
    );
    const forward = selectDensityRules(items, 4).map((entry) => entry.id);
    const backward = selectDensityRules([...items].reverse(), 4).map((entry) => entry.id);
    expect(backward).toEqual(forward);
  });

  it('keeps the condition the rule was stored with, because it is rendered', () => {
    const [only] = selectDensityRules([stored({ id: 'a1', when: 'when the table is empty' })], 1);
    expect(only?.when).toBe('when the table is empty');
  });

  it('orders two rules that say the same thing by id, so the store cannot decide', () => {
    const items = [
      stored({ id: 'a9', statement: 'identical claim' }),
      stored({ id: 'a1', statement: 'identical claim' }),
      stored({ id: 'a5', statement: 'a different claim' }),
    ];
    const forward = selectDensityRules(items, 1).map((entry) => entry.id);
    const backward = selectDensityRules([...items].reverse(), 1).map((entry) => entry.id);
    expect(backward).toEqual(forward);
  });

  it('takes nothing when the cap is zero', () => {
    expect(selectDensityRules([stored({ id: 'a1' })], 0)).toEqual([]);
  });
});

describe('targetPanels', () => {
  it('splits the targets by database and caps each panel', () => {
    const targets = [
      ...Array.from({ length: 6 }, (_unused, index) => target(`a${index}`, 'db_a')),
      ...Array.from({ length: 4 }, (_unused, index) => target(`b${index}`, 'db_b')),
    ];
    const panels = targetPanels(targets, 3, 7);
    expect(panels.get('db_a')).toHaveLength(3);
    expect(panels.get('db_b')).toHaveLength(3);
    expect([...(panels.get('db_a') ?? [])].every((entry) => entry.dbId === 'db_a')).toBe(true);
  });

  it('returns a short database whole rather than padding it', () => {
    const panels = targetPanels([target('a1'), target('a2')], 20, 7);
    expect(panels.get('db_a')).toHaveLength(2);
  });

  it('is stable for a seed and different across seeds', () => {
    const targets = Array.from({ length: 40 }, (_unused, index) => target(`a${index}`));
    const first = (targetPanels(targets, 5, 1).get('db_a') ?? []).map((entry) => entry.id);
    const again = (targetPanels([...targets].reverse(), 5, 1).get('db_a') ?? []).map((entry) => entry.id);
    const other = (targetPanels(targets, 5, 2).get('db_a') ?? []).map((entry) => entry.id);
    expect(again).toEqual(first);
    expect(other).not.toEqual(first);
  });

  it('draws nothing when the panel is zero', () => {
    expect(targetPanels([target('a1')], 0, 7).get('db_a')).toEqual([]);
  });
});

describe('classify', () => {
  const schema = new Set(['laboratory', 'patient', 'ssb', 'examination']);

  it('calls a rule relevant when its vocabulary answers the question', () => {
    const verdict = classify(rule('a1', 'db_a', 'The SSB column in Laboratory reports the assay.'), schema, {
      question: 'How many patients have a normal SSB?',
      evidence: '',
      goldSql: 'select count(*) from laboratory where SSB = "negative"',
    });
    expect(verdict.relevant).toBe(true);
    expect(verdict.cued).toBe(true);
  });

  it('calls a rule cued but not relevant when only the question mentions it', () => {
    const verdict = classify(rule('a1', 'db_a', 'The SSB column in Laboratory reports the assay.'), schema, {
      question: 'How many patients have a normal SSB?',
      evidence: '',
      goldSql: 'select count(*) from patient',
    });
    expect(verdict.cued).toBe(true);
    expect(verdict.relevant).toBe(false);
  });

  it('calls a rule neither when its vocabulary is absent from the case', () => {
    const verdict = classify(rule('a1', 'db_a', 'The SSB column in Laboratory reports the assay.'), schema, {
      question: 'List the students.',
      evidence: '',
      goldSql: 'select * from student',
    });
    expect(verdict).toEqual({ relevant: false, cued: false });
  });

  it('ignores words that are not in the schema, and words too short to be a column', () => {
    const verdict = classify(rule('a1', 'db_a', 'In the ssb column, id is an integer.'), new Set(['id']), {
      question: 'Which id?',
      evidence: '',
      goldSql: 'select id from t',
    });
    expect(verdict).toEqual({ relevant: false, cued: false });
  });

  it('ignores the condition the rule was stored with, which is prose about applicability', () => {
    const verdict = classify(
      rule('a1', 'db_a', 'Rows are counted once per patient.', 'when the examination table is joined'),
      schema,
      { question: 'How many rows?', evidence: '', goldSql: 'select count(*) from patient' },
    );
    expect(verdict.relevant).toBe(true);
  });
});

describe('stratumOf', () => {
  it('counts the flips and calls a rule that never moved an answer inert', () => {
    const summary = stratumOf([
      trial({ ruleId: 'r1', targetId: 't1', correct: true, baselineCorrect: false }),
      trial({ ruleId: 'r1', targetId: 't2', correct: true, baselineCorrect: true }),
      trial({ ruleId: 'r2', targetId: 't1', correct: true, baselineCorrect: true }),
      trial({ ruleId: 'r2', targetId: 't2', correct: true, baselineCorrect: true }),
    ]);
    expect(summary.rules).toBe(2);
    expect(summary.injections).toBe(4);
    expect(summary.helped).toBe(1);
    expect(summary.harmed).toBe(0);
    expect(summary.discriminating).toBe(1);
    expect(summary.inertShare).toBe(0.5);
    expect(summary.flipRate).toBe(0.25);
    expect(summary.minShown).toBe(2);
  });

  it('counts a rule whose flips cancel out as inert', () => {
    const summary = stratumOf([
      trial({ ruleId: 'r1', targetId: 't1', correct: true, baselineCorrect: false }),
      trial({ ruleId: 'r1', targetId: 't2', correct: false, baselineCorrect: true }),
    ]);
    expect(summary.discriminating).toBe(0);
    expect(summary.inertShare).toBe(1);
  });

  it('reports a net effect per injection, with an interval over targets', () => {
    const summary = stratumOf([
      trial({ ruleId: 'r1', targetId: 't1', correct: true, baselineCorrect: false }),
      trial({ ruleId: 'r2', targetId: 't1', correct: true, baselineCorrect: false }),
      trial({ ruleId: 'r1', targetId: 't2', correct: false, baselineCorrect: true }),
      trial({ ruleId: 'r2', targetId: 't2', correct: false, baselineCorrect: true }),
    ]);
    expect(summary.treatmentAccuracy).toBe(0.5);
    expect(summary.baselineAccuracy).toBe(0.5);
    expect(summary.deltaPp).toBeCloseTo(0, 10);
    // The two targets disagree completely, so the interval has to span the whole range.
    expect(summary.ciLowPp).toBeLessThanOrEqual(0);
    expect(summary.ciHighPp).toBeGreaterThanOrEqual(0);
  });

  it('tests the rules, not the injections, for a sign', () => {
    const helped = Array.from({ length: 8 }, (_unused, index) =>
      trial({ ruleId: `r${index}`, targetId: `t${index}`, correct: true, baselineCorrect: false }),
    );
    const summary = stratumOf(helped);
    expect(summary.signP).toBeLessThan(0.05);
    expect(summary.discriminating).toBe(8);
  });

  it('reports zeros rather than NaN when nothing was injected', () => {
    const summary = stratumOf([]);
    expect(summary).toEqual({
      rules: 0,
      injections: 0,
      helped: 0,
      harmed: 0,
      discriminating: 0,
      inertShare: 0,
      flipRate: 0,
      baselineAccuracy: 0,
      treatmentAccuracy: 0,
      deltaPp: 0,
      ciLowPp: 0,
      ciHighPp: 0,
      signP: 1,
      minShown: 0,
    });
  });
});

describe('policyTable', () => {
  /**
   * Three rules over four targets, split after the second.
   *
   *   good  repairs both fit targets, then repairs one scoring target and breaks the other
   *   bad   moves nothing on the fit half, then breaks a scoring target
   *   late  moves nothing on the fit half, then repairs both scoring targets
   *
   * Baselines: t1 and t2 and t3 wrong, t4 right. So `late` is a rule the fit half cannot justify
   * and the scoring half rewards, which is exactly the gap between `fitted` and `oracle`.
   */
  const trials = [
    trial({ ruleId: 'good', targetId: 't1', order: 0, correct: true }),
    trial({ ruleId: 'good', targetId: 't2', order: 1, correct: true }),
    trial({ ruleId: 'good', targetId: 't3', order: 2, correct: true }),
    trial({ ruleId: 'good', targetId: 't4', order: 3, correct: false, baselineCorrect: true }),
    trial({ ruleId: 'bad', targetId: 't1', order: 0, correct: false }),
    trial({ ruleId: 'bad', targetId: 't2', order: 1, correct: false }),
    trial({ ruleId: 'bad', targetId: 't3', order: 2, correct: false }),
    trial({ ruleId: 'bad', targetId: 't4', order: 3, correct: false, baselineCorrect: true }),
    trial({ ruleId: 'late', targetId: 't1', order: 0, correct: false }),
    trial({ ruleId: 'late', targetId: 't2', order: 1, correct: false }),
    trial({ ruleId: 'late', targetId: 't3', order: 2, correct: true }),
    trial({ ruleId: 'late', targetId: 't4', order: 3, correct: true, baselineCorrect: true }),
  ];

  it('prices showing every rule as the treatment the run measured', () => {
    const always = policyTable(trials, 2)[0];
    expect(always?.name).toBe('always');
    expect(always?.injections).toBe(6);
    expect(always?.shown).toBe(6);
    expect(always?.baselineAccuracy).toBe(0.5);
    // Showing every rule repairs two scoring targets and breaks two, which is the null this
    // project has measured eight times: the treatment is the control.
    expect(always?.treatmentAccuracy).toBe(0.5);
    expect(always?.deltaPp).toBeCloseTo(0, 10);
    expect(always?.gained).toBe(2);
    expect(always?.lost).toBe(2);
  });

  it('leaves a rule the fit half found neutral at the control', () => {
    const fitted = policyTable(trials, 2).find((row) => row.name === 'fitted');
    // Only `good` earned a reason to be shown, and on the scoring half it broke as often as it
    // repaired — so the policy is exactly the control, which is the finding, not a failure.
    expect(fitted?.shown).toBe(2);
    expect(fitted?.treatmentAccuracy).toBe(0.5);
    expect(fitted?.baselineAccuracy).toBe(0.5);
    expect(fitted?.deltaPp).toBeCloseTo(0, 10);
  });

  it('prices a decided-by-the-question filter without fitting anything', () => {
    const cued = policyTable(
      trials.map((entry) => ({ ...entry, cued: entry.ruleId === 'late' })),
      2,
    ).find((row) => row.name === 'cued');
    expect(cued?.shown).toBe(2);
    expect(cued?.treatmentAccuracy).toBeCloseTo(4 / 6, 10);
    expect(cued?.deltaPp).toBeCloseTo(100 / 6, 10);
    expect(cued?.gained).toBe(1);
    expect(cued?.lost).toBe(0);
  });

  it('bounds every policy from above by the one that knows the scoring half', () => {
    const rows = policyTable(trials, 2);
    const oracle = rows.find((row) => row.name === 'oracle');
    for (const row of rows) expect(oracle?.treatmentAccuracy ?? 0).toBeGreaterThanOrEqual(row.treatmentAccuracy);
    // `good` broke one of its two scoring targets, so the ceiling drops it and keeps `late`.
    expect(oracle?.treatmentAccuracy).toBeCloseTo(4 / 6, 10);
  });

  it('shows nothing when a rule has no scoring trial to judge it on', () => {
    const onlyFit = [
      ...trials,
      trial({ ruleId: 'gone', targetId: 't1', order: 0, correct: true }),
      trial({ ruleId: 'gone', targetId: 't2', order: 1, correct: true }),
    ];
    const oracle = policyTable(onlyFit, 2).find((row) => row.name === 'oracle');
    // `gone` earned a reason to be carried on the fit half, and the scoring half never asks about
    // it: the ceiling has no evidence either way, so it shows nothing rather than assuming either.
    expect(oracle?.shown).toBe(2);
    expect(oracle?.injections).toBe(6);
  });

  it('decides nothing when nothing was fitted, and falls back to the control', () => {
    const rows = policyTable(trials, 0);
    const fitted = rows.find((row) => row.name === 'fitted');
    expect(fitted?.shown).toBe(0);
    expect(fitted?.deltaPp).toBeCloseTo(0, 10);
  });
});

describe('densityReport', () => {
  const rules = [rule('r1', 'db_a'), rule('r2', 'db_a')];
  const trials = [
    trial({ ruleId: 'r1', targetId: 'a1', order: 0, correct: true, relevant: true, cued: true }),
    trial({ ruleId: 'r1', targetId: 'a2', order: 1, correct: false, baselineCorrect: true }),
    trial({ ruleId: 'r2', targetId: 'a1', order: 0, correct: false, baselineCorrect: true }),
    trial({ ruleId: 'r2', targetId: 'a2', order: 1, correct: false, baselineCorrect: true }),
  ];

  it('reports the panel, the population and every stratum', () => {
    const report = densityReport({ rules, panel: 2, trials, floorTrials: [] });
    expect(report.panel).toBe(2);
    expect(report.rules).toBe(2);
    expect(report.targets).toBe(2);
    expect(report.injections).toBe(4);
    expect(report.overall.injections).toBe(4);
    expect(report.relevant.injections).toBe(1);
    expect(report.irrelevant.injections).toBe(3);
    expect(report.cued.injections).toBe(1);
  });

  it('states how often the least and most exercised rule was shown', () => {
    const report = densityReport({
      rules,
      panel: 2,
      trials: [...trials, ...trials.filter((entry) => entry.ruleId === 'r1')],
      floorTrials: [],
    });
    expect(report.shown).toEqual({ min: 2, median: 2, max: 4 });
  });

  it('counts a selected rule that was never injected at zero, so the gate can see it', () => {
    const report = densityReport({ rules: [...rules, rule('r3')], panel: 2, trials, floorTrials: [] });
    expect(report.shown.min).toBe(0);
    expect(report.rules).toBe(3);
  });

  it('prices the policies on the second half of the panel', () => {
    const report = densityReport({ rules, panel: 2, trials, floorTrials: [] });
    expect(report.policies.map((row) => row.name)).toEqual(['always', 'fitted', 'cued', 'oracle']);
  });
});

describe('densityGates', () => {
  function report(overrides: { min?: number; discriminating?: boolean; injections?: number } = {}) {
    const rules = [rule('r1'), rule('r2')];
    const trials = [
      trial({
        ruleId: 'r1',
        targetId: 't1',
        correct: overrides.discriminating === false ? false : true,
        baselineCorrect: false,
      }),
      trial({ ruleId: 'r1', targetId: 't2', correct: true, baselineCorrect: true }),
      trial({ ruleId: 'r2', targetId: 't1', correct: false, baselineCorrect: true }),
      trial({ ruleId: 'r2', targetId: 't2', correct: true, baselineCorrect: true }),
    ];
    const base = densityReport({ rules, panel: 2, trials, floorTrials: [trials[0] as DensityTrial] });
    return {
      ...base,
      shown: { ...base.shown, min: overrides.min ?? base.shown.min },
      ...(overrides.injections === undefined ? {} : { injections: overrides.injections }),
    };
  }

  it('passes a family where every rule was exercised at the panel size', () => {
    const gates = densityGates(report());
    expect(gates.map((gate) => gate.pass)).toEqual([true, true, true, true]);
  });

  it('fails the density bar when a rule was shown fewer times than the panel', () => {
    const gates = densityGates(report({ min: 1 }));
    expect(gates[0]?.pass).toBe(false);
    expect(gates[0]?.blocking).toBe(true);
  });

  it('fails the discrimination bar below sixty percent of rules', () => {
    const gates = densityGates(report({ discriminating: false }));
    expect(gates[1]?.pass).toBe(false);
    expect(gates[1]?.actual).toContain('50.0%');
  });

  it('fails reconciliation when the injections do not cover the rules', () => {
    const gates = densityGates(report({ injections: 3 }));
    expect(gates[2]?.pass).toBe(false);
  });

  it('fails reconciliation when a stratum does not add up to the whole', () => {
    const base = report();
    const broken = { ...base, irrelevant: { ...base.irrelevant, injections: base.irrelevant.injections - 1 } };
    expect(densityGates(broken)[2]?.pass).toBe(false);
  });

  it('keeps the floor advisory and fails it when the control never ran', () => {
    const empty = densityReport({ rules: [], panel: 1, trials: [], floorTrials: [] });
    const gates = densityGates(empty);
    expect(gates[3]?.pass).toBe(false);
    expect(gates[3]?.blocking).toBe(false);
  });
});
