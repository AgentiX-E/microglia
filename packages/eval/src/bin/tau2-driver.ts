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
import { recallText, steppingClock, mulberry32 } from '@agentix-e/microglia-core';
import {
  AS_IS_FLOOR,
  LlmClient,
  attestPairScope,
  ProviderNoMeasurementError,
  classifyProviderProbe,
  driverArgs,
  facadePairSummary,
  facadePairVerdict,
  facadeScope,
  inactionCensusOf,
  storeItemSample,
  inactionContrastOrNull,
  meanPassAtK,
  probeGate,
  resolveFacadePairPlan,
  treatmentDelivered,
  armRecordFromDriver,
  correctionEdit,
  heldOutPlan,
  learnableCorrections,
  parseTauResults,
  parseTauTasks,
  qualifiedId,
  resilientInterpreter,
  resolveInjectionNotePlan,
  resolveWriteAdmissionPlan,
  resolveRecallFloor,
  stampDomain,
  stoppedRun,
  storeCensus,
  funnelReading,
  funnelVerdict,
  noMeasurementRefusal,
  guardAgainstToolNames,
  resolveDistillForm,
  tau2EditSemantics,
  toPassAtK,
  toolInventoryOf,
  trialRowsOf,
  unansweredTasks,
  type Correction,
  type PassAtKInput,
  type Tau2ArmRecord,
  type Tau2Raw,
  type TauTrialRow,
  type UseObservation,
  type PairedFacadeReading,
  type InactionCensus,
  type ProbeAttempt,
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
/**
 * R49's paired-facade switch, resolved once at module load. An unset variable
 * keeps the single-facade path verbatim, so every committed artefact before R49
 * stays comparable. The floored rung comes from `TAU_MIN_COVERAGE`, which the
 * workflow reads from the dispatch's own pre-registration.
 */
const PAIR_PLAN = resolveFacadePairPlan(process.env);
/**
 * The seed both facades must share. `run_split.py --seed` defaults to 300; in a
 * paired dispatch we pass it explicitly so common random numbers are an
 * attested property of the run rather than an accident of a Python default.
 * `Var(A - B) = 2 * sigma^2 * (1 - rho)` is why two dispatches of one
 * configuration are never a paired comparison (AUDIT 34.36).
 */
const PAIR_SEED = Number(process.env['TAU_EVAL_SEED'] ?? 300) || 300;
const DISPATCH_ID = process.env['GITHUB_RUN_ID'] ?? '';
const PREREG_ID = process.env['TAU_PREREG'] ?? '';
/**
 * Defect 27's pre-flight gate. Opt-in and registered by the R49 dispatch:
 * turning it on by default would change the call sequence of every earlier
 * dispatch, and an infrastructure failure must not be confused with a result.
 */
const PROVIDER_PROBE = (process.env['TAU_PROVIDER_PROBE'] ?? '').trim() === 'true';
/**
 * U6's write-side switch, resolved at module load and off unless a dispatch names
 * it. Off is the store every earlier artefact was produced by: an upgrade must
 * not change the meaning of a committed number.
 */
const WRITE_ADMISSION_PLAN = resolveWriteAdmissionPlan(process.env);
/**
 * R53's pack-note switch, resolved at module load. Unset is today's note, so every
 * artefact committed before this module produced the same prompt it always did; `declared`
 * separates "this run is the standard arm" from "nobody set the switch", which a readback
 * that wants to compare three levels needs and a bare default cannot give it.
 */
const NOTE_PLAN = resolveInjectionNotePlan(process.env);
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

/**
 * The form this dispatch asks the distiller for.
 *
 * Read once, at module load, and recorded in the artefact from the same value: R56's `procedure` is
 * reverted to `lesson` (see `resolveDistillForm`), and a dispatch that overrides it must say so in
 * the record rather than in a comment.
 */
const DISTILL_FORM = resolveDistillForm();

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
  /** Per-episode action record; absent on every run before the abstention instrument. */
  readonly inaction?: unknown;
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

/** The one paired-facade record, when this dispatch registered a pair. */
let observedPair: PairedFacadeReading | undefined;

/**
 * Additive, like `instrument()`: `l4.ts` was written against a driver exporting
 * `run()`, and a driver that does not export this (every driver before R49) is
 * not a failure. A caller that asks for it gets the graded three-terminal
 * verdict, never a mean that still needs interpreting.
 */
export function pairedFacades(): PairedFacadeReading | undefined {
  return observedPair;
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

  // Defect 27: the provider that distils the corrections and serves the agent
  // must answer before an hour of evaluation is spent on a store that was
  // never built. The probe is opt-in and registered by the R49 dispatch:
  // turning it on by default would change the call sequence of every earlier
  // dispatch, and an infrastructure failure must never become a zero. A
  // refusal throws `ProviderNoMeasurementError`, which `l4.ts` records as an
  // explicit artefact instead of a result.
  if (PROVIDER_PROBE) {
    const probeLlm = new LlmClient({
      apiKey: process.env['DEEPSEEK_API_KEY'] ?? '',
      model:
        process.env['TAU_DISTILL_MODEL']?.trim() || process.env['TAU_MODEL'] || 'deepseek-chat',
      maxCalls: 3,
    });
    const attempts: ProbeAttempt[] = [];
    for (let index = 0; index < 3; index += 1) {
      const started = Date.now();
      try {
        await probeLlm.chat('Reply with the single word ready.', 8);
        attempts.push({ ok: true, status: 200, latencyMs: Date.now() - started });
      } catch (error) {
        const matched = /\((\d{3})\)/.exec((error as Error).message);
        attempts.push({
          ok: false,
          ...(matched === null ? {} : { status: Number(matched[1]) }),
          latencyMs: Date.now() - started,
        });
      }
    }
    const verdict = classifyProviderProbe(attempts);
    const gate = probeGate(verdict);
    if (!gate.proceed) throw new ProviderNoMeasurementError(gate.marker);
    process.stdout.write(`[tau2] provider probe: ${verdict.state} over ${attempts.length} calls\n`);
  }

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
    createLlmInterpreter({
      llm: { complete: async (prompt) => (await llm.chat(prompt, 1200)).text },
      // R56: the one variable. The `lesson` form asks `when` to name a property "the reader can
      // check on a different input: which tables or columns it involves" — an instruction written
      // for a database, which in a lane whose input is a customer asking to cancel an order can
      // only be satisfied by naming the tools. `procedure` asks for the trigger in the question's
      // own terms, and it is the form this lane has never run.
      form: DISTILL_FORM,
    }),
    ruleInterpreter,
  );
  // The ban that makes the form real. A prompt cannot enforce itself, so a candidate whose statement
  // or condition names one of the tools this split learned from is refused at the host boundary and
  // counted. The inventory is built from the corrections themselves rather than from a constant: a
  // hand-written list would go stale the moment the scenario renames an action, and a stale ban is a
  // green reading on a store nobody constrained.
  const toolInventory = toolInventoryOf(corrections);
  const toolGuard = guardAgainstToolNames(toolInventory);
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
    note: NOTE_PLAN.mode,
  });

  for (const correction of corrections) {
    const handle = host.begin({
      task: TASK,
      // R55.0's instrument. `EvidenceRef.taskId` is what makes the store's support countable per
      // task, and this call never set it: every item's evidence therefore fell back to its run id,
      // one run per correction, and `distinctTasks` was 1 for every item by construction. That is
      // not a store with no recurrence, it is a store whose recurrence could not be recorded — the
      // distinction R55's own refutation turns on. The id is the correction's, so a claim derived
      // from one task twice counts once and a claim derived from two tasks counts twice.
      taskId: correction.taskId,
      // R51: the question, not its id. The distiller's prompt asks for a trigger
      // "in the question's own terms" and reads `run.input.question` to find them;
      // this field carried `correction.taskId`, so the model was asked to write in
      // the terms of a number. The id stays beside it, because a task id is what a
      // ledger, a split and a pair join on, and it must not be mistaken for a
      // question by anything downstream.
      input: {
        question: correction.instruction === '' ? correction.taskId : correction.instruction,
        taskId: correction.taskId,
        domain: LEARN_DOMAIN,
        schemaDigest: LEARN_DOMAIN,
      },
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
  const distillReport = await host.distill({
    generalize: false,
    fatal: stoppedRun,
    accept: toolGuard.accept,
    ...(WRITE_ADMISSION_PLAN.mode === 'off' ? {} : { admission: WRITE_ADMISSION_PLAN.options }),
  });
  const faults = distiller.faults();
  // The store's census, taken here rather than after the evaluation, because the funnel's last stage
  // is what decides whether there is anything to evaluate. R42 paid an hour of pack-free evaluation to
  // learn that the store was empty; the predicate that answers it exists and is tested, and this is
  // its second call site (the gate is the first, the readback the third).
  // One read of the store, shared by the census, the funnel and the domain ledger: three reads of
  // one store in a row would be three chances to describe three slightly different stores.
  const knowledge = await store.listKnowledge({});
  const census = storeCensus(knowledge, RECALL_DOMAIN);
  const funnel = {
    corrections: corrections.length,
    candidates: distillReport.candidates,
    admitted: distillReport.created + distillReport.merged,
    stored: knowledge.length,
    servable: census.servable,
    refused: distillReport.rejectedUnsafe + distillReport.rejectedBorrowed + distillReport.rejectedByHost,
    failed: distillReport.failed,
  };
  const funnelState = funnelVerdict(funnel);
  if (!funnelState.ready) {
    // A run whose pipeline did not carry anything has no reading to publish, and evaluating it would
    // spend the expensive half of the dispatch producing a number about an empty store. Recorded as
    // no-measurement rather than as a failure: the provider answered, the distiller ran, and what
    // broke is the chain between them.
    throw noMeasurementRefusal(funnelReading(funnel, funnelState));
  }
  // The domain ledger, from the store rather than from the driver's intentions: an item that lost its
  // domain somewhere nobody instrumented is exactly what V44 exists to catch.
  const withoutDomain = knowledge.filter((item) => item.scope.domain === undefined).length;
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
  // What the write path decided, on the same line as what it produced: a store of N items
  // built from M claims is only interpretable beside the count that was refused. Off prints
  // zeros, because 'not measured' and 'measured zero' are different facts everywhere else in
  // this lane and must be here too.
  process.stdout.write(
    `[tau2] write-admission: mode=${WRITE_ADMISSION_PLAN.mode} ` +
      `rephrased=${String(distillReport.rephrased)} ` +
      `suppressed=${String(distillReport.suppressed)}\n`,
  );
  process.stdout.write(
    `[tau2] injection-note: mode=${NOTE_PLAN.mode} declared=${String(NOTE_PLAN.declared)}\n`,
  );
  // R54: three conditions, verbatim, on the run's own page. A count of conditions cannot be
  // read for register, and register is the whole question the next arm asks of this store.
  for (const item of knowledge.slice(0, 3)) {
    process.stdout.write(`[tau2] store condition: ${item.when ?? '(none)'}\n`);
  }
  process.stdout.write(`[tau2] distill model: configured=${llm.configuredModel} sent=${llm.model}\n`);

  /**
   * One facade's evaluation over the same held-out split, against the ONE
   * distilled store.
   *
   * Every counter belongs to this facade alone. R48's defect was that two
   * readings came from different dispatches; mixing their counters here would
   * recreate the same defect one layer down. In paired mode the seed is passed
   * explicitly to `driverArgs`, so common random numbers are an attested
   * property rather than an accident of `run_split.py`'s default of 300.
   */
  type FacadeEvaluation = {
    readonly scored: ReturnType<typeof scoredArm>;
    readonly diagnostics: Tau2PhaseDiagnostics | undefined;
    readonly servedPackSizes: number[];
    readonly recallRequests: number;
    readonly recallServed: number;
    readonly useObservations: UseObservation[];
    /**
     * The observations the coverage curve is built from.
     *
     * The same as `useObservations` unless this facade ran behind another one: a
     * paired dispatch grades the gated facade, and its observations have already
     * passed the floor, so a histogram over them prices every floor at or below it
     * as free. R49 is the case in point — 0 and 0.01 both retain 1164 pairs in the
     * floored facade, while the as-is facade of the same run served 1435 packs
     * against 949.
     */
    readonly coverageObservations?: UseObservation[];
    /** Whether the agent acted at all in each episode, reduced to per-task counts. */
    readonly inaction: InactionCensus;
  };

  const evaluateFacade = async (floor: number, out: string): Promise<FacadeEvaluation> => {
    // What V1 grades: the pack is rendered in this process and read in another,
    // so its size is counted at the boundary rather than reconstructed from the
    // agent's transcript. A mean over no request and a mean over two hundred
    // empty answers are both 0, which is why the served tally is kept too.
    const servedPackSizes: number[] = [];
    let recallRequests = 0;
    let recallServed = 0;
    // What each served pack actually contained, at the facade boundary. The
    // recall scope, the floor and the pack are exactly as R45 ran them.
    const useObservations: UseObservation[] = [];
    const facade = await startRecall(async ({ text }) => {
      const pack = await host.recall({
        task: TASK,
        text,
        scope: { domain: RECALL_DOMAIN },
        minCoverage: floor,
      });
      recallRequests += 1;
      if (pack.items.length > 0) recallServed += 1;
      servedPackSizes.push(pack.items.length);
      useObservations.push({
        query: text,
        statements: pack.items.map((item) => item.statement),
        // R51 made condition + statement the document the floor is applied to; this is the
        // same document, so the histogram cannot score a pack by text the floor never saw.
        documents: pack.items.map(recallText),
      });
      return pack;
    });
    let evalStdout = '';
    try {
      evalStdout = await phase(
        driverArgs({
          script: SCRIPT,
          domain: TEST_DOMAIN,
          phase: 'eval',
          agent: 'microglia_agent',
          taskIds: test,
          trials: TRIALS,
          out,
          memoryUrl: facade.url,
          ...(PAIR_PLAN.enabled ? { seed: PAIR_SEED } : {}),
        }),
      );
    } finally {
      await facade.close();
    }
    const diagnostics = diagnosticsOf(evalStdout);
    return {
      scored: scoredArm(out),
      diagnostics,
      servedPackSizes,
      recallRequests,
      recallServed,
      useObservations,
      // The census is taken from THIS facade's phase, for the same reason every counter above is:
      // R48's defect was two readings from different dispatches, and sharing one census between two
      // facades would recreate it one layer down.
      inaction: inactionCensusOf(diagnostics, TEST_DOMAIN),
    };
  };

  // Attest the single store before either facade recalls. A second learning
  // phase would produce a second fingerprint and be refused by the invariant.
  const sharedScope = PAIR_PLAN.enabled
    ? attestPairScope({
        dispatchId: DISPATCH_ID,
        preregId: PREREG_ID,
        storeStatements: knowledge.map((item) => item.statement),
        learnSplit: plan.train,
        testSplit: plan.test,
        seed: PAIR_SEED,
        trials: TRIALS,
        model: llm.model,
      })
    : undefined;

  let primary: FacadeEvaluation;
  try {
    if (PAIR_PLAN.enabled && sharedScope !== undefined) {
      const asIs = await evaluateFacade(AS_IS_FLOOR, join(workdir, 'eval-as-is.json'));
      const floored = await evaluateFacade(PAIR_PLAN.flooredFloor, evalPath);
      const verdict = facadePairVerdict({
        plan: PAIR_PLAN,
        asIs: { scope: sharedScope, tasks: asIs.scored.tasks, servedPacks: asIs.recallServed },
        floored: { scope: sharedScope, tasks: floored.scored.tasks, servedPacks: floored.recallServed },
      });
      observedPair = {
        dispatchId: DISPATCH_ID,
        preregId: PREREG_ID,
        floors: { asIs: AS_IS_FLOOR, floored: PAIR_PLAN.flooredFloor },
        scope: sharedScope,
        servedPacks: { asIs: asIs.recallServed, floored: floored.recallServed },
        pass4: {
          asIs: meanPassAtK(asIs.scored.tasks),
          floored: meanPassAtK(floored.scored.tasks),
        },
        verdict,
        treatmentDelivered: treatmentDelivered(verdict),
        seed: PAIR_SEED,
        model: llm.model,
        // The mechanism beside the delta: a floor that changes pass^4 by making the agent stop
        // acting is a different finding from one that changes it by making the agent act wrongly,
        // and only this field tells them apart. `inactionContrast` refuses two censuses over
        // different populations, which is the right contract for a pure function and the wrong way
        // to lose an hour of evaluation here: the refusal becomes a `null` contrast while both
        // censuses stay in the artefact for a reader to compare.
        inaction: {
          asIs: asIs.inaction,
          floored: floored.inaction,
          contrast: inactionContrastOrNull(asIs.inaction, floored.inaction),
        },
      };
      // The registered (floored) facade is the memory arm the rest of the lane
      // grades, so `l4-paired` against the reference stays exactly as R48 had it.
      // Its coverage curve, however, comes from the ungated facade: the floor under
      // test must be priced against the population it was applied to, not against
      // the population that already survived it.
      primary = { ...floored, coverageObservations: asIs.useObservations };
      process.stdout.write(`[tau2] paired facades: ${facadePairSummary(observedPair)}\n`);
    } else {
      primary = await evaluateFacade(MIN_COVERAGE, evalPath);
    }
  } finally {
    await host.close();
  }

  const agentTurns = primary.diagnostics?.agent_turns ?? null;
  const scored = primary.scored;
  const llmStats = llm.stats;
  observed = {
    train: plan.train,
    test: plan.test,
    trials: TRIALS,
    unscored: scored.unscored,
    servedPackSizes: primary.servedPackSizes,
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
        : { total: agentTurns, failed: episodeFailures(primary.diagnostics), scope: 'run' as const },
    domains: { stored: knowledge.length, withoutDomain, unscopedIn: 0, widenedIn: 0 },
    // R54: what the store said, not only how many items said it. R51 could count conditions
    // and read none of them, so its readback could not tell a trigger in the user's register
    // from one in the procedure's — and those two predict opposite coverage.
    storeItems: storeItemSample(knowledge),
    // R56: the treatment and the subject it acted on, recorded beside the store it produced. The
    // form is what the prompt asked for; the inventory is what the ban refused names from; the
    // count is how often it fired. An artefact that carried the form alone would read the same
    // whether the ban ran or was vacuous, and R56's first refutation is that the ban is too strict —
    // a claim that needs the count to be graded.
    distillForm: {
      form: DISTILL_FORM,
      toolInventory,
      refused: toolGuard.refused(),
    },
    // The treatment, recorded beside its result: an artefact cannot otherwise tell an arm
    // that switched write admission on from one that never asked, and the counters are the
    // only place the mechanism's own population appears.
    // R53: the sentence every pack in this arm opened with, recorded beside the store that
    // produced the packs. A readback that cannot recover the level cannot tell an arm from a
    // control, and two runs of one level would read as three.
    injectionNote: { mode: NOTE_PLAN.mode, declared: NOTE_PLAN.declared },
    writeAdmission: {
      mode: WRITE_ADMISSION_PLAN.mode,
      rephrased: distillReport.rephrased,
      suppressed: distillReport.suppressed,
    },
    store: census,
    // R55's audit: the five counts that locate a zero. Every gate in the protocol graded a number
    // and none asked whether the machine that produced it carried anything — three rounds were read
    // as "the mechanism does not work" when the failing stage was upstream of every gate the report
    // carried. The counts are the driver's own, taken at the boundaries it can see, and they must
    // reconcile or `V0` says the two populations differ rather than reporting the last one.
    funnel,
    recall: { requests: primary.recallRequests, served: primary.recallServed, empty: primary.recallRequests - primary.recallServed },
    // What the served packs contained. `withoutDomain` is the store's count of
    // `domain === undefined` items, from the same domain ledger V44 reads.
    useObservations: primary.useObservations,
    // The curve from the ungated facade when there is one: the graded facade's
    // observations are already filtered at the floor under test, and a histogram
    // built from them prices that floor as free.
    coverageObservations: primary.coverageObservations ?? primary.useObservations,
    // R53's fourth prediction, recorded rather than discarded: `evaluateFacade` builds one census per
    // facade, and the paired path kept its copy in `observedPair` while this path dropped it on the
    // floor. A prediction whose subject the artefact does not carry cannot be graded, and this one
    // was written before the field existed -- so the field goes in before the dispatch, not after.
    inaction: primary.inaction,
    widenedItems: withoutDomain,
    scenario,
    // The scenario's own size, not the split's: a dispatch cap hides it, and it is what bounds the
    // resolution any split of this scenario can reach.
    scenarioTasks: { learn: learnable.length, test: evaluated.length },
  };

  return scored.tasks;
}
