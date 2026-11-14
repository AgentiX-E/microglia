/**
 * Which writer, on this backend, writes a claim that carries a condition — priced before an arm is
 * dispatched.
 *
 * ## What R111's pre-flight could not answer
 *
 * It asks the lane's own interpreter about one fixture and refuses an arm that gets nothing back. It
 * runs **one** `(model, form)` pair — the one the arm would run — so it answers "will this arm's
 * distiller answer at all?", not "which writer can". R104 then answered 10 of 73 events under the
 * pair the pre-flight had passed, and the artefact could not say whether the cause was the model,
 * the form, or the corrections: `lesson` is the only form this lane has ever run, and `deepseek-flash`
 * the only model.
 *
 * This command asks the same fixture through a **grid**: every `(model, form)` candidate, one call
 * each, read for a claim carrying a `when`. `procedure`, `repair` and `lexicon` have never been run
 * here, so the grid is where they get priced — cents rather than the $0.19 a learn half costs.
 *
 * ## What it can and cannot conclude
 *
 * It says which pairs can write **about a correction that states a rule**. It does not say the arm
 * will measure anything: R104's own pre-flight passed on a fixture and its population was 86%
 * silent, and that gap is the population instrument's (`distillReplies`'s four states, now on every
 * artefact). A `viable` verdict therefore permits a dispatch and never certifies one.
 *
 * Two verdicts refuse the treatment rather than confirm it — `no-writer` for a grid that returned and
 * wrote nothing usable, `unanswered` for a grid that was never asked or threw on every call. They are
 * different findings and the artefact keeps them apart.
 *
 * ## Cost
 *
 * Two models × four forms is eight calls of ~1.5k prompt tokens each, which is a cent or two. The
 * budget is enforced rather than assumed: `--max-calls` caps the run and the client refuses past it.
 *
 * Usage:
 *   pnpm eval:writer-probe --out eval/results/writer-probe.json
 *     [--models deepseek-flash,deepseek-chat] [--forms lesson,procedure,repair,lexicon]
 *     [--max-calls 24] [--max-tokens 1200]
 *
 * Reads `DEEPSEEK_API_KEY` and the same model variables the τ² lane reads, so the grid's first row is
 * the pair a dispatch would actually spend.
 *
 * It exits zero whatever the verdict says: a writer that cannot write is a result, not a build
 * failure, and a probe that failed the job would be re-run until it passed.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { createLlmInterpreter, type DistillForm } from '@agentix-e/microglia-core/distill';
import { preflightContext, PREFLIGHT_TASK } from '../distill-preflight.js';
import { LlmClient, type ChatReply } from '../model-client.js';
import {
  DISTILL_THINKING,
  candidateGrid,
  probeWriters,
  writerLabel,
  writerProbeMarkdown,
  type ProbeTokens,
  type WriterCandidate,
  type WriterOutcome,
} from '../writer-probe.js';

const FORMS: readonly DistillForm[] = ['lesson', 'repair', 'procedure', 'lexicon'];

/**
 * The models a grid asks by default.
 *
 * The lane's own model first, because the first row has to be the pair a dispatch would spend; then
 * the endpoint's other served id, because a grid of one model cannot separate a capacity from a
 * prompt. `deepseek-flash` thinks by default and `deepseek-chat` does not, which is the difference
 * R104 could not rule out from its own artefact.
 */
function defaultModels(): readonly string[] {
  const lane = (process.env['TAU_DISTILL_MODEL'] ?? process.env['TAU_MODEL'] ?? '').trim();
  const models = [lane === '' ? 'deepseek-flash' : lane, 'deepseek-chat'];
  return [...new Set(models)];
}

/**
 * A comma-separated flag, with an empty value read as "not given".
 *
 * The workflow passes `--models "$models"` unconditionally, because the alternative is a `[ -n … ]`
 * test inside a `run:` block — logic no test can see, and one `set -e` away from ending the step on a
 * false condition. A dispatch variable that is not configured renders as `''`, and reading that as
 * "the caller chose no models" would produce an empty grid and an `unanswered` verdict about a host
 * nobody asked.
 */
function listFlag(argv: readonly string[], name: string): readonly string[] | undefined {
  const at = argv.indexOf(name);
  if (at === -1) return undefined;
  const value = argv[at + 1];
  if (value === undefined || value.startsWith('--')) throw new Error(`${name} needs a comma-separated list`);
  const entries = value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
  return entries.length === 0 ? undefined : entries;
}

function numberFlag(argv: readonly string[], name: string, fallback: number): number {
  const at = argv.indexOf(name);
  if (at === -1) return fallback;
  const value = Number(argv[at + 1]);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} needs a positive number`);
  return Math.trunc(value);
}

type Flags = {
  readonly out: string;
  readonly summary?: string;
  readonly candidates: readonly WriterCandidate[];
  readonly maxCalls: number;
  readonly maxTokens: number;
};

function flagsOf(argv: readonly string[]): Flags {
  const at = argv.indexOf('--out');
  if (at === -1) {
    throw new Error('this probe writes what it saw; pass --out <file> so the run can carry it');
  }
  const out = argv[at + 1];
  if (out === undefined || out.startsWith('--')) throw new Error('--out needs a path');
  const summaryAt = argv.indexOf('--summary');
  const summary = summaryAt === -1 ? undefined : argv[summaryAt + 1];
  if (summaryAt !== -1 && (summary === undefined || summary.startsWith('--'))) {
    throw new Error('--summary needs a path');
  }
  const models = listFlag(argv, '--models') ?? defaultModels();
  const forms = (listFlag(argv, '--forms') ?? FORMS) as readonly DistillForm[];
  return {
    out,
    ...(summary === undefined ? {} : { summary }),
    candidates: candidateGrid(models, forms),
    maxCalls: numberFlag(argv, '--max-calls', 24),
    // The lane's own ceiling (`DISTILL_TOKENS` in the driver). A probe that asked for more room than
    // the arm gets would answer a question about a budget no dispatch grants.
    maxTokens: numberFlag(argv, '--max-tokens', 1_200),
  };
}

/** The tokens a reply cost, in the shape the trial carries. */
function tokensOf(reply: ChatReply): ProbeTokens {
  return {
    prompt: reply.promptTokens,
    cached: reply.cachedTokens,
    completion: reply.completionTokens,
    ...(reply.reasoningTokens === undefined ? {} : { reasoning: reply.reasoningTokens }),
    total: reply.tokens,
  };
}

/**
 * One call for one candidate.
 *
 * A client per candidate rather than one client shared, because the model is fixed on the client:
 * a grid that reused one would send every row to the first row's model and publish the same trial
 * eight times under eight names. The budget is one per client, which is exactly one call.
 */
async function askWriter(
  candidate: WriterCandidate,
  apiKey: string,
  maxTokens: number,
): Promise<WriterOutcome> {
  const client = new LlmClient({
    apiKey,
    model: candidate.model,
    maxCalls: 1,
    thinking: DISTILL_THINKING,
  });
  let reply = '';
  const interpreter = createLlmInterpreter({
    llm: {
      complete: async (prompt) => {
        reply = (await client.chat(prompt, maxTokens)).text;
        return reply;
      },
    },
    form: candidate.form,
  });
  const started = Date.now();
  try {
    const claims = await interpreter(preflightContext());
    // The budget is one call, so the client's own accounting is one call's tokens.
    const ledger = client.stats;
    return {
      ok: true,
      reply,
      claims: claims.map((claim) => ({ ...(claim.when === undefined ? {} : { when: claim.when }) })),
      tokens: {
        prompt: ledger.promptTokens,
        cached: ledger.cachedTokens,
        completion: ledger.completionTokens,
        // The client folds "the provider reported no split" into zero, which is why the trial keeps
        // the field present: an artefact that omitted it could not tell an endpoint that does not
        // think from one that thinks for free.
        reasoning: ledger.reasoningTokens,
        total: ledger.tokens,
      },
      ms: Date.now() - started,
    };
  } catch (error) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code: unknown }).code)
        : 'unknown';
    return {
      ok: false,
      code,
      sample: (error instanceof Error ? error.message : String(error)).slice(0, 200),
      ms: Date.now() - started,
    };
  }
}

async function main(): Promise<void> {
  const flags = flagsOf(process.argv.slice(2));
  const apiKey = (process.env['DEEPSEEK_API_KEY'] ?? '').trim();
  if (apiKey === '') throw new Error('no credential: set DEEPSEEK_API_KEY');
  if (flags.candidates.length > flags.maxCalls) {
    throw new Error(
      `the grid is ${String(flags.candidates.length)} call(s) and the budget is ${String(flags.maxCalls)}`,
    );
  }
  for (const candidate of flags.candidates) {
    process.stdout.write(`[writer-probe] asking ${writerLabel(candidate)}\n`);
  }
  const reading = await probeWriters(flags.candidates, (candidate) =>
    askWriter(candidate, apiKey, flags.maxTokens),
  );

  for (const trial of reading.trials) {
    process.stdout.write(
      `[writer-probe] ${writerLabel(trial).padEnd(34)} ${trial.state.padEnd(9)} ` +
        `${String(trial.claims)} claim(s), ${String(trial.withWhen)} with a when, ` +
        `${String(trial.chars)} char(s), ${String(trial.tokens.total)} token(s)\n`,
    );
  }
  process.stdout.write(`[writer-probe] ${reading.state} — ${reading.sentence}\n`);

  const cost = reading.trials.reduce(
    (sum, trial) => ({
      calls: sum.calls + (trial.state === 'error' ? 0 : 1),
      promptTokens: sum.promptTokens + trial.tokens.prompt,
      cachedTokens: sum.cachedTokens + trial.tokens.cached,
      completionTokens: sum.completionTokens + trial.tokens.completion,
      reasoningTokens: sum.reasoningTokens + (trial.tokens.reasoning ?? 0),
      totalTokens: sum.totalTokens + trial.tokens.total,
    }),
    { calls: 0, promptTokens: 0, cachedTokens: 0, completionTokens: 0, reasoningTokens: 0, totalTokens: 0 },
  );

  const artefact = {
    schema: 'microglia.writer-probe/1',
    at: new Date().toISOString(),
    context: `fixture:${PREFLIGHT_TASK}`,
    state: reading.state,
    sentence: reading.sentence,
    models: [...new Set(flags.candidates.map((candidate) => candidate.model))],
    forms: [...new Set(flags.candidates.map((candidate) => candidate.form))],
    thinking: DISTILL_THINKING,
    maxTokens: flags.maxTokens,
    errors: reading.errors,
    viable: reading.viable,
    ...(reading.best === undefined ? {} : { best: reading.best }),
    trials: reading.trials,
    cost,
  };
  mkdirSync(dirname(flags.out), { recursive: true });
  writeFileSync(flags.out, `${JSON.stringify(artefact, null, 2)}\n`, 'utf8');
  process.stdout.write(`[writer-probe] wrote ${flags.out}\n`);
  if (flags.summary !== undefined) {
    mkdirSync(dirname(flags.summary), { recursive: true });
    writeFileSync(flags.summary, writerProbeMarkdown(reading, artefact), 'utf8');
    process.stdout.write(`[writer-probe] wrote ${flags.summary}\n`);
  }
}

await main();
