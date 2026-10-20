/**
 * Shared plumbing for the live POC scripts.
 *
 * These scripts are evidence, not product code: they call real providers, cap
 * their own spend, and write a single JSON artifact that the documents quote.
 * Nothing here is imported by a published package.
 */
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

function key(name: 'DEEPSEEK_API_KEY' | 'ZHIPU_API_KEY'): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (error) {
      last = error;
      const message = String(error);
      const retryable = /429|5\d\d|timeout|ECONNRESET|fetch failed/i.test(message);
      if (!retryable) break;
      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** i));
    }
  }
  throw last;
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
  if (calls >= MAX_CALLS) throw new BudgetExceeded(`Call budget ${MAX_CALLS} exhausted`);
  calls += 1;
  const started = performance.now();
  const response = await withRetry(() =>
    fetch(DEEPSEEK_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key('DEEPSEEK_API_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        messages,
        max_tokens: options.maxTokens ?? 200,
        temperature: options.temperature ?? 0,
        response_format: { type: 'json_object' },
      }),
      signal: AbortSignal.timeout(60_000),
    }),
  );
  if (!response.ok) {
    throw new Error(`DeepSeek ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }
  const body = (await response.json()) as {
    choices: { message: { content: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const text = body.choices[0]?.message.content ?? '';
  return {
    text,
    latencyMs: performance.now() - started,
    promptTokens: body.usage?.prompt_tokens ?? 0,
    completionTokens: body.usage?.completion_tokens ?? 0,
  };
}

export async function embed(inputs: readonly string[]): Promise<number[][]> {
  if (calls >= MAX_CALLS) throw new BudgetExceeded(`Call budget ${MAX_CALLS} exhausted`);
  calls += 1;
  const response = await withRetry(() =>
    fetch(ZHIPU_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key('ZHIPU_API_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: ZHIPU_MODEL, input: inputs }),
      signal: AbortSignal.timeout(60_000),
    }),
  );
  if (!response.ok) {
    throw new Error(`Zhipu ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }
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
  readonly samples?: readonly unknown[];
};

export async function writeResult(result: PocResult): Promise<void> {
  const dir = join(process.cwd(), 'poc', 'results');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${result.id}.json`), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
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
