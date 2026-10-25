/**
 * L4 — τ²-bench, pass^4, against ALTK-Evolve on the same split.
 *
 * Three inputs, in order of preference, because they answer three different
 * questions and only one of them needs the environment:
 *
 *   TAU_RESULTS  a recorded τ² result document. Re-scores a run that already
 *                happened, so the reader and the gates can be exercised on a
 *                machine that cannot run an agent.
 *   TAU_DRIVER   a module exporting `run()`. Installs the agent, runs the split,
 *                and returns the estimator's input itself.
 *   neither      not-run. A missing environment is not a failed gate, and it must
 *                not look like one in the record.
 *
 * A fourth outcome is *not* the same as not-run: a document that parsed but
 * cannot be scored (a partial grid, an unscored denominator) is a refusal, exits
 * non-zero, and names the reason. That is the difference between "we could not
 * measure" and "we measured something invalid".
 */
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  L4ParseError,
  comparePaired,
  compareToPublished,
  l4Verdict,
  meanPassAtK,
  parseTauResults,
  perTaskRows,
  toPassAtK,
  type PassAtKInput,
} from '@agentix-e/microglia-eval';
import { writeResult } from './lib.js';

const PUBLISHED = 0.575; // ALTK-Evolve, τ²-retail, pass^4 on the same split.
const BAR = 0.05;
const K = 4;
const MIN_TASKS = 60;

/**
 * An environment variable that a workflow did not set.
 *
 * `vars.TAU_RESULTS` expands to the empty string when the variable does not exist,
 * so `process.env.TAU_RESULTS` is `''` rather than `undefined`. Reading that as a
 * path made the lane try to open `results.json` in the working directory and fail
 * with ENOENT — a missing variable reported as a filesystem bug.
 */
function envPath(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value.trim() === '' ? undefined : value;
}

const resultsPath = envPath('TAU_RESULTS');
const driver = envPath('TAU_DRIVER');
/**
 * Another arm's artefact, for a paired comparison.
 *
 * Two means are not a comparison: they differ by the memory, by the day, and by
 * whatever the endpoint was doing. With the per-task results of both arms, the same
 * tasks can be paired and the difference gets an interval and a p-value. Optional,
 * because an arm can be measured before its partner exists.
 */
const referencePath = envPath('TAU_REFERENCE');

/** A directory form keeps its document in `results.json`; a file form is itself. */
async function readDocument(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return readFile(join(path, 'results.json'), 'utf8');
  }
}

async function notRun(reason?: string): Promise<never> {
  await writeResult({
    id: 'poc-l4',
    title: 'L4 — τ²-bench pass^4 (not run: no environment)',
    ranAt: new Date().toISOString(),
    model: 'none',
    n: 0,
    calls: 0,
    metrics: {
      status_not_run: 1,
      published_pass4: PUBLISHED,
      bar: BAR,
      k: K,
      ...(reason === undefined ? {} : { status_driver_missing: 1 }),
    },
    notes: [
      'The metric layer is live (passk.ts) and so is the result reader (l4.ts, tested against both storage forms upstream ships).',
      'No result is claimed. τ²-retail and τ²-airline need a tool-calling sandbox and a user simulator; this lane reports not-run rather than a zero it did not measure.',
      'Set TAU_RESULTS to a recorded result document to re-score one, or TAU_DRIVER to a module exporting run(): Promise<readonly PassAtKInput[]> to run a split.',
      ...(reason === undefined ? [] : [reason]),
    ],
  });
  process.stdout.write(
    `[poc-l4] not-run: ${reason ?? 'neither TAU_RESULTS nor TAU_DRIVER is set'}\n`,
  );
  process.exit(0);
}

/**
 * Refuse a run that cannot be scored, and say why.
 *
 * The exit code is non-zero on purpose: a partial grid is a defective run, not a
 * missing environment, and a lane that exited 0 here would appear in the record
 * as a run that happened and produced nothing.
 */
async function refuse(error: L4ParseError, source: string): Promise<never> {
  await writeResult({
    id: 'poc-l4',
    title: 'L4 — τ²-bench pass^4 (refused: the run cannot be scored)',
    ranAt: new Date().toISOString(),
    model: process.env['TAU_MODEL'] ?? 'unknown',
    n: 0,
    calls: 0,
    metrics: { status_refused: 1, published_pass4: PUBLISHED, bar: BAR, k: K },
    notes: [
      `Refused with reason \`${error.reason}\`: ${error.message}`,
      `Source: ${source}. A refused run is neither a zero nor a not-run: the split was measured and cannot be scored as specified.`,
    ],
  });
  process.stderr.write(`[poc-l4] refused (${error.reason}): ${error.message}\n`);
  process.exit(1);
}

type Measurement = {
  readonly tasks: readonly PassAtKInput[];
  readonly unscored: readonly string[];
  readonly domain?: string;
  readonly format: string;
  readonly inferredTrials: number;
};

async function measureFromResults(path: string): Promise<Measurement> {
  let run;
  try {
    run = parseTauResults(await readDocument(path));
    const scored = toPassAtK(run, K);
    return {
      tasks: scored.tasks,
      unscored: scored.unscored,
      ...(run.domain === undefined ? {} : { domain: run.domain }),
      format: run.format,
      inferredTrials: run.inferredTrials,
    };
  } catch (error) {
    if (error instanceof L4ParseError) return refuse(error, path);
    throw error;
  }
}

async function measureFromDriver(module: string): Promise<Measurement> {
  // A relative specifier in a dynamic `import` resolves against *this file*, not the
  // working directory, so `./packages/eval/src/bin/tau2-driver.ts` - the obvious way
  // to name a driver in a workflow - would look for it inside `bin/`. Resolving
  // against the working directory is what a caller means, and it is what the
  // environment variable's documentation says.
  const specifier =
    module.startsWith('.') || module.startsWith('/') ? pathToFileURL(resolve(module)).href : module;
  let loaded: { run: () => Promise<readonly PassAtKInput[]> };
  try {
    loaded = (await import(specifier)) as { run: () => Promise<readonly PassAtKInput[]> };
  } catch (error) {
    // A driver that cannot be *resolved* is an absent environment, not a failed
    // measurement: the variable names a module that is not there. A driver that
    // loads and then throws is the opposite, and propagates.
    if ((error as { code?: string }).code === 'ERR_MODULE_NOT_FOUND') {
      await notRun(
        `TAU_DRIVER names '${module}', which does not exist. The variable is set, so this run reports not-run rather than a zero: an environment that cannot be reached is not a measurement that failed.`,
      );
    }
    throw error;
  }
  return { tasks: await loaded.run(), unscored: [], format: 'driver', inferredTrials: 0 };
}

if (resultsPath === undefined && driver === undefined) await notRun();

const source = resultsPath ?? (driver as string);
const measured =
  resultsPath === undefined ? await measureFromDriver(driver as string) : await measureFromResults(resultsPath);

const mean = meanPassAtK(measured.tasks);
const compared = compareToPublished(mean, PUBLISHED, BAR);
const verdict = l4Verdict({ tasks: measured.tasks, published: PUBLISHED, bar: BAR, minTasks: MIN_TASKS });
type ReferenceTask = { readonly id: string; readonly passed_all: boolean };
let paired: { delta: number; low: number; high: number; p: number; n: number } | undefined;
if (referencePath !== undefined) {
  const document = JSON.parse(await readFile(referencePath, 'utf8')) as { per_task?: ReferenceTask[] };
  const before = new Map((document.per_task ?? []).map((entry) => [entry.id, entry.passed_all]));
  const common = measured.tasks.filter((task) => task.taskId !== undefined && before.has(task.taskId));
  if (common.length > 0) {
    const comparison = comparePaired(
      common.map((task) => before.get(task.taskId as string) === true),
      common.map((task) => task.successes === task.trials),
      7,
      10_000,
    );
    paired = {
      delta: comparison.delta * 100,
      low: comparison.deltaCI.low * 100,
      high: comparison.deltaCI.high * 100,
      p: comparison.p,
      n: comparison.n,
    };
  }
}

const gates = [
  { id: 'l4-pass4', pass: compared.meets, actual: mean, criterion: `>= published + ${BAR}` },
  {
    id: 'l4-paired',
    pass: paired === undefined ? true : paired.delta >= 0 && paired.p < 0.05,
    actual: paired === undefined ? 'no reference arm' : `${paired.delta.toFixed(2)}pp (p=${paired.p.toFixed(4)})`,
    criterion: 'against the same agent without the memory: delta >= 0 at p<0.05',
  },
  {
    id: 'l4-coverage',
    pass: measured.tasks.length >= MIN_TASKS,
    actual: measured.tasks.length,
    criterion: `>= ${MIN_TASKS} tasks`,
  },
  // A score is only a split result if the whole grid was scored: the reader drops
  // infrastructure failures from the denominator, so the count has to be stated.
  {
    id: 'l4-fully-scored',
    pass: measured.unscored.length === 0,
    actual: measured.unscored.length,
    criterion: '= 0 unscored tasks',
  },
];

await writeResult({
  id: 'poc-l4',
  title: 'L4 — τ²-bench pass^4 against ALTK-Evolve',
  ranAt: new Date().toISOString(),
  model: process.env['TAU_MODEL'] ?? 'unknown',
  n: measured.tasks.length,
  calls: 0,
  metrics: {
    pass4: mean,
    published_pass4: PUBLISHED,
    delta: compared.delta,
    tasks: measured.tasks.length,
    unscored_tasks: measured.unscored.length,
    min_tasks: MIN_TASKS,
    ...(paired === undefined ? {} : { paired_delta_pp: paired.delta, paired_ci_low_pp: paired.low,
      paired_ci_high_pp: paired.high, paired_p: paired.p, paired_n: paired.n }),
    k: K,
    inferred_trials: measured.inferredTrials,
    gates_passed: gates.filter((gate) => gate.pass).length,
  },
  notes: [
    `Source: ${source} (${measured.format} form). Two arms must share the split; the reference number is ALTK-Evolve on τ²-retail.`,
    `pass^4 is the unbiased C(c,4)/C(n,4) mean over ${measured.tasks.length} tasks, with success defined as \`reward == 1.0\` exactly, as upstream scores it.`,
    verdict.coversSplit
      ? `The split covers the minimum: ${measured.tasks.length} scored tasks.`
      : `The split is short: ${measured.tasks.length} scored tasks against a minimum of ${MIN_TASKS}. Short splits and missed bars fail separately.`,
  ],
  // Per-task outcomes, so the other arm can be paired against this artefact instead of
  // compared to its mean. Written by every run, used by `pnpm eval:l4-pair`.
  per_task: perTaskRows(measured.tasks),
  samples: gates,
});
for (const gate of gates) {
  process.stdout.write(`  ${gate.pass ? 'PASS' : 'FAIL'} ${gate.id} ${gate.actual} (${gate.criterion})\n`);
}
if (gates.some((gate) => !gate.pass)) process.exit(1);
