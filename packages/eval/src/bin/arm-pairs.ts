/**
 * Pair every control arm against `full` in an artefact that already exists.
 *
 * The lane computes this itself from now on (`artefacts.arm_pairs`), but every
 * report published before that field existed described a control by its delta
 * against `none` - and the difference between two deltas is a point estimate with no
 * interval. Two intervals around a shared baseline say nothing about the difference
 * between the arms, which is how a comparison in iteration 55 ended up wrong by a
 * factor of two.
 *
 * Reading a committed artefact is what makes those older reports auditable rather
 * than merely quotable. Association and pairing only: the same questions, two arms,
 * paired per question.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { armPairsAgainstFull } from '@agentix-e/microglia-eval';

type CaseRow = {
  readonly correct: boolean;
  readonly arms?: Readonly<Record<string, boolean | undefined>>;
};

type Artifact = {
  readonly per_case: readonly CaseRow[];
  readonly generated_at?: string;
  readonly n?: { readonly eval?: number };
};

const RESULTS = process.env['POC_RESULT_DIR'] ?? join(process.cwd(), 'eval', 'results');

function main(): void {
  const artifact = JSON.parse(
    readFileSync(join(RESULTS, 'poc-sota-bird.json'), 'utf8'),
  ) as Artifact;

  const pairs = armPairsAgainstFull(
    artifact.per_case.map((row) => ({ full: row.correct, arms: row.arms ?? {} })),
  );

  const output = {
    id: 'poc-sota-arm-pairs',
    source_artifact: 'poc-sota-bird.json',
    source_generated_at: artifact.generated_at ?? null,
    n: artifact.per_case.length,
    // `deltaPp` is `arm - full`. Negative means the control did worse than the
    // treatment, so a control that costs nothing is evidence about the mechanism
    // rather than about the retrieval.
    pairs,
  };
  writeFileSync(join(RESULTS, 'poc-sota-arm-pairs.json'), `${JSON.stringify(output, null, 2)}\n`);

  process.stdout.write(`[arm-pairs] ${pairs.length} control arm(s) against full\n`);
  for (const pair of pairs) {
    process.stdout.write(
      `[arm-pairs] ${pair.arm.padEnd(12)} delta ${pair.deltaPp.toFixed(2)}pp ` +
        `[${pair.ciLowPp.toFixed(2)}, ${pair.ciHighPp.toFixed(2)}] p=${pair.p.toFixed(4)} ` +
        `n=${pair.n} lost=${pair.lost} gained=${pair.gained}\n`,
    );
  }
}

main();
