/**
 * POC: which execution signals are allowed to rank anything, and what the composite they form is
 * worth on the pool that was already recorded.
 *
 * This is R7.2a's gate, run as a command. It costs no model calls: the candidates exist in the
 * artefact, the signals are pure functions of their signatures, and the gate is arithmetic. That is
 * the whole point of putting it before R7.2b — a stage that has shipped eleven composites nobody
 * could attribute should be able to say, before spending anything, whether its parts separate right
 * answers from wrong ones at all.
 *
 * It prints the per-signal verdicts, then the composite's accuracy beside the first-draw baseline on
 * the same questions. When nothing survives it says so and stops: a composite of nothing is not a
 * weak verifier, it is the baseline with extra steps.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ALPHA,
  Z_BAR,
  compositeGate,
  poolFromArtifact,
  readSubsets,
  type ArtifactPoolCase,
  type SignalName,
} from '@agentix-e/microglia-eval';

type Artifact = {
  readonly per_case: readonly ArtifactPoolCase[];
  readonly config?: { readonly arms?: readonly string[] };
  readonly generated_at?: string;
};

const RESULTS = process.env['POC_RESULT_DIR'] ?? join(process.cwd(), 'eval', 'results');

function main(): void {
  const artifact = JSON.parse(
    readFileSync(join(RESULTS, 'poc-sota-bird.json'), 'utf8'),
  ) as Artifact;
  const { questions, recorded } = poolFromArtifact(artifact.per_case, artifact.config?.arms ?? []);
  if (questions.length === 0) {
    process.stdout.write(
      recorded
        ? '[signals] no pool in this artefact: the gate needs candidates, and this run produced none\n'
        : '[signals] this artefact predates the pool field: no signal can be gated on a pool the run ' +
          'could not record\n',
    );
    return;
  }

  const gate = compositeGate(questions);
  process.stdout.write(
    `[signals] ${gate.eligible} of ${questions.length} question(s) offered a choice\n` +
      `[signals] gate: AUC - 0.5 > ${Z_BAR} SE, Holm-corrected across six at alpha ${ALPHA}\n`,
  );
  for (const verdict of gate.verdicts) {
    process.stdout.write(
      `[signals] ${verdict.signal.padEnd(15)} AUC ${verdict.auc.toFixed(3)} ` +
        `SE ${verdict.se.toFixed(3)} z ${verdict.z.toFixed(2)} ` +
        `p ${verdict.p.toFixed(4)} holm ${verdict.holm.toFixed(4)} ` +
        `${verdict.survives ? 'KEPT' : 'removed'}\n`,
    );
  }
  process.stdout.write(
    gate.verdict === 'inert'
      ? '[signals] no signal survives its own gate: the composite is the baseline, and R7.2b is ' +
          'cancelled before it spends anything\n'
      : `[signals] composite of ${gate.kept.join(', ')}: ` +
          `${(gate.compositeAccuracy * 100).toFixed(1)}% of ${gate.eligible} question(s), ` +
          `first draw ${(gate.baselineAccuracy * 100).toFixed(1)}%, ` +
          `delta ${gate.deltaPp.toFixed(2)}pp ` +
          `(+${gate.gained} / -${gate.lost})\n` +
          `[signals] removed ${gate.inert.length} signal(s): ${gate.inert.join(', ')}\n`,
  );
  if (gate.verdict === 'inert') return;

  // Two families, one table: dropping a member says whether it earns its place, keeping only one
  // says whether the set is worth more than its best part. They answer different questions and the
  // composite has never been able to answer either, because it only ever reported its total.
  const plans: { readonly label: string; readonly signals: readonly SignalName[] }[] = [
    { label: `all of ${gate.kept.join('+')}`, signals: gate.kept },
    ...gate.kept.map((signal) => ({
      label: `without ${signal}`,
      signals: gate.kept.filter((name) => name !== signal),
    })),
    ...gate.kept.map((signal) => ({ label: `only ${signal}`, signals: [signal] })),
  ];
  const rows = readSubsets(questions, plans.map((plan) => plan.signals));
  process.stdout.write(
    `[signals] subsets, in sample on these ${gate.eligible} question(s) and against the first ` +
      `draw. A description of where the weight is, not a test of it.\n`,
  );
  for (const [at, plan] of plans.entries()) {
    const row = rows[at];
    if (row === undefined) continue;
    process.stdout.write(
      `[signals]   ${plan.label.padEnd(52)} ` +
        `${(row.accuracy * 100).toFixed(1)}% ` +
        `${row.deltaPp >= 0 ? '+' : ''}${row.deltaPp.toFixed(2)}pp ` +
        `(+${row.gained} / -${row.lost})\n`,
    );
  }
}

main();
