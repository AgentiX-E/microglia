/**
 * Pool two dispatches of the same treatment on two domains into one reading.
 *
 * Every lift this lane reports is a few points on 57 held-out tasks, and the 95% half-width at that
 * sample is 12.4–12.8pp — a direction, not a ranking. τ² ships two domains of 114 tasks each and this
 * lane has always run one, so the second domain's held-out split is the same experiment on a different
 * corpus: pooling gives n = 114 at ±9pp and the replication that separates "the mechanism works" from
 * "the mechanism works in retail".
 *
 * What this script will not do is pool two experiments. `poolArms` refuses when the arms differ in the
 * unit distilled, the form asked for, the trace ceiling, the population distilled from or the model
 * that answered, when a task appears in both, and when an arm does not say what it ran. A pool is only
 * worth its arithmetic when the guards pass, and the guards are why this is a module rather than a mean.
 *
 * Usage:
 *   L4_POOL="retail=eval/results/arms/memory/poc-l4.json,airline=/tmp/airline/poc-l4.json" \
 *     pnpm eval:l4-pool
 */
import { existsSync, readFileSync } from 'node:fs';
import { poolArms, poolLine, detectablePp, type PoolArm } from '../l4-pool.js';
import { writeJson } from './lib.js';

type Artefact = {
  readonly model?: string;
  readonly ranAt?: string;
  readonly metrics?: { readonly pass4?: number; readonly tasks?: number; readonly k?: number };
  readonly tau2?: {
    readonly distillUnit?: { readonly unit?: string };
    readonly distillForm?: { readonly form?: string };
    readonly traceClaims?: { readonly ceiling?: number };
    readonly distillScope?: string;
  };
  readonly per_task?: readonly { readonly id: string; readonly passed_all: boolean }[];
};

function load(label: string, path: string): { arm: PoolArm; ranAt?: string; path: string } {
  if (!existsSync(path)) {
    process.stderr.write(`[l4-pool] missing artefact for ${label}: ${path}\n`);
    process.exit(1);
  }
  const doc = JSON.parse(readFileSync(path, 'utf8')) as Artefact;
  if (doc.per_task === undefined || doc.per_task.length === 0) {
    // Per-task outcomes are what a pool is made of. An artefact without them is from a run that
    // predates the field, and pooling "nothing" would report a sample that does not exist.
    process.stderr.write(`[l4-pool] ${label} artefact has no per_task rows: ${path}\n`);
    process.exit(1);
  }
  const unit = doc.tau2?.distillUnit?.unit;
  const form = doc.tau2?.distillForm?.form;
  const ceiling = doc.tau2?.traceClaims?.ceiling;
  const scope = doc.tau2?.distillScope;
  return {
    path,
    ranAt: doc.ranAt,
    arm: {
      label,
      tasks: doc.per_task.map((row) => ({ id: row.id, passedAll: row.passed_all })),
      // Carried only when the artefact carries it: an absent field must reach the guard as absent
      // rather than as a default that makes two different runs look identical.
      ...(unit === undefined ? {} : { unit }),
      ...(form === undefined ? {} : { form }),
      ...(ceiling === undefined ? {} : { traceClaims: ceiling }),
      ...(scope === undefined ? {} : { scope }),
      ...(doc.model === undefined ? {} : { model: doc.model }),
    },
  };
}

const spec = process.env['L4_POOL'] ?? '';
if (spec.trim() === '') {
  process.stderr.write(
    '[l4-pool] L4_POOL is empty: name at least two arms as label=path,label=path\n',
  );
  process.exit(2);
}

const entries = spec
  .split(',')
  .map((part) => part.trim())
  .filter((part) => part !== '')
  .map((part) => {
    const at = part.indexOf('=');
    if (at <= 0) {
      process.stderr.write(`[l4-pool] '${part}' is not label=path\n`);
      process.exit(2);
    }
    return { label: part.slice(0, at), path: part.slice(at + 1) };
  });

const loaded = entries.map((entry) => load(entry.label, entry.path));
const outcome = poolArms(loaded.map((entry) => entry.arm));
process.stdout.write(`[l4-pool] ${poolLine(outcome)}\n`);

if (!outcome.ok) {
  // No artefact on a refusal: a file named `poc-l4-pool` that carries no reading is the shape this
  // repository keeps having to remove, and the sentence is more useful in a log than a document.
  process.exit(1);
}

await writeJson('poc-l4-pool', {
  id: 'poc-l4-pool',
  title: 'L4 — two dispatches of one treatment, pooled into one reading',
  ranAt: new Date().toISOString(),
  arms: loaded.map((entry, index) => ({
    label: entry.arm.label,
    path: entry.path,
    ranAt: entry.ranAt ?? null,
    unit: entry.arm.unit ?? null,
    form: entry.arm.form ?? null,
    model: entry.arm.model ?? null,
    tasks: outcome.reading.arms[index]?.tasks ?? 0,
    pass4: outcome.reading.arms[index]?.pass4 ?? null,
  })),
  pooled: {
    tasks: outcome.reading.tasks,
    pass4: outcome.reading.pass4,
    halfWidth: outcome.reading.halfWidth,
    // The smallest difference two pools of this size could resolve, which is the number a claim of a
    // lift has to clear before it is a claim about the mechanism rather than about the sample.
    detectablePp: detectablePp(outcome.reading),
    domains: outcome.reading.domains,
  },
});
process.stdout.write('[l4-pool] wrote poc-l4-pool.json\n');
