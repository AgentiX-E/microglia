/**
 * The L4 driver: run τ²-bench, with and without the memory, and return pass^k inputs.
 *
 * `bin/l4.ts` accepts a module exporting `run()` when `TAU_DRIVER` is set. This is
 * that module. It exists because the lane's reader is finished and tested, and the
 * only thing missing between "a run happened" and "a number exists" was something
 * that makes one happen.
 *
 * ## The protocol, and why each part of it is here
 *
 *  1. **Split the task set deterministically.** Sorted ids, half to train and half to
 *     hold out (`splitTaskIds`), so two dispatches learn from the same half.
 *  2. **Learn from the training half without memory.** Failures are read from
 *     upstream's own result document — `evaluation_criteria.actions` says which tool
 *     calls should have happened — and written into a fresh store as corrections.
 *  3. **Distil, then freeze.** The held-out half is answered by a memory that never
 *     saw it, which is the only arrangement in which the number means anything.
 *  4. **Evaluate with `microglia_agent`**, which recalls from a local facade over
 *     HTTP because the agent runs in another process. The facade serves exactly one
 *     endpoint: `GET /v1/recall`.
 *
 * With `TAU_MEMORY=false` the same driver runs the reference arm: the same tasks,
 * the same model, no store. That is the comparison pass^4 is computed against.
 *
 * Nothing here scores anything. τ²'s evaluator decides every reward; this file only
 * decides which tasks, which agent, and what the memory was told.
 */
import { execFile } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { EmbeddedMemory, MemoryJournal } from '@agentix-e/microglia-core/memory';
import { openMicroglia } from '@agentix-e/microglia-core/capture';
import { createLlmInterpreter, ruleInterpreter } from '@agentix-e/microglia-core/distill';
import { steppingClock, mulberry32 } from '@agentix-e/microglia-core';
import {
  LlmClient,
  driverArgs,
  armRecordFromDriver,
  correctionEdit,
  heldOutPlan,
  learnableCorrections,
  parseTauResults,
  parseTauTasks,
  qualifiedId,
  resilientInterpreter,
  resolveRecallFloor,
  stampDomain,
  stoppedRun,
  storeCensus,
  tau2EditSemantics,
  toPassAtK,
  trialRowsOf,
  unansweredTasks,
  type Correction,
  type PassAtKInput,
  type Tau2ArmRecord,
  type Tau2Raw,
  type TauTrialRow,
  type UseObservation,
} from '@agentix-e/microglia-eval';

const runFile = promisify(execFile);

/** `packages/eval/{src,dist}/bin` → the repository root. */
const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
const SCRIPT = join(REPO, 'eval', 'drivers', 'tau2', 'run_split.py');

/**
 * The three scenario names a run has.
 *
 * A within-scenario run has one name three times over, which is why one variable was enough until
 * R29 stage 2. A cross-domain arm needs all three to differ in exactly one combination: it learns
 * from `TAU_TRAIN_DOMAIN`, answers `TAU_TEST_DOMAIN`, and recalls under `TAU_RECALL_DOMAIN`, which
 * defaults to the learned scenario because that is the scope the items were stored with.
 *
 * The recall scope is the treatment. τ² items written by this driver carry `scope.domain` of the
 * scenario they were learned in, and recall filters by it, so a `retail` store answers an `airline`
 * question with nothing unless the facade asks in the store's own terms. Asking in the store's terms
 * is what a transfer arm *is*; the alternative — leaving the filter at the question's scenario —
 * would measure an empty pack and call it a null.
 */
const TEST_DOMAIN = process.env['TAU_TEST_DOMAIN'] ?? process.env['TAU_DOMAIN'] ?? 'retail';
const LEARN_DOMAIN = process.env['TAU_TRAIN_DOMAIN'] ?? process.env['TAU_DOMAIN'] ?? 'retail';
const RECALL_DOMAIN = process.env['TAU_RECALL_DOMAIN'] ?? LEARN_DOMAIN;
const MEMORY = (process.env['TAU_MEMORY'] ?? 'true') !== 'false';
/**
 * U3's only treatment knob. Unset (every dispatch before U3) resolves to zero,
 * so the facade keeps every hit and the as-is artefact stays comparable. A
 * non-zero value must be a registered grid rung declared by the dispatch's own
 * pre-registration; `resolveRecallFloor` refuses anything else rather than
 * silently clamping a floor that was chosen after the readout.
 */
const MIN_COVERAGE = resolveRecallFloor(process.env);
const TRIALS = Math.max(1, Number(process.env['TAU_TRIALS'] ?? 4) || 4);
const TRAIN_SHARE = Number(process.env['TAU_TRAIN_SHARE'] ?? 0.5) || 0.5;
/**
 * How many tasks to draw before splitting; `0` means the whole set.
 *
 * A smoke run has to be affordable: the retail set is over a hundred tasks, and
 * four trials on both halves is hours. A cap changes the sample, not the protocol,
 * and the artefact records `n` so a small run cannot be read as a large one.
 */
const MAX_TASKS = Math.max(0, Number(process.env['TAU_MAX_TASKS'] ?? 0) || 0);
/**
 * Tasks each half keeps, after whatever split produced it; `0` means all of them.
 *
 * Separate from `MAX_TASKS` because the two caps answer different questions and a cross-domain arm
 * needs both at once: how large an evaluated sample the dispatch affords, and how many corrections
 * the store is built from. One cap for both would have made the foreign pack's size a function of
 * the evaluation budget.
 */
const TRAIN_TASKS = Math.max(0, Number(process.env['TAU_TRAIN_TASKS'] ?? 0) || 0);
const TEST_TASKS = Math.max(0, Number(process.env['TAU_TEST_TASKS'] ?? 0) || 0);
/**
 * The interpreter that can import `tau2`.
 *
 * `uv sync` puts the benchmark in `.tau2-bench/.venv`, so the system `python3` on a
 * runner cannot import it — which is how the first smoke run failed: the driver was
 * found, the phase ran, and the import failed one layer below the orchestration.
 * The environment variable still wins, because a caller with a different layout
 * knows better than a guess.
 */
function pythonPath(): string {
  const explicit = process.env['TAU_PYTHON'];
  if (explicit !== undefined && explicit.trim() !== '') return explicit;
  const venv = join(REPO, '.tau2-bench', '.venv', 'bin', 'python');
  return existsSync(venv) ? venv : 'python3';
}

const PYTHON = pythonPath();
const TASK = 'tau2.act';

/** One `run_split.py` invocation, with its stdout surfaced on failure. */
async function phase(args: readonly string[]): Promise<string> {
  try {
    const finished = await runFile(PYTHON, args as string[], {
      cwd: REPO,
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env },
    });
    // The phase writes one summary line; the benchmark writes thousands of its own.
    // Printing the tail keeps a run's shape visible without turning the job log
    // into a transcript, and it is the only evidence that a phase ran at all when
    // the lane is green.
    const tail = [finished.stdout, finished.stderr]
      .filter((text) => text.trim() !== '')
      .map((text) => text.trim().split('\n').slice(-2).join('\n'))
      .join('\n');
    if (tail !== '') process.stdout.write(`[tau2] ${tail}\n`);
    // The stdout is returned because the summary line is also the only channel on which the
    // in-process diagnostics of a phase can reach this process: `results.json` is upstream's
    // document and writing our own fields into it would make the reader parse a format nobody
    // specified.
    return finished.stdout;
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string; message: string };
    const detail = [failure.stderr, failure.stdout].filter(Boolean).join('\n').slice(-2000);
    throw new Error(`tau2 phase failed: ${failure.message}\n${detail}`);
  }
}

/** The best reward each task reached, which is what a correction is learned from. */
function bestRewards(text: string): Map<string, number> {
  const rewards = new Map<string, number>();
  for (const trial of parseTauResults(text).trials) {
    if (trial.reward === null) continue;
    const prior = rewards.get(trial.taskId);
    if (prior === undefined || trial.reward > prior) rewards.set(trial.taskId, trial.reward);
  }
  return rewards;
}

/**
 * One evaluated arm's document, read once and used for three things.
 *
 * The per-trial rows, the pass^k inputs and the unscored count all come from the same parse, so a
 * run cannot report a denominator from one reading and a ledger from another. Task ids are
 * qualified here, at the boundary, so everything downstream — the pair, the split, the ledger —
 * speaks the same names.
 */
function scoredArm(path: string): {
  readonly tasks: readonly PassAtKInput[];
  readonly unscored: number;
  readonly rows: readonly TauTrialRow[];
} {
  const run = parseTauResults(readFileSync(path, 'utf8'));
  const scored = toPassAtK(run, TRIALS);
  const rows = trialRowsOf(run.trials, TEST_DOMAIN);
  observedTrials = rows;
  return {
    // A task the reader could not name is left unnamed rather than renamed into a name it does not
    // have: `PassAtKInput.taskId` is optional, and qualifying `undefined` would invent a task.
    tasks: scored.tasks.map((task) =>
      task.taskId === undefined ? task : { ...task, taskId: qualifiedId(TEST_DOMAIN, task.taskId) },
    ),
    unscored: scored.unscored.length,
    rows,
  };
}

/**
 * A one-endpoint facade: the agent process reads packs, and writes nothing.
 *
 * The agent states the scenario it is answering in and the facade does not use it. That is the
 * treatment of a transfer arm rather than an oversight: the store's scope decides what can be
 * served, and the episode's scenario would filter a foreign pack down to nothing.
 */
function startRecall(
  recall: (input: { task: string; text: string }) => Promise<{ rendered: string }>,
): Promise<{ url: string; close: () => Promise<void> }> {
  const server: Server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (url.pathname !== '/v1/recall') {
      response.writeHead(404).end();
      return;
    }
    const task = url.searchParams.get('task') ?? TASK;
    const text = url.searchParams.get('text') ?? '';
    recall({ task, text })
      .then((pack) => {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ rendered: pack.rendered }));
      })
      .catch(() => response.writeHead(500).end());
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done());
          }),
      });
    });
  });
}

/**
 * What `run()` saw, and the shape the protocol's gates read it in.
 *
 * Two functions rather than one return value because `l4.ts` was written against
 * `run(): Promise<readonly PassAtKInput[]>` and a driver that changed that signature would be a
 * driver the lane can no longer load. `instrument()` is additive: a caller that does not ask for it
 * gets exactly the behaviour it had before, and a driver that does not export it (every driver before
 * this one) is not a failure.
 */
let observed: Tau2Raw | undefined;

/** The last JSON line a phase printed, which is the channel its in-process diagnostics arrive on. */
function diagnosticsOf(stdout: string): Tau2PhaseDiagnostics | undefined {
  for (const line of stdout.trim().split('\n').reverse()) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      const parsed = JSON.parse(trimmed) as { diagnostics?: Tau2PhaseDiagnostics };
      if (parsed.diagnostics !== undefined) return parsed.diagnostics;
    } catch {
      // A line that starts with `{` and is not JSON belongs to the benchmark's own output.
      continue;
    }
  }
  return undefined;
}

type Tau2PhaseDiagnostics = {
  readonly agent_turns?: number | null;
  readonly simulations?: number | null;
  readonly terminated?: Readonly<Record<string, number>> | null;
};

/** The admission reasons, most frequent first, for the one line a run prints about its own store. */
function reasonsLine(reasons: Readonly<Record<string, number>>): string {
  const ranked = Object.entries(reasons).sort((left, right) => right[1] - left[1]);
  return ranked.length === 0 ? 'none recorded' : ranked.map(([reason, count]) => `${reason}=${String(count)}`).join(', ');
}

/** How many of the run's episodes ended in something that is not a task outcome. */
function episodeFailures(diagnostics: Tau2PhaseDiagnostics | undefined): number {
  const terminated = diagnostics?.terminated ?? {};
  let failed = 0;
  for (const [reason, count] of Object.entries(terminated)) {
    if (/error|fail|timeout|max_steps|too_many/i.test(reason)) failed += count;
  }
  return failed;
}

/** Every episode the evaluated half produced, with its task named the way the record names it. */
let observedTrials: readonly TauTrialRow[] | undefined;

/** The arm record the protocol's gates read, or `undefined` before a run has happened. */
export function instrument(): Tau2ArmRecord | undefined {
  return observed === undefined ? undefined : armRecordFromDriver(observed);
}

/**
 * The evaluated half's episodes, one row per trial.
 *
 * Separate from `instrument()` because it is a different size of thing: the record is a summary the
 * gates read, and this is the ledger the transfer measurement is paired over. A driver that returned
 * only the summary would make the cross-domain reading impossible without buying the run again.
 */
export function trials(): readonly TauTrialRow[] | undefined {
  return observedTrials;
}

/** The task ids one scenario holds, as τ² names them. */
async function listTasks(domain: string, out: string): Promise<readonly string[]> {
  // The listing is its own call: `driverArgs` models the two *running* phases, and
  // "what is in this task set" is a different question with a different answer.
  await phase([SCRIPT, '--domain', domain, '--phase', 'list', '--out', out]);
  const listed = JSON.parse(readFileSync(out, 'utf8')) as { tasks?: string[] };
  const ids = listed.tasks ?? [];
  if (ids.length === 0) throw new Error(`tau2 returned no tasks in ${domain}`);
  return ids;
}

/** A qualified id back to the scenario's own name, which is what τ² is asked to run. */
function unqualified(domain: string): (id: string) => string {
  const prefix = `${domain}/`;
  return (id) => (id.startsWith(prefix) ? id.slice(prefix.length) : id);
}

export async function run(): Promise<readonly PassAtKInput[]> {
  const workdir = process.env['TAU_WORKDIR'] ?? mkdtempSync(join(tmpdir(), 'microglia-tau2-'));
  const evaluated = await listTasks(TEST_DOMAIN, join(workdir, 'test-tasks.json'));
  const drawn = MAX_TASKS > 0 ? evaluated.slice(0, MAX_TASKS) : evaluated;
  // One listing serves both halves on one scenario; a cross-domain arm needs the second, and pays
  // for it with a call that returns ids it will never evaluate.
  const learnable =
    LEARN_DOMAIN === TEST_DOMAIN ? drawn : await listTasks(LEARN_DOMAIN, join(workdir, 'learn-tasks.json'));

  const plan = heldOutPlan({
    learnIds: learnable,
    evalIds: drawn,
    learnScenario: LEARN_DOMAIN,
    testScenario: TEST_DOMAIN,
    trainShare: TRAIN_SHARE,
    trainCap: TRAIN_TASKS,
    evalCap: TEST_TASKS,
  });
  if (plan.test.length === 0) throw new Error('tau2 split left no held-out task');
  // The plan's first invariant, re-checked where it is about to be paid for: a leak is the one
  // defect in this lane that produces a number rather than an error, so the run stops instead.
  const trained = new Set(plan.train);
  const leaked = plan.test.filter((id) => trained.has(id));
  if (leaked.length > 0) throw new Error(`tau2 plan leaked ${String(leaked.length)} task(s) into learning`);

  // The record speaks in qualified ids and the benchmark in its own: both lists are kept because
  // neither naming is right for the other's job.
  const train = plan.train.map(unqualified(LEARN_DOMAIN));
  const test = plan.test.map(unqualified(TEST_DOMAIN));
  const scenario = { learn: LEARN_DOMAIN, test: TEST_DOMAIN, recall: RECALL_DOMAIN };

  // What V1 grades. The pack is rendered in this process and read in another, so the size has to be
  // counted at the boundary rather than reconstructed from the agent's transcript.
  const servedPackSizes: number[] = [];
  /**
   * How many times the agent asked, and how many of those answers carried an item.
   *
   * `meanPackIds` is the mean of what was served, and a mean over no request is `0` — which is the
   * same number as a mean over two hundred empty answers. R42's arm made two hundred requests and
   * served none; the record could not say so, and the gate's sentence was a rate with no population.
   */
  let recallRequests = 0;
  let recallServed = 0;
  /**
   * What each served pack actually contained, at the facade boundary.
   *
   * V1 grades the size of a pack; this records its content, so a served pack of
   * rules that share no term with the question can be told apart from a served
   * pack of relevant ones. Pure observation: the recall scope, the floor and the
   * pack itself are exactly as R45 ran them. See `tau2-use-census.ts` and the
   * registered USE experiment in TECH-DESIGN §17.89.
   */
  const useObservations: UseObservation[] = [];

  const evalPath = join(workdir, 'eval.json');
  if (!MEMORY) {
    await phase(
      driverArgs({
        script: SCRIPT,
        domain: TEST_DOMAIN,
        phase: 'eval',
        agent: 'llm_agent',
        taskIds: test,
        trials: TRIALS,
        out: evalPath,
      }),
    );
    // The reference arm's episodes are as much a part of the transfer ledger as the memory arm's:
    // they are the control half of every pair, so they are recorded here rather than left in a
    // temporary file the job deletes.
    return scoredArm(evalPath).tasks;
  }

  const learnPath = join(workdir, 'learn.json');
  await phase(
    driverArgs({
      script: SCRIPT,
      domain: LEARN_DOMAIN,
      phase: 'learn',
      agent: 'llm_agent',
      taskIds: train,
      trials: 1,
      out: learnPath,
    }),
  );

  const learned = readFileSync(learnPath, 'utf8');
  const learnedTasks = parseTauTasks(JSON.parse(learned));
  const rewards = bestRewards(learned);
  const corrections: Correction[] = learnableCorrections(learnedTasks, rewards);
  // The two ways a training task can leave the store without a correction are not the same fact, and
  // V32 grades the difference: a task the model *passed* needed nothing, so a store built from every
  // failure is the store the arm was defined as; a task that *failed* and still taught nothing is a
  // question the record lost. The arithmetic here used to be `train.length - corrections.length`,
  // which counted every pass as a gap and would have failed a blocking gate on a run whose store was
  // exactly right; `unansweredTasks` is the same decision `learnableCorrections` makes, read the
  // other way round.
  const unanswered = unansweredTasks(learnedTasks, rewards).length;

  const store = await EmbeddedMemory.open(new MemoryJournal());
  const llm = new LlmClient({
    apiKey: process.env['DEEPSEEK_API_KEY'] ?? '',
    // The distillation client speaks the endpoint's own REST shape, and `TAU_MODEL` names the model
    // the way litellm does because τ²'s Python half is a litellm caller. `LlmClient` translates the
    // alias, and `TAU_DISTILL_MODEL` exists for a caller that wants to say the REST id outright.
    // Empty is read as unset: a workflow variable that is not configured renders as `''`, and `??`
    // would have kept it.
    model: process.env['TAU_DISTILL_MODEL']?.trim() || process.env['TAU_MODEL'] || 'deepseek-chat',
    maxCalls: Number(process.env['TAU_MAX_CALLS'] ?? 400) || 400,
  });
  // The model first, the rules when the model fails on this event, and the run stopped when the
  // model fails on every event. See `tau2-distill.ts` for why this is the host's decision rather
  // than the combinator's.
  const distiller = resilientInterpreter(
    createLlmInterpreter({ llm: { complete: async (prompt) => (await llm.chat(prompt, 1200)).text } }),
    ruleInterpreter,
  );
  // The domain on every claim is the host's, not the interpreter's: `parseScope` takes it from the
  // model's JSON, recall filters on it, and an item stored under a spelling no question asks in is
  // stored, counted, and unreachable. Both branches of the fallback are stamped, because the rules
  // write a scope of their own and a store half-keyed by the model and half by nobody is worse than
  // either. See `stampDomain` for why this is an override rather than a default.
  const interpreter = stampDomain(distiller.interpreter, LEARN_DOMAIN);
  const host = await openMicroglia({
    app: 'microglia-l4',
    namespace: 'tau2',
    store,
    interpreter,
    budget: 1200,
    clock: steppingClock(1_700_000_000_000, 1),
    random: mulberry32(Number(process.env['TAU_SEED'] ?? 7) || 7),
    // A τ² correction is gold-verified by `evaluation_criteria.actions`, not judged
    // by a reviewer. `editDistance` would price it by how many arguments the tool
    // takes, which is what held all of R44's items as candidates. See
    // `tau2-admission.ts` for the measurement and the guarded condition.
    editSemantics: tau2EditSemantics,
  });

  for (const correction of corrections) {
    const handle = host.begin({
      task: TASK,
      input: { question: correction.taskId, domain: LEARN_DOMAIN, schemaDigest: LEARN_DOMAIN },
      model: llm.model,
      promptVersion: 'tau2/1',
      domainPack: 'tau2',
    });
    await handle.complete({ actions: correction.actions.map((action) => action.name) });
    // The corrected output differs from the completion by construction -- an edit that changes
    // nothing is refused by the capture layer, and a rubric-only correction would be refused for
    // every such task. See `correctionEdit`.
    await handle.edit(correctionEdit(correction), { note: correction.statement });
  }
  // The report, not just the store: `failed` is the count that explains an empty store, and
  // discarding it is what made the first cross-domain dispatch unreadable. `fatal` is passed so a
  // provider that has stopped answering stops the run here — before an hour of evaluation is spent
  // on a pack the store never built.
  const distillReport = await host.distill({ generalize: false, fatal: stoppedRun });
  const faults = distiller.faults();
  // The domain ledger, from the store rather than from the driver's intentions: an item that lost its
  // domain somewhere nobody instrumented is exactly what V44 exists to catch.
  const knowledge = await store.listKnowledge({});
  const withoutDomain = knowledge.filter((item) => item.scope.domain === undefined).length;
  // The population behind `V1`, counted at the boundary the gate grades: a store of fourteen items
  // that serves nothing is a different defect depending on whether they are active and whether the
  // recall scope can reach them, and R42's record carried neither number.
  const census = storeCensus(knowledge, RECALL_DOMAIN);
  process.stdout.write(
    `[tau2] learn: ${String(corrections.length)} correction(s) from ${String(train.length)} task(s), ` +
      `${String(unanswered)} unreadable, ${String(distillReport.created)} created, ` +
      `${String(distillReport.failed)} failed, ${String(census.stored)} item(s) in the store ` +
      `(${String(census.active)} active, ${String(census.servable)} servable in ${RECALL_DOMAIN}), ` +
      `${String(faults.events)} answered by the rule fallback, reasons ` +
      `${reasonsLine(census.reasons)}\n`,
  );
  process.stdout.write(
    `[tau2] admission: measured=${String(census.admission.measured)} ` +
      `trust=${census.admission.trustMean.toFixed(4)} ` +
      `support=${census.admission.supportMean.toFixed(4)} ` +
      `confidence=${census.admission.confidenceMean.toFixed(4)} ` +
      `supportOnly=${String(census.admission.supportOnly)}\n`,
  );
  process.stdout.write(`[tau2] distill model: configured=${llm.configuredModel} sent=${llm.model}\n`);

  let evalStdout = '';
  const facade = await startRecall(async ({ text }) => {
    // The recall scope is the *store's* scenario, not the question's: see the comment on
    // `RECALL_DOMAIN`. The agent still states the scenario it is answering in, and the facade
    // deliberately does not use it.
    const pack = await host.recall({
      task: TASK,
      text,
      scope: { domain: RECALL_DOMAIN },
      minCoverage: MIN_COVERAGE,
    });
    recallRequests += 1;
    if (pack.items.length > 0) recallServed += 1;
    servedPackSizes.push(pack.items.length);
    // Record what was actually put in front of the agent. This reads the same
    // `pack` that is returned; it does not re-run recall, change its scope, or
    // filter the items. The census is computed in `armRecordFromDriver`.
    useObservations.push({
      query: text,
      statements: pack.items.map((item) => item.statement),
    });
    return pack;
  });
  try {
    evalStdout = await phase(
      driverArgs({
        script: SCRIPT,
        domain: TEST_DOMAIN,
        phase: 'eval',
        agent: 'microglia_agent',
        taskIds: test,
        trials: TRIALS,
        out: evalPath,
        memoryUrl: facade.url,
      }),
    );
  } finally {
    await facade.close();
    await host.close();
  }

  const diagnostics = diagnosticsOf(evalStdout);
  const agentTurns = diagnostics?.agent_turns ?? null;
  const scored = scoredArm(evalPath);
  const llmStats = llm.stats;
  observed = {
    train: plan.train,
    test: plan.test,
    trials: TRIALS,
    unscored: scored.unscored,
    servedPackSizes,
    learning: {
      rows: train.length,
      unanswered,
      edited: corrections.length,
      distilled: knowledge.length,
      // Every count here is the distiller's own, including the one that explains an empty store.
      distillFailed: distillReport.failed,
      candidates: distillReport.candidates,
      events: distillReport.events,
      llmFailed: faults.events,
    },
    // Whose tally this is, stated in the record: the episodes' calls belong to the agent process and
    // arrive as a turn count, the distillation calls are this process's own. A rate over a subset is
    // a rate over a subset, and the alternative — reporting nothing — is how a run whose every
    // distillation call was refused reached a reader as a store that had nothing to say.
    calls:
      agentTurns === null
        ? { total: llmStats.prompts, failed: llmStats.failures, scope: 'distillation' as const }
        : { total: agentTurns, failed: episodeFailures(diagnostics), scope: 'run' as const },
    domains: { stored: knowledge.length, withoutDomain, unscopedIn: 0, widenedIn: 0 },
    store: census,
    recall: { requests: recallRequests, served: recallServed, empty: recallRequests - recallServed },
    // What the served packs contained. `withoutDomain` is the store's count of
    // `domain === undefined` items, from the same domain ledger V44 reads.
    useObservations,
    widenedItems: withoutDomain,
    scenario,
    // The scenario's own size, not the split's: a dispatch cap hides it, and it is what bounds the
    // resolution any split of this scenario can reach.
    scenarioTasks: { learn: learnable.length, test: evaluated.length },
  };

  return scored.tasks;
}
