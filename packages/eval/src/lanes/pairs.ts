/**
 * L2b — does recording the failure add anything the correction did not?
 *
 * Every other lane has one attempt per question. A correction therefore arrives
 * with the right answer and nothing else: the store learns what to say, and never
 * learns *which rule was in the prompt* when the answer went wrong. A host that
 * records the failed attempt as a failed attempt, then opens a second attempt and
 * corrects that, gives the store a second, different signal — the rule that was
 * cited is blamed, and the task's history says the first answer was rejected.
 *
 * The lane runs both protocols over one corpus, one teaching budget and one
 * holdout:
 *
 *   single   one attempt, completed, corrected. The correction is the only
 *            evidence the loop gets.
 *   pair     attempt one completed, then recorded as a failure (`wrong-mark`),
 *            then attempt two from the same pack, completed and corrected.
 *            `parentRunId` links the pair, so a reader can tell the attempts
 *            apart from two unrelated generations.
 *
 * Attempt two is not allowed to re-recall. The store is not distilled between
 * attempts, so a second read would return the same pack; re-reading would only
 * add retrieval noise to the comparison, and the variable under test is the
 * *recorded failure*, not a second retrieval.
 *
 * ## What the numbers are allowed to say
 *
 * Accuracy on the holdout is not a result by itself: the corpus contains one
 * question whose convention no teaching case shares, so a share of the holdout is
 * fixed cost. The verdict therefore carries the reachable share beside both
 * recoveries, and a difference below the bar is not called an improvement — the
 * same discipline `pairVerdict` enforces.
 *
 * A null result is a result. If the failure record adds nothing, the lane says
 * so; what it must never do is report a delta computed over cases it could not
 * have reached.
 *
 * ## The number that decides whether the verdict means anything
 *
 * The pair protocol can only differ from the single one through evidence about a
 * rule that was *cited* when the answer went wrong. A cold teaching pass distils
 * once, at the end, so every correction in it is answered from an empty pack and
 * cites nothing: both arms then see exactly the same evidence, and a zero delta
 * is arithmetic rather than a measurement.
 *
 * The lane therefore counts citations on corrected attempts and reports the count
 * as a gate. When it is zero the verdict is marked *vacuous* — the arms were
 * compared, and the comparison could not have come out any other way. Reporting
 * that is the difference between a null result and a null instrument.
 */
import { openMicroglia, type Microglia } from '@agentix-e/microglia-core/capture';
import { ruleInterpreter, type Interpreter } from '@agentix-e/microglia-core/distill';
import { EmbeddedMemory, MemoryJournal } from '@agentix-e/microglia-core/memory';
import { mulberry32, steppingClock, type Json } from '@agentix-e/microglia-core';
import { chartEditDistance, chartInterpreter, type ChartSpec } from '../workload/index.js';
import { applyKnowledge, queryFeatures } from '../scenario.js';
import {
  buildConventions,
  holdoutCases,
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
 * The oracle is the gold *by construction*: the gold is the stated convention,
 * so the ceiling of this corpus is exactly 1.00. L2b's question is not whether
 * that ceiling is reachable — it is not, for one question — but how much of it
 * each protocol recovers.
 */
const ORACLE = 1;

export type L2bArm = 'single' | 'pair';

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
  readonly knowledge: number;
  readonly active: number;
  /** Negative lessons the store holds: what the pair arm adds. */
  readonly negative: number;
};

export type L2bGate = {
  readonly id: string;
  readonly criterion: string;
  readonly actual: string;
  readonly pass: boolean;
  /**
   * Whether a failure stops the lane.
   *
   * A non-blocking gate is evidence about the instrument rather than a
   * regression: the lever gate reports a comparison that could not have come out
   * the other way, and a lane that turned that into a red build would be hiding a
   * design limit behind a passing gate.
   */
  readonly blocking: boolean;
};

export type WallCase = {
  readonly id: string;
  readonly gold: string;
  readonly single: boolean;
  readonly pair: boolean;
};

export type L2bReport = {
  readonly cases: { readonly teach: number; readonly holdout: number; readonly unreachable: number };
  readonly reachable: number;
  readonly baseline: number;
  readonly oracle: number;
  readonly arms: readonly ArmReport[];
  readonly verdict: PairVerdict;
  readonly wall: readonly WallCase[];
  readonly gates: readonly L2bGate[];
};

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
    promptVersion: 'l2b-v1',
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
    promptVersion: 'l2b-v1',
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

/** Teach, distil once, then read the holdout. */
export async function runPairArm(
  arm: L2bArm,
  teaching: readonly ConventionCase[],
  holdout: readonly ConventionCase[],
  wallIds: ReadonlySet<string>,
): Promise<ArmReport> {
  const mg = await openLane();
  const outcomes: TeachingOutcome[] = [];
  for (const item of teaching) outcomes.push(await teachCase(mg, item, arm));
  const runs = outcomes.reduce((total, outcome) => total + outcome.runs, 0);
  const corrections = outcomes.reduce((total, outcome) => total + outcome.corrections, 0);
  const correctedWithCitation = citedCorrections(outcomes);
  await mg.distill({ generalize: true });
  const correct = await predictAll(mg, holdout);

  const items = await mg.store.listKnowledge({ namespace: NAMESPACE, status: 'all' });
  const report: ArmReport = {
    arm,
    holdout: correct,
    accuracy: shareOf(holdout, correct, () => true),
    reachableAccuracy: shareOf(holdout, correct, (item) => !wallIds.has(item.id)),
    wallAccuracy: shareOf(holdout, correct, (item) => wallIds.has(item.id)),
    runs,
    corrections,
    correctedWithCitation,
    knowledge: items.length,
    active: items.filter((item) => item.status === 'active').length,
    negative: items.filter((item) => item.kind === 'negative').length,
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
 * exists, the wall is a wall, the split has both mass and a wall, and the
 * mechanism under test actually fired.
 */
export function buildL2bGates(report: {
  readonly arms: readonly ArmReport[];
  readonly reachable: number;
  readonly baseline: number;
}): readonly L2bGate[] {
  const single = armOf(report.arms, 'single');
  const pair = armOf(report.arms, 'pair');
  const gate = (
    id: string,
    criterion: string,
    actual: string,
    pass: boolean,
    blocking = true,
  ): L2bGate => ({ id, criterion, actual, pass, blocking });
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
      'l2b-lever-exercised',
      'corrected attempts cited a rule, so the failure record had something to blame',
      `${single.correctedWithCitation}/${single.corrections} single, ${pair.correctedWithCitation}/${pair.corrections} pair`,
      single.correctedWithCitation > 0 || pair.correctedWithCitation > 0,
      false,
    ),
  ];
}

function pct(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

/** The whole lane: both arms, the verdict, and the gates. */
export async function runL2b(): Promise<L2bReport> {
  const cases = buildConventions();
  const teaching = trainingSplit(cases);
  const holdout = holdoutCases(cases);
  const wall = unreachableCases(cases);
  const wallIds = new Set(wall.map((entry) => entry.id));

  const arms: ArmReport[] = [
    await runPairArm('single', teaching, holdout, wallIds),
    await runPairArm('pair', teaching, holdout, wallIds),
  ];
  const single = armOf(arms, 'single');
  const pair = armOf(arms, 'pair');
  const baseline = shareOf(holdout, baselineCorrect(holdout), () => true);
  const reachable = reachableShare(teaching, holdout);
  const verdict = pairVerdict({
    training: teaching,
    evaluated: holdout,
    single: single.accuracy,
    pair: pair.accuracy,
    baseline,
    oracle: ORACLE,
    bar: L2B_BAR,
  });

  const wallReport: WallCase[] = wall.map((entry) => {
    const index = holdout.findIndex((candidate) => candidate.id === entry.id);
    return {
      id: entry.id,
      gold: entry.goldMark,
      single: single.holdout[index] === true,
      pair: pair.holdout[index] === true,
    };
  });

  return {
    cases: { teach: teaching.length, holdout: holdout.length, unreachable: wall.length },
    reachable,
    baseline,
    oracle: ORACLE,
    arms,
    verdict,
    wall: wallReport,
    gates: buildL2bGates({ arms, reachable, baseline }),
  };
}
