/**
 * Pair two named arms inside an artefact that already exists.
 *
 * `arm-pairs.ts` pairs every control against `full`, which is the right default because `full` is the
 * arm the lane ships. It is the wrong tool for a design whose registered contrast is between two
 * controls: R25 asks whether a per-question admission beats a one-slot truncation, so both sides of the
 * question are arms, and pairing each of them against `full` and subtracting the two deltas would be a
 * point estimate with no interval — the mistake this record has already had to withdraw once.
 *
 * The computation is here rather than in a notebook for the same reason every other derived number is:
 * an artefact that cannot be re-derived from a committed file is a quotation, not evidence. The tool
 * reads, pairs, and writes; it makes no call and knows nothing about the lane.
 *
 *   pnpm eval:arm-contrast --left full-accepted --right full-one
 *
 * The artefact it reads defaults to whichever split's file is present, and `SOTA_ARTEFACT` overrides it
 * the way it does for every other reader in this package.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { armPairBetween, parseContrastArgs, type ArmOutcomes } from '@agentix-e/microglia-eval';
import { birdArtefactPath } from './lib.js';

type CaseRow = {
  readonly correct: boolean;
  readonly withoutMemoryCorrect?: boolean;
  readonly arms?: Readonly<Record<string, boolean | undefined>>;
};

type Artifact = {
  readonly per_case: readonly CaseRow[];
  readonly generated_at?: string;
};

const RESULTS = process.env['POC_RESULT_DIR'] ?? join(process.cwd(), 'eval', 'results');

/**
 * One question under every arm it answered.
 *
 * `none` and `full` live in their own columns rather than in `arms`, because that is the shape the lane
 * writes: a control is anything that is not the two arms every run has. Folding them into one map here
 * rather than widening `ArmRow` keeps every existing caller unchanged.
 */
function outcomesOf(row: CaseRow): ArmOutcomes {
  const map: Record<string, boolean | undefined> = { none: row.withoutMemoryCorrect, full: row.correct };
  for (const [name, value] of Object.entries(row.arms ?? {})) map[name] = value;
  return map;
}

function main(): void {
  const requested = parseContrastArgs(process.argv.slice(2));
  const path = birdArtefactPath();
  const artifact = JSON.parse(readFileSync(path, 'utf8')) as Artifact;
  const rows = artifact.per_case.map(outcomesOf);

  const pairs = requested.map(({ left, right }) => {
    const comparison = armPairBetween(rows, left, right);
    if (comparison === undefined) {
      throw new RangeError(`no question answered both '${left}' and '${right}' in ${basename(path)}`);
    }
    return { left, right, ...comparison };
  });

  const output = {
    id: 'poc-arm-contrast',
    source_artifact: basename(path),
    source_generated_at: artifact.generated_at ?? null,
    n: artifact.per_case.length,
    // `deltaPp` is `left - right`, so a positive number means the left arm did better. The field is
    // named after the arm rather than after the direction because `armPairBetween` returns it that
    // way and a second convention in one repository is how a sign gets flipped in a report.
    pairs,
  };
  writeFileSync(join(RESULTS, 'poc-arm-contrast.json'), `${JSON.stringify(output, null, 2)}\n`);

  process.stdout.write(`[arm-contrast] ${pairs.length} pair(s) in ${basename(path)}\n`);
  for (const pair of pairs) {
    process.stdout.write(
      `[arm-contrast] ${pair.left} - ${pair.right}: ${pair.deltaPp.toFixed(2)}pp ` +
        `[${pair.ciLowPp.toFixed(2)}, ${pair.ciHighPp.toFixed(2)}] p=${pair.p.toFixed(4)} ` +
        `n=${pair.n} lost=${pair.lost} gained=${pair.gained}\n`,
    );
  }
}

main();
