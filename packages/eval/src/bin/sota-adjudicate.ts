/**
 * POC-30 — re-score the S2 answers with a criterion that was not in the room when they were given.
 *
 * Iteration 71 showed the criterion was not what produced the −3.43pp: `set` and `multiset`
 * disagree on 7 of 350 items and none of them changes hands. But both are execution
 * accuracy, and execution accuracy is the thing under suspicion — 87 of 216 correct
 * queries fail it on ROSE-VEC. A null that survives one reading of EX has survived EX, not
 * the question.
 *
 * This lane answers it without asking the model anything new. The S2 artefact carries both
 * arms' SQL per question; the evidenced cascade from iterations 72–73 supplies a criterion
 * whose agreement with a human committee is 0.67 where EX's is 0.47. The answers are fixed;
 * only the judgement changes. If the memory still costs points under that criterion, the
 * finding is about the memory. If it does not, the finding was about the metric.
 *
 * The cost is real and is stated before the first call: four model calls per question in
 * the worst case (two arms, prover then refuter). `SOTA_JUDGE_MAX_CALLS` caps it, and a run
 * that hits the cap fails rather than reporting a delta over the questions it reached.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  LlmClient,
  JUDGE_PROMPT_VERSION,
  REFUTER_PROMPT_VERSION,
  buildJudgePrompt,
  buildRefuterPrompt,
  comparePaired,
  evidencedVerdict,
  executeQuery,
  mapPool,
  resolveDatabase,
  parseJudgeReply,
  parseRefuterReply,
  rowsDiffer,
  sampleRows,
  type JudgeVerdict,
  type QueryOutcome,
  type RefuterVerdict,
} from '@agentix-e/microglia-eval';
import { writeResult } from './lib.js';

const RESULT_DIR = process.env['POC_RESULT_DIR'] ?? join(process.cwd(), 'eval', 'results');
const DB_DIR = process.env['BIRD_DB_DIR'] ?? join(process.cwd(), 'eval', 'fixtures', 'bird-minidev');
const SOURCE = process.env['SOTA_ARTEFACT'] ?? 'poc-sota-bird.json';
const MODEL = process.env['JUDGE_MODEL'] ?? 'deepseek-chat';
const ENDPOINT = process.env['JUDGE_ENDPOINT'];
const MAX_CALLS = Math.max(1, Math.trunc(Number(process.env['JUDGE_MAX_CALLS'] ?? 2000)));
const CONCURRENCY = Math.min(8, Math.max(1, Math.trunc(Number(process.env['JUDGE_CONCURRENCY'] ?? 4))));

type Case = {
  readonly id: string;
  readonly question: string;
  readonly dbId: string;
  readonly goldSql: string;
  readonly predictedSql: string;
  readonly baselineSql: string;
  readonly correct: boolean;
  readonly withoutMemoryCorrect: boolean;
  readonly fold: number;
};

type Answer = {
  readonly prover: JudgeVerdict;
  readonly refuter: RefuterVerdict | undefined;
  readonly rowsDiffer: boolean;
};

async function judgeOne(
  client: LlmClient,
  question: string,
  dbId: string,
  sql: string,
  gold: QueryOutcome,
  goldSql: string,
  evidence: string | undefined,
): Promise<Answer | undefined> {
  const run = executeQuery(resolveDatabase(DB_DIR, dbId), sql);
  const prompt = buildJudgePrompt({
    question,
    evidence,
    sql,
    columns: run.columns,
    sample: sampleRows(run.canonical),
    executionError: run.ok ? undefined : run.error,
  });
  let prover: JudgeVerdict;
  try {
    prover = parseJudgeReply((await client.chat(prompt, 320)).text);
  } catch {
    return undefined;
  }
  // The refuter only runs where the prover approved: a rejected query needs no second
  // opinion, and the cost then scales with how permissive the prover is.
  if (prover.correct !== true) return { prover, refuter: undefined, rowsDiffer: rowsDiffer(run, gold) };
  const refuterPrompt = buildRefuterPrompt({
    question,
    evidence,
    sql,
    columns: run.columns,
    sample: sampleRows(run.canonical),
    goldSql,
    goldColumns: gold.columns,
    goldSample: sampleRows(gold.canonical),
  });
  try {
    const refuter = parseRefuterReply((await client.chat(refuterPrompt, 320)).text);
    return { prover, refuter, rowsDiffer: rowsDiffer(run, gold) };
  } catch {
    return { prover, refuter: undefined, rowsDiffer: rowsDiffer(run, gold) };
  }
}

async function main(): Promise<void> {
  const artefact = JSON.parse(await readFile(join(RESULT_DIR, SOURCE), 'utf8')) as {
    per_case?: readonly Case[];
    prompt_version?: string;
    scored_by?: string;
  };
  const cases = artefact.per_case;
  if (cases === undefined || cases.length === 0) {
    throw new Error(`${SOURCE} carries no per_case rows; the adjudication has nothing to re-score`);
  }
  const apiKey = process.env['DEEPSEEK_API_KEY'] ?? '';
  if (apiKey === '') throw new Error('DEEPSEEK_API_KEY is required: this lane re-scores with a model');
  const client = new LlmClient({
    apiKey,
    model: MODEL,
    maxCalls: MAX_CALLS,
    ...(ENDPOINT === undefined || ENDPOINT === '' ? {} : { endpoint: ENDPOINT }),
  });

  const scored = await mapPool(cases, CONCURRENCY, async (item) => {
    const gold = executeQuery(resolveDatabase(DB_DIR, item.dbId), item.goldSql);
    const [withMemory, withoutMemory] = await Promise.all([
      judgeOne(client, item.question, item.dbId, item.predictedSql, gold, item.goldSql, undefined),
      judgeOne(client, item.question, item.dbId, item.baselineSql, gold, item.goldSql, undefined),
    ]);
    const verdictOf = (answer: Answer | undefined): boolean | undefined =>
      answer === undefined ? undefined : evidencedVerdict(answer.prover, answer.refuter, answer.rowsDiffer);
    return {
      id: item.id,
      fold: item.fold,
      withMemory: verdictOf(withMemory),
      withoutMemory: verdictOf(withoutMemory),
      execution: { withMemory: item.correct, withoutMemory: item.withoutMemoryCorrect },
    };
  });

  // A pair needs both halves. Dropping a question where one arm failed to answer would
  // quietly compare different samples, so those are counted and removed together.
  const paired = scored.filter(
    (item): item is typeof item & { withMemory: boolean; withoutMemory: boolean } =>
      item.withMemory !== undefined && item.withoutMemory !== undefined,
  );
  if (paired.length === 0) {
    throw new Error('no question was answered by both arms; the delta would describe the endpoint');
  }
  const judged = comparePaired(
    paired.map((item) => item.withoutMemory),
    paired.map((item) => item.withMemory),
  );
  const executed = comparePaired(
    paired.map((item) => item.execution.withoutMemory),
    paired.map((item) => item.execution.withMemory),
  );
  const changedHands = paired.filter((item) => item.withMemory !== item.execution.withMemory).length;

  await writeResult({
    id: 'sota-adjudication',
    title: 'The S2 answers, re-scored by a criterion EX did not choose',
    ranAt: new Date().toISOString(),
    model: MODEL,
    n: paired.length,
    calls: client.stats.calls,
    variant: `${JUDGE_PROMPT_VERSION}+${REFUTER_PROMPT_VERSION}`,
    metrics: {
      questions: paired.length,
      dropped: cases.length - paired.length,
      judged_without_memory: judged.baselineAccuracy,
      judged_with_memory: judged.treatmentAccuracy,
      judged_delta_pp: judged.delta * 100,
      judged_ci_low_pp: judged.deltaCI.low * 100,
      judged_ci_high_pp: judged.deltaCI.high * 100,
      judged_p: judged.p,
      judged_lost: judged.lost,
      judged_gained: judged.gained,
      execution_without_memory: executed.baselineAccuracy,
      execution_with_memory: executed.treatmentAccuracy,
      execution_delta_pp: executed.delta * 100,
      execution_p: executed.p,
      // How often the new criterion disagrees with the one the run was scored by. This is
      // the size of the disagreement between the two measurements, not between two runs.
      verdict_changes: changedHands,
      retries: client.stats.retries,
    },
    notes: [
      `Source ${SOURCE}, ${cases.length} questions, ${paired.length} answered by both arms.`,
      `Judged: ${judged.baselineAccuracy.toFixed(4)} -> ${judged.treatmentAccuracy.toFixed(4)}, delta ${(judged.delta * 100).toFixed(2)}pp [${(judged.deltaCI.low * 100).toFixed(2)}, ${(judged.deltaCI.high * 100).toFixed(2)}], p=${judged.p.toFixed(4)}.`,
      `Execution: delta ${(executed.delta * 100).toFixed(2)}pp, p=${executed.p.toFixed(4)}.`,
      `The two criteria disagree on ${changedHands} of ${paired.length} judged verdicts.`,
    ],
    per_task: scored,
  });
}

main().catch((error: unknown) => {
  process.stderr.write(`[sota-adjudication] failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
