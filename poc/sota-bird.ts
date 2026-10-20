/**
 * POC: does the flywheel help on a public text-to-SQL benchmark?
 *
 * The mechanism study holds the generator fixed and measures knowledge transfer.
 * This script is the opposite: a real model, a real benchmark (BIRD Mini-Dev), and
 * execution accuracy as the metric. It exists to answer one question that the
 * mechanism study cannot — whether a pack learned from *this* database's
 * corrections helps on *held-out* questions about the same database.
 *
 * Protocol
 *  1. Split a deterministic slice into `learn` and `eval` halves.
 *  2. Run the eval half with no memory (arm A) and record execution accuracy.
 *  3. Failure-driven learning: for each wrong answer in the `learn` half, distill a
 *     scoped lesson from the difference between the model's SQL and the gold SQL.
 *  4. Re-run the *same* eval half with the resulting pack (arm B).
 *
 * The two arms share the model, the prompt skeleton, and the questions. The only
 * difference is the pack, so the delta is attributable to it.
 *
 * Honest reporting
 *  - A question the harness cannot execute counts as wrong in both arms, and the
 *    parse/execution failure rates are reported separately.
 *  - Accuracy gates are advisory below 600 questions: at n=60 the 95% interval on a
 *    50% rate is roughly ±13pp, so gating would produce flaky builds.
 *
 * Requirements
 *  - `DEEPSEEK_API_KEY` for generation.
 *  - The dataset: either `BIRD_DIR` pointing at an extracted Mini-Dev directory, or
 *    network access to download it. Both are checked, and the failure is actionable.
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import {
  MicrogliaError,
  fixedClock,
  mulberry32,
  steppingClock,
  type Json,
} from '@agentix-e/microglia-core';
import { EmbeddedMemory, MemoryJournal } from '@agentix-e/microglia-memory';
import { openMicroglia } from '@agentix-e/microglia-capture';
import { createLlmInterpreter, ruleInterpreter, combineInterpreters } from '@agentix-e/microglia-distill';

const run = promisify(execFile);

const DATASET_URL =
  'https://huggingface.co/datasets/birdsql/bird_mini_dev/resolve/main/mini_dev_sqlite.zip';
const ROOT = new URL('..', import.meta.url).pathname;
const CACHE = join(ROOT, '.cache', 'bird');
const RESULTS = join(ROOT, 'poc', 'results');

const LIMIT = Number(process.env['SOTA_LIMIT'] ?? 60);
const MODEL = process.env['SOTA_MODEL'] ?? 'deepseek-chat';
const MAX_CALLS = Number(process.env['POC_MAX_CALLS'] ?? 400);

type BirdRow = {
  readonly question_id: number;
  readonly db_id: string;
  readonly question: string;
  readonly evidence: string;
  readonly SQL: string;
  readonly difficulty: string;
};

type Outcome = {
  readonly questionId: number;
  readonly dbId: string;
  readonly correct: boolean;
  readonly parseOk: boolean;
  readonly execOk: boolean;
  readonly packIds: number;
  readonly latencyMs: number;
};

let calls = 0;

async function chat(prompt: string): Promise<string> {
  if (calls >= MAX_CALLS) throw new MicrogliaError('MG_E_BUDGET_EXCEEDED', 'POC call budget reached');
  calls += 1;
  const key = process.env['DEEPSEEK_API_KEY'];
  if (!key) throw new MicrogliaError('MG_E_CONFIG', 'DEEPSEEK_API_KEY is required');
  const response = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
      max_tokens: 700,
    }),
  });
  if (!response.ok) {
    throw new MicrogliaError('MG_E_STORE_IO', `DeepSeek returned ${response.status}`, {
      body: (await response.text()).slice(0, 400),
    });
  }
  const body = (await response.json()) as { choices: { message: { content: string } }[] };
  return body.choices[0]?.message.content ?? '';
}

async function datasetDir(): Promise<string> {
  const explicit = process.env['BIRD_DIR'];
  if (explicit) {
    if (!existsSync(join(explicit, 'mini_dev_sqlite.json'))) {
      throw new MicrogliaError('MG_E_CONFIG', `BIRD_DIR does not contain mini_dev_sqlite.json`, {
        BIRD_DIR: explicit,
      });
    }
    return explicit;
  }
  const marker = join(CACHE, 'mini_dev_sqlite.json');
  if (existsSync(marker)) return CACHE;
  mkdirSync(CACHE, { recursive: true });
  const zip = join(CACHE, 'mini_dev_sqlite.zip');
  process.stdout.write(`[sota] downloading ${DATASET_URL}\n`);
  let response: Response;
  try {
    response = await fetch(DATASET_URL);
  } catch (error) {
    throw new MicrogliaError('MG_E_STORE_IO', 'Dataset host is unreachable from this network', {
      url: DATASET_URL,
      cause: String(error),
      hint: 'Set BIRD_DIR to an extracted mini_dev_sqlite directory, or run this job where huggingface.co is reachable.',
    });
  }
  if (!response.ok) {
    throw new MicrogliaError('MG_E_STORE_IO', `Dataset download failed (${response.status})`, {
      url: DATASET_URL,
      hint: 'Set BIRD_DIR to an extracted mini_dev_sqlite directory, or run this job where the dataset is reachable.',
    });
  }
  writeFileSync(zip, Buffer.from(await response.arrayBuffer()));
  await run('unzip', ['-q', '-o', zip, '-d', CACHE]);
  if (!existsSync(marker)) {
    // The archive may nest one directory; flatten it rather than guessing.
    const entries = await readdir(CACHE, { withFileTypes: true });
    const nested = entries.find((entry) => entry.isDirectory() && entry.name !== '__MACOSX');
    if (nested && existsSync(join(CACHE, nested.name, 'mini_dev_sqlite.json'))) {
      for (const entry of await readdir(join(CACHE, nested.name))) {
        await run('cp', ['-R', join(CACHE, nested.name, entry), CACHE]);
      }
    }
  }
  if (!existsSync(marker)) {
    throw new MicrogliaError('MG_E_STORE_IO', 'Dataset archive did not contain mini_dev_sqlite.json');
  }
  return CACHE;
}

function ddlOf(dbPath: string): string {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const rows = db
      .prepare("select sql from sqlite_master where type='table' and sql is not null order by name")
      .all() as { sql: string }[];
    return rows.map((row) => row.sql).join('\n');
  } finally {
    db.close();
  }
}

function execute(dbPath: string, sql: string): { ok: boolean; rows: string[] } {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const result = db.prepare(sql).all() as Record<string, unknown>[];
    const rows = result
      .map((row) =>
        Object.keys(row)
          .sort()
          .map((key) => {
            const value = row[key];
            if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(6);
            return value === null || value === undefined ? 'null' : String(value);
          })
          .join('|'),
      )
      .sort();
    return { ok: true, rows };
  } catch {
    return { ok: false, rows: [] };
  } finally {
    db.close();
  }
}

/** BIRD answers are compared as unordered result multisets, the standard EX metric. */
function matches(predicted: string[], gold: string[]): boolean {
  if (predicted.length !== gold.length) return false;
  for (let index = 0; index < gold.length; index += 1) {
    if (predicted[index] !== gold[index]) return false;
  }
  return true;
}

function extractSql(raw: string): string | undefined {
  const fenced = /```(?:sql)?\s*([\s\S]*?)```/i.exec(raw);
  const candidate = (fenced?.[1] ?? raw).trim();
  const statement = /^(select|with)\b[\s\S]*/i.exec(candidate)?.[0];
  return statement?.replace(/;\s*$/, '').trim();
}

function promptFor(row: BirdRow, ddl: string, pack: string): string {
  return [
    'You write one SQLite query that answers the question exactly.',
    'Return the SQL only, in a ```sql fence, with no explanation.',
    'Use only the tables and columns in the schema. Prefer explicit JOINs. Do not invent columns.',
    `Schema:\n${ddl}`,
    row.evidence ? `Evidence (may be wrong; it is external knowledge):\n${row.evidence}` : '',
    pack === '' ? '' : `Workspace conventions learned from earlier corrections:\n${pack}`,
    `Question: ${row.question}`,
  ]
    .filter((line) => line !== '')
    .join('\n\n');
}

async function evaluate(
  host: Awaited<ReturnType<typeof openMicroglia>>,
  rows: readonly BirdRow[],
  dir: string,
  withMemory: boolean,
): Promise<Outcome[]> {
  const out: Outcome[] = [];
  for (const row of rows) {
    const dbPath = join(dir, 'mini_dev_sqlite', `${row.db_id}.sqlite`);
    const ddl = ddlOf(dbPath);
    const pack = withMemory
      ? await host.recall({ task: 'sql.generate', text: row.question, scope: { domain: row.db_id } })
      : undefined;
    const started = performance.now();
    let sql: string | undefined;
    let parseOk = false;
    try {
      sql = extractSql(await chat(promptFor(row, ddl, pack?.rendered ?? '')));
      parseOk = sql !== undefined;
    } catch (error) {
      if (error instanceof MicrogliaError && error.code === 'MG_E_BUDGET_EXCEEDED') throw error;
      parseOk = false;
    }
    const predicted = sql === undefined ? { ok: false, rows: [] } : execute(dbPath, sql);
    const gold = execute(dbPath, row.SQL);
    out.push({
      questionId: row.question_id,
      dbId: row.db_id,
      correct: predicted.ok && gold.ok && matches(predicted.rows, gold.rows),
      parseOk,
      execOk: predicted.ok,
      packIds: pack?.ids.length ?? 0,
      latencyMs: Math.round(performance.now() - started),
    });

    if (withMemory && pack) {
      const runHandle = host.begin({
        task: 'sql.generate',
        input: { question: row.question, domain: row.db_id, schemaDigest: row.db_id },
        pack,
        model: MODEL,
        domainPack: 'bird',
      });
      await runHandle.complete({ sql: sql ?? '' });
      if (predicted.ok && !out[out.length - 1]?.correct) {
        await runHandle.edit({ sql: row.SQL }, { note: 'execution mismatch' });
      }
    }
  }
  return out;
}

function rate(values: readonly boolean[]): number {
  return values.length === 0 ? 0 : values.filter(Boolean).length / values.length;
}

function percentile(values: readonly number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] as number;
}

async function main(): Promise<void> {
  const dir = await datasetDir();
  const all = JSON.parse(
    readFileSync(join(dir, 'mini_dev_sqlite.json'), 'utf8'),
  ) as BirdRow[];
  const slice = all.filter((row) => row.difficulty !== 'simple').slice(0, LIMIT);
  const half = Math.floor(slice.length / 2);
  const learnRows = slice.slice(0, half);
  const evalRows = slice.slice(half);

  const store = await EmbeddedMemory.open(new MemoryJournal());
  const host = await openMicroglia({
    app: 'microglia-sota',
    namespace: 'bird',
    store,
    interpreter: combineInterpreters(
      createLlmInterpreter({ llm: { complete: chat } }),
      ruleInterpreter,
    ),
    budget: 1200,
    clock: steppingClock(1_700_000_000_000, 1),
    random: mulberry32(7),
  });

  // Arm A: no memory.
  const withoutMemory = await evaluate(host, evalRows, dir, false);

  // Learning pass, on a disjoint half, so the eval questions stay unseen.
  for (const row of learnRows) {
    const dbPath = join(dir, 'mini_dev_sqlite', `${row.db_id}.sqlite`);
    const ddl = ddlOf(dbPath);
    const sql = extractSql(await chat(promptFor(row, ddl, ''))) ?? '';
    const handle = host.begin({
      task: 'sql.generate',
      input: { question: row.question, domain: row.db_id, schemaDigest: row.db_id },
      model: MODEL,
      domainPack: 'bird',
    });
    await handle.complete({ sql });
    if (!matches(execute(dbPath, sql).rows, execute(dbPath, row.SQL).rows)) {
      await handle.edit({ sql: row.SQL }, { note: 'execution mismatch' });
    }
  }
  await host.distill({ limit: 200 });

  // Arm B: same questions, with the pack.
  const withMemory = await evaluate(host, evalRows, dir, true);
  const items = await store.listKnowledge({ namespace: 'bird', status: 'all' });
  const stats = await host.stats();
  await host.close();

  const accuracyA = rate(withoutMemory.map((outcome) => outcome.correct));
  const accuracyB = rate(withMemory.map((outcome) => outcome.correct));
  const artifact = {
    id: 'poc-sota-bird',
    dataset: 'BIRD Mini-Dev (sqlite)',
    source: DATASET_URL,
    model: MODEL,
    n: { learn: learnRows.length, eval: evalRows.length },
    calls,
    metrics: {
      accuracy_without_memory: accuracyA,
      accuracy_with_memory: accuracyB,
      delta_pp: (accuracyB - accuracyA) * 100,
      parse_rate: rate(withMemory.map((outcome) => outcome.parseOk)),
      exec_rate: rate(withMemory.map((outcome) => outcome.execOk)),
      mean_pack_ids: withMemory.reduce((sum, outcome) => sum + outcome.packIds, 0) / Math.max(1, withMemory.length),
      latency_p50_ms: percentile(withMemory.map((outcome) => outcome.latencyMs), 0.5),
      latency_p95_ms: percentile(withMemory.map((outcome) => outcome.latencyMs), 0.95),
      knowledge_active: stats.active,
      knowledge_total: stats.knowledge,
    },
    advisory: {
      // At n=60 a 50% rate has a 95% interval of roughly ±13pp, so the accuracy
      // comparison is reported and reviewed rather than enforced by the build.
      gate: 'advisory below 600 questions',
      interval_half_width_pp: 13,
    },
    per_question: withMemory.map((outcome, index) => ({
      ...outcome,
      without_memory_correct: withoutMemory[index]?.correct ?? false,
    })),
    items: items.map((item) => ({
      id: item.id,
      status: item.status,
      trust: item.trust,
      scope: item.scope,
      statement: item.statement,
    })),
    generated_at: new Date().toISOString(),
  };

  mkdirSync(RESULTS, { recursive: true });
  writeFileSync(join(RESULTS, 'poc-sota-bird.json'), `${JSON.stringify(artifact, null, 2)}\n`);
  process.stdout.write(
    `[sota] n=${evalRows.length} without=${(accuracyA * 100).toFixed(2)}% with=${(accuracyB * 100).toFixed(2)}% ` +
      `delta=${artifact.metrics.delta_pp.toFixed(2)}pp parse=${(artifact.metrics.parse_rate * 100).toFixed(1)}% ` +
      `calls=${calls}\n`,
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[sota] failed: ${message}\n`);
  process.exitCode = 1;
});
