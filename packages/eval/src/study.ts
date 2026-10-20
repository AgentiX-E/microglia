/**
 * The ablation study.
 *
 * Every arm shares one corpus and one feedback schedule, so a difference between
 * two arms is attributable to the one knob that differs:
 *
 *   baseline            no memory, no learning (the counterfactual)
 *   full                capture -> distill -> recall -> apply
 *   noise               20% of corrections point at a wrong chart
 *   poison              untrusted corrections injected alongside trusted ones
 *   unguarded           identical poison with the trust ceiling removed
 *   no-generalization   the loop with scope widening disabled
 *   no-credit           feedback does not update the rules that were cited
 *   no-contradiction    contradictory claims coexist instead of demoting
 *   narrow-budget       the pack may carry one rule instead of eight
 *
 * A separate measurement probes namespace leakage. Every number in the report
 * comes from these functions; none is typed in by hand.
 */
import { emptyPack } from '@agentix-e/microglia-apply';
import {
  Microglia as MicrogliaClass,
  openMicroglia,
  type Diagnosis,
  type Microglia,
} from '@agentix-e/microglia-capture';
import {
  steppingClock,
  mulberry32,
  type Json,
  type KnowledgeItem,
} from '@agentix-e/microglia-core';
import { ruleInterpreter, type Interpreter } from '@agentix-e/microglia-distill';
import { EmbeddedMemory, MemoryJournal } from '@agentix-e/microglia-memory';
import {
  CHART_MARKS,
  chartEditDistance,
  chartInterpreter,
  constraintMatches,
  type ChartConstraint,
  type ChartIntent,
  type ChartMark,
} from '@agentix-e/microglia-nl2charts';
import {
  DOMAINS,
  INTENTS,
  applyKnowledge,
  buildCorpus,
  goldMark,
  type CorpusItem,
} from './scenario.js';
import { comparePaired, type PairedResult } from './stats.js';
import { pp, pct, pValue } from './format.js';
import {
  contradictionAblation,
  creditAblation,
  diversityAblation,
  type ContradictionAblation,
  type CreditAblation,
  type DiversityAblation,
} from './ablations.js';

export type Ablations = {
  readonly credit: CreditAblation;
  readonly contradiction: ContradictionAblation;
  readonly diversity: DiversityAblation;
};

export const TASK = 'chart.recommend';
const CLOCK_START = 1_700_000_000_000;
const NAMESPACE = 'acme';

export type ArmName =
  | 'baseline'
  | 'full'
  | 'noise'
  | 'poison'
  | 'unguarded'
  | 'no-generalization'
  | 'no-credit'
  | 'no-contradiction'
  | 'narrow-budget';

export type ArmConfig = {
  readonly name: ArmName;
  readonly useMemory: boolean;
  readonly noiseRate: number;
  readonly poisonEvery: number;
  readonly generalize: boolean;
  /** Trust ceiling applied to injected edits; 0 when the arm injects nothing. */
  readonly poisonTrust: number;
  /** Whether feedback updates the knowledge the run cited. */
  readonly credit: boolean;
  /** Contradictions tolerated before a rule is demoted. */
  readonly maxContradictions: number;
  /** Pack budget in characters, or `null` to use the study budget. */
  readonly packBudget: number | null;
};

function arm(name: ArmName, overrides: Partial<Omit<ArmConfig, 'name'>> = {}): ArmConfig {
  return {
    name,
    useMemory: true,
    noiseRate: 0,
    poisonEvery: 0,
    generalize: true,
    poisonTrust: 0,
    credit: true,
    maxContradictions: 1,
    packBudget: null,
    ...overrides,
  };
}

export const ARMS: readonly ArmConfig[] = [
  arm('baseline', { useMemory: false }),
  arm('full'),
  arm('noise', { noiseRate: 0.2 }),
  // One poisoned claim for every second correction: dense enough to matter, and
  // identical in both defence arms so the comparison isolates the guard.
  arm('poison', { poisonEvery: 2, poisonTrust: 0.2 }),
  // The defence ablation: identical poison, with the trust ceiling removed.
  arm('unguarded', { poisonEvery: 2, poisonTrust: 0.95 }),
  arm('no-generalization', { generalize: false }),
  arm('no-credit', { credit: false }),
  // A store that tolerates disagreement: the newest claim does not demote the
  // claim it contradicts, so both can reach a prompt.
  arm('no-contradiction', { maxContradictions: Number.MAX_SAFE_INTEGER }),
  // A budget that fits one rule instead of six: the pack layer's contribution,
  // measured at the point where it actually binds (400 characters).
  arm('narrow-budget', { packBudget: 400 }),
];

export type StudyConfig = {
  readonly seed: number;
  readonly trainSize: number;
  readonly holdoutSize: number;
  readonly rounds: number;
  readonly batchSize: number;
  readonly budget: number;
  /**
   * A domain that receives **no feedback at all** and is still evaluated.
   *
   * This is the only clean test of the generalisation claim: everything else can
   * be memorised per domain. A domain-scoped arm cannot cover it; a store that
   * widened a rule can.
   */
  readonly heldOutDomain: string;
};

export const DEFAULT_CONFIG: StudyConfig = {
  seed: 20261020,
  trainSize: 560,
  holdoutSize: 280,
  rounds: 6,
  batchSize: 12,
  budget: 1200,
  heldOutDomain: 'ops',
};

export type RoundMetrics = {
  readonly round: number;
  readonly accuracy: number;
  readonly correct: readonly boolean[];
  readonly active: number;
  readonly candidates: number;
  readonly quarantined: number;
  readonly conflicted: number;
  readonly retired: number;
  readonly meanTokens: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
};

export type DomainScore = {
  readonly domain: string;
  readonly correct: number;
  readonly total: number;
  readonly accuracy: number;
};

export type ArmResult = {
  readonly name: ArmName;
  readonly config: ArmConfig;
  readonly rounds: readonly RoundMetrics[];
  readonly holdout: readonly boolean[];
  readonly byDomain: readonly DomainScore[];
  readonly finalAccuracy: number;
  readonly precision: { readonly value: number; readonly evaluated: number };
  readonly untrustedActive: number;
  readonly active: number;
  readonly quarantined: number;
  readonly conflicted: number;
  readonly knowledge: number;
};

export type Gate = {
  readonly id: string;
  readonly criterion: string;
  readonly actual: string;
  readonly pass: boolean;
  readonly blocking: boolean;
};

export type StudyResult = {
  readonly config: StudyConfig;
  readonly corpus: { readonly train: number; readonly holdout: number };
  readonly arms: readonly ArmResult[];
  readonly ablations: Ablations;
  readonly comparisons: Readonly<Record<string, PairedResult>>;
  readonly leakage: number;
  readonly diagnosis: Diagnosis | undefined;
  readonly gates: readonly Gate[];
};

const combined: Interpreter = async (context) => [
  ...chartInterpreter(context),
  ...(await ruleInterpreter(context)),
];

export function buildBatches(
  train: readonly CorpusItem[],
  rounds: number,
  batchSize: number,
  heldOutDomain?: string,
): readonly (readonly CorpusItem[])[] {
  // Only defective cases are worth a user's time. A correction on a correct
  // answer is not a correction, and feeding the loop with them would inflate
  // the feedback count without teaching anything.
  const wrong = train.filter(
    (item) =>
      item.baseline.mark !== item.gold.mark &&
      (heldOutDomain === undefined || item.query.domain !== heldOutDomain),
  );
  const batches: CorpusItem[][] = [];
  let cursor = 0;
  for (let round = 0; round < rounds; round += 1) {
    const batch: CorpusItem[] = [];
    for (let i = 0; i < batchSize; i += 1) {
      const item = wrong[cursor % wrong.length];
      cursor += 1;
      if (item) batch.push(item);
    }
    batches.push(batch);
  }
  return batches;
}

export async function evaluateHoldout(
  mg: Microglia,
  holdout: readonly CorpusItem[],
  useMemory: boolean,
  budget: number,
): Promise<{ correct: boolean[]; meanTokens: number; p50Ms: number; p95Ms: number }> {
  const correct: boolean[] = [];
  const latencies: number[] = [];
  let tokens = 0;
  for (const item of holdout) {
    const started = performance.now();
    const pack = useMemory
      ? await mg.recall({
          task: TASK,
          text: item.query.text,
          scope: { domain: item.query.domain, intent: item.query.intent },
        })
      : emptyPack(budget);
    latencies.push(performance.now() - started);
    tokens += pack.tokens;
    const prediction = useMemory ? applyKnowledge(pack, item) : item.baseline;
    correct.push(prediction.mark === item.gold.mark);
  }
  return {
    correct,
    meanTokens: holdout.length === 0 ? 0 : tokens / holdout.length,
    p50Ms: percentile(latencies, 0.5),
    p95Ms: percentile(latencies, 0.95),
  };
}

function percentile(values: readonly number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor(q * sorted.length));
  return Math.round((sorted[index] as number) * 1000) / 1000;
}

export async function runArm(
  arm: ArmConfig,
  corpus: { readonly train: readonly CorpusItem[]; readonly holdout: readonly CorpusItem[] },
  batches: readonly (readonly CorpusItem[])[],
  config: StudyConfig,
  seedOffset = 0,
): Promise<ArmResult> {
  const packBudget = arm.packBudget ?? config.budget;
  const store = await EmbeddedMemory.open(new MemoryJournal());
  const mg = await openMicroglia({
    app: 'microglia-bench',
    namespace: NAMESPACE,
    store,
    interpreter: combined,
    editSemantics: chartEditDistance,
    budget: packBudget,
    credit: arm.credit,
    policy: { maxContradictions: arm.maxContradictions },
    clock: steppingClock(CLOCK_START, 1),
    random: mulberry32(config.seed + seedOffset),
  });

  const initial = await evaluateHoldout(mg, corpus.holdout, arm.useMemory, packBudget);
  // `latest` is carried explicitly so the final metrics never need an
  // optional-chain into an array that is guaranteed non-empty.
  let latest = await snapshot(
    mg,
    0,
    initial.correct,
    initial.meanTokens,
    initial.p50Ms,
    initial.p95Ms,
  );
  const rounds: RoundMetrics[] = [latest];

  for (const [round, batch] of batches.entries()) {
    const rng = mulberry32(config.seed + round * 31 + seedOffset);

    for (const [index, item] of batch.entries()) {
      const pack = arm.useMemory
        ? await mg.recall({
          task: TASK,
          text: item.query.text,
          scope: { domain: item.query.domain, intent: item.query.intent },
        })
        : emptyPack(config.budget);
      const prediction = arm.useMemory ? applyKnowledge(pack, item) : item.baseline;
      const isWrong = prediction.mark !== item.gold.mark;
      if (!arm.useMemory) continue;

      const run = mg.begin({
        task: TASK,
        input: featuresJson(item),
        pack,
        promptVersion: 'bench-v1',
        domainPack: 'nl2charts',
        schemaDigest: item.query.domain,
      });
      await run.complete(prediction as unknown as Json);

      if (isWrong) {
        const target = correctionTarget(prediction.mark, item.gold.mark, arm.noiseRate, rng);
        await run.edit({ ...prediction, mark: target } as unknown as Json, { note: 'user correction' });
      }

      if (arm.poisonEvery > 0 && index % arm.poisonEvery === 0) {
        await injectPoison(mg, item, config.budget, arm.poisonTrust);
      }
    }

    if (arm.useMemory) await mg.distill({ generalize: arm.generalize });
    const evaluated = await evaluateHoldout(mg, corpus.holdout, arm.useMemory, packBudget);
    latest = await snapshot(
      mg,
      round + 1,
      evaluated.correct,
      evaluated.meanTokens,
      evaluated.p50Ms,
      evaluated.p95Ms,
    );
    rounds.push(latest);
  }

  const items = await store.listKnowledge({ namespace: NAMESPACE, status: 'all' });
  const result: ArmResult = {
    name: arm.name,
    config: arm,
    rounds,
    holdout: latest.correct,
    finalAccuracy: latest.accuracy,
    byDomain: scoreByDomain(corpus.holdout, latest.correct),
    precision: knowledgePrecision(items),
    untrustedActive: items.filter((item) => item.status === 'active' && item.trust < 0.35).length,
    active: items.filter((item) => item.status === 'active').length,
    quarantined: items.filter((item) => item.status === 'quarantined').length,
    conflicted: items.filter((item) => item.status === 'conflicted').length,
    knowledge: items.length,
  };
  await mg.close();
  return result;
}

async function snapshot(
  mg: Microglia,
  round: number,
  correct: readonly boolean[],
  meanTokens: number,
  p50Ms: number,
  p95Ms: number,
): Promise<RoundMetrics> {
  const items = await mg.store.listKnowledge({ namespace: NAMESPACE, status: 'all' });
  const accuracy = correct.length === 0 ? 0 : correct.filter(Boolean).length / correct.length;
  return {
    round,
    accuracy,
    correct: [...correct],
    active: items.filter((item) => item.status === 'active').length,
    candidates: items.filter((item) => item.status === 'candidate').length,
    quarantined: items.filter((item) => item.status === 'quarantined').length,
    conflicted: items.filter((item) => item.status === 'conflicted').length,
    retired: items.filter((item) => item.status === 'retired').length,
    meanTokens,
    p50Ms,
    p95Ms,
  };
}

function correctionTarget(
  predicted: ChartMark,
  gold: ChartMark,
  noiseRate: number,
  rng: () => number,
): ChartMark {
  if (noiseRate > 0 && rng() < noiseRate) {
    const wrongOptions = CHART_MARKS.filter(
      (mark) => mark !== predicted && mark !== gold,
    );
    const picked = wrongOptions[Math.floor(rng() * wrongOptions.length)];
    if (picked) return picked;
  }
  return gold;
}

async function injectPoison(
  mg: Microglia,
  item: CorpusItem,
  budget: number,
  trust: number,
): Promise<void> {
  const pack = emptyPack(budget);
  const run = mg.begin({
    task: TASK,
    input: { ...featuresJson(item), source: 'external', poison: true },
    pack,
  });
  await run.complete(item.baseline as unknown as Json);
  const target = poisonMark(item.query.intent);
  await run.edit(
    { ...item.baseline, mark: target } as unknown as Json,
    { trustCeiling: trust, actor: { type: 'user', idHash: 'external' } },
  );
}

/**
 * The chart type a poisoned correction asserts, per intent.
 *
 * Two constraints, both structural: it must differ from the model's own output
 * (or the edit would be empty) and from the gold (or the poison would be right).
 * Stating the table makes both invariants checkable at a glance; deriving the
 * mark by search would leave a fallback branch that can never be taken.
 */
export function poisonMark(intent: ChartIntent): ChartMark {
  switch (intent) {
    case 'trend':
    case 'distribution':
    case 'correlation':
    case 'matrix':
      return 'pie';
    case 'comparison':
    case 'composition':
    case 'ranking':
      return 'line';
  }
}

function featuresJson(item: CorpusItem): Record<string, Json> {
  return {
    question: item.query.text,
    domain: item.query.domain,
    intent: item.query.intent,
    field: item.query.field,
    categoryCount: item.query.categoryCount,
    grain: item.query.grain,
  };
}

/**
 * Precision of active constraints against the reference policy on a probe grid.
 *
 * A rule is "correct" when its mark equals the gold mark for every context it
 * claims. This is the metric that separates "learned a lot" from "learned the
 * right thing": a store full of noisy rules can raise coverage and lose this.
 */
export function scoreByDomain(
  holdout: readonly CorpusItem[],
  correct: readonly boolean[],
): readonly DomainScore[] {
  const buckets = new Map<string, { correct: number; total: number }>();
  for (const [i, item] of holdout.entries()) {
    const bucket = buckets.get(item.query.domain) ?? { correct: 0, total: 0 };
    bucket.total += 1;
    if (correct[i] === true) bucket.correct += 1;
    buckets.set(item.query.domain, bucket);
  }
  return [...buckets.entries()]
    .map(([domain, value]) => ({
      domain,
      correct: value.correct,
      total: value.total,
      // A bucket only exists because an item was counted into it.
      accuracy: value.correct / value.total,
    }))
    .sort((a, b) => (a.domain < b.domain ? -1 : 1));
}

export function knowledgePrecision(items: readonly KnowledgeItem[]): {
  value: number;
  evaluated: number;
} {
  let correct = 0;
  let evaluated = 0;
  for (const item of items) {
    if (item.status !== 'active') continue;
    const payload = item.payload as ChartConstraint | undefined;
    if (!payload || !payload.then || !payload.when) continue;
    const intents = payload.when.intent ? [payload.when.intent] : INTENTS;
    const domains = payload.when.domain
      ? [payload.when.domain]
      : DOMAINS.map((domain) => domain.name);
    for (const domain of domains) {
      for (const intent of intents) {
        for (const count of [4, 8]) {
          const features = { domain, intent, field: 'probe', categoryCount: count };
          if (!constraintMatches(payload, features)) continue;
          evaluated += 1;
          if (payload.then.mark === goldMark(intent, count)) correct += 1;
        }
      }
    }
  }
  return { value: evaluated === 0 ? 0 : correct / evaluated, evaluated };
}

export async function measureLeakage(store: EmbeddedMemory, holdout: readonly CorpusItem[]): Promise<number> {
  const foreign = new MicrogliaClass({
    app: 'microglia-probe',
    namespace: 'other',
    store,
    interpreter: combined,
    editSemantics: chartEditDistance,
    clock: steppingClock(CLOCK_START, 1),
    random: mulberry32(1),
  });
  let hits = 0;
  for (const item of holdout.slice(0, 50)) {
    const pack = await foreign.recall({ task: TASK, text: item.query.text });
    hits += pack.ids.length;
  }
  return hits;
}

export async function runStudy(config: StudyConfig = DEFAULT_CONFIG): Promise<StudyResult> {
  const train = buildCorpus(config.seed, config.trainSize, 'train');
  const holdout = buildCorpus(config.seed + 1, config.holdoutSize, 'holdout');
  const batches = buildBatches(train, config.rounds, config.batchSize, config.heldOutDomain);
  const corpus = { train, holdout };

  const arms: ArmResult[] = [];
  for (const [index, arm] of ARMS.entries()) {
    // The noise seed is a function of the arm's position in the schedule, so two
    // arms see the same *rate* of injected noise without sharing its sequence.
    arms.push(await runArm(arm, corpus, batches, config, index * 101));
  }

  const baseline = arms.find((arm) => arm.name === 'baseline');
  const full = arms.find((arm) => arm.name === 'full');
  const comparisons: Record<string, PairedResult> = {};
  if (baseline && full) {
    for (const arm of arms) {
      if (arm.name === 'baseline') continue;
      comparisons[arm.name] = comparePaired(baseline.holdout, arm.holdout, config.seed);
    }
  }

  // Leakage is measured on a store populated by the full arm's run, so the
  // probe sees a non-empty journal rather than trivially returning zero.
  const store = await EmbeddedMemory.open(new MemoryJournal());
  const probe = await openMicroglia({
    app: 'microglia-bench',
    namespace: NAMESPACE,
    store,
    interpreter: combined,
    clock: steppingClock(CLOCK_START, 1),
    random: mulberry32(config.seed),
  });
  for (const item of train.slice(0, 40)) {
    const run = probe.begin({ task: TASK, input: featuresJson(item) });
    await run.complete(item.baseline as unknown as Json);
    if (item.baseline.mark !== item.gold.mark) {
      await run.edit({ ...item.baseline, mark: item.gold.mark } as unknown as Json);
    }
  }
  await probe.distill();
  const leakage = await measureLeakage(store, holdout);
  const diagnosis = await probe.doctor();
  await probe.close();

  // The three modules that a clean corpus cannot exercise are measured on the
  // smallest workload where they do bind, and recorded beside the arms.
  const ablations: Ablations = {
    credit: await creditAblation(),
    contradiction: await contradictionAblation(),
    diversity: await diversityAblation(),
  };
  const gates = buildGates(arms, comparisons, leakage, config.heldOutDomain, ablations);
  return {
    config,
    corpus: { train: train.length, holdout: holdout.length },
    arms,
    ablations,
    comparisons,
    leakage,
    diagnosis,
    gates,
  };
}

export function buildGates(
  arms: readonly ArmResult[],
  comparisons: Readonly<Record<string, PairedResult>>,
  leakage: number,
  heldOutDomain: string,
  ablations?: Ablations,
): readonly Gate[] {
  const full = arms.find((arm) => arm.name === 'full');
  const poison = arms.find((arm) => arm.name === 'poison');
  const baseline = arms.find((arm) => arm.name === 'baseline');
  const fullCmp = comparisons['full'];
  const heldOut = (arm: ArmResult | undefined): number =>
    arm?.byDomain.find((entry) => entry.domain === heldOutDomain)?.accuracy ?? 0;
  const noiseCmp = comparisons['noise'];
  const poisonCmp = comparisons['poison'];
  const unguardedCmp = comparisons['unguarded'];

  const gate = (id: string, criterion: string, actual: string, pass: boolean, blocking = true): Gate => ({
    id,
    criterion,
    actual,
    pass,
    blocking,
  });

  return [
    gate(
      'G1',
      'full arm gains >= 20pp over baseline on the held-out set',
      pp(fullCmp?.delta ?? 0),
      (fullCmp?.delta ?? 0) >= 0.2,
    ),
    gate(
      'G2',
      'the gain is significant by exact McNemar at p < 0.001',
      fullCmp ? pValue(fullCmp.p) : 'n/a',
      (fullCmp?.p ?? 1) < 0.001,
    ),
    gate(
      'G3',
      '20% label noise still yields >= 15pp over baseline',
      pp(noiseCmp?.delta ?? 0),
      (noiseCmp?.delta ?? 0) >= 0.15,
    ),
    gate(
      'G4',
      'no untrusted knowledge becomes active',
      String(poison?.untrustedActive ?? -1),
      (poison?.untrustedActive ?? -1) === 0,
    ),
    gate(
      'G5',
      'poisoned traffic loses no more than 3pp against the clean arm',
      pp((poisonCmp?.delta ?? 0) - (fullCmp?.delta ?? 0)),
      (poisonCmp?.delta ?? 0) >= (fullCmp?.delta ?? 0) - 0.03,
    ),
    gate(
      'G6',
      `on the unseen '${heldOutDomain}' domain, generalisation beats per-domain scoping by >= 40pp`,
      `${pct(heldOut(full))} vs ${pct(heldOut(arms.find((arm) => arm.name === 'no-generalization')))}`,
      heldOut(full) - heldOut(arms.find((arm) => arm.name === 'no-generalization')) >= 0.4,
    ),
    gate('G7', 'no knowledge crosses the namespace boundary', String(leakage), leakage === 0),
    gate(
      'G8',
      'active knowledge is >= 80% correct on the probe grid',
      pct(full?.precision.value ?? 0),
      (full?.precision.value ?? 0) >= 0.8,
    ),
    gate(
      'G9',
      'the no-memory arm does not drift across rounds',
      pct(baseline?.rounds[0]?.accuracy ?? 0) + ' -> ' + pct(baseline?.finalAccuracy ?? 0),
      Math.abs((baseline?.rounds[0]?.accuracy ?? 0) - (baseline?.finalAccuracy ?? 0)) < 1e-9,
    ),
    gate(
      'G10',
      'the poison arm actually quarantined something (the defence was exercised)',
      String(poison?.quarantined ?? 0),
      (poison?.quarantined ?? 0) > 0,
      false,
    ),
    gate(
      'G12',
      'credit assignment withdraws a rule that failed every time it was cited',
      `${ablations?.credit.injectedWith ? 'injected' : 'withdrawn'} vs ${ablations?.credit.injectedWithout ? 'injected' : 'withdrawn'} without credit`,
      ablations !== undefined && !ablations.credit.injectedWith && ablations.credit.injectedWithout,
    ),
    gate(
      'G13',
      'contradiction resolution keeps one active rule where tolerance keeps two',
      `${ablations?.contradiction.activeWith ?? 0} vs ${ablations?.contradiction.activeWithout ?? 0} active`,
      ablations !== undefined &&
        ablations.contradiction.activeWith < ablations.contradiction.activeWithout,
    ),
    gate(
      'G14',
      'diversification more than doubles the distinct claims a pack carries',
      `${ablations?.diversity.distinctWith ?? 0} vs ${ablations?.diversity.distinctWithout ?? 0} distinct`,
      ablations !== undefined && ablations.diversity.distinctWith >= 2 * ablations.diversity.distinctWithout,
    ),
    gate(
      'G15',
      'a pack that fits one rule instead of six loses the learning effect',
      pp((comparisons['narrow-budget']?.delta ?? 0) - (fullCmp?.delta ?? 0)),
      (comparisons['narrow-budget']?.delta ?? 0) <= (fullCmp?.delta ?? 0) - 0.2,
    ),
    gate(
      'G11',
      'removing the trust ceiling measurably harms accuracy (the guard is load-bearing)',
      `${pp(unguardedCmp?.delta ?? 0)} vs ${pp(fullCmp?.delta ?? 0)}`,
      (unguardedCmp?.delta ?? 0) <= (fullCmp?.delta ?? 0) - 0.05,
    ),
  ];
}

