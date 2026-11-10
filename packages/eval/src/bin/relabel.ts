/**
 * Re-score an artefact against corrected gold, at zero model calls.
 *
 * BIRD Mini-Dev's annotation error rate is 52.8% (Jin et al., PVLDB 19(5), 2026), and 151 of the 350
 * questions in this repository's transfer slice have a different gold query in the corrected release.
 * Every small minidev effect in this lane was measured against the uncorrected labels, including R73's
 * "four questions moved".
 *
 * Re-running the experiments would buy a new sample of the same population and cost the dispatch. The
 * answers are already in the artefact: `per_case` holds `predictedSql`, `baselineSql` and `dbId`, so
 * both arms can be executed against corrected gold and compared with what the run recorded. This
 * command does that and prints the four accuracies, the two deltas, and the verdict classification.
 *
 *   pnpm eval:relabel --bird <artefact> --gold <corrected mini-dev json> [--db <bird dir>]
 *
 * `--gold` takes the `arcwise_plat_sql_only_with_diff.json` shape: a list of `{ question_id, SQL }`.
 * The SQL-only variant is the right one here because this lane's runs saw the *original* questions and
 * evidence; a correction that rewrote the question would be re-labelling a different experiment.
 *
 * Zero model calls. Statement execution only, so the cost is the database's time and nothing else.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { BoundedSql, canonicalRows, resolveDatabase } from '@agentix-e/microglia-sql';
import {
  comparePaired,
  matches,
  relabelReading,
  relabelVerdict,
  type GradedPair,
  type RelabelCase,
  type ResultComparison,
} from '@agentix-e/microglia-eval';
import { birdArtefactPath } from './lib.js';

type Row = {
  readonly questionId?: string | number | null;
  readonly dbId?: string | null;
  readonly question?: string | null;
  readonly predictedSql?: string | null;
  readonly baselineSql?: string | null;
  readonly correct?: boolean | null;
  readonly withoutMemoryCorrect?: boolean | null;
};

type Artefact = {
  readonly per_case: readonly Row[];
  /** The criterion the run scored by. Both gradings must use it or the comparison is two rulers. */
  readonly scored_by?: ResultComparison | null;
};

type Gold = { readonly question_id: string | number; readonly SQL: string; readonly question?: string };

const flag = (argv: readonly string[], name: string): string | undefined => {
  const index = argv.indexOf(`--${name}`);
  return index === -1 ? undefined : argv[index + 1];
};

/**
 * The directory holding `<db>/<db>.sqlite`.
 *
 * `BIRD_DIR` is honoured because the workflow already sets it, and the two layouts a local checkout
 * produces are searched in the order that fails fastest: the split root first, then the archive's own
 * `MINIDEV/dev_databases`, which is where an operator who unzipped the released archive ends up.
 */
function databaseRoot(explicit: string | undefined): string {
  const candidates = [explicit, process.env['BIRD_DIR'], '/tmp/bird/minidev'].filter(
    (value): value is string => value !== undefined && value !== '',
  );
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(
    `no BIRD directory found; looked in ${candidates.join(', ')} — pass --db or set BIRD_DIR`,
  );
}

function dbPathFor(root: string, dbId: string): string {
  for (const nested of ['dev_databases', 'MINIDEV/dev_databases', undefined]) {
    const resolved = resolveDatabase(root, dbId, nested === undefined ? [] : [nested]);
    if (existsSync(resolved) && statSync(resolved).isFile()) return resolved;
  }
  throw new Error(`no database for '${dbId}' under ${root}`);
}

export async function main(argv: readonly string[]): Promise<number> {
  const birdPath = flag(argv, 'bird') ?? birdArtefactPath();
  const goldPath = flag(argv, 'gold');
  if (goldPath === undefined) {
    process.stderr.write('[relabel] --gold is required: the corrected mini-dev annotations\n');
    return 2;
  }

  const artefact = JSON.parse(readFileSync(birdPath, 'utf8')) as Artefact;
  const corrected = new Map<string, Gold>();
  for (const row of JSON.parse(readFileSync(goldPath, 'utf8')) as readonly Gold[]) {
    corrected.set(String(row.question_id), row);
  }
  const root = databaseRoot(flag(argv, 'db'));

  const criterion: ResultComparison = artefact.scored_by ?? 'multiset';
  const statements = new BoundedSql({ deadlineMs: 20_000, rowCap: 10_000 });
  const executed = new Map<string, readonly string[] | null>();

  /** The canonical rows a statement returns, or null when it does not run. */
  const rowsOf = async (dbPath: string, sql: string): Promise<readonly string[] | null> => {
    const key = `${dbPath}\u0000${sql}`;
    const cached = executed.get(key);
    if (cached !== undefined) return cached;
    const outcome = await statements.run(dbPath, sql);
    const rows = outcome.ok ? canonicalRows(outcome.rows) : null;
    executed.set(key, rows);
    return rows;
  };

  // The pool holds child processes, and a child holds the event loop open. A run that does not close
  // it finishes its work, prints nothing, and sits at zero CPU until the step's timeout: three runs
  // were killed that way before the cause was found, each of them having done two minutes of work
  // and then waiting an hour to be reported as a hang.
  try {
    const cases: RelabelCase[] = [];
    const missing: string[] = [];
  // `--limit` exists because this reads statements, and a statement is the one part of the run that
  // is not bounded by a model: a cross join over a million-row table takes as long as it takes. A
  // sample of twenty questions tells a caller the throughput before an hour has been spent learning
  // it, which is the same lesson the cost tables needed.
  const limit = Number(flag(argv, 'limit') ?? '0');
  const taken = limit > 0 ? artefact.per_case.slice(0, limit) : artefact.per_case;
  const started = Date.now();
  let done = 0;
  for (const row of taken) {
    const id = row.questionId === null || row.questionId === undefined ? '' : String(row.questionId);
    const gold = corrected.get(id);
    const dbId = row.dbId ?? '';
    const predicted = row.predictedSql ?? '';
    const baseline = row.baselineSql ?? '';
    if (gold === undefined || dbId === '' || predicted === '' || baseline === '') {
      missing.push(id);
      continue;
    }
    // Whether the corrected release rewrote the question as well as the label. The `sql_only` variant
    // says it kept the questions, and it did keep *its* questions — but its questions are not the ones
    // this repository pinned: 67 of the 350 disagree, which places the pin a revision behind the file
    // the correction was built on. On 44 of those the gold moved too, and those rows are a corpus
    // revision rather than a relabel, so they are counted apart.
    const questionRevised =
      typeof gold.question === 'string' &&
      (row.question ?? '').trim() !== gold.question.trim();
    const dbPath = dbPathFor(root, dbId);
    const goldRows = await rowsOf(dbPath, gold.SQL);
    const predictedRows = await rowsOf(dbPath, predicted);
    const baselineRows = await rowsOf(dbPath, baseline);
    // `matches` rather than a local comparison, because the artefact's own verdicts were produced by
    // it and a corrected reading judged by a second implementation would differ from the original
    // reading wherever the two implementations differ — a delta between two rulers, printed as a
    // delta between two golds. The criterion is read from the artefact, and `multiset` (BIRD's own EX)
    // is the fallback for files written before the field existed.
    const same = (a: readonly string[] | null, b: readonly string[] | null): boolean =>
      a !== null && b !== null && matches(a, b, criterion);

    const treatmentGraded: GradedPair = {
      original: row.correct === true,
      corrected: same(predictedRows, goldRows),
    };
    const baselineGraded: GradedPair = {
      original: row.withoutMemoryCorrect === true,
      corrected: same(baselineRows, goldRows),
    };
    cases.push({ id, treatment: treatmentGraded, baseline: baselineGraded, questionRevised });
    done += 1;
    if (done % 50 === 0) {
      const elapsed = (Date.now() - started) / 1000;
      process.stdout.write(
        `[relabel] ${String(done)}/${String(taken.length)} questions, ` +
          `${elapsed.toFixed(0)}s elapsed, ${(elapsed / done).toFixed(2)}s each\n`,
      );
    }
  }

  const reading = relabelReading(cases);
  const treatmentOriginal = cases.map((item) => item.treatment.original);
  const treatmentCorrected = cases.map((item) => item.treatment.corrected);
  const baselineOriginal = cases.map((item) => item.baseline.original);
  const baselineCorrected = cases.map((item) => item.baseline.corrected);

  const before = comparePaired(baselineOriginal, treatmentOriginal, 7, 10_000);
  const after = comparePaired(baselineCorrected, treatmentCorrected, 7, 10_000);
  const verdict = relabelVerdict(
    { original: reading.delta.original, corrected: reading.delta.corrected },
    {
      original: { low: before.deltaCI.low, high: before.deltaCI.high },
      corrected: { low: after.deltaCI.low, high: after.deltaCI.high },
    },
  );

  const line = (name: string, percent: number, correct: number): string =>
    `[relabel] ${name.padEnd(22)} ${percent.toFixed(2).padStart(7)}%  (${String(correct)}/${String(reading.n)})\n`;

  // The two halves of the population, on one line each, so the mixture above can be read as what it
  // is made of. `relabelled` is the number any claim about "corrected gold" has to be stated on.
  const group = (name: string, subset: typeof reading.unrevised): string =>
    `[relabel] ${name.padEnd(12)} n=${String(subset.n).padStart(4)}  ` +
    `memory ${subset.treatment.original.percent.toFixed(2)}%→${subset.treatment.corrected.percent.toFixed(2)}%  ` +
    `baseline ${subset.baseline.original.percent.toFixed(2)}%→${subset.baseline.corrected.percent.toFixed(2)}%  ` +
    `delta ${subset.delta.original.toFixed(2)}pp→${subset.delta.corrected.toFixed(2)}pp\n`;

  process.stdout.write(`[relabel] artefact  ${birdPath}\n`);
  process.stdout.write(`[relabel] gold      ${goldPath}\n`);
  process.stdout.write(
    `[relabel] matched   ${String(cases.length)} of ${String(artefact.per_case.length)} case(s)` +
      (missing.length === 0 ? '\n' : `, ${String(missing.length)} unmatched\n`),
  );
  process.stdout.write(
    line('memory, original', reading.treatment.original.percent, reading.treatment.original.correct),
  );
  process.stdout.write(
    line('memory, corrected', reading.treatment.corrected.percent, reading.treatment.corrected.correct),
  );
  process.stdout.write(
    line('baseline, original', reading.baseline.original.percent, reading.baseline.original.correct),
  );
  process.stdout.write(
    line('baseline, corrected', reading.baseline.corrected.percent, reading.baseline.corrected.correct),
  );
  process.stdout.write(
    `[relabel] delta     original ${reading.delta.original.toFixed(2)}pp ` +
      `[${(before.deltaCI.low * 100).toFixed(2)}, ${(before.deltaCI.high * 100).toFixed(2)}] p ${before.p.toFixed(4)}\n`,
  );
  process.stdout.write(
    `[relabel] delta     corrected ${reading.delta.corrected.toFixed(2)}pp ` +
      `[${(after.deltaCI.low * 100).toFixed(2)}, ${(after.deltaCI.high * 100).toFixed(2)}] p ${after.p.toFixed(4)}\n`,
  );
  process.stdout.write(
    `[relabel] flips     ${String(reading.flips.up)} up / ${String(reading.flips.down)} down; ` +
      `${String(reading.pairChanged)} question(s) changed which arm was ahead\n`,
  );
  process.stdout.write(group('relabelled', reading.unrevised));
  process.stdout.write(group('revised', reading.revised));
  process.stdout.write(`[relabel] verdict   ${verdict}\n`);
  return 0;
  } finally {
    await statements.close();
  }
}

void main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    // The statements run under a deadline, so a failure here is a database that did not open or a
    // statement that never returned. Printed rather than thrown, because one unreadable database
    // should not hide the scores for the other ten.
    process.stderr.write(`[relabel] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  },
);
