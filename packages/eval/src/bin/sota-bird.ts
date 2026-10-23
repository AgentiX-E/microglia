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
 *  | gated | only rules that mention a third of the question | if the gate recovers the delta, the harm was injecting rules the question never mentioned |
 *  | duplicate | the same pack, twice | if duplication hurts, the harm is length, not content |
 *  | wrong-scope | another database's rules, same token cost | if wrong-scope hurts as much, any hint hurts; if not, the content is the problem |
 *  | oracle | the gold SQL as the only "convention" | if even this does not move accuracy, the channel is broken |
 *
 * A control that injects nothing is not a control, so every optional arm is held
 * to `mean_pack_ids > 0` by gate V7. The first attempt at a dilution control used
 * a 400-character budget and rendered an empty block on every question: the packs
 * are already two rules deep, so the only honest dose is repetition, not fewer
 * characters.
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
 *  - `SOTA_ARMS`       comma list of full,duplicate,wrong-scope,oracle; default all
 *  - `SOTA_SEED`       bootstrap and memory seed; default 7
 *  - `SOTA_GENERALIZE` `false` to distil without scope widening (ablation)
 *  - `SOTA_RESAMPLES`  bootstrap resamples; default 10000, per the protocol
 *  - `POC_MAX_CALLS`   hard call budget; default 4000
 */
import { writeJson } from './lib.js';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { MicrogliaError, mulberry32, queryCoverage, steppingClock } from '@agentix-e/microglia-core';
import { EmbeddedMemory, MemoryJournal } from '@agentix-e/microglia-core/memory';
import { openMicroglia } from '@agentix-e/microglia-core/capture';
import {
  combineInterpreters,
  createLlmInterpreter,
  ruleInterpreter,
  type Interpreter,
} from '@agentix-e/microglia-core/distill';
import {
  archiveVerdict,
  assignFolds,
  dedupeQuestions,
  comparePaired,
  detectableDelta,
  interleaveByKey,
  missingDatabases,
  parseManifest,
  requirePopulated,
  sha256OfFile,
  type BirdManifest,
} from '@agentix-e/microglia-eval';

const DATASET_REPO = 'https://huggingface.co/datasets/birdsql/bird_mini_dev';
const CRITIC_REPO = 'https://huggingface.co/datasets/birdsql/bird-critic-1.0-sqlite/resolve/main';
const MINIDEV_REPO = `${DATASET_REPO}/resolve/main`;

/** `packages/eval/src` — the lane's own directory. */
const ROOT = new URL('..', import.meta.url).pathname;
/** The repository root, three levels up: `src` → `eval` → `packages` → `.`. */
const REPO = join(ROOT, '..', '..', '..');
const CACHE = join(ROOT, '..', '.cache', 'bird');

const LIMIT = nonNegative(process.env['SOTA_LIMIT'], 0);
const FOLDS = Math.max(2, Math.trunc(nonNegative(process.env['SOTA_FOLDS'], 5)));
const SEED = Math.trunc(nonNegative(process.env['SOTA_SEED'], 7));
const GENERALIZE = (process.env['SOTA_GENERALIZE'] ?? 'true') !== 'false';
const RESAMPLES = Math.max(1000, Math.trunc(nonNegative(process.env['SOTA_RESAMPLES'], 10_000)));
const MODEL = process.env['SOTA_MODEL'] ?? 'deepseek-chat';
const MAX_CALLS = nonNegative(process.env['POC_MAX_CALLS'], 4000);

/** Bumped whenever the prompt text changes; a result without it is unreproducible. */
const PROMPT_VERSION = 'sql-prompt/2';

/**
 * The house convention of the S2b protocol (roadmap): a workspace that reports
 * numeric answers in thousands, rounded to three decimals.
 *
 * It is deliberately unreachable from the schema — no column says "divide by a
 * thousand" — which is the property every measurement in this repository that
 * moved accuracy has in common. `SOTA_CONVENTION=thousands` turns the lane into
 * that experiment; empty keeps the ordinary execution-accuracy lane.
 */
const CONVENTION = (process.env['SOTA_CONVENTION'] ?? '').trim();

/**
 * The two conventions the lane can impose, both of them transformations the schema
 * cannot reveal.
 *
 * `thousands` scales a quantity, so it only means something for values large
 * enough to survive the division — the first attempt applied it to counts and
 * produced expected answers like 0.007.
 * `round10` is a coarse-reporting rule that is defined for every numeric answer,
 * which is what the subset needs in order to stay above twenty questions.
 */
const CONVENTIONS = {
  thousands: {
    sentence: 'This workspace reports numeric answers in thousands, rounded to three decimals.',
    transform: (value: number): number => Math.round((value / 1000) * 1000) / 1000,
    sql: (body: string): string => `SELECT ROUND((${body}) / 1000.0, 3)`,
    applies: (value: number): boolean => Math.abs(value) >= 1000,
  },
  round10: {
    sentence: 'This workspace reports every numeric answer rounded to the nearest ten.',
    transform: (value: number): number => Math.round(value / 10) * 10,
    sql: (body: string): string => `SELECT ROUND((${body}) / 10.0) * 10`,
    applies: (): boolean => true,
  },
} as const;

type ConventionName = keyof typeof CONVENTIONS;
const ACTIVE = CONVENTION === '' ? undefined : CONVENTIONS[CONVENTION as ConventionName];

type Task = {
  /** True when answers are judged under the house convention. */
  readonly convention: boolean;
  /** The expected reported value per case id, when the convention is on. */
  readonly expected: ReadonlyMap<string, number>;
};
/** Task name under which knowledge is scoped, and therefore recalled. */
const TASK = 'sql.generate';

type ArmName = 'none' | 'full' | 'gated' | 'duplicate' | 'wrong-scope' | 'stated' | 'oracle';

const OPTIONAL_ARMS: readonly Exclude<ArmName, 'none' | 'full'>[] = [
  'gated',
  'duplicate',
  'wrong-scope',
  'stated',
  'oracle',
];

/**
 * The coverage floor the `gated` arm runs with, fixed before the run.
 *
 * `0.01` is "the rule mentions at least one of the question's content words",
 * which is the weakest gate that still means something. A first attempt used
 * 0.34 and rendered an empty pack on all 352 questions: measured on this dataset
 * the median pack covers 7.1% of the question and 47% of packs cover none of it,
 * so a third of the words is not a threshold, it is a filter on everything.
 */
const MIN_COVERAGE = Math.min(1, Math.max(0, nonNegative(process.env['SOTA_MIN_COVERAGE'], 0.01)));

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
  /** Coverage of the question by the full pack's best rule, in [0, 1]. */
  readonly coverage: number;
  /** The value the convention requires, when the convention is on. */
  readonly expected: number | null;
  /** The rules the full arm actually injected, for per-rule attribution. */
  readonly packIdList: readonly string[];
  readonly tokens: number;
  readonly latencyMs: number;
  /** Optional arms, present only when configured. */
  readonly arms: Partial<Record<Exclude<ArmName, 'none' | 'full'>, boolean>>;
  /**
   * The statement each control arm produced. Without it a failed control can only
   * be described ("the oracle moved nothing"), not diagnosed ("the oracle wrote
   * the un-scaled query").
   */
  readonly armSql: Partial<Record<Exclude<ArmName, 'none' | 'full'>, string>>;
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
      // 402 is not a transient failure and not a code defect: the account has no
      // balance. Saying so turns a benchmark that "failed" into a config problem
      // somebody can fix, and stops anyone from reading it as a regression.
      const body = (await response.text()).slice(0, 400);
      if (response.status === 402) {
        throw new MicrogliaError(
          'MG_E_CONFIG',
          'DeepSeek refused the call for lack of credit (402); no benchmark was run',
          { hint: 'Top up the account behind DEEPSEEK_API_KEY, then dispatch again.', body },
        );
      }
      throw new MicrogliaError('MG_E_STORE_IO', `DeepSeek returned ${response.status}`, { body });
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
  /** Rows the archive repeats verbatim: dropped, and stated in the artefact. */
  readonly duplicates: number;
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
    // The pinned archive's layout: MINIDEV/dev_databases/<db>/<db>.sqlite.
    join(directory, 'dev_databases', dbId, `${dbId}.sqlite`),
    join(directory, 'mini_dev_sqlite', `${dbId}.sqlite`),
    join(directory, 'mini_dev_sqlite', dbId, `${dbId}.sqlite`),
    join(directory, `${dbId}.sqlite`),
  ];
  for (const candidate of candidates) if (existsSync(candidate)) return candidate;
  throw new MicrogliaError('MG_E_STORE_IO', `No database file for '${dbId}' under BIRD_DIR`, {
    looked_in: directory,
    hint: 'Expected dev_databases/<db>/<db>.sqlite (the pinned archive) or mini_dev_sqlite/<db>.sqlite',
  });
}

const MANIFEST = join(REPO, 'eval', 'manifests', 'bird-minidev.json');

function loadManifest(): BirdManifest {
  return parseManifest(JSON.parse(readFileSync(MANIFEST, 'utf8')));
}

/**
 * Fetch, verify and extract the pinned archive.
 *
 * The digest is checked before the zip is opened: an archive that was truncated,
 * mirrored or rebuilt changes every number the lane produces, and a size check
 * alone would accept a same-size substitution. Extraction goes through the system
 * `unzip` because Node has no zip reader and adding one would put a dependency in
 * a lane that otherwise has none.
 */
async function prepareArchive(url: string): Promise<string> {
  const manifest = loadManifest();
  const dest = join(CACHE, 'minidev.zip');
  mkdirSync(CACHE, { recursive: true });

  if (!existsSync(dest) || statSync(dest).size !== manifest.bytes) {
    process.stdout.write(`[sota] downloading ${url}\n`);
    const response = await fetch(url, { signal: AbortSignal.timeout(600_000) });
    if (!response.ok) {
      throw new MicrogliaError('MG_E_STORE_IO', `The dataset archive answered ${response.status}`, {
        url,
        hint: 'Set BIRD_DIR to an extracted Mini-Dev directory instead.',
      });
    }
    writeFileSync(dest, Buffer.from(await response.arrayBuffer()));
  }

  const verdict = archiveVerdict(manifest, {
    bytes: statSync(dest).size,
    sha256: await sha256OfFile(dest),
  });
  if (!verdict.ok) {
    throw new MicrogliaError('MG_E_STORE_IO', `The dataset archive failed its ${verdict.reason} check`, {
      url,
      expected_sha256: manifest.sha256,
      expected_bytes: manifest.bytes,
      hint: 'Delete .cache/bird/minidev.zip and re-run; a mirror that differs is not this dataset.',
    });
  }

  const root = join(CACHE, 'minidev');
  const extracted = join(root, manifest.root);
  if (!existsSync(extracted)) {
    process.stdout.write('[sota] extracting the archive\n');
    execFileSync('unzip', ['-q', '-o', dest, '-d', root], { stdio: 'inherit' });
  }
  return extracted;
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
  mkdirSync(CACHE, { recursive: true });

  // The database root first, because the archive also carries the questions: one
  // artefact, one digest, and the questions cannot disagree with the databases
  // they were written against.
  let dbRoot = explicit;
  if (dbRoot === undefined) {
    const archiveUrl = process.env['BIRD_ARCHIVE_URL'];
    if (archiveUrl === undefined || archiveUrl === '') {
      throw new MicrogliaError('MG_E_STORE_IO', 'No BIRD database source is configured', {
        hint: 'Set BIRD_DIR to an extracted Mini-Dev directory, or BIRD_ARCHIVE_URL to the pinned archive (see eval/manifests/bird-minidev.json).',
      });
    }
    dbRoot = await prepareArchive(archiveUrl);
  }
  const root: string = dbRoot;

  let rows: BirdRow[];
  let source: string;
  const local = join(root, 'mini_dev_sqlite.json');
  if (existsSync(local)) {
    rows = parseRows(readFileSync(local, 'utf8'));
    source = local;
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
        hint: 'The pinned archive carries mini_dev_sqlite.json; a directory without it needs a network.',
      });
    }
  }

  // The pinned file repeats two rows verbatim (`financial#137`, `#138`), so 500
  // records describe 498 questions and the fold assignment — which is keyed by
  // `db_id#question_id` and refuses duplicate keys — would refuse the whole run.
  // The repeats are dropped and counted, and the count travels with the artefact.
  const deduped = dedupeQuestions(rows);
  rows = [...deduped.rows];
  if (deduped.duplicates > 0) {
    process.stdout.write(`[sota] dropped ${deduped.duplicates} repeated question(s)\n`);
  }

  // The lane measures transfer, so the slice skips the easiest third: a question a
  // model answers without help carries no signal for either arm. The remainder is
  // interleaved across databases, because a prefix of a database-sorted file is a
  // sample of one database.
  const usable = rows.filter((row) => row.difficulty.toLowerCase() !== 'simple');
  const pool = usable.length > 0 ? usable : rows;
  const ordered = interleaveByKey(pool, (row) => row.db_id);
  const slice = limit > 0 ? ordered.slice(0, limit) : ordered;

  // There is deliberately no third database source: the lane used to fall back to
  // `bird-critic`'s `<db>_template.sqlite` files, which are the schema and not the
  // data. Against an empty database the gold query and the predicted query both
  // return no rows, so `matches` scores a runnable SELECT as correct — a number
  // about parse success wearing the name of execution accuracy.
  const used = new Set(slice.map((row) => row.db_id));
  const manifest = loadManifest();
  const missing = missingDatabases(manifest, [...used]);
  if (missing.length > 0) {
    throw new MicrogliaError('MG_E_STORE_IO', 'The questions reference databases the archive does not carry', {
      missing: missing.join(', '),
      archive: manifest.version,
    });
  }

  // Every database is counted once, before any model call. A schema-only database
  // makes every runnable query "correct", so this check is the difference between
  // a measurement and a plausible number.
  for (const dbId of used) {
    const counted = requirePopulated(databaseIn(root, dbId), dbId);
    process.stdout.write(`[sota] data ok: ${dbId} ${counted.tables} tables, ${counted.rows} rows\n`);
  }

  return {
    rows: slice,
    source,
    duplicates: deduped.duplicates,
    dbPath: (dbId) => databaseIn(root, dbId),
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

/**
 * The single numeric value a query returns, or undefined.
 *
 * The convention is defined only on one-row, one-column numeric answers, so the
 * subset is chosen by this function rather than by looking at outcomes.
 */
function scalarOf(dbPath: string, sql: string): number | undefined {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const rows = db.prepare(sql).all() as Record<string, unknown>[];
    if (rows.length !== 1) return undefined;
    const row = rows[0];
    if (row === undefined) return undefined;
    const values = Object.values(row);
    if (values.length !== 1) return undefined;
    const value = values[0];
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  } catch {
    return undefined;
  } finally {
    db.close();
  }
}

/** The correction a user would make: the same query, reported the way this workspace reports. */
function reportedSql(sql: string): string {
  if (ACTIVE === undefined) return sql;
  const body = sql.replace(/;\s*$/, '').trim();
  return ACTIVE.sql(body);
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

function promptFor(row: BirdRow, ddl: string, pack: string, stated = false): string {
  return [
    'You write one SQLite query that answers the question exactly.',
    'Return the SQL only, in a ```sql fence, with no explanation.',
    'Use only the tables and columns in the schema. Prefer explicit JOINs. Do not invent columns.',
    `Schema:\n${ddl}`,
    row.evidence ? `Evidence (may be wrong; it is external knowledge):\n${row.evidence}` : '',
    stated && ACTIVE !== undefined ? `Workspace convention:\n- ${ACTIVE.sentence}` : '',
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
  task: Task,
  stated = false,
): Promise<Answer> {
  const dbPath = dataset.dbPath(row.db_id);
  const ddl = ddlOf(dbPath);
  const started = performance.now();
  let sql = '';
  let parseOk = false;
  let tokens = 0;
  try {
    const reply = await chat(promptFor(row, ddl, packText, stated));
    tokens = reply.tokens;
    const extracted = extractSql(reply.text);
    sql = extracted ?? '';
    parseOk = extracted !== undefined;
  } catch (error) {
    if (error instanceof MicrogliaError && error.code === 'MG_E_BUDGET_EXCEEDED') throw error;
    parseOk = false;
  }
  const predicted = sql === '' ? { ok: false, rows: [] } : execute(dbPath, sql);
  const correct = task.convention
    ? judgeConvention(dbPath, sql, task.expected.get(idOfRow(row)))
    : predicted.ok && execute(dbPath, row.SQL).ok && matches(predicted.rows, execute(dbPath, row.SQL).rows);
  return {
    sql,
    correct,
    parseOk,
    execOk: predicted.ok,
    packIds,
    tokens,
    latencyMs: Math.round(performance.now() - started),
  };
}

/** The convention's judgement: one numeric answer, compared at the stated precision. */
function judgeConvention(dbPath: string, sql: string, expected: number | undefined): boolean {
  if (expected === undefined || sql === '') return false;
  const value = scalarOf(dbPath, sql);
  if (value === undefined) return false;
  return Math.abs(value - expected) < 1e-6;
}

function idOfRow(row: BirdRow): string {
  return `${row.db_id}#${row.question_id}`;
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
  task: Task,
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
    // The correction is what a user would type, not what the benchmark happens to
    // hold: under the convention that is the same query reported in thousands.
    const target = task.convention ? reportedSql(row.SQL) : row.SQL;
    const expected = task.expected.get(idOfRow(row));
    const satisfied = task.convention
      ? judgeConvention(dbPath, sql, expected)
      : execute(dbPath, row.SQL).ok && execute(dbPath, sql).ok &&
        matches(execute(dbPath, sql).rows, execute(dbPath, row.SQL).rows);
    if (task.convention && expected === undefined) {
      goldFailed += 1;
      continue;
    }
    if (!satisfied) {
      await handle.edit({ sql: target }, { note: 'execution mismatch' });
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
function recording(inner: Interpreter, sink: string[], lastReply: () => string): Interpreter {
  return async (context) => {
    try {
      return await inner(context);
    } catch (error) {
      if (sink.length < 5) {
        const message = error instanceof Error ? error.message : String(error);
        sink.push(`${message} :: ${lastReply().slice(0, 160).replace(/\s+/g, ' ')}`);
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
  task: Task,
): Promise<FoldResult> {
  const idOf = (row: BirdRow): string => `${row.db_id}#${row.question_id}`;
  const evalRows = rows.filter((row) => foldOf.get(idOf(row)) === fold);
  const learnRows = rows.filter((row) => foldOf.get(idOf(row)) !== fold);

  const store = await EmbeddedMemory.open(new MemoryJournal());
  const distillFailures: string[] = [];
  let lastReply = '';
  const host = await openMicroglia({
    app: 'microglia-sota',
    namespace: 'bird',
    store,
    interpreter: combineInterpreters(
      recording(
        createLlmInterpreter({
          llm: {
            complete: async (prompt) => {
              const reply = await chat(prompt, 2000);
              lastReply = reply.text;
              return reply.text;
            },
          },
        }),
        distillFailures,
        () => lastReply,
      ),
      ruleInterpreter,
    ),
    budget: 1200,
    clock: steppingClock(1_700_000_000_000, 1),
    random: mulberry32(SEED),
  });

  const learning = await learn(host, learnRows, dataset, task);
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
  for (const [position, row] of evalRows.entries()) {
    // Progress, because a run of this size can be half an hour per fold and a silent
    // step is indistinguishable from a hung one. The counters are the ones a reader
    // needs to see that work is moving: which fold, how far into it, and how much
    // budget has been spent.
    if (position > 0 && position % 5 === 0) {
      process.stdout.write(
        `[sota] fold ${fold + 1}/${FOLDS} eval ${position}/${evalRows.length} calls=${calls} retries=${retries}\n`,
      );
    }
    const query = { task: TASK, text: row.question };
    const pack = await host.recall({ ...query, scope: { domain: row.db_id } });
    const base = await answer(row, dataset, '', 0, task);
    const full = await answer(row, dataset, pack.rendered, pack.ids.length, task);

    const arms: Partial<Record<Exclude<ArmName, 'none' | 'full'>, boolean>> = {};
    const armSql: Partial<Record<Exclude<ArmName, 'none' | 'full'>, string>> = {};
    const armPackIds: Partial<Record<Exclude<ArmName, 'none' | 'full'>, number>> = {};
    if (ARMS.has('gated')) {
      const gated = await host.recall({
        ...query,
        scope: { domain: row.db_id },
        minCoverage: MIN_COVERAGE,
      });
      const result = await answer(row, dataset, gated.rendered, gated.ids.length, task);
      arms.gated = result.correct;
      armSql.gated = result.sql;
      armPackIds.gated = result.packIds;
    }
    if (ARMS.has('duplicate')) {
      const twice = pack.rendered === '' ? '' : `${pack.rendered}\n${pack.rendered}`;
      const result = await answer(row, dataset, twice, pack.ids.length, task);
      arms.duplicate = result.correct;
      armSql.duplicate = result.sql;
      armPackIds.duplicate = result.packIds;
    }
    if (ARMS.has('wrong-scope')) {
      const wrong = await host.recall({ ...query, scope: { domain: nextDatabase(row.db_id) } });
      const result = await answer(row, dataset, wrong.rendered, wrong.ids.length, task);
      arms['wrong-scope'] = result.correct;
      armSql['wrong-scope'] = result.sql;
      armPackIds['wrong-scope'] = result.packIds;
    }
    if (ARMS.has('stated')) {
      const result = await answer(row, dataset, '', 0, task, true);
      arms.stated = result.correct;
      armSql.stated = result.sql;
      armPackIds.stated = 0;
    }
    if (ARMS.has('oracle')) {
      // Under the convention the oracle is the expected value, not the gold SQL:
      // the question is whether a single stated fact changes the answer form.
      const hint = task.convention
        ? `- The answer this workspace accepts for this question is ${task.expected.get(idOfRow(row)) ?? 'unknown'}; it is the only accepted form.`
        : `- ${row.SQL}`;
      const result = await answer(row, dataset, hint, 0, task);
      arms.oracle = result.correct;
      armSql.oracle = result.sql;
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
      coverage: Number(queryCoverage(row.question, pack.items[0]?.statement ?? '').toFixed(3)),
      expected: task.expected.get(idOf(row)) ?? null,
      packIdList: pack.ids,
      tokens: full.tokens,
      latencyMs: full.latencyMs,
      arms,
      armSql,
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
  if (CONVENTION !== '' && ACTIVE === undefined) {
    throw new MicrogliaError('MG_E_CONFIG', `Unknown convention '${CONVENTION}'`, {
      known: Object.keys(CONVENTIONS).join(', '),
    });
  }
  const dataset = await loadDataset(LIMIT);
  const idOf = (row: BirdRow): string => `${row.db_id}#${row.question_id}`;

  // The subset is chosen by a rule that does not look at outcomes: a one-row,
  // one-column numeric answer is the only place the convention is defined.
  const expected = new Map<string, number>();
  let rows = dataset.rows;
  if (ACTIVE !== undefined) {
    rows = dataset.rows.filter((row) => {
      const value = scalarOf(dataset.dbPath(row.db_id), row.SQL);
      if (value === undefined || !ACTIVE.applies(value)) return false;
      expected.set(idOf(row), ACTIVE.transform(value));
      return true;
    });
    if (rows.length < 20) {
      throw new MicrogliaError('MG_E_CONFIG', 'Too few questions define the convention', {
        qualifying: rows.length,
        of: dataset.rows.length,
        convention: CONVENTION,
      });
    }
  }
  const task: Task = { convention: ACTIVE !== undefined, expected };

  if (rows.length < FOLDS) {
    throw new MicrogliaError('MG_E_CONFIG', 'Not enough questions for the requested folds', {
      questions: rows.length,
      folds: FOLDS,
    });
  }
  const foldOf = assignFolds(
    rows.map((row) => idOf(row)),
    FOLDS,
  );

  const folds: FoldResult[] = [];
  for (let fold = 0; fold < FOLDS; fold += 1) {
    folds.push(await runFold(fold, rows, foldOf, dataset, task));
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

  // The channel control is whichever control states the knowledge in a form the
  // model can act on. On the convention lane the measured answer is that a value
  // ("the accepted answer is 10") is ignored while a rule ("report rounded to the
  // nearest ten") is followed, so the gate accepts either: it asks whether the
  // channel moves accuracy, not which phrasing we happened to prefer.
  // A control that injects text without a pack (`stated`) is not a pack control:
  // holding it to "rules per question" asks it for something it does not do, which
  // is how this gate failed a run whose every other reading was sound.
  const packControls = arms.filter(
    (entry) => entry.arm === 'gated' || entry.arm === 'duplicate' || entry.arm === 'wrong-scope',
  );
  const channel = arms.filter((entry) => entry.arm === 'oracle' || entry.arm === 'stated');
  const channelBest = channel.reduce<ArmSummary | undefined>(
    (best, entry) => (best === undefined || entry.delta_pp > best.delta_pp ? entry : best),
    undefined,
  );
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
      id: 'V6-controls-inject',
      criterion: 'every pack-based control arm injected at least one rule on average',
      actual:
        packControls
          .map((entry) => `${entry.arm}: ${entry.mean_pack_ids.toFixed(2)} rules/question`)
          .join(', ') || 'no pack-based controls configured',
      pass: packControls.every((entry) => entry.mean_pack_ids > 0),
      blocking: true,
    },
    {
      id: 'V7-channel',
      criterion: 'a stated control moves accuracy by at least 10pp',
      actual:
        channelBest === undefined
          ? 'no channel control was run'
          : `${channelBest.delta_pp.toFixed(2)}pp with the ${channelBest.arm} control`,
      pass: channelBest === undefined ? true : channelBest.delta_pp >= 10,
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
      duplicate_multiplier: 2,
      min_coverage: MIN_COVERAGE,
      arms: [...ARMS],
      convention: ACTIVE?.sentence ?? null,
      task: TASK,
      distill_prompt: 'distill-prompt/2',
      distill_max_tokens: 2000,
    },
    n: {
      total: rows.length,
      eval: cases.length,
      learn_mean: folds.reduce((sum, fold) => sum + fold.learn, 0) / Math.max(1, folds.length),
      databases: new Set(rows.map((row) => row.db_id)).size,
      qualifying: rows.length,
      reported: rows.length === 0 ? 0 : expected.size,
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
      duplicate_questions_dropped: dataset.duplicates,
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

  // Through the shared writer, which honours POC_RESULT_DIR and otherwise writes to
  // `eval/results` — the directory the workflow's publish and attribution steps read.
  // The lane used to write to `packages/eval/src/poc/results`, a path from before the
  // rename, so the artefact existed and the job could not find it.
  await writeJson('poc-sota-bird', artifact);
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
