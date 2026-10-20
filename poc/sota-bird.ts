/**
 * POC: does the flywheel help on a public text-to-SQL benchmark?
 *
 * The mechanism study holds the generator fixed and measures knowledge transfer.
 * This script is the opposite: a real model, a real benchmark (BIRD Mini-Dev), and
 * execution accuracy as the metric. It answers the question the mechanism study
 * cannot — whether a pack learned from *this* database's corrections helps on
 * *held-out* questions about the same database.
 *
 * Protocol (v3, cross-fitted with controls)
 *  1. Every usable question is assigned to exactly one of `k` folds, balanced and
 *     independent of file order (`assignFolds`). Each question is therefore
 *     evaluated exactly once, and evaluated only by a memory that never saw it.
 *  2. For fold f: a *fresh* memory learns from the k−1 other folds, distils, and
 *     is frozen; the held-out fold is then answered by every configured arm. The
 *     arms share the model, the prompt skeleton, and the schema.
 *  3. The pack is fingerprinted before and after evaluation. Evaluation is
 *     read-only: a run that writes feedback while it is being measured cannot
 *     report a frozen pack.
 *  4. Per-question outcomes are pooled and analysed as a paired design (exact
 *     McNemar, bootstrap interval over questions), arm by arm against the
 *     no-memory arm.
 *
 * Why controls rather than one comparison: a negative delta has four explanations,
 * and they are separable in one run.
 *
 *  | Arm | What it varies | What a result means |
 *  |---|---|---|
 *  | none | nothing | the reference |
 *  | full | the learned pack | the hypothesis |
 *  | narrow | fewer characters, fewer rules | if narrow recovers, the harm is dilution |
 *  | wrong-scope | another database's rules, same token cost | if wrong-scope hurts as much, the harm is length, not content |
 *  | oracle | the gold SQL as the only "convention" | if even this does not move accuracy, the channel is broken |
 *
 * The oracle arm is a channel probe, not a result: it measures the ceiling of
 * injecting text into this prompt, and a lane in which the ceiling is the floor
 * cannot support any conclusion about knowledge.
 *
 * Requirements
 *  - `DEEPSEEK_API_KEY` for generation.
 *  - The dataset: `BIRD_DIR` pointing at an extracted Mini-Dev directory, or
 *    network access to the two Hugging Face repositories that hold the question
 *    bank and the databases. Both are checked, and the failure is actionable.
 *
 * Environment
 *  - `SOTA_LIMIT`      questions to draw (0 = every usable question); default 0
 *  - `SOTA_FOLDS`      cross-fitting folds; default 5
 *  - `SOTA_ARMS`       comma list of full,narrow,wrong-scope,oracle; default all
 *  - `SOTA_SEED`       bootstrap and memory seed; default 7
 *  - `SOTA_GENERALIZE` `false` to distil without scope widening (ablation)
 *  - `SOTA_RESAMPLES`  bootstrap resamples; default 10000, per the protocol
 *  - `POC_MAX_CALLS`   hard call budget; default 4000
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { MicrogliaError, mulberry32, steppingClock } from '@agentix-e/microglia-core';
import { EmbeddedMemory, MemoryJournal } from '@agentix-e/microglia-memory';
import { openMicroglia } from '@agentix-e/microglia-capture';
import {
  combineInterpreters,
  createLlmInterpreter,
  ruleInterpreter,
  type Interpreter,
} from '@agentix-e/microglia-distill';
import {
  assignFolds,
  comparePaired,
  detectableDelta,
  interleaveByKey,
} from '@agentix-e/microglia-eval';

const DATASET_REPO = 'https://huggingface.co/datasets/birdsql/bird_mini_dev';
const CRITIC_REPO = 'https://huggingface.co/datasets/birdsql/bird-critic-1.0-sqlite/resolve/main';
const MINIDEV_REPO = `${DATASET_REPO}/resolve/main`;

const ROOT = new URL('..', import.meta.url).pathname;
const CACHE = join(ROOT, '.cache', 'bird');
const RESULTS = join(ROOT, 'poc', 'results');

const LIMIT = nonNegative(process.env['SOTA_LIMIT'], 0);
const FOLDS = Math.max(2, Math.trunc(nonNegative(process.env['SOTA_FOLDS'], 5)));
const SEED = Math.trunc(nonNegative(process.env['SOTA_SEED'], 7));
const GENERALIZE = (process.env['SOTA_GENERALIZE'] ?? 'true') !== 'false';
const RESAMPLES = Math.max(1000, Math.trunc(nonNegative(process.env['SOTA_RESAMPLES'], 10_000)));
const MODEL = process.env['SOTA_MODEL'] ?? 'deepseek-chat';
const MAX_CALLS = nonNegative(process.env['POC_MAX_CALLS'], 4000);

/** Bumped whenever the prompt text changes; a result without it is unreproducible. */
const PROMPT_VERSION = 'sql-prompt/2';
/** Task name under which knowledge is scoped, and therefore recalled. */
const TASK = 'sql.generate';

type ArmName = 'none' | 'full' | 'narrow' | 'wrong-scope' | 'oracle';

const OPTIONAL_ARMS: readonly Exclude<ArmName, 'none' | 'full'>[] = ['narrow', 'wrong-scope', 'oracle'];

function parseArms(raw: string | undefined): Set<ArmName> {
  const wanted = new Set<ArmName>(['none', 'full']);
  for (const name of (raw ?? OPTIONAL_ARMS.join(',')).split(',')) {
    const trimmed = name.trim();
    if (trimmed === '') continue;
    if (!OPTIONAL_ARMS.includes(trimmed as Exclude<ArmName, 'none' | 'full'>)) {
      throw new MicrogliaError('MG_E_CONFIG', `Unknown arm '${trimmed}'`, {
        known: OPTIONAL_ARMS.join(', '),
      });
    }
    wanted.add(trimmed as ArmName);
  }
  return wanted;
}

const ARMS = parseArms(process.env['SOTA_ARMS']);

function nonNegative(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

type BirdRow = {
  readonly question_id: number;
  readonly db_id: string;
  readonly question: string;
  readonly evidence: string;
  readonly SQL: string;
  readonly difficulty: string;
};

/** One evaluated question, every arm, as the protocol requires. */
type CaseOutcome = {
  readonly id: string;
  readonly questionId: number;
  readonly dbId: string;
  readonly fold: number;
  readonly difficulty: string;
  readonly question: string;
  readonly goldSql: string;
  readonly predictedSql: string;
  readonly correct: boolean;
  readonly withoutMemoryCorrect: boolean;
  readonly parseOk: boolean;
  readonly execOk: boolean;
  readonly packIds: number;
  readonly tokens: number;
  readonly latencyMs: number;
  /** Optional arms, present only when configured. */
  readonly arms: Partial<Record<Exclude<ArmName, 'none' | 'full'>, boolean>>;
  readonly armPackIds: Partial<Record<Exclude<ArmName, 'none' | 'full'>, number>>;
};

let calls = 0;
let tokensUsed = 0;
let retries = 0;

type Reply = { readonly text: string; readonly tokens: number };

/**
 * One model call, with the failure modes a long run actually meets.
 *
 * A two-hour run makes thousands of calls; without a timeout a single stalled
 * socket stops it, and without a retry a single 429 loses the run. Retries are
 * counted and reported, so "it worked" is not confused with "it worked first
 * time". `maxTokens` is a parameter because distillation emits structured JSON and
 * truncating it is invisible: the parse fails and the correction is lost.
 */
async function chat(prompt: string, maxTokens = 700): Promise<Reply> {
  const key = process.env['DEEPSEEK_API_KEY'];
  if (!key) throw new MicrogliaError('MG_E_CONFIG', 'DEEPSEEK_API_KEY is required');
  let last = '';
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (attempt > 0) {
      retries += 1;
      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** (attempt - 1)));
    }
    if (calls >= MAX_CALLS) throw new MicrogliaError('MG_E_BUDGET_EXCEEDED', 'POC call budget reached');
    calls += 1;
    let response: Response;
    try {
      response = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model: MODEL,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0,
          max_tokens: maxTokens,
        }),
        signal: AbortSignal.timeout(60_000),
      });
    } catch (error) {
      last = `network: ${String(error)}`;
      continue;
    }
    if (response.status === 429 || response.status >= 500) {
      last = `status ${response.status}`;
      continue;
    }
    if (!response.ok) {
      throw new MicrogliaError('MG_E_STORE_IO', `DeepSeek returned ${response.status}`, {
        body: (await response.text()).slice(0, 400),
      });
    }
    const body = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { total_tokens?: number };
    };
    const tokens = body.usage?.total_tokens ?? 0;
    tokensUsed += tokens;
    return { text: body.choices?.[0]?.message?.content ?? '', tokens };
  }
  throw new MicrogliaError('MG_E_STORE_IO', 'DeepSeek call failed after retries', { last });
}

type Dataset = {
  readonly rows: readonly BirdRow[];
  readonly dbPath: (dbId: string) => string;
  /** Where the questions came from, recorded in the artefact. */
  readonly source: string;
};

async function fetchText(url: string): Promise<string | undefined> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
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
 * Locate a database inside an extracted Mini-Dev directory.
 *
 * BIRD has shipped two layouts (`mini_dev_sqlite/<db>.sqlite` and
 * `mini_dev_sqlite/<db>/<db>.sqlite`), and guessing one of them produces a lane
 * that "cannot find the database" for a dataset the user extracted correctly. The
 * error names the directory it looked in rather than the database it missed.
 */
function databaseIn(directory: string, dbId: string): string {
  const candidates = [
    join(directory, 'mini_dev_sqlite', `${dbId}.sqlite`),
    join(directory, 'mini_dev_sqlite', dbId, `${dbId}.sqlite`),
    join(directory, `${dbId}.sqlite`),
  ];
  for (const candidate of candidates) if (existsSync(candidate)) return candidate;
  throw new MicrogliaError('MG_E_STORE_IO', `No database file for '${dbId}' under BIRD_DIR`, {
    looked_in: join(directory, 'mini_dev_sqlite'),
    hint: 'Expected mini_dev_sqlite/<db>.sqlite or mini_dev_sqlite/<db>/<db>.sqlite',
  });
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
  let rows: BirdRow[];
  let source: string;
  if (explicit) {
    mkdirSync(CACHE, { recursive: true });
    rows = parseRows(readFileSync(`${explicit}/mini_dev_sqlite.json`, 'utf8'));
    source = explicit;
  } else {
    const sources = [
      `${CRITIC_REPO}/sqlite-00000-of-00001.jsonl`,
      `${MINIDEV_REPO}/data/mini_dev_sqlite-00000-of-00001.json`,
    ];
    const attempted: string[] = [];
    rows = [];
    source = '';
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
  }

  // The lane measures transfer, so the slice skips the easiest third: a question a
  // model answers without help carries no signal for either arm. The remainder is
  // interleaved across databases, because a prefix of a database-sorted file is a
  // sample of one database.
  const usable = rows.filter((row) => row.difficulty.toLowerCase() !== 'simple');
  const pool = usable.length > 0 ? usable : rows;
  const ordered = interleaveByKey(pool, (row) => row.db_id);
  const slice = limit > 0 ? ordered.slice(0, limit) : ordered;

  const dbDir = join(CACHE, 'db');
  mkdirSync(dbDir, { recursive: true });
  const paths = new Map<string, string>();
  for (const dbId of new Set(slice.map((row) => row.db_id))) {
    const dest = join(dbDir, `${dbId}.sqlite`);
    if (!existsSync(dest)) {
      const url = `${CRITIC_REPO}/database/${dbId}/${dbId}_template.sqlite`;
      process.stdout.write(`[sota] downloading database ${dbId}\n`);
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
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
      if (explicit) return databaseIn(explicit, dbId);
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

/**
 * Execute and canonicalise a result set.
 *
 * Rows are compared as JSON arrays of values rather than joined strings: a value
 * that itself contains the separator would otherwise make two different answers
 * look identical.
 */
function execute(dbPath: string, sql: string): { ok: boolean; rows: string[] } {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const result = db.prepare(sql).all() as Record<string, unknown>[];
    const rows = result
      .map((row) =>
        JSON.stringify(
          Object.keys(row)
            .sort()
            .map((key) => {
              const value = row[key];
              if (typeof value === 'number') {
                return Number.isInteger(value) ? value : Number(value.toFixed(6));
              }
              return value === null || value === undefined ? null : String(value);
            }),
        ),
      )
      .sort();
    return { ok: true, rows };
  } catch {
    return { ok: false, rows: [] };
  } finally {
    db.close();
  }
}

/** BIRD answers are compared as unordered multisets, the standard EX metric. */
function matches(predicted: readonly string[], gold: readonly string[]): boolean {
  if (predicted.length !== gold.length) return false;
  for (let index = 0; index < gold.length; index += 1) {
    if (predicted[index] !== gold[index]) return false;
  }
  return true;
}

/**
 * Pull one statement out of a model reply.
 *
 * A fence is authoritative when present. Without one, the first line that starts
 * a statement is used, after leading `--` and block comments are stripped: a model
 * that prefixes a comment has still answered, and treating that as a parse failure
 * would understate the arm.
 */
function extractSql(raw: string): string | undefined {
  const fenced = /```(?:sql)?\s*([\s\S]*?)```/i.exec(raw);
  const body = (fenced?.[1] ?? raw).trim();
  if (body === '') return undefined;
  const stripped = body.replace(/^(?:\s*(?:--[^\n]*\n|\/\*[\s\S]*?\*\/))*\s*/, '');
  const fromStart = /^(select|with)\b[\s\S]*/i.exec(stripped)?.[0];
  const fromLine = /(?:^|\n)\s*((?:select|with)\b[\s\S]*)/i.exec(stripped)?.[1];
  const statement = fromStart ?? fromLine;
  return statement?.replace(/;[\s\n]*$/, '').trim();
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

type Answer = {
  readonly sql: string;
  readonly correct: boolean;
  readonly parseOk: boolean;
  readonly execOk: boolean;
  readonly packIds: number;
  readonly tokens: number;
  readonly latencyMs: number;
};

/**
 * Answer one question under one condition, without writing anything.
 *
 * The evaluation arms are read-only by construction: no run is begun, no feedback
 * is recorded. An earlier version recorded a correction here, which meant the
 * store under measurement grew while it was measured.
 */
async function answer(
  row: BirdRow,
  dataset: Dataset,
  packText: string,
  packIds: number,
): Promise<Answer> {
  const dbPath = dataset.dbPath(row.db_id);
  const ddl = ddlOf(dbPath);
  const started = performance.now();
  let sql = '';
  let parseOk = false;
  let tokens = 0;
  try {
    const reply = await chat(promptFor(row, ddl, packText));
    tokens = reply.tokens;
    const extracted = extractSql(reply.text);
    sql = extracted ?? '';
    parseOk = extracted !== undefined;
  } catch (error) {
    if (error instanceof MicrogliaError && error.code === 'MG_E_BUDGET_EXCEEDED') throw error;
    parseOk = false;
  }
  const predicted = sql === '' ? { ok: false, rows: [] } : execute(dbPath, sql);
  const gold = execute(dbPath, row.SQL);
  return {
    sql,
    correct: predicted.ok && gold.ok && matches(predicted.rows, gold.rows),
    parseOk,
    execOk: predicted.ok,
    packIds,
    tokens,
    latencyMs: Math.round(performance.now() - started),
  };
}

type LearningPass = {
  readonly rows: number;
  readonly edited: number;
  readonly goldFailed: number;
};

/**
 * The learning pass: generate, compare against the gold result, correct on a
 * mismatch.
 *
 * A generation that does not execute is a correction worth learning from, and the
 * comparison is result-based rather than text-based: a query that returns the
 * wrong rows is wrong even when it runs. The earlier version compared only result
 * sets and therefore treated a failed generation as correct whenever the gold
 * query happened to return no rows — the exact cases most worth learning from.
 */
async function learn(
  host: Awaited<ReturnType<typeof openMicroglia>>,
  rows: readonly BirdRow[],
  dataset: Dataset,
): Promise<LearningPass> {
  let edited = 0;
  let goldFailed = 0;
  for (const row of rows) {
    const dbPath = dataset.dbPath(row.db_id);
    const ddl = ddlOf(dbPath);
    const sql = extractSql((await chat(promptFor(row, ddl, ''))).text) ?? '';
    const handle = host.begin({
      task: TASK,
      input: { question: row.question, domain: row.db_id, schemaDigest: row.db_id },
      model: MODEL,
      promptVersion: PROMPT_VERSION,
      domainPack: 'bird',
    });
    await handle.complete({ sql });
    const predicted = execute(dbPath, sql);
    const gold = execute(dbPath, row.SQL);
    if (!gold.ok) {
      goldFailed += 1;
      continue;
    }
    if (!predicted.ok || !matches(predicted.rows, gold.rows)) {
      await handle.edit({ sql: row.SQL }, { note: 'execution mismatch' });
      edited += 1;
    }
  }
  return { rows: rows.length, edited, goldFailed };
}

/** A stable digest of what is stored, used to prove the pack was frozen. */
async function knowledgeDigest(
  store: EmbeddedMemory,
): Promise<{ active: number; total: number; digest: string }> {
  const items = await store.listKnowledge({ namespace: 'bird', status: 'all' });
  const active = items.filter((item) => item.status === 'active');
  const canonical = [...items]
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map((item) => [item.id, item.status, item.trust, item.statement].join('\u0000'))
    .join('\u0001');
  return {
    active: active.length,
    total: items.length,
    digest: createHash('sha256').update(canonical).digest('hex').slice(0, 16),
  };
}

type StoredItem = {
  readonly id: string;
  readonly status: string;
  readonly trust: number;
  readonly statement: string;
  /** The database the rule is scoped to, or null when it generalised out of one. */
  readonly domain: string | null;
};

type FoldResult = {
  readonly fold: number;
  readonly learn: number;
  readonly eval: number;
  readonly cases: readonly CaseOutcome[];
  readonly learning: LearningPass;
  readonly activeRules: number;
  readonly failedDistill: number;
  readonly created: number;
  readonly meanPackIds: number;
  readonly digest: string;
  readonly items: readonly StoredItem[];
  readonly distillFailures: readonly string[];
};

/**
 * Wrap an interpreter so a parse failure leaves a reason behind.
 *
 * Counting failures is not enough to fix them: the message distinguishes a
 * truncated response (max_tokens) from a schema mismatch (the model answered in
 * the wrong shape), and those need different repairs.
 */
function recording(inner: Interpreter, sink: string[]): Interpreter {
  return async (context) => {
    try {
      return await inner(context);
    } catch (error) {
      if (sink.length < 5) {
        sink.push((error instanceof Error ? error.message : String(error)).slice(0, 200));
      }
      throw error;
    }
  };
}

async function runFold(
  fold: number,
  rows: readonly BirdRow[],
  foldOf: ReadonlyMap<string, number>,
  dataset: Dataset,
): Promise<FoldResult> {
  const idOf = (row: BirdRow): string => `${row.db_id}#${row.question_id}`;
  const evalRows = rows.filter((row) => foldOf.get(idOf(row)) === fold);
  const learnRows = rows.filter((row) => foldOf.get(idOf(row)) !== fold);

  const store = await EmbeddedMemory.open(new MemoryJournal());
  const distillFailures: string[] = [];
  const host = await openMicroglia({
    app: 'microglia-sota',
    namespace: 'bird',
    store,
    interpreter: combineInterpreters(
      recording(
        createLlmInterpreter({
          llm: { complete: (prompt) => chat(prompt, 1400).then((reply) => reply.text) },
        }),
        distillFailures,
      ),
      ruleInterpreter,
    ),
    budget: 1200,
    clock: steppingClock(1_700_000_000_000, 1),
    random: mulberry32(SEED),
  });

  const learning = await learn(host, learnRows, dataset);
  const distilled = await host.distill({ generalize: GENERALIZE });
  const frozen = await knowledgeDigest(store);

  // The wrong-scope control must inject text, or it silently becomes a second
  // no-memory arm. It therefore rotates to the next database that actually holds
  // at least one active rule; with a single such database the control degenerates
  // and `mean_pack_ids` in the artefact shows it.
  const withRules = [...new Set(
    (await store.listKnowledge({ namespace: 'bird', status: 'active' }))
      .map((item) => item.scope.domain)
      .filter((domain): domain is string => typeof domain === 'string'),
  )].sort();
  const databases = withRules.length > 0 ? withRules : [...new Set(rows.map((row) => row.db_id))].sort();
  const nextDatabase = (dbId: string): string => {
    const index = databases.indexOf(dbId);
    if (index === -1) return databases[0] as string;
    return databases[(index + 1) % databases.length] ?? dbId;
  };

  const cases: CaseOutcome[] = [];
  for (const row of evalRows) {
    const query = { task: TASK, text: row.question };
    const pack = await host.recall({ ...query, scope: { domain: row.db_id } });
    const base = await answer(row, dataset, '', 0);
    const full = await answer(row, dataset, pack.rendered, pack.ids.length);

    const arms: Partial<Record<Exclude<ArmName, 'none' | 'full'>, boolean>> = {};
    const armPackIds: Partial<Record<Exclude<ArmName, 'none' | 'full'>, number>> = {};
    if (ARMS.has('narrow')) {
      const narrow = await host.recall({
        ...query,
        scope: { domain: row.db_id },
        budget: 400,
        limit: 3,
      });
      const result = await answer(row, dataset, narrow.rendered, narrow.ids.length);
      arms.narrow = result.correct;
      armPackIds.narrow = result.packIds;
    }
    if (ARMS.has('wrong-scope')) {
      const wrong = await host.recall({ ...query, scope: { domain: nextDatabase(row.db_id) } });
      const result = await answer(row, dataset, wrong.rendered, wrong.ids.length);
      arms['wrong-scope'] = result.correct;
      armPackIds['wrong-scope'] = result.packIds;
    }
    if (ARMS.has('oracle')) {
      const result = await answer(row, dataset, `- ${row.SQL}`, 0);
      arms.oracle = result.correct;
      armPackIds.oracle = 0;
    }

    cases.push({
      id: idOf(row),
      questionId: row.question_id,
      dbId: row.db_id,
      fold,
      difficulty: row.difficulty,
      question: row.question,
      goldSql: row.SQL,
      predictedSql: full.sql,
      correct: full.correct,
      withoutMemoryCorrect: base.correct,
      parseOk: full.parseOk,
      execOk: full.execOk,
      packIds: full.packIds,
      tokens: full.tokens,
      latencyMs: full.latencyMs,
      arms,
      armPackIds,
    });
  }

  const after = await knowledgeDigest(store);
  if (after.digest !== frozen.digest) {
    throw new MicrogliaError('MG_E_CONFIG', 'Evaluation mutated knowledge', {
      fold,
      before: frozen.digest,
      after: after.digest,
    });
  }
  const items = (await store.listKnowledge({ namespace: 'bird', status: 'all' })).map((item) => ({
    id: item.id,
    status: item.status,
    trust: Number(item.trust.toFixed(4)),
    statement: item.statement,
    domain: item.scope.domain ?? null,
  }));
  await host.close();

  const packIds = cases.reduce((sum, item) => sum + item.packIds, 0);
  process.stdout.write(
    `[sota] fold ${fold + 1}/${FOLDS}: eval=${cases.length} learn=${learnRows.length} ` +
      `edited=${learning.edited} active=${frozen.active} calls=${calls}\n`,
  );
  return {
    fold,
    learn: learnRows.length,
    eval: cases.length,
    cases,
    learning,
    activeRules: frozen.active,
    failedDistill: distilled.failed,
    created: distilled.created,
    meanPackIds: cases.length === 0 ? 0 : packIds / cases.length,
    digest: frozen.digest,
    items,
    distillFailures,
  };
}

function rate(values: readonly boolean[]): number {
  return values.length === 0 ? 0 : values.filter(Boolean).length / values.length;
}

function percentile(values: readonly number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] as number;
}

type ArmSummary = {
  readonly arm: ArmName;
  readonly n: number;
  readonly accuracy: number;
  readonly delta_pp: number;
  readonly ci_low_pp: number;
  readonly ci_high_pp: number;
  readonly p_value: number;
  readonly gained: number;
  readonly lost: number;
  readonly mean_pack_ids: number;
};

async function main(): Promise<void> {
  const dataset = await loadDataset(LIMIT);
  const rows = dataset.rows;
  if (rows.length < FOLDS) {
    throw new MicrogliaError('MG_E_CONFIG', 'Not enough questions for the requested folds', {
      questions: rows.length,
      folds: FOLDS,
    });
  }
  const idOf = (row: BirdRow): string => `${row.db_id}#${row.question_id}`;
  const foldOf = assignFolds(
    rows.map((row) => idOf(row)),
    FOLDS,
  );

  const folds: FoldResult[] = [];
  for (let fold = 0; fold < FOLDS; fold += 1) {
    folds.push(await runFold(fold, rows, foldOf, dataset));
  }

  const cases = folds.flatMap((fold) => fold.cases);
  const withoutMemory = cases.map((item) => item.withoutMemoryCorrect);
  const withMemory = cases.map((item) => item.correct);
  const paired = comparePaired(withoutMemory, withMemory, SEED, RESAMPLES);
  const meanPackIds = cases.reduce((sum, item) => sum + item.packIds, 0) / Math.max(1, cases.length);
  const activeMean = folds.reduce((sum, fold) => sum + fold.activeRules, 0) / Math.max(1, folds.length);

  // Every question exactly once, and never learned from in its own fold. A split
  // that violates either property makes the comparison meaningless, so both are
  // computed rather than assumed.
  const seen = new Set<string>();
  let duplicated = 0;
  let leaked = 0;
  for (const fold of folds) {
    for (const item of fold.cases) {
      if (seen.has(item.id)) duplicated += 1;
      seen.add(item.id);
      if (foldOf.get(item.id) !== fold.fold) leaked += 1;
    }
  }
  const partitionOk = duplicated === 0 && seen.size === rows.length && leaked === 0;

  const parseRate = rate(cases.map((item) => item.parseOk));
  const execRate = rate(cases.map((item) => item.execOk));
  const learnTotal = folds.reduce((sum, fold) => sum + fold.learn, 0);
  const goldFailures = folds.reduce((sum, fold) => sum + fold.learning.goldFailed, 0);
  const goldExecRate = learnTotal === 0 ? 1 : 1 - goldFailures / learnTotal;
  const detectable = detectableDelta(cases.length, paired.discordance);

  const arms: ArmSummary[] = [
    {
      arm: 'full',
      n: paired.n,
      accuracy: paired.treatmentAccuracy,
      delta_pp: paired.delta * 100,
      ci_low_pp: paired.deltaCI.low * 100,
      ci_high_pp: paired.deltaCI.high * 100,
      p_value: paired.p,
      gained: paired.gained,
      lost: paired.lost,
      mean_pack_ids: meanPackIds,
    },
  ];
  for (const name of OPTIONAL_ARMS) {
    const present = cases.filter((item) => item.arms[name] !== undefined);
    if (present.length === 0) continue;
    const comparison = comparePaired(
      present.map((item) => item.withoutMemoryCorrect),
      present.map((item) => item.arms[name] === true),
      SEED,
      RESAMPLES,
    );
    arms.push({
      arm: name,
      n: comparison.n,
      accuracy: comparison.treatmentAccuracy,
      delta_pp: comparison.delta * 100,
      ci_low_pp: comparison.deltaCI.low * 100,
      ci_high_pp: comparison.deltaCI.high * 100,
      p_value: comparison.p,
      gained: comparison.gained,
      lost: comparison.lost,
      mean_pack_ids:
        present.reduce((sum, item) => sum + (item.armPackIds[name] ?? 0), 0) / present.length,
    });
  }

  const oracle = arms.find((entry) => entry.arm === 'oracle');
  const gates = [
    {
      id: 'V1-pack-not-empty',
      criterion: 'the memory arm injected at least one rule per question on average',
      actual: `${meanPackIds.toFixed(2)} rules/question`,
      pass: meanPackIds > 0,
      blocking: true,
    },
    {
      id: 'V2-fold-partition',
      criterion: 'every question is evaluated exactly once, by a memory that never learned from it',
      actual: `${seen.size}/${rows.length} questions, ${duplicated} duplicates, ${leaked} leaks`,
      pass: partitionOk,
      blocking: true,
    },
    {
      id: 'V3-parse-rate',
      criterion: 'at least 90% of replies contain a statement',
      actual: `${(parseRate * 100).toFixed(2)}%`,
      pass: parseRate >= 0.9,
      blocking: true,
    },
    {
      id: 'V4-gold-executable',
      criterion: 'at least 99% of gold queries execute, or the dataset is not usable',
      actual: `${(goldExecRate * 100).toFixed(2)}%`,
      pass: goldExecRate >= 0.99,
      blocking: true,
    },
    {
      id: 'V5-resolution',
      criterion: 'the sample can resolve a 6pp effect at 80% power',
      actual: `minimum detectable ${(detectable * 100).toFixed(2)}pp at n=${cases.length}`,
      pass: detectable <= 0.06,
      blocking: false,
    },
    {
      id: 'V6-channel',
      criterion: 'injecting the gold SQL as a convention moves accuracy by at least 10pp',
      actual:
        oracle === undefined
          ? 'oracle arm not run'
          : `${oracle.delta_pp.toFixed(2)}pp with oracle hint`,
      pass: oracle === undefined ? true : oracle.delta_pp >= 10,
      blocking: true,
    },
  ];

  const assertions = {
    /**
     * Not a gate: a violation throws inside the fold, because a pack that changed
     * while being measured makes the number it produced meaningless rather than
     * merely doubtful. The digest is recorded here so the claim is auditable.
     */
    pack_frozen_during_eval: folds.map((fold) => `fold ${fold.fold}: ${fold.digest}`).join(', '),
    evaluation_writes_no_feedback: true,
  };

  const items = folds.flatMap((fold) =>
    fold.items.map((item) => ({ fold: fold.fold, ...item })),
  );
  const artifact = {
    id: 'poc-sota-bird',
    protocol: 'cross-fitted-kfold/3',
    dataset: 'BIRD Mini-Dev (sqlite)',
    source: dataset.source,
    model: MODEL,
    prompt_version: PROMPT_VERSION,
    config: {
      folds: FOLDS,
      seed: SEED,
      limit: LIMIT,
      generalize: GENERALIZE,
      resamples: RESAMPLES,
      budget_chars: 1200,
      narrow_budget_chars: 400,
      narrow_items: 3,
      arms: [...ARMS],
      task: TASK,
    },
    n: {
      total: rows.length,
      eval: cases.length,
      learn_mean: folds.reduce((sum, fold) => sum + fold.learn, 0) / Math.max(1, folds.length),
      databases: new Set(rows.map((row) => row.db_id)).size,
    },
    calls,
    retries,
    tokens: tokensUsed,
    metrics: {
      accuracy_without_memory: paired.baselineAccuracy,
      accuracy_with_memory: paired.treatmentAccuracy,
      delta_pp: paired.delta * 100,
      parse_rate: parseRate,
      exec_rate: execRate,
      gold_exec_rate: goldExecRate,
      mean_pack_ids: meanPackIds,
      latency_p50_ms: percentile(cases.map((item) => item.latencyMs), 0.5),
      latency_p95_ms: percentile(cases.map((item) => item.latencyMs), 0.95),
      knowledge_active_mean: activeMean,
      knowledge_active_last: folds.at(-1)?.activeRules ?? 0,
      distill_failed: folds.reduce((sum, fold) => sum + fold.failedDistill, 0),
      distill_created: folds.reduce((sum, fold) => sum + fold.created, 0),
      corrections_learned: folds.reduce((sum, fold) => sum + fold.learning.edited, 0),
    },
    paired: {
      n: paired.n,
      lost: paired.lost,
      gained: paired.gained,
      discordance: paired.discordance,
      p_value: paired.p,
      delta_pp: paired.delta * 100,
      ci_low_pp: paired.deltaCI.low * 100,
      ci_high_pp: paired.deltaCI.high * 100,
      min_detectable_pp: detectable * 100,
    },
    arms,
    gates,
    assertions,
    per_fold: folds.map((fold) => ({
      fold: fold.fold,
      eval: fold.eval,
      learn: fold.learn,
      edited: fold.learning.edited,
      active: fold.activeRules,
      failed_distill: fold.failedDistill,
      mean_pack_ids: Number(fold.meanPackIds.toFixed(3)),
      without_memory: rate(fold.cases.map((item) => item.withoutMemoryCorrect)),
      with_memory: rate(fold.cases.map((item) => item.correct)),
      delta_pp: (rate(fold.cases.map((item) => item.correct)) -
        rate(fold.cases.map((item) => item.withoutMemoryCorrect))) * 100,
    })),
    distill_failure_samples: [...new Set(folds.flatMap((fold) => fold.distillFailures))].slice(0, 8),
    per_case: cases,
    items,
    generated_at: new Date().toISOString(),
  };

  mkdirSync(RESULTS, { recursive: true });
  writeFileSync(join(RESULTS, 'poc-sota-bird.json'), `${JSON.stringify(artifact, null, 2)}\n`);
  process.stdout.write(
    `[sota] n=${cases.length} without=${(paired.baselineAccuracy * 100).toFixed(2)}% ` +
      `with=${(paired.treatmentAccuracy * 100).toFixed(2)}% delta=${(paired.delta * 100).toFixed(2)}pp ` +
      `ci=[${(paired.deltaCI.low * 100).toFixed(2)}, ${(paired.deltaCI.high * 100).toFixed(2)}] ` +
      `p=${paired.p.toFixed(4)} min-detectable=${(detectable * 100).toFixed(2)}pp calls=${calls}\n`,
  );
  for (const entry of arms.slice(1)) {
    process.stdout.write(
      `[sota] arm ${entry.arm}: ${(entry.accuracy * 100).toFixed(2)}% ` +
        `delta=${entry.delta_pp.toFixed(2)}pp p=${entry.p_value.toFixed(4)} ` +
        `pids=${entry.mean_pack_ids.toFixed(2)}\n`,
    );
  }

  const failed = gates.filter((gate) => gate.blocking && !gate.pass);
  if (failed.length > 0) {
    throw new MicrogliaError(
      'MG_E_CONFIG',
      'The benchmark ran but cannot support a claim',
      { failed: failed.map((gate) => `${gate.id}: ${gate.actual}`) },
    );
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[sota] failed: ${message}\n`);
  process.exitCode = 1;
});
