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
import {
  JUDGE_PROMPT_VERSION,
  REFUTER_PROMPT_VERSION,
  LlmClient,
  agreementReport,
  buildJudgePrompt,
  buildRefuterPrompt,
  canonicalRows,
  cascadeVerdict,
  evidencedVerdict,
  executeQuery,
  resolveDatabase,
  rowsDiffer,
  cohenKappa,
  consensusOf,
  judgePairs,
  judgedPairs,
  labelDisputes,
  mapPool,
  matches,
  parseJudgeReply,
  parseRater,
  parseRefuterReply,
  parseRoseVec,
  raterAgreement,
  rowsEqual,
  sampleRows,
  sha256OfFile,
  type AgreementReport,
  type JudgeVerdict,
  type JudgedPair,
  type QueryOutcome,
  type RefuterVerdict,
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

/**
 * Which criteria this run measures.
 *
 * `execution` is free and needs only the databases; `llm` adds a model call per item;
 * `both` puts them on one sample so the comparison is between criteria rather than
 * between runs. The default is `execution` because a lane that spends money by default
 * is a lane nobody can afford to re-run when a number looks wrong.
 */
type JudgeMode = 'execution' | 'llm' | 'both';

function judgeModeFrom(raw: string | undefined): JudgeMode {
  if (raw === undefined || raw === '' || raw === 'execution') return 'execution';
  if (raw === 'llm') return 'llm';
  if (raw === 'both') return 'both';
  throw new Error(`JUDGE_MODE must be execution, llm or both, got '${raw}'`);
}

const MODE = judgeModeFrom(process.env['JUDGE_MODE']);

/**
 * Whether the run stops at the Prover or adds ROSE's adversarial Refuter.
 *
 * The Prover alone approved 82% of the committee's 322 items against a committee rate of
 * 67%, and the extra approvals were the 50 wrong queries it found plausible. The Refuter
 * exists for exactly that failure: it is shown the reference query as evidence and asked
 * to name the difference that changes the answer. It only runs on what the Prover
 * approved, so its cost is proportional to how permissive the Prover is.
 */
type Cascade = 'prover' | 'cascade';

function cascadeFrom(raw: string | undefined): Cascade {
  if (raw === undefined || raw === '' || raw === 'prover') return 'prover';
  if (raw === 'cascade') return 'cascade';
  throw new Error(`JUDGE_CASCADE must be prover or cascade, got '${raw}'`);
}

const CASCADE = cascadeFrom(process.env['JUDGE_CASCADE']);
const JUDGE_MODEL = process.env['JUDGE_MODEL'] ?? 'deepseek-chat';
const JUDGE_ENDPOINT = process.env['JUDGE_ENDPOINT'];
const JUDGE_MAX_CALLS = Math.max(1, Math.trunc(Number(process.env['JUDGE_MAX_CALLS'] ?? 400)));
const JUDGE_CONCURRENCY = Math.min(8, Math.max(1, Math.trunc(Number(process.env['JUDGE_CONCURRENCY'] ?? 4))));

type Executed = QueryOutcome;

function execute(dbId: string, sql: string): Executed {
  return executeQuery(resolveDatabase(DB_DIR, dbId), sql);
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
  // A criterion that stated nothing has no accuracy. Writing 0 here would rank "did not
  // answer" below "answered everything wrongly", which is not a comparison anyone asked
  // for; the item count says what happened instead.
  const out: Record<string, number> = { [`${prefix}Items`]: report.n };
  if (report.n === 0) return out;
  out[`${prefix}Accuracy`] = report.accuracy;
  // The four cells travel with the three summary numbers because the summary numbers
  // cannot say *which way* a criterion is wrong. A metric that calls correct queries
  // wrong and one that calls wrong queries correct can share an accuracy and a kappa,
  // and only the matrix tells them apart.
  out[`${prefix}Both`] = report.confusion.both;
  out[`${prefix}MeasuredOnly`] = report.confusion.measuredOnly;
  out[`${prefix}ReferenceOnly`] = report.confusion.referenceOnly;
  out[`${prefix}Neither`] = report.confusion.neither;
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
  const executions = new Map<string, Executed>();
  const goldExecutions = new Map<string, Executed>();
  const unscored: string[] = [];
  let semanticsDisagree = 0;
  for (const row of rows) {
    const gold = execute(row.dbId, row.goldSql);
    const predicted = execute(row.dbId, row.predictedSql);
    if (!predicted.ok) {
      unscored.push(row.questionId);
      continue;
    }
    executions.set(row.questionId, predicted);
    goldExecutions.set(row.questionId, gold);
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

  // The judge, when the run is asked to pay for one. Same items, same executions: the
  // comparison that matters is between criteria on one sample, not between two runs
  // whose samples would differ by however many questions the model answered.
  const judgeVerdicts = new Map<string, JudgeVerdict>();
  const judgeFailures: string[] = [];
  let judgeCalls = 0;
  let judgePrompts = 0;
  if (MODE !== 'execution') {
    const apiKey = process.env['DEEPSEEK_API_KEY'] ?? '';
    if (apiKey === '') {
      throw new Error('JUDGE_MODE asks for a judge, and a judge without a key would measure nothing');
    }
    const client = new LlmClient({
      apiKey,
      model: JUDGE_MODEL,
      maxCalls: JUDGE_MAX_CALLS,
      ...(JUDGE_ENDPOINT === undefined || JUDGE_ENDPOINT === '' ? {} : { endpoint: JUDGE_ENDPOINT }),
    });
    const scorable = rows.filter((row) => executions.get(row.questionId) !== undefined);
    const replies = await mapPool(scorable, JUDGE_CONCURRENCY, async (row) => {
      const executed = executions.get(row.questionId) as Executed;
      const prompt = buildJudgePrompt({
        question: row.question,
        evidence: row.evidence,
        sql: row.predictedSql,
        columns: executed.columns,
        sample: sampleRows(executed.canonical),
        executionError: undefined,
      });
      try {
        const reply = await client.chat(prompt, 320);
        return { questionId: row.questionId, verdict: parseJudgeReply(reply.text) as JudgeVerdict | undefined };
      } catch {
        // One prompt that exhausted its retries is data about the endpoint, not about the
        // query. It is counted and left unstated rather than scored as a rejection.
        return { questionId: row.questionId, verdict: undefined };
      }
    });
    for (const replyItem of replies) {
      if (replyItem.verdict === undefined) judgeFailures.push(replyItem.questionId);
      else judgeVerdicts.set(replyItem.questionId, replyItem.verdict);
    }
    judgeCalls = client.stats.calls;
    judgePrompts = client.stats.prompts;
  }
  // The Refuter, on the subset the Prover approved. It sees the reference query, which
  // the Prover was denied, and is told the reference can be the wrong one — the framing
  // that makes this a second opinion rather than execution accuracy in a costume.
  const refuters = new Map<string, RefuterVerdict>();
  const refuterFailures: string[] = [];
  let refuterCalls = 0;
  if (MODE !== 'execution' && CASCADE === 'cascade') {
    const apiKey = process.env['DEEPSEEK_API_KEY'] ?? '';
    const client = new LlmClient({
      apiKey,
      model: JUDGE_MODEL,
      maxCalls: JUDGE_MAX_CALLS,
      ...(JUDGE_ENDPOINT === undefined || JUDGE_ENDPOINT === '' ? {} : { endpoint: JUDGE_ENDPOINT }),
    });
    const approved = rows.filter((row) => judgeVerdicts.get(row.questionId)?.correct === true);
    const replies = await mapPool(approved, JUDGE_CONCURRENCY, async (row) => {
      const executed = executions.get(row.questionId) as Executed;
      const gold = goldExecutions.get(row.questionId) as Executed;
      const prompt = buildRefuterPrompt({
        question: row.question,
        evidence: row.evidence,
        sql: row.predictedSql,
        columns: executed.columns,
        sample: sampleRows(executed.canonical),
        goldSql: row.goldSql,
        goldColumns: gold.columns,
        goldSample: sampleRows(gold.canonical),
      });
      try {
        const reply = await client.chat(prompt, 320);
        return { questionId: row.questionId, verdict: parseRefuterReply(reply.text) as RefuterVerdict | undefined };
      } catch {
        return { questionId: row.questionId, verdict: undefined };
      }
    });
    for (const replyItem of replies) {
      if (replyItem.verdict === undefined) refuterFailures.push(replyItem.questionId);
      else refuters.set(replyItem.questionId, replyItem.verdict);
    }
    refuterCalls = client.stats.calls;
  }

  // The cascade as a criterion: approved only where the Prover approved and the Refuter
  // did not overturn. Same items, so the comparison with the Prover alone is a difference
  // in mechanism rather than in sample.
  //
  // `accepts` is a parameter because of what the first run showed: 94 of 101 overturns
  // were attributed to GOLD_ERROR, and "the reference is wrong" is the easiest thing for
  // a refuter to say. Two variants are computed from the same replies, so the ablation
  // costs no extra calls — one takes every overturn, the other refuses the ones that
  // blame the reference. If the gain survives refusing them, it does not rest on the
  // claim nobody has checked.
  // Three readings, one per line, each delegating the decision to the shared definition
  // so the lane cannot drift from the module the tests cover.
  const buildVerdicts = (
    decide: (prover: JudgeVerdict, refuter: RefuterVerdict | undefined, questionId: string) => boolean | undefined,
  ): Map<string, JudgeVerdict> => {
    const verdicts = new Map<string, JudgeVerdict>();
    for (const row of rows) {
      const prover = judgeVerdicts.get(row.questionId);
      if (prover === undefined) continue;
      const refuter = refuters.get(row.questionId);
      const decided = decide(prover, refuter, row.questionId);
      verdicts.set(row.questionId, {
        correct: decided,
        rationale: refuter?.rationale ?? prover.rationale,
        stated: decided === undefined ? 'unknown' : decided ? 'correct' : 'incorrect',
      });
    }
    return verdicts;
  };

  // Every overturn, crossed against what execution accuracy already knew about the item.
  //
  // This is the check the cascade's kappa needs and cannot supply itself. A refuter that
  // says "the reference is wrong" about a pair of queries that returned *the same rows*
  // is making a claim the execution has no evidence for; one that says it where the rows
  // differ, and the committee still approved the prediction, is describing the case ROSE
  // exists for. The two are counted apart so the claim can be sized rather than believed.
  const rowById = new Map(rows.map((row) => [row.questionId, row]));
  const overturns = [...refuters.entries()].filter(([, verdict]) => verdict.overturned === true);
  const crossed = overturns.map(([questionId, verdict]) => ({
    questionId,
    diagnosis: verdict.diagnosis,
    exAgrees: bySetVerdict.get(questionId) === true,
    committeeAccepted: rowById.get(questionId)?.label === true,
    rationale: verdict.rationale,
  }));
  const counts = (predicate: (entry: (typeof crossed)[number]) => boolean): number => crossed.filter(predicate).length;
  const crossTab = {
    goldErrorSameRows: counts((entry) => entry.diagnosis === 'gold-error' && entry.exAgrees),
    goldErrorDifferentRows: counts((entry) => entry.diagnosis === 'gold-error' && !entry.exAgrees),
    goldErrorCommitteeAccepted: counts((entry) => entry.diagnosis === 'gold-error' && entry.committeeAccepted),
    otherSameRows: counts((entry) => entry.diagnosis !== 'gold-error' && entry.exAgrees),
    otherDifferentRows: counts((entry) => entry.diagnosis !== 'gold-error' && !entry.exAgrees),
  };

  const cascadeVerdicts = buildVerdicts((prover, refuter) => cascadeVerdict(prover, refuter));
  const cascadeOutcome = judgePairs(rows, cascadeVerdicts);
  const cascadeReport = agreementReport(cascadeOutcome.pairs, { seed: 20261025, resamples: 2000 });
  // The strict reading refuses every `GOLD_ERROR`, which is too blunt: 72 of the 82 landed
  // on items whose two queries returned different rows, and that is the case the mechanism
  // exists for. What is actually indefensible is narrower — blaming the reference for a
  // query that returned *the same rows* — so the third variant refuses only that.
  //
  // This is the useful role for execution accuracy, and the reason it is worth keeping
  // even though it makes a poor criterion: equal rows do not prove equal logic, so it can
  // never license an approval, but unequal rows do prove unequal logic, so it can always
  // veto a claim that the two are the same. Necessary condition, used as a veto.
  const strictVerdicts = buildVerdicts((prover, refuter) =>
    cascadeVerdict(prover, refuter?.diagnosis === 'gold-error' ? { ...refuter, overturned: false } : refuter),
  );
  const strictReport = agreementReport(judgePairs(rows, strictVerdicts).pairs, { seed: 20261025, resamples: 2000 });
  const evidencedVerdicts = buildVerdicts((prover, refuter, questionId) =>
    evidencedVerdict(
      prover,
      refuter,
      rowsDiffer(executions.get(questionId) as Executed, goldExecutions.get(questionId) as Executed),
    ),
  );
  const evidencedReport = agreementReport(judgePairs(rows, evidencedVerdicts).pairs, {
    seed: 20261025,
    resamples: 2000,
  });
  const diagnoses = [...refuters.values()].reduce<Record<string, number>>((counts, verdict) => {
    counts[verdict.diagnosis] = (counts[verdict.diagnosis] ?? 0) + 1;
    return counts;
  }, {});

  const judgeOutcome = judgePairs(rows, judgeVerdicts);
  const judgeReport = agreementReport(judgeOutcome.pairs, { seed: 20261025, resamples: 2000 });

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
    variant: MODE === 'execution' ? 'execution' : `${MODE}+${CASCADE}`,
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
      ...(MODE === 'execution'
        ? {}
        : {
            judgeCalls,
            judgePrompts,
            judgeFailed: judgeFailures.length,
            judgeUnstated: judgeOutcome.unstated.length,
            judgeUnparsed: judgeOutcome.unparsed.length,
            ...summarise('llm', judgeReport),
            ...(CASCADE === 'cascade'
              ? {
                  refuterCalls,
                  refuterFailed: refuterFailures.length,
                  refuterOverturned: [...refuters.values()].filter((verdict) => verdict.overturned === true).length,
                  refuterUnparsed: [...refuters.values()].filter((verdict) => verdict.stated === 'unparsed').length,
                  refuterGoldError: diagnoses['gold-error'] ?? 0,
                  refuterAmbiguous: diagnoses['ambiguous'] ?? 0,
                  refuterCoincidental: diagnoses['coincidental'] ?? 0,
                  refuterNoDiagnosis: diagnoses['none'] ?? 0,
                  ...summarise('cascade', cascadeReport),
                  ...summarise('cascadeStrict', strictReport),
                  ...summarise('cascadeEvidenced', evidencedReport),
                  refuterOverturnedSameRows: crossed.filter((entry) => entry.exAgrees).length,
                  refuterOverturnedDifferentRows: crossed.filter((entry) => !entry.exAgrees).length,
                  ...Object.fromEntries(Object.entries(crossTab)),
                }
              : {}),
          }),
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
      ...(MODE === 'execution'
        ? []
        : [
            `Judge ${JUDGE_MODEL} (${JUDGE_PROMPT_VERSION}): kappa ${judgeReport.kappa?.toFixed(4) ?? 'not estimable'} on ${judgeReport.n} stated verdicts of ${rows.length}, ${judgeFailures.length} calls failed, ${judgeOutcome.unparsed.length} replies unparsed.`,
            ...(CASCADE === 'cascade'
              ? [
                  `Refuter (${REFUTER_PROMPT_VERSION}) on ${refuterCalls} approved items: ${[...refuters.values()].filter((verdict) => verdict.overturned === true).length} overturned, ${refuterFailures.length} calls failed, ${[...refuters.values()].filter((verdict) => verdict.stated === 'unparsed').length} unparsed; cascade kappa ${cascadeReport.kappa?.toFixed(4) ?? 'not estimable'} on ${cascadeReport.n}; refusing overturns that blame the reference gives kappa ${strictReport.kappa?.toFixed(4) ?? 'not estimable'}, and refusing only those where the two queries returned the same rows gives kappa ${evidencedReport.kappa?.toFixed(4) ?? 'not estimable'}.`,
                ]
              : []),
          ]),
    ],
    samples: [
      ...committee.pairs.map((pair) => ({ kind: 'rater-pair', left: pair.left, right: pair.right, n: pair.n, kappa: pair.kappa ?? null })),
      ...crossed.map((entry) => ({ kind: 'overturn', ...entry })),
    ],
  });
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[judge-calibrate] failed: ${message}\n`);
  process.exitCode = 1;
});
