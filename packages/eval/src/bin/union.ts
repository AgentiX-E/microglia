/**
 * POC: what a chooser that always picked the right generator would have scored.
 *
 * R7.1's claim is that the candidate pool is the constraint, and its test is the union over the
 * generator arms — three procedures on the same questions, scored as if the chooser were perfect. This
 * command prints that number beside the bars that were fixed before the dispatch, so the reading is
 * taken from the artefact rather than assembled by hand from a table somebody typed.
 *
 * It exits zero when a criterion fails. A refuted criterion is the stage's result, not a broken step,
 * and a command that failed the job would make the honest outcome look like an infrastructure problem.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The bars, as pre-registered in `ROADMAP.md` R7.1. */
const CEILING_BAR_PP = 2;
const DISAGREEMENT_BAR = 0.4;

type ArmRow = {
  readonly arm: string;
  readonly n: number;
  readonly accuracy: number;
  readonly delta_pp: number;
  readonly ci_low_pp: number;
  readonly ci_high_pp: number;
  readonly p_value: number;
};

type Artifact = {
  readonly metrics?: {
    readonly arms?: readonly ArmRow[];
    readonly union?: {
      readonly arms: readonly string[];
      readonly questions: number;
      readonly per_arm: Record<string, number>;
      readonly union: number;
      readonly control: number;
      readonly ceiling_pp: number;
      readonly disagreement_share: number;
      readonly dominant: string | null;
      readonly distinct: {
        readonly measured: boolean;
        readonly arms: number;
        readonly mean: number;
        readonly median: number;
        readonly share: number;
        readonly verdict: 'wide' | 'narrow' | 'between';
        readonly histogram: Record<string, number>;
      };
    } | null;
  };
  readonly config?: { readonly arms?: readonly string[] };
};

const RESULTS = process.env['POC_RESULT_DIR'] ?? join(process.cwd(), 'eval', 'results');

function verdict(pass: boolean): string {
  return pass ? 'PASS' : 'REFUTED';
}

function main(): void {
  const artifact = JSON.parse(
    readFileSync(join(RESULTS, 'poc-sota-bird.json'), 'utf8'),
  ) as Artifact;
  const union = artifact.metrics?.union ?? null;
  if (union === null) {
    process.stdout.write(
      '[union] no union in this artefact: the generator arms did not all run, and a union over one ' +
        'procedure is that procedure\n',
    );
    return;
  }

  const perArm = artifact.metrics?.arms ?? [];
  process.stdout.write(
    `[union] ${union.questions} question(s) over ${union.arms.length} arm(s): ` +
      `${union.arms.join(', ')}; control none ${(union.control * 100).toFixed(2)}%\n`,
  );
  for (const arm of union.arms) {
    const row = perArm.find((entry) => entry.arm === arm);
    const share = union.per_arm[arm] ?? 0;
    process.stdout.write(
      `[union] ${arm.padEnd(15)} ${(share * 100).toFixed(2)}% of the question(s)` +
        (row === undefined
          ? '\n'
          : `, delta ${row.delta_pp.toFixed(2)}pp ` +
            `[${row.ci_low_pp.toFixed(2)}, ${row.ci_high_pp.toFixed(2)}] p=${row.p_value.toFixed(4)}\n`),
    );
  }
  const distinct = union.distinct;
  process.stdout.write(
    `[union] union ${(union.union * 100).toFixed(2)}% = ${union.ceiling_pp.toFixed(2)}pp over the ` +
      `control; disagreement ${union.disagreement_share.toFixed(4)}; ` +
      `dominant ${union.dominant ?? 'none'}\n` +
      // The pool the ceiling was computed over. A ceiling over four arms that all execute to one
      // answer is a ceiling of agreement, and a selector has nothing to rank in it however large the
      // number looks.
      (distinct.measured
        ? `[union] distinct answers per question: mean ${distinct.mean.toFixed(2)}, ` +
          `median ${distinct.median} of ${distinct.arms} arm(s) ` +
          `(${distinct.share.toFixed(2)}), ${distinct.verdict.toUpperCase()}; ` +
          `histogram ${JSON.stringify(distinct.histogram)}\n`
        : '[union] no result keys in this artefact: the generator pool cannot be described, and an ' +
          'undescribed pool is not a wide one\n') +
      `[union] ceiling >= ${CEILING_BAR_PP.toFixed(2)}pp ${verdict(union.ceiling_pp >= CEILING_BAR_PP)}` +
      `, disagreement >= ${DISAGREEMENT_BAR.toFixed(2)} ${verdict(union.disagreement_share >= DISAGREEMENT_BAR)}` +
      `, no dominant generator ${verdict(union.dominant === null)}` +
      `, pool not collapsed ${verdict(distinct.measured && distinct.verdict !== 'narrow')}\n`,
  );
}

main();
