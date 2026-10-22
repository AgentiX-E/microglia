import { describe, expect, it } from 'vitest';
import { EmbeddedMemory, MemoryJournal } from '@agentix-e/microglia-core/memory';
import { openMicroglia, type Microglia } from '@agentix-e/microglia-core/capture';
import { ruleInterpreter } from '@agentix-e/microglia-core/distill';
import { mulberry32, steppingClock } from '@agentix-e/microglia-core';
import { chartEditDistance, chartInterpreter } from '../workload/index.js';
import { buildConventions, holdoutCases, trainingSplit, unreachableCases } from '../conventions.js';
import {
  baselineCorrect,
  buildL2bGates,
  citedCorrections,
  correctionFor,
  featuresFor,
  runL2b,
  runPairArm,
  shareOf,
  teachCase,
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
const holdout = holdoutCases(cases);
const wrong = teaching.find((entry) => entry.baseline.mark !== entry.goldMark && entry.intent === 'comparison');
const alreadyRight = teaching.find((entry) => entry.baseline.mark === entry.goldMark);
if (wrong === undefined || alreadyRight === undefined) {
  throw new Error('the corpus no longer contains both a defective and a correct teaching case');
}

describe('the convention corpus as a lane input', () => {
  it('states every key twice, and the twins differ in the columns they name', () => {
    expect(cases).toHaveLength(16);
    expect(trainingSplit(cases)).toHaveLength(6);
    expect(holdoutCases(cases)).toHaveLength(8);
    expect(teaching.some((entry) => entry.domain === 'ops')).toBe(false);
    for (const entry of holdoutCases(cases)) {
      const twin = cases.find((candidate) => candidate.split === 'teach' && candidate.domain === entry.domain && candidate.intent === entry.intent);
      expect(twin).toBeDefined();
      expect(twin?.query.field).not.toBe(entry.query.field);
      expect(twin?.query.id).not.toBe(entry.query.id);
    }
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
      // A correction that also moved x/y would be classified as a different edit
      // and teach nothing, which is the quietest way a lane measures zero.
      expect(correctionFor(entry, entry.baseline)).toEqual(entry.gold);
    }
  });

  it('keeps exactly the untaught convention on the far side of the wall', () => {
    expect(unreachableCases(cases).map((entry) => entry.id)).toEqual(['cvho_ops_comparison']);
  });

  it('records the features the interpreter scopes a lesson by', () => {
    const features = featuresFor(wrong);
    expect(features['domain']).toBe(wrong.domain);
    expect(features['intent']).toBe(wrong.intent);
    expect(features['field']).toBe(wrong.query.field);
    expect(features['categoryCount']).toBe(4);
    expect(features['grain']).toBe('month');
    expect(features['question']).toBe(wrong.query.text);
  });
});

describe('the two teaching protocols', () => {
  it('single: one attempt, one correction, nothing else', async () => {
    const mg = await lane();
    const outcome = await teachCase(mg, wrong, 'single');
    expect(outcome).toEqual({ runs: 1, corrections: 1, cited: 0 });
    const events = await mg.store.listEvents();
    expect(events.map((event) => event.signal.type).sort()).toEqual(['edit', 'outcome']);
    // The empty pack is the whole reason L2b needs a second round of teaching.
    expect(outcome.cited).toBe(0);
    await mg.close();
  });

  it('pair: two attempts linked by parentRunId, with the failure recorded', async () => {
    const mg = await lane();
    const outcome = await teachCase(mg, wrong, 'pair');
    expect(outcome).toEqual({ runs: 2, corrections: 1, cited: 0 });

    const events = await mg.store.listEvents();
    const failure = events.find((event) => event.signal.type === 'outcome' && event.signal.ok === false);
    expect(failure).toBeDefined();
    if (failure === undefined || failure.signal.type !== 'outcome') throw new Error('missing failure');
    expect(failure.signal.code).toBe('wrong-mark');

    const edit = events.find((event) => event.signal.type === 'edit');
    expect(edit).toBeDefined();
    if (edit === undefined) throw new Error('missing edit');
    expect(edit.runId).not.toBe(failure.runId);

    const first = await mg.store.getRun(failure.runId);
    const second = await mg.store.getRun(edit.runId);
    expect(first?.attempt).toBe(1);
    expect(second?.attempt).toBe(2);
    expect(second?.parentRunId).toBe(first?.id);
    expect(second?.taskId).toBe(first?.taskId);
    // The two attempts read the same pack: nothing is distilled between them.
    expect(second?.provenance.knowledgeIds).toEqual(first?.provenance.knowledgeIds);
    await mg.close();
  });

  it('neither protocol invents a failure where the loop was right', async () => {
    for (const arm of ['single', 'pair'] as const) {
      const mg = await lane();
      const outcome = await teachCase(mg, alreadyRight, arm);
      expect(outcome).toEqual({ runs: 1, corrections: 0, cited: 0 });
      const events = await mg.store.listEvents();
      expect(events.map((event) => event.signal.type)).toEqual(['outcome']);
      await mg.close();
    }
  });

  it('a correction that cites a rule counts as an exercised lever', async () => {
    // Warm the store first, so the second question in the same scope is answered
    // from a rule rather than from the empty pack.
    const mg = await lane();
    await teachCase(mg, wrong, 'single');
    await mg.distill({ generalize: true });
    const twin = holdout.find((entry) => entry.domain === wrong.domain && entry.intent === wrong.intent);
    if (twin === undefined) throw new Error('the corpus lost the twin of a teaching case');
    const pack = await mg.recall({ task: 'chart.recommend', text: twin.query.text, scope: { domain: twin.domain, intent: twin.intent } });
    expect(pack.ids.length).toBeGreaterThan(0);
    await mg.close();
  });
});

describe('the arm report', () => {
  it('measures both protocols on the same holdout', async () => {
    const wallIds = new Set(unreachableCases(cases).map((entry) => entry.id));
    const single = await runPairArm('single', teaching, holdout, wallIds);
    const pair = await runPairArm('pair', teaching, holdout, wallIds);

    expect(single.holdout).toHaveLength(holdout.length);
    expect(single.accuracy).toBe(0.875);
    expect(pair.accuracy).toBe(single.accuracy);
    expect(single.wallAccuracy).toBe(0);
    expect(pair.wallAccuracy).toBe(0);
    expect(single.reachableAccuracy).toBe(1);
    expect(single.runs).toBe(6);
    expect(pair.runs).toBe(11);
    expect(single.negative).toBe(0);
    expect(pair.negative).toBe(1);
    // The pair stores one more item — the negative lesson — and activates the same
    // number of constraints: the extra lesson never turns into a rule.
    expect(pair.knowledge).toBe(single.knowledge + 1);
    expect(pair.active).toBe(single.active);
  });

  it('keeps the two arms independent', async () => {
    const wallIds = new Set(unreachableCases(cases).map((entry) => entry.id));
    const first = await runPairArm('pair', teaching, holdout, wallIds);
    const second = await runPairArm('pair', teaching, holdout, wallIds);
    expect(second.holdout).toEqual(first.holdout);
    expect(second.knowledge).toBe(first.knowledge);
  });
});

describe('counting helpers', () => {
  it('selects a share over a subset, and refuses to divide by nothing', () => {
    const correct = [true, false, true];
    expect(shareOf(holdout.slice(0, 3), correct, () => true)).toBeCloseTo(2 / 3, 10);
    expect(shareOf(holdout.slice(0, 3), correct, (item) => item.id === holdout[1]?.id)).toBe(0);
    expect(shareOf(holdout.slice(0, 3), correct, () => false)).toBe(0);
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

  it('takes the baseline from the defective recommender', () => {
    const correct = baselineCorrect(holdout);
    expect(correct).toHaveLength(holdout.length);
    expect(shareOf(holdout, correct, () => true)).toBe(0.125);
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
    correctedWithCitation: 0,
    knowledge: 1,
    active: 1,
    negative: arm === 'pair' ? 1 : 0,
    ...overrides,
  };
}

describe('the gates', () => {
  const gates = (arms: readonly ArmReport[], reachable = 0.5, baseline = 0.125) =>
    buildL2bGates({ arms, reachable, baseline });

  it('passes when the instrument measures what it claims', () => {
    const result = gates([fakeArm('single', { runs: 1 }), fakeArm('pair', { runs: 2 })]);
    expect(result.filter((gate) => gate.blocking).every((gate) => gate.pass)).toBe(true);
    expect(result.map((gate) => gate.id)).toEqual([
      'l2b-corpus-has-headroom',
      'l2b-wall-is-real',
      'l2b-split-is-split',
      'l2b-failure-recorded',
      'l2b-lever-exercised',
    ]);
  });

  it('fails the headroom gate when an arm reaches the oracle', () => {
    const result = gates([fakeArm('single'), fakeArm('pair', { accuracy: 1 })]);
    expect(result.find((gate) => gate.id === 'l2b-corpus-has-headroom')?.pass).toBe(false);
  });

  it('fails the headroom gate when the baseline already solves the corpus', () => {
    const result = gates([fakeArm('single'), fakeArm('pair')], 0.5, 1);
    expect(result.find((gate) => gate.id === 'l2b-corpus-has-headroom')?.pass).toBe(false);
  });

  it('fails the wall gate when a convention nobody taught is recovered', () => {
    const result = gates([fakeArm('single', { wallAccuracy: 1 }), fakeArm('pair')]);
    expect(result.find((gate) => gate.id === 'l2b-wall-is-real')?.pass).toBe(false);
  });

  it('fails the split gate when there is no wall, or no reachable mass', () => {
    expect(gates([fakeArm('single'), fakeArm('pair')], 1).find((gate) => gate.id === 'l2b-split-is-split')?.pass).toBe(false);
    expect(gates([fakeArm('single'), fakeArm('pair')], 0).find((gate) => gate.id === 'l2b-split-is-split')?.pass).toBe(false);
  });

  it('fails the failure gate when the pair arm records nothing', () => {
    const result = gates([fakeArm('single'), fakeArm('pair', { negative: 0 })]);
    expect(result.find((gate) => gate.id === 'l2b-failure-recorded')?.pass).toBe(false);
    const sameRuns = gates([fakeArm('single'), fakeArm('pair', { runs: 1 })]);
    expect(sameRuns.find((gate) => gate.id === 'l2b-failure-recorded')?.pass).toBe(false);
  });

  it('reports an unexercised lever without blocking the lane', () => {
    const result = gates([fakeArm('single'), fakeArm('pair', { runs: 2 })]);
    const lever = result.find((gate) => gate.id === 'l2b-lever-exercised');
    expect(lever?.pass).toBe(false);
    expect(lever?.blocking).toBe(false);
    const exercised = gates([
      fakeArm('single', { correctedWithCitation: 1 }),
      fakeArm('pair', { runs: 2 }),
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
    expect(report.cases).toEqual({ teach: 6, holdout: 8, unreachable: 1 });
    expect(report.reachable).toBe(0.75);
    expect(report.baseline).toBe(0.125);
    expect(report.oracle).toBe(1);
    expect(report.arms).toHaveLength(2);

    // The recorded failure changes no answer on this corpus: the negative lesson
    // is the only channel it adds, and the deterministic reader has no use for one.
    expect(report.verdict.delta).toBe(0);
    expect(report.verdict.pairHelps).toBe(false);
    expect(report.verdict.singleRecovery).toBeCloseTo((0.875 - 0.125) / (1 - 0.125), 10);
    expect(report.wall.map((entry) => entry.id)).toEqual(['cvho_ops_comparison']);
    expect(report.wall[0]?.gold).toBe('scatter');
    expect(report.wall[0]?.single).toBe(false);
    expect(report.wall[0]?.pair).toBe(false);
    expect(report.gates.filter((gate) => gate.blocking).every((gate) => gate.pass)).toBe(true);
  });

  it('marks the comparison vacuous when no correction cited a rule', async () => {
    const report = await runL2b();
    const single = report.arms.find((arm) => arm.arm === 'single');
    const pair = report.arms.find((arm) => arm.arm === 'pair');
    expect(single?.correctedWithCitation).toBe(0);
    expect(pair?.correctedWithCitation).toBe(0);
    expect(report.gates.find((gate) => gate.id === 'l2b-lever-exercised')?.pass).toBe(false);
  });
});
