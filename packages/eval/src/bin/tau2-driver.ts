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
import { combineInterpreters, createLlmInterpreter, ruleInterpreter } from '@agentix-e/microglia-core/distill';
import { steppingClock, mulberry32 } from '@agentix-e/microglia-core';
import {
  LlmClient,
  driverArgs,
  learnableCorrections,
  parseTauResults,
  parseTauTasks,
  splitTaskIds,
  toPassAtK,
  type Correction,
  type PassAtKInput,
} from '@agentix-e/microglia-eval';

const runFile = promisify(execFile);

/** `packages/eval/{src,dist}/bin` → the repository root. */
const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
const SCRIPT = join(REPO, 'eval', 'drivers', 'tau2', 'run_split.py');

const DOMAIN = process.env['TAU_DOMAIN'] ?? 'retail';
const MEMORY = (process.env['TAU_MEMORY'] ?? 'true') !== 'false';
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
async function phase(args: readonly string[]): Promise<void> {
  try {
    await runFile(PYTHON, args as string[], {
      cwd: REPO,
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env },
    });
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

/** A one-endpoint facade: the agent process reads packs, and writes nothing. */
function startRecall(
  recall: (input: { task: string; text: string; domain: string }) => Promise<{ rendered: string }>,
): Promise<{ url: string; close: () => Promise<void> }> {
  const server: Server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (url.pathname !== '/v1/recall') {
      response.writeHead(404).end();
      return;
    }
    const task = url.searchParams.get('task') ?? TASK;
    const text = url.searchParams.get('text') ?? '';
    const domain = url.searchParams.get('domain') ?? DOMAIN;
    recall({ task, text, domain })
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

export async function run(): Promise<readonly PassAtKInput[]> {
  const workdir = process.env['TAU_WORKDIR'] ?? mkdtempSync(join(tmpdir(), 'microglia-tau2-'));
  const listPath = join(workdir, 'tasks.json');
  // The listing is its own call: `driverArgs` models the two *running* phases, and
  // "what is in this task set" is a different question with a different answer.
  await phase([SCRIPT, '--domain', DOMAIN, '--phase', 'list', '--out', listPath]);
  const listed = JSON.parse(readFileSync(listPath, 'utf8')) as { tasks?: string[] };
  const ids = listed.tasks ?? [];
  if (ids.length === 0) throw new Error('tau2 returned no tasks');

  const drawn = MAX_TASKS > 0 ? ids.slice(0, MAX_TASKS) : ids;
  const { train, test } = splitTaskIds(drawn, TRAIN_SHARE);
  if (test.length === 0) throw new Error('tau2 split left no held-out task');

  const evalPath = join(workdir, 'eval.json');
  if (!MEMORY) {
    await phase(
      driverArgs({
        script: SCRIPT,
        domain: DOMAIN,
        phase: 'eval',
        agent: 'llm_agent',
        taskIds: test,
        trials: TRIALS,
        out: evalPath,
      }),
    );
    return toPassAtK(parseTauResults(readFileSync(evalPath, 'utf8')), TRIALS).tasks;
  }

  const learnPath = join(workdir, 'learn.json');
  await phase(
    driverArgs({
      script: SCRIPT,
      domain: DOMAIN,
      phase: 'learn',
      agent: 'llm_agent',
      taskIds: train,
      trials: 1,
      out: learnPath,
    }),
  );

  const learned = readFileSync(learnPath, 'utf8');
  const corrections: Correction[] = learnableCorrections(parseTauTasks(JSON.parse(learned)), bestRewards(learned));

  const store = await EmbeddedMemory.open(new MemoryJournal());
  const llm = new LlmClient({
    apiKey: process.env['DEEPSEEK_API_KEY'] ?? '',
    model: process.env['TAU_MODEL'] ?? 'deepseek-chat',
    maxCalls: Number(process.env['TAU_MAX_CALLS'] ?? 400) || 400,
  });
  const host = await openMicroglia({
    app: 'microglia-l4',
    namespace: 'tau2',
    store,
    interpreter: combineInterpreters(
      createLlmInterpreter({ llm: { complete: async (prompt) => (await llm.chat(prompt, 1200)).text } }),
      ruleInterpreter,
    ),
    budget: 1200,
    clock: steppingClock(1_700_000_000_000, 1),
    random: mulberry32(Number(process.env['TAU_SEED'] ?? 7) || 7),
  });

  for (const correction of corrections) {
    const handle = host.begin({
      task: TASK,
      input: { question: correction.taskId, domain: DOMAIN, schemaDigest: DOMAIN },
      model: process.env['TAU_MODEL'] ?? 'deepseek-chat',
      promptVersion: 'tau2/1',
      domainPack: 'tau2',
    });
    await handle.complete({ actions: correction.actions.map((action) => action.name) });
    // A mutable copy: the store's payload type is JSON, and a readonly tuple of
    // readonly actions is not assignable to it, which is the type system asking
    // for a value that cannot be aliased into the record.
    await handle.edit(
      { actions: correction.actions.map((action) => ({ name: action.name, arguments: { ...action.arguments } })) },
      { note: correction.statement },
    );
  }
  await host.distill({ generalize: false });

  const facade = await startRecall(async ({ text, domain }) => host.recall({ task: TASK, text, scope: { domain } }));
  try {
    await phase(
      driverArgs({
        script: SCRIPT,
        domain: DOMAIN,
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

  const run = parseTauResults(readFileSync(evalPath, 'utf8'));
  return toPassAtK(run, TRIALS).tasks;
}
