/**
 * The candidate contract: how someone else's generator becomes measurable here.
 *
 * The benchmark lane has always been able to answer one question — does *this* memory help
 * *this* model — because the generator, the prompt and the scoring lived in the same file.
 * That is fine for a study and useless as a protocol: a third party who wants to know
 * whether their generator is better than ours has to port our code, and a comparison that
 * requires porting the other system is a comparison of two ports.
 *
 * So the contract is deliberately tiny. A module exports an object with a name, a version,
 * a contract string and one async function from a request to SQL. Everything else — the
 * dataset, the execution, the pairing, the interval, the gates — stays on our side, which is
 * where the measurement has to live if it is going to be the same measurement for everybody.
 *
 * Two properties are load-bearing and are the reason this is a module rather than twenty
 * lines in a binary:
 *
 *  1. **A failure is a value.** A generator that throws, returns nothing, or returns
 *     something that is not SQL produces a case with an error and no answer. The run
 *     continues, the answer rate is counted, and a generator that fails more than the
 *     registered tolerance fails its gate instead of quietly scoring zero.
 *  2. **The module's location is checked.** A generator loaded from inside `packages/eval`
 *     is not a third party, and a gate says so. Without it, "an external generator runs
 *     through the harness" is a claim nobody can test from the artefact.
 */
import { MicrogliaError } from '@agentix-e/microglia-core';
import { mapPool } from './concurrency.js';
import { wilsonInterval } from './reproduction.js';
import { RUN_ARTIFACT_SCHEMA, type RunArtifact, type RunCase, type RunGate } from './artifact-schema.js';
import type { ResultComparison } from './sota.js';

/** The contract string a module must carry. Bumping it is how a breaking change is announced. */
export const CANDIDATE_CONTRACT = 'candidate-generator/1';

/** What a generator is given: the question, its evidence, and the schema as one string. */
export type CandidateRequest = {
  readonly id: string;
  readonly dbId: string;
  readonly question: string;
  readonly evidence: string;
  readonly ddl: string;
};

/** What a generator returns: SQL, either as a string or as `{ sql }`. */
export type CandidateReply = { readonly sql: string } | string;

export type CandidateGenerator = {
  readonly contract: string;
  readonly name: string;
  readonly version: string;
  readonly generate: (request: CandidateRequest) => Promise<CandidateReply> | CandidateReply;
};

/** A case the runner hands to a generator, with the gold rows already canonicalised. */
export type PluginCase = {
  readonly id: string;
  readonly dbId: string;
  readonly question: string;
  readonly evidence: string;
  readonly ddl: string;
  /** Gold result as canonical rows — the encoding `matches` compares. */
  readonly gold: readonly string[];
};

/**
 * How the runner turns the SQL a generator returned into comparable rows.
 *
 * Injected rather than imported because execution needs a database and this module must not:
 * the CLI opens SQLite, and a unit test hands in a lookup. `undefined` means "the statement
 * could not run", which is a scored outcome — an unexecutable prediction is wrong, not
 * missing — and the run counts it.
 */
export type Scorer = (sql: string, item: PluginCase) => readonly string[] | undefined;

export type GeneratorProblem = {
  readonly field: string;
  readonly problem: string;
};

/**
 * Everything wrong with a module that claims to be a generator.
 *
 * Returned as a list because the useful error message names all of it at once: a module
 * missing its version almost always also misses the contract string, and fixing those one
 * round-trip at a time is how a contract becomes folklore.
 */
export function generatorProblems(value: unknown): readonly GeneratorProblem[] {
  if (typeof value !== 'object' || value === null) {
    return [{ field: '', problem: 'the module must export an object' }];
  }
  const record = value as Record<string, unknown>;
  const problems: GeneratorProblem[] = [];
  if (record['contract'] !== CANDIDATE_CONTRACT) {
    problems.push({
      field: 'contract',
      problem: `expected '${CANDIDATE_CONTRACT}', received ${JSON.stringify(record['contract'])}`,
    });
  }
  for (const field of ['name', 'version'] as const) {
    const entry = record[field];
    if (typeof entry !== 'string' || entry.trim() === '') {
      problems.push({ field, problem: 'a non-empty string is required' });
    }
  }
  if (typeof record['generate'] !== 'function') {
    problems.push({ field: 'generate', problem: 'a function is required' });
  }
  return problems;
}

/** The generator, or a configuration error listing every reason it is not one. */
export function assertGenerator(value: unknown, where: string): CandidateGenerator {
  const problems = generatorProblems(value);
  if (problems.length > 0) {
    throw new MicrogliaError(
      'MG_E_CONFIG',
      `${where} does not implement ${CANDIDATE_CONTRACT}`,
      Object.fromEntries(problems.map((entry) => [entry.field === '' ? 'module' : entry.field, entry.problem])),
    );
  }
  return value as CandidateGenerator;
}

/** A loaded module: the generator, where it came from, and whether that is inside this package. */
export type LoadedGenerator = {
  readonly generator: CandidateGenerator;
  /** Path relative to the working directory, for the artefact and the report. */
  readonly source: string;
  /** True when the module resolved inside `packages/eval`, which disqualifies it as third-party. */
  readonly insidePackage: boolean;
  /** The resolved absolute path. */
  readonly path: string;
};

export type LoadOptions = {
  /** Directory the specifier resolves against. */
  readonly cwd?: string;
  /** The package a generator may not live inside. */
  readonly packageRoot?: string;
  /** Injected for testing; the default is a native dynamic import. */
  readonly load?: (url: string) => Promise<unknown>;
};

/**
 * Resolve a path, import it, and check what came back.
 *
 * The location check runs before the import: a module inside `packages/eval` is refused
 * whether or not it would have loaded, because the claim being tested is provenance, not
 * behaviour. Accepting it and merely flagging it would let a run's gate depend on a boolean
 * somebody could edit.
 */
export async function loadGenerator(spec: string, options: LoadOptions = {}): Promise<LoadedGenerator> {
  const cwd = options.cwd ?? process.cwd();
  const packageRoot = options.packageRoot ?? new URL('..', import.meta.url).pathname;
  const absolute = spec.startsWith('/') ? spec : `${cwd}/${spec}`.replaceAll(/\/\.\//g, '/');
  const normalised = normalise(absolute);
  const root = normalise(packageRoot).replace(/\/$/, '');
  const insidePackage = normalised === root || normalised.startsWith(`${root}/`);
  if (insidePackage) {
    throw new MicrogliaError(
      'MG_E_CONFIG',
      'a candidate generator must live outside packages/eval',
      { path: normalised, packageRoot: root },
    );
  }
  const load = options.load ?? ((url: string) => import(url) as Promise<unknown>);
  let module: unknown;
  try {
    module = await load(`file://${normalised}`);
  } catch (error) {
    throw new MicrogliaError('MG_E_CONFIG', `could not import ${normalised}`, {
      cause: error instanceof Error ? error.message : `${error}`,
    });
  }
  const exported =
    typeof module === 'object' && module !== null && 'default' in module
      ? (module as { default: unknown }).default
      : module;
  const generator = assertGenerator(exported, normalised);
  return { generator, source: relativeTo(cwd, normalised), insidePackage, path: normalised };
}

/** Collapse `..` and `.` without touching the filesystem, so a path check cannot be a symlink game. */
function normalise(path: string): string {
  const parts: string[] = [];
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return `/${parts.join('/')}`;
}

function relativeTo(cwd: string, path: string): string {
  const base = normalise(cwd).replace(/\/$/, '');
  return path.startsWith(`${base}/`) ? path.slice(base.length + 1) : path;
}

/** What a generator returned, as SQL, or a thrown reason it returned nothing usable. */
export function readReply(reply: unknown): string {
  if (typeof reply === 'string') {
    if (reply.trim() === '') throw new MicrogliaError('MG_E_CONFIG', 'the generator returned an empty string');
    return reply.trim();
  }
  if (typeof reply === 'object' && reply !== null) {
    const sql = (reply as { sql?: unknown }).sql;
    if (typeof sql === 'string' && sql.trim() !== '') return sql.trim();
  }
  throw new MicrogliaError('MG_E_CONFIG', 'the generator returned neither SQL nor an error');
}

/** How long one case may take before it is recorded as a failure. */
export const DEFAULT_CASE_TIMEOUT_MS = 120_000;

/**
 * One case: ask, coerce, score.
 *
 * The timeout is a race rather than a cancellation, because a generator is someone else's
 * code and the only lever this side has is to stop waiting. A late answer is discarded by
 * the runtime; the run does not block on it.
 */
export async function runOne(
  generator: CandidateGenerator,
  item: PluginCase,
  score: Scorer,
  timeoutMs: number = DEFAULT_CASE_TIMEOUT_MS,
  comparison: ResultComparison = 'multiset',
): Promise<RunCase> {
  const request: CandidateRequest = {
    id: item.id,
    dbId: item.dbId,
    question: item.question,
    evidence: item.evidence,
    ddl: item.ddl,
  };
  let sql: string;
  try {
    sql = readReply(await withTimeout(generator.generate(request), timeoutMs));
  } catch (error) {
    return { id: item.id, dbId: item.dbId, sql: null, error: messageOf(error), correct: false };
  }
  // An unexecutable statement is still an answer: the model said something, and it was
  // wrong. Recording it as "no answer" would move it out of the denominator of the answer
  // rate, which is the one gate that separates a broken generator from an unlucky one.
  const rows = score(sql, item);
  return {
    id: item.id,
    dbId: item.dbId,
    sql,
    error: null,
    correct: rows === undefined ? false : sameRows(rows, item.gold, comparison),
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : `${error}`;
}

async function withTimeout<T>(work: Promise<T> | T, timeoutMs: number): Promise<T> {
  if (timeoutMs <= 0) return work;
  let handle: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<never>((_, reject) => {
    handle = setTimeout(() => {
      reject(new MicrogliaError('MG_E_CONFIG', `the generator did not answer within ${timeoutMs}ms`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([Promise.resolve(work), expiry]);
  } finally {
    if (handle !== undefined) clearTimeout(handle);
  }
}

/**
 * Multiset equality over canonical rows, which is BIRD's EX and this project's default.
 *
 * `set` collapses duplicates, so a query that returns the right values the wrong number of
 * times passes; both are offered because the two readings disagree on 16.1% of ROSE-VEC's
 * adjudicated items, and a number has to carry the criterion that produced it.
 */
export function sameRows(predicted: readonly string[], gold: readonly string[], comparison: ResultComparison = 'multiset'): boolean {
  if (comparison === 'set') {
    const left = new Set(predicted);
    const right = new Set(gold);
    if (left.size !== right.size) return false;
    for (const value of left) if (!right.has(value)) return false;
    return true;
  }
  if (predicted.length !== gold.length) return false;
  return predicted.every((value, index) => value === gold[index]);
}

export type RunInput = {
  readonly generator: CandidateGenerator;
  readonly source: string;
  readonly insidePackage: boolean;
  readonly cases: readonly PluginCase[];
  readonly score: Scorer;
  readonly comparison: ResultComparison;
  readonly concurrency: number;
  readonly prereg: { readonly id: string; readonly resolved: boolean };
  readonly id: string;
  readonly now: string;
  readonly timeoutMs?: number;
  /** Share of cases that must carry an answer. Pre-registered, not chosen after the run. */
  readonly minAnswerRate?: number;
};

/**
 * Run every case, score it, and assemble the artefact the schema validates.
 *
 * The gates are computed here rather than afterwards so that they travel with the numbers
 * they judge: an artefact whose gate was added by a later step is an artefact whose gate can
 * disagree with its own metrics.
 */
export async function runGenerator(input: RunInput): Promise<RunArtifact> {
  if (!Number.isInteger(input.concurrency) || input.concurrency < 1) {
    throw new MicrogliaError('MG_E_CONFIG', 'concurrency must be a positive integer', {
      concurrency: input.concurrency,
    });
  }
  if (input.cases.length === 0) {
    throw new MicrogliaError('MG_E_CONFIG', 'a run needs at least one case');
  }
  const cases = await mapPool(input.cases, input.concurrency, (item) =>
    runOne(
      input.generator,
      item,
      input.score,
      input.timeoutMs ?? DEFAULT_CASE_TIMEOUT_MS,
      input.comparison,
    ),
  );
  const n = cases.length;
  const answered = cases.filter((entry) => entry.sql !== null).length;
  const correct = cases.filter((entry) => entry.correct).length;
  const accuracy = correct / n;
  const interval = wilsonInterval({ accuracy, n });
  const byDatabase = groupByDatabase(cases);
  const minAnswerRate = input.minAnswerRate ?? 0.99;
  const answerRate = answered / n;

  const gates: RunGate[] = [
    {
      code: 'V27',
      name: 'third-party-module',
      ok: !input.insidePackage,
      detail: input.insidePackage
        ? `the generator resolved inside packages/eval (${input.source}), so it is not a third-party generator`
        : `loaded from ${input.source}, outside packages/eval`,
    },
    {
      code: 'V30',
      name: 'preregistration',
      ok: input.prereg.resolved && input.prereg.id.trim() !== '',
      detail: input.prereg.resolved
        ? `executes prereg/${input.prereg.id}.md`
        : `no pre-registration resolved for '${input.prereg.id}'`,
    },
    {
      code: 'V29',
      name: 'answer-rate',
      ok: answerRate >= minAnswerRate,
      detail: `${answered}/${n} answered = ${(100 * answerRate).toFixed(2)}%, floor ${(100 * minAnswerRate).toFixed(2)}%`,
    },
  ];

  return {
    schema: RUN_ARTIFACT_SCHEMA,
    id: input.id,
    generatedAt: input.now,
    prereg: input.prereg.id === '' ? null : input.prereg.id,
    generator: {
      contract: input.generator.contract,
      name: input.generator.name,
      version: input.generator.version,
      source: input.source,
    },
    protocol: {
      comparison: input.comparison,
      cases: n,
      concurrency: input.concurrency,
    },
    cases,
    metrics: {
      n,
      answered,
      correct,
      accuracy,
      low: interval.low,
      high: interval.high,
      byDatabase,
    },
    gates,
  };
}

/** Cases per database, in first-seen order, so the report reads in the order the data arrived. */
function groupByDatabase(cases: readonly RunCase[]): RunArtifact['metrics']['byDatabase'] {
  const order: string[] = [];
  const tally = new Map<string, { n: number; correct: number }>();
  for (const entry of cases) {
    let row = tally.get(entry.dbId);
    if (row === undefined) {
      row = { n: 0, correct: 0 };
      tally.set(entry.dbId, row);
      order.push(entry.dbId);
    }
    row.n += 1;
    if (entry.correct) row.correct += 1;
  }
  return order.map((dbId) => {
    const row = tally.get(dbId) as { n: number; correct: number };
    return { dbId, n: row.n, correct: row.correct };
  });
}
