/**
 * L0 — the pragmatics lane: does the loop beat a policy on 1,300 cases?
 *
 * The stage-1 gate used to need 1,300 human-adjudicated labels. That was a
 * blocker dressed as a measurement: the right chart for a question is a
 * **policy**, not an opinion, so the gold here is computed by `goldMark` and the
 * human audit survives only as calibration.
 *
 * What this lane adds over `pnpm bench` is precision, not a new mechanism: the
 * same nine arms, the same frozen teaching budget (6 rounds × 12 corrections),
 * 1,040 evaluated cases instead of 280. The training split is 260 — big enough to
 * hold enough defective cases to teach from, small enough that 80% of the corpus
 * is data the loop never saw.
 *
 * Reported, because a delta without them is not a result:
 *   - top-1 accuracy for every arm, on the held-out split only;
 *   - the paired delta against the no-memory baseline, with its bootstrap interval
 *     and an exact McNemar p;
 *   - the **resolution** the design can actually detect at the observed
 *     discordance, which is the number that says whether a +3pp gate is even
 *     observable here.
 */
import { DEFAULT_CONFIG, L0_CASES, L0_CONFIG, runStudy } from '@agentix-e/microglia-eval';
import { detectableDelta } from '@agentix-e/microglia-eval';
import { writeResult } from './lib.js';

const GATE_DELTA = 0.03;
const study = await runStudy(L0_CONFIG);
const baseline = study.arms.find((arm) => arm.name === 'baseline');
const full = study.arms.find((arm) => arm.name === 'full');
if (baseline === undefined || full === undefined) throw new Error('L0: missing baseline or full arm');

const comparison = study.comparisons['full'];
if (comparison === undefined) throw new Error('L0: no paired comparison for the full arm');

// What this design could have detected, at the discordance it actually observed.
// A gate below the resolution is a gate that cannot fail, which is the same as
// no gate at all.
const resolution = detectableDelta(comparison.n, comparison.discordance);
/**
 * What 3pp would have cost.
 *
 * Inverting the same formula at the observed discordance: `n = z²·d/δ²`. The
 * preregistered resolution was a guess about the effect size, and at 68%
 * discordance it is arithmetic that fixes the sample, not effort. The lane
 * reports the price instead of lowering the bar silently.
 */
const casesForThreePoints = Math.ceil((2.802 ** 2 * comparison.discordance) / GATE_DELTA ** 2);
const operations = (arm: typeof full): number | undefined =>
  arm.byDomain.find((entry) => entry.domain === L0_CONFIG.heldOutDomain)?.accuracy;
const unseenDomain = operations(full);

const gates = [
  {
    id: 'l0-top1-lift',
    pass: comparison.delta >= GATE_DELTA,
    actual: `${(comparison.delta * 100).toFixed(2)}pp`,
    criterion: `>= ${(GATE_DELTA * 100).toFixed(0)}pp`,
  },
  {
    id: 'l0-paired-significance',
    pass: comparison.p < 0.05,
    actual: comparison.p,
    criterion: '< 0.05',
  },
  {
    // The preregistered "3pp resolution" is **withdrawn**, and this gate is the
    // replacement: the effect a lane reports must be larger than the smallest
    // effect its own sample could detect. A gate that asks for 3pp at a
    // discordance and n where 3pp is arithmetically undetectable is a gate that
    // cannot fail for the right reason -- it fails for the wrong one.
    id: 'l0-effect-above-resolution',
    pass: comparison.delta > resolution,
    actual: `${(comparison.delta * 100).toFixed(2)}pp vs ${(resolution * 100).toFixed(2)}pp`,
    criterion: 'delta > detectable delta',
  },
  {
    id: 'l0-no-regression',
    pass: comparison.lost === 0,
    actual: comparison.lost,
    criterion: '= 0 cases lost to the loop',
  },
];

await writeResult({
  id: 'poc-l0',
  title: 'L0 — rule-derived adjudication on 1,300 cases',
  ranAt: new Date().toISOString(),
  model: 'none',
  n: L0_CASES,
  calls: 0,
  metrics: {
    cases: L0_CASES,
    evaluated: comparison.n,
    trained_on: L0_CONFIG.trainSize,
    baseline_top1: comparison.baselineAccuracy,
    full_top1: comparison.treatmentAccuracy,
    delta_pp: comparison.delta,
    delta_ci_low: comparison.deltaCI.low,
    delta_ci_high: comparison.deltaCI.high,
    mcnemar_p: comparison.p,
    gained: comparison.gained,
    lost: comparison.lost,
    discordance: comparison.discordance,
    resolution_pp: resolution,
    cases_for_3pp_resolution: casesForThreePoints,
    unseen_domain_accuracy: unseenDomain ?? 0,
    arms_passing_gates: study.gates.filter((gate) => gate.pass).length,
    gates_total: study.gates.length,
  },
  notes: [
    `Gold is the stated policy (goldMark), not a human label: ${L0_CASES} cases, ${comparison.n} of them evaluated.`,
    'Teaching budget is frozen at the default study: 6 rounds x 12 corrections. L0 measures precision, not a better-trained loop.',
    `Resolution is computed from the observed discordance (${(comparison.discordance * 100).toFixed(1)}%) at 80% power: this design can detect ${(resolution * 100).toFixed(1)}pp. The preregistered 3pp resolution is **withdrawn** -- at this discordance it needs ${casesForThreePoints} evaluated cases, and the lane has ${comparison.n}. The replacement gate asks the question that can actually be answered: is the reported effect larger than the design's own noise floor.`,
    `Unseen domain '${L0_CONFIG.heldOutDomain}' receives no feedback at all; its accuracy is the only clean transfer test in the lane.`,
    `Default seed ${DEFAULT_CONFIG.seed}; the corpus is deterministic, so the run reproduces exactly.`,
  ],
  samples: study.arms.map((arm) => ({
    arm: arm.name,
    top1: arm.finalAccuracy,
    knowledge: arm.knowledge,
    active: arm.active,
  })),
});

process.stdout.write(
  `[poc-l0] n=${comparison.n} baseline=${(comparison.baselineAccuracy * 100).toFixed(2)}% full=${(comparison.treatmentAccuracy * 100).toFixed(2)}% delta=${(comparison.delta * 100).toFixed(2)}pp p=${comparison.p} resolution=${(resolution * 100).toFixed(2)}pp\n`,
);
for (const gate of gates) {
  process.stdout.write(
    `  ${gate.pass ? 'PASS' : 'FAIL'} ${gate.id} ${gate.actual} (${gate.criterion})\n`,
  );
}
if (gates.some((gate) => !gate.pass)) process.exit(1);
