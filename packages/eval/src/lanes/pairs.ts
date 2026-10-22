/**
 * L2b — does recording the failure add anything the correction did not?
 *
 * Every other lane has one attempt per question. A correction therefore arrives
 * with the right answer and nothing else: the store learns what to say, and never
 * learns *which rule was in the prompt* when the answer went wrong. A host that
 * records the failed attempt as failed, then opens a second attempt and corrects
 * that, gives the store a second signal — the rule that was cited is blamed.
 *
 * ## The condition the comparison needs
 *
 * Blame needs a culprit. A single cold teaching pass has none: it distils once at
 * the end, so every correction is answered from an empty pack and both protocols
 * see identical evidence. The first version of this lane measured exactly that
 * and said so — a zero delta that could not have been anything else.
 *
 * So the lane teaches in **two rounds with a distillation between them**, and the
 * second round re-asks the questions whose conventions the corpus has since
 * revised (`REVISIONS`). Round one teaches `sales` that a comparison wants a line
 * chart; round two asks the same question, and `sales` now wants a pie. The store
 * still holds the line rule, the reader retrieves it, the answer is wrong, and
 * the correction cites the rule that caused it. That is the moment the two
 * protocols diverge:
 *
 *   single   one attempt, completed, corrected. The store is told the new answer.
 *   pair     attempt one completed, recorded as a failure (`wrong-mark`), then
 *            attempt two from the same pack, completed and corrected, with
 *            `parentRunId` linking the pair. The store is told the new answer
 *            *and* that the cited rule produced a wrong attempt.
 *
 * Attempt two is not allowed to re-recall. The store is not distilled between
 * attempts, so a second read would return the same pack; re-reading would only
 * add retrieval noise, and the variable under test is the recorded failure.
 *
 * ## What the numbers are allowed to say
 *
 * Accuracy on the holdout is not a result by itself: the corpus contains one
 * question whose convention no teaching case shares, so a share of the holdout is
 * fixed cost. The verdict carries the reachable share beside both recoveries, and
 * a difference below the bar is not called an improvement.
 *
 * Two mechanism-level readouts travel with the accuracy: `cited` counts corrected
 * attempts that retrieved a rule (the condition above), and `stale` counts active
 * rules whose answer the domain has since revised. A pair arm that retires a
 * stale rule the single arm keeps is a difference worth knowing about even when
 * the holdout has not moved yet.
 */
import { openMicroglia, type Microglia } from '@agentix-e/microglia-core/capture';
import { ruleInterpreter, type Interpreter } from '@agentix-e/microglia-core/distill';
import { EmbeddedMemory, MemoryJournal } from '@agentix-e/microglia-core/memory';
import { mulberry32, steppingClock, type Json } from '@agentix-e/microglia-core';
import {
  chartEditDistance,
  chartInterpreter,
  type ChartConstraint,
  type ChartMark,
  type ChartSpec,
} from '../workload/index.js';
import { applyKnowledge, queryFeatures } from '../scenario.js';
import {
  buildConventions,
  holdoutCases,
  revisionCases,
  trainingSplit,
  unreachableCases,
  type ConventionCase,
} from '../conventions.js';
import { pairVerdict, reachableShare, type PairVerdict } from '../pairs.js';
import { TASK } from '../study.js';

/** The difference the lane is willing to call an improvement, in accuracy points. */
export const L2B_BAR = 0.05;

/** The failure code the pair arm records. A code, not prose: it is the reason key. */
const WRONG_MARK = 'wrong-mark';

const CLOCK_START = 1_700_000_000_000;
const NAMESPACE = 'l2b';
const SEED = 20261022;

/**
 * The oracle is the gold *by construction*: the gold is the stated convention, so
 * the ceiling of this corpus is exactly 1.00. One question is unreachable by
 * construction; how much of the rest each protocol recovers is the question.
 */
const ORACLE = 1;

export type L2bArm = 'single' | 'pair';

/** One teaching round: a batch of questions, followed by a distillation. */
export type TeachingRound = {
  readonly id: string;
  readonly cases: readonly ConventionCase[];
};

export type RoundReport = {
  readonly round: string;
  readonly cases: number;
  readonly corrections: number;
  readonly cited: number;
};

/** One rule as the store holds it: scope, answer, status. Comparable across arms. */
export type RuleState = {
  readonly rule: string;
  readonly status: string;
};

export type ArmReport = {
  readonly arm: L2bArm;
  /** Per holdout case, in corpus order. */
  readonly holdout: readonly boolean[];
  readonly accuracy: number;
  /** Accuracy over cases whose scope key was taught. */
  readonly reachableAccuracy: number;
  /** Accuracy over the questions no teaching case could reach. */
  readonly wallAccuracy: number;
  readonly runs: number;
  readonly corrections: number;
  /** Corrected attempts that cited at least one rule: the lever the pair needs. */
  readonly correctedWithCitation: number;
  /** Active rules whose answer the domain has since revised. Lower is better. */
  readonly stale: number;
  readonly knowledge: number;
  readonly active: number;
  /** Negative lessons the store holds: what the pair arm adds. */
  readonly negative: number;
  readonly rounds: readonly RoundReport[];
  /** Every constraint the store holds, in a stable order, for a cross-arm diff. */
  readonly rules: readonly RuleState[];
};

export type L2bGate = {
  readonly id: string;
  readonly criterion: string;
  readonly actual: string;
  readonly pass: boolean;
  /**
   * Whether a failure stops the lane.
   *
   * Every gate here blocks. "Non-blocking" was the honest answer while the lane
   * could not exercise its own lever; now that the revision round guarantees a
   * culprit, an unexercised lever is a broken instrument and belongs in red. The
   * field stays explicit so a future gap can be marked as one without inventing a
   * second gate shape.
   */
  readonly blocking: boolean;
};

export type WallCase = {
  readonly id: string;
  readonly gold: string;
  readonly single: boolean;
  readonly pair: boolean;
};

export type RuleDiff = {
  readonly rule: string;
  readonly single: string;
  readonly pair: string;
};

export type L2bReport = {
  readonly cases: {
    readonly teach: number;
    readonly revision: number;
    readonly holdout: number;
    readonly unreachable: number;
  };
  readonly reachable: number;
  readonly baseline: number;
  readonly oracle: number;
  readonly arms: readonly ArmReport[];
  readonly verdict: PairVerdict;
  readonly wall: readonly WallCase[];
  /**
   * Rules the two stores hold differently.
   *
   * A zero delta is only explained when this is empty: two protocols can agree on
   * the holdout while leaving different stores behind, and that difference is what
   * would show up the next time a question is asked. An empty diff plus a zero
   * delta says the failure record changed nothing measurable at all.
   */
  readonly storeDiff: readonly RuleDiff[];
  readonly gates: readonly L2bGate[];
};

/** Everything both arms must share for the comparison to be paired. */
export type LaneSetup = {
  readonly schedule: readonly TeachingRound[];
  readonly holdout: readonly ConventionCase[];
  readonly wall: ReadonlySet<string>;
  /** The convention in force per scope key, i.e. what a current store should hold. */
  readonly due: ReadonlyMap<string, ChartMark>;
};

function scopeKeyOf(entry: { readonly domain: string; readonly intent: string }): string {
  return `${entry.domain}\u0000${entry.intent}`;
}

/**
 * The schedule both arms run: teach, distil, revise, distil, then evaluate.
 *
 * The rounds are built from the corpus rather than from a counter, so a schedule
 * cannot silently skip the revision — the round that makes the comparison
 * non-vacuous.
 */
export function teachingSchedule(cases: readonly ConventionCase[]): readonly TeachingRound[] {
  return [
    { id: 'base', cases: trainingSplit(cases) },
    { id: 'revision', cases: revisionCases(cases) },
  ];
}

export function laneSetup(cases: readonly ConventionCase[] = buildConventions()): LaneSetup {
  const holdout = holdoutCases(cases);
  return {
    schedule: teachingSchedule(cases),
    holdout,
    wall: new Set(unreachableCases(cases).map((entry) => entry.id)),
    due: new Map(holdout.map((entry) => [scopeKeyOf(entry), entry.goldMark])),
  };
}

/** The two interpreters the study composes, in the same order. */
const combined: Interpreter = async (context) => [
  ...chartInterpreter(context),
  ...(await ruleInterpreter(context)),
];

/** A fresh store, so the two arms cannot inherit each other's knowledge. */
async function openLane(): Promise<Microglia> {
  const store = await EmbeddedMemory.open(new MemoryJournal());
  return openMicroglia({
    app: 'microglia-l2b',
    namespace: NAMESPACE,
    store,
    interpreter: combined,
    editSemantics: chartEditDistance,
    clock: steppingClock(CLOCK_START, 1),
    random: mulberry32(SEED),
  });
}

/** The run input for one question: the features the interpreter scopes a lesson by. */
export function featuresFor(item: ConventionCase): Record<string, Json> {
  return queryFeatures(item.query);
}

/**
 * The correction a reviewer writes: the predicted specification with the
 * convention's mark.
 *
 * It is a single-field edit by construction, so the interpreter classifies it as
 * `chart_type_wrong` rather than as an unrelated rewrite. A test pins that the
 * result equals the corpus's own gold spec.
 */
export function correctionFor(item: ConventionCase, prediction: ChartSpec): ChartSpec {
  return { ...prediction, mark: item.goldMark };
}

export type TeachingOutcome = {
  readonly runs: number;
  readonly corrections: number;
  /**
   * Rules the pack carried when the answer was corrected.
   *
   * Zero means the failure record had nothing to blame: the two protocols could
   * not have diverged on this case whatever the store does with a failure.
   */
  readonly cited: number;
};

/**
 * Teach one question under one protocol.
 *
 * The arms differ in exactly one place: whether the first attempt is recorded as
 * a failure and retried. A question the loop already answers is not a failure, so
 * neither arm records anything there — a pair exists only where an attempt
 * failed.
 */
export async function teachCase(
  mg: Microglia,
  item: ConventionCase,
  arm: L2bArm,
): Promise<TeachingOutcome> {
  const task = mg.openTask({ taskId: item.id, taskType: TASK });
  const pack = await mg.recall({
    task: TASK,
    text: item.query.text,
    scope: { domain: item.domain, intent: item.intent },
  });
  const prediction = applyKnowledge(pack, item);
  const first = task.begin({
    attempt: 1,
    input: featuresFor(item),
    pack,
    promptVersion: 'l2b-v2',
    domainPack: 'nl2charts',
    schemaDigest: item.domain,
  });
  await first.complete(prediction as unknown as Json);

  if (prediction.mark === item.goldMark) {
    await task.complete({ status: 'accepted' });
    return { runs: 1, corrections: 0, cited: 0 };
  }

  if (arm === 'single') {
    await first.edit(correctionFor(item, prediction) as unknown as Json, {
      note: 'user correction',
    });
    await task.complete({ status: 'accepted' });
    return { runs: 1, corrections: 1, cited: pack.ids.length };
  }

  // The failure is recorded against the attempt that produced it, with a code:
  // `outcome(false)` without one teaches "something went wrong", which is not a
  // lesson a store can scope.
  await first.outcome(
    false,
    WRONG_MARK,
    `answered ${prediction.mark} for a ${item.intent} question in ${item.domain}`,
  );
  const second = task.begin({
    attempt: 2,
    input: featuresFor(item),
    pack,
    promptVersion: 'l2b-v2',
    domainPack: 'nl2charts',
    schemaDigest: item.domain,
    parentRunId: first.id,
  });
  await second.complete(prediction as unknown as Json);
  await second.edit(correctionFor(item, prediction) as unknown as Json, {
    note: 'user correction',
  });
  await task.complete({ status: 'accepted' });
  return { runs: 2, corrections: 1, cited: pack.ids.length };
}

/**
 * Corrected attempts that cited a rule.
 *
 * Counted per attempt rather than by sum of citations: the question is whether
 * the failure record had *anything* to blame, and a case that cited three rules
 * is still one case.
 */
export function citedCorrections(outcomes: readonly TeachingOutcome[]): number {
  return outcomes.filter((outcome) => outcome.cited > 0).length;
}

/** The pack's answer for every question, in order. */
export async function predictAll(
  mg: Microglia,
  cases: readonly ConventionCase[],
): Promise<readonly boolean[]> {
  const correct: boolean[] = [];
  for (const item of cases) {
    const pack = await mg.recall({
      task: TASK,
      text: item.query.text,
      scope: { domain: item.domain, intent: item.intent },
    });
    correct.push(applyKnowledge(pack, item).mark === item.goldMark);
  }
  return correct;
}

/** What a loop with no memory at all answers: the defective recommender. */
export function baselineCorrect(cases: readonly ConventionCase[]): readonly boolean[] {
  return cases.map((item) => item.baseline.mark === item.goldMark);
}

/** Share of `correct` over the cases `keep` selects. An empty selection is 0. */
export function shareOf(
  cases: readonly ConventionCase[],
  correct: readonly boolean[],
  keep: (item: ConventionCase) => boolean,
): number {
  let hits = 0;
  let total = 0;
  for (const [index, item] of cases.entries()) {
    if (!keep(item)) continue;
    total += 1;
    if (correct[index] === true) hits += 1;
  }
  return total === 0 ? 0 : hits / total;
}

/**
 * Active rules whose answer the domain has since revised.
 *
 * The mechanism readout: a protocol that blames the cited rule should stop
 * applying it, and this counts what the store would still hand a prompt. It is
 * reported beside accuracy because the two can disagree — a stale rule that loses
 * the confidence tie-break costs nothing today and everything the moment the new
 * rule is edited.
 */
export function staleActive(
  items: readonly {
    readonly status: string;
    readonly kind: string;
    readonly scope: { readonly domain?: string; readonly intent?: string };
    readonly payload?: Json;
  }[],
  due: ReadonlyMap<string, ChartMark>,
): number {
  let stale = 0;
  for (const item of items) {
    if (item.status !== 'active') continue;
    // A negative lesson carries `{ code }`, not a chart constraint: reading `then`
    // off it would throw, and counting it as a stale rule would be a lie.
    if (item.kind !== 'constraint') continue;
    const { domain, intent } = item.scope;
    if (domain === undefined || intent === undefined) continue;
    const payload = item.payload as ChartConstraint | undefined;
    if (payload?.then === undefined) continue;
    const expected = due.get(scopeKeyOf({ domain, intent }));
    if (expected !== undefined && payload.then.mark !== expected) stale += 1;
  }
  return stale;
}

/**
 * The constraints a store holds, as comparable rows.
 *
 * Sorted so two arms can be diffed without caring about insertion order, and
 * keyed by scope plus answer rather than by id: ids carry timestamps, and a diff
 * on ids would report the same two rules as different.
 */
export function ruleStates(
  items: readonly {
    readonly status: string;
    readonly kind: string;
    readonly scope: { readonly domain?: string; readonly intent?: string };
    readonly payload?: Json;
  }[],
): readonly RuleState[] {
  const rows: RuleState[] = [];
  for (const item of items) {
    if (item.kind !== 'constraint') continue;
    const payload = item.payload as ChartConstraint | undefined;
    // A constraint with no chart in it is not a rule a prompt could act on; the
    // negative lessons the pair arm writes are excluded above by kind, and this
    // guard covers a malformed constraint rather than trusting the store.
    if (payload?.then === undefined) continue;
    const domain = item.scope.domain ?? '*';
    const intent = item.scope.intent ?? '*';
    rows.push({ rule: `${domain}/${intent}=${payload.then.mark}`, status: item.status });
  }
  return rows.sort(compareRows);
}

/**
 * Order rows by claim, then by status.
 *
 * Two items can hold the same scope and answer with different statuses — a
 * demoted copy and a live one — so the comparator has to define an order for
 * equal claims rather than lean on the sort being stable.
 */
function compareRows(a: RuleState, b: RuleState): number {
  const left = `${a.rule}\u0000${a.status}`;
  const right = `${b.rule}\u0000${b.status}`;
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/**
 * Rules the two arms hold differently, including rules only one of them has.
 *
 * A rule present in one store and absent from the other is the strongest form of
 * difference, so absence is a value ('absent') rather than a skipped row.
 */
export function diffRuleStates(
  single: readonly RuleState[],
  pair: readonly RuleState[],
): readonly RuleDiff[] {
  const left = new Map(single.map((row) => [row.rule, row.status]));
  const right = new Map(pair.map((row) => [row.rule, row.status]));
  const names = [...new Set([...left.keys(), ...right.keys()])].sort();
  const diffs: RuleDiff[] = [];
  for (const rule of names) {
    const a = left.get(rule) ?? 'absent';
    const b = right.get(rule) ?? 'absent';
    if (a !== b) diffs.push({ rule, single: a, pair: b });
  }
  return diffs;
}

/** Teach every round, distil between rounds, then read the holdout. */
export async function runPairArm(arm: L2bArm, setup: LaneSetup): Promise<ArmReport> {
  const mg = await openLane();
  const rounds: RoundReport[] = [];
  const outcomes: TeachingOutcome[] = [];
  for (const round of setup.schedule) {
    const roundOutcomes: TeachingOutcome[] = [];
    for (const item of round.cases) roundOutcomes.push(await teachCase(mg, item, arm));
    outcomes.push(...roundOutcomes);
    rounds.push({
      round: round.id,
      cases: round.cases.length,
      corrections: roundOutcomes.reduce((total, outcome) => total + outcome.corrections, 0),
      cited: citedCorrections(roundOutcomes),
    });
    await mg.distill({ generalize: true });
  }
  const correct = await predictAll(mg, setup.holdout);

  const items = await mg.store.listKnowledge({ namespace: NAMESPACE, status: 'all' });
  const report: ArmReport = {
    arm,
    holdout: correct,
    accuracy: shareOf(setup.holdout, correct, () => true),
    reachableAccuracy: shareOf(setup.holdout, correct, (item) => !setup.wall.has(item.id)),
    wallAccuracy: shareOf(setup.holdout, correct, (item) => setup.wall.has(item.id)),
    runs: outcomes.reduce((total, outcome) => total + outcome.runs, 0),
    corrections: outcomes.reduce((total, outcome) => total + outcome.corrections, 0),
    correctedWithCitation: citedCorrections(outcomes),
    stale: staleActive(items, setup.due),
    knowledge: items.length,
    active: items.filter((item) => item.status === 'active').length,
    negative: items.filter((item) => item.kind === 'negative').length,
    rounds,
    rules: ruleStates(items),
  };
  await mg.close();
  return report;
}

function armOf(arms: readonly ArmReport[], name: L2bArm): ArmReport {
  const found = arms.find((entry) => entry.arm === name);
  if (found === undefined) throw new Error(`L2b: missing the ${name} arm`);
  return found;
}

/**
 * The gates.
 *
 * None of them asks "did the pair win": that is the verdict, and it may honestly
 * be no. They ask whether the instrument is measuring what it claims — headroom
 * exists, the wall is a wall, the split has both mass and a wall, the failure was
 * recorded, and the revision round actually produced a culprit.
 */
export function buildL2bGates(report: {
  readonly arms: readonly ArmReport[];
  readonly reachable: number;
  readonly baseline: number;
  readonly revision: number;
}): readonly L2bGate[] {
  const single = armOf(report.arms, 'single');
  const pair = armOf(report.arms, 'pair');
  /**
   * Corrections the revision round produced.
   *
   * Summed over every round named `revision` rather than read from the first
   * match: a schedule that grew a second revision round should add up, not
   * silently report the first one.
   */
  const revisionCorrections = (arm: ArmReport): number =>
    arm.rounds
      .filter((round) => round.round === 'revision')
      .reduce((total, round) => total + round.corrections, 0);
  const gate = (id: string, criterion: string, actual: string, pass: boolean): L2bGate => ({
    id,
    criterion,
    actual,
    pass,
    blocking: true,
  });
  return [
    gate(
      'l2b-corpus-has-headroom',
      `no arm reaches the oracle (${ORACLE.toFixed(2)}): the corpus is not saturated`,
      `baseline ${pct(report.baseline)}, single ${pct(single.accuracy)}, pair ${pct(pair.accuracy)}`,
      report.baseline < ORACLE && Math.max(single.accuracy, pair.accuracy) < ORACLE,
    ),
    gate(
      'l2b-wall-is-real',
      'the held-out convention is recovered by neither arm',
      `single ${pct(single.wallAccuracy)}, pair ${pct(pair.wallAccuracy)}`,
      single.wallAccuracy < 1 && pair.wallAccuracy < 1,
    ),
    gate(
      'l2b-split-is-split',
      'the evaluated set contains both reachable mass and a wall',
      pct(report.reachable),
      report.reachable > 0 && report.reachable < 1,
    ),
    gate(
      'l2b-failure-recorded',
      'the pair arm records failures the single arm has no way to record',
      `${pair.negative} negative lessons, ${pair.runs} vs ${single.runs} runs`,
      pair.negative > 0 && pair.runs > single.runs,
    ),
    gate(
      'l2b-revision-has-a-culprit',
      'every revision question was answered wrongly from a rule, so blame had a target',
      `${revisionCorrections(single)}/${report.revision} single, ${revisionCorrections(pair)}/${report.revision} pair`,
      revisionCorrections(single) === report.revision &&
        revisionCorrections(pair) === report.revision &&
        report.revision > 0,
    ),
    gate(
      'l2b-lever-exercised',
      'corrected attempts cited a rule, so the failure record had something to blame',
      `${single.correctedWithCitation}/${single.corrections} single, ${pair.correctedWithCitation}/${pair.corrections} pair`,
      single.correctedWithCitation > 0 && pair.correctedWithCitation > 0,
    ),
  ];
}

function pct(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

/** The whole lane: both arms, the verdict, and the gates. */
export async function runL2b(
  cases: readonly ConventionCase[] = buildConventions(),
): Promise<L2bReport> {
  const setup = laneSetup(cases);
  const arms: ArmReport[] = [await runPairArm('single', setup), await runPairArm('pair', setup)];
  const single = armOf(arms, 'single');
  const pair = armOf(arms, 'pair');
  const baseline = shareOf(setup.holdout, baselineCorrect(setup.holdout), () => true);
  const taught = setup.schedule.flatMap((round) => round.cases);
  const reachable = reachableShare(taught, setup.holdout);
  const verdict = pairVerdict({
    training: taught,
    evaluated: setup.holdout,
    single: single.accuracy,
    pair: pair.accuracy,
    baseline,
    oracle: ORACLE,
    bar: L2B_BAR,
  });

  // The wall is a subset of the holdout by construction, so the report is built by
  // walking the holdout once: no id lookup that could miss, and no `?? ''`.
  const wallReport: WallCase[] = setup.holdout.flatMap((entry, index) =>
    setup.wall.has(entry.id)
      ? [
          {
            id: entry.id,
            gold: entry.goldMark,
            single: single.holdout[index] === true,
            pair: pair.holdout[index] === true,
          },
        ]
      : [],
  );

  return {
    cases: {
      teach: trainingSplit(cases).length,
      revision: revisionCases(cases).length,
      holdout: setup.holdout.length,
      unreachable: setup.wall.size,
    },
    reachable,
    baseline,
    oracle: ORACLE,
    arms,
    verdict,
    wall: wallReport,
    storeDiff: diffRuleStates(single.rules, pair.rules),
    gates: buildL2bGates({
      arms,
      reachable,
      baseline,
      revision: revisionCases(cases).length,
    }),
  };
}
