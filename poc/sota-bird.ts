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
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

const DATASET_REPO = 'https://huggingface.co/datasets/birdsql/bird_mini_dev';

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

type Dataset = {
  readonly rows: readonly BirdRow[];
  readonly dbPath: (dbId: string) => string;
  /** Where the questions came from, recorded in the artefact. */
  readonly source: string;
};

const CRITIC_REPO = 'https://huggingface.co/datasets/birdsql/bird-critic-1.0-sqlite/resolve/main';
const MINIDEV_REPO = `${DATASET_REPO}/resolve/main`;

async function fetchText(url: string): Promise<string | undefined> {
  try {
    const response = await fetch(url);
    if (!response.ok) return undefined;
    return await response.text();
  } catch {
    return undefined;
  }
}

function normaliseRow(raw: Record<string, unknown>, index: number): BirdRow | undefined {
  const question = raw['question'];
  const sql = raw['SQL'] ?? raw['sql'] ?? raw['query'] ?? raw['gold_sql'];
  const db = raw['db_id'] ?? raw['database'] ?? raw['db'];
  if (typeof question !== 'string' || typeof sql !== 'string' || typeof db !== 'string') return undefined;
  if (question.trim() === '' || sql.trim() === '') return undefined;
  return {
    question_id: typeof raw['question_id'] === 'number' ? raw['question_id'] : index,
    db_id: db,
    question,
    evidence: typeof raw['evidence'] === 'string' ? raw['evidence'] : '',
    SQL: sql,
    difficulty: typeof raw['difficulty'] === 'string' ? raw['difficulty'] : '',
  };
}

/**
 * Accept both shapes the dataset has shipped in: a JSON array and JSON Lines.
 *
 * Hugging Face's `-00000-of-00001.json` files are line-delimited for table
 * datasets and arrays for others, and a parser that assumes one silently reads
 * zero rows from the other. It also tolerates a `{data: [...]}` wrapper, which is
 * what a converted export looks like.
 */
function parseRows(text: string): BirdRow[] {
  const trimmed = text.trim();
  const records: unknown[] = [];
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) records.push(...parsed);
    else if (parsed !== null && typeof parsed === 'object' && Array.isArray((parsed as { data?: unknown }).data)) {
      records.push(...((parsed as { data: unknown[] }).data));
    } else records.push(parsed);
  } catch {
    for (const line of trimmed.split('\n')) {
      if (line.trim() === '') continue;
      try {
        records.push(JSON.parse(line) as unknown);
      } catch {
        // A truncated final line is not a reason to lose the rest of the file.
      }
    }
  }
  const rows: BirdRow[] = [];
  for (const [index, record] of records.entries()) {
    if (record === null || typeof record !== 'object') continue;
    const row = normaliseRow(record as Record<string, unknown>, index);
    if (row !== undefined) rows.push(row);
  }
  return rows;
}

/**
 * Assemble the benchmark from the artefacts that actually exist.
 *
 * The questions and the databases live in two different repositories, and neither
 * mirrors the other: `bird_mini_dev` holds the question bank, `bird-critic` holds
 * the eleven SQLite databases (as `<db>_template.sqlite`). A lane that expects one
 * archive cannot run; a lane that knows both can, with no manual setup.
 */
async function loadDataset(limit: number): Promise<Dataset> {
  const explicit = process.env['BIRD_DIR'];
  if (explicit) {
    mkdirSync(CACHE, { recursive: true });
    const questionsPath = `${explicit}/mini_dev_sqlite.json`;
    const rows = parseRows(readFileSync(questionsPath, 'utf8'));
    return {
      rows: rows.slice(0, limit),
      source: explicit,
      dbPath: (dbId) => `${explicit}/mini_dev_sqlite/${dbId}.sqlite`,
    };
  }

  const sources = [`${CRITIC_REPO}/sqlite-00000-of-00001.jsonl`, `${MINIDEV_REPO}/data/mini_dev_sqlite-00000-of-00001.json`];
  const attempted: string[] = [];
  let rows: BirdRow[] = [];
  let source = '';
  for (const url of sources) {
    attempted.push(url);
    const text = await fetchText(url);
    if (text === undefined) continue;
    rows = parseRows(text);
    if (rows.length > 0) {
      source = url;
      break;
    }
  }
  if (rows.length === 0) {
    throw new MicrogliaError('MG_E_STORE_IO', 'No question file could be read', {
      attempted,
      hint: 'Set BIRD_DIR to an extracted Mini-Dev directory, or BIRD_ARCHIVE_URL to a complete archive.',
    });
  }

  // The lane measures transfer, so the slice skips the easiest third: a question a
  // model answers without help carries no signal for either arm.
  const usable = rows.filter((row) => row.difficulty.toLowerCase() !== 'simple');
  const slice = (usable.length >= limit ? usable : rows).slice(0, limit);

  const dbDir = join(CACHE, 'db');
  mkdirSync(dbDir, { recursive: true });
  const paths = new Map<string, string>();
  for (const dbId of new Set(slice.map((row) => row.db_id))) {
    const dest = join(dbDir, `${dbId}.sqlite`);
    if (!existsSync(dest)) {
      const url = `${CRITIC_REPO}/database/${dbId}/${dbId}_template.sqlite`;
      process.stdout.write(`[sota] downloading database ${dbId}\n`);
      try {
        const response = await fetch(url);
        if (!response.ok) {
          throw new MicrogliaError('MG_E_STORE_IO', `Database '${dbId}' is not in the critic dataset`, {
            url,
            status: response.status,
          });
        }
        writeFileSync(dest, Buffer.from(await response.arrayBuffer()));
      } catch (error) {
        if (error instanceof MicrogliaError) throw error;
        throw new MicrogliaError('MG_E_STORE_IO', `Database '${dbId}' could not be downloaded`, {
          url,
          cause: String(error),
        });
      }
    }
    paths.set(dbId, dest);
  }

  return {
    rows: slice,
    source,
    dbPath: (dbId) => {
      const path = paths.get(dbId);
      if (path === undefined) {
        throw new MicrogliaError('MG_E_STORE_IO', `No database was fetched for '${dbId}'`, {
          dbId,
          known: [...paths.keys()].sort().join(', '),
        });
      }
      return path;
    },
  };
}

async function main(): Promise<void> {
  const dataset = await loadDataset(LIMIT);
  const slice = dataset.rows;
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
  const withoutMemory = await evaluate(host, evalRows, dataset, false);

  // Learning pass, on a disjoint half, so the eval questions stay unseen.
  for (const row of learnRows) {
    const dbPath = dataset.dbPath(row.db_id);
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
  const withMemory = await evaluate(host, evalRows, dataset, true);
  const items = await store.listKnowledge({ namespace: 'bird', status: 'all' });
  const stats = await host.stats();
  await host.close();

  const accuracyA = rate(withoutMemory.map((outcome) => outcome.correct));
  const accuracyB = rate(withMemory.map((outcome) => outcome.correct));
  const artifact = {
    id: 'poc-sota-bird',
    dataset: 'BIRD Mini-Dev (sqlite)',
    source: dataset.source,
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
