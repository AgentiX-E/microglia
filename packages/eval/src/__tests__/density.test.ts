import { describe, expect, it } from 'vitest';
import {
  classify,
  crossFit,
  densityGates,
  densityReport,
  policyTable,
  ruleDensityRows,
  selectDensityRules,
  signPersistence,
  stratumOf,
  targetPanels,
  type CrossFitRow,
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

  it('takes nothing from a database the panels do not cover', () => {
    const items = [stored({ id: 'a1', domain: 'db_a' }), stored({ id: 'b1', domain: 'db_b' })];
    expect(selectDensityRules(items, 2, new Set(['db_a'])).map((entry) => entry.id)).toEqual(['a1']);
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

describe('ruleDensityRows', () => {
  it('splits a rule\'s record into the half a policy may read and the half it is scored on', () => {
    const rows = ruleDensityRows(
      [rule('r1')],
      [
        trial({ ruleId: 'r1', targetId: 't1', order: 0, correct: true }),
        trial({ ruleId: 'r1', targetId: 't2', order: 1, correct: false, baselineCorrect: true }),
        trial({ ruleId: 'r1', targetId: 't3', order: 2, correct: true, relevant: true }),
        trial({ ruleId: 'r1', targetId: 't4', order: 3, correct: true }),
      ],
      2,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      shown: 4,
      helped: 3,
      harmed: 1,
      fitHelped: 1,
      fitHarmed: 1,
      scoreHelped: 2,
      scoreHarmed: 0,
      relevantShown: 1,
      relevantHelped: 1,
      relevantHarmed: 0,
    });
  });

  it('keeps a selected rule that was never shown, at zero', () => {
    const rows = ruleDensityRows([rule('r1'), rule('r2')], [trial({ ruleId: 'r1', targetId: 't1' })], 1);
    expect(rows.map((row) => row.shown)).toEqual([1, 0]);
  });

  it('drops a trial whose rule was never selected rather than inventing a rule', () => {
    const rows = ruleDensityRows([rule('r1')], [trial({ ruleId: 'ghost', targetId: 't1' })], 1);
    expect(rows.map((row) => row.id)).toEqual(['r1']);
  });
});

describe('signPersistence', () => {
  function row(id: string, fit: number, score: number) {
    return {
      id,
      shown: 4,
      helped: Math.max(fit, 0) + Math.max(score, 0),
      harmed: Math.max(-fit, 0) + Math.max(-score, 0),
      fitHelped: Math.max(fit, 0),
      fitHarmed: Math.max(-fit, 0),
      scoreHelped: Math.max(score, 0),
      scoreHarmed: Math.max(-score, 0),
      relevantShown: 0,
      relevantHelped: 0,
      relevantHarmed: 0,
    };
  }

  it('reports how many rules had a sign to learn from and how often it repeated', () => {
    const signs = signPersistence([
      row('a', 2, 1),
      row('b', 1, -1),
      row('c', -2, -1),
      row('d', 0, 2),
    ]);
    expect(signs.withFitSign).toBe(3);
    expect(signs.paired).toBe(3);
    expect(signs.agreed).toBe(2);
    expect(signs.disagreed).toBe(1);
    expect(signs.agreement).toBeCloseTo(2 / 3, 10);
    expect(signs.p).toBeGreaterThan(0.5);
  });

  it('calls a sign that never repeats unpredicted', () => {
    const signs = signPersistence(Array.from({ length: 8 }, (_unused, at) => row(`r${at}`, 1, at % 2 === 0 ? -1 : 1)));
    expect(signs.agreed).toBe(4);
    expect(signs.disagreed).toBe(4);
    expect(signs.p).toBe(1);
  });

  it('says nothing when no rule had a sign to repeat', () => {
    expect(signPersistence([row('a', 0, 0)])).toMatchObject({ paired: 0, agreed: 0, agreement: 0, p: 1 });
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

  it('reports zeros for a run that selected no rule, rather than dividing by an empty panel', () => {
    const empty = densityReport({ rules: [], panel: 1, trials: [], floorTrials: [] });
    expect(empty.shown).toEqual({ min: 0, median: 0, max: 0 });
    expect(empty.targets).toBe(0);
    expect(empty.crossFit.store.injections).toBe(0);
    expect(densityGates(empty)[0]?.pass).toBe(false);
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

  /** A cross-fit reading shaped by hand, so the two new bars can be failed one at a time. */
  function crossRow(overrides: Partial<CrossFitRow> = {}): CrossFitRow {
    return {
      folds: 5,
      repeats: 10,
      shown: 20,
      injections: 40,
      baselineAccuracy: 0.5,
      treatmentAccuracy: 0.55,
      deltaPp: 5,
      ciLowPp: 1,
      ciHighPp: 9,
      gained: 6,
      lost: 1,
      ...overrides,
    };
  }

  /** `report()` plus the cross-fit reading the last two bars read, and nothing else changed. */
  function fitted(
    base: ReturnType<typeof report>,
    cross: { store?: CrossFitRow; floor?: CrossFitRow } = {},
  ): ReturnType<typeof report> {
    // The default floor is the store's reading minus content: foreign rules fitted the same way.
    return {
      ...base,
      crossFit: {
        store: cross.store ?? crossRow(),
        floor:
          cross.floor ??
          crossRow({ treatmentAccuracy: 0.49, deltaPp: -1, ciLowPp: -3, ciHighPp: 1, gained: 1, lost: 2 }),
      },
    };
  }

  it('passes a family where every rule was exercised at the panel size', () => {
    const gates = densityGates(fitted(report()));
    expect(gates.map((gate) => gate.id)).toEqual([
      'V18-density-exercised',
      'V19-density-discriminates',
      'V20-density-reconciles',
      'V21-density-floor',
      'V22-density-crossfit-covers',
      'V23-density-crossfit-beats-floor',
    ]);
    expect(gates.map((gate) => gate.pass)).toEqual([true, true, true, true, true, true]);
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
    const empty = report();
    const gates = densityGates({ ...empty, floor: { ...empty.floor, injections: 0 } });
    expect(gates[3]?.pass).toBe(false);
    expect(gates[3]?.blocking).toBe(false);
  });

  it('emits no cross-fit bars for an artefact that predates them', () => {
    const { crossFit, ...legacy } = report();
    expect(crossFit).toBeDefined();
    expect(densityGates(legacy).map((gate) => gate.id)).toEqual([
      'V18-density-exercised',
      'V19-density-discriminates',
      'V20-density-reconciles',
      'V21-density-floor',
    ]);
  });

  it('fails coverage when a trial was scored a different number of times', () => {
    const gates = densityGates(fitted(report(), { store: crossRow({ injections: 39 }) }));
    expect(gates[4]?.id).toBe('V22-density-crossfit-covers');
    expect(gates[4]?.pass).toBe(false);
    expect(gates[4]?.blocking).toBe(true);
  });

  it('fails coverage when the split was made once, which is the null R9.3 has to beat', () => {
    const gates = densityGates(fitted(report(), { store: crossRow({ repeats: 1, injections: 4 }) }));
    expect(gates[4]?.pass).toBe(false);
    expect(gates[4]?.actual).toContain('1 repeat');
  });

  it('fails coverage when there is no fold to hold out', () => {
    const gates = densityGates(fitted(report(), { store: crossRow({ folds: 1 }) }));
    expect(gates[4]?.pass).toBe(false);
    expect(gates[4]?.actual).toContain('1 fold');
  });

  it('passes the content bar only when the store clears zero and beats the foreign rules', () => {
    const gates = densityGates(fitted(report(), { store: crossRow({ ciLowPp: 1 }), floor: crossRow({ deltaPp: 2 }) }));
    expect(gates[5]?.id).toBe('V23-density-crossfit-beats-floor');
    expect(gates[5]?.pass).toBe(true);
    expect(gates[5]?.blocking).toBe(false);
  });

  it('fails the content bar when the interval still contains zero', () => {
    const gates = densityGates(
      fitted(report(), { store: crossRow({ ciLowPp: -0.5 }), floor: crossRow({ deltaPp: -2 }) }),
    );
    expect(gates[5]?.pass).toBe(false);
  });

  it('fails the content bar when foreign rules fitted the same way did better', () => {
    const gates = densityGates(fitted(report(), { store: crossRow({ ciLowPp: 1 }), floor: crossRow({ deltaPp: 6 }) }));
    expect(gates[5]?.pass).toBe(false);
    expect(gates[5]?.actual).toContain('floor');
  });
});

describe('crossFit', () => {
  /**
   * A rule shown on `count` consecutive positions, with the effect the caller decides per position.
   *
   * `helps` is a question the control got wrong and the rule got right, `hurts` the reverse, and
   * `pass` a question both got right — the three states that matter to a flip.
   */
  function panel(
    ruleId: string,
    count: number,
    effect: (order: number) => 'helps' | 'hurts' | 'pass',
  ): DensityTrial[] {
    const out: DensityTrial[] = [];
    for (let order = 0; order < count; order += 1) {
      const kind = effect(order);
      out.push(
        trial({
          ruleId,
          targetId: `${ruleId}-${order}`,
          order,
          baselineCorrect: kind !== 'helps',
          correct: kind !== 'hurts',
        }),
      );
    }
    return out;
  }

  it('shows a rule that helped on every out-of-fold trial and earns every injection', () => {
    const row = crossFit(panel('r1', 10, () => 'helps'), { folds: 5, repeats: 2 });
    expect(row.shown).toBe(20);
    expect(row.injections).toBe(20);
    expect(row.gained).toBe(20);
    expect(row.lost).toBe(0);
    expect(row.deltaPp).toBe(100);
    expect(row.ciLowPp).toBe(100);
  });

  it('hides a rule that never helped out of fold, rather than defaulting it into the prompt', () => {
    const row = crossFit(panel('r1', 10, () => 'hurts'), { folds: 5, repeats: 2 });
    expect(row.injections).toBe(20);
    expect(row.shown).toBe(0);
    expect(row.gained).toBe(0);
    expect(row.lost).toBe(0);
    expect(row.deltaPp).toBe(0);
  });

  it('treats a question both answers got right as no evidence either way', () => {
    const row = crossFit(panel('r1', 10, () => 'pass'), { folds: 5, repeats: 2 });
    expect(row.shown).toBe(0);
    expect(row.baselineAccuracy).toBe(1);
    expect(row.treatmentAccuracy).toBe(1);
    expect(row.deltaPp).toBe(0);
  });

  it('leaves the trial it is scoring out of the rule own evidence', () => {
    // Leave-one-out is the sharpest form of the question: a rule that helped on exactly one
    // question must not be shown on that question, because the only thing that would justify
    // showing it is the trial being scored.
    const trials = panel('r1', 10, (order) => (order === 0 ? 'helps' : 'pass'));
    const cross = crossFit(trials, { folds: 10, repeats: 1 });
    expect(cross.injections).toBe(10);
    expect(cross.shown).toBe(9);
    expect(cross.gained).toBe(0);
    expect(cross.deltaPp).toBe(0);
  });

  it('agrees with a single split when the effect is the same on every question', () => {
    const trials = panel('r1', 10, () => 'helps');
    const fittedRow = policyTable(trials, 5).find((row) => row.name === 'fitted');
    const cross = crossFit(trials, { folds: 5, repeats: 1 });
    expect(fittedRow?.deltaPp).toBe(100);
    expect(cross.deltaPp).toBe(100);
  });

  it('scores every injection exactly once per repeat', () => {
    const trials = [...panel('r1', 10, () => 'helps'), ...panel('r2', 10, () => 'pass')];
    const once = crossFit(trials, { folds: 5, repeats: 1 });
    const thrice = crossFit(trials, { folds: 5, repeats: 3 });
    expect(once.injections).toBe(20);
    expect(thrice.injections).toBe(60);
    expect(once.shown).toBe(10);
  });

  it('does not depend on the order the trials arrive in', () => {
    const trials = [
      ...panel('r1', 10, (order) => (order % 3 === 0 ? 'helps' : 'hurts')),
      ...panel('r2', 10, () => 'helps'),
    ];
    const straight = crossFit(trials, { folds: 5, repeats: 4, seed: 3 });
    const shuffled = crossFit([...trials].reverse(), { folds: 5, repeats: 4, seed: 3 });
    expect(shuffled).toEqual(straight);
  });

  it('says nothing when there is nothing to score', () => {
    const row = crossFit([]);
    expect(row).toMatchObject({ injections: 0, shown: 0, gained: 0, lost: 0, deltaPp: 0, ciLowPp: 0 });
  });

  it('reads its defaults off the pre-registered split', () => {
    const row = crossFit(panel('r1', 10, () => 'helps'));
    expect(row.folds).toBe(5);
    expect(row.repeats).toBe(10);
    expect(row.injections).toBe(100);
  });

  it('refuses a split that cannot separate fitting from scoring', () => {
    expect(() => crossFit(panel('r1', 4, () => 'helps'), { folds: 1 })).toThrow(RangeError);
    expect(() => crossFit(panel('r1', 4, () => 'helps'), { repeats: 0 })).toThrow(RangeError);
  });
});
