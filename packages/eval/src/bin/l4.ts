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
  meanPassAtK,
  facadePairState,
  isNoMeasurementRefusal,
  notedFacadeArtifact,
  pairedFacadeArtifact,
  pairedVerdict,
  parseTauResults,
  recurrenceGate,
  sampleGates,
  perTaskRows,
  toPassAtK,
  type PassAtKInput,
} from '@agentix-e/microglia-eval';
import type {
  NoMeasurementMarker,
  NotedFacadeReading,
  PairedFacadeReading,
  Tau2ArmRecord,
  TauTrialRow,
} from '@agentix-e/microglia-eval';
import { writeJson, writeResult } from './lib.js';
import { COMPETITOR_PASS4, minTasksOf, scenarioBarOf, sotaLineOf } from '@agentix-e/microglia-eval';

const BAR = 0.05;
const K = 4;
/**
 * The scenario this arm answered, and whether a published number is a bar for it.
 *
 * The lane shipped with one published reference — ALTK-Evolve on τ²-retail — and graded every arm
 * against it. On a second scenario that is a category error rather than a strict bar: the delta
 * would measure the two scenarios. `l4-scenario.ts` holds the rule and its reason.
 */
const SCENARIO = process.env['TAU_TEST_DOMAIN'] ?? process.env['TAU_DOMAIN'] ?? 'retail';
const scenarioBar = scenarioBarOf(SCENARIO);
const MIN_TASKS = minTasksOf(process.env['TAU_MIN_TASKS']);

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
      published_bar_applies: scenarioBar.comparable ? 1 : 0,
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
/**
 * Record a run that was stopped by the pre-flight provider gate.
 *
 * `status_no_measurement` is distinct from `status_not_run`: an endpoint that
 * refused every call is not an environment that was never configured, and a
 * green skip would be exactly the quiet failure R48's first dispatch produced.
 * Exit 0 because nothing was measured, not because something passed.
 */
async function noMeasurement(marker: NoMeasurementMarker): Promise<never> {
  await writeResult({
    id: 'poc-l4',
    title: 'L4 — τ²-bench pass^4 (no measurement: the run stopped before any task was scored)',
    ranAt: new Date().toISOString(),
    model: process.env['TAU_MODEL'] ?? 'unknown',
    n: 0,
    calls: 0,
    metrics: {
      status_no_measurement: marker.status_no_measurement,
      status_not_run: marker.status_not_run,
      published_bar_applies: scenarioBar.comparable ? 1 : 0,
      bar: BAR,
      k: K,
    },
    notes: [
      `The run stopped before any task was scored: ${marker.reason}`,
      `Claim: ${marker.claim}. No pass^4, no paired delta and no revert is produced by this run.`,
      'A stop before measurement is an infrastructure or instrument fact, not a missing environment and not a result.',
    ],
  });
  process.stdout.write(`[poc-l4] no measurement: ${marker.reason}\n`);
  process.exit(0);
}

async function refuse(error: L4ParseError, source: string): Promise<never> {
  await writeResult({
    id: 'poc-l4',
    title: 'L4 — τ²-bench pass^4 (refused: the run cannot be scored)',
    ranAt: new Date().toISOString(),
    model: process.env['TAU_MODEL'] ?? 'unknown',
    n: 0,
    calls: 0,
    metrics: { status_refused: 1, published_bar_applies: scenarioBar.comparable ? 1 : 0, bar: BAR, k: K },
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
  /**
   * What the driver could see, when it exports an `instrument()`.
   *
   * A re-scored results file has no such function: the run it describes happened elsewhere and the
   * counts did not cross back. Absent is therefore the honest value for that path, and it is why the
   * protocol's gates can be graded on a driver run and not on a re-scoring — a difference the artefact
   * states in a field rather than leaving to the reader to notice.
   *
   * The lane does not grade them here. `l4-pair` does, through `tau2GateAudit`, because most of the
   * protocol's gates read a *pair* of arms and one arm's artefact cannot answer them.
   */
  readonly instrumentation?: Tau2ArmRecord;
  /**
   * The evaluated half's episodes, when the driver exports a `trials()`.
   *
   * A re-scored document has them inside the file it read, and the cross-domain reading needs them
   * on both sides of a pair; a run whose driver did not export them writes no ledger, and `l4-pair`
   * reports the transfer family as absent rather than green.
   */
  readonly trialRows?: readonly TauTrialRow[];
  /**
   * One driver run's paired-facade verdict, when the driver exports
   * `pairedFacades()`. Absent on a re-scored document and on every driver
   * before R49; an absent field is a single-facade run, not a failed pair.
   */
  readonly pairedFacades?: PairedFacadeReading;
  /**
   * R53's three-level note record, when the driver exports `notedFacades()`.
   *
   * Absent on a re-scored document and on every driver before R53; an absent field is a
   * run that never varied the note, not a failed three-level arm.
   */
  readonly notedFacades?: NotedFacadeReading;
  /**
   * Where the `unscored` list came from, because an empty list has two meanings.
   *
   * `document` is a results file, where the reader itself counted the nulls. `ids` and `count` are a
   * driver that said so. `unreported` is a driver that exported neither channel: it is not zero, and
   * the artefact has to be able to distinguish "no task was unscored" from "this driver never said".
   */
  readonly unscoredSource?: 'document' | 'ids' | 'count' | 'unreported';
};

/**
 * The unscored tasks of a driver run, and how this file came to know about them.
 *
 * R92 published `pass4 0.7586` over **29 of 40** tasks with `unscored_tasks: 0`. The driver had
 * counted eleven tasks whose episodes all ended in `INFRASTRUCTURE_ERROR`, `scoredArm` had dropped
 * them from the grid — correctly, because a task with no verdict is not a failure — and the count
 * never crossed the module boundary, because this path returned a literal empty list.
 *
 * The consequence was not cosmetic: `l4-fully-scored` read zero and passed, so the artefact
 * certified a complete grid while its own `tau2.unscored` field said eleven. A gate that cannot see
 * the difference between `0` and `not reported` is a green square over a missing quarter of the
 * sample, which is the defect class this repository exists to refuse.
 *
 * Three channels, in order of authority:
 *
 *   1. the driver names them (`unscoredTasks()`): quoted verbatim;
 *   2. the driver counts them (`instrument().unscored`): the count is carried and the ids are
 *      placeholders that say they are placeholders, so no reader mistakes one for a task id;
 *   3. neither: `unreported`, which is not zero.
 */
function unscoredOf(
  loaded: { readonly unscoredTasks?: () => readonly string[] | undefined },
  instrumentation: Tau2ArmRecord | undefined,
): { readonly ids: readonly string[]; readonly source: 'ids' | 'count' | 'unreported' } {
  const named = loaded.unscoredTasks?.();
  if (named !== undefined && named.length > 0) return { ids: named, source: 'ids' };
  const count = instrumentation?.unscored ?? 0;
  if (count > 0) {
    return {
      ids: Array.from({ length: count }, (_, index) => `unidentified/${String(index + 1)}`),
      source: 'count',
    };
  }
  // A driver that answered "none" through either channel has said something; a driver that answered
  // nothing has not.
  if (instrumentation !== undefined) return { ids: [], source: 'count' };
  return { ids: [], source: 'unreported' };
}

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
      unscoredSource: 'document',
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
  let loaded: {
    run: () => Promise<readonly PassAtKInput[]>;
    instrument?: () => Tau2ArmRecord | undefined;
    unscoredTasks?: () => readonly string[] | undefined;
    trials?: () => readonly TauTrialRow[] | undefined;
    pairedFacades?: () => PairedFacadeReading | undefined;
    notedFacades?: () => NotedFacadeReading | undefined;
  };
  try {
    loaded = (await import(specifier)) as {
      run: () => Promise<readonly PassAtKInput[]>;
      instrument?: () => Tau2ArmRecord | undefined;
      unscoredTasks?: () => readonly string[] | undefined;
      trials?: () => readonly TauTrialRow[] | undefined;
      pairedFacades?: () => PairedFacadeReading | undefined;
      notedFacades?: () => NotedFacadeReading | undefined;
    };
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
  let tasks: readonly PassAtKInput[];
  try {
    tasks = await loaded.run();
  } catch (error) {
    // The driver is dynamically imported, so the error's class identity is not
    // shared across the module boundary: the marker's STRUCTURE is the
    // contract. That covers the pre-flight provider refusal and every other
    // stop before measuring (an empty store, an unattestable pair scope), which
    // must not reach a reader as an unhandled stack trace.
    if (isNoMeasurementRefusal(error)) {
      await noMeasurement(error.marker);
    }
    throw error;
  }
  // Read after the run: the function reports what happened, and calling it before would describe a
  // process that had not started.
  const instrumentation = loaded.instrument?.();
  const trialRows = loaded.trials?.();
  const pairedFacades = loaded.pairedFacades?.();
  const notedFacades = loaded.notedFacades?.();
  const unscored = unscoredOf(loaded, instrumentation);
  return {
    tasks,
    unscored: unscored.ids,
    format: 'driver',
    inferredTrials: 0,
    ...(instrumentation === undefined ? {} : { instrumentation }),
    ...(trialRows === undefined ? {} : { trialRows }),
    ...(pairedFacades === undefined ? {} : { pairedFacades }),
    ...(notedFacades === undefined ? {} : { notedFacades }),
    unscoredSource: unscored.source,
  };
}

if (resultsPath === undefined && driver === undefined) await notRun();

const source = resultsPath ?? (driver as string);
const measured =
  resultsPath === undefined ? await measureFromDriver(driver as string) : await measureFromResults(resultsPath);

const mean = meanPassAtK(measured.tasks);
/**
 * Which arm this file is grading.
 *
 * `TAU_MEMORY=false` is the reference arm: the same tasks, the same model, no store. It is the
 * control the memory arm is paired against, so it is not held to the published bar — see
 * `sampleGates` for the six dispatches that ended red before this distinction existed.
 */
const arm: 'memory' | 'reference' =
  (process.env['TAU_MEMORY'] ?? 'true') === 'false' ? 'reference' : 'memory';
/**
 * The distractor this dispatch planted, when it planted one.
 *
 * Read from the same variable the driver reads, because the two files are reading one dispatch: a run
 * that plants `far` and a run that plants nothing are the same measurement to this file and different
 * experiments to the readback. See `sampleGates` for why a planted arm is not held to the published
 * bar — R57's `far` arm missed it while behaving exactly as registered.
 */
const plantedArm = (process.env['TAU_PLANTED_RULES'] ?? '').trim();
const compared =
  scenarioBar.published === null ? undefined : compareToPublished(mean, scenarioBar.published, BAR);
const coversSplit = measured.tasks.length >= MIN_TASKS;
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
  ...sampleGates({
    arm,
    pass4: mean,
    tasks: measured.tasks.length,
    unscored: measured.unscored.length,
    minTasks: MIN_TASKS,
    published: compared,
    bar: BAR,
    ...(plantedArm === '' ? {} : { planted: { arm: plantedArm } }),
  }),
  // R50. This arm has no reference arm of its own. When one is supplied the gate
  // is graded by `pairedVerdict`, which blocks on harm — the R45 rule — rather than
  // on a delta and a p-value the split cannot deliver. When none is supplied the
  // gate is **omitted**, because the house convention two lines above is that
  // omitting a gate is a statement and not a pass: the previous version printed
  // `PASS l4-paired: no reference arm`, which is a green square for a question this
  // artefact cannot ask. The pair step (`bin/l4-pair.ts`) owns that question.
  ...(paired === undefined
    ? []
    : [
        (() => {
          const verdict = pairedVerdict({
            deltaPp: paired.delta,
            p: paired.p,
            paired: paired.n,
            // The arm artefact does not carry its own served-pack count at this
            // point; the pair step reads it from `remember` and grades the branch
            // there. Passing 0 keeps the below-bar branch from firing on a number
            // this file does not have.
            servedPacks: 0,
            // `Infinity` because this file has the delta and the p-value but not
            // the discordance, so it cannot estimate a resolution and must not
            // pretend to: an unestimable resolution can support neither a benefit
            // nor an equivalence claim, and `pairedVerdict` reads it that way.
            detectablePp: Number.POSITIVE_INFINITY,
          });
          return {
            id: 'l4-paired',
            pass: verdict.state !== 'HARM',
            actual: `${paired.delta.toFixed(2)}pp (p=${paired.p.toFixed(4)}): ${verdict.state}`,
            criterion: 'against the same agent without the memory: neither R45 revert branch fires',
          };
        })(),
      ]),
  // A registered pair must not be a cross-run comparison. NO_MEASUREMENT is
  // not a failure here: it is an instrument that did not measure, and the
  // workflow's readback step annotates it explicitly. REFUSED_CROSS_RUN is a
  // broken design and blocks.
  ...(measured.pairedFacades === undefined
    ? []
    : [
        {
          id: 'l4-facade-pair',
          pass: facadePairState(measured.pairedFacades) !== 'REFUSED_CROSS_RUN',
          actual: facadePairState(measured.pairedFacades),
          criterion: 'a registered within-run pair is never a cross-run comparison',
        },
      ]),
  // R58: a trace arm's support reading is only a reading if the artefact's two distributions
  // describe the store it also reports. Graded as a gate rather than printed as a footnote, because
  // the run that fails it has no recurrence number to interpret — and because a trace arm whose
  // consolidation pass never ran carries the treatment's name and the control's store.
  ...(() => {
    const unit = measured.instrumentation?.distillUnit;
    if (unit === undefined || unit.unit !== 'trace') return [];
    const gate = recurrenceGate(unit, measured.instrumentation?.storeItems);
    return [{ id: 'l4-support-recurrence', pass: gate.pass, actual: gate.actual, criterion: gate.criterion }];
  })(),
  // R53: a three-level arm whose arms served different items is not a note effect. The
  // control is graded as a gate rather than printed as a footnote, because the run that
  // fails it has no interpretable delta at all.
  ...(measured.notedFacades === undefined
    ? []
    : [
        {
          id: 'l4-note-identity',
          pass: measured.notedFacades.packIdentity.mismatched === 0,
          actual: `${String(measured.notedFacades.packIdentity.mismatched)} mismatch of ${String(
            measured.notedFacades.packIdentity.compared,
          )} shared request(s)`,
          criterion: 'the three note levels serve the same items for every request two of them saw',
        },
      ]),
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
    // A bar that does not apply is reported as absent rather than as a number a reader could divide
    // by: `published_bar_applies` says which of the two this file is.
    ...(scenarioBar.published === null ? {} : { published_pass4: scenarioBar.published }),
    // The competitor's submitted number as well as its baseline: beating `0.575` says a memory beat no
    // memory, and beating `0.6754` says it beat ALTK-Evolve. Recorded as a number so a readback does not
    // carry its own copy of the constant, which is how two definitions of a bar start to drift.
    ...(scenarioBar.published === null ? {} : { competitor_pass4: COMPETITOR_PASS4 }),
    // Which arm this is, because the two are graded differently and a reader of the artefact
    // cannot otherwise tell a control that failed a bar from a treatment that missed one.
    arm: arm === 'reference' ? 0 : 1,
    published_bar_applies:
      scenarioBar.comparable && arm === 'memory' && plantedArm === '' ? 1 : 0,
    // Which of the two bars this file was graded by, as a flag rather than a name: `metrics` is a
    // record of numbers, and the name is already in the artefact where it belongs — `tau2.plant.arm`,
    // written by the driver that planted the rules. `1` here means "the published bar was not this
    // arm's", the third arm kind `sampleGates` documents.
    planted_arm: plantedArm === '' ? 0 : 1,
    // Omitted for a planted arm as well, for the same reason the gate is: a delta against the published
    // number is the competitive reading, and a distractor arm is graded by its paired ledger instead.
    ...(compared === undefined || arm === 'reference' || plantedArm !== ''
      ? {}
      : { delta: compared.delta }),
    tasks: measured.tasks.length,
    unscored_tasks: measured.unscored.length,
    // Whether the count above came from an instrument that looked, or from a driver that never said.
    // `0` is not read as a failure here — a driver written before this field cannot answer — but it
    // stops the artefact from presenting silence as a complete grid.
    unscored_reported: measured.unscoredSource === 'unreported' ? 0 : 1,
    min_tasks: MIN_TASKS,
    ...(paired === undefined ? {} : { paired_delta_pp: paired.delta, paired_ci_low_pp: paired.low,
      paired_ci_high_pp: paired.high, paired_p: paired.p, paired_n: paired.n }),
    k: K,
    inferred_trials: measured.inferredTrials,
    gates_passed: gates.filter((gate) => gate.pass).length,
  },
  notes: [
    `Source: ${source} (${measured.format} form). Two arms must share the split.`,
    scenarioBar.note,
    sotaLineOf(SCENARIO, mean, measured.tasks.length),
    `pass^4 is the unbiased C(c,4)/C(n,4) mean over ${measured.tasks.length} tasks, with success defined as \`reward == 1.0\` exactly, as upstream scores it.`,
    coversSplit
      ? `The split covers the minimum: ${measured.tasks.length} scored tasks against a floor of ${MIN_TASKS}.`
      : `The split is short: ${measured.tasks.length} scored tasks against a minimum of ${MIN_TASKS}. Short splits and missed bars fail separately.`,
    ...(measured.unscored.length === 0
      ? []
      : [
          `Unscored: ${String(measured.unscored.length)} task(s) left the denominator${
            measured.unscoredSource === 'ids' ? ' (named by the driver)' : ''
          }. A task with no verdict is not a failure and does not enter pass^4, so the denominator this file reports is smaller than the split it ran.`,
        ]),
    ...(measured.unscoredSource === 'unreported'
      ? [
          'Unscored source: unreported. This driver exports neither `unscoredTasks()` nor `instrument().unscored`, so a zero in `unscored_tasks` means "never counted", not "none found".',
        ]
      : []),
  ],
  // Per-task outcomes, so the other arm can be paired against this artefact instead of
  // compared to its mean. Written by every run, used by `pnpm eval:l4-pair`.
  per_task: perTaskRows(measured.tasks),
  // What the driver counted, so the pairing step can grade the protocol's gates on this arm. Written
  // only when the driver exported an `instrument()`: an absent field is a run whose counts did not
  // cross the process boundary, and `l4-pair` reports those gates as absent rather than green.
  ...(measured.instrumentation === undefined ? {} : { tau2: measured.instrumentation }),
  // The episodes, so the other arm's artefact can be paired with this one rather than compared to
  // its mean. One row per trial, which is the unit the transfer gates reconcile.
  ...(measured.trialRows === undefined ? {} : { per_trial: measured.trialRows }),
  samples: gates,
});

// R49: the paired-facade reading is its OWN artefact. The main artefact above
// grades the registered memory facade against the memory-free reference; this
// one grades floor against floor inside one dispatch. Merging the two is how
// defect 28 and defect 29 became representable in the first place.
if (measured.pairedFacades !== undefined) {
  const artefact = pairedFacadeArtifact(measured.pairedFacades, new Date().toISOString());
  await writeJson('poc-l4-facade-pair', artefact);
  process.stdout.write(`[poc-l4-facade-pair] ${artefact.summary}\n`);
}

// R53: three note levels over one store is its OWN artefact, for the same reason the floor
// pair is: the main document grades the memory arm against the memory-free reference, and a
// note contrast is neither that nor a floor contrast.
if (measured.notedFacades !== undefined) {
  const artefact = notedFacadeArtifact(measured.notedFacades, new Date().toISOString());
  await writeJson('poc-l4-facade-notes', artefact);
  process.stdout.write(`[poc-l4-facade-notes] ${artefact.summary}\n`);
}

for (const gate of gates) {
  process.stdout.write(`  ${gate.pass ? 'PASS' : 'FAIL'} ${gate.id} ${gate.actual} (${gate.criterion})\n`);
}
if (gates.some((gate) => !gate.pass)) process.exit(1);
