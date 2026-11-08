/**
 * Read a downloaded pair on the endpoint that can resolve it, and say whether the two endpoints
 * agree.
 *
 * `pass^4` is the number the field reports and the number the published bar is stated in, so it
 * stays the headline. It is also a sign test on a binary outcome, and on this bench that interval is
 * about ±15pp wide on 57 tasks — twelve times the sample retail has would be needed to see a
 * three-point effect. The per-task pass rate is already in the same artefact (`per_task.successes`
 * over `per_task.trials`), costs nothing, and is roughly three times tighter.
 *
 * This prints both, side by side, and then prints whether they point the same way. It does not
 * choose. An arm that lifts ten near-misses to perfect while lowering fourteen other tasks reads
 * positive on one endpoint and negative on the other, and that disagreement is the finding rather
 * than a problem with the arithmetic.
 *
 * Deterministic: it reads two committed files and computes. Nothing re-runs, nothing is called.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  endpointsAgree,
  pairedRateDelta,
  tasksForEffectPp,
  type TaskRate,
} from '@agentix-e/microglia-eval';

type ArmFile = {
  readonly id?: string;
  readonly metrics?: { readonly pass4?: number; readonly tasks?: number; readonly k?: number };
  readonly per_task?: readonly { readonly id?: string; readonly successes?: number; readonly trials?: number }[];
};

type PairFile = {
  readonly comparison?: {
    readonly paired?: number;
    readonly deltaPp?: number;
    readonly ciLowPp?: number;
    readonly ciHighPp?: number;
    readonly gained?: number;
    readonly lost?: number;
    readonly p?: number;
  };
  readonly resolution?: {
    readonly standardErrorPp?: number;
    readonly minDetectablePp?: number;
    /** What the binary endpoint's own sample would need for a three-point effect. */
    readonly tasksForThreePp?: number;
  };
};

function ratesOf(file: ArmFile): TaskRate[] {
  const rows = file.per_task ?? [];
  const out: TaskRate[] = [];
  for (const row of rows) {
    if (typeof row.id !== 'string' || typeof row.successes !== 'number' || typeof row.trials !== 'number') {
      continue;
    }
    out.push({ id: row.id, successes: row.successes, trials: row.trials });
  }
  return out;
}

function pp(value: number | null | undefined, width = 8): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'.padStart(width);
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  return `${sign}${Math.abs(value).toFixed(2)}`.padStart(width);
}

/** Every `arms/<name>/poc-l4.json` under a directory, in name order. */
function armsIn(root: string): { name: string; file: ArmFile }[] {
  const arms = join(root, 'arms');
  if (!existsSync(arms)) return [];
  const out: { name: string; file: ArmFile }[] = [];
  for (const name of readdirSync(arms).sort()) {
    const path = join(arms, name, 'poc-l4.json');
    if (!existsSync(path)) continue;
    out.push({ name, file: JSON.parse(readFileSync(path, 'utf8')) as ArmFile });
  }
  return out;
}

function main(argv: readonly string[]): number {
  const at = argv.indexOf('--dir');
  const root = at === -1 ? 'eval/results' : (argv[at + 1] ?? '');
  const arms = armsIn(root);
  if (arms.length < 2) {
    process.stderr.write(
      `expected at least two arms under ${join(root, 'arms')}/<name>/poc-l4.json, found ${arms.length}\n`,
    );
    return 1;
  }
  const pairPath = join(root, 'poc-l4-pair.json');
  const pair: PairFile = existsSync(pairPath)
    ? (JSON.parse(readFileSync(pairPath, 'utf8')) as PairFile)
    : {};

  // The first arm is the treatment and the second the control, which is the order the runner writes
  // and the order the pair file's `comparison` is signed in.
  const treatment = arms[0] as { name: string; file: ArmFile };
  const control = arms[1] as { name: string; file: ArmFile };
  const rate = pairedRateDelta(ratesOf(treatment.file), ratesOf(control.file));

  const binary = pair.comparison ?? {};
  const binaryPp = binary.deltaPp ?? null;
  const binarySe = pair.resolution?.standardErrorPp ?? null;

  process.stdout.write(`arms: ${treatment.name} − ${control.name}  (${root})\n`);
  process.stdout.write(`paired tasks: ${String(rate.pairs)}  rate moves: ${String(rate.up)} up, ${String(rate.down)} down, ${String(rate.tied)} tied\n\n`);
  process.stdout.write('endpoint          delta      se       95% interval         MDE(80%)  tasks@3pp\n');
  process.stdout.write(
    `pass^4 (binary) ${pp(binaryPp)}${pp(binarySe)}  ` +
      `[${pp(binary.ciLowPp, 7)},${pp(binary.ciHighPp, 7)}]  ` +
      `${pp(pair.resolution?.minDetectablePp)}  ${String(pair.resolution?.tasksForThreePp ?? '—')}\n`,
  );
  process.stdout.write(
    `pass rate       ${pp(rate.deltaPp)}${pp(rate.sePp)}  ` +
      `[${pp(rate.ciLowPp, 7)},${pp(rate.ciHighPp, 7)}]  ` +
      `${pp(rate.minDetectablePp)}  ${String(tasksForEffectPp(rate, 3) ?? '—')}\n\n`,
  );

  if (binaryPp !== null) {
    const agreement = endpointsAgree(binaryPp, rate.deltaPp);
    process.stdout.write(
      `endpoints ${agreement.agree ? 'agree' : 'CONFLICT — the two readings point opposite ways'}\n` +
        `  pass^4 ${pp(binaryPp)}: ${String(binary.gained ?? 0)} gained, ${String(binary.lost ?? 0)} lost, ` +
        `p = ${(binary.p ?? 0).toFixed(4)}\n` +
        `  rate   ${pp(rate.deltaPp)}: ${String(rate.up)} up, ${String(rate.down)} down — ` +
        `a quarter of a trial counts as a quarter\n`,
    );
    process.stdout.write(
      '\nA conflict is not a defect in either reading: pass^4 asks whether the task became reliable,\n' +
        'the rate asks whether the arm moved it at all. Neither direction is claimed from this file.\n',
    );
  }
  return 0;
}

process.exitCode = main(process.argv.slice(2));
