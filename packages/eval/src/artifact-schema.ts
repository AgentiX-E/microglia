/**
 * The run artefact: one shape, one validator, one renderer.
 *
 * The benchmark lane has always written JSON, and every report in this repository has been
 * prose written by hand beside that JSON. That is the arrangement R8 exists to end: a report
 * that is a *function of the artefact* cannot drift from it, and a schema that code reads
 * cannot become documentation nobody validates. So the three live together — the types below,
 * `schema/run-artifact.schema.json` for anyone outside this repository, and a renderer whose
 * only input is the artefact.
 *
 * The validator is hand-written because the project has no runtime dependencies and does not
 * intend to acquire one for `ajv`. It is therefore also *stricter* than the JSON Schema in one
 * direction that matters: it checks arithmetic. A schema can say `accuracy` is a number in
 * [0, 1]; only code can say it is `correct / n`, that `answered` counts the cases with an
 * answer, and that the per-database rows sum to the totals. Those are the invariants a reader
 * would otherwise have to re-derive, and the ones a hand-edited artefact breaks first.
 */
import type { ResultComparison } from './sota.js';

/** One case's outcome: an answer, or the reason there is none. */
export type RunCase = {
  readonly id: string;
  readonly dbId: string;
  /** The generator's SQL, trimmed, or `null` when it produced nothing usable. */
  readonly sql: string | null;
  /** Why the case has no answer, or `null`. Exactly one of `sql` and `error` is set. */
  readonly error: string | null;
  readonly correct: boolean;
};

/** A gate: a name, a verdict, and the measurement behind it. */
export type RunGate = {
  readonly code: string;
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
};

export type RunGenerator = {
  readonly contract: string;
  readonly name: string;
  readonly version: string;
  /** Path of the module the generator was loaded from, relative to the repository root. */
  readonly source: string;
};

export type RunMetrics = {
  readonly n: number;
  readonly answered: number;
  readonly correct: number;
  readonly accuracy: number;
  readonly low: number;
  readonly high: number;
  readonly byDatabase: readonly {
    readonly dbId: string;
    readonly n: number;
    readonly correct: number;
  }[];
};

export type RunArtifact = {
  readonly schema: 'microglia.run-artifact/1';
  readonly id: string;
  readonly generatedAt: string;
  /** The pre-registration this run executes, by id, or `null` for a run with none. */
  readonly prereg: string | null;
  readonly generator: RunGenerator;
  readonly protocol: {
    readonly comparison: ResultComparison;
    readonly cases: number;
    readonly concurrency: number;
  };
  readonly cases: readonly RunCase[];
  readonly metrics: RunMetrics;
  readonly gates: readonly RunGate[];
};

/** The one literal a reader can use to tell this document from a lookalike. */
export const RUN_ARTIFACT_SCHEMA = 'microglia.run-artifact/1';

export type ArtifactProblem = {
  /** A dotted path into the document, so a failure names the field it is about. */
  readonly path: string;
  readonly problem: string;
};

export type ArtifactVerdict = {
  readonly ok: boolean;
  readonly problems: readonly ArtifactProblem[];
};

const COMPARISONS: readonly string[] = ['multiset', 'set'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/** `2026-10-30T09:00:00.000Z`, parsed rather than pattern-matched alone. */
function isTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(value)) return false;
  return Number.isFinite(Date.parse(value));
}

/**
 * Everything the schema states, plus the arithmetic the schema cannot.
 *
 * Problems accumulate instead of throwing: a reader validating a hand-edited artefact wants
 * every complaint at once, not the first one.
 */
export function validateRunArtifact(value: unknown): ArtifactVerdict {
  const problems: ArtifactProblem[] = [];
  const add = (path: string, problem: string): void => {
    problems.push({ path, problem });
  };

  if (!isRecord(value)) {
    return { ok: false, problems: [{ path: '', problem: 'the artefact must be a JSON object' }] };
  }

  if (value['schema'] !== RUN_ARTIFACT_SCHEMA) {
    add('schema', `expected '${RUN_ARTIFACT_SCHEMA}', received ${JSON.stringify(value['schema'])}`);
  }
  if (!isText(value['id'])) add('id', 'a non-empty run id is required');
  if (!isTimestamp(value['generatedAt'])) add('generatedAt', 'an ISO 8601 UTC timestamp is required');
  const prereg = value['prereg'];
  if (prereg !== null && !isText(prereg)) add('prereg', 'a pre-registration id or null is required');

  const generator = value['generator'];
  if (!isRecord(generator)) {
    add('generator', 'an object is required');
  } else {
    if (generator['contract'] !== 'candidate-generator/1') {
      add('generator.contract', `expected 'candidate-generator/1', received ${JSON.stringify(generator['contract'])}`);
    }
    for (const field of ['name', 'version', 'source'] as const) {
      if (!isText(generator[field])) add(`generator.${field}`, 'a non-empty string is required');
    }
  }

  const protocol = value['protocol'];
  if (!isRecord(protocol)) {
    add('protocol', 'an object is required');
  } else {
    if (!COMPARISONS.includes(protocol['comparison'] as string)) {
      add('protocol.comparison', `expected one of ${COMPARISONS.join(', ')}`);
    }
    if (!isCount(protocol['cases']) || protocol['cases'] === 0) {
      add('protocol.cases', 'a positive integer is required');
    }
    if (!isCount(protocol['concurrency']) || protocol['concurrency'] === 0) {
      add('protocol.concurrency', 'a positive integer is required');
    }
  }

  const cases = value['cases'];
  const ids = new Set<string>();
  if (!Array.isArray(cases) || cases.length === 0) {
    add('cases', 'a non-empty array is required');
  } else {
    if (isRecord(protocol) && protocol['cases'] !== cases.length) {
      add('protocol.cases', `declares ${String(protocol['cases'])} cases but the array holds ${cases.length}`);
    }
    for (const [index, entry] of cases.entries()) {
      const at = `cases[${index}]`;
      if (!isRecord(entry)) {
        add(at, 'an object is required');
        continue;
      }
      if (!isText(entry['id'])) add(`${at}.id`, 'a non-empty id is required');
      else if (ids.has(entry['id'])) add(`${at}.id`, `duplicate id '${entry['id']}'`);
      else ids.add(entry['id']);
      if (!isText(entry['dbId'])) add(`${at}.dbId`, 'a non-empty database id is required');
      const sql = entry['sql'];
      const error = entry['error'];
      if (sql !== null && !isText(sql)) add(`${at}.sql`, 'a non-empty string or null is required');
      if (error !== null && !isText(error)) add(`${at}.error`, 'a non-empty string or null is required');
      if (sql === null && error === null) add(at, 'exactly one of sql and error must be set; neither is');
      if (sql !== null && error !== null) add(at, 'exactly one of sql and error must be set; both are');
      if (typeof entry['correct'] !== 'boolean') add(`${at}.correct`, 'a boolean is required');
      else if (entry['correct'] && sql === null) add(`${at}.correct`, 'a case with no answer cannot be correct');
    }
  }

  const metrics = value['metrics'];
  if (!isRecord(metrics)) {
    add('metrics', 'an object is required');
  } else if (Array.isArray(cases) && cases.length > 0) {
    validateMetrics(metrics, cases, add);
  }

  const gates = value['gates'];
  if (!Array.isArray(gates) || gates.length === 0) {
    add('gates', 'a non-empty array is required');
  } else {
    for (const [index, gate] of gates.entries()) {
      const at = `gates[${index}]`;
      if (!isRecord(gate)) {
        add(at, 'an object is required');
        continue;
      }
      if (typeof gate['code'] !== 'string' || !/^V\d+$/.test(gate['code'])) {
        add(`${at}.code`, 'a gate code of the form V<n> is required');
      }
      if (!isText(gate['name'])) add(`${at}.name`, 'a non-empty name is required');
      if (typeof gate['ok'] !== 'boolean') add(`${at}.ok`, 'a boolean is required');
      if (!isText(gate['detail'])) add(`${at}.detail`, 'a non-empty detail is required');
    }
  }

  return { ok: problems.length === 0, problems };
}

/**
 * The metrics have to be the cases, counted.
 *
 * Split out only to keep the main validator readable; the invariants are the reason this
 * module exists rather than a schema file alone.
 */
function validateMetrics(
  metrics: Record<string, unknown>,
  cases: readonly unknown[],
  add: (path: string, problem: string) => void,
): void {
  const answered = cases.filter((entry) => isRecord(entry) && entry['sql'] !== null).length;
  const correct = cases.filter((entry) => isRecord(entry) && entry['correct'] === true).length;
  const n = cases.length;
  if (metrics['n'] !== n) add('metrics.n', `declares ${String(metrics['n'])} cases but the array holds ${n}`);
  if (metrics['answered'] !== answered) {
    add('metrics.answered', `declares ${String(metrics['answered'])} answered but ${answered} cases carry SQL`);
  }
  if (metrics['correct'] !== correct) {
    add('metrics.correct', `declares ${String(metrics['correct'])} correct but ${correct} cases are correct`);
  }
  const accuracy = metrics['accuracy'];
  if (typeof accuracy !== 'number' || !Number.isFinite(accuracy) || accuracy < 0 || accuracy > 1) {
    add('metrics.accuracy', 'a fraction in [0, 1] is required');
  } else if (Math.abs(accuracy - correct / n) > 1e-9) {
    add('metrics.accuracy', `${accuracy} is not correct/n = ${correct}/${n}`);
  }
  const low = metrics['low'];
  const high = metrics['high'];
  const bounded = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
  if (!bounded(low)) add('metrics.low', 'a fraction in [0, 1] is required');
  if (!bounded(high)) add('metrics.high', 'a fraction in [0, 1] is required');
  if (bounded(low) && bounded(high) && bounded(accuracy) && !(low <= accuracy && accuracy <= high)) {
    add('metrics', `the interval [${low}, ${high}] does not contain the accuracy ${accuracy}`);
  }

  const byDatabase = metrics['byDatabase'];
  if (!Array.isArray(byDatabase) || byDatabase.length === 0) {
    add('metrics.byDatabase', 'a non-empty array is required');
    return;
  }
  let totalN = 0;
  let totalCorrect = 0;
  const seen = new Set<string>();
  for (const [index, row] of byDatabase.entries()) {
    const at = `metrics.byDatabase[${index}]`;
    if (!isRecord(row)) {
      add(at, 'an object is required');
      continue;
    }
    if (!isText(row['dbId'])) add(`${at}.dbId`, 'a non-empty database id is required');
    else if (seen.has(row['dbId'])) add(`${at}.dbId`, `duplicate database '${row['dbId']}'`);
    else seen.add(row['dbId']);
    if (!isCount(row['n']) || row['n'] === 0) add(`${at}.n`, 'a positive integer is required');
    if (!isCount(row['correct'])) add(`${at}.correct`, 'a non-negative integer is required');
    if (isCount(row['n'])) totalN += row['n'];
    if (isCount(row['correct'])) totalCorrect += row['correct'];
    if (isCount(row['n']) && isCount(row['correct']) && row['correct'] > row['n']) {
      add(`${at}.correct`, 'more correct cases than cases');
    }
  }
  if (totalN !== n) add('metrics.byDatabase', `rows sum to ${totalN} cases, the artefact holds ${n}`);
  if (totalCorrect !== correct) add('metrics.byDatabase', `rows sum to ${totalCorrect} correct, the artefact reports ${correct}`);
}

/** `37.50%` — two decimals, because a third is noise at these sample sizes. */
function percent(value: number): string {
  return `${(100 * value).toFixed(2)}%`;
}

/**
 * Render the report from the artefact, and from nothing else.
 *
 * Purity is the property being delivered, not a stylistic preference: the committed report
 * is compared byte-for-byte against this function's output in CI, so any sentence in it that
 * needed knowledge from outside the JSON would break the check on the next run.
 */
export function runArtifactReport(artifact: RunArtifact): string {
  const lines: string[] = [];
  lines.push(`# Run ${artifact.id}`, '');
  lines.push(
    `Generator **${artifact.generator.name}** ${artifact.generator.version}, loaded from ` +
      `\`${artifact.generator.source}\` under contract \`${artifact.generator.contract}\`.`,
    '',
  );
  lines.push(
    `${artifact.protocol.cases} cases, ${artifact.protocol.comparison} comparison, ` +
      `concurrency ${artifact.protocol.concurrency}` +
      (artifact.prereg === null ? ', no pre-registration.' : `, pre-registration \`${artifact.prereg}\`.`),
    '',
  );
  lines.push('| Metric | Value |', '|---|---|');
  lines.push(`| answered | ${artifact.metrics.answered} of ${artifact.metrics.n} |`);
  lines.push(`| correct | ${artifact.metrics.correct} |`);
  lines.push(
    `| accuracy | ${percent(artifact.metrics.accuracy)} (95% CI ${percent(artifact.metrics.low)}–${percent(artifact.metrics.high)}) |`,
  );
  lines.push(`| generated | ${artifact.generatedAt} |`, '');

  lines.push('## Per database', '', '| Database | Cases | Correct | Accuracy |', '|---|---|---|---|');
  for (const row of artifact.metrics.byDatabase) {
    const accuracy = row.n === 0 ? 0 : row.correct / row.n;
    lines.push(`| ${row.dbId} | ${row.n} | ${row.correct} | ${percent(accuracy)} |`);
  }
  lines.push('');

  lines.push('## Cases', '', '| Case | Database | Verdict | Answer |', '|---|---|---|---|');
  for (const entry of artifact.cases) {
    const verdict = entry.correct ? 'correct' : entry.sql === null ? 'no answer' : 'wrong';
    const answer = (entry.sql === null ? `error: ${entry.error ?? 'unknown'}` : entry.sql).replaceAll('|', '\\|');
    lines.push(`| ${entry.id} | ${entry.dbId} | ${verdict} | ${answer} |`);
  }
  lines.push('');

  lines.push('## Gates', '', '| Gate | Name | Verdict | Detail |', '|---|---|---|---|');
  for (const gate of artifact.gates) {
    lines.push(`| ${gate.code} | ${gate.name} | ${gate.ok ? 'pass' : 'fail'} | ${gate.detail} |`);
  }
  lines.push('');
  return lines.join('\n');
}

/** The artefact as it is written to disk: two-space indentation, one trailing newline. */
export function runArtifactJson(artifact: RunArtifact): string {
  return `${JSON.stringify(artifact, null, 2)}\n`;
}
