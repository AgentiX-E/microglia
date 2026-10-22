import { describe, expect, it } from 'vitest';
import { EmbeddedMemory, MemoryJournal } from '@agentix-e/microglia-core/memory';
import { emptyPack } from '@agentix-e/microglia-core/apply';
import { openMicroglia, type Microglia } from '@agentix-e/microglia-core/capture';
import { ruleInterpreter } from '@agentix-e/microglia-core/distill';
import { mulberry32, steppingClock } from '@agentix-e/microglia-core';
import { chartEditDistance, chartInterpreter } from '../workload/index.js';
import {
  CONVENTIONS,
  REVISIONS,
  buildConventions,
  holdoutCases,
  revisionCases,
  trainingSplit,
  unreachableCases,
} from '../conventions.js';
import {
  baselineCorrect,
  buildL2bGates,
  citedCorrections,
  correctionFor,
  diffRuleStates,
  featuresFor,
  laneSetup,
  predictAll,
  ruleStates,
  runL2b,
  runPairArm,
  shareOf,
  staleActive,
  teachCase,
  teachingSchedule,
  type ArmReport,
} from '../lanes/pairs.js';

const combined = async (context: Parameters<typeof chartInterpreter>[0]) => [
  ...chartInterpreter(context),
  ...(await ruleInterpreter(context)),
];

async function lane(): Promise<Microglia> {
  const store = await EmbeddedMemory.open(new MemoryJournal());
  return openMicroglia({
    app: 'microglia-l2b',
    namespace: 'l2b',
    store,
    interpreter: combined,
    editSemantics: chartEditDistance,
    clock: steppingClock(1_700_000_000_000, 1),
    random: mulberry32(20261022),
  });
}

const cases = buildConventions();
const teaching = trainingSplit(cases);
const revisions = revisionCases(cases);
const holdout = holdoutCases(cases);
const cold = teaching.find((entry) => entry.baseline.mark !== entry.goldMark && entry.intent === 'trend');
const alreadyRight = teaching.find((entry) => entry.baseline.mark === entry.goldMark);
const revised = revisions.find((entry) => entry.domain === 'sales');
if (cold === undefined || alreadyRight === undefined || revised === undefined) {
  throw new Error('the corpus lost a case the tests rely on');
}

describe('the convention corpus as a lane input', () => {
  it('states every key twice, plus a revision where a convention moved', () => {
    expect(cases).toHaveLength(18);
    expect(teaching).toHaveLength(6);
    expect(revisions.map((entry) => entry.id)).toEqual([
      'cv_sales_comparisonr',
      'cv_finance_comparisonr',
    ]);
    expect(holdout).toHaveLength(8);
    expect(teaching.some((entry) => entry.domain === 'ops')).toBe(false);
  });

  it('asks the holdout for the convention in force now', () => {
    // The regression this pins: judging a revised question by the *pre*-revision
    // answer scores a store that followed the revision as wrong, and makes the
    // revision round unmeasurable.
    for (const entry of holdout.filter((one) => one.intent === 'comparison')) {
      const current = REVISIONS[entry.domain] ?? CONVENTIONS[entry.domain] ?? entry.policyMark;
      expect(entry.goldMark).toBe(current);
    }
    expect(holdout.find((entry) => entry.id === 'cvho_sales_comparison')?.goldMark).toBe('pie');
    expect(holdout.find((entry) => entry.id === 'cvho_finance_comparison')?.goldMark).toBe('line');
  });

  it('re-asks the teaching question itself, with the revised answer', () => {
    const original = teaching.find(
      (entry) => entry.domain === revised.domain && entry.intent === revised.intent,
    );
    expect(original?.query.text).toBe(revised.query.text);
    expect(original?.query.field).toBe(revised.query.field);
    expect(original?.goldMark).not.toBe(revised.goldMark);
  });

  it('is a corpus item, so the reader takes it without an adapter', () => {
    for (const entry of cases) {
      expect(entry.query.domain).toBe(entry.domain);
      expect(entry.gold.mark).toBe(entry.goldMark);
      expect(entry.baseline.mark).toBeDefined();
    }
  });

  it('makes every correction a single-field edit', () => {
    for (const entry of cases) {
      expect(correctionFor(entry, entry.baseline)).toEqual(entry.gold);
    }
  });

  it('keeps exactly the untaught convention on the far side of the wall', () => {
    expect(unreachableCases(cases).map((entry) => entry.id)).toEqual(['cvho_ops_comparison']);
  });

  it('records the features the interpreter scopes a lesson by', () => {
    const features = featuresFor(cold);
    expect(features['domain']).toBe(cold.domain);
    expect(features['intent']).toBe(cold.intent);
    expect(features['field']).toBe(cold.query.field);
    expect(features['categoryCount']).toBe(4);
    expect(features['grain']).toBe('month');
    expect(features['question']).toBe(cold.query.text);
  });

  it('schedules two rounds and knows which answer each scope owes', () => {
    const schedule = teachingSchedule(cases);
    expect(schedule.map((round) => round.id)).toEqual(['base', 'revision']);
    expect(schedule.map((round) => round.cases.length)).toEqual([6, 2]);
    const setup = laneSetup(cases);
    expect(setup.wall.has('cvho_ops_comparison')).toBe(true);
    expect(setup.due.get('sales\u0000comparison')).toBe('pie');
    expect(setup.due.get('ops\u0000comparison')).toBe('scatter');
  });
});

describe('the two teaching protocols', () => {
  it('single: one attempt, one correction, nothing else', async () => {
    const mg = await lane();
    const outcome = await teachCase(mg, cold, 'single');
    // An empty store answers from the baseline, so the first correction cites
    // nothing: that is why the lane needs a second round.
    expect(outcome).toEqual({ runs: 1, corrections: 1, cited: 0 });
    const events = await mg.store.listEvents();
    expect(events.map((event) => event.signal.type).sort()).toEqual(['edit', 'outcome']);
    await mg.close();
  });

  it('pair: two attempts linked by parentRunId, with the failure recorded', async () => {
    const mg = await lane();
    const outcome = await teachCase(mg, cold, 'pair');
    expect(outcome).toEqual({ runs: 2, corrections: 1, cited: 0 });

    const events = await mg.store.listEvents();
    const failure = events.find((event) => event.signal.type === 'outcome' && event.signal.ok === false);
    if (failure === undefined || failure.signal.type !== 'outcome') throw new Error('missing failure');
    expect(failure.signal.code).toBe('wrong-mark');

    const edit = events.find((event) => event.signal.type === 'edit');
    if (edit === undefined) throw new Error('missing edit');
    expect(edit.runId).not.toBe(failure.runId);

    const first = await mg.store.getRun(failure.runId);
    const second = await mg.store.getRun(edit.runId);
    expect(first?.attempt).toBe(1);
    expect(second?.attempt).toBe(2);
    expect(second?.parentRunId).toBe(first?.id);
    expect(second?.taskId).toBe(first?.taskId);
    expect(second?.provenance.knowledgeIds).toEqual(first?.provenance.knowledgeIds);
    await mg.close();
  });

  it('neither protocol invents a failure where the loop was right', async () => {
    for (const arm of ['single', 'pair'] as const) {
      const mg = await lane();
      expect(await teachCase(mg, alreadyRight, arm)).toEqual({ runs: 1, corrections: 0, cited: 0 });
      const events = await mg.store.listEvents();
      expect(events.map((event) => event.signal.type)).toEqual(['outcome']);
      await mg.close();
    }
  });

  it('counts a correction that cites a rule, and a revision is one', async () => {
    const mg = await lane();
    for (const item of teaching) await teachCase(mg, item, 'single');
    await mg.distill({ generalize: true });
    const outcome = await teachCase(mg, revised, 'single');
    expect(outcome.cited).toBeGreaterThan(0);
    expect(citedCorrections([outcome])).toBe(1);
    await mg.close();
  });
});

describe('the mechanism: what actually blames the stale rule', () => {
  it('a correction on the run that cited the rule demotes it', async () => {
    const mg = await lane();
    for (const item of teaching) await teachCase(mg, item, 'single');
    await mg.distill({ generalize: true });
    const before = await mg.store.listKnowledge({ namespace: 'l2b', status: 'all' });
    expect(before.some((item) => item.status === 'active' && item.scope.domain === 'sales')).toBe(true);

    await teachCase(mg, revised, 'single');
    await mg.distill({ generalize: true });
    const after = await mg.store.listKnowledge({ namespace: 'l2b', status: 'all' });
    const stale = after.filter(
      (item) => item.scope.domain === 'sales' && item.scope.intent === 'comparison' && item.status === 'active',
    );
    // Only the revised rule may remain active for that scope.
    expect(stale.map((item) => (item.payload as { then: { mark: string } }).then.mark)).toEqual(['pie']);
    await mg.close();
  });

  it('a correction that blames nothing still demotes the stale rule', async () => {
    // The null, explained from below: a correction landing on a scope where an
    // active rule disagrees records a *contradiction*, and contradiction
    // resolution demotes the old rule without any help from credit assignment.
    // That is why the pair protocol cannot beat the single one here — the decision
    // has already been made by the time a failure record could add to it.
    const mg = await lane();
    for (const item of teaching) await teachCase(mg, item, 'single');
    await mg.distill({ generalize: true });

    const detached = mg.begin({
      task: 'chart.recommend',
      input: featuresFor(revised),
      pack: emptyPack(1200),
      promptVersion: 'l2b-v2',
      domainPack: 'nl2charts',
      schemaDigest: revised.domain,
    });
    await detached.complete(revised.baseline as never);
    await detached.edit(revised.gold as never, { note: 'detached correction' });
    await mg.distill({ generalize: true });

    const after = await mg.store.listKnowledge({ namespace: 'l2b', status: 'all' });
    const active = after.filter(
      (item) => item.status === 'active' && item.scope.domain === 'sales' && item.scope.intent === 'comparison',
    );
    expect(active.map((item) => (item.payload as { then: { mark: string } }).then.mark)).toEqual(['pie']);
    await mg.close();
  });
});

describe('the arm report', () => {
  const setup = laneSetup(cases);

  it('measures both protocols on the same holdout', async () => {
    const single = await runPairArm('single', setup);
    const pair = await runPairArm('pair', setup);

    expect(single.accuracy).toBe(0.875);
    expect(pair.accuracy).toBe(single.accuracy);
    expect(single.wallAccuracy).toBe(0);
    expect(single.reachableAccuracy).toBe(1);
    expect(single.rounds).toEqual([
      { round: 'base', cases: 6, corrections: 5, cited: 0 },
      { round: 'revision', cases: 2, corrections: 2, cited: 2 },
    ]);
    expect(pair.rounds[1]?.cited).toBe(2);
    expect(single.correctedWithCitation).toBe(2);
    expect(pair.correctedWithCitation).toBe(2);
    expect(single.runs).toBe(8);
    expect(pair.runs).toBe(15);
    expect(single.negative).toBe(0);
    expect(pair.negative).toBe(1);
    // The pair stores one more item — the negative lesson — and activates the same
    // number of constraints: the extra lesson never turns into a rule.
    expect(pair.knowledge).toBe(single.knowledge + 1);
    expect(pair.active).toBe(single.active);
    // No stale rule survives either protocol: the edit's own credit is enough.
    expect(single.stale).toBe(0);
    expect(pair.stale).toBe(0);
  });

  it('leaves the two stores in the same state', async () => {
    const single = await runPairArm('single', setup);
    const pair = await runPairArm('pair', setup);
    expect(diffRuleStates(single.rules, pair.rules)).toEqual([]);
    expect(single.rules.length).toBe(7);
    expect(single.rules.map((row) => row.rule)).toContain('sales/comparison=pie');
  });

  it('is deterministic', async () => {
    const first = await runPairArm('pair', setup);
    const second = await runPairArm('pair', setup);
    expect(second.holdout).toEqual(first.holdout);
    expect(second.rules).toEqual(first.rules);
    expect(second.knowledge).toBe(first.knowledge);
  });

  it('reads an empty store as the baseline, and the baseline is not zero', async () => {
    const mg = await lane();
    const correct = await predictAll(mg, holdout);
    expect(correct).toHaveLength(holdout.length);
    // One question's baseline answer already matches its convention; a lane that
    // reported an empty store as 0 would be measuring nothing.
    expect(correct.filter(Boolean)).toHaveLength(1);
    await mg.close();
  });
});

describe('counting helpers', () => {
  it('selects a share over a subset, and refuses to divide by nothing', () => {
    const correct = [true, false, true];
    expect(shareOf(holdout.slice(0, 3), correct, () => true)).toBeCloseTo(2 / 3, 10);
    expect(shareOf(holdout.slice(0, 3), correct, (item) => item.id === holdout[1]?.id)).toBe(0);
    expect(shareOf(holdout.slice(0, 3), correct, () => false)).toBe(0);
  });

  it('takes the baseline from the defective recommender', () => {
    expect(shareOf(holdout, baselineCorrect(holdout), () => true)).toBe(0.125);
  });

  it('counts a corrected attempt once, however many rules it cited', () => {
    expect(citedCorrections([])).toBe(0);
    expect(
      citedCorrections([
        { runs: 1, corrections: 1, cited: 0 },
        { runs: 1, corrections: 1, cited: 3 },
        { runs: 2, corrections: 0, cited: 0 },
      ]),
    ).toBe(1);
  });
});

describe('the store readouts', () => {
  const due = new Map([['sales\u0000comparison', 'pie' as const]]);

  it('counts an active rule whose answer the domain has revised', () => {
    expect(
      staleActive(
        [
          { status: 'active', kind: 'constraint', scope: { domain: 'sales', intent: 'comparison' }, payload: { when: { intent: 'comparison' }, then: { mark: 'line' } } },
          { status: 'active', kind: 'constraint', scope: { domain: 'sales', intent: 'comparison' }, payload: { when: { intent: 'comparison' }, then: { mark: 'pie' } } },
        ],
        due,
      ),
    ).toBe(1);
  });

  it('ignores what cannot be a stale rule', () => {
    expect(
      staleActive(
        [
          // Not active: a demoted rule steers nothing.
          { status: 'candidate', kind: 'constraint', scope: { domain: 'sales', intent: 'comparison' }, payload: { when: {}, then: { mark: 'line' } } },
          // Active but scope-free: no domain to have revised.
          { status: 'active', kind: 'constraint', scope: {}, payload: { when: {}, then: { mark: 'line' } } },
          // A negative lesson: `{ code }`, not a chart.
          { status: 'active', kind: 'negative', scope: { domain: 'sales', intent: 'comparison' }, payload: { code: 'wrong-mark' } },
          // A constraint with no `then`: nothing to compare.
          { status: 'active', kind: 'constraint', scope: { domain: 'sales', intent: 'comparison' }, payload: { when: {} } },
          // A scope nobody has an expectation for.
          { status: 'active', kind: 'constraint', scope: { domain: 'ops', intent: 'comparison' }, payload: { when: {}, then: { mark: 'bar' } } },
        ],
        due,
      ),
    ).toBe(0);
  });

  it('leaves out what is not a chart rule, and names a scope-free rule with a star', () => {
    const rows = ruleStates([
      // Malformed constraint: no chart in the payload.
      { status: 'active', kind: 'constraint', scope: { domain: 'sales', intent: 'comparison' }, payload: { when: {} } },
      // Scope-free constraint: still a rule, and its key says so.
      { status: 'active', kind: 'constraint', scope: {}, payload: { when: {}, then: { mark: 'line' } } },
      // A key that sorts after the star, so the ordering is exercised both ways.
      { status: 'active', kind: 'constraint', scope: { domain: 'zz', intent: 'trend' }, payload: { when: {}, then: { mark: 'line' } } },
      // The same claim twice: two items can hold one scope and answer with
      // different statuses, so the comparator must order equal claims too.
      { status: 'retired', kind: 'constraint', scope: { domain: 'zz', intent: 'trend' }, payload: { when: {}, then: { mark: 'line' } } },
      { status: 'retired', kind: 'constraint', scope: { domain: 'zz', intent: 'trend' }, payload: { when: {}, then: { mark: 'line' } } },
    ]);
    expect(rows.map((row) => `${row.rule}:${row.status}`)).toEqual([
      '*/*=line:active',
      'zz/trend=line:active',
      'zz/trend=line:retired',
      'zz/trend=line:retired',
    ]);
  });

  it('diffs rule states by scope and answer, with absence as a value', () => {
    const single = ruleStates([
      { status: 'active', kind: 'constraint', scope: { domain: 'sales', intent: 'comparison' }, payload: { when: {}, then: { mark: 'pie' } } },
      { status: 'candidate', kind: 'constraint', scope: { domain: 'hr', intent: 'trend' }, payload: { when: {}, then: { mark: 'line' } } },
      { status: 'active', kind: 'negative', scope: {}, payload: { code: 'x' } },
    ]);
    expect(single.map((row) => row.rule)).toEqual(['hr/trend=line', 'sales/comparison=pie']);
    expect(diffRuleStates(single, single)).toEqual([]);
    const pair = ruleStates([
      { status: 'retired', kind: 'constraint', scope: { domain: 'sales', intent: 'comparison' }, payload: { when: {}, then: { mark: 'pie' } } },
      { status: 'active', kind: 'constraint', scope: { domain: 'ops', intent: 'comparison' }, payload: { when: {}, then: { mark: 'bar' } } },
    ]);
    expect(diffRuleStates(single, pair)).toEqual([
      { rule: 'hr/trend=line', single: 'candidate', pair: 'absent' },
      { rule: 'ops/comparison=bar', single: 'absent', pair: 'active' },
      { rule: 'sales/comparison=pie', single: 'active', pair: 'retired' },
    ]);
  });
});

function fakeArm(arm: 'single' | 'pair', overrides: Partial<ArmReport> = {}): ArmReport {
  return {
    arm,
    holdout: [false],
    accuracy: 0.5,
    reachableAccuracy: 0.5,
    wallAccuracy: 0,
    runs: 1,
    corrections: 1,
    correctedWithCitation: 1,
    stale: 0,
    knowledge: 1,
    active: 1,
    negative: arm === 'pair' ? 1 : 0,
    rounds: [
      { round: 'base', cases: 1, corrections: 1, cited: 0 },
      { round: 'revision', cases: 1, corrections: 1, cited: 1 },
    ],
    rules: [],
    ...overrides,
  };
}

describe('the gates', () => {
  const gates = (arms: readonly ArmReport[], reachable = 0.5, baseline = 0.125, revision = 1) =>
    buildL2bGates({ arms, reachable, baseline, revision });

  it('passes when the instrument measures what it claims', () => {
    const result = gates([fakeArm('single'), fakeArm('pair', { runs: 2 })]);
    expect(result.every((gate) => gate.pass)).toBe(true);
    expect(result.every((gate) => gate.blocking)).toBe(true);
    expect(result.map((gate) => gate.id)).toEqual([
      'l2b-corpus-has-headroom',
      'l2b-wall-is-real',
      'l2b-split-is-split',
      'l2b-failure-recorded',
      'l2b-revision-has-a-culprit',
      'l2b-lever-exercised',
    ]);
  });

  it('fails the headroom gate when an arm reaches the oracle', () => {
    expect(
      gates([fakeArm('single'), fakeArm('pair', { accuracy: 1 })]).find(
        (gate) => gate.id === 'l2b-corpus-has-headroom',
      )?.pass,
    ).toBe(false);
    expect(gates([fakeArm('single'), fakeArm('pair')], 0.5, 1).find((gate) => gate.id === 'l2b-corpus-has-headroom')?.pass).toBe(false);
  });

  it('fails the wall gate when a convention nobody taught is recovered', () => {
    expect(
      gates([fakeArm('single', { wallAccuracy: 1 }), fakeArm('pair')]).find(
        (gate) => gate.id === 'l2b-wall-is-real',
      )?.pass,
    ).toBe(false);
  });

  it('fails the split gate when there is no wall, or no reachable mass', () => {
    expect(gates([fakeArm('single'), fakeArm('pair')], 1).find((gate) => gate.id === 'l2b-split-is-split')?.pass).toBe(false);
    expect(gates([fakeArm('single'), fakeArm('pair')], 0).find((gate) => gate.id === 'l2b-split-is-split')?.pass).toBe(false);
  });

  it('fails the failure gate when the pair arm records nothing', () => {
    expect(
      gates([fakeArm('single'), fakeArm('pair', { negative: 0 })]).find(
        (gate) => gate.id === 'l2b-failure-recorded',
      )?.pass,
    ).toBe(false);
    expect(
      gates([fakeArm('single'), fakeArm('pair', { runs: 1 })]).find(
        (gate) => gate.id === 'l2b-failure-recorded',
      )?.pass,
    ).toBe(false);
  });

  it('fails the culprit gate when a revision was answered right, or never asked', () => {
    const missed = fakeArm('pair', {
      runs: 2,
      rounds: [{ round: 'revision', cases: 1, corrections: 0, cited: 0 }],
    });
    expect(gates([fakeArm('single'), missed]).find((gate) => gate.id === 'l2b-revision-has-a-culprit')?.pass).toBe(false);
    expect(
      gates([fakeArm('single'), fakeArm('pair', { runs: 2 })], 0.5, 0.125, 0).find(
        (gate) => gate.id === 'l2b-revision-has-a-culprit',
      )?.pass,
    ).toBe(false);
  });

  it('fails the lever gate when no correction cited a rule', () => {
    expect(
      gates([
        fakeArm('single', { correctedWithCitation: 0 }),
        fakeArm('pair', { runs: 2, correctedWithCitation: 0 }),
      ]).find((gate) => gate.id === 'l2b-lever-exercised')?.pass,
    ).toBe(false);
    const exercised = gates([
      fakeArm('single', { correctedWithCitation: 1 }),
      fakeArm('pair', { runs: 2, correctedWithCitation: 1 }),
    ]);
    expect(exercised.find((gate) => gate.id === 'l2b-lever-exercised')?.pass).toBe(true);
  });

  it('refuses a report that is missing an arm', () => {
    expect(() => gates([fakeArm('single')])).toThrow(/missing the pair arm/);
    expect(() => gates([fakeArm('pair')])).toThrow(/missing the single arm/);
  });
});

describe('the lane as a whole', () => {
  it('reports the verdict, its reachable share, and the wall it could not reach', async () => {
    const report = await runL2b();
    expect(report.cases).toEqual({ teach: 6, revision: 2, holdout: 8, unreachable: 1 });
    expect(report.reachable).toBe(0.75);
    expect(report.baseline).toBe(0.125);
    expect(report.oracle).toBe(1);

    // The recorded failure changes no answer on this corpus, and leaves no rule
    // differently: the edit's own credit already blames what the run cited.
    expect(report.verdict.delta).toBe(0);
    expect(report.verdict.pairHelps).toBe(false);
    expect(report.verdict.singleRecovery).toBeCloseTo((0.875 - 0.125) / (1 - 0.125), 10);
    expect(report.storeDiff).toEqual([]);
    expect(report.wall).toEqual([
      { id: 'cvho_ops_comparison', gold: 'scatter', single: false, pair: false },
    ]);
    expect(report.gates.every((gate) => gate.pass)).toBe(true);
  });

  it('scores a store that followed the revision as right', async () => {
    const report = await runL2b();
    const single = report.arms.find((arm) => arm.arm === 'single');
    const pair = report.arms.find((arm) => arm.arm === 'pair');
    expect(single?.holdout).toHaveLength(8);
    // Only the wall is wrong: both revised questions are answered with the
    // convention now in force.
    expect(single?.holdout.filter(Boolean)).toHaveLength(7);
    expect(pair?.holdout.filter(Boolean)).toHaveLength(7);
  });
});
