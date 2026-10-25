/**
 * POC-29 — what a judge would have to beat, measured on labels somebody else paid for.
 *
 * The audit carried one open item: an LLM judge could not be trusted until it reached
 * kappa >= 0.7 against 200 human labels. Two things were wrong with that sentence, and
 * this lane measures both.
 *
 * The first is the cost. Public adjudicated NL2SQL labels exist: ROSE-VEC publishes
 * 322 BIRD items, each a real system's prediction against a gold query, with a boolean
 * the annotators reached independently. The annotators' own five files are published
 * beside it, so the committee can be held to its own standard before any criterion is
 * held to the committee.
 *
 * The second is the reference. "Human labels" reads as a gold standard, but the
 * committee's agreement with itself is the ceiling: a criterion cannot agree with a
 * committee better than the committee agrees with itself, and a bar set above that
 * ceiling describes the annotation rather than the judge. Both numbers are printed
 * here so the bar can be read off the data instead of assumed.
 *
 * The lane then measures three criteria on the same 322 items:
 *
 *   - execution accuracy under ROSE's semantics (set of tuples, column order kept);
 *   - execution accuracy under this repository's semantics (multiset of canonicalised
 *     rows, column order dropped, numbers rounded). The two differ, and the difference
 *     is itself the finding: "EX" is not one metric;
 *   - two degenerate criteria, all-true and all-false, which are here to prove the
 *     instrument can say "no information" — their kappa must be zero by construction,
 *     while their accuracies are 0.67 and 0.33. A lane that reported accuracy alone
 *     would rank the first of those above the second and call it a result.
 *
 * Failure modes are split rather than collapsed: a row the criterion could not execute
 * is reported as unscored, not as a disagreement, because a database that refused the
 * query says nothing about whether the query was right.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  agreementReport,
  canonicalRows,
  cohenKappa,
  consensusOf,
  judgedPairs,
  labelDisputes,
  matches,
  parseRater,
  parseRoseVec,
  raterAgreement,
  rowsEqual,
  sha256OfFile,
  type AgreementReport,
  type JudgedPair,
  type RaterLabels,
  type RoseVecRow,
} from '@agentix-e/microglia-eval';
import { writeResult } from './lib.js';

const ROSE_DIR = process.env['ROSE_VEC_DIR'] ?? join(process.cwd(), 'eval', 'fixtures', 'rose-vec');
const DB_DIR = process.env['BIRD_DB_DIR'] ?? join(process.cwd(), 'eval', 'fixtures', 'bird-minidev');
const RATER_FILES = [
  'annotations_1.json',
  'annotations_2.json',
  'annotations_3.json',
  'annotations_4.json',
  'annotations_5.json',
] as const;
const ROSE_FILE = 'rose-vec-bird.json';

type Executed = {
  readonly ok: boolean;
  /** Cells in select-list order, which is how a Python tuple would arrive. */
  readonly tuples: readonly (readonly unknown[])[];
  /** The repository's canonical encoding: column names sorted, numbers rounded. */
  readonly canonical: readonly string[];
};

function execute(dbId: string, sql: string): Executed {
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(join(DB_DIR, `${dbId}.sqlite`), { readOnly: true });
    const rows = db.prepare(sql).all() as Record<string, unknown>[];
    // Object key order is select-list order for a statement read this way. Two columns
    // of the same name would collapse into one key, which makes this comparison laxer
    // than a Python tuple; the multiset criterion below does not share that weakness,
    // so a row where the two disagree is visible rather than silent.
    return { ok: true, tuples: rows.map((row) => Object.values(row)), canonical: canonicalRows(rows) };
  } catch {
    return { ok: false, tuples: [], canonical: [] };
  } finally {
    db?.close();
  }
}

/** ROSE's semantics: set of tuples, column order significant. */
function setVerdict(predicted: Executed, gold: Executed): boolean {
  return predicted.ok && gold.ok && rowsEqual(predicted.tuples, gold.tuples);
}

/** This repository's semantics, as the S2 lane applies it. */
function multisetVerdict(predicted: Executed, gold: Executed): boolean {
  return predicted.ok && gold.ok && matches(predicted.canonical, gold.canonical);
}

function pairsFor(rows: readonly RoseVecRow[], verdicts: ReadonlyMap<string, boolean>): readonly JudgedPair[] {
  return judgedPairs(rows, verdicts).pairs;
}

/** Only the numbers that exist are written: an absent interval is absent, not zero. */
function summarise(prefix: string, report: AgreementReport): Record<string, number> {
  const out: Record<string, number> = {
    [`${prefix}Accuracy`]: report.accuracy,
    // The four cells travel with the three summary numbers because the summary numbers
    // cannot say *which way* a criterion is wrong. A metric that calls correct queries
    // wrong and one that calls wrong queries correct can share an accuracy and a kappa,
    // and only the matrix tells them apart.
    [`${prefix}Both`]: report.confusion.both,
    [`${prefix}MeasuredOnly`]: report.confusion.measuredOnly,
    [`${prefix}ReferenceOnly`]: report.confusion.referenceOnly,
    [`${prefix}Neither`]: report.confusion.neither,
  };
  if (report.kappa !== undefined) out[`${prefix}Kappa`] = report.kappa;
  if (report.mcc !== undefined) out[`${prefix}Mcc`] = report.mcc;
  if (report.kappaCI !== undefined) {
    out[`${prefix}KappaLow`] = report.kappaCI.low;
    out[`${prefix}KappaHigh`] = report.kappaCI.high;
  }
  out[`${prefix}Positive`] = report.prevalence.measured;
  return out;
}

async function main(): Promise<void> {
  const raw = JSON.parse(await readFile(join(ROSE_DIR, ROSE_FILE), 'utf8')) as unknown;
  const rows = parseRoseVec(raw);
  const raters: RaterLabels[] = [];
  // The artefact carries its own provenance: the workflow checks these digests before the
  // lane starts, and the lane writes them again so a reader of the JSON alone can tell
  // which files produced the numbers. A pin that exists only in CI is a pin the artefact
  // cannot be audited against.
  const digests: string[] = [];
  for (const file of [ROSE_FILE, ...RATER_FILES]) {
    digests.push(`${file} ${await sha256OfFile(join(ROSE_DIR, file))}`);
  }
  for (const file of RATER_FILES) {
    const body = JSON.parse(await readFile(join(ROSE_DIR, file), 'utf8')) as unknown;
    raters.push(parseRater(body));
  }
  const committee = raterAgreement(raters);
  const consensus = consensusOf(raters);
  const disputes = labelDisputes(rows, consensus);

  const bySetVerdict = new Map<string, boolean>();
  const byMultisetVerdict = new Map<string, boolean>();
  const unscored: string[] = [];
  let semanticsDisagree = 0;
  for (const row of rows) {
    const gold = execute(row.dbId, row.goldSql);
    const predicted = execute(row.dbId, row.predictedSql);
    if (!predicted.ok) {
      unscored.push(row.questionId);
      continue;
    }
    const bySet = setVerdict(predicted, gold);
    const byMultiset = multisetVerdict(predicted, gold);
    if (bySet !== byMultiset) semanticsDisagree += 1;
    bySetVerdict.set(row.questionId, bySet);
    byMultisetVerdict.set(row.questionId, byMultiset);
  }

  // Every row unexecutable is a statement about the database directory, not about the
  // criterion, and it would silently produce an empty confusion matrix and no kappa.
  if (bySetVerdict.size === 0) {
    throw new Error(
      `no prediction could be executed against the databases in ${DB_DIR}; the lane measures execution accuracy, so an empty set would describe the directory rather than the criterion`,
    );
  }

  const reference = pairsFor(rows, new Map(rows.map((row) => [row.questionId, row.label])));
  const allTrue = pairsFor(rows, new Map(rows.map((row) => [row.questionId, true])));
  const allFalse = pairsFor(rows, new Map(rows.map((row) => [row.questionId, false])));
  const setReport = agreementReport(pairsFor(rows, bySetVerdict), { seed: 20261025, resamples: 2000 });
  const multisetReport = agreementReport(pairsFor(rows, byMultisetVerdict), { seed: 20261025, resamples: 2000 });
  const oracle = agreementReport(reference, { seed: 20261025, resamples: 200 });
  const trueKappa = cohenKappa(allTrue);
  const falseKappa = cohenKappa(allFalse);
  const positives = rows.filter((row) => row.label).length;

  // The controls are only controls if they land where the arithmetic says they must.
  if (trueKappa === undefined || Math.abs(trueKappa) > 1e-9) {
    throw new Error(`all-true control produced kappa ${String(trueKappa)}, expected 0`);
  }
  if (falseKappa === undefined || Math.abs(falseKappa) > 1e-9) {
    throw new Error(`all-false control produced kappa ${String(falseKappa)}, expected 0`);
  }
  if (oracle.kappa !== 1) {
    throw new Error(`oracle self-comparison produced kappa ${String(oracle.kappa)}, expected 1`);
  }
  // A published label the annotators' own files contradict means the parse or the file
  // is wrong, and every number below would be measured against the wrong target.
  if (disputes.length > 0) {
    throw new Error(`${disputes.length} published labels contradict the annotators' files`);
  }

  const estimablePairs = committee.pairs.filter((pair) => pair.kappa !== undefined);
  const pairKappas = estimablePairs.map((pair) => pair.kappa as number);

  await writeResult({
    id: 'judge-calibration',
    title: 'What a judge has to beat, on public adjudicated NL2SQL labels',
    ranAt: new Date().toISOString(),
    model: 'none (deterministic execution)',
    n: rows.length,
    calls: 0,
    metrics: {
      items: rows.length,
      unscored: unscored.length,
      committeeRaters: committee.raters,
      committeeSharedItems: committee.sharedItems,
      ...(committee.meanKappa === undefined ? {} : { committeeMeanKappa: committee.meanKappa }),
      ...(pairKappas.length === 0
        ? {}
        : { committeeMinPairKappa: Math.min(...pairKappas), committeeMaxPairKappa: Math.max(...pairKappas) }),
      consensusRebuilt: consensus.size,
      labelDisputes: disputes.length,
      semanticsDisagree,
      ...summarise('exSet', setReport),
      ...summarise('exMultiset', multisetReport),
      allTrueKappa: trueKappa,
      allFalseKappa: falseKappa,
      allTrueAccuracy: positives / rows.length,
      allFalseAccuracy: (rows.length - positives) / rows.length,
    },
    notes: [
      `Committee: ${committee.raters} annotators, ${committee.sharedItems} items rated twice, mean pairwise kappa ${committee.meanKappa?.toFixed(4) ?? 'not estimable'}.`,
      `Published labels rebuilt from the annotators' files: ${consensus.size} agreed of ${committee.sharedItems} shared, ${disputes.length} disputes.`,
      `Execution accuracy against the committee: set semantics kappa ${setReport.kappa?.toFixed(4) ?? 'not estimable'} (${setReport.confusion.referenceOnly} correct predictions called wrong), multiset semantics kappa ${multisetReport.kappa?.toFixed(4) ?? 'not estimable'} (${multisetReport.confusion.referenceOnly} called wrong).`,
      `The two execution semantics disagree on ${semanticsDisagree} of ${rows.length} items, which is why the metric has to be named.`,
      `Degenerate controls: all-true accuracy ${(positives / rows.length).toFixed(4)} at kappa 0, all-false accuracy ${((rows.length - positives) / rows.length).toFixed(4)} at kappa 0.`,
      `Inputs, sha256: ${digests.join('; ')}.`,
    ],
    samples: committee.pairs.map((pair) => ({ left: pair.left, right: pair.right, n: pair.n, kappa: pair.kappa ?? null })),
  });
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[judge-calibrate] failed: ${message}\n`);
  process.exitCode = 1;
});
