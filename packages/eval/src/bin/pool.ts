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
import { poolReport, type PoolReportQuestion } from '@agentix-e/microglia-eval';

type PoolRow = {
  readonly draw: number;
  readonly correct: boolean;
  readonly resultKey: number;
  readonly signature: {
    readonly failed: boolean;
    readonly empty: boolean;
    readonly rowCount: number;
    readonly columnCount: number;
    readonly nullShare: number;
    readonly duplicateShare: number;
    readonly numericOnly: boolean;
    readonly scalar: boolean;
  } | null;
};

type CaseRow = {
  readonly id: string;
  readonly question: string;
  readonly evidence?: string;
  readonly pool: readonly PoolRow[] | null;
};

type Artifact = {
  readonly per_case: readonly CaseRow[];
  readonly config?: { readonly arms?: readonly string[] };
  readonly generated_at?: string;
};

const RESULTS = process.env['POC_RESULT_DIR'] ?? join(process.cwd(), 'eval', 'results');

const PLURAL = /\b(each|every|list|all|per|top\s+\d+|bottom\s+\d+)\b/i;
const COUNT = /\b(how many|number of|count)\b/i;
const AVERAGE = /\b(average|mean|ratio|percentage|percent|proportion|share)\b/i;
const MISSING = /\b(no|not|none|never|without|missing|absent)\b/i;
const DISTINCT = /\b(distinct|unique)\b/i;

/**
 * The question's shape, recomputed from the artefact rather than read from it.
 *
 * The shape is a pure function of the question text and its evidence, both of which the artefact
 * carries, so recomputing keeps the recorded pool a record of *candidates* and not of an
 * interpretation. If the reader changes, the pool stays the same and the reading changes with the
 * code — which is the direction that lets a past run be re-analysed.
 */
function shapeOf(question: string, evidence: string): PoolReportQuestion['shape'] {
  const text = `${question} ${evidence}`;
  return {
    wantsMany: PLURAL.test(text),
    wantsCount: COUNT.test(text),
    wantsAverage: AVERAGE.test(text),
    wantsMissing: MISSING.test(text),
    wantsDistinct: DISTINCT.test(text),
  };
}

/** Draws the run took, read from the arm names, because a three-draw run is not a five-draw one. */
function drawsOf(artifact: Artifact): number {
  let most = 0;
  for (const arm of artifact.config?.arms ?? []) {
    const match = /^sample-(\d+)/.exec(arm);
    if (match === null) continue;
    const n = Number(match[1]);
    if (Number.isInteger(n) && n > most) most = n;
  }
  return most;
}

function main(): void {
  const artifact = JSON.parse(
    readFileSync(join(RESULTS, 'poc-sota-bird.json'), 'utf8'),
  ) as Artifact;
  const draws = drawsOf(artifact);
  const questions: PoolReportQuestion[] = [];
  for (const row of artifact.per_case) {
    if (row.pool === null || row.pool.length === 0) continue;
    questions.push({
      id: row.id,
      shape: shapeOf(row.question, row.evidence ?? ''),
      candidates: row.pool.map((candidate) => ({
        draw: candidate.draw,
        correct: candidate.correct,
        resultKey: candidate.resultKey,
        signature: candidate.signature,
      })),
    });
  }
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
  process.stdout.write(
    report.shortlist.length === 0
      ? '[pool] no signal clears one half on its lower bound, so no composite may be built from them\n'
      : `[pool] shortlist ${report.shortlist.join(', ')} (lower bound above one half)\n`,
  );
}

main();
