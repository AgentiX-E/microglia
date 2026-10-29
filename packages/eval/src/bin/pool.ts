/**
 * POC: what was in the pool, and what that allows the next step to be.
 *
 * Reads `<results>/poc-sota-bird.json` and prints the R7.0 measurement: how many distinct execution
 * results each question's draws produced, how the oracle ceiling decomposes, and every execution
 * signal priced alone against the base rate of taking the first draw.
 *
 * It exists as a command rather than as a chart somebody draws by hand because every number in this
 * project is supposed to be reproducible from the artefact, and a pool read once in a notebook is a
 * number nobody can check. `POC_RESULT_DIR` follows the same rule as every other lane, so the
 * workflow can run this beside the attribution step.
 *
 * It prints four things and refuses a fifth: when the pool lands between the pre-registered bars it
 * says so instead of rounding to whichever answer the next dispatch would prefer.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { poolFromArtifact, poolReport, type ArtifactPoolCase } from '@agentix-e/microglia-eval';

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
  const { questions, draws } = poolFromArtifact(artifact.per_case, artifact.config?.arms ?? []);
  if (questions.length === 0) {
    process.stdout.write(
      '[pool] no pool in this artefact: none of the sampling arms ran, so there is nothing to describe\n',
    );
    return;
  }

  const report = poolReport(questions, draws);
  const { summary } = report;
  process.stdout.write(
    `[pool] ${summary.questions} question(s) × ${draws} draws = ${summary.candidates} candidate(s); ` +
      `${summary.signed} signed, ${summary.unsigned} with no query\n` +
      `[pool] distinct answers per question: mean ${summary.distinctMean.toFixed(2)}, ` +
      `median ${summary.distinctMedian} (${report.distinctShare.toFixed(2)} of the draws)\n` +
      `[pool] histogram ${JSON.stringify(summary.distinctHistogram)}\n` +
      `[pool] oracle ${summary.oracle}, first draw ${summary.first}, ceiling worth ` +
      `${summary.ceilingOnly} question(s) = ${report.ceilingPp.toFixed(2)}pp; ` +
      `${summary.uniqueCorrect} unique / ${summary.sharedCorrect} shared / ${summary.noneRight} none\n` +
      `[pool] verdict ${report.verdict.toUpperCase()} on the pre-registered bars ` +
      `(wide >= 0.50 of the draws, narrow <= 0.33)\n`,
  );
  for (const reading of report.signals) {
    process.stdout.write(
      `[pool] ${reading.signal.padEnd(15)} top-pick ${(reading.accuracy * 100).toFixed(1)}% of ` +
        `${reading.eligible} question(s), AUC ${reading.auc.toFixed(3)} ` +
        `[${reading.aucLow.toFixed(3)}, ${reading.aucHigh.toFixed(3)}], ${reading.pairs} pair(s)\n`,
    );
  }
  // No verdict here on purpose. Which of these may rank anything is decided once, by the gate step
  // that runs next, under a bar that corrects for six tests and floors the standard error. A second
  // verdict printed from this file could disagree with it, and a reader would have no way to tell
  // which one the project meant.
  process.stdout.write(
    '[pool] the signals above are priced, not licensed: the gate step decides which may rank anything\n',
  );
}

main();
