/**
 * L2b — the pair-contrast lane, as a runnable artefact.
 *
 * Writes `eval/results/poc-l2b.json`. The gate list decides the exit code: a lane
 * whose instrument is broken must not report a verdict as if it had one.
 */
import { L2B_BAR, runL2b } from '@agentix-e/microglia-eval';
import { writeResult } from './lib.js';

const report = await runL2b();
const single = report.arms.find((arm) => arm.arm === 'single');
const pair = report.arms.find((arm) => arm.arm === 'pair');
if (single === undefined || pair === undefined) throw new Error('L2b: arm missing from the report');

/**
 * A comparison where no corrected attempt cited a rule cannot distinguish the two
 * protocols: both arms saw the same empty pack. The artefact says so rather than
 * letting a zero delta read as evidence about the mechanism.
 */
const vacuous = single.correctedWithCitation === 0 && pair.correctedWithCitation === 0;

await writeResult({
  id: 'poc-l2b',
  title: 'L2b — pair contrast: does recording the failure add anything?',
  ranAt: new Date().toISOString(),
  model: 'none',
  n: report.cases.holdout,
  calls: 0,
  metrics: {
    teach_cases: report.cases.teach,
    holdout_cases: report.cases.holdout,
    unreachable_cases: report.cases.unreachable,
    reachable_share: report.reachable,
    baseline_top1: report.baseline,
    single_top1: single.accuracy,
    pair_top1: pair.accuracy,
    single_recovery: report.verdict.singleRecovery,
    pair_recovery: report.verdict.pairRecovery,
    recovery_delta: report.verdict.delta,
    pair_helps: report.verdict.pairHelps ? 1 : 0,
    bar: L2B_BAR,
    single_reachable_top1: single.reachableAccuracy,
    pair_reachable_top1: pair.reachableAccuracy,
    single_wall_top1: single.wallAccuracy,
    pair_wall_top1: pair.wallAccuracy,
    single_runs: single.runs,
    pair_runs: pair.runs,
    single_corrections: single.corrections,
    pair_corrections: pair.corrections,
    single_knowledge: single.knowledge,
    pair_knowledge: pair.knowledge,
    single_active: single.active,
    pair_active: pair.active,
    pair_negative_lessons: pair.negative,
    single_corrected_with_citation: single.correctedWithCitation,
    pair_corrected_with_citation: pair.correctedWithCitation,
    verdict_is_vacuous: vacuous ? 1 : 0,
    gates_passing: report.gates.filter((gate) => gate.pass).length,
    gates_total: report.gates.length,
  },
  notes: [
    `Two protocols, one corpus, one teaching budget: ${report.cases.teach} teaching questions, ${report.cases.holdout} evaluated, ${report.cases.unreachable} of them unreachable by construction.`,
    'single: one attempt, completed, then corrected. pair: attempt one completed and recorded as a failure (wrong-mark), attempt two from the same pack completed and corrected, linked by parentRunId.',
    'Attempt two does not re-recall: the store is not distilled between attempts, so a second read returns the same pack. The variable under test is the recorded failure, not retrieval noise.',
    `Reachable share ${(report.reachable * 100).toFixed(2)}%: the questions whose (domain, intent) key was taught. The remainder is the held-out convention, which no correction could supply — a fixed cost the recovery denominator does not hide.`,
    `Recovery is (arm - baseline) / (oracle - baseline) on the whole holdout, with oracle ${report.oracle.toFixed(2)} by construction: the gold is the stated convention. The bar for calling a difference an improvement is ${L2B_BAR} of recovery.`,
    `Verdict: pair helps = ${report.verdict.pairHelps}. A null result is a result — the failure record is not called an improvement because it was tried.`,
    `Corrected attempts that cited a rule: ${single.correctedWithCitation}/${single.corrections} single, ${pair.correctedWithCitation}/${pair.corrections} pair. ${vacuous ? 'Zero on both arms: the single teaching pass distils once at the end, so every correction was answered from an empty pack and the two protocols could not have diverged. The number is arithmetic, not evidence about the mechanism, and the lane reports it as vacuous rather than as a null effect.' : 'The lever was exercised, so the delta is a measurement of the recorded failure rather than of an empty store.'}`,
    `The artefact carries ${report.gates.filter((gate) => gate.pass).length}/${report.gates.length} gates: headroom, a real wall, a split with both mass and a wall, and evidence that the failure was actually recorded.`,
  ],
  samples: report.wall.map((entry) => ({
    case: entry.id,
    gold: entry.gold,
    single: entry.single,
    pair: entry.pair,
  })),
});

process.stdout.write(
  `[poc-l2b] evaluated=${report.cases.holdout} reachable=${(report.reachable * 100).toFixed(2)}% baseline=${(report.baseline * 100).toFixed(2)}% single=${(single.accuracy * 100).toFixed(2)}% pair=${(pair.accuracy * 100).toFixed(2)}% delta=${(report.verdict.delta * 100).toFixed(2)}pp pair_helps=${report.verdict.pairHelps}\n`,
);
for (const gate of report.gates) {
  process.stdout.write(
    `  ${gate.pass ? 'PASS' : 'FAIL'} ${gate.id} ${gate.actual} (${gate.criterion})${gate.blocking ? '' : ' [non-blocking]'}\n`,
  );
}
if (report.gates.some((gate) => gate.blocking && !gate.pass)) process.exit(1);
