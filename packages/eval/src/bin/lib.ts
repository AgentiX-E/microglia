/**
 * Shared plumbing for the live POC scripts.
 *
 * These scripts are evidence, not product code: they call real providers, cap
 * their own spend, and write a single JSON artifact that the documents quote.
 * Nothing here is imported by a published package.
 */
import { existsSync } from 'node:fs';
import { attemptTimeoutMs, chooseArtefact, retryAfterMs } from '@agentix-e/microglia-eval';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions';
export const DEEPSEEK_MODEL = 'deepseek-chat';
export const ZHIPU_URL = 'https://open.bigmodel.cn/api/paas/v4/embeddings';
export const ZHIPU_MODEL = 'embedding-3';

const MAX_CALLS = Number(process.env['POC_MAX_CALLS'] ?? 400);
let calls = 0;

export function callCount(): number {
  return calls;
}

export class BudgetExceeded extends Error {}

/**
 * The lane's own wall-clock limit lives in `LlmClient`, not here.
 *
 * It has to be checked between attempts, at the layer that knows what an attempt costs, and a
 * second copy in this file would be a limit that half the lanes obeyed. `lib.chat` is used by two
 * probe lanes; every lane that measures a benchmark goes through the client.
 */

/**
 * How long one request may take.
 *
 * The formula lives in the client, which is the layer that knows what a reply costs: a lane that
 * kept its own copy would drift from it, and the drift would show up as an unexplained timeout in
 * whichever lane was edited second.
 */
const replyTimeout = attemptTimeoutMs;

/** Wall clock the run spent waiting on retries, and the slowest single reply it saw. */
export type CallMeter = {
  readonly calls: number;
  readonly retries: number;
  readonly timeouts: number;
  readonly waitedMs: number;
  readonly slowestMs: number;
};

const meter = { calls: 0, retries: 0, timeouts: 0, waitedMs: 0, slowestMs: 0 };

export function callMeter(): CallMeter {
  return { ...meter };
}

/** A response the provider answered with a status we did not ask for. */
class HttpError extends Error {
  readonly status: number;
  readonly retryAfterMs: number | undefined;

  constructor(label: string, status: number, detail: string, retryAfterMs: number | undefined) {
    super(`${label} ${status}: ${detail}`);
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * Whether a failure is worth asking again, and how long to wait first.
 *
 * The two classes are not the same bet. A 429 or a 502 is the provider saying "not now", and asking
 * again is exactly right. A timeout is the provider being slow with this reply, and asking the same
 * question again usually buys the same slowness — so it gets one more attempt, not two.
 */
function planFor(error: unknown, attempt: number): { retry: boolean; waitMs: number } {
  const backoff = 500 * 2 ** attempt;
  // Three attempts for the two statuses that mean "not now", two for the one that means "too slow".
  // The cap is the same for both: unbounded retrying against a provider that is down turns a
  // configured budget into an open-ended wait, and the deadline would be the thing that ended it.
  const transient = attempt < 2;
  if (error instanceof HttpError) {
    if (error.status === 429) {
      return { retry: transient, waitMs: error.retryAfterMs ?? backoff };
    }
    if (error.status >= 500) return { retry: transient, waitMs: error.retryAfterMs ?? backoff };
    return { retry: false, waitMs: 0 };
  }
  const name = error instanceof Error ? error.name : '';
  if (name === 'TimeoutError' || name === 'AbortError') {
    meter.timeouts += 1;
    return { retry: attempt < 1, waitMs: 0 };
  }
  const message = String(error);
  if (/ECONNRESET|ETIMEDOUT|fetch failed|socket hang up/i.test(message)) {
    return { retry: transient, waitMs: backoff };
  }
  return { retry: false, waitMs: 0 };
}

async function withRetry<T>(run: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      const plan = planFor(error, attempt);
      if (!plan.retry) throw error;
      meter.retries += 1;
      meter.waitedMs += plan.waitMs;
      if (plan.waitMs > 0) await new Promise((resolve) => setTimeout(resolve, plan.waitMs));
    }
  }
}

function key(name: 'DEEPSEEK_API_KEY' | 'ZHIPU_API_KEY'): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

/** One call's admission: the budget is the only limit this lane can enforce on its own. */
function admit(): void {
  if (calls >= MAX_CALLS) throw new BudgetExceeded(`Call budget ${MAX_CALLS} exhausted`);
  calls += 1;
  meter.calls += 1;
}

export type ChatResult = {
  readonly text: string;
  readonly latencyMs: number;
  readonly promptTokens: number;
  readonly completionTokens: number;
};

export async function chat(
  messages: readonly { role: 'system' | 'user'; content: string }[],
  options: { maxTokens?: number; temperature?: number } = {},
): Promise<ChatResult> {
  admit();
  const maxTokens = options.maxTokens ?? 200;
  const started = performance.now();
  const response = await withRetry(async () => {
    const reply = await fetch(DEEPSEEK_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key('DEEPSEEK_API_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        messages,
        max_tokens: maxTokens,
        temperature: options.temperature ?? 0,
        response_format: { type: 'json_object' },
      }),
      signal: AbortSignal.timeout(replyTimeout(maxTokens)),
    });
    if (!reply.ok) {
      throw new HttpError(
        'DeepSeek',
        reply.status,
        (await reply.text()).slice(0, 300),
        retryAfterMs(reply.headers.get('retry-after')),
      );
    }
    return reply;
  });
  const body = (await response.json()) as {
    choices: { message: { content: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const text = body.choices[0]?.message.content ?? '';
  const latencyMs = performance.now() - started;
  meter.slowestMs = Math.max(meter.slowestMs, latencyMs);
  return {
    text,
    latencyMs,
    promptTokens: body.usage?.prompt_tokens ?? 0,
    completionTokens: body.usage?.completion_tokens ?? 0,
  };
}

export async function embed(inputs: readonly string[]): Promise<number[][]> {
  admit();
  const response = await withRetry(async () => {
    const reply = await fetch(ZHIPU_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key('ZHIPU_API_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: ZHIPU_MODEL, input: inputs }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!reply.ok) {
      throw new HttpError(
        'Zhipu',
        reply.status,
        (await reply.text()).slice(0, 300),
        retryAfterMs(reply.headers.get('retry-after')),
      );
    }
    return reply;
  });
  const body = (await response.json()) as { data: { embedding: number[]; index: number }[] };
  return [...body.data].sort((a, b) => a.index - b.index).map((entry) => entry.embedding);
}

export function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    const x = a[i] as number;
    const y = b[i] as number;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / Math.sqrt(na * nb);
}

/** Models sometimes fence JSON; take the first balanced object. */
export function extractJson(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('{')) return trimmed;
  const start = trimmed.indexOf('{');
  if (start === -1) return trimmed;
  let depth = 0;
  for (let i = start; i < trimmed.length; i += 1) {
    const ch = trimmed[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return trimmed.slice(start, i + 1);
    }
  }
  return trimmed.slice(start);
}

export function percentile(values: readonly number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor(q * sorted.length));
  return Math.round((sorted[index] as number) * 1000) / 1000;
}

export function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}

export function rate(hits: number, total: number): number {
  return total === 0 ? 0 : hits / total;
}

export type PocResult = {
  readonly id: string;
  readonly title: string;
  readonly ranAt: string;
  readonly model: string;
  readonly n: number;
  readonly calls: number;
  readonly metrics: Record<string, number>;
  readonly notes: readonly string[];
  /**
   * Which configuration produced this run, when a lane supports more than one.
   *
   * A variant belongs in the artefact rather than only in the notes because two runs of
   * the same lane under different criteria write the same file name, and a reader who
   * cannot tell them apart will compare one against the other and call the difference a
   * result.
   */
  readonly variant?: string;
  readonly samples?: readonly unknown[];
  /**
   * Per-unit outcomes, when a lane can be paired against another arm later.
   *
   * `L4` needs this: pass^4 is a mean over tasks, and two means from two runs are
   * not a comparison. Typed loosely because each lane's unit is different.
   */
  readonly per_task?: readonly unknown[];
};

/**
 * The BIRD run artefact this process should read.
 *
 * Two splits, two artefacts: `poc-sota-bird.json` is the 350-question Mini-Dev run every earlier
 * reading came from, `poc-sota-bird-dev.json` is the 1,534-question dev run. A reader that names
 * one of them reads nothing once the other has run, and the failure is silent — every lane here
 * starts with "if the artefact is missing, print a line and exit zero". `SOTA_ARTEFACT` names one
 * explicitly; otherwise the first that exists wins, dev after mini-dev because a lane that
 * happens to work on both should keep reporting the number the documents quote.
 */
export function birdArtefactPath(): string {
  return chooseArtefact({
    dir: process.env['POC_RESULT_DIR'] ?? join(process.cwd(), 'eval', 'results'),
    explicit: process.env['SOTA_ARTEFACT'],
    exists: existsSync,
  });
}

/**
 * Write a lane's artefact where the gate, the workflow and the documents read it.
 *
 * One function rather than a constant per lane: the S2 lane kept a `poc/results`
 * path from before the rename, so its artefact was written to a directory nothing
 * else looked at and the workflow's own publish step failed to find it.
 */
export async function writeJson(id: string, value: unknown): Promise<void> {
  // The committed artefact lives in the repository; a self-check run redirects it
  // so a CI gate can exercise a lane without overwriting the evidence it ships.
  const dir = process.env['POC_RESULT_DIR'] ?? join(process.cwd(), 'eval', 'results');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${id}.json`), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export async function writeResult(result: PocResult): Promise<void> {
  await writeJson(result.id, result);
  process.stdout.write(
    `[${result.id}] ${Object.entries(result.metrics)
      .map(([k, v]) => `${k}=${typeof v === 'number' ? Number(v.toFixed(4)) : v}`)
      .join(' ')}\n`,
  );
}

export function repoRoot(path: string): string {
  return join(process.cwd(), path);
}

export async function ensureDir(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
}
