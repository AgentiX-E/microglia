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
 *  - `POC_MAX_CALLS`   hard call budget; default 8000, sized from a measured five-fold run
 *  - `SOTA_DEADLINE_MIN` wall-clock limit for the lane; default 130, under the workflow's step
 *                      timeout, so a run that cannot finish writes down what it measured
 *  - `SOTA_DISTILL_CONCURRENCY` distillation replies in flight at once; default 8
 */
import { writeJson } from './lib.js';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  MicrogliaError,
  corroborationShare,
  mulberry32,
  queryCoverage,
  steppingClock,
  type KnowledgeItem,
} from '@agentix-e/microglia-core';
import { makePack } from '@agentix-e/microglia-core/apply';
import { EmbeddedMemory, MemoryJournal } from '@agentix-e/microglia-core/memory';
import { openMicroglia } from '@agentix-e/microglia-core/capture';
import {
  combineInterpreters,
  createLlmInterpreter,
  ruleInterpreter,
  type DistillForm,
  type DropReason,
  type Interpreter,
} from '@agentix-e/microglia-core/distill';
import {
  DistillCache,
  GenerationCache,
  HOUSE_CONVENTIONS,
  armPairsAgainstFull,
  OPTIONAL_ARMS,
  ADVISORY_SENTENCE,
  ARM_STANDING,
  PROHIBITIVE_HEADING,
  PROMPT_VERSION,
  admissionOf,
  anchorPromptFor,
  archiveVerdict,
  assignFolds,
  LlmClient,
  buildValidityGates,
  canonicalRows,
  comparePaired,
  creditHistogram,
  decisiveHistogram,
  outcomeCredit,
  parseDecisivePolicy,
  retireeFromDecisive,
  clearanceFromDecisive,
  doseMatchedDrop,
  renderRawPack,
  rawEventVerbatim,
  type RawEvent,
  conventionOf,
  dedupeQuestions,
  detectableDelta,
  extractSql,
  choicePrompt,
  choicePromptWithResults,
  failureKind,
  forecastBudget,
  interleaveByKey,
  judgeScalar,
  linkSchema,
  mapPool,
  parseChoice,
  probeSummary,
  renderRows,
  renderValue,
  schemaLinkSplit,
  shuffledSource,
  TRANSFER_FLOOR,
  compareSubstrates,
  poolSubstrates,
  transferSummary,
  transferTargets,
  transferringItemIds,
  type DecisiveCredit,
  type TransferTrial,
  verdictOf,
  schemaWithValues,
  schemaSql,
  poolSummary,
  readComposite,
  signalReadings,
  unionCeiling,
  VALUE_VOTERS,
  execSignatureOf,
  shapeOf,
  collectMschema,
  renderMschema,
  CONTRASTS,
  contrastTable,
  classify,
  densityGates,
  densityReport,
  foreignPanels,
  injectionFormOf,
  selectDensityRules,
  targetPanels,
  templateCoverage,
  transferStatement,
  priorPicks,
  priorScopeOf,
  priorTable,
  samplingSpecOf,
  selectByConsistency,
  selectByModel,
  selectByShape,
  selectFirst,
  selectRandom,
  selectionStats,
  signatureOf,
  type Admission,
  type DensityReport,
  type DensityRule,
  type DensityTarget,
  type DensityTrial,
  type ExecSignature,
  type GeneratorKind,
  type PackCell,
  type PoolQuestion,
  type PriorScope,
  type PooledSubstrate,
  type ProbeSummary,
  type ProbeTrial,
  type SubstrateComparison,
  type TransferGateInput,
  type TransferSummary,
  type ValueSample,
  matches,
  mentionsAny,
  mismatchNote,
  missingDatabases,
  executeQuery,
  groundedItems,
  parseArms,
  parseManifest,
  parseRetirementPolicy,
  artefactIdOf,
  poolOf,
  splitFrom,
  splitNameOf,
  retireeFrom,
  promptFor,
  reportedSql,
  requirePopulated,
  retryPromptFor,
  retrySubset,
  relevanceSplit,
  resolveDatabase,
  schemaIndex,
  sha256OfFile,
  type AnchorMode,
  type BirdManifest,
  type Split,
  type SqlArm,
  type ChatReply,
  type ResultComparison,
  type ConventionName,
  type ConventionSpec,
  type Candidate,
  type FramingDelivery,
  type PackKind,
  type PackStanding,
  type ResultShape,
  type Selection,
  type SelectionStats,
  type SchemaNames,
  type TemplateAttempt,
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

/**
 * How many of a fold's learning questions to distil from, 0 meaning all of them.
 *
 * Distillation is the expensive half of a fold: on the 350-question slice a fold learns from 280
 * questions for about 280 calls, and on the 1,534-question dev split it learns from 1,227 for
 * about 1,227 — five folds of which project to 12,037 calls against a 8,000 cap. That projection
 * is a measurement, not a guess: the first dev dispatch printed it after finishing its first fold.
 *
 * A reproduction of a no-memory number does not need a fully learned store, so a stage that only
 * wants the baseline can cap the learning sample and say so. The cap travels in the artefact,
 * because a store built from 64 questions is not the store the flywheel readings describe and a
 * reader who compared the two would be comparing two different treatments.
 */
const LEARN_SAMPLE = Math.trunc(nonNegative(process.env['SOTA_LEARN_SAMPLE'], 0));

/**
 * How long the whole lane may run, in minutes.
 *
 * The workflow step that runs this lane has a timeout, and until this iteration that timeout was the
 * only limit the run had: 160 minutes after the start, the runner killed the process, and a run that
 * had finished three of five folds and measured 1,964 calls left behind no artefact at all. A limit
 * the lane owns is a different thing. It is checked between calls, it is set below the step timeout,
 * and when it fires the lane writes the folds it completed and the reason it stopped — which is a
 * result a reader can size the next dispatch from.
 *
 * 130 minutes against a 240-minute step: the gap is the tail of the last fold plus the publish step,
 * and it is deliberately larger than one fold's worth of work, because stopping early is only useful
 * if the stop is graceful.
 */
const DEADLINE_MIN = nonNegative(process.env['SOTA_DEADLINE_MIN'], 130);

/**
 * Distillation replies in flight at once.
 *
 * The batch is applied in corpus order but each prompt is independent, so the round trips can
 * overlap. On the dev split a fold distils about twenty-five corrections, and a serial loop over
 * them paid the sum of the latencies: the second fold's learning half took 43 minutes where the
 * first took under four, which is a provider that got slower and a client that waited for it one
 * call at a time.
 */
const DISTILL_CONCURRENCY = Math.trunc(nonNegative(process.env['SOTA_DISTILL_CONCURRENCY'], 8));

/**
 * Which split of BIRD this run measures.
 *
 * Two splits, two purposes. `minidev` is the 350-question slice every transfer experiment in this
 * repository was measured on. `dev` is the full 1,534 questions, and its single purpose is
 * reproduction: a published number measured on 1,534 can only be reproduced on 1,534. The split
 * decides the manifest, the question file, and whether the easiest third is filtered out, so it is
 * read once and carried in the artefact's configuration.
 */
const SPLIT: Split = splitOf(process.env['SOTA_SPLIT']);

function splitOf(raw: string | undefined): Split {
  try {
    return splitFrom(raw);
  } catch (error) {
    throw new MicrogliaError('MG_E_CONFIG', (error as Error).message, { known: 'minidev, dev' });
  }
}

/**
 * Where this split's run is written.
 *
 * Two artefacts rather than one file rewritten: the two splits answer different questions —
 * 350 questions about transfer, 1,534 about reproduction — and overwriting the smaller one to
 * store the larger would delete the evidence for every reading that quotes it, including the
 * `indicative` verdict whose whole point is that it can be recomputed.
 */
const ARTEFACT_ID = artefactIdOf(SPLIT);

/**
 * The pre-registration this run executes, by id, or the empty string when it was run by hand.
 *
 * The workflow reads the same value and refuses a dispatch without one; the lane carries it into
 * the artefact so that the prediction and the measurement are one file apart rather than one
 * conversation apart.
 */
const PREREG = (process.env['SOTA_PREREG'] ?? '').trim();

/**
 * The name this run's split goes by in the artefact.
 *
 * `dev` carries the published cell's own spelling — `BIRD dev` — because the admissibility rule
 * compares split names, and a run that measured the right 1,534 questions under a different name
 * would be filed as `indicative` and never as the reproduction it is.
 */
const SPLIT_NAME = splitNameOf(SPLIT);
const FOLDS = Math.max(2, Math.trunc(nonNegative(process.env['SOTA_FOLDS'], 5)));
const SEED = Math.trunc(nonNegative(process.env['SOTA_SEED'], 7));
/**
 * The temperature the sample-N arms draw at.
 *
 * Not 0, because at 0 the draws are identical and the arms measure nothing — the endpoint is
 * already not deterministic at 0, but not reliably enough to produce five different candidates.
 * Not 1 either: a SQL query has a large exact-syntax prior, and the interesting variation is in
 * which join and which aggregate are chosen, not in whether the statement is well formed.
 */
const SAMPLE_TEMPERATURE = nonNegative(process.env['SOTA_SAMPLE_TEMPERATURE'], 0.7);
const GENERALIZE = (process.env['SOTA_GENERALIZE'] ?? 'true') !== 'false';
const RESAMPLES = Math.max(1000, Math.trunc(nonNegative(process.env['SOTA_RESAMPLES'], 10_000)));
const MODEL = process.env['SOTA_MODEL'] ?? 'deepseek-chat';
const MAX_CALLS = nonNegative(process.env['POC_MAX_CALLS'], 8000);

/**
 * How many model calls are in flight at once.
 *
 * Six, not "as many as possible": the calls are latency-bound (2–5 s each) and a
 * DeepSeek endpoint that sees thirty simultaneous requests answers some of them
 * with 429, which the retry policy then turns into jittered wait time. Six keeps
 * the wall clock near the network's floor — 2,800 calls at 3 s each is 23 minutes
 * instead of 140 — while leaving the endpoint room to answer.
 *
 * The value is part of the artefact: a run at a different concurrency is a
 * different run, and a reader needs to know which one produced the number.
 */
const CONCURRENCY = Math.min(16, Math.max(1, Math.trunc(nonNegative(process.env['SOTA_CONCURRENCY'], 6))));

/** Consecutive exhausted-retry calls that end the run instead of the evidence. */
const BREAKER_THRESHOLD = 8;

/**
 * The house convention of the S2b protocol (roadmap): a workspace that reports
 * numeric answers in thousands, rounded to three decimals.
 *
 * It is deliberately unreachable from the schema — no column says "divide by a
 * thousand" — which is the property every measurement in this repository that
 * moved accuracy has in common. `SOTA_CONVENTION=thousands` turns the lane into
 * that experiment; empty keeps the ordinary execution-accuracy lane.
 */
const CONVENTION_NAME: ConventionName | undefined = conventionOf(process.env['SOTA_CONVENTION'] ?? '');
const ACTIVE: ConventionSpec | undefined =
  CONVENTION_NAME === undefined ? undefined : HOUSE_CONVENTIONS[CONVENTION_NAME];

type Task = {
  /** True when answers are judged under the house convention. */
  readonly convention: boolean;
  /** The expected reported value per case id, when the convention is on. */
  readonly expected: ReadonlyMap<string, number>;
};
/** Task name under which knowledge is scoped, and therefore recalled. */
const TASK = 'sql.generate';

/**
 * The arm set has one definition, in the package: a lane-local copy is how `full-validated`
 * came to compile here while `parseArms` rejected it at runtime.
 */
type ArmName = SqlArm;

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

/**
 * `parseArms` is a library function and refuses with a `RangeError`; the lane's
 * contract is a named configuration failure, so a typo in `SOTA_ARMS` reads the
 * same way as a typo in `SOTA_CONVENTION` instead of as a crash.
 */
function armsFrom(raw: string | undefined): Set<ArmName> {
  try {
    return parseArms(raw) as Set<ArmName>;
  } catch (error) {
    throw new MicrogliaError('MG_E_CONFIG', (error as Error).message, {
      known: OPTIONAL_ARMS.join(', '),
    });
  }
}

/**
 * The distillation cache, persisted so a replayed dispatch learns the same store.
 *
 * Unset path means no persistence: the run pays for every distillation, as every run did
 * before this existed. The workflow points it at a path it caches between dispatches.
 */
const DISTILL_CACHE_PATH = process.env['SOTA_DISTILL_CACHE'] ?? '';
const distillations = DistillCache.load(DISTILL_CACHE_PATH);

const ARMS = armsFrom(process.env['SOTA_ARMS']);

/**
 * When an injected rule has earned retirement.
 *
 * Two knobs, both settings, because the right value is the experiment: the trial floor
 * keeps a single unlucky question from retiring anything, and the failure share decides
 * how much of a rule's record has to be bad. See `validation.ts` for why the test is a
 * share rather than a count.
 */
const RETIREMENT = parseRetirementPolicy({
  minTrials: process.env['SOTA_VALIDATION_TRIALS'],
  failureRate: process.env['SOTA_VALIDATION_FAILURE_RATE'],
});

/**
 * How a rule's record is scored before it is retired.
 *
 * `absolute` asks whether the rule was present when the answer was wrong, which is
 * confounded with the question's difficulty: the failure counts it produces fit a single
 * binomial at the lane's own error rate. `counterfactual` answers every validation question
 * twice and credits a rule only where the outcome changed, which costs a second call per
 * row and is the only score that can separate a rule that hurts from a question that is
 * hard. Default `absolute`, because the cheaper reading should be the one a caller gets
 * without asking.
 */
type CreditMode = 'absolute' | 'counterfactual';

function creditModeFrom(raw: string | undefined): CreditMode {
  if (raw === undefined || raw === '' || raw === 'absolute') return 'absolute';
  if (raw === 'counterfactual') return 'counterfactual';
  throw new Error(`SOTA_VALIDATION_CREDIT must be absolute or counterfactual, got '${raw}'`);
}

const CREDIT = creditModeFrom(process.env['SOTA_VALIDATION_CREDIT']);

/** The counterfactual policy, which is stricter than the absolute one on purpose. */
const DECISIVE = parseDecisivePolicy({
  minDecisive: process.env['SOTA_DECISIVE_TRIALS'],
  harmShare: process.env['SOTA_HARM_SHARE'],
});

/**
 * The arms that answer first and only then consult a memory.
 *
 * One list, because the eligible set has to be the same for all of them: the trigger is a
 * property of the first answer — it did not run, or it ran and returned nothing — so an
 * arm that retried a different set of questions would be measuring a different population.
 * `retry-blank` is the same second attempt with no pack at all, which is what separates
 * "retrying helps" from "the memory helps a retry".
 */
const RETRY_ARMS = ['full-onretry', 'full-repair-onretry', 'retry-blank', 'retry-keyed'] as const;

/**
 * The character budgets the dose arms use.
 *
 * A table so the arm names in the union and the budgets in the lane cannot drift: the arm is
 * `chars-<n>`, and the number in its name is the number the pack layer is given.
 *
 * The points above 1,200 are not symmetric decoration. An item renders at about 590 characters and
 * the pack layer adds whole items, so 150 and 300 admit nothing and 600 admits one: the low end of
 * this table collapses to `none`, and only the high end can test whether harm grows with the number
 * of items rather than merely shrinking when there are none.
 */
const CHARS_ARMS = [150, 300, 600, 900, 1800, 2400] as const;
type RetryArm = (typeof RETRY_ARMS)[number];

/**
 * The anchored arms this run was asked for, how firmly each revises, and whether it is shown a pack.
 *
 * A list rather than a set of booleans so the modes cannot diverge in anything except the
 * instruction: they read the same pack, see the same draft, and differ in one sentence. `injects`
 * is the third axis and exists because the mechanism's headline number has never had its control:
 * `anchor-blank` writes the same second pass with no block, so the difference between it and
 * `full-anchored` is the note rather than the revision.
 */
const ANCHORED: readonly { readonly arm: ArmName; readonly mode: AnchorMode; readonly injects: boolean }[] =
  (
    [
      { arm: 'full-anchored', mode: 'conservative', injects: true },
      { arm: 'full-anchored-conditional', mode: 'conditional', injects: true },
      { arm: 'full-anchored-hold', mode: 'hold', injects: true },
      { arm: 'anchor-hold', mode: 'hold', injects: false },
      { arm: 'anchor-blank', mode: 'conservative', injects: false },
    ] as const
  ).filter((entry) => ARMS.has(entry.arm));

/** One entry per fold in which the deletion arm ran. */
const validations: (Awaited<ReturnType<typeof validateMemory>> & { fold: number })[] = [];


/**
 * Which reading of "the same answer" is the lane's verdict, and which is its shadow.
 *
 * `multiset` stays the default because every number this lane has published was scored
 * that way, and a silent change of criterion would make the next run incomparable with
 * the last while claiming to be an improvement. `set` is available for the comparison
 * that motivated it: on ROSE-VEC's adjudicated predictions the multiset reading calls
 * 129 of 216 correct queries wrong where the set reading calls 87, and a criterion that
 * harsh on both arms compresses whatever difference the arms produce.
 *
 * Both readings are computed on every run regardless of the setting, because the SQL is
 * executed once and only the comparison differs. The shadow column therefore answers
 * "would this delta have survived the other criterion" without a second dispatch, which
 * is the only way to compare two criteria on one sample rather than two.
 */
function semanticsFrom(raw: string | undefined): ResultComparison {
  if (raw === undefined || raw === '' || raw === 'multiset') return 'multiset';
  if (raw === 'set') return 'set';
  throw new MicrogliaError('MG_E_CONFIG', `SOTA_SEMANTICS must be 'multiset' or 'set', got '${raw}'`);
}

const SEMANTICS = semanticsFrom(process.env['SOTA_SEMANTICS']);
const SHADOW_SEMANTICS: ResultComparison = SEMANTICS === 'set' ? 'multiset' : 'set';

/**
 * Independent corrections a rule needs before the corroboration arm injects it.
 *
 * Two, because that is the smallest number that can mean "this happened again", and
 * because the store's own activation policy treats a second observation differently
 * from a first.
 */
const CORROBORATION = 2;

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
  /**
   * The evidence BIRD ships with the question, verbatim.
   *
   * Recorded because the question's shape is read from the question *and* its evidence, and the
   * artefact is the only place a past run's shapes can be recomputed from. Without this field a
   * re-analysis silently reads every question against an empty evidence string, so the signal
   * readings it produces are not the run's — the first artefact that carried a pool omitted it, and
   * the gate read back 0.5719 for `empty` where the run itself had computed 0.5653.
   */
  readonly evidence: string;
  readonly goldSql: string;
  readonly predictedSql: string;
  /**
   * What the same question produced with no memory.
   *
   * Stored because the adjudication lane cannot re-ask a question: it re-scores answers
   * that were already given, and a paired comparison needs both halves of the pair. The
   * artefact carried only the boolean for three iterations, which made an independent
   * criterion impossible without a second 2,370-call dispatch.
   */
  readonly baselineSql: string;
  readonly correct: boolean;
  readonly withoutMemoryCorrect: boolean;
  /** The same two verdicts under the other result comparison. */
  readonly shadowCorrect: boolean;
  readonly shadowWithoutMemoryCorrect: boolean;
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
  /**
   * Whether this question's first answer failed, which is what put it in the retry arms.
   *
   * Carried because the retry arms are conditional treatments: their population delta is
   * the effect diluted by the 88% of questions that never reached them, and the honest
   * reading is the one taken on this flag. It is also a post-treatment variable, so it is
   * recorded as a fact and not used as a filter on any other arm.
   */
  readonly retried: boolean;
  /**
   * The sampling facts for this question, or null when no sampling arm ran.
   *
   * `distinct` is how many different results the draws produced and `correct` how many of them were
   * right. Their joint distribution is what separates a generation failure from a selection one.
   */
  readonly draws: { readonly distinct: number; readonly correct: number } | null;
  /**
   * Every candidate this question produced, or null when no sampling arm ran.
   *
   * The artefact carries the pool itself rather than only its summary because the summary is a
   * choice about what to look at. Distinct-answer counts, signal AUCs and the ceiling's
   * decomposition are all functions of this field, and putting the candidates in the file is what
   * lets the next question about them be answered without a dispatch.
   */
  readonly pool: readonly {
    readonly draw: number;
    readonly correct: boolean;
    readonly resultKey: number;
    readonly signature: ExecSignature | null;
  }[] | null;
  /**
   * What the linker offered this question, or null when the arm did not run.
   *
   * The arm's population delta mixes questions it pruned with questions it left alone, and the
   * second group had a byte-identical prompt. Without this field a 7.4pp loss cannot be attributed
   * to pruning rather than to the run.
   */
  readonly schemaTables: { readonly kept: number; readonly total: number; readonly pruned: boolean } | null;
  /** Optional arms, present only when configured. */
  readonly arms: Partial<Record<Exclude<ArmName, 'none' | 'full'>, boolean>>;
  readonly shadowArms: Partial<Record<Exclude<ArmName, 'none' | 'full'>, boolean>>;
  /**
   * The statement each control arm produced. Without it a failed control can only
   * be described ("the oracle moved nothing"), not diagnosed ("the oracle wrote
   * the un-scaled query").
   */
  readonly armSql: Partial<Record<Exclude<ArmName, 'none' | 'full'>, string>>;
  readonly armPackIds: Partial<Record<Exclude<ArmName, 'none' | 'full'>, number>>;
  /**
   * The execution result each arm produced, control included.
   *
   * The union's ceiling is counted from the booleans above, but a ceiling says nothing about whether
   * the pool it was computed over contained more than one answer. This field is what allows the
   * generator pool to be described with the same collapse statistic the sampling pool gets.
   */
  readonly arm_result_digests: Record<string, string | null>;
  readonly armPackChars: Partial<Record<Exclude<ArmName, 'none' | 'full'>, number>>;
  /** The claims the `full` arm injected, as text: the input to the relevance audit. */
  readonly injected: readonly string[];
  /** The same for the repair memory, when the content arm ran. */
  readonly injectedRepair: readonly string[];
  /** The same for the procedural memory, when that arm ran. */
  readonly injectedProcedural: readonly string[];
  /** Characters the `full` arm injected, the 1,200-character end of the dose curve. */
  readonly packChars: number;
};

type Reply = ChatReply;

/**
 * The lane's one model client.
 *
 * It counts HTTP attempts (`calls`, what the budget is spent in) separately from
 * prompts (`prompts`, the denominator of the reliability gate), retries a 429 or a
 * 5xx, refuses a 402 as a configuration failure, and ends the run with
 * `MG_E_PROVIDER_FAILED` after several prompts fail in a row — a per-call retry
 * policy cannot tell noise from an outage, and a benchmark that runs through one
 * measures the outage.
 */
/**
 * Where the model calls go, when a caller points them somewhere else.
 *
 * Unset in every published run, and the host is recorded in the artefact so a reader can
 * tell those runs from a local rehearsal. It exists because every mechanism in this
 * project was supposed to be proved against a stand-in before it was paid for, and the
 * benchmark lane was the one place that could not be: a sequencing defect in the deletion
 * arm reached CI, ran fourteen minutes, and reported a crash where it should have reported
 * a number.
 */
const ENDPOINT = process.env['DEEPSEEK_ENDPOINT'] ?? '';

const DEADLINE_AT = DEADLINE_MIN > 0 ? Date.now() + DEADLINE_MIN * 60_000 : undefined;

const llm = new LlmClient({
  apiKey: process.env['DEEPSEEK_API_KEY'] ?? '',
  model: MODEL,
  maxCalls: MAX_CALLS,
  breakerThreshold: BREAKER_THRESHOLD,
  ...(ENDPOINT === '' ? {} : { endpoint: ENDPOINT }),
  ...(DEADLINE_AT === undefined ? {} : { deadline: DEADLINE_AT }),
});

const chat = (prompt: string, maxTokens = 700, temperature = 0): Promise<ChatReply> =>
  llm.chat(prompt, maxTokens, temperature);


/**
 * Whether a call failure says the run is over rather than that this call was.
 *
 * Three codes and one clock, in one predicate. Before this existed each site that called a model
 * made its own decision about which errors to re-throw, so a stopped run would have had to stop at
 * every one of them: the evaluation loop, the probe, the learning pass, and the distiller each
 * caught failures and turned them into data. The distiller was the worst of the four — a spent
 * budget arriving from inside `host.distill` was counted as "the model said nothing" and the fold
 * went on to publish a store built from part of its corrections.
 */
function stoppedRun(error: unknown): boolean {
  if (!(error instanceof MicrogliaError)) return false;
  return (
    error.code === 'MG_E_BUDGET_EXCEEDED' ||
    error.code === 'MG_E_PROVIDER_FAILED' ||
    error.code === 'MG_E_DEADLINE'
  );
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
 * The search itself lives in `sql-exec.ts`, because three lanes needed it and the second
 * copy of it was already wrong: the adjudication lane looked in four places and missed the
 * one an operator with a directory called `minidev` ends up with, so every pair of queries
 * reported different rows and the evidenced criterion silently became the plain cascade.
 * One implementation, tested, and this function only adds the message.
 */
function databaseIn(directory: string, dbId: string): string {
  const resolved = resolveDatabase(directory, dbId);
  if (existsSync(resolved)) return resolved;
  throw new MicrogliaError('MG_E_STORE_IO', `No database file for '${dbId}' under BIRD_DIR`, {
    looked_in: directory,
    hint: 'Expected dev_databases/<db>/<db>.sqlite (the pinned archive), mini_dev_sqlite/<db>/<db>.sqlite, or a flat <db>.sqlite',
  });
}

/**
 * The pinned manifest for this split.
 *
 * Two files rather than one with a switch inside: each archive has its own URL, size and digest,
 * and a manifest is the record of one verification, not a table of them.
 */
const MANIFEST = join(REPO, 'eval', 'manifests', SPLIT === 'dev' ? 'bird-dev.json' : 'bird-minidev.json');

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
async function prepareArchive(): Promise<string> {
  const manifest = loadManifest();
  const dest = join(CACHE, `${manifest.name}.zip`);
  // The URL comes from the manifest, not from the environment. When it came from the environment,
  // two sources described one download — `BIRD_ARCHIVE_URL` pointed at Mini-Dev while the split
  // selected the dev manifest — and the run failed with "the dataset archive failed its size check".
  // That message blames the data for what is a configuration mismatch, and it is exactly what the
  // first dev dispatch printed. One manifest, one URL, one digest.
  const url = manifest.url;
  mkdirSync(CACHE, { recursive: true });

  if (!existsSync(dest) || statSync(dest).size !== manifest.bytes) {
    process.stdout.write(`[sota] downloading ${url}\n`);
    const response = await fetch(url, { signal: AbortSignal.timeout(600_000) });
    if (!response.ok) {
      throw new MicrogliaError('MG_E_STORE_IO', `The dataset archive answered ${response.status}`, {
        url,
        hint: 'Set BIRD_DIR to an extracted directory for this split instead.',
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
      hint: `Delete .cache/bird/${manifest.name}.zip and re-run; a mirror that differs is not this dataset.`,
    });
  }

  const root = join(CACHE, manifest.name);
  const extracted = join(root, manifest.root);
  if (!existsSync(extracted)) {
    process.stdout.write('[sota] extracting the archive\n');
    execFileSync('unzip', ['-q', '-o', dest, '-d', root], { stdio: 'inherit' });
  }

  // `dev.zip` carries a second archive: `dev_databases.zip` holds the eleven SQLite files while
  // `dev.json` sits beside it. Mini-Dev does not nest. Unpacking one level and stopping leaves
  // hundreds of questions with no databases, which is how the second dev dispatch failed —
  // "No database file for 'california_schools'" — after a successful 346 MB download and a digest
  // that matched. The nesting is a property of the archive, so it is detected rather than listed:
  // a manifest field would have to be maintained for one archive out of two.
  const inner = join(extracted, 'dev_databases.zip');
  if (existsSync(inner) && !existsSync(join(extracted, 'dev_databases'))) {
    process.stdout.write('[sota] extracting the databases inside the archive\n');
    execFileSync('unzip', ['-q', '-o', inner, '-d', extracted], { stdio: 'inherit' });
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
  const manifest = loadManifest();
  mkdirSync(CACHE, { recursive: true });

  // The database root first, because the archive also carries the questions: one
  // artefact, one digest, and the questions cannot disagree with the databases
  // they were written against.
  let dbRoot = explicit;
  if (dbRoot === undefined) {
    dbRoot = await prepareArchive();
  }
  const root: string = dbRoot;

  let rows: BirdRow[];
  let source: string;
  const local = join(root, manifest.questions);
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
        hint: `The pinned archive carries ${manifest.questions}; a directory without it needs a network.`,
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

  // What the split scores; see `poolOf`. The remainder is interleaved across
  // databases, because a prefix of a database-sorted file is a sample of one
  // database.
  const pool = poolOf(rows, SPLIT);
  const ordered = interleaveByKey(pool, (row) => row.db_id);
  const slice = limit > 0 ? ordered.slice(0, limit) : ordered;

  // There is deliberately no third database source: the lane used to fall back to
  // `bird-critic`'s `<db>_template.sqlite` files, which are the schema and not the
  // data. Against an empty database the gold query and the predicted query both
  // return no rows, so `matches` scores a runnable SELECT as correct — a number
  // about parse success wearing the name of execution accuracy.
  const used = new Set(slice.map((row) => row.db_id));
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

/**
 * A few distinct values per column, read once per database.
 *
 * Cached for the same reason the DDL is: eleven databases, thirty-odd questions each, and a sample
 * that cannot change during a run. Three values per column because the question is "what shape is
 * this column's data", and a table with more than sixteen annotated columns would replace the schema
 * with a list of literals.
 *
 * `distinct` is the right verb: the first three rows of a sorted table are three copies of one value
 * as often as not, and a sample that shows the same string three times teaches nothing about the
 * domain the column covers.
 */
const valuesCache = new Map<
  string,
  { readonly ddl: string; readonly stats: { tables: number; columns: number; annotated: number } }
>();

const quoteIdentifier = (name: string): string => `"${name.replaceAll('"', '""')}"`;

function valuesDdl(dbPath: string): { ddl: string; stats: { tables: number; columns: number; annotated: number } } {
  const cached = valuesCache.get(dbPath);
  if (cached !== undefined) return cached;
  const stats = { tables: 0, columns: 0, annotated: 0 };
  const samples = new Map<string, readonly ValueSample[]>();
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const tables = db
      .prepare("select name from sqlite_master where type='table' and name not like 'sqlite_%'")
      .all() as { name: string }[];
    for (const { name } of tables) {
      const columns = db.prepare(`pragma table_info(${quoteIdentifier(name)})`).all() as {
        name: string;
      }[];
      const tableSamples: ValueSample[] = [];
      for (const column of columns) {
        stats.columns += 1;
        const identifier = quoteIdentifier(column.name);
        let values: unknown[] = [];
        try {
          const rows = db
            .prepare(
              `select distinct ${identifier} as v from ${quoteIdentifier(name)} ` +
                `where ${identifier} is not null limit 3`,
            )
            .all() as { v: unknown }[];
          values = rows.map((row) => row.v);
        } catch {
          // A column whose type cannot be compared (a blob, for instance) is skipped rather than
          // failing the run: the arm is an annotation, not a migration.
          values = [];
        }
        if (values.length === 0) continue;
        stats.annotated += 1;
        tableSamples.push({ column: column.name, values: values.map(renderValue) });
      }
      stats.tables += 1;
      samples.set(name, tableSamples);
    }
  } finally {
    db.close();
  }
  const entry = {
    ddl: schemaWithValues(schemaSql(dbPath), (table) => samples.get(table) ?? []),
    stats,
  };
  valuesCache.set(dbPath, entry);
  return entry;
}

/**
 * The schema as a semi-structured block, cached per database.
 *
 * Cached for the same reason the DDL is: a fold asks for the same eleven databases 350 times, and
 * rebuilding an introspection per question would spend the run's time on reading table layouts.
 *
 * The sample count is three, matching the value arm, so the two arms differ in *placement* rather
 * than in how much of the data they show: `values` puts the samples in a comment above the DDL,
 * `m-schema` puts them inside the column's own parenthesis. XiYan's ablation changes the
 * representation, and this project's own two placement measurements (+0.29 and −2.86) say the
 * position is the part that moves the number.
 */
const mschemaCache = new Map<string, { readonly ddl: string; readonly stats: { tables: number; columns: number } }>();

function mschemaDdl(
  dbPath: string,
  dbId: string,
): { ddl: string; stats: { tables: number; columns: number } } {
  const cached = mschemaCache.get(dbPath);
  if (cached !== undefined) return cached;
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const tables = collectMschema(db, { samples: 3 });
    const entry = {
      ddl: renderMschema(dbId, tables),
      stats: {
        tables: tables.length,
        columns: tables.reduce((sum, table) => sum + table.columns.length, 0),
      },
    };
    mschemaCache.set(dbPath, entry);
    return entry;
  } finally {
    db.close();
  }
}

/** Execute a statement and canonicalise its result set. */
function execute(dbPath: string, sql: string): { ok: boolean; rows: string[] } {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const rows = db.prepare(sql).all() as Record<string, unknown>[];
    return { ok: true, rows: canonicalRows(rows) };
  } catch {
    return { ok: false, rows: [] };
  } finally {
    db.close();
  }
}

/**
 * The gold query's result, executed once per question.
 *
 * The comparison needs it for every arm of that question, and the previous
 * version executed it twice *inside a single comparison* — three full scans of a
 * million-row table to score one question.
 */
const goldCache = new Map<string, { readonly ok: boolean; readonly rows: string[] }>();

function goldFor(row: BirdRow, dbPath: string): { readonly ok: boolean; readonly rows: string[] } {
  const key = idOfRow(row);
  const cached = goldCache.get(key);
  if (cached !== undefined) return cached;
  const result = execute(dbPath, row.SQL);
  goldCache.set(key, result);
  return result;
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

type Judged = {
  readonly sql: string;
  /**
   * The execution result as a digest, or null when nothing ran.
   *
   * Two arms that execute to the same rows produced the same answer, whatever their statements look
   * like. This is the field that lets the generator pool be described instead of counted: three
   * procedures that all write a different-looking query executing to one result are a pool of one.
   *
   * A **digest**, because the key itself can be enormous: one `card_games` question returns 12 MB of
   * rows, and the dev run that stored the keys whole wrote a 38 MB evidence file of which 37.9 MB was
   * that single field. Equality is the only question anything here asks of the field, so a 128-bit
   * prefix of its SHA-256 answers the same question at a fixed size.
   */
  readonly resultDigest: string | null;
  /** The configured reading, which is what every published number is scored by. */
  readonly correct: boolean;
  /** The other reading of the same execution, scored in the same run. */
  readonly shadowCorrect: boolean;
  readonly parseOk: boolean;
  readonly execOk: boolean;
  readonly tokens: number;
  /** Local scoring time; the model's own latency is measured by the caller. */
  readonly latencyMs: number;
};

/**
 * Turn one reply into a scored outcome. No model call, no write.
 *
 * `reply` is undefined when the call failed after its retries: that is not a
 * parse failure, and it is counted separately — a run in which one prompt in five
 * never got an answer cannot be read as a statement about knowledge.
 */
/**
 * One query's result as shape: did it run, how many rows, which columns.
 *
 * The columns come from the driver rather than from the projected text, so an alias the
 * correction introduced and an alias the attempt invented are distinguishable, and a note
 * that says "it returned [name] where the corrected query returns [forename, surname]"
 * points at the change rather than at the rows.
 */
function resultShapeOf(dbPath: string, sql: string | undefined): ResultShape {
  if (sql === undefined) {
    return { ok: false, error: 'the reply contained no query', rows: 0, columns: [] };
  }
  const outcome = executeQuery(dbPath, sql);
  return {
    ok: outcome.ok,
    ...(outcome.error === undefined ? {} : { error: outcome.error }),
    rows: outcome.tuples.length,
    columns: outcome.columns,
  };
}

/**
 * What a deployment can see about a first answer without the answer key.
 *
 * The two conditions every retry arm triggers on, and nothing else: a query that does not
 * run, or one that runs and returns no rows. Both are decidable from the database alone, so
 * the retry population is a property of the pipeline rather than of the benchmark.
 */
function failureOf(dbPath: string, sql: string | undefined): string | undefined {
  if (sql === undefined) return 'it did not contain a query';
  const outcome = executeQuery(dbPath, sql);
  if (!outcome.ok) return `it failed with: ${outcome.error ?? 'an error'}`;
  return outcome.tuples.length === 0 ? 'it returned no rows' : undefined;
}

function judgeReply(
  row: BirdRow,
  dbPath: string,
  reply: { readonly text: string; readonly tokens?: number } | undefined,
  task: Task,
): Judged {
  const extracted = reply === undefined ? undefined : extractSql(reply.text);
  const sql = extracted ?? '';
  const parseOk = extracted !== undefined;
  const predicted = sql === '' ? { ok: false, rows: [] } : execute(dbPath, sql);
  let correct = false;
  let shadowCorrect = false;
  if (task.convention) {
    // A scalar convention has one answer at one precision, so the two readings cannot
    // disagree and the shadow is not a second opinion but the same one.
    correct = judgeScalar(scalarOf(dbPath, sql), task.expected.get(idOfRow(row)));
    shadowCorrect = correct;
  } else if (predicted.ok) {
    const gold = goldFor(row, dbPath);
    correct = gold.ok && matches(predicted.rows, gold.rows, SEMANTICS);
    shadowCorrect = gold.ok && matches(predicted.rows, gold.rows, SHADOW_SEMANTICS);
  }
  return {
    sql,
    // `canonicalRows` already sorts the rows and orders the columns, so joining them is an identity
    // over the multiset: the same answer reached by two statements has one key. A failed execution
    // has no key at all, deliberately — a statement that did not run is not an answer, and counting
    // its absence as one would let a pool of one answer and three errors look like a pool of four.
    resultDigest: predicted.ok ? digestOf(predicted.rows.join('\u0001')) : null,
    correct,
    shadowCorrect,
    parseOk,
    execOk: predicted.ok,
    tokens: reply?.tokens ?? 0,
    latencyMs: 0,
  };
}

function idOfRow(row: BirdRow): string {
  return `${row.db_id}#${row.question_id}`;
}

/**
 * A fixed-width identity for one execution result.
 *
 * Every comparison in the union and in the arm-pair analysis is equality, so 128 bits of SHA-256
 * answers the question a 12 MB string answered — and costs 40 bytes to store instead of 12 MB. The
 * width is set by the number of results a run holds (thousands), where a 128-bit collision is not a
 * risk worth a byte.
 */
function digestOf(rows: string): string {
  return createHash('sha256').update(rows).digest('hex').slice(0, 32);
}

/**
 * The memory prior's arm, applied after every fold has been measured.
 *
 * This is the only selector in the lane that cannot run inside the fold it scores. Every other one
 * reads the draws of the question in front of it; this one reads what happened to questions *like*
 * it in the other folds, and those outcomes do not exist until the run is nearly over.
 *
 * A question with no pool is left without the arm rather than scored as a failure, which is how
 * every other arm treats a question it never saw — an absent outcome and a wrong answer are different
 * facts, and only one of them is a measurement of the selector.
 */
function withPriorPicks(
  cases: readonly CaseOutcome[],
  arm: Exclude<ArmName, 'none' | 'full'>,
  scope: PriorScope,
): readonly CaseOutcome[] {
  const picks = priorPicks(
    cases.map((item) => ({
      id: item.id,
      dbId: item.dbId,
      fold: item.fold,
      candidates: (item.pool ?? []).map((candidate) => ({
        draw: candidate.draw,
        correct: candidate.correct,
        signature: candidate.signature,
      })),
    })),
    scope,
  );
  const out: CaseOutcome[] = [];
  for (const [at, item] of cases.entries()) {
    const pick = picks[at];
    const chosen = pick === undefined || pick.chosen < 0 ? 0 : pick.chosen;
    const verdict = (item.pool ?? [])[chosen];
    if (verdict === undefined) {
      out.push(item);
      continue;
    }
    const arms: CaseOutcome['arms'] = { ...item.arms, [arm]: verdict.correct };
    out.push({ ...item, arms });
  }
  return out;
}

type LearningPass = {
  readonly rows: number;
  readonly edited: number;
  readonly goldFailed: number;
  /**
   * The corrections themselves, verbatim, in corpus order.
   *
   * R22's substrate. Everything the store holds is an interpretation of one of these, and the raw arm
   * injects the event instead of the interpretation. Kept here rather than read back out of the store
   * because the store is exactly what discards it: the distiller's output is a sentence about the
   * workspace, and the two queries that produced it are not part of the item.
   *
   * An eval question never appears here — the pass reads the fold's learn rows — so the raw arm cannot
   * leak the answer to the question it is scoring, and neither can its shuffled control.
   */
  readonly events: readonly RawEvent[];
  /**
   * Questions whose first attempt never arrived.
   *
   * A correction is learned from two attempts; a question that produced no attempt contributes no
   * correction and no evidence, and a fold measured on a store built from sixty of its sixty-four
   * questions is a different treatment from one built from all of them. Until this count existed the
   * difference was invisible: an unanswered generation was cached as an empty string and looked
   * exactly like a model that had answered with nothing.
   */
  readonly unanswered: number;
};

/** Generated text per question id, spread across folds. */
const generations = new GenerationCache();

/**
 * The learning pass: generate, compare against the gold result, correct on a
 * mismatch.
 *
 * A generation that does not execute is a correction worth learning from, and the
 * comparison is result-based rather than text-based: a query that returns the
 * wrong rows is wrong even when it runs. The earlier version compared only result
 * sets and therefore treated a failed generation as correct whenever the gold
 * query happened to return no rows — the exact cases most worth learning from.
 *
 * Two phases, and the split is what makes the pass parallel without making the
 * memory order-dependent:
 *
 *  1. **Generate** every question's first attempt concurrently. Prompts depend only
 *     on the question, its evidence and the schema, so this phase touches no
 *     memory and its answers cannot depend on which call finished first.
 *  2. **Record** the runs serially, in corpus order. `begin`/`complete`/`edit`
 *     advance a stepping clock, and the distilled pack's ids are derived from it;
 *     recording out of order would still be deterministic in isolation but would
 *     differ from the serial lane for no reason.
 *
 * A failed generation is cached as a failure: the same prompt in a later fold is
 * not an independent event, and paying four times to learn that the endpoint
 * dropped one prompt would spend the budget without adding evidence.
 */
async function learn(
  host: Awaited<ReturnType<typeof openMicroglia>>,
  rows: readonly BirdRow[],
  dataset: Dataset,
  task: Task,
): Promise<LearningPass> {
  let unanswered = 0;
  let asked = 0;
  const texts = await mapPool(rows, CONCURRENCY, async (row) => {
    const key = idOfRow(row);
    const cached = generations.get(key);
    if (cached !== undefined) {
      generations.count(true);
      asked += 1;
      return cached;
    }
    generations.count(false);
    try {
      const reply = await chat(
        promptFor({
          question: row.question,
          evidence: row.evidence,
          ddl: schemaSql(dataset.dbPath(row.db_id)),
          pack: '',
          stated: false,
          convention: ACTIVE,
        }),
      );
      generations.set(key, reply.text);
      return reply.text;
    } catch (error) {
      // A spent budget, a provider that has stopped answering, an elapsed deadline: each ends the
      // run rather than becoming data. A single unanswered prompt is data, and is counted.
      if (stoppedRun(error)) throw error;
      unanswered += 1;
      generations.set(key, '');
      return '';
    } finally {
      asked += 1;
      // The learning half is the quiet one: the evaluation loop has printed every twenty calls
      // since a ten-hour run went unnoticed, and this pass — which is where the dev split spent its
      // hours — printed nothing at all until the fold was over.
      if (asked % 16 === 0 || asked === rows.length) {
        process.stdout.write(
          `[sota] learn ${asked}/${rows.length} calls=${llm.stats.calls} ` +
            `unanswered=${unanswered} retries=${llm.stats.retries} timeouts=${llm.stats.timeouts}\n`,
        );
      }
    }
  });

  let edited = 0;
  let goldFailed = 0;
  const events: RawEvent[] = [];
  for (const [index, row] of rows.entries()) {
    const dbPath = dataset.dbPath(row.db_id);
    // Kept un-defaulted: "the reply contained no query" and "the query returned nothing"
    // are different failures, and a repair note that conflates them teaches nothing.
    const attempted = extractSql(texts[index] ?? '');
    const sql = attempted ?? '';
    const handle = host.begin({
      task: TASK,
      // The question is the task. Without this the host opens a run per attempt, and the
      // evidence refs it writes carry no task — which contradicts the contract in
      // `EvidenceRef` ("support is counted per task, not per event: eight attempts of one
      // task are one observation by one user") and makes a rule impossible to attribute to
      // the question it was learned from. Attribution is what the validation pass needs to
      // stop crediting a rule for the question that produced it.
      taskId: idOfRow(row),
      input: { question: row.question, domain: row.db_id, schemaDigest: row.db_id },
      model: MODEL,
      promptVersion: PROMPT_VERSION,
      domainPack: 'bird',
    });
    await handle.complete({ sql });
    // The correction is what a user would type, not what the benchmark happens to
    // hold: under the convention that is the same query reported in thousands.
    const target = reportedSql(row.SQL, ACTIVE);
    const expected = task.expected.get(idOfRow(row));
    if (task.convention && expected === undefined) {
      goldFailed += 1;
      continue;
    }
    const satisfied = judgeReply(row, dbPath, { text: texts[index] ?? '', tokens: 0 }, task).correct;
    if (!satisfied) {
      // The event, before any interpretation: what was asked, what came back, what fixed it. `sql` is
      // the statement as extracted (possibly empty, which the renderer omits rather than blanks) and
      // `target` is the correction as a user would type it, which is what the distiller was shown.
      events.push({ taskId: idOfRow(row), question: row.question, attempt: sql, fixed: target });
      // The note is what was observed, not what we concluded. The rule form ignores it —
      // it states a fact about the workspace — and the repair form is built on it, because
      // "why the attempt was wrong" cannot be learned from two queries alone: a join that
      // multiplies rows and a join on the wrong key look the same in the SQL.
      const note = mismatchNote(resultShapeOf(dbPath, attempted), resultShapeOf(dbPath, target));
      await handle.edit({ sql: target }, { note });
      edited += 1;
    }
  }
  return { rows: rows.length, edited, goldFailed, unanswered, events };
}

/** A stable digest of what is stored, used to prove the pack was frozen. */
async function knowledgeDigest(
  store: EmbeddedMemory,
): Promise<{ active: number; total: number; digest: string }> {
  const items = await store.listKnowledge({ namespace: 'bird', status: 'all' });
  const active = items.filter((item) => item.status === 'active');
  const canonical = [...items]
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    // The condition is part of what is frozen: two runs that differ only in `when`
    // are two different memories, and a digest that ignored the field would call
    // them the same and make the freeze proof silent about the experiment.
    .map((item) => [item.id, item.status, item.trust, item.statement, item.when ?? ''].join('\u0000'))
    .join('\u0001');
  return {
    active: active.length,
    total: items.length,
    digest: createHash('sha256').update(canonical).digest('hex').slice(0, 16),
  };
}

/** A repair-store item, with the account it carries in `payload`. */
type RepairItem = {
  readonly id: string;
  readonly status: string;
  readonly statement: string;
  readonly when: string | null;
  readonly payload: unknown;
};

type StoredItem = {
  readonly id: string;
  readonly status: string;
  readonly trust: number;
  readonly statement: string;
  /** The condition the rule applies under, or null when it named none. */
  readonly when: string | null;
  /** Independent observations behind the rule; the corroboration metric's input. */
  readonly evidence: number;
  /** The database the rule is scoped to, or null when it generalised out of one. */
  readonly domain: string | null;
};

/**
 * Foreign cases each admitted rule is shown, when transfer is measured.
 *
 * Four, because the rate is estimated across trials rather than per rule: 294 admitted rules × 4 is
 * 1,176 trials, which resolves a rate near 2% and cannot resolve one near 0.2%. Set to zero to skip
 * the measurement; the arm then reports an empty pack rather than a rate nobody computed.
 */
const TRANSFER_TARGETS = nonNegative(process.env['SOTA_TRANSFER_TARGETS'], 4);

/**
 * The density family's panel, or zero when the stage is off.
 *
 * R9 exists because every memory arm measured so far gave each rule about a quarter of a decisive
 * observation, and no filter can rank rules on a quarter of an observation each. This stage holds
 * the rule set and the questions fixed, shows one rule at a time, and gives every rule `panel`
 * questions from its own database — twenty, which is the number the roadmap fixed before the stage
 * opened. Zero keeps the stage off, because it costs a call per rule per question.
 */
const DENSITY_PANEL = nonNegative(process.env['SOTA_DENSITY_PANEL'], 0);
/**
 * Foreign targets per rule: how many questions from *other* databases every exercised rule is put
 * on. R9.4 fixed it at ten before the dispatch, in the same order of magnitude as the four foreign
 * cases R6 used per rule.
 */
const TRANSFER_PANEL = nonNegative(process.env['SOTA_TRANSFER_PANEL'], 10);

/**
 * R10's switch: how a foreign rule is shown.
 *
 * `prose` is the incumbent form and what every arm before this one measured. `bound` reads the rule
 * as a template against the schema it was learned in, binds its slots against the schema it is about
 * to be shown in, and withholds it when a slot has no referent — which is the construction ODIS and
 * SQL-Exchange both point at, and the one R9.4's null result motivates. The two forms differ in one
 * field of one rendered line, so the foreign reading compares like with like.
 */
const INJECTION_FORM = injectionFormOf(process.env['SOTA_TEMPLATE']);

/**
 * Rules taken from each database, capped so the family stays affordable.
 *
 * Eight per database rather than the store's whole population: a full pass over a five-fold store's
 * rules would be some six thousand calls, and the discriminating share it estimates is a proportion
 * that eighty rules already resolve to about five points. The selection itself is by content hash,
 * so the subset is a sample of the store rather than the rules that look best.
 */
const DENSITY_RULES_PER_DB = nonNegative(process.env['SOTA_DENSITY_RULES_PER_DB'], 8);

/**
 * The character budget the probe renders its rules with, matching the host's default.
 *
 * A single rule can be long, and a probe that truncated the rule it was testing would report a
 * failure of the renderer as a failure of the extraction.
 */
const PROBE_BUDGET = 1200;

/** What one fold's rule probe found. */
type ProbeRun = {
  readonly trials: readonly ProbeTrial[];
  readonly summary: ProbeSummary;
  readonly admission: Admission;
  /**
   * How much of the store knows which database it was learned in.
   *
   * `scope.domain` is what lets a rule be pointed at a foreign question, and it is the one field the
   * host knows and the model only echoes: an item without one is invisible to transfer, so the share
   * without a domain is the ceiling on every transfer number computed from this store. Reported
   * rather than repaired here, because filling the field would change which rules `full` injects and
   * make every earlier reading incomparable.
   */
  readonly domain: { readonly withDomain: number; readonly withoutDomain: number };
  /** Source questions the probe never reached, by reason, because a hole is not a verdict. */
  readonly skipped: Readonly<Record<string, number>>;
  /** How the corrected cases failed, which is the population the probe can speak about. */
  readonly failureKinds: Readonly<Record<string, number>>;
  /**
   * Verdicts against failure kinds, because `useless` is ambiguous without it.
   *
   * A rule distilled from a case whose only symptom is "the person who asked rejected the answer"
   * had nothing mechanical to work from, and 85% of this corpus's corrections are that case. A
   * `useless` share concentrated there says the extraction needs a symptom, not a better distiller;
   * the same share spread evenly says the distiller is the problem. One table separates them.
   */
  readonly byKind: Readonly<Record<string, Readonly<Record<string, number>>>>;
  readonly rules: number;
  /** What the rules that survive the gate can do to other questions, or null when not measured. */
  readonly transfer:
    | {
        readonly summary: TransferSummary;
        readonly rules: readonly string[];
        readonly skipped: Readonly<Record<string, number>>;
        /**
         * Every trial, kept so a later reading does not have to buy the run again.
         *
         * The summary is a fold-level aggregate; the question a reviewer asks next ("did any rule
         * repair more than one target", "is the repair concentrated in one database") is a question
         * about the ledger, and a dispatch that kept only the aggregate would answer it by
         * re-measuring.
         */
        readonly trials: readonly TransferTrial[];
      }
    | null;
};

/**
 * Ask the store to reproduce the corrections it was built from.
 *
 * A distilled rule is a claim that one correction generalises, and the first thing such a claim
 * must survive is its own case: given the failure, the attempt that failed and the rules derived
 * from it, does the correction come back? Two calls per corrected question — with the rules and
 * without — because a second attempt already repairs some failures by itself, and crediting that
 * to the rules is the error this project has spent ten iterations avoiding.
 *
 * Reads `learn` rows only. The verdicts are then used to filter the store that answers the held-out
 * questions, so a probe that read those questions would be leakage with a tidier name.
 *
 * A question whose first attempt ran and returned rows was still corrected, and the retry prompt
 * has no observable failure to state. The probe says what a correction loop actually knows at that
 * point — that the person who asked rejected the answer — rather than inventing a database
 * symptom; the four kinds are counted apart so a `rejected` share that dominates the population is
 * visible instead of assumed away.
 */
async function probeMemory(
  store: EmbeddedMemory,
  learnRows: readonly BirdRow[],
  dataset: Dataset,
  task: Task,
  transferTargetsPerRule: number,
  /**
   * Control verdicts already measured for these source questions, and where to leave the ones this
   * probe pays for.
   *
   * The blank prompt is built from the question, the attempt and the observed failure — none of
   * which depend on the store — so the same source question has the same control under every
   * substrate. Sharing it makes the two probes differ in exactly one thing and saves a call per
   * case. Re-asking would also re-sample the endpoint: 16.4% of questions return a different query
   * under the same prompt, so two controls for one case would put that noise inside the comparison
   * the pairing exists to remove.
   */
  sharedBlanks?: Map<string, boolean | undefined>,
): Promise<ProbeRun> {
  const items = await store.listKnowledge({ namespace: 'bird', status: 'active' });
  const domain = {
    withDomain: items.filter((item) => item.scope.domain !== undefined).length,
    withoutDomain: items.filter((item) => item.scope.domain === undefined).length,
  };
  const itemById = new Map(items.map((item) => [item.id, item]));
  const rowById = new Map(learnRows.map((row) => [idOfRow(row), row]));
  const byTask = new Map<string, string[]>();
  for (const item of items) {
    const seen = new Set<string>();
    for (const ref of item.evidence) {
      const taskId = ref.taskId;
      if (taskId === undefined || seen.has(taskId)) continue;
      seen.add(taskId);
      const ids = byTask.get(taskId);
      if (ids === undefined) byTask.set(taskId, [item.id]);
      else ids.push(item.id);
    }
  }

  const skipped: Record<string, number> = {};
  const failureKinds: Record<string, number> = {};
  /** What each corrected case needs to be re-asked, kept so transfer can reuse it. */
  const detailById = new Map<
    string,
    { readonly row: BirdRow; readonly attempt: string; readonly failure: string; readonly ddl: string; readonly kind: string }
  >();
  const plans: {
    taskId: string;
    row: BirdRow;
    itemIds: readonly string[];
    blank: string;
    withRules: string;
  }[] = [];
  const bump = (sink: Record<string, number>, key: string): void => {
    sink[key] = (sink[key] ?? 0) + 1;
  };
  for (const [taskId, itemIds] of byTask) {
    const row = rowById.get(taskId);
    if (row === undefined) {
      bump(skipped, 'no-source-row');
      continue;
    }
    const attempt = generations.get(taskId) ?? '';
    const sql = extractSql(attempt);
    const outcome = sql === undefined ? undefined : executeQuery(dataset.dbPath(row.db_id), sql);
    let failure: string;
    let kind: string;
    if (outcome === undefined) {
      failure = 'it did not contain a query';
      kind = 'no-query';
    } else if (!outcome.ok) {
      failure = `it failed with: ${outcome.error ?? 'an error'}`;
      kind = 'error';
    } else if (outcome.tuples.length === 0) {
      failure = 'it returned no rows';
      kind = 'empty';
    } else {
      failure = 'it ran, but the person who asked rejected the answer';
      kind = 'rejected';
    }
    bump(failureKinds, kind);
    const carried = itemIds
      .map((id) => itemById.get(id))
      .filter((item): item is NonNullable<typeof item> => item !== undefined);
    if (carried.length === 0) {
      bump(skipped, 'no-items');
      continue;
    }
    const ddl = schemaSql(dataset.dbPath(row.db_id));
    detailById.set(taskId, { row, attempt, failure, ddl, kind });
    const base = { question: row.question, evidence: row.evidence, ddl, attempt, failure };
    plans.push({
      taskId,
      row,
      itemIds,
      blank: retryPromptFor({ ...base, pack: '' }),
      withRules: retryPromptFor({ ...base, pack: makePack(carried, { budget: PROBE_BUDGET }).rendered }),
    });
  }

  // One call that never returns is a hole in the measurement, not a verdict about the rules, so
  // both halves of a pair resolve to `undefined` rather than to `false`.
  const asked = async (row: BirdRow, prompt: string): Promise<boolean | undefined> => {
    try {
      const reply = await chat(prompt);
      return judgeReply(row, dataset.dbPath(row.db_id), reply, task).correct;
    } catch (error) {
      if (stoppedRun(error)) throw error;
      return undefined;
    }
  };
  let completed = 0;
  /** A target's blank is a property of the target, so it is measured once and reused by transfer. */
  const blankByTask = new Map<string, boolean | undefined>();
  // Two calls per plan in flight at once, so the pool is halved: the endpoint's rate limit is a
  // property of the run, and a probe that doubled the in-flight count would buy its measurement
  // with retries that belong to nobody's budget.
  const trials = await mapPool(plans, Math.max(1, Math.ceil(CONCURRENCY / 2)), async (plan) => {
    const [blankCorrect, withRulesCorrect] = await Promise.all([
      // A hole is carried as a hole. Re-asking a call that never returned would replace an absent
      // measurement with a different one, and the two substrates would then be compared on controls
      // that are not the same control.
      sharedBlanks?.has(plan.taskId) === true
        ? Promise.resolve(sharedBlanks.get(plan.taskId))
        : asked(plan.row, plan.blank),
      asked(plan.row, plan.withRules),
    ]);
    blankByTask.set(plan.taskId, blankCorrect);
    // Left for the next substrate rather than kept in this run only: the second store is the reason
    // the control is shared, and it reads from here.
    sharedBlanks?.set(plan.taskId, blankCorrect);
    completed += 1;
    if (completed % 20 === 0 || completed === plans.length) {
      process.stdout.write(
        `[sota] probe ${completed}/${plans.length} rules=${items.length} calls=${llm.stats.calls}\n`,
      );
    }
    return {
      taskId: plan.taskId,
      itemIds: plan.itemIds,
      verdict: verdictOf(blankCorrect, withRulesCorrect),
    };
  });

  const admission = admissionOf(items, trials);
  /** Verdicts beside failure kinds, so a `useless` share that is all `rejected` is visible. */
  const byKind: Record<string, Record<string, number>> = {};
  for (const trial of trials) {
    const kind = detailById.get(trial.taskId)?.kind ?? 'unknown';
    const row = byKind[kind] ?? (byKind[kind] = {});
    const key = trial.verdict ?? 'unmeasured';
    row[key] = (row[key] ?? 0) + 1;
  }

  // Transfer: point every admitted rule at foreign cases from the same database. The question is
  // not whether the rule is in the store — the own-case probe settled that — but whether it is
  // knowledge, which is what a repair of a *different* question would show.
  let transfer: ProbeRun['transfer'] = null;
  if (transferTargetsPerRule > 0) {
    const admitted = new Set(admission.kept);
    const kept = items.filter((item) => admitted.has(item.id));
    const skippedTransfer: Record<string, number> = {};
    const candidates = [...detailById.keys()];
    const transferPlans: {
      itemId: string;
      targetId: string;
      row: BirdRow;
      prompt: string;
    }[] = [];
    for (const [at, item] of kept.entries()) {
      const domain = item.scope.domain;
      // A rule that generalised out of its database has no workspace to transfer into, and asking
      // it about another database would measure something the store never claimed.
      if (domain === undefined) {
        bump(skippedTransfer, 'no-domain');
        continue;
      }
      const own = new Set(
        item.evidence.map((ref) => ref.taskId).filter((id): id is string => id !== undefined),
      );
      const pool = candidates.filter(
        (taskId) => !own.has(taskId) && detailById.get(taskId)?.row.db_id === domain,
      );
      if (pool.length === 0) {
        bump(skippedTransfer, 'no-target');
        continue;
      }
      const drawn = transferTargets(pool, '', transferTargetsPerRule, mulberry32(SEED + at));
      const pack = makePack([item], { budget: PROBE_BUDGET }).rendered;
      for (const targetId of drawn) {
        const detail = detailById.get(targetId) as NonNullable<ReturnType<typeof detailById.get>>;
        transferPlans.push({
          itemId: item.id,
          targetId,
          row: detail.row,
          prompt: retryPromptFor({
            question: detail.row.question,
            evidence: detail.row.evidence,
            ddl: detail.ddl,
            attempt: detail.attempt,
            failure: detail.failure,
            pack,
          }),
        });
      }
    }
    let moved = 0;
    const transferTrials = await mapPool(transferPlans, CONCURRENCY, async (plan) => {
      moved += 1;
      if (moved % 50 === 0 || moved === transferPlans.length) {
        process.stdout.write(
          `[sota] transfer ${moved}/${transferPlans.length} rules=${kept.length} calls=${llm.stats.calls}\n`,
        );
      }
      return {
        itemId: plan.itemId,
        targetId: plan.targetId,
        // Carried through as measured, holes included: a control that never returned is not a
        // target the retry failed, and the summary is where that distinction has to survive.
        blankCorrect: blankByTask.get(plan.targetId),
        withRuleCorrect: await asked(plan.row, plan.prompt),
      };
    });
    transfer = {
      summary: transferSummary(transferTrials),
      rules: transferringItemIds(transferTrials),
      skipped: skippedTransfer,
      trials: transferTrials,
    };
  }

  return {
    trials,
    summary: probeSummary(trials),
    admission,
    domain,
    skipped,
    failureKinds,
    byKind,
    rules: items.length,
    transfer,
  };
}

/** What one density run measured, and which databases could not be part of it. */
type DensityRun = {
  readonly report: DensityReport;
  /** Databases whose usable questions were fewer than the panel, with the count they had. */
  readonly excluded: Readonly<Record<string, number>>;
  readonly rules: number;
  /** Rules that named a database the panel could not cover, so they were never shown. */
  readonly unplaced: number;
  readonly calls: number;
  /** Injections whose call never returned: holes, not verdicts, and kept out of the ledger. */
  readonly unmeasured: number;
  /**
   * The ledger itself, carried out of the run.
   *
   * The reading already computes the cross-fit at the splits it was given, but the question R9.3
   * asks — how much of a rule's apparent sign survives being fitted out of fold — is a question
   * about splits, and a split chosen after seeing the answer is not a measurement. Carrying the
   * trials makes every later reading free: a different fold count, or a leave-one-out reading, is
   * recomputed from the artefact instead of re-bought.
   */
  readonly trials: readonly DensityTrial[];
  readonly floorTrials: readonly DensityTrial[];
  /** The foreign arm's ledger, empty when the run bought no cross-database panel. */
  readonly crossTrials: readonly DensityTrial[];
};

/**
 * The density family: one rule at a time, twenty questions from its own database.
 *
 * Every arm this project has run injects a *pack*, and the attribution instrument then credits each
 * flip to every rule that shared the prompt — which makes the ledger an upper bound on the number of
 * distinct causes rather than a decomposition of the effect. This pass removes that ambiguity by
 * construction: one rule in the prompt, so a flip has exactly one candidate cause, and the ledger's
 * `rulesPerInjection` is one by design rather than by luck.
 *
 * The control is the `none` arm's answer to the same question, already measured and cached by the
 * learning pass — the same prompt with an empty pack, at the same temperature. Nothing is re-asked
 * to obtain it, and because the generator is deterministic at temperature 0, a flip can only have
 * been caused by the rule. That is what makes "inert" a measurement here instead of a residue.
 *
 * The floor is a second, cheaper question: one rule from a different database, shown on the same
 * panel. Its vocabulary is absent from the workspace, so if it flips answers as often as the real
 * rules do, the flips are about the *presence* of text in that block rather than its content — and
 * every attribution in this project's record would have to be reread.
 *
 * Panels are shared. A database whose usable questions come to fewer than the panel is named in
 * `excluded` and left out rather than shortened: the family's claim is that every rule got the same
 * number of chances, and a rule given sixteen is not a rule given twenty.
 */
async function densityPass(input: {
  readonly items: readonly KnowledgeItem[];
  readonly cases: readonly CaseOutcome[];
  readonly dataset: Dataset;
  readonly task: Task;
}): Promise<DensityRun> {
  const panels = targetPanels(
    input.cases.map((entry) => ({
      id: entry.id,
      dbId: entry.dbId,
      question: entry.question,
      evidence: entry.evidence,
      goldSql: entry.goldSql,
      baselineCorrect: entry.withoutMemoryCorrect,
    })),
    DENSITY_PANEL,
    SEED,
  );

  const excluded: Record<string, number> = {};
  const panelDbs: string[] = [];
  for (const [dbId, panel] of panels) {
    if (panel.length < DENSITY_PANEL) excluded[dbId] = panel.length;
    else panelDbs.push(dbId);
  }
  panelDbs.sort();

  // The rule set is chosen from the databases that have a panel, not from the store: the first
  // dispatch selected before it knew which panels existed, so eight rules from the one database the
  // corpus cannot fill were carried into the family and never shown, and V18 failed the run on
  // bookkeeping rather than on a measurement. A rule that cannot be exercised is not part of a
  // family whose claim is the number of chances, and the count of what was left out travels with
  // the report so the exclusion is visible instead of silent.
  const covered = new Set(panelDbs);
  const rules = selectDensityRules(
    input.items.map((item) => ({
      id: item.id,
      status: item.status,
      statement: item.statement,
      when: item.when ?? null,
      domain: item.scope.domain ?? null,
    })),
    DENSITY_RULES_PER_DB,
    covered,
  );
  const itemById = new Map(input.items.map((item) => [item.id, item]));

  /**
   * Schema names by database, read once per database rather than once per injection.
   *
   * `schemaIndex` caches by path already; this map exists so the foreign arm can ask for the names
   * of a database it is only passing through — a rule's own database is not necessarily one the
   * panels cover, and a binding needs both schemas to be read the same way.
   */
  const namesByDb = new Map<string, SchemaNames>();
  const namesOf = (dbId: string): SchemaNames => {
    const hit = namesByDb.get(dbId);
    if (hit !== undefined) return hit;
    const index = schemaIndex(input.dataset.dbPath(dbId));
    const names: SchemaNames = { tables: index.tables, columns: index.columns };
    namesByDb.set(dbId, names);
    return names;
  };

  /** Every binding attempt, so the withheld count is a record and not a subtraction. */
  const attempts: TemplateAttempt[] = [];

  /**
   * The rule as it will be shown on a question from `dbId`, or `undefined` when it is withheld.
   *
   * One function for both foreign arms — the family's and the floor's — because the two must differ
   * in whose rule they show and in nothing else. The rendered line is the whole intervention: the
   * item's id, kind, confidence, scope and budget are untouched, so a difference between the two
   * forms is a difference the statement made.
   */
  const shownPack = (rule: DensityRule, dbId: string): string | undefined => {
    const item = itemById.get(rule.id) as KnowledgeItem;
    if (INJECTION_FORM === 'prose') return makePack([item], { budget: PROBE_BUDGET }).rendered;
    const outcome = transferStatement(rule.statement, namesOf(rule.domain), namesOf(dbId));
    attempts.push({ key: `${rule.id}\u0000${dbId}`, outcome });
    if (outcome.status === 'withheld') return undefined;
    return makePack([{ ...item, statement: outcome.statement }], { budget: PROBE_BUDGET }).rendered;
  };

  type Plan = {
    readonly ruleId: string;
    readonly domain: string;
    readonly targetId: string;
    readonly order: number;
    readonly row: BirdRow;
    readonly prompt: string;
    readonly baselineCorrect: boolean;
    readonly relevant: boolean;
    readonly cued: boolean;
  };
  const plans: Plan[] = [];
  const floorPlans: Plan[] = [];
  let unplaced = 0;
  const caseById = new Map(input.cases.map((entry) => [entry.id, entry]));
  for (const [at, dbId] of panelDbs.entries()) {
    const panel = panels.get(dbId) as readonly DensityTarget[];
    const dbPath = input.dataset.dbPath(dbId);
    const index = schemaIndex(dbPath);
    const schema = new Set([...index.tables, ...index.columns]);
    const ddl = schemaSql(dbPath);
    const here = rules.filter((rule) => rule.domain === dbId);
    for (const rule of here) {
      const item = itemById.get(rule.id) as KnowledgeItem;
      const pack = makePack([item], { budget: PROBE_BUDGET }).rendered;
      for (const [order, target] of panel.entries()) {
        const entry = caseById.get(target.id) as CaseOutcome;
        const verdict = classify(rule, schema, target);
        plans.push({
          ruleId: rule.id,
          domain: dbId,
          targetId: target.id,
          order,
          row: {
            question_id: entry.questionId,
            db_id: entry.dbId,
            question: entry.question,
            evidence: entry.evidence,
            SQL: entry.goldSql,
            difficulty: entry.difficulty,
          },
          prompt: promptFor({
            question: target.question,
            evidence: target.evidence,
            ddl,
            pack,
            stated: false,
            convention: ACTIVE,
          }),
          baselineCorrect: target.baselineCorrect,
          relevant: verdict.relevant,
          cued: verdict.cued,
        });
      }
    }
    // One foreign rule per panel, drawn from a rotating offset so the floor is not one donor
    // database measured ten times.
    const start = rules.length === 0 ? 0 : (at * 3) % rules.length;
    const rotated = [...rules.slice(start), ...rules.slice(0, start)].filter((rule) => rule.domain !== dbId);
    // The first donor that can be shown. Under `prose` every donor qualifies by definition, so the
    // rotation is R9.4's; under `bound` a donor whose slots have no referent here is passed over,
    // because a floor measured with prose against a family shown bound would confound the form with
    // the content the floor is there to control for.
    let chosen: { readonly donor: DensityRule; readonly pack: string } | undefined;
    for (const candidate of rotated) {
      const rendered = shownPack(candidate, dbId);
      if (rendered !== undefined) {
        chosen = { donor: candidate, pack: rendered };
        break;
      }
    }
    if (chosen === undefined) continue;
    const donor = chosen.donor;
    const donorPack = chosen.pack;
    for (const [order, target] of panel.entries()) {
      const entry = caseById.get(target.id) as CaseOutcome;
      const verdict = classify(donor, schema, target);
      floorPlans.push({
        ruleId: donor.id,
        domain: dbId,
        targetId: target.id,
        order,
        row: {
          question_id: entry.questionId,
          db_id: entry.dbId,
          question: entry.question,
          evidence: entry.evidence,
          SQL: entry.goldSql,
          difficulty: entry.difficulty,
        },
        prompt: promptFor({
          question: target.question,
          evidence: target.evidence,
          ddl,
          pack: donorPack,
          stated: false,
          convention: ACTIVE,
        }),
        baselineCorrect: target.baselineCorrect,
        relevant: verdict.relevant,
        cued: verdict.cued,
      });
    }
  }
  // The foreign arm: every rule exercised at home is also pointed at questions from databases that
  // are not its own. Nothing else in the family leaves the rule's schema, so without this arm the
  // 1.33pp R9.3 measured is the value of a rule in the database it came from and nothing more.
  const crossPlans: Plan[] = [];
  const ddlByDb = new Map<string, string>();
  const schemaByDb = new Map<string, Set<string>>();
  for (const draw of foreignPanels(
    rules,
    input.cases.map((entry) => ({ id: entry.id, dbId: entry.dbId })),
    TRANSFER_PANEL,
  )) {
    const entry = caseById.get(draw.targetId) as CaseOutcome;
    const rule = rules.find((candidate) => candidate.id === draw.ruleId) as DensityRule;
    if (!ddlByDb.has(draw.dbId)) {
      const index = schemaIndex(input.dataset.dbPath(draw.dbId));
      ddlByDb.set(draw.dbId, schemaSql(input.dataset.dbPath(draw.dbId)));
      schemaByDb.set(draw.dbId, new Set([...index.tables, ...index.columns]));
    }
    const pack = shownPack(rule, draw.dbId);
    // R10: a template whose slots have no referent in the schema it is about to meet is withheld,
    // not shown unbound. The attempt is already in `attempts`, so the count is a record; skipping
    // the plan is what makes the withholding real rather than a label on a prompt that still
    // carried the sentence.
    if (pack === undefined) continue;
    const verdict = classify(
      rule,
      schemaByDb.get(draw.dbId) as Set<string>,
      { question: entry.question, evidence: entry.evidence, goldSql: entry.goldSql },
    );
    crossPlans.push({
      ruleId: rule.id,
      // The database the injection landed in, not the rule's own: every reading downstream asks
      // where a rule was shown, and `offHome` is the count of the times that was the wrong answer.
      domain: draw.dbId,
      targetId: draw.targetId,
      order: draw.order,
      row: {
        question_id: entry.questionId,
        db_id: entry.dbId,
        question: entry.question,
        evidence: entry.evidence,
        SQL: entry.goldSql,
        difficulty: entry.difficulty,
      },
      prompt: promptFor({
        question: entry.question,
        evidence: entry.evidence,
        ddl: ddlByDb.get(draw.dbId) as string,
        pack,
        stated: false,
        convention: ACTIVE,
      }),
      baselineCorrect: entry.withoutMemoryCorrect,
      relevant: verdict.relevant,
      cued: verdict.cued,
    });
  }

  // Counted over the store rather than over the selection: what a reader wants to know is how much
  // of the store the family could not reach, not how much of an already-filtered subset it dropped.
  for (const item of input.items) {
    const domain = item.scope.domain ?? '';
    if (item.status === 'active' && domain !== '' && !covered.has(domain)) unplaced += 1;
  }

  const calls = plans.length + floorPlans.length + crossPlans.length;
  const templates = INJECTION_FORM === 'bound' ? templateCoverage(attempts) : undefined;
  process.stdout.write(
    `[sota] density: ${rules.length} rules x ${DENSITY_PANEL} questions from ` +
      `${panelDbs.length} databases, ${floorPlans.length} floor injections, ` +
      `${crossPlans.length} foreign injections, ${calls} calls\n`,
  );
  // R10's bookkeeping, printed before the calls are paid for rather than after: a run whose binder
  // withheld more than 60% of the family cannot answer the question it was dispatched with, and the
  // cheapest moment to say so is now.
  if (templates !== undefined) {
    process.stdout.write(
      `[sota] density templates: ${templates.bound} bound + ${templates.slotless} slotless = ` +
        `${templates.bound + templates.slotless} shown, ${templates.withheld} withheld of ` +
        `${templates.bound + templates.slotless + templates.withheld} attempt(s) ` +
        `(${(templates.withheldShare * 100).toFixed(1)}%)\n`,
    );
    for (const blocker of templates.blockers.slice(0, 8)) {
      process.stdout.write(
        `[sota] density templates: ${blocker.kind} '${blocker.name}' stopped ${blocker.attempts} attempt(s)\n`,
      );
    }
  }

  let moved = 0;
  let retried = 0;
  const ask = async (plan: Plan): Promise<DensityTrial | undefined> => {
    let correct: boolean | undefined;
    // A call that never returned is a hole, and a hole scored as a wrong answer would turn an
    // endpoint hiccup into a finding about the rule. It is dropped from the ledger and counted
    // instead: the alternatives are to score it, which is a fabricated verdict, or to fail the
    // run, which throws away the injections that did return.
    //
    // It is retried once first, because a hole is expensive in a way a duplicate is not: one lost
    // call costs a rule one of its twenty chances, and the first dispatch of R9.4 was refused by
    // its own bookkeeping gate over exactly one. A hole that survives the retry is real and is
    // reported as one.
    for (let attempt = 0; attempt < 2 && correct === undefined; attempt += 1) {
      if (attempt > 0) retried += 1;
      try {
        const reply = await chat(plan.prompt);
        correct = judgeReply(plan.row, input.dataset.dbPath(plan.domain), reply, input.task).correct;
      } catch (error) {
        if (error instanceof MicrogliaError && error.code === 'MG_E_BUDGET_EXCEEDED') throw error;
        if (error instanceof MicrogliaError && error.code === 'MG_E_PROVIDER_FAILED') throw error;
      }
    }
    moved += 1;
    if (moved % 100 === 0 || moved === calls) {
      process.stdout.write(
        `[sota] density ${moved}/${calls} calls=${llm.stats.calls} retried=${retried}\n`,
      );
    }
    if (correct === undefined) return undefined;
    return {
      ruleId: plan.ruleId,
      domain: plan.domain,
      targetId: plan.targetId,
      order: plan.order,
      correct,
      baselineCorrect: plan.baselineCorrect,
      relevant: plan.relevant,
      cued: plan.cued,
    };
  };

  const asked = await mapPool(plans, CONCURRENCY, ask);
  const askedFloor = await mapPool(floorPlans, CONCURRENCY, ask);
  const askedCross = await mapPool(crossPlans, CONCURRENCY, ask);
  const trials = asked.filter((trial): trial is DensityTrial => trial !== undefined);
  const floorTrials = askedFloor.filter((trial): trial is DensityTrial => trial !== undefined);
  const crossTrials = askedCross.filter((trial): trial is DensityTrial => trial !== undefined);
  return {
    report: densityReport({
      rules,
      panel: DENSITY_PANEL,
      trials,
      floorTrials,
      resamples: RESAMPLES,
      seed: SEED,
      // Absent rather than empty when the arm was not bought: a foreign reading over zero trials
      // would fail V24 and read as a finding about transfer instead of about the configuration.
      ...(crossPlans.length === 0 ? {} : { crossTrials, transferPanel: TRANSFER_PANEL }),
      ...(templates === undefined ? {} : { templates }),
      holes: crossPlans.length + floorPlans.length + plans.length - trials.length - floorTrials.length - crossTrials.length,
    }),
    excluded,
    rules: rules.length,
    unplaced,
    calls,
    unmeasured:
      asked.length + askedFloor.length + askedCross.length - trials.length - floorTrials.length - crossTrials.length,
    trials,
    floorTrials,
    crossTrials,
  };
}

type FoldProbeRecord = {
  readonly sourceQuestions: number;
  readonly measured: number;
  readonly unmeasured: number;
  readonly supplied: number;
  readonly redundant: number;
  readonly broke: number;
  readonly useless: number;
  /**
   * The store the probe was given, which is the population the four admission buckets partition.
   *
   * Not the same number as `citations`: one correction can distil two rules and one rule can be
   * cited by two corrections, so the counts diverge in both directions. The blocking gate V13
   * compares the buckets against this field, and it was written against the other one.
   */
  readonly rules: number;
  /** Rule citations across the trials, which is how much of the store each case exercised. */
  readonly citations: number;
  readonly blankFixRate: number;
  /** Source questions the gate never reached, by reason: a hole is not a verdict. */
  readonly skipped: Readonly<Record<string, number>>;
  /** How the corrected cases failed, so the gate's population is described rather than implied. */
  readonly failureKinds: Readonly<Record<string, number>>;
  /** Rules kept, and the buckets the rest fell into. */
  readonly kept: number;
  readonly noVerifiedSource: number;
  readonly brokeItsSource: number;
  readonly unsupported: number;
  /** Items per pack before and after the gate, and questions whose pack it changed. */
  readonly packAll: number;
  readonly packKept: number;
  readonly packDiffers: number;
  /** Verdicts beside failure kinds: `useless` means one thing with a symptom and another without. */
  readonly byKind: Readonly<Record<string, Readonly<Record<string, number>>>>;
  /**
   * Rules that know the database they were learned in, and rules that do not.
   *
   * `scope.domain` is what points a rule at a foreign question, and it is the one field the host
   * knows and the model only echoes. The share without one is the ceiling on transfer, so it is a
   * reading rather than an implementation detail.
   */
  readonly domain: { readonly withDomain: number; readonly withoutDomain: number };
};

/**
 * One probe run, as a fold carries it.
 *
 * A function rather than a literal in the fold's return statement, because the lane now runs the
 * same probe over two stores: two hand-written literals is how a field ends up computed from one
 * arm's pack sizes in one block and the other's in the next.
 */
function probeRecord(
  probe: ProbeRun,
  sizes: readonly { readonly all: number; readonly kept: number }[],
  differs: number,
): FoldProbeRecord {
  return {
    ...probe.summary,
    // The gate's `rules` is the store the probe was given, not the number of citations the trials
    // carry. `summary.rules` sums `itemIds` over trials, so a rule cited by two of its own
    // corrections counts twice; the four admission buckets partition *items*. These were the same
    // number by accident in the first dry run and not in any fold that had a rule cited more than
    // once, which made V13 — a blocking gate — impossible to pass. `citations` keeps the other
    // reading, because "12 citations of 3 rules" is worth knowing when a store is dense.
    rules: probe.rules,
    citations: probe.summary.rules,
    skipped: probe.skipped,
    failureKinds: probe.failureKinds,
    kept: probe.admission.kept.length,
    noVerifiedSource: probe.admission.noVerifiedSource,
    brokeItsSource: probe.admission.brokeItsSource,
    unsupported: probe.admission.unsupported,
    packAll: sizes.reduce((sum, entry) => sum + entry.all, 0),
    packKept: sizes.reduce((sum, entry) => sum + entry.kept, 0),
    packDiffers: differs,
    byKind: probe.byKind,
    domain: probe.domain,
  };
}

/**
 * One probe run, as the artefact carries it.
 *
 * Shared by the two substrates so the two blocks cannot drift in a field name or a denominator: the
 * instrument is the same instrument, and a report that computed `blank_fix_rate` from one store's
 * buckets and the other's rates would make the two numbers look comparable when they were not.
 */
function probeArtefact(
  folds: readonly FoldResult[],
  pick: (fold: FoldResult) => FoldProbeRecord | null,
): Record<string, unknown> | null {
  const runs = folds.map(pick);
  if (runs.every((run) => run === null)) return null;
  const total = (get: (run: FoldProbeRecord) => number): number =>
    runs.reduce((sum, run) => sum + (run === null ? 0 : get(run)), 0);
  const measured = total((run) => run.measured);
  const reproduced = total((run) => run.supplied) + total((run) => run.redundant);
  // The retry's own ceiling on this population: the cases a bare second attempt already repaired.
  const fixedByRetry = total((run) => run.redundant) + total((run) => run.broke);
  return {
    source_questions: total((run) => run.sourceQuestions),
    measured,
    unmeasured: total((run) => run.unmeasured),
    supplied: total((run) => run.supplied),
    redundant: total((run) => run.redundant),
    broke: total((run) => run.broke),
    useless: total((run) => run.useless),
    /**
     * The share of cases the store reproduced with itself in the prompt.
     *
     * `supplied + redundant`, which is what the pairing compares. It is here because the artefact
     * should carry the same number the test used: a reader who had to derive it from two columns
     * would be re-deriving the statistic that decides which store is better.
     */
    reproduced_rate: measured === 0 ? 0 : Number((reproduced / measured).toFixed(4)),
    blank_fix_rate: measured === 0 ? 0 : Number((fixedByRetry / measured).toFixed(4)),
    failure_kinds: runs.reduce<Record<string, number>>((all, run) => {
      for (const [kind, count] of Object.entries(run?.failureKinds ?? {})) {
        all[kind] = (all[kind] ?? 0) + count;
      }
      return all;
    }, {}),
    skipped: runs.reduce<Record<string, number>>((all, run) => {
      for (const [reason, count] of Object.entries(run?.skipped ?? {})) {
        all[reason] = (all[reason] ?? 0) + count;
      }
      return all;
    }, {}),
    rules: total((run) => run.rules),
    kept: total((run) => run.kept),
    no_verified_source: total((run) => run.noVerifiedSource),
    broke_its_source: total((run) => run.brokeItsSource),
    unsupported: total((run) => run.unsupported),
    pack_all: total((run) => run.packAll),
    pack_kept: total((run) => run.packKept),
    pack_differs: total((run) => run.packDiffers),
    /**
     * How many of the store's rules know the database they were learned in.
     *
     * The ceiling on transfer: a rule without a home database cannot be pointed at a foreign
     * question, so a store where this share is small cannot be measured for transfer however many
     * rules it holds.
     */
    domain: {
      with_domain: total((run) => run.domain.withDomain),
      without_domain: total((run) => run.domain.withoutDomain),
    },
    /**
     * Verdicts beside the kind of failure the case presented.
     *
     * 85% of this corpus's corrections have no mechanical symptom, and a rule distilled from one of
     * those had nothing to work from but the fact of rejection. Reading `useless` without this table
     * would blame the distiller for an absent signal.
     */
    by_kind: runs.reduce<Record<string, Record<string, number>>>((all, run) => {
      for (const [kind, counts] of Object.entries(run?.byKind ?? {})) {
        const row = all[kind] ?? (all[kind] = {});
        for (const [verdict, count] of Object.entries(counts)) {
          row[verdict] = (row[verdict] ?? 0) + count;
        }
      }
      return all;
    }, {}),
    by_fold: folds.map((fold, index) => {
      const run = runs[index] ?? null;
      return {
        fold: fold.fold,
        source_questions: run?.sourceQuestions ?? 0,
        supplied: run?.supplied ?? 0,
        rate:
          run === null || run.sourceQuestions === 0
            ? 0
            : Number((run.supplied / run.sourceQuestions).toFixed(4)),
      };
    }),
  };
}

/**
 * One substrate's transfer measurement, as the artefact carries it and as the gates read it.
 *
 * Typed rather than a bag of unknown fields, because the same object now feeds both the file and
 * the gates that reconcile it: a projection the gate cannot read would be a block of numbers whose
 * only reader is a human.
 */
type TransferProjection = {
  readonly rules: number;
  readonly trials: number;
  readonly informative: number;
  readonly repaired: number;
  readonly broke: number;
  readonly blank_right: number;
  readonly unchanged: number;
  readonly unmeasured: number;
  readonly unmeasured_blank: number;
  readonly ledger: readonly (readonly (string | boolean | null)[])[];
  readonly rate: number;
  readonly measured: number;
  readonly marginal_repair: number;
  readonly marginal_break: number;
  readonly net_pp: number;
  readonly break_rate: number;
  readonly verdict: string;
  readonly rules_with_repair: number;
  readonly skipped: Readonly<Record<string, number>>;
  readonly pack_all: number;
  readonly pack_kept: number;
  readonly pack_differs: number;
};

/**
 * Four reductions of the same folds — trials, measured, repairs, breaks — decide seven published
 * ratios, and the first version of this block recomputed them inside every field. Reading them once
 * means a field cannot be computed from one denominator and its neighbour from another, which is the
 * defect V17 exists to catch after the fact.
 */
function transferArtefact(
  folds: readonly FoldResult[],
  pick: (fold: FoldResult) => FoldTransferRecord | null,
): TransferProjection | null {
  const runs = folds.map(pick);
  if (runs.every((run) => run === null)) return null;
  const total = (get: (run: FoldTransferRecord) => number): number =>
    runs.reduce((sum, run) => sum + (run === null ? 0 : get(run)), 0);
  const trials = total((run) => run.summary.trials);
  const unmeasured = total((run) => run.summary.unmeasured);
  const measured = trials - unmeasured;
  const informative = total((run) => run.summary.informative);
  const repaired = total((run) => run.summary.repaired);
  const broke = total((run) => run.summary.broke);
  const blankRight = total((run) => run.summary.blankRight);
  return {
    rules: total((run) => run.summary.rules),
    trials,
    informative,
    repaired,
    broke,
    blank_right: blankRight,
    unchanged: total((run) => run.summary.unchanged),
    unmeasured,
    unmeasured_blank: total((run) => run.summary.unmeasuredBlank),
    /**
     * The pairs themselves, `[rule, target, blank, withRule]` per row, in fold order.
     *
     * The aggregate answers how often and the ledger answers where. The first version of this field
     * was written into the fold record, which the artefact does not serialise, so the run it was
     * added for carried the summary and none of the pairs. It is projected here, where the artefact
     * reads, and pinned by a test on the projection.
     */
    ledger: runs.flatMap((run) =>
      run === null
        ? []
        : run.trials.map((trial) => [
            trial.itemId,
            trial.targetId,
            // `null` rather than a missing key: an absence has to stay visible in the file.
            trial.blankCorrect ?? null,
            trial.withRuleCorrect ?? null,
          ]),
    ),
    rate: informative === 0 ? 0 : Number((repaired / informative).toFixed(4)),
    // The whole 2x2, because `rate` alone can only go up: its denominator is the targets a bare
    // retry could not fix, which excludes every trial where the rule can do damage.
    measured,
    marginal_repair: measured === 0 ? 0 : Number((repaired / measured).toFixed(4)),
    marginal_break: measured === 0 ? 0 : Number((broke / measured).toFixed(4)),
    net_pp: measured === 0 ? 0 : Number((((repaired - broke) / measured) * 100).toFixed(2)),
    break_rate: blankRight === 0 ? 0 : Number((broke / blankRight).toFixed(4)),
    verdict:
      informative < TRANSFER_FLOOR
        ? 'unmeasured'
        : measured === 0 || repaired - broke <= 0
          ? 'no-transfer'
          : 'transfers',
    rules_with_repair: total((run) => run.summary.rulesWithRepair),
    skipped: runs.reduce<Record<string, number>>((all, run) => {
      for (const [reason, count] of Object.entries(run?.skipped ?? {})) {
        all[reason] = (all[reason] ?? 0) + count;
      }
      return all;
    }, {}),
    pack_all: total((run) => run.packAll),
    pack_kept: total((run) => run.packKept),
    pack_differs: total((run) => run.packDiffers),
  };
}

/**
 * The gates' view of one projection.
 *
 * Written as a translation rather than as a second set of reductions, so that the file and the
 * validity gates cannot report different directions for the same run: the totals are computed once
 * in `transferArtefact` and every reader reads them. The first version of this block recomputed
 * them inline, which is how a published rate once disagreed with the gate that was meant to pin it.
 */
function transferGateInput(projection: TransferProjection): TransferGateInput {
  return {
    trials: projection.trials,
    informative: projection.informative,
    repaired: projection.repaired,
    blankRight: projection.blank_right,
    unmeasured: projection.unmeasured,
    unmeasuredBlank: projection.unmeasured_blank,
    ledger: projection.ledger.length,
    measured: projection.measured,
    broke: projection.broke,
    netPp: projection.net_pp,
    verdict: projection.verdict,
  };
}

/** One substrate's transfer measurement, as a fold carries it. */
type FoldTransferRecord = {
  readonly summary: TransferSummary;
  readonly rules: number;
  readonly skipped: Readonly<Record<string, number>>;
  /** Every pair, so a later reading does not have to buy the run again. */
  readonly trials: readonly TransferTrial[];
  readonly packAll: number;
  readonly packKept: number;
  readonly packDiffers: number;
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
  /**
   * Questions where the pruning changed the recalled pack, and how many were read twice.
   *
   * Zero differences with a non-zero retirement count means the arm measured `full` twice.
   */
  readonly validatedPackDiffers: number;
  readonly validatedPositions: number;
  /** Questions the anchored arm could not revise because the first round had no answer. */
  readonly anchoredSkipped: number;
  /** How many rules each pack carried and how many survived the grounding filter. */
  readonly grounded: { readonly all: number; readonly kept: number };
  /** Questions the retry arm acted on, and questions it left alone. */
  readonly retried: number;
  readonly notRetried: number;
  /** Rules injected into a prompt this fold, and how many named a condition. */
  readonly injectedRules: number;
  readonly injectedWithCondition: number;
  /** Per arm, how many of its prompts carried the framing it declares. */
  readonly framing: readonly FramingDelivery[];
  /** Where the domain-free items came from: the door, or the widening. */
  readonly domainOrigin: {
    readonly storedWithDomain: number;
    readonly storedWithoutDomain: number;
    readonly unscopedIn: number;
    readonly widenedIn: number;
  };
  /**
   * What the raw arm sent: payload lines, how many were verbatim, and how much did not fit.
   *
   * A validity counter rather than a measurement. The arm's claim is that the event reaches the prompt
   * unaltered, and that claim is either true of every line or false of the arm.
   */
  readonly raw: {
    readonly cells: number;
    readonly verbatim: number;
    readonly skipped: number;
    readonly events: number;
    /** The first block that was not byte-identical, for the gate to print rather than to judge. */
    readonly sample?: string;
  };
  /**
   * Per question, what the clearance removed and what each of the two arms then carried.
   *
   * Recorded per question rather than summed at the source because the gate is a *paired* claim:
   * "the control dropped the same number" is a statement about each question, and two sums that
   * happen to agree say nothing about whether any single question was dose-matched.
   */
  readonly clearance: readonly {
    readonly position: number;
    /** Rules the clearance removed from this question's pack, before the budget was applied. */
    readonly dropped: number;
    /** Items each arm carried after the budget, which is what the model actually read. */
    readonly cleared: number;
    readonly control: number;
    readonly identical: boolean;
  }[];
  /** Digest of the store at the moment scoring began, which is what the guard checks. */
  readonly digest: string;
  /**
   * Digest and active count as learning produced them, before any arm retired anything.
   *
   * Equal to `digest`/`activeRules` unless `full-validated` ran, in which case the pair
   * records what the deletion removed. Kept because a single digest would make the guard
   * either fire on the intended mutation or stop covering the unintended ones.
   */
  readonly digestBeforeValidation: string;
  readonly activeRulesBeforeValidation: number;
  /** Active rules in the unwidened memory, or null when no such memory was built. */
  readonly narrowActive: number | null;
  /** Active items in the repair memory, or null when the content arm was off. */
  readonly repairActive: number | null;
  /** Active items in the procedural memory, or null when that arm was off. */
  readonly proceduralActive: number | null;
  /** Failure-keyed recalls asked, and how many found a note, with both vocabularies. */
  readonly failureKey: {
    readonly asked: number;
    readonly hit: number;
    readonly stored: Readonly<Record<string, number>>;
    readonly observed: Readonly<Record<string, number>>;
  };
  /**
   * What the selectors did, when any sampling arm ran.
   *
   * A selector is only as good as its input distribution, and this block is what makes a gain
   * attributable: how often the draws agreed at all, how often the winner was the empty result (the
   * signature of a wrong join), and how many draws were actually taken.
   */
  readonly sampling:
    | {
        readonly draws: number;
        readonly temperature: number;
        readonly byArm: Readonly<Record<string, SelectionStats>>;
        /**
         * How many draws were right, per question: index is the count, value the questions.
         *
         * The distribution the same-run ceiling comes from, and the only number that says whether
         * more draws add *distinct* correct answers or repeat the same one. A run where every
         * correct question is right in all five draws has nothing for a selector to find, and a run
         * where they are right exactly once has everything.
         */
        readonly correctDraws: readonly number[];
        /**
         * The model selector's own accounting, when an arm used it.
         *
         * `asked` is the questions whose draws disagreed — the only ones where a choice existed —
         * and `unparsed` the ones whose reply named no candidate. Read together they say whether a
         * delta belongs to the selector: an arm with `unparsed === asked` scored the first draw on
         * every question and is `sample-N-first` with an extra call in the bill.
         */
        readonly selectors:
          | Readonly<Record<string, { readonly asked: number; readonly unparsed: number }>>
          | null;
      }
    | null;
  /**
   * What the lexical linker did, when that arm ran.
   *
   * A pruner whose `nothing-matched` share is most of the run is a pruner that measured nothing, and
   * the arm's delta would then be a reading of its own abstentions. Both numbers travel.
   */
  readonly link: {
    readonly reasons: Readonly<Record<string, number>>;
    readonly dropped: number;
    readonly total: number;
  } | null;
  /**
   * What the reproducibility gate found, or null when its arm did not run.
   *
   * The first measurement of extraction quality this project has, as opposed to a measurement of
   * what the extraction is worth on held-out questions. `supplied` is the number of corrections
   * the store can reproduce from itself, `broke` the number it makes worse, and `blankFixRate` the
   * share a retry repairs without any memory at all — without which the first number would read as
   * the rules' contribution.
   */
  readonly probe: FoldProbeRecord | null;
  /** The same probe over the repair store, or null when that arm was off. */
  readonly probeRepair: FoldProbeRecord | null;
  /**
   * The two stores compared on the questions they share, or null when only one was measured.
   *
   * Here rather than in `probe` because it is not a property of either store: it is the statement
   * of which substrate reproduces more of its own corrections, and it only exists while both do.
   */
  readonly substrate: SubstrateComparison | null;
  /**
   * What the admitted rules did to other questions, or null when transfer was not measured.
   *
   * `summary.rate` is repairs over *informative* trials — targets a bare retry could not repair —
   * and it is the one number that converts a store's size into an expected number of repairs.
   */
  readonly transfer: FoldTransferRecord | null;
  /**
   * The same measurement over the second substrate, or null when it was not asked for.
   *
   * A repair and a rule travel for different reasons — one names the case, the other names the
   * mechanism — and R13 measured only the first at 7.3% repair against 50% damage. The pair's
   * transfer is the one reading that can say whether reproducing twice as much buys anything on a
   * question the store was not written from.
   */
  readonly transferRepair: FoldTransferRecord | null;
  /**
   * What the shuffled arm did, or null when it did not run.
   *
   * `donors` counts questions that drew a replacement pack and `identical` the ones whose donor
   * happened to carry the same rules, because an arm that silently fell back to its own pack on
   * every question is `full` with a second name.
   */
  readonly shuffled: { readonly donors: number; readonly identical: number } | null;
  /** The candidate pool this fold produced, empty when no sampling arm ran. */
  readonly pool: readonly PoolQuestion[];
  /** What the repair store holds, sampled: a count alone cannot show what was learned. */
  readonly repairItems: readonly RepairItem[];
  /** Candidates dropped by the parser, per form. */
  readonly distillDrops: {
    readonly rule: Readonly<Record<string, number>>;
    readonly repair: Readonly<Record<string, number>> | null;
  };
  readonly items: readonly StoredItem[];
  /**
   * The same rows as the store returned them, kept so the density stage can render a rule exactly
   * as a prompt would.
   *
   * `items` is a projection: it drops the fields `makePack` needs to render one rule, and a density
   * stage that re-rendered a rule its own way would measure a prompt the deployment never sends.
   */
  readonly storeItems: readonly KnowledgeItem[];
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
  const wrapped: Interpreter = async (context) => {
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
  // Forwarded, not swallowed: the wrapper is the interpreter the batch calls, so a pack that knows
  // how to warm its prompts would otherwise be warmed only when it is used without a recorder.
  if (inner.prefetch !== undefined) wrapped.prefetch = (contexts) => inner.prefetch?.(contexts) ?? Promise.resolve();
  return wrapped;
}

type FoldMemory = {
  readonly store: EmbeddedMemory;
  readonly host: Awaited<ReturnType<typeof openMicroglia>>;
  readonly learning: LearningPass;
  readonly distilled: {
    readonly created: number;
    readonly failed: number;
    /** Claims that reached the store with no domain, and items that lost theirs to widening. */
    readonly incomingWithoutDomain: number;
    readonly generalized: number;
  };
  readonly frozen: { readonly active: number; readonly total: number; readonly digest: string };
  readonly distillFailures: readonly string[];
  /**
   * Candidates the parser accepted as JSON and then dropped, by reason.
   *
   * The one number this lane was missing. A store that ends up with one item can mean the
   * distiller had nothing to say or that we discarded what it said, and those are opposite
   * findings. Counting the drops is what turns the difference into a reading.
   */
  readonly drops: Readonly<Record<string, number>>;
};

/**
 * One fold's memory: learn from the other folds, distil, freeze.
 *
 * The whole construction is a function of `(learnRows, generalize)` so it can be
 * run twice for one fold and produce two packs that differ in a single decision.
 * The learning *generations* are shared through `GenerationCache`, so the second
 * construction costs local store writes and one distillation, not another 280
 * model calls.
 */
async function buildFoldMemory(
  generalize: boolean,
  learnRows: readonly BirdRow[],
  dataset: Dataset,
  task: Task,
  form: DistillForm = 'lesson',
): Promise<FoldMemory> {
  const store = await EmbeddedMemory.open(new MemoryJournal());
  const failures: string[] = [];
  const drops: Record<string, number> = {};
  let lastReply = '';
  let distilledSoFar = 0;
  const host = await openMicroglia({
    app: 'microglia-sota',
    namespace: 'bird',
    store,
    interpreter: combineInterpreters(
      recording(
        createLlmInterpreter({
          llm: {
            // Distillation is the step that makes the *treatment*, not just the measurement:
            // two dispatches of the same code distil different rules from different replies,
            // so `full` has been anything from −4.57pp to +0.86pp across five runs. Replaying
            // the replies makes a re-run learn the same store, which is the only way an arm
            // comparison across dispatches varies in one thing.
            complete: async (prompt) => {
              const key = DistillCache.keyOf(MODEL, PROMPT_VERSION, prompt);
              const cached = distillations.get(key);
              if (cached !== undefined) return cached;
              // The repair form writes an object with three fields; the rule form writes one
              // sentence. Truncation is silent — the reply fails to parse and is counted as
              // "the model said nothing" — so the headroom is set where the risk is.
              const reply = await chat(prompt, form === 'repair' ? 3000 : 2000);
              lastReply = reply.text;
              distillations.set(key, reply.text);
              distilledSoFar += 1;
              // The distillation half has no other voice. A fold spends minutes here, all of it
              // waiting, and the dev dispatch that died at its step timeout printed nothing for the
              // last 107 minutes of its life — which read as a hang and was in fact a client killing
              // its own requests.
              if (distilledSoFar % 4 === 0) {
                process.stdout.write(
                  `[sota] distill ${distilledSoFar} reply/replies ` +
                    `(${String(form)}) calls=${llm.stats.calls} timeouts=${llm.stats.timeouts}\n`,
                );
              }
              return reply.text;
            },
          },
          concurrency: DISTILL_CONCURRENCY,
          // The form is what the distiller is asked *for*, so it belongs here rather than
          // in the lane: two memories over the same corrections, differing in one string of
          // instruction, is the content half of the experiment.
          form,
          audit: (reason: DropReason) => {
            drops[reason] = (drops[reason] ?? 0) + 1;
          },
          // The failure code travels with the claim, so a retry can look up the note by what went
          // wrong rather than by what the question was about. The classifier is the same function
          // on both sides, which is what makes the key a key and not a guess.
          reasonCodeOf: (context) => {
            const signal = context.event.signal;
            if (signal.type !== 'edit') return undefined;
            const note = signal.note ?? '';
            return note === '' ? undefined : failureKind(note);
          },
        }),
        failures,
        () => lastReply,
      ),
      ruleInterpreter,
    ),
    budget: 1200,
    clock: steppingClock(1_700_000_000_000, 1),
    random: mulberry32(SEED),
  });
  const learning = await learn(host, learnRows, dataset, task);
  // A prompt can ask for a procedure with no case nouns in it; only the host can refuse one that
  // has them. The filter reads the schema of the database the claim was learned from, so a note
  // that names one of its tables or columns never reaches the store — and a note that names
  // another database's is caught when that database's fold is built.
  const accept =
    form === 'procedure'
      ? (candidate: { statement: string; when?: string; scope: { domain?: string } }): boolean => {
          const domain = candidate.scope.domain;
          if (domain === undefined) return true;
          const index = schemaIndex(dataset.dbPath(domain));
          const text = `${candidate.statement} ${candidate.when ?? ''}`;
          const named = new Set([...index.tables, ...index.columns]);
          return !mentionsAny(text, named);
        }
      : undefined;
  const distilled = await host.distill({
    generalize,
    ...(accept === undefined ? {} : { accept }),
    // A budget or deadline arriving from inside the batch stops it. Counted instead, it would leave
    // a store built from part of the corrections and a report that said the model had nothing to
    // say about the rest.
    fatal: stoppedRun,
  });
  const frozen = await knowledgeDigest(store);
  return {
    store,
    host,
    learning,
    // The two counters the store's shape is made of. `created` and `failed` were the whole report
    // once, which is why a store with a fifth of its items unscoped could not be explained.
    distilled: {
      created: distilled.created,
      failed: distilled.failed,
      incomingWithoutDomain: distilled.incomingWithoutDomain,
      generalized: distilled.generalized,
    },
    frozen,
    distillFailures: failures,
    drops,
  };
}

/**
 * Which rules, when injected, were followed by a wrong answer.
 *
 * The literature's deletion rule (Xiong et al. 2025) is utility-based rather than
 * age-based: a record is retired because the tasks it was retrieved for went badly, not
 * because it is old. This is that rule at the granularity this framework has. Only
 * negative evidence counts — a correct answer while a rule was present is not evidence
 * that the rule helped, because the model may have been right anyway — so what is
 * collected is a score of trials and failures, and `retireeFrom` decides from it.
 *
 * The decision itself lives in `validation.ts` rather than here because it is a threshold,
 * and a threshold in a lane is a threshold nobody can test. The first version retired any
 * rule with a single failure, which a stand-in endpoint answered wrongly on purpose, and
 * it retired every rule it touched.
 *
 * The pass reads `learnRows`. Deleting on the basis of the questions being scored would
 * be leakage with a tidier name, and it would also make the arm unbeatable by
 * construction.
 *
 * Two callers read the same pass, and that is why it returns its credit rather than acting on
 * it. `full-validated` retires the rules whose record is bad enough — a store mutation, paid for
 * once per fold. `full-cleared` and its control want the same counterfactual counts without the
 * mutation, because they remove rules from a *pack* rather than from the store, per question.
 * The first version of this function called `host.forget` itself, which made the clearance arms
 * impossible to build without either duplicating three hundred lines or pruning the store they
 * were supposed to leave alone.
 */
async function validateMemory(
  host: FoldMemory['host'],
  rows: readonly BirdRow[],
  dataset: Dataset,
  task: Task,
  mode: CreditMode,
): Promise<{
  readonly mode: string;
  readonly rules: number;
  readonly injected: number;
  readonly trials: number;
  readonly retired: number;
  readonly histogram: Readonly<Record<string, number>>;
  readonly decisive: number;
  readonly excluded: number;
  readonly helped: number;
  readonly harmed: number;
  /** Rules the policy would remove. Applied by the caller, not here: see the note above. */
  readonly doomed: readonly string[];
  /** The counterfactual record, keyed by rule id, for callers that filter rather than delete. */
  readonly credit: ReadonlyMap<string, DecisiveCredit>;
}> {
  let excluded = 0;
  const judged = async (row: BirdRow, pack: string): Promise<boolean | undefined> => {
    try {
      const reply = await chat(
        promptFor({
          question: row.question,
          evidence: row.evidence,
          ddl: schemaSql(dataset.dbPath(row.db_id)),
          pack,
          stated: false,
          convention: ACTIVE,
        }),
      );
      return judgeReply(row, dataset.dbPath(row.db_id), reply, task).correct;
    } catch {
      // A call that never returned says nothing about the rule it was carrying.
      return undefined;
    }
  };

  // Two ways to decide what a rule did, both settings. `absolute` asks whether the rule was
  // present when the answer was wrong, which iteration 76 showed is mostly a question about
  // the question; `counterfactual` asks whether the answer changed because the rule was
  // there, which costs a second call per validation row and is the only score that can tell
  // a rule that hurts from a question that is hard.
  const outcomes = await mapPool(rows, CONCURRENCY, async (row) => {
    const recalled = await host.recall({ task: TASK, text: row.question, scope: { domain: row.db_id } });
    // A rule learned from this very question cannot be scored on it: the correction that
    // produced the rule was this question's answer, so the with-rule call is being asked to
    // reproduce the answer it was given. That is why the first counterfactual run credited
    // 132 rules with exactly one help and never a harm — the shape of a leak, not of a
    // signal. The rows being validated are the rows the fold learned from, so the exclusion
    // has to happen per item rather than by choosing a different split.
    const selfId = idOfRow(row);
    const items = recalled.items.filter((item) => !item.evidence.some((ref) => ref.taskId === selfId));
    excluded += recalled.items.length - items.length;
    const pack =
      items.length === recalled.items.length
        ? { ids: recalled.ids, rendered: recalled.rendered }
        : { ids: items.map((item) => item.id), rendered: makePack(items, { budget: recalled.budget }).rendered };
    if (pack.ids.length === 0) return { ids: [] as readonly string[], failed: false, helped: false, harmed: false };
    if (mode === 'absolute') {
      const ok = await judged(row, pack.rendered);
      return { ids: pack.ids, failed: ok === false, helped: false, harmed: false };
    }
    const [withRule, withoutRule] = await Promise.all([judged(row, pack.rendered), judged(row, '')]);
    const credit = outcomeCredit(withRule, withoutRule);
    // A pair whose calls both failed carries no verdict either; `outcomeCredit` folds it
    // into `uninformative`, and the ids are dropped so the rule is not credited a trial it
    // did not have.
    if (credit === 'uninformative' && (withRule === undefined || withoutRule === undefined)) {
      return { ids: [] as readonly string[], failed: false, helped: false, harmed: false };
    }
    return {
      ids: pack.ids,
      failed: false,
      helped: credit === 'helped',
      harmed: credit === 'harmed',
    };
  });

  let injected = 0;
  let decisive = 0;
  const absolute = new Map<string, { trials: number; failures: number }>();
  const counterfactual = new Map<string, { helped: number; harmed: number }>();
  for (const outcome of outcomes) {
    if (outcome.ids.length === 0) continue;
    injected += 1;
    if (outcome.helped || outcome.harmed) decisive += 1;
    for (const id of outcome.ids) {
      const entry = absolute.get(id) ?? { trials: 0, failures: 0 };
      absolute.set(id, {
        trials: entry.trials + 1,
        failures: entry.failures + (outcome.failed ? 1 : 0),
      });
      const pair = counterfactual.get(id) ?? { helped: 0, harmed: 0 };
      counterfactual.set(id, {
        helped: pair.helped + (outcome.helped ? 1 : 0),
        harmed: pair.harmed + (outcome.harmed ? 1 : 0),
      });
    }
  }
  const doomed =
    mode === 'absolute' ? retireeFrom(absolute, RETIREMENT) : retireeFromDecisive(counterfactual, DECISIVE);
  return {
    mode,
    rules: absolute.size,
    injected,
    trials: [...absolute.values()].reduce((sum, entry) => sum + entry.trials, 0),
    retired: doomed.length,
    histogram: mode === 'absolute' ? creditHistogram(absolute) : decisiveHistogram(counterfactual),
    decisive,
    /** Rules dropped because they were learned from the row being scored. */
    excluded,
    helped: [...counterfactual.values()].reduce((sum, entry) => sum + entry.helped, 0),
    harmed: [...counterfactual.values()].reduce((sum, entry) => sum + entry.harmed, 0),
    doomed,
    credit: counterfactual,
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
  const learnPool = rows.filter((row) => foldOf.get(idOf(row)) !== fold);
  // `rows` is interleaved across databases before it reaches a fold, so a prefix of it is a sample
  // of every database rather than of whichever one sorts first.
  const learnRows = LEARN_SAMPLE > 0 ? learnPool.slice(0, LEARN_SAMPLE) : learnPool;

  const widened = await buildFoldMemory(GENERALIZE, learnRows, dataset, task);
  // Scope widening is an arm here, not a second dispatch: the same corrections are
  // distilled twice, once promoting rules that recur across databases and once
  // leaving them where they were observed, so the two packs differ in exactly one
  // decision. Two dispatches would leave the comparison inside the run-to-run noise
  // of this benchmark, which is about half a percentage point.
  const narrowed =
    ARMS.has('full-narrow') && GENERALIZE
      ? await buildFoldMemory(false, learnRows, dataset, task)
      : undefined;
  // The content axis. A second store over the *same* corrections, differing in one
  // instruction string: rules say what is true, repairs say what failed and what fixed it.
  // Built only when an arm asks, because the distillation is the expensive half of a fold.
  const wantsRepair =
    RETRY_ARMS.some((arm) => arm !== 'retry-blank' && ARMS.has(arm)) ||
    ARMS.has('full-repair') ||
    ARMS.has('full-repair-verified') ||
    ARMS.has('full-repair-transferred');
  const repaired = wantsRepair
    ? await buildFoldMemory(GENERALIZE, learnRows, dataset, task, 'repair')
    : undefined;
  // The form no arm had tried: the same corrections, stated as procedures with no case in them.
  const procedural = ARMS.has('full-procedural') || ARMS.has('retry-keyed') || ARMS.has('chars-proc-600')
    ? await buildFoldMemory(GENERALIZE, learnRows, dataset, task, 'procedure')
    : undefined;
  const store = widened.store;
  const learning = widened.learning;
  const distilled = widened.distilled;
  const frozen = widened.frozen;
  const distillFailures = [
    ...widened.distillFailures,
    ...(narrowed === undefined ? [] : narrowed.distillFailures),
    ...(repaired === undefined ? [] : repaired.distillFailures),
    ...(procedural === undefined ? [] : procedural.distillFailures),
  ];

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

  // Three phases instead of one loop, because the model calls are what take the
  // time and everything else is local. Recall, prompt construction, and judging
  // are memory or SQLite work measured in microseconds; the calls are 2–5 seconds
  // each. Issuing them one at a time made a fold 27 minutes long, which is what
  // pushed the first full-split dispatch past its step timeout at fold 4 of 5.
  //
  //  1. plan    — for each question, recall every arm's pack and build its prompt
  //  2. call    — issue every prompt with bounded concurrency
  //  3. judge   — score the replies in corpus order, writing nothing
  //
  // The phases cannot bias the measurement: a prompt is built from the frozen pack
  // before any call is made, and scoring happens after every reply has arrived, so
  // no call's result influences another's prompt.
  type PlannedCall = {
    readonly position: number;
    readonly arm: ArmName;
    readonly prompt: string;
    readonly packIds: number;
    /** Characters of knowledge the prompt carried: the x-axis of the dose curve. */
    readonly packChars: number;
  };
  type PackInfo = { readonly ids: readonly string[]; readonly coverage: number };
  const plans: PlannedCall[] = [];
  const packs: PackInfo[] = [];

  /**
   * Which arm renders which kind of block.
   *
   * A table rather than a parameter: the kind is a property of the arm, and an arm that
   * had to be told twice what it was would eventually be told two different things.
   */
  const PACK_KIND: Partial<Record<ArmName, PackKind>> = {
    'full-repair': 'repair',
    'full-raw': 'raw',
    'full-raw-shuffled': 'raw',
  };


  const call = (
    position: number,
    arm: ArmName,
    packText: string,
    packIds: number,
    critique = false,
    packPosition: 'before' | 'after' = 'before',
    /** The schema to show, when it is not the database's own. */
    schema?: string,
    /** Which procedure writes the query; `direct` when an arm does not say. */
    generator?: GeneratorKind,
  ): void => {
    const row = evalRows[position] as BirdRow;
    plans.push({
      position,
      arm,
      packIds,
      packChars: packText.length,
      prompt: promptFor({
        question: row.question,
        evidence: row.evidence,
        ddl: schema ?? schemaSql(dataset.dbPath(row.db_id)),
        pack: packText,
        stated: arm === 'stated',
        convention: ACTIVE,
        packPosition,
        ...(generator === undefined ? {} : { generator }),
        ...(critique ? { critique: true } : {}),
        // The block is labelled by what it holds. Rendering a repair note under the
        // rule heading would ask the reader to act on a story as if it were a fact, and
        // the arm would then measure the mismatch between label and content.
        ...(PACK_KIND[arm] === undefined ? {} : { packKind: PACK_KIND[arm] as PackKind }),
        // How the block is addressed, read from the table in `sota.ts` so that the rendering can
        // be tested without a database. Absent is the shipped wording, which is what every
        // published number was produced with.
        ...(ARM_STANDING[arm] === undefined ? {} : { standing: ARM_STANDING[arm] as PackStanding }),
      }),
    });
  };

  // What the shape experiment actually had to work with. Counted at the pack, not at
  // the store: an item that named a condition and never reached a prompt cannot
  // change an answer, and the gate below is about what was injected.
  let injectedRules = 0;
  let injectedWithCondition = 0;
  /** What the lexical linker decided, per question: a pruner that never prunes measures nothing. */
  const linkReasons: Record<string, number> = {};
  /** Tables kept and offered, per question, so the arm's harm can be split by whether it pruned. */
  const linkKept = new Map<number, { readonly kept: number; readonly total: number; readonly pruned: boolean }>();
  let linkDropped = 0;
  let linkTotal = 0;
  /** Questions where the pruned store produced a different pack from the unpruned one. */
  let validatedPackDiffers = 0;
  let validatedPositions = 0;
  /** The reproducibility gate's verdict for this fold, once it has run. */
  let probe: ProbeRun | undefined;
  /** The same gate over the repair store, when the second substrate was asked for. */
  let probeRepair: ProbeRun | undefined;
  /** The two stores compared on the questions they share, once both have been probed. */
  let substrate: SubstrateComparison | null = null;
  /** What the repair store's own gate left in each pack, and how many questions it changed. */
  const repairVerifiedSizes: { all: number; kept: number }[] = [];
  let repairVerifiedDiffers = 0;
  /** The same, for the intersection of the two repair gates. */
  const repairTransferredSizes: { all: number; kept: number }[] = [];
  let repairTransferredDiffers = 0;
  /** What the gate did to each pack: items before and after, so a shrink is a number. */
  const verifiedSizes: { all: number; kept: number }[] = [];
  /** Questions where the gate changed the pack. Zero differences means it scored `full` twice. */
  let verifiedDiffers = 0;
  /** Questions whose shuffled pack came from a real donor, and how many were identical anyway. */
  let shuffledDonors = 0;
  let shuffledIdentical = 0;
  /** What the transfer gate left in each pack, and how many questions it changed. */
  const transferSizes: { all: number; kept: number }[] = [];
  let transferDiffers = 0;
  /**
   * The pack each question would see on a retry, held until the first answer has run.
   *
   * Both forms, because the retry arms differ in what they hand the retry and must see the
   * same question: `rule` is the declarative pack, `repair` the contrastive one, and either
   * may be empty for a given question.
   */
  const retries = new Map<number, { rule: Pack; repair: Pack | undefined }>();
  /** Questions that failed and therefore got a retry, and questions that never needed one. */
  let retried = 0;
  let notRetried = 0;
  /** How often a failure-keyed recall found a note, and how often it was asked. */
  let keyedTried = 0;
  let keyedHits = 0;
  /** What the procedural store files its notes under, and what the retries ask for. */
  const storedCodes: Record<string, number> = {};
  const observedCodes: Record<string, number> = {};
  /** How much of each pack survives the grounding filter, so the shrink is a number. */
  const groundedSizes: { all: number; grounded: number }[] = [];
  /** Payload lines a raw arm sent, and how many were byte-identical to the event behind them. */
  let rawCells = 0;
  let rawVerbatim = 0;
  let rawSkipped = 0;
  let rawEvents = 0;
  /** The first block any fold could not match verbatim, kept so a failure explains itself. */
  let rawSample: string | undefined;
  /** What the clearance removed per question, and what each of the two arms then carried. */
  const clearance: {
    position: number;
    dropped: number;
    cleared: number;
    control: number;
    identical: boolean;
  }[] = [];
  /** The pack each question would see, held for the anchored arm's second call. */
  const anchored = new Map<number, Pack>();
  /** The revision each question received for each anchored arm, judged after both rounds. */
  const anchoredReplies = new Map<
    string,
    { position: number; arm: ArmName; reply: Reply | undefined; packIds: number; packChars: number }
  >();
  let anchoredSkipped = 0;

  // A snapshot taken before the validated arm deletes anything. The other arms are
  // defined against the store as learned; a deletion that changed their packs would make
  // `full` and `full-validated` the same arm under two names, and the comparison would
  // report a difference of zero as if it had measured something.
  type Pack = Awaited<ReturnType<typeof widened.host.recall>>;
  const rawPacks = new Map<number, Pack>();
  const repairPacks = new Map<number, Pack>();
  const proceduralPacks = new Map<number, Pack>();
  const injectedText = (pack: Pack): string[] =>
    pack.items.map((item) => `${item.statement} ${item.when ?? ''}`);
  /** The texts each question's packs contained, for the relevance audit. */
  const injectedByPosition = new Map<number, string[]>();
  const injectedRepairByPosition = new Map<number, string[]>();
  const injectedProceduralByPosition = new Map<number, string[]>();
  for (const [position, row] of evalRows.entries()) {
    const query = { task: TASK, text: row.question, scope: { domain: row.db_id } };
    rawPacks.set(position, await widened.host.recall(query));
    if (repaired !== undefined) repairPacks.set(position, await repaired.host.recall(query));
    if (procedural !== undefined) proceduralPacks.set(position, await procedural.host.recall(query));
  }
  // The gate on extraction, run before anything is scored and on learn rows only. Its verdicts
  // filter the store the held-out questions see, so it must not read them.
  // Shared between the two probes: the control is the same call under both substrates, and paying
  // for it twice would put the endpoint's own sampling noise inside the comparison.
  const blankControls = new Map<string, boolean | undefined>();
  // An arm that injects a gated or transferred pack cannot run without the probe that decides what
  // is in it. The probe used to be asked for by one arm and consumed by two, so a dispatch that
  // named only `full-transferred` would have measured `none` under a second name and reported it as
  // a reading. Both consumers ask for it here instead.
  const wantsRuleProbe = ARMS.has('full-verified') || ARMS.has('full-transferred');
  const wantsRepairProbe = ARMS.has('full-repair-verified') || ARMS.has('full-repair-transferred');
  if (wantsRuleProbe) {
    probe = await probeMemory(store, learnRows, dataset, task, TRANSFER_TARGETS, blankControls);
  }
  // The other substrate, asked the same questions with the same controls. Its own admission gate
  // decides what `full-repair-verified` may inject; the pairing is what turns "these two rates look
  // different" into a test over the questions both stores covered.
  if (wantsRepairProbe && repaired !== undefined) {
    probeRepair = await probeMemory(
      repaired.store,
      learnRows,
      dataset,
      task,
      TRANSFER_TARGETS,
      blankControls,
    );
    if (probe !== undefined) {
      substrate = compareSubstrates(probe.trials, probeRepair.trials, {
        left: 'rule',
        right: 'repair',
      });
      process.stdout.write(
        `[sota] substrate fold ${fold + 1}: ${substrate.paired} paired, ` +
          `${substrate.left} ${(substrate.leftRate * 100).toFixed(1)}% vs ` +
          `${substrate.right} ${(substrate.rightRate * 100).toFixed(1)}%, ` +
          `delta=${substrate.deltaPp.toFixed(2)}pp p=${substrate.p.toFixed(4)} ` +
          `verdict=${substrate.verdict}\n`,
      );
    }
  }

  // The size-matched donor library the shuffled arm draws from: every held-out question's own
  // pack size, so a swap can be made without also changing how much text was injected.
  const packLibrary: PackCell[] =
    ARMS.has('full-shuffled')
      ? [...rawPacks].map(([position, pack]) => ({
          position,
          db: (evalRows[position] as BirdRow).db_id,
          items: pack.items.length,
        }))
      : [];

  // The deletion half of the literature's prescription, run on learn rows only, before
  // any held-out question is scored.
  //
  // The clearance arms buy the same pass and read it differently, and they need the *counterfactual*
  // reading whether or not the caller asked for it: "was this rule present when the answer was wrong"
  // is answered by the question's difficulty (iteration 76 fitted a single binomial across rules), so
  // a filter built on it would be a random filter with a narrative. One pass serves both callers
  // because the calls are the expensive part — 560 per fold — and the decision is the cheap part.
  const clearanceWanted = ARMS.has('full-cleared') || ARMS.has('full-cleared-sampled');
  let validation: Awaited<ReturnType<typeof validateMemory>> | undefined;
  if (ARMS.has('full-validated') || clearanceWanted) {
    validation = await validateMemory(
      widened.host,
      learnRows,
      dataset,
      task,
      clearanceWanted ? 'counterfactual' : CREDIT,
    );
    validations.push({ fold, ...validation });
  }
  // Retirement mutates the store; cleanup does not. Only the arm that names deletion is allowed to
  // delete, so a run asking for clearance alone leaves every rule in place and `full` means the same
  // thing it meant in the run before it.
  if (ARMS.has('full-validated') && validation !== undefined && validation.doomed.length > 0) {
    await widened.host.forget({ ids: validation.doomed });
  }
  // The raw substrate's two indexes: the event behind an item (by the question it was learned from) and
  // the pool a foreign arm draws from (by the database it was learned on). Both come from the fold's
  // learn rows, which is what makes the arm leakage-free by construction rather than by a filter: an
  // eval question's correction is never in this map, so no raw pack can show the answer it is scoring.
  const rawByTask = new Map<string, RawEvent>();
  const rawByDb = new Map<string, readonly RawEvent[]>();
  if (ARMS.has('full-raw') || ARMS.has('full-raw-shuffled')) {
    for (const event of widened.learning.events) rawByTask.set(event.taskId, event);
    const pools = new Map<string, RawEvent[]>();
    for (const learnRow of learnRows) {
      const event = rawByTask.get(idOf(learnRow));
      if (event === undefined) continue;
      const list = pools.get(learnRow.db_id) ?? [];
      list.push(event);
      pools.set(learnRow.db_id, list);
    }
    for (const [dbId, list] of pools) rawByDb.set(dbId, list);
  }
  // The rules the clearance drops, resolved once per fold: a rule's record is a property of the fold's
  // learn rows, not of the held-out question it is removed from.
  const clearedIds =
    validation === undefined ? new Set<string>() : new Set(clearanceFromDecisive(validation.credit));

  // The guard below proves that scoring writes nothing. An arm that retires rules writes
  // during construction instead, so the digest it is held to has to be taken *after* the
  // retirement and *before* the first question — otherwise the guard fires on the one
  // mutation the run intended, and the run reports a crash where it should report a
  // number. The pre-deletion digest is kept in the record, so the difference is a fact a
  // reader can check rather than a guard that had to be loosened to let the arm through.
  const scoringFrozen = ARMS.has('full-validated') ? await knowledgeDigest(store) : frozen;

  for (const [position, row] of evalRows.entries()) {
    const query = { task: TASK, text: row.question };
    const pack = rawPacks.get(position) as Pack;
    injectedRules += pack.items.length;
    injectedWithCondition += pack.items.filter((item) => item.when !== undefined).length;
    packs.push({
      ids: pack.ids,
      coverage: Number(queryCoverage(row.question, pack.items[0]?.statement ?? '').toFixed(3)),
    });
    injectedByPosition.set(position, injectedText(pack));
    if (repairPacks.get(position) !== undefined) {
      injectedRepairByPosition.set(position, injectedText(repairPacks.get(position) as Pack));
    }
    if (proceduralPacks.get(position) !== undefined) {
      injectedProceduralByPosition.set(position, injectedText(proceduralPacks.get(position) as Pack));
    }
    call(position, 'none', '', 0);
    if (ARMS.has('none-replica')) {
      // The same prompt, byte for byte. Whatever this arm reports is what the endpoint does to
      // an unchanged question, and it is the floor every other number has to clear.
      call(position, 'none-replica', '', 0);
    }
    call(position, 'full', pack.rendered, pack.ids.length);
    if (probe !== undefined) {
      // Measured whenever the probe ran, injected only when the arm asks for it. The gate's question
      // is whether the admission rule changed a held-out pack, and a run that bought the probe for
      // the transfer measurement used to answer "0 of 350" — which reads as "the gate admitted
      // nothing", the one reading the pre-registration says would invalidate the run.
      const kept = new Set(probe.admission.kept);
      const surviving = pack.items.filter((item) => kept.has(item.id));
      const gatedPack = makePack(surviving, { budget: pack.budget });
      verifiedSizes.push({ all: pack.items.length, kept: surviving.length });
      if (gatedPack.ids.join('\u0000') !== pack.ids.join('\u0000')) verifiedDiffers += 1;
      if (ARMS.has('full-verified')) {
        // The same retrieval, the same order, the same budget, and only the rules that reproduced
        // their own correction. A question whose every rule failed the gate therefore sees an empty
        // pack, which is `none` for that question - counted in `verifiedSizes` rather than hidden.
        call(position, 'full-verified', gatedPack.rendered, gatedPack.ids.length);
      }
    }
    if (probeRepair !== undefined) {
      // Measured whenever the probe ran, for the reason the rule side gives above: the second
      // substrate's gate is a fact about the store whether or not an arm reads it.
      const keptRepair = new Set(probeRepair.admission.kept);
      const repairPack = repairPacks.get(position);
      const surviving = (repairPack?.items ?? []).filter((item) => keptRepair.has(item.id));
      const gatedRepair = makePack(surviving, { budget: pack.budget });
      repairVerifiedSizes.push({ all: repairPack?.items.length ?? 0, kept: surviving.length });
      if (gatedRepair.ids.join('\u0000') !== (repairPack?.ids.join('\u0000') ?? '')) {
        repairVerifiedDiffers += 1;
      }
      if (ARMS.has('full-repair-verified')) {
        // The repair store under its own gate: same retrieval, same order, same budget, and only the
        // accounts that reproduced their own correction. A question whose every account failed the
        // gate sees an empty pack, which is `none` for that question and counted rather than hidden.
        call(position, 'full-repair-verified', gatedRepair.rendered, gatedRepair.ids.length);
      }
    }
    if (ARMS.has('full-repair-transferred') && probeRepair?.transfer != null) {
      // The repair store's own intersection: an account that reproduced its own case and repaired a
      // different one. Nothing has ever measured this, because nothing had a repair store under the
      // probe; its pack size is the finding if it is small.
      const movingRepair = new Set(probeRepair.transfer.rules);
      const repairPack = repairPacks.get(position);
      const surviving = (repairPack?.items ?? []).filter((item) => movingRepair.has(item.id));
      const movedPack = makePack(surviving, { budget: pack.budget });
      repairTransferredSizes.push({ all: repairPack?.items.length ?? 0, kept: surviving.length });
      if (movedPack.ids.join('\u0000') !== (repairPack?.ids.join('\u0000') ?? '')) {
        repairTransferredDiffers += 1;
      }
      call(position, 'full-repair-transferred', movedPack.rendered, movedPack.ids.length);
    }
    if (ARMS.has('full-transferred') && probe?.transfer != null) {
      // The intersection of two gates: the rule reproduced its own correction, and it repaired a
      // different question. What is left is the only content this project has ever shown to be
      // knowledge rather than a demonstration, and its pack size is the finding if it is small.
      const transferring = new Set(probe.transfer.rules);
      const surviving = pack.items.filter((item) => transferring.has(item.id));
      const transferredPack = makePack(surviving, { budget: pack.budget });
      transferSizes.push({ all: pack.items.length, kept: surviving.length });
      if (transferredPack.ids.join('\u0000') !== pack.ids.join('\u0000')) transferDiffers += 1;
      call(position, 'full-transferred', transferredPack.rendered, transferredPack.ids.length);
    }
    if (ARMS.has('full-shuffled')) {
      // Another question's pack from the same database, matched on item count. Same vocabulary,
      // same size, different content: the one comparison that separates "the retrieved case is
      // what misleads" from "advice about this workspace is what misleads".
      const donorPosition = shuffledSource(packLibrary, {
        position,
        db: row.db_id,
        items: pack.items.length,
      });
      const donor = donorPosition === undefined ? undefined : rawPacks.get(donorPosition);
      if (donor !== undefined) {
        shuffledDonors += 1;
        if (donor.ids.join('\u0000') === pack.ids.join('\u0000')) shuffledIdentical += 1;
      }
      const swapped = makePack(donor === undefined ? [] : donor.items, { budget: pack.budget });
      call(position, 'full-shuffled', swapped.rendered, swapped.ids.length);
    }
    if (ARMS.has('full-validated')) {
      // Read again, after the deletion: this is the only arm that sees the pruned store.
      const pruned = await widened.host.recall({ ...query, scope: { domain: row.db_id } });
      validatedPositions += 1;
      // Counted rather than assumed. A retirement that removed rules no held-out question
      // would have recalled leaves this arm identical to `full` on every scored question,
      // and its delta is then the difference between two names for one condition. The
      // count is what turns that from an inference into a reading.
      if (pruned.ids.join('\u0000') !== pack.ids.join('\u0000')) validatedPackDiffers += 1;
      call(position, 'full-validated', pruned.rendered, pruned.ids.length);
    }
    if (ARMS.has('full-cleared') || ARMS.has('full-cleared-sampled')) {
      // Both packs are built whether or not both are scored, because the control is what makes the
      // other arm readable and a control that only exists when someone asks for it is a control that
      // gets forgotten. Building it costs two set differences and a render; the calls are the
      // expensive part and they are the part that is gated.
      //
      // The count removed is computed before the character budget, and the count *carried* is read
      // after it: `makePack` admits whole items until the budget is spent, so two packs with the
      // same number of survivors can still render a different number of items when the survivors
      // differ in length. That is the one way this pair stops being dose-matched without anyone
      // noticing, and it is why the counts recorded here are post-budget.
      const droppedItems = pack.items.filter((item) => clearedIds.has(item.id));
      const clearedPack = makePack(
        pack.items.filter((item) => !clearedIds.has(item.id)),
        { budget: pack.budget },
      );
      const controlDrop = doseMatchedDrop(pack.items, droppedItems.length, mulberry32(SEED + position));
      const controlPack = makePack(
        pack.items.filter((item) => !controlDrop.has(item.id)),
        { budget: pack.budget },
      );
      clearance.push({
        position,
        dropped: droppedItems.length,
        cleared: clearedPack.ids.length,
        control: controlPack.ids.length,
        identical: clearedPack.ids.join('\u0000') === controlPack.ids.join('\u0000'),
      });
      if (ARMS.has('full-cleared')) {
        call(position, 'full-cleared', clearedPack.rendered, clearedPack.ids.length);
      }
      if (ARMS.has('full-cleared-sampled')) {
        call(position, 'full-cleared-sampled', controlPack.rendered, controlPack.ids.length);
      }
    }
    if (ARMS.has('full-raw') || ARMS.has('full-raw-shuffled')) {
      // The event behind each recalled item, in the order the recall ranked the items: the store is
      // still what finds the correction, and the arm changes only what is shown of it. An item whose
      // evidence names no learned question is skipped rather than rendered empty, and the skip is
      // counted by the renderer's `skipped` for the budget and by `rawEvents` for the join.
      const own: RawEvent[] = [];
      for (const item of pack.items) {
        for (const ref of item.evidence) {
          const event = ref.taskId === undefined ? undefined : rawByTask.get(ref.taskId);
          if (event !== undefined) {
            own.push(event);
            break;
          }
        }
      }
      rawEvents += own.length;
      const rendered = renderRawPack(own, pack.budget);
      rawSkipped += rendered.skipped;
      const counted = rawEventVerbatim(rendered.rendered, own);
      rawCells += counted.cells;
      rawVerbatim += counted.verbatim;
      rawSample ??= counted.sample;
      if (ARMS.has('full-raw')) {
        call(position, 'full-raw', rendered.rendered, rendered.ids.length);
      }
      if (ARMS.has('full-raw-shuffled')) {
        // Other questions on this database, the same number of events: the form and the vocabulary
        // held, the subject changed. Drawn from a deterministic offset into the fold's own corpus
        // order so two runs of the same fold inject the same events.
        const pool = rawByDb.get(row.db_id) ?? [];
        const taken: RawEvent[] = [];
        const seen = new Set<string>();
        for (let step = 0; step < pool.length && taken.length < rendered.ids.length; step += 1) {
          const event = pool[(position + step) % pool.length];
          if (event === undefined || seen.has(event.taskId)) continue;
          seen.add(event.taskId);
          taken.push(event);
        }
        const foreign = renderRawPack(taken, pack.budget);
        call(position, 'full-raw-shuffled', foreign.rendered, foreign.ids.length);
      }
    }
    if (ARMS.has('full-narrow')) {
      // The same store, distilled without widening. `narrowed` is undefined when
      // the run itself is unwidened, in which case the two arms are identical and
      // the artefact says so rather than pretending they differ.
      const memory = narrowed ?? widened;
      const narrowPack = await memory.host.recall({ ...query, scope: { domain: row.db_id } });
      call(position, 'full-narrow', narrowPack.rendered, narrowPack.ids.length);
    }
    if (ARMS.has('full-plain')) {
      // The same items, rendered without the condition and with the plain note.
      // `pack.items` is what survived the budget, so the two arms carry the same
      // ids by construction - the comparison is the rendering, not the retrieval.
      const plain = makePack(pack.items, { budget: pack.budget, conditions: false });
      call(position, 'full-plain', plain.rendered, plain.ids.length);
    }
    if (ARMS.has('full-advisory')) {
      // The pack exactly as `full` renders it, plus one sentence. Nothing is re-retrieved, nothing
      // is re-cut: if this cell moves, the sentence moved it.
      call(position, 'full-advisory', pack.rendered, pack.ids.length);
    }
    if (ARMS.has('none-advisory')) {
      // The same sentence, no pack. This is what makes a recovery attributable, and it is loaded
      // where it is because the difference between the two advisory cells has to be the pack.
      call(position, 'none-advisory', '', 0);
    }
    if (ARMS.has('full-prohibitive')) {
      // The same items under the error heading. The pack layer is not asked for anything new, so the
      // comparison with `full` is one string of framing rather than a different retrieval.
      call(position, 'full-prohibitive', pack.rendered, pack.ids.length);
    }
    if (ARMS.has('full-corroborated')) {
      // The same recall with the pack layer's corroboration floor - the product path,
      // not a filter applied in the lane: a rule with one observation is a hypothesis,
      // and the arm asks whether treating it as one is what the pack has been missing.
      const corroborated = await widened.host.recall({
        ...query,
        scope: { domain: row.db_id },
        minEvidence: CORROBORATION,
      });
      call(position, 'full-corroborated', corroborated.rendered, corroborated.ids.length);
    }
    if (ARMS.has('critique')) {
      // The same pack as `full`; the only difference is that the prompt requires a
      // decision about each item before the query. Cached like every other arm, so the
      // cost is one prompt per question rather than a second protocol.
      call(position, 'critique', pack.rendered, pack.ids.length, true);
    }
    if (ARMS.has('gated')) {
      const gated = await widened.host.recall({
        ...query,
        scope: { domain: row.db_id },
        minCoverage: MIN_COVERAGE,
      });
      call(position, 'gated', gated.rendered, gated.ids.length);
    }
    if (ARMS.has('duplicate')) {
      const twice = pack.rendered === '' ? '' : `${pack.rendered}\n${pack.rendered}`;
      call(position, 'duplicate', twice, pack.ids.length);
    }
    if (ARMS.has('wrong-scope')) {
      const wrong = await widened.host.recall({ ...query, scope: { domain: nextDatabase(row.db_id) } });
      call(position, 'wrong-scope', wrong.rendered, wrong.ids.length);
    }
    if (RETRY_ARMS.some((arm) => ARMS.has(arm))) {
      // Nothing is planned here: the retry needs the first answer's execution result, so its
      // prompt cannot be built until that answer exists.
      retries.set(position, { rule: pack, repair: repairPacks.get(position) });
    }
    for (const chars of CHARS_ARMS) {
      if (!ARMS.has(`chars-${chars}`)) continue;
      // The same store and the same retrieval, with one number changed: the character budget the
      // pack layer enforces. `full` is the 1,200-character point of the same curve.
      const cut = await widened.host.recall({ ...query, scope: { domain: row.db_id }, budget: chars });
      call(position, `chars-${chars}`, cut.rendered, cut.ids.length);
    }
    if (ARMS.has('full-asked')) {
      // Only rules that name something the question names. A pack of unrelated rules is not a
      // smaller treatment, it is a different one: the audit showed it does nothing at all.
      const asked = new Set(row.question.toLowerCase().match(/[a-z_][a-z_0-9]*/g) ?? []);
      const kept = pack.items.filter((item) => mentionsAny(`${item.statement} ${item.when ?? ''}`, asked));
      const askPack = makePack(kept, { budget: pack.budget });
      call(position, 'full-asked', askPack.rendered, askPack.ids.length);
    }
    if (ARMS.has('chars-proc-600') && procedural !== undefined) {
      const cut = await procedural.host.recall({ ...query, scope: { domain: row.db_id }, budget: 600 });
      call(position, 'chars-proc-600', cut.rendered, cut.ids.length);
    }
    if (ARMS.has('full-procedural')) {
      const procedurePack = proceduralPacks.get(position);
      if (procedurePack !== undefined) {
        call(position, 'full-procedural', procedurePack.rendered, procedurePack.ids.length);
      }
    }
    if (ARMS.has('full-repair')) {
      // The repair pack in the first prompt: same timing as `full`, one thing different.
      const repairPack = repairPacks.get(position);
      if (repairPack !== undefined) {
        call(position, 'full-repair', repairPack.rendered, repairPack.ids.length);
      }
    }
    if (ARMS.has('full-grounded')) {
      // Checkable rules only. The filter reads the schema of this database, not the question,
      // so it cannot leak the answer into the pack.
      const grounded = groundedItems(pack.items, schemaIndex(dataset.dbPath(row.db_id)));
      const kept = makePack(grounded, { budget: pack.budget });
      groundedSizes.push({ all: pack.items.length, grounded: grounded.length });
      call(position, 'full-grounded', kept.rendered, kept.ids.length);
    }
    if (ARMS.has('full-sampled')) {
      // Same size as the grounded pack, chosen from the same ids, so the two arms differ in
      // which rules a reader can check rather than in how many rules there are.
      const size = groundedItems(pack.items, schemaIndex(dataset.dbPath(row.db_id))).length;
      const order = [...pack.items];
      const random = mulberry32(SEED + position);
      for (let at = order.length - 1; at > 0; at -= 1) {
        const swap = Math.floor(random() * (at + 1));
        const held = order[at] as (typeof order)[number];
        order[at] = order[swap] as (typeof order)[number];
        order[swap] = held;
      }
      const sampled = makePack(order.slice(0, size), { budget: pack.budget });
      call(position, 'full-sampled', sampled.rendered, sampled.ids.length);
    }
    if (ARMS.has('full-late')) {
      // Same pack, same text, one thing changed: it now follows the question.
      call(position, 'full-late', pack.rendered, pack.ids.length, false, 'after');
    }
    if (ANCHORED.length > 0) {
      // The revisions are planned after the first round, because their prompts contain the
      // model's own draft. The pack is remembered here and used then.
      anchored.set(position, pack);
    }
    if (ARMS.has('linked')) {
      const linked = linkSchema(
        schemaSql(dataset.dbPath(row.db_id)),
        row.question,
        row.evidence,
      );
      linkReasons[linked.reason] = (linkReasons[linked.reason] ?? 0) + 1;
      linkDropped += linked.dropped;
      linkTotal += linked.total;
      linkKept.set(position, {
        kept: linked.kept.length,
        total: linked.total,
        pruned: linked.reason === 'linked',
      });
      call(position, 'linked', '', 0, false, 'before', linked.ddl);
    }
    if (ARMS.has('values')) {
      // The same question, the same pack position, one input changed: the schema now says what the
      // columns hold. Compared against `none`, which is the same prompt without the annotation.
      call(position, 'values', '', 0, false, 'before', valuesDdl(dataset.dbPath(row.db_id)).ddl);
    }
    if (ARMS.has('gen-plan')) {
      // The same question, the same schema, a different procedure. R7.1's claim is that the pool is
      // the constraint, and a generator that produces different candidates is the only thing that
      // can test it — the selector arms all read one prompt's draws.
      call(position, 'gen-plan', '', 0, false, 'before', undefined, 'plan');
    }
    if (ARMS.has('gen-decompose')) {
      call(position, 'gen-decompose', '', 0, false, 'before', undefined, 'decompose');
    }
    if (ARMS.has('m-schema')) {
      // The same facts, written where a reader of tables expects them. One input changed against
      // `none`; the arm exists because a competitor's ablation prices the placement at +1.63 on
      // this exact model and split, and a published cell is worth reproducing before it is argued
      // with.
      call(
        position,
        'm-schema',
        '',
        0,
        false,
        'before',
        mschemaDdl(dataset.dbPath(row.db_id), row.db_id).ddl,
      );
    }
    if (ARMS.has('stated')) call(position, 'stated', '', 0);
    if (ARMS.has('oracle')) {
      // Under the convention the oracle is the expected value, not the gold SQL:
      // the question is whether a single stated fact changes the answer form.
      // The oracle states the answer *and* says to return it verbatim. The earlier
      // wording ("the answer this workspace accepts is X") left the model free to
      // write a query that computes the raw value instead, and it did: 144 of 145
      // questions came back as queries, the arm scored 0.69%, and the channel gate
      // failed for a reason that was a prompt defect rather than a finding.
      // Under a convention the oracle is the *rewritten* query, not the value.
      // The value form was tried: "return exactly this value ... as a single numeric
      // literal" moved accuracy 0.69% -> 48.97%, because half the replies were
      // queries rather than the literal. A hint the model can copy - the same query
      // it would have written, reported the workspace's way - is the only form that
      // measures knowledge rather than output format.
      const hint = task.convention ? `- ${reportedSql(row.SQL, ACTIVE)}` : `- ${row.SQL}`;
      call(position, 'oracle', hint, 0);
    }
  }

  let completed = 0;
  const replies = await mapPool(plans, CONCURRENCY, async (plan) => {
    let reply: Reply | undefined;
    try {
      reply = await chat(plan.prompt);
    } catch (error) {
      // Three failures are not data: a spent budget, a provider that has stopped answering, and an
      // elapsed deadline all mean the remaining replies would describe the run rather than the
      // rules.
      if (stoppedRun(error)) throw error;
      reply = undefined;
    }
    completed += 1;
    // Progress every twenty calls: a silent step is indistinguishable from a hung
    // one, which is how a ten-hour run went unnoticed.
    if (completed % 20 === 0 || completed === plans.length) {
      process.stdout.write(
        `[sota] fold ${fold + 1}/${FOLDS} eval ${completed}/${plans.length} ` +
          `calls=${llm.stats.calls} retries=${llm.stats.retries} failed=${llm.stats.failures}\n`,
      );
    }
    return reply;
  });

  // The retry arms' only round with a pack, and it happens only where the first answer did
  // not work: the query failed to execute, or it executed and returned nothing. Those are the
  // two signals a deployment has without the answer key, and they are also the two the
  // literature's correction loops act on.
  //
  // The three arms are issued from one pass because the eligible set is part of the design
  // rather than a consequence of the treatment: `retry-blank` retries exactly the questions
  // the memoried arms retry, so the comparison is one population under two treatments. A
  // retry decided per arm would let a difference in which questions failed masquerade as a
  // difference in what the retry was given.
  const retryReplies = new Map<
    string,
    { position: number; arm: RetryArm; reply: Reply | undefined; packIds: number; packChars: number }
  >();
  /** Questions whose first answer failed: the population the retry arms are measured on. */
  const retriedPositions = new Set<number>();
  const retryArmsThisRun = RETRY_ARMS.filter((arm) => ARMS.has(arm));
  if (retryArmsThisRun.length > 0) {
    const index = new Map(plans.map((plan, at) => [`${plan.position}:${plan.arm}`, at]));
    const batch: { position: number; arm: RetryArm; prompt: string; packIds: number; packChars: number }[] = [];
    for (const [position, packsHere] of retries) {
      const at = index.get(`${position}:none`);
      const reply = at === undefined ? undefined : replies[at];
      if (reply === undefined) {
        notRetried += 1;
        continue;
      }
      const row = evalRows[position] as BirdRow;
      const dbPath = dataset.dbPath(row.db_id);
      const failure = failureOf(dbPath, extractSql(reply.text));
      if (failure === undefined) {
        notRetried += 1;
        continue;
      }
      retried += 1;
      retriedPositions.add(position);
      let keyedText = '';
      let keyedIds = 0;
      if (retryArmsThisRun.includes('retry-keyed') && procedural !== undefined) {
        const code = failureKind(failure);
        observedCodes[code] = (observedCodes[code] ?? 0) + 1;
        const keyed = await procedural.host.recall({
          task: TASK,
          text: row.question,
          scope: { domain: row.db_id, reasonCode: code },
        });
        keyedText = keyed.rendered;
        keyedIds = keyed.ids.length;
        keyedTried += 1;
        if (keyedIds > 0) keyedHits += 1;
      }
      for (const arm of retryArmsThisRun) {
        const repair = arm === 'full-repair-onretry';
        const keyed = arm === 'retry-keyed';
        const pack =
          arm === 'retry-blank'
            ? ''
            : keyed
              ? keyedText
              : (repair ? packsHere.repair?.rendered : packsHere.rule.rendered) ?? '';
        const packIds =
          arm === 'retry-blank'
            ? 0
            : keyed
              ? keyedIds
              : (repair ? packsHere.repair?.ids.length : packsHere.rule.ids.length) ?? 0;
        batch.push({
          position,
          arm,
          packIds,
          packChars: pack.length,
          prompt: retryPromptFor({
            question: row.question,
            evidence: row.evidence,
            ddl: schemaSql(dataset.dbPath(row.db_id)),
            attempt: reply.text,
            failure,
            pack,
            ...(repair ? { packKind: 'repair' as const } : {}),
          }),
        });
      }
    }
    const fixed = await mapPool(batch, CONCURRENCY, async (item) => {
      try {
        return { ...item, reply: await chat(item.prompt) };
      } catch (error) {
        if (error instanceof MicrogliaError && error.code === 'MG_E_BUDGET_EXCEEDED') throw error;
        if (error instanceof MicrogliaError && error.code === 'MG_E_PROVIDER_FAILED') throw error;
        return { ...item, reply: undefined };
      }
    });
    for (const entry of fixed) {
      retryReplies.set(`${entry.position}:${entry.arm}`, {
        position: entry.position,
        arm: entry.arm,
        reply: entry.reply,
        packIds: entry.packIds,
        packChars: entry.packChars,
      });
    }
  }

  // The anchored arm's second round. It is a separate phase because its prompt contains the
  // first round's answer, and because a draft that never arrived leaves nothing to revise —
  // that question is counted as unanswered by this arm rather than silently scored as wrong.
  if (ANCHORED.length > 0) {
    const index = new Map(plans.map((plan, at) => [`${plan.position}:${plan.arm}`, at]));
    const batch: { position: number; arm: ArmName; prompt: string; packIds: number; packChars: number }[] = [];
    let unanswered = 0;
    for (const [position, pack] of anchored) {
      const at = index.get(`${position}:none`);
      const draft = at === undefined ? undefined : replies[at];
      if (draft === undefined) {
        unanswered += 1;
        continue;
      }
      const row = evalRows[position] as BirdRow;
      for (const anchoredArm of ANCHORED) {
        // The blank control shows the draft and nothing else. `anchorPromptFor` renders the empty
        // pack as no block *and* no instruction about one, which is the question this arm asks:
        // what is a second pass worth on its own?
        const shown = anchoredArm.injects ? pack : undefined;
        batch.push({
          position,
          arm: anchoredArm.arm,
          prompt: anchorPromptFor(
            {
              question: row.question,
              evidence: row.evidence,
              ddl: schemaSql(dataset.dbPath(row.db_id)),
              draft: draft.text,
              pack: shown?.rendered ?? '',
            },
            anchoredArm.mode,
          ),
          packIds: shown?.ids.length ?? 0,
          packChars: shown?.rendered.length ?? 0,
        });
      }
    }
    // Counted per question, not per call: a question is unanswered by every anchored arm
    // when the draft is missing, and reporting it once per arm would triple the number.
    anchoredSkipped = unanswered;
    const revised = await mapPool(batch, CONCURRENCY, async (item) => {
      try {
        return { item, reply: await chat(item.prompt) };
      } catch (error) {
        if (error instanceof MicrogliaError && error.code === 'MG_E_BUDGET_EXCEEDED') throw error;
        if (error instanceof MicrogliaError && error.code === 'MG_E_PROVIDER_FAILED') throw error;
        return { item, reply: undefined };
      }
    });
    for (const entry of revised) {
      anchoredReplies.set(`${entry.item.position}:${entry.item.arm}`, {
        position: entry.item.position,
        arm: entry.item.arm,
        reply: entry.reply,
        packIds: entry.item.packIds,
        packChars: entry.item.packChars,
      });
    }
  }

  // The sampling arms' draws. One pass of N per question at a non-zero temperature, from the
  // no-memory prompt, with three arms reading from it: two selectors and a first-draw control.
  //
  // The pass is shared because the arms must differ in *one* thing. Drawing separately per arm
  // would give each its own noise, and the whole question being asked is whether choosing among
  // draws beats not choosing — which needs the same draws on both sides.
  const samplingArmsThisRun = (OPTIONAL_ARMS as readonly ArmName[]).filter((arm) => {
    const selector = samplingSpecOf(arm)?.selector ?? 'oracle';
    // `prior` is excluded here and dispatched after every fold is known, because it is the one
    // selector that cannot run inside the fold that scores it.
    return selector !== 'oracle' && selector !== 'prior' && ARMS.has(arm);
  });
  /**
   * The memory prior, when it was asked for.
   *
   * It reads the pool and decides nothing at draw time: the lookups are built from the other folds,
   * and the other folds do not exist until the run is nearly over. So it is not a sampling arm, it
   * is the reason to take draws at all — and it is split out here rather than handled inside the
   * selection loop because a selector that ranked candidates using outcomes from questions it has
   * already scored would be reading the fold it is about to be measured on.
   */
  const priorArm = (OPTIONAL_ARMS as readonly ArmName[]).find(
    (arm) =>
      priorScopeOf(samplingSpecOf(arm)?.selector ?? 'majority') !== undefined && ARMS.has(arm),
  );
  const priorRequested = priorArm !== undefined;
  /**
   * The ceiling arm the caller asked for, if any.
   *
   * Named for the number of draws it reads so a run cannot claim a ceiling it did not measure: a
   * three-draw run asking for `sample-5-oracle` would be reporting the best of three under a name
   * that says five.
   */
  const ceilingArm = (OPTIONAL_ARMS as readonly ArmName[]).find(
    (arm) => samplingSpecOf(arm)?.selector === 'oracle' && ARMS.has(arm),
  );
  /**
   * What the best selector could possibly have scored.
   *
   * CHASE-SQL's Table 1 is the reason this exists: single query 63.01, self-consistency 68.84,
   * upper bound 82.79. Fourteen points sit between what the model can produce and what a selector
   * retrieves, which is why "the candidates are there and the choice is wrong" is a different claim
   * from "the candidates are not there". This arm is not deployable — it reads the answer key — and
   * its only purpose is to say which of the two a run is in.
   *
   * It costs nothing: every draw is judged anyway so the chosen one can be scored.
   */
  const wantsCeiling = ceilingArm !== undefined;
  const sampleReplies = new Map<string, Reply | undefined>();
  const drawJudged = new Map<number, Judged[]>();
  /**
   * How the draws for one question differed, and how many of them were right.
   *
   * Kept per question rather than only as a histogram because the two facts have to be joined: a
   * question with five distinct wrong answers is a generation failure, one with five distinct
   * answers of which one is right is a selection failure, and one with five identical wrong answers
   * is neither — it is the model being confidently wrong, which no amount of sampling fixes.
   */
  const drawFacts = new Map<number, { readonly distinct: number; readonly correct: number }>();
  /**
   * The pool as the measurement needs it, kept per question so the artefact carries the candidates
   * rather than only their summary.
   *
   * Iteration 99's whole point: with the candidates in the artefact, every question about them —
   * how many distinct answers the draws contained, whether a signal could have ordered them, what
   * share of the ceiling a deterministic rule captures — is a computation over a file, not a
   * dispatch. The sampling run pays for the draws once; the analysis costs nothing.
   */
  const poolByPositionRecord = new Map<number, PoolQuestion>();
  const chosenJudged = new Map<string, { readonly position: number; readonly arm: ArmName; readonly verdict: Judged }>();
  const selectionByArm = new Map<ArmName, Selection[]>();
  /**
   * How often each selector arm was asked, and how often it named nothing.
   *
   * Fold-scoped because the artefact reports it per fold: a selector that answered every question
   * in four folds and none in the fifth is a run whose fifth fold measured `sample-N-first`.
   */
  const choiceAccounting = new Map<
    number,
    Readonly<Record<string, { readonly asked: number; readonly unparsed: number }>>
  >();
  const correctDraws = new Array<number>(0).fill(0);
  let samplingDraws = 0;
  if (samplingArmsThisRun.length > 0 || wantsCeiling || priorRequested) {
    const index = new Map(plans.map((plan, at) => [`${plan.position}:${plan.arm}`, at]));
    const batch: { position: number; draw: number; prompt: string }[] = [];
    samplingDraws = Math.max(
      2,
      ...samplingArmsThisRun.map((arm) => samplingSpecOf(arm)?.n ?? 1),
      ceilingArm === undefined ? 1 : (samplingSpecOf(ceilingArm)?.n ?? 1),
      // The prior's name carries its draw count like every other sampling arm, so a five-draw prior
      // asked for on its own still pays for five draws rather than silently reading one.
      priorArm === undefined ? 1 : (samplingSpecOf(priorArm)?.n ?? 1),
    );
    for (const position of evalRows.keys()) {
      const at = index.get(`${position}:none`);
      const wording = at === undefined ? undefined : plans[at]?.prompt;
      // A question with no baseline prompt has nothing to redraw. Counting it as an unanswered
      // draw would be a different experiment; skipping it keeps the arms on one population.
      if (wording === undefined) continue;
      for (let draw = 0; draw < samplingDraws; draw += 1) {
        batch.push({ position, draw, prompt: wording });
      }
    }
    process.stdout.write(
      `[sota] fold ${fold + 1}/${FOLDS} sampling ${batch.length} draws ` +
        `(${samplingDraws} per question, temperature ${SAMPLE_TEMPERATURE})\n`,
    );
    let sampled = 0;
    const drawn = await mapPool(batch, CONCURRENCY, async (item) => {
      try {
        const reply = await chat(item.prompt, 700, SAMPLE_TEMPERATURE);
        return { item, reply };
      } catch (error) {
        if (error instanceof MicrogliaError && error.code === 'MG_E_BUDGET_EXCEEDED') throw error;
        if (error instanceof MicrogliaError && error.code === 'MG_E_PROVIDER_FAILED') throw error;
        return { item, reply: undefined };
      } finally {
        sampled += 1;
        // A phase with no output is indistinguishable from a hung one: this is the print whose
        // absence turned a stuck run into an eighty-eight-minute silence.
        if (sampled % 25 === 0 || sampled === batch.length) {
          process.stdout.write(
            `[sota] fold ${fold + 1}/${FOLDS} draws ${sampled}/${batch.length} ` +
              `calls=${llm.stats.calls} failed=${llm.stats.failures}\n`,
          );
        }
      }
    });
    for (const entry of drawn) {
      sampleReplies.set(`${entry.item.position}:${entry.item.draw}`, entry.reply);
    }

    let scored = 0;
    /**
     * The draws, executed and judged once, so every selector reads the same candidates.
     *
     * Held across the passes below because the model selector is a call and the others are not:
     * running them in one pass would either serialise those calls or execute every draw twice.
     */
    const poolByPosition = new Map<
      number,
      {
        readonly candidates: Candidate[];
        readonly verdicts: Judged[];
        readonly queries: string[];
        readonly results: string[];
      }
    >();
    for (const position of evalRows.keys()) {
      const row = evalRows[position] as BirdRow;
      const dbPath = dataset.dbPath(row.db_id);
      const candidates: Candidate[] = [];
      const verdicts: Judged[] = [];
      const queries: string[] = [];
      const results: string[] = [];
      // The pool the measurement reads, built from the same executions as the selectors' candidates
      // rather than from a second pass over them: a second execution is a second answer, and two
      // readings of one pool that disagree are worse than one reading.
      const keyOf = new Map<string, number>();
      const shapes: (ExecSignature | null)[] = [];
      const keys: number[] = [];
      scored += 1;
      if (scored % 10 === 0 || scored === evalRows.length) {
        process.stdout.write(
          `[sota] fold ${fold + 1}/${FOLDS} scoring draws ${scored}/${evalRows.length}\n`,
        );
      }
      for (let draw = 0; draw < samplingDraws; draw += 1) {
        const reply = sampleReplies.get(`${position}:${draw}`);
        const sql = reply === undefined ? undefined : extractSql(reply.text);
        // Executed once per draw and read by every arm: the selector's input is the result, and a
        // selector that executed its own copy would be measuring a different set of candidates.
        const outcome = sql === undefined ? undefined : executeQuery(dbPath, sql);
        candidates.push({
          signature: outcome === undefined ? undefined : signatureOf(outcome),
          rows: outcome === undefined ? 0 : outcome.tuples.length,
        });
        // The raw query, because the model selector reads text and cannot group rows. A draw that
        // produced no SQL is carried as the empty string: dropping it would shift every later
        // index and make the model's answer point at a different query than it read.
        queries.push(sql ?? '');
        // What the selector that reads rows is shown. Rendered here, once per draw, because the
        // execution result is the candidate's own output and re-running it later would be a second
        // execution of the same query with a different answer.
        results.push(renderRows(outcome === undefined ? false : outcome.ok, outcome?.tuples ?? []));
        // Every draw is scored, not only the chosen one, because the ceiling is the score of a
        // selector that always picked right and cannot be computed after the fact.
        verdicts.push(judgeReply(row, dbPath, reply, task));
        // A draw with no query and a draw whose query did not run are both `null` here — neither
        // produced a result a selector could pick — but only the second has a shape, and the shape
        // is what says whether the failure looked like a wrong answer or like a refusal.
        if (outcome === undefined) {
          keys.push(-1);
          shapes.push(null);
        } else {
          const key = signatureOf(outcome);
          if (key === undefined) {
            keys.push(-1);
            shapes.push(execSignatureOf({ rows: [], columns: [], failed: true }));
          } else {
            const at = keyOf.get(key);
            if (at === undefined) {
              keyOf.set(key, keyOf.size);
              keys.push(keyOf.size - 1);
            } else {
              keys.push(at);
            }
            shapes.push(
              execSignatureOf({ rows: outcome.tuples, columns: outcome.columns, failed: false }),
            );
          }
        }
      }
      poolByPosition.set(position, { candidates, verdicts, queries, results });
      drawJudged.set(position, verdicts);
      poolByPositionRecord.set(position, {
        id: idOf(row),
        shape: shapeOf(row.question, row.evidence),
        // The two fields a memory prior is keyed on. Recorded here rather than reconstructed from
        // the fold summary, because a question's database is a property of the question and the
        // pool is the only per-question record the artefact keeps.
        dbId: row.db_id,
        fold,
        candidates: verdicts.map((verdict, draw) => ({
          draw,
          correct: verdict.correct,
          resultKey: keys[draw] ?? -1,
          signature: shapes[draw] ?? null,
        })),
      });
      const right = verdicts.filter((verdict) => verdict.correct).length;
      const distinct = new Set(
        candidates.map((item) => item.signature).filter((item) => item !== undefined),
      ).size;
      drawFacts.set(position, { distinct, correct: right });
      while (correctDraws.length <= right) correctDraws.push(0);
      correctDraws[right] = (correctDraws[right] ?? 0) + 1;
    }

    /**
     * Ask a model which candidate to keep, only where there is something to choose.
     *
     * The skip is the design, not an optimisation: three byte-identical queries are one candidate,
     * and a selector that spends a call agreeing with itself would report a cost with no decision
     * behind it. `modelAsked` therefore counts the questions where the choice was real, which is
     * the denominator every other number about this arm should be read against.
     */
    const choiceBatch: { position: number; arm: ArmName; prompt: string }[] = [];
    for (const position of evalRows.keys()) {
      const pool = poolByPosition.get(position);
      if (pool === undefined) continue;
      for (const arm of samplingArmsThisRun) {
        const spec = samplingSpecOf(arm);
        if (spec === undefined || (spec.selector !== 'model' && spec.selector !== 'exec')) continue;
        const slice = pool.candidates.slice(0, spec.n);
        const distinct = new Set(
          slice.map((item) => item.signature).filter((item) => item !== undefined),
        ).size;
        if (distinct < 2) continue;
        const at = index.get(`${position}:none`);
        const wording = at === undefined ? undefined : plans[at]?.prompt;
        if (wording === undefined) continue;
        choiceBatch.push({
          position,
          arm,
          prompt:
            spec.selector === 'exec'
              ? choicePromptWithResults(
                  wording,
                  pool.queries
                    .slice(0, spec.n)
                    .map((sql, index) => ({ sql, result: pool.results[index] ?? 'the query did not run' })),
                )
              : choicePrompt(wording, pool.queries.slice(0, spec.n)),
        });
      }
    }
    const choiceAtIndex = new Map<string, number | undefined>();
    if (choiceBatch.length > 0) {
      process.stdout.write(
        `[sota] fold ${fold + 1}/${FOLDS} asking a model to choose in ${choiceBatch.length} cases\n`,
      );
      let asked = 0;
      const answers = await mapPool(choiceBatch, CONCURRENCY, async (item) => {
        try {
          const reply = await chat(item.prompt, 200, 0);
          return { item, choice: parseChoice(reply.text, (samplingSpecOf(item.arm)?.n ?? 0)) };
        } catch (error) {
          if (error instanceof MicrogliaError && error.code === 'MG_E_BUDGET_EXCEEDED') throw error;
          if (error instanceof MicrogliaError && error.code === 'MG_E_PROVIDER_FAILED') throw error;
          return { item, choice: undefined };
        } finally {
          asked += 1;
          if (asked % 25 === 0 || asked === choiceBatch.length) {
            process.stdout.write(
              `[sota] fold ${fold + 1}/${FOLDS} choices ${asked}/${choiceBatch.length} ` +
                `calls=${llm.stats.calls} failed=${llm.stats.failures}\n`,
            );
          }
        }
      });
      const byArm: Record<string, { asked: number; unparsed: number }> = {};
      for (const entry of answers) {
        choiceAtIndex.set(`${entry.item.position}:${entry.item.arm}`, entry.choice);
        const account = byArm[entry.item.arm] ?? { asked: 0, unparsed: 0 };
        byArm[entry.item.arm] = {
          asked: account.asked + 1,
          unparsed: account.unparsed + (entry.choice === undefined ? 1 : 0),
        };
      }
      // Per arm, because the two selectors are asked different questions of the same draws and one
      // of them answering nothing is not evidence about the other.
      choiceAccounting.set(fold, byArm);
    }

    /**
     * The first `n` draws of a question, as the shape composite reads them.
     *
     * `selectByShape` ranks execution *signatures*, and the record written for the analysis is the
     * only place a signature survives — the `Candidate` slice the other selectors read carries a
     * result identity and a row count, which is enough to agree and not enough to judge a shape. The
     * record is written in the same iteration as `poolByPosition`, so a position with a pool always
     * has one; the cast states that once rather than branching on a case the loop already excludes.
     */
    const shapePoolOf = (position: number, n: number): PoolQuestion => {
      const recorded = poolByPositionRecord.get(position) as PoolQuestion;
      return { ...recorded, candidates: recorded.candidates.slice(0, n) };
    };

    for (const position of evalRows.keys()) {
      const pool = poolByPosition.get(position);
      if (pool === undefined) continue;
      // Every arm gets a verdict even when no draw arrived: the `none` baseline scores a failed
      // call as a wrong answer, and an arm that silently dropped the question would be measured on
      // a different, easier population than the one it is compared against.
      for (const arm of samplingArmsThisRun) {
        const spec = samplingSpecOf(arm);
        if (spec === undefined) continue;
        const slice = pool.candidates.slice(0, spec.n);
        const selection =
          spec.selector === 'shape'
            ? selectByShape(shapePoolOf(position, spec.n))
            : spec.selector === 'value'
              ? // The composite ablated to its one independent member, on the same draws. Two arms,
                // one cost: both read the executions the sampling pass already paid for.
                selectByShape(shapePoolOf(position, spec.n), VALUE_VOTERS)
              : spec.selector === 'random'
                ? selectRandom(slice, mulberry32(SEED + position))
                : spec.selector === 'first'
                  ? selectFirst(slice)
                  : spec.selector === 'model' || spec.selector === 'exec'
                    ? selectByModel(slice.length, choiceAtIndex.get(`${position}:${arm}`))
                    : selectByConsistency(slice);
        chosenJudged.set(`${position}:${arm}`, {
          position,
          arm,
          verdict: pool.verdicts[selection.chosen] ?? (pool.verdicts[0] as Judged),
        });
        const list = selectionByArm.get(arm);
        if (list === undefined) selectionByArm.set(arm, [selection]);
        else list.push(selection);
      }
    }
  }

  const judged = new Map<string, Judged>();
  for (const [index, plan] of plans.entries()) {
    const row = evalRows[plan.position] as BirdRow;
    const started = performance.now();
    const result = judgeReply(row, dataset.dbPath(row.db_id), replies[index], task);
    judged.set(`${plan.position}:${plan.arm}`, {
      ...result,
      latencyMs: Math.round(performance.now() - started),
    });
  }

  // The anchored arm's revisions are judged here rather than in the loop above, because they
  // did not exist when it ran. They are registered as plans with an empty prompt so the case
  // assembly below treats them like every other arm instead of special-casing one.
  for (const entry of anchoredReplies.values()) {
    const row = evalRows[entry.position] as BirdRow;
    const started = performance.now();
    const result = judgeReply(row, dataset.dbPath(row.db_id), entry.reply, task);
    judged.set(`${entry.position}:${entry.arm}`, {
      ...result,
      latencyMs: Math.round(performance.now() - started),
    });
    plans.push({
      position: entry.position,
      arm: entry.arm,
      prompt: '',
      packIds: entry.packIds,
      packChars: entry.packChars,
    });
  }

  // The sampling arms are registered here, after the selectors have run: the answer an arm claims
  // is the one its selector picked, and the other draws were scored only to size the ceiling.
  for (const entry of chosenJudged.values()) {
    judged.set(`${entry.position}:${entry.arm}`, entry.verdict);
    plans.push({
      position: entry.position,
      arm: entry.arm,
      prompt: '',
      packIds: 0,
      packChars: 0,
    });
  }
  if (ceilingArm !== undefined) {
    for (const [position, verdicts] of drawJudged) {
      const anyCorrect = verdicts.find((verdict) => verdict.correct) ?? verdicts[0];
      if (anyCorrect === undefined) continue;
      judged.set(`${position}:${ceilingArm}`, anyCorrect);
      plans.push({ position, arm: ceilingArm, prompt: '', packIds: 0, packChars: 0 });
    }
  }

  // A question that never needed a retry keeps its first answer under this arm's name: the
  // pack was not shown, so the answer it produced is the answer this arm is claiming.
  for (const entry of retryReplies.values()) {
    const row = evalRows[entry.position] as BirdRow;
    const started = performance.now();
    const result = judgeReply(row, dataset.dbPath(row.db_id), entry.reply, task);
    judged.set(`${entry.position}:${entry.arm}`, {
      ...result,
      latencyMs: Math.round(performance.now() - started),
    });
    plans.push({
      position: entry.position,
      arm: entry.arm,
      prompt: '',
      packIds: entry.packIds,
      packChars: entry.packChars,
    });
  }
  for (const arm of retryArmsThisRun) {
    for (const position of retries.keys()) {
      if (retryReplies.has(`${position}:${arm}`)) continue;
      const first = judged.get(`${position}:none`);
      if (first === undefined) continue;
      judged.set(`${position}:${arm}`, first);
      plans.push({ position, arm, prompt: '', packIds: 0, packChars: 0 });
    }
  }

  const packIdsOf = new Map(plans.map((plan) => [`${plan.position}:${plan.arm}`, plan.packIds]));
  const packCharsOf = new Map(plans.map((plan) => [`${plan.position}:${plan.arm}`, plan.packChars]));
  const cases: CaseOutcome[] = [];
  for (const [position, row] of evalRows.entries()) {
    const pick = (arm: ArmName): Judged =>
      judged.get(`${position}:${arm}`) ?? {
        sql: '',
        resultDigest: null,
        correct: false,
        shadowCorrect: false,
        parseOk: false,
        execOk: false,
        tokens: 0,
        latencyMs: 0,
      };
    const base = pick('none');
    const full = pick('full');
    const pack = packs[position] as PackInfo;

    const arms: Partial<Record<Exclude<ArmName, 'none' | 'full'>, boolean>> = {};
    const shadowArms: Partial<Record<Exclude<ArmName, 'none' | 'full'>, boolean>> = {};
    const armSql: Partial<Record<Exclude<ArmName, 'none' | 'full'>, string>> = {};
    const armPackIds: Partial<Record<Exclude<ArmName, 'none' | 'full'>, number>> = {};
    const armPackChars: Partial<Record<Exclude<ArmName, 'none' | 'full'>, number>> = {};
    // Keyed by arm name with the control included, because the pool a chooser chooses from contains
    // the control: a generator that reproduces the direct answer adds a call and no candidate.
    const armDigests: Record<string, string | null> = { none: base.resultDigest };
    for (const plan of plans) {
      if (plan.position !== position) continue;
      if (plan.arm === 'none' || plan.arm === 'full') continue;
      const result = pick(plan.arm);
      arms[plan.arm] = result.correct;
      shadowArms[plan.arm] = result.shadowCorrect;
      armSql[plan.arm] = result.sql;
      armDigests[plan.arm] = result.resultDigest;
      armPackIds[plan.arm] = plan.packIds;
      armPackChars[plan.arm] = plan.packChars;
    }

    cases.push({
      id: idOf(row),
      questionId: row.question_id,
      dbId: row.db_id,
      fold,
      difficulty: row.difficulty,
      question: row.question,
      evidence: row.evidence,
      goldSql: row.SQL,
      predictedSql: full.sql,
      baselineSql: base.sql,
      correct: full.correct,
      shadowCorrect: full.shadowCorrect,
      withoutMemoryCorrect: base.correct,
      shadowWithoutMemoryCorrect: base.shadowCorrect,
      parseOk: full.parseOk,
      execOk: full.execOk,
      retried: retriedPositions.has(position),
      draws: drawFacts.get(position) ?? null,
      // The candidates themselves, so every question about the pool is a computation over this
      // file rather than another dispatch.
      pool: poolByPositionRecord.get(position)?.candidates ?? null,
      schemaTables: linkKept.get(position) ?? null,
      injected: injectedByPosition.get(position) ?? [],
      injectedRepair: injectedRepairByPosition.get(position) ?? [],
      injectedProcedural: injectedProceduralByPosition.get(position) ?? [],
      packIds: packIdsOf.get(`${position}:full`) ?? 0,
      packChars: packCharsOf.get(`${position}:full`) ?? 0,
      coverage: pack.coverage,
      expected: task.expected.get(idOf(row)) ?? null,
      packIdList: pack.ids,
      tokens: full.tokens,
      latencyMs: full.latencyMs,
      arms,
      shadowArms,
      arm_result_digests: armDigests,
      armSql,
      armPackIds,
      armPackChars,
    });
  }

  const after = await knowledgeDigest(store);
  if (after.digest !== scoringFrozen.digest) {
    throw new MicrogliaError('MG_E_CONFIG', 'Evaluation mutated knowledge', {
      fold,
      before: scoringFrozen.digest,
      after: after.digest,
    });
  }
  // The second store is held to the same proof. It is only read after construction, so a
  // difference here would mean the repair arms were scored against a memory that changed
  // while they were being measured - the one failure this lane has already had once.
  if (procedural !== undefined) {
    const procedureAfter = await knowledgeDigest(procedural.store);
    if (procedureAfter.digest !== procedural.frozen.digest) {
      throw new MicrogliaError('MG_E_CONFIG', 'Evaluation mutated the procedural memory', {
        fold,
        before: procedural.frozen.digest,
        after: procedureAfter.digest,
      });
    }
  }
  if (repaired !== undefined) {
    const repairAfter = await knowledgeDigest(repaired.store);
    if (repairAfter.digest !== repaired.frozen.digest) {
      throw new MicrogliaError('MG_E_CONFIG', 'Evaluation mutated the repair memory', {
        fold,
        before: repaired.frozen.digest,
        after: repairAfter.digest,
      });
    }
  }
  const listed = await store.listKnowledge({ namespace: 'bird', status: 'all' });
  /**
   * Where the store's domain-free items came from.
   *
   * `scope.domain` is the one field the host knows and the model only echoes, and an item without
   * one is invisible to transfer — so the count is the ceiling on every transfer number this store
   * can produce. Two paths make one and they call for opposite fixes: the interpreter declined to
   * scope the claim at the door, or generalisation earned the widening. Recorded apart, because one
   * number with two causes is not a finding.
   */
  const domainOrigin = {
    storedWithDomain: listed.filter((item) => item.scope.domain !== undefined).length,
    storedWithoutDomain: listed.filter((item) => item.scope.domain === undefined).length,
    unscopedIn: distilled.incomingWithoutDomain,
    widenedIn: distilled.generalized,
  };
  const items = listed.map((item) => ({
    id: item.id,
    status: item.status,
    trust: Number(item.trust.toFixed(4)),
    statement: item.statement,
    when: item.when ?? null,
    evidence: item.evidence.length,
    domain: item.scope.domain ?? null,
  }));
  const repairItems: RepairItem[] =
    repaired === undefined
      ? []
      : (await repaired.store.listKnowledge({ namespace: 'bird', status: 'all' })).map((item) => ({
          id: item.id,
          status: item.status,
          statement: item.statement,
          when: item.when ?? null,
          payload: item.payload ?? null,
        }));
  if (procedural !== undefined) {
    for (const item of await procedural.store.listKnowledge({ namespace: 'bird', status: 'all' })) {
      const code = item.scope.reasonCode ?? 'none';
      storedCodes[code] = (storedCodes[code] ?? 0) + 1;
    }
  }
  await widened.host.close();
  if (narrowed !== undefined) await narrowed.host.close();
  if (repaired !== undefined) await repaired.host.close();
  if (procedural !== undefined) await procedural.host.close();

  // Written per fold: a run that dies at fold 4 keeps the distillations it paid for, and the
  // next dispatch replays them instead of buying them again.
  distillations.save();

  const packIds = cases.reduce((sum, item) => sum + item.packIds, 0);
  /**
   * V43's measurement: did each arm's prompt carry the framing that arm declares?
   *
   * Counted at the prompt rather than at the arm, because the failure mode is a table entry that
   * never matched — `full-advisory` would be `full` under a second name and "the sentence cost
   * nothing" would be a reading about a sentence that was never sent. Both directions are counted:
   * an arm that declares a framing and misses a prompt, and an arm that declares none and carries
   * one anyway.
   */
  const framingDelivery: readonly FramingDelivery[] = (() => {
    const counts = new Map<ArmName, { prompts: number; carrying: number }>();
    for (const plan of plans) {
      const declares = ARM_STANDING[plan.arm];
      const wanted =
        declares === 'advisory'
          ? ADVISORY_SENTENCE
          : declares === 'prohibitive'
            ? PROHIBITIVE_HEADING
            : undefined;
      const entry = counts.get(plan.arm) ?? { prompts: 0, carrying: 0 };
      entry.prompts += 1;
      const carries =
        wanted === undefined
          ? plan.prompt.includes(ADVISORY_SENTENCE) || plan.prompt.includes(PROHIBITIVE_HEADING)
          : plan.prompt.includes(wanted);
      if (carries) entry.carrying += 1;
      counts.set(plan.arm, entry);
    }
    return [...counts.entries()].map(([arm, entry]) => ({
      arm,
      prompts: entry.prompts,
      carrying: entry.carrying,
      expected: ARM_STANDING[arm] !== undefined,
    }));
  })();
  process.stdout.write(
    `[sota] fold ${fold + 1}/${FOLDS}: eval=${cases.length} learn=${learnRows.length} ` +
      `edited=${learning.edited} unanswered=${learning.unanswered} ` +
      `distillFailed=${distilled.failed} active=${scoringFrozen.active} ` +
      `calls=${llm.stats.calls} timeouts=${llm.stats.timeouts}\n`,
  );
  return {
    fold,
    learn: learnRows.length,
    eval: cases.length,
    cases,
    storeItems: listed,
    pool: [...poolByPositionRecord.values()],
    learning,
    activeRules: scoringFrozen.active,
    failedDistill: distilled.failed,
    created: distilled.created,
    meanPackIds: cases.length === 0 ? 0 : packIds / cases.length,
    injectedRules,
    injectedWithCondition,
    framing: framingDelivery,
    domainOrigin,
    raw: {
      cells: rawCells,
      verbatim: rawVerbatim,
      skipped: rawSkipped,
      events: rawEvents,
      ...(rawSample === undefined ? {} : { sample: rawSample }),
    },
    clearance,
    validatedPackDiffers,
    validatedPositions,
    anchoredSkipped,
    retried,
    notRetried,
    grounded: {
      all: groundedSizes.reduce((sum, entry) => sum + entry.all, 0),
      kept: groundedSizes.reduce((sum, entry) => sum + entry.grounded, 0),
    },
    // What learning produced and what was actually scored, carried separately because the
    // validated arm makes them differ on purpose.
    digest: scoringFrozen.digest,
    digestBeforeValidation: frozen.digest,
    activeRulesBeforeValidation: frozen.active,
    narrowActive: narrowed?.frozen.active ?? null,
    repairActive: repaired?.frozen.active ?? null,
    proceduralActive: procedural?.frozen.active ?? null,
    failureKey: { asked: keyedTried, hit: keyedHits, stored: storedCodes, observed: observedCodes },
    link: ARMS.has('linked') ? { reasons: linkReasons, dropped: linkDropped, total: linkTotal } : null,
    sampling:
      samplingArmsThisRun.length === 0
        ? null
        : {
            draws: samplingDraws,
            temperature: SAMPLE_TEMPERATURE,
            byArm: Object.fromEntries(
              [...selectionByArm].map(([arm, list]) => [arm, selectionStats(list)]),
            ),
            correctDraws,
            selectors: choiceAccounting.get(fold) ?? null,
          },
    probe: probe === undefined ? null : probeRecord(probe, verifiedSizes, verifiedDiffers),
    probeRepair:
      probeRepair === undefined
        ? null
        : probeRecord(probeRepair, repairVerifiedSizes, repairVerifiedDiffers),
    substrate,
    transfer:
      probe?.transfer == null
        ? null
        : {
            summary: probe.transfer.summary,
            rules: probe.transfer.rules.length,
            skipped: probe.transfer.skipped,
            trials: probe.transfer.trials,
            packAll: transferSizes.reduce((sum, entry) => sum + entry.all, 0),
            packKept: transferSizes.reduce((sum, entry) => sum + entry.kept, 0),
            packDiffers: transferDiffers,
          },
    transferRepair:
      probeRepair?.transfer == null
        ? null
        : {
            summary: probeRepair.transfer.summary,
            rules: probeRepair.transfer.rules.length,
            skipped: probeRepair.transfer.skipped,
            trials: probeRepair.transfer.trials,
            packAll: repairTransferredSizes.reduce((sum, entry) => sum + entry.all, 0),
            packKept: repairTransferredSizes.reduce((sum, entry) => sum + entry.kept, 0),
            packDiffers: repairTransferredDiffers,
          },
    shuffled: ARMS.has('full-shuffled')
      ? { donors: shuffledDonors, identical: shuffledIdentical }
      : null,
    repairItems,
    distillDrops: { rule: widened.drops, repair: repaired?.drops ?? null },
    items,
    distillFailures,
  };
}

/**
 * The host of an endpoint, without the path or any query it carried.
 *
 * Used only to label a run, but it is parsed rather than echoed: an endpoint with a token
 * in its query string would otherwise be written into a committed artefact.
 */
function hostOf(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return 'unparseable';
  }
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
  /**
   * Characters of knowledge per question, the same thing measured as text rather than as
   * claims. Every comparison this lane has run that moved accuracy moved this number too, and
   * until it was recorded the coincidence could not be told from a cause.
   */
  readonly mean_pack_chars: number;
};

async function main(): Promise<void> {
  if ((process.env['SOTA_CONVENTION'] ?? '').trim() !== '' && ACTIVE === undefined) {
    throw new MicrogliaError(
      'MG_E_CONFIG',
      `Unknown convention '${(process.env['SOTA_CONVENTION'] ?? '').trim()}'`,
      { known: Object.keys(HOUSE_CONVENTIONS).join(', ') },
    );
  }
  const dataset = await loadDataset(LIMIT);
  const idOf = (row: BirdRow): string => `${row.db_id}#${row.question_id}`;

  // The subset is chosen by a rule that does not look at outcomes: a one-row,
  // one-column numeric answer is the only place the convention is defined.
  const expected = new Map<string, number>();
  let rows = dataset.rows;
  /** Share of rewritten gold queries that report the value the convention expects. */
  let conventionExecRate: number | undefined;
  if (ACTIVE !== undefined) {
    rows = dataset.rows.filter((row) => {
      const value = scalarOf(dataset.dbPath(row.db_id), row.SQL);
      if (value === undefined || !ACTIVE.applies(value)) return false;
      expected.set(idOf(row), ACTIVE.transform(value));
      return true;
    });
    // The convention lane's `gold_exec_rate`: rewrite each gold query to report the
    // way the workspace reports and check that the value it produces is the one the
    // scorer expects. Without this, a disagreement between the rewrite and the
    // transform is indistinguishable from a model that cannot follow the
    // convention - and both read as "the mechanism does not work".
    let agrees = 0;
    for (const row of rows) {
      const reported = scalarOf(dataset.dbPath(row.db_id), reportedSql(row.SQL, ACTIVE));
      if (judgeScalar(reported, expected.get(idOf(row)))) agrees += 1;
    }
    conventionExecRate = rows.length === 0 ? 1 : agrees / rows.length;
    process.stdout.write(
      `[sota] convention ok on ${agrees}/${rows.length} gold queries ` +
        `(${((rows.length === 0 ? 1 : agrees / rows.length) * 100).toFixed(2)}%)\n`,
    );
    // No minimum beyond "enough to fold": the protocol says a subset below a
    // hundred is reported as a direction, not refused. The earlier threshold of
    // twenty made the lane exit before it could report anything, which is how a
    // subset of nineteen becomes silence instead of a number with a caveat.
    if (rows.length === 0) {
      throw new MicrogliaError('MG_E_CONFIG', 'No question defines the convention', {
        of: dataset.rows.length,
        convention: CONVENTION_NAME,
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

  /**
   * What each fold cost, and the checkpoint that stops the run before it repeats a mistake.
   *
   * The lane used to discover its ceiling by hitting it. Four folds of an S2 dispatch completed,
   * the fifth threw at call 4,197 of 4,200, and the publish step found no artefact: forty-seven
   * minutes of calls discarded, from a configuration wrong by a factor of 1.5 that no part of the
   * run could see coming. Between folds is the only place where the answer exists — the folds that
   * just ran are a sample of the folds that are left — so each fold's spend is recorded, forecast
   * against the ceiling, and a run that cannot finish writes down what it has before it stops.
   *
   * The partial artefact is not a substitute for the real one and is never published as evidence:
   * it exists so that a budget stop costs minutes instead of the whole run, and so the next
   * dispatch can be sized from measurements rather than from a guess.
   */
  const folds: FoldResult[] = [];
  const spend: { fold: number; calls: number }[] = [];
  const writeStop = async (
    reason: string,
    callsInFlightFold: number,
    stoppedBy: 'budget' | 'deadline',
  ): Promise<void> => {
    await writeJson(`${ARTEFACT_ID}.partial`, {
      partial: true,
      stopped_by: stoppedBy,
      reason,
      cap: MAX_CALLS,
      spent: llm.stats.calls,
      deadline_min: DEADLINE_MIN,
      timeouts: llm.stats.timeouts,
      retries: llm.stats.retries,
      folds_completed: folds.length,
      folds_planned: FOLDS,
      calls_in_flight_fold: callsInFlightFold,
      per_fold: folds.map((fold, index) => ({
        fold: fold.fold,
        calls: spend[index]?.calls ?? 0,
        eval: fold.eval,
        learn: fold.learn,
        edited: fold.learning.edited,
        unanswered: fold.learning.unanswered,
        distill_failed: fold.failedDistill,
        active: fold.activeRules,
      })),
      arms: [...ARMS].sort(),
      generated_at: new Date().toISOString(),
    });
  };
  for (let fold = 0; fold < FOLDS; fold += 1) {
    const before = llm.stats.calls;
    try {
      folds.push(await runFold(fold, rows, foldOf, dataset, task));
    } catch (error) {
      if (!(error instanceof MicrogliaError)) throw error;
      if (error.code === 'MG_E_DEADLINE') {
        // The clock, not the budget. Both stops lose the fold in flight and keep the folds that
        // finished; the difference is what the next dispatch should change, so it is written down.
        await writeStop(
          `fold ${fold + 1}/${FOLDS} reached the ${DEADLINE_MIN}-minute deadline at ` +
            `${llm.stats.calls} of ${MAX_CALLS} calls`,
          llm.stats.calls - before,
          'deadline',
        );
        throw error;
      }
      if (error.code !== 'MG_E_BUDGET_EXCEEDED') throw error;
      // The fold in flight is lost either way; what the completed folds measured is not.
      await writeStop(
        `fold ${fold + 1}/${FOLDS} ran out of calls at ${llm.stats.calls} of ${MAX_CALLS}`,
        llm.stats.calls - before,
        'budget',
      );
      throw error;
    }
    spend.push({ fold, calls: llm.stats.calls - before });
    const forecast = forecastBudget({
      spent: llm.stats.calls,
      cap: MAX_CALLS,
      folds: spend,
      totalFolds: FOLDS,
    });
    if (!forecast.ok) {
      process.stdout.write(
        `[sota] budget forecast after fold ${fold + 1}/${FOLDS}: the run needs about ` +
          `${forecast.projected} calls, the cap is ${MAX_CALLS} (short by ${forecast.shortfall})\n`,
      );
      await writeStop(
        `the remaining ${FOLDS - spend.length} folds cost about ` +
          `${forecast.projected - llm.stats.calls} more calls at the dearest fold's price, ` +
          `which the cap of ${MAX_CALLS} cannot cover`,
        0,
        'budget',
      );
      throw new MicrogliaError('MG_E_BUDGET_EXCEEDED', 'the configured cap cannot finish the folds', {
        cap: MAX_CALLS,
        spent: llm.stats.calls,
        projected: forecast.projected,
        shortfall: forecast.shortfall,
      });
    }
  }

  /**
   * The prior arms this run asked for, each with the memory it reads.
   *
   * Read here rather than carried out of the fold, because a fold cannot decide a question whose
   * answer depends on the other four. The list is derived from `OPTIONAL_ARMS` and the arm set rather
   * than from a literal, so an arm name that exists but cannot be dispatched — or a dispatch that
   * names an arm the run does not implement — is a compile error or an empty list, never a silent
   * no-op.
   */
  const priorArms: { readonly arm: Exclude<ArmName, 'none' | 'full'>; readonly scope: PriorScope }[] = [];
  for (const arm of OPTIONAL_ARMS) {
    const scope = priorScopeOf(samplingSpecOf(arm)?.selector ?? 'majority');
    if (scope !== undefined && ARMS.has(arm as ArmName)) {
      priorArms.push({ arm: arm as Exclude<ArmName, 'none' | 'full'>, scope });
    }
  }
  // Applied here rather than beside the other selectors: these are the only arms that read the other
  // folds, and until this line the other folds did not exist.
  let measured: readonly CaseOutcome[] = folds.flatMap((fold) => fold.cases);
  for (const entry of priorArms) measured = withPriorPicks(measured, entry.arm, entry.scope);
  const cases = measured;
  const withoutMemory = cases.map((item) => item.withoutMemoryCorrect);
  const withMemory = cases.map((item) => item.correct);
  const paired = comparePaired(withoutMemory, withMemory, SEED, RESAMPLES);
  // The same sample under the other comparison. The SQL was executed once, so any
  // difference between the two deltas is the criterion rather than the run — the one
  // comparison a second dispatch could never make cleanly.
  const pairedShadow = comparePaired(
    cases.map((item) => item.shadowWithoutMemoryCorrect),
    cases.map((item) => item.shadowCorrect),
    SEED,
    RESAMPLES,
  );
  const scoredDisagreements = cases.reduce((sum, item) => sum + (item.correct === item.shadowCorrect ? 0 : 1), 0);
  const meanPackIds = cases.reduce((sum, item) => sum + item.packIds, 0) / Math.max(1, cases.length);
  const meanPackChars = cases.reduce((sum, item) => sum + item.packChars, 0) / Math.max(1, cases.length);
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
  const parseRate = rate(cases.map((item) => item.parseOk));
  const execRate = rate(cases.map((item) => item.execOk));
  const learnTotal = folds.reduce((sum, fold) => sum + fold.learn, 0);
  const goldFailures = folds.reduce((sum, fold) => sum + fold.learning.goldFailed, 0);
  const goldExecRate = learnTotal === 0 ? 1 : 1 - goldFailures / learnTotal;
  const detectable = detectableDelta(cases.length, paired.discordance);

  /**
   * R9.1's family, when the dispatch asked for one.
   *
   * Fold 0's store supplies the rules, and it is fixed by construction: one store, one hash-ordered
   * subset per database, chosen before the second half of the panel is looked at. The controls come
   * from every fold's `none` arm, because a question's answer without memory is a property of the
   * question and does not belong to the fold that happened to score it.
   *
   * Fold 0 rather than the union: the folds' stores are five distillations of overlapping evidence,
   * and a union would be a store no fold ever held.
   */
  const density =
    DENSITY_PANEL === 0 || folds.length === 0
      ? null
      : await densityPass({
          items: (folds[0] as FoldResult).storeItems,
          cases,
          dataset,
          task,
        });

  /**
   * The relevance split, scored by the arm that saw the pack.
   *
   * The first version passed the case's `correct`, which is the `full` arm's outcome, for every
   * arm — so the procedural block described the rule arm's accuracy partitioned by the procedural
   * pack's relevance, and read as a 5pp loss that the arm's own total (+0.86pp) contradicted. The
   * numbers were in the artefact; they were just not each other's.
   */
  const relevanceFor = (arm: ArmName) =>
    relevanceSplit(
      cases.map((item) => ({
        correct: arm === 'full' ? item.correct : item.arms[arm] === true,
        withoutMemoryCorrect: item.withoutMemoryCorrect,
        goldSql: item.goldSql,
        injected:
          arm === 'full'
            ? item.injected
            : arm === 'full-repair'
              ? item.injectedRepair
              : item.injectedProcedural,
      })),
    );
  /**
   * The split and the arm total have to be the same number.
   *
   * They were not, in the run that introduced the block: the split was scored by one arm's
   * outcomes and the packs came from another, so it reported a 5pp loss for an arm the artefact
   * recorded at +0.86pp. A block that cannot be reconciled with the total it is meant to explain
   * is worse than no block, because it reads as a finding.
   */
  const reconcile = (arm: ArmName, split: ReturnType<typeof relevanceSplit>): void => {
    const implied = split.onTopic * split.onTopicAccuracy + split.offTopic * split.offTopicAccuracy;
    const answered = cases.filter(
      (item) =>
        (arm === 'full' || item.arms[arm] !== undefined) &&
        (arm === 'full'
          ? item.injected.length > 0
          : arm === 'full-repair'
            ? item.injectedRepair.length > 0
            : item.injectedProcedural.length > 0),
    );
    const correct = answered.filter((item) =>
      arm === 'full' ? item.correct : item.arms[arm] === true,
    ).length;
    if (Math.abs(implied - correct) > 0.5) {
      throw new MicrogliaError('MG_E_CONFIG', 'The relevance split does not reconcile', {
        arm,
        implied,
        correct,
        packs: split.packs,
      });
    }
  };
  reconcile('full', relevanceFor('full'));
  reconcile('full-repair', relevanceFor('full-repair'));
  reconcile('full-procedural', relevanceFor('full-procedural'));

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
      mean_pack_chars: meanPackChars,
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
      mean_pack_chars:
        present.reduce((sum, item) => sum + (item.armPackChars[name] ?? 0), 0) / present.length,
    });
  }

  // Each control against `full`, paired on the questions both answered. The deltas
  // against `none` above are the treatment effect; these are the difference between
  // two treatments, which is what a control is for.
  const armPairs = armPairsAgainstFull(
    cases.map((item) => ({ full: item.correct, arms: item.arms })),
    SEED,
    RESAMPLES,
  );
  /**
   * The pairs this project pre-registered, measured here rather than in a script after the fact.
   *
   * `armPairs` above compares every arm to `full`, which is the wrong control for a selector among
   * draws: `full` answers once, and a selector that answers five times and picks one is a different
   * experiment. The pairs that matter — a selector against the first draw, a generator against the
   * direct prompt — are declared in `CONTRASTS` before the run and computed here on the questions
   * both arms answered.
   */
  /**
   * The three keys, on this run's own pool.
   *
   * The arms answer the question out of sample; this block answers it in sample and says what the
   * arms are comparing. A scope whose arm did not run still appears, because "the database alone
   * cannot separate two answers to one question" is a fact about the key rather than about the run.
   */
  const priors =
    priorArms.length === 0
      ? undefined
      : priorTable(
          cases.map((item) => ({
            id: item.id,
            dbId: item.dbId,
            fold: item.fold,
            candidates: (item.pool ?? []).map((candidate) => ({
              draw: candidate.draw,
              correct: candidate.correct,
              signature: candidate.signature,
            })),
          })),
        );
  const contrasts = contrastTable(
    cases.map((item) => ({ full: item.correct, arms: item.arms })),
    CONTRASTS,
    SEED,
    RESAMPLES,
  );
  const armPairsShadow = armPairsAgainstFull(
    cases.map((item) => ({ full: item.shadowCorrect, arms: item.shadowArms })),
    SEED,
    RESAMPLES,
  );

  // The channel control is whichever control states the knowledge in a form the
  // model can act on. On the convention lane the measured answer is that a value
  // ("the accepted answer is 10") is ignored while a rule ("report rounded to the
  // nearest ten") is followed, so the gate accepts either: it asks whether the
  // channel moves accuracy, not which phrasing we happened to prefer.
  // A control that injects text without a pack (`stated`) is not a pack control:
  // holding it to "rules per question" asks it for something it does not do, which
  // is how this gate failed a run whose every other reading was sound.
  const packControls = arms.filter(
    (entry) =>
      entry.arm === 'gated' ||
      entry.arm === 'duplicate' ||
      entry.arm === 'wrong-scope' ||
      entry.arm === 'full-narrow' ||
      entry.arm === 'full-plain' ||
      entry.arm === 'critique',
  );
  const channel = arms.filter((entry) => entry.arm === 'oracle' || entry.arm === 'stated');
  const channelBest = channel.reduce<ArmSummary | undefined>(
    (best, entry) => (best === undefined || entry.delta_pp > best.delta_pp ? entry : best),
    undefined,
  );
  // The gate definitions live in `sota.ts` because they are the part of this lane
  // that decides whether a number is publishable, and a decision with no test is a
  // preference. The CLI supplies the measurements.
  // Summed over folds rather than averaged: a rule injected into two questions was
  // shown twice, and the gate asks what the prompts contained.
  const injected = {
    rules: folds.reduce((sum, fold) => sum + fold.injectedRules, 0),
    conditions: folds.reduce((sum, fold) => sum + fold.injectedWithCondition, 0),
  };
  // Summed per arm over folds, because a question is scored once per fold it appears in and the
  // gate asks what the prompts contained, not what one fold's prompts contained.
  const framing = (() => {
    const counts = new Map<string, { prompts: number; carrying: number; expected: boolean }>();
    for (const fold of folds) {
      for (const entry of fold.framing) {
        const held = counts.get(entry.arm) ?? { prompts: 0, carrying: 0, expected: entry.expected };
        held.prompts += entry.prompts;
        held.carrying += entry.carrying;
        counts.set(entry.arm, held);
      }
    }
    return [...counts.entries()].map(([arm, entry]) => ({ arm, ...entry }));
  })();
  // Summed over folds: each fold learns its own store from k−1 folds, so an item counted twice was
  // learned twice. The gate is an invariant about each store; the totals let it read the run.
  const domainOrigin = {
    storedWithDomain: folds.reduce((sum, fold) => sum + fold.domainOrigin.storedWithDomain, 0),
    storedWithoutDomain: folds.reduce((sum, fold) => sum + fold.domainOrigin.storedWithoutDomain, 0),
    unscopedIn: folds.reduce((sum, fold) => sum + fold.domainOrigin.unscopedIn, 0),
    widenedIn: folds.reduce((sum, fold) => sum + fold.domainOrigin.widenedIn, 0),
  };
  const callFailureRate = llm.stats.prompts === 0 ? 0 : llm.stats.failures / llm.stats.prompts;
  // Every question the clearance pair scored, pooled across folds. The gate reads this list rather
  // than the fold summaries because dose-matching is a per-question property.
  const clearanceCells = folds.flatMap((fold) => fold.clearance);
  // One mode for the whole run: every fold is validated the same way, and the field would otherwise
  // have to be read out of a fold that a deadline may not have reached.
  const validationMode: CreditMode = validations[0]?.mode === 'counterfactual' ? 'counterfactual' : CREDIT;
  // One pooled comparison, computed once and read by both the gate and the artefact so the two
  // cannot report different directions for the same run.
  const pairPooled: PooledSubstrate | null = poolSubstrates(
    folds.flatMap((fold) => (fold.substrate === null ? [] : [fold.substrate])),
  );
  // The first block that failed, taken from whichever fold failed first, so the gate can print what it
  // rejected instead of only how many it rejected.
  const rawMismatch = folds.find((fold) => fold.raw.sample !== undefined)?.raw.sample;
  // One pooled projection per substrate, computed once and read by both the gate and the artefact.
  const ruleTransfer = transferArtefact(folds, (fold) => fold.transfer);
  const repairTransfer = transferArtefact(folds, (fold) => fold.transferRepair);
  const gates = buildValidityGates({
    meanPackIds,
    partition: {
      evaluated: seen.size,
      total: rows.length,
      duplicated,
      leaked,
    },
    parseRate,
    goldExecRate,
    detectablePp: detectable * 100,
    packControls: packControls.map((entry) => ({ arm: entry.arm, meanPackIds: entry.mean_pack_ids })),
    channelBest:
      channelBest === undefined
        ? undefined
        : { arm: channelBest.arm, deltaPp: channelBest.delta_pp },
    // The learning half, summed over folds: a store built from part of its corrections is a
    // different treatment, and the artefact has to say so rather than mentioning it in a report.
    learning: {
      rows: folds.reduce((sum, fold) => sum + fold.learn, 0),
      unanswered: folds.reduce((sum, fold) => sum + fold.learning.unanswered, 0),
      edited: folds.reduce((sum, fold) => sum + fold.learning.edited, 0),
      distillFailed: folds.reduce((sum, fold) => sum + fold.failedDistill, 0),
    },
    // The gate's own bookkeeping, so a store filtered by a miscount cannot publish a number.
    ...(folds.every((fold) => fold.probe === null)
      ? {}
      : {
          probe: {
            rules: folds.reduce((sum, fold) => sum + (fold.probe?.rules ?? 0), 0),
            kept: folds.reduce((sum, fold) => sum + (fold.probe?.kept ?? 0), 0),
            noVerifiedSource: folds.reduce((sum, fold) => sum + (fold.probe?.noVerifiedSource ?? 0), 0),
            brokeItsSource: folds.reduce((sum, fold) => sum + (fold.probe?.brokeItsSource ?? 0), 0),
            unsupported: folds.reduce((sum, fold) => sum + (fold.probe?.unsupported ?? 0), 0),
            packDiffers: folds.reduce((sum, fold) => sum + (fold.probe?.packDiffers ?? 0), 0),
            questions: cases.length,
          },
        }),
    // The second substrate's own bookkeeping, so its arm cannot publish a number from a miscount.
    ...(folds.every((fold) => fold.probeRepair === null)
      ? {}
      : {
          probeRepair: {
            rules: folds.reduce((sum, fold) => sum + (fold.probeRepair?.rules ?? 0), 0),
            kept: folds.reduce((sum, fold) => sum + (fold.probeRepair?.kept ?? 0), 0),
            noVerifiedSource: folds.reduce(
              (sum, fold) => sum + (fold.probeRepair?.noVerifiedSource ?? 0),
              0,
            ),
            brokeItsSource: folds.reduce(
              (sum, fold) => sum + (fold.probeRepair?.brokeItsSource ?? 0),
              0,
            ),
            unsupported: folds.reduce((sum, fold) => sum + (fold.probeRepair?.unsupported ?? 0), 0),
            packDiffers: folds.reduce((sum, fold) => sum + (fold.probeRepair?.packDiffers ?? 0), 0),
            questions: cases.length,
          },
        }),
    // The second substrate's transfer, when the run asked for it.
    ...(repairTransfer === null ? {} : { transferRepair: transferGateInput(repairTransfer) }),
    // The paired comparison of the two substrates, when both were measured.
    ...(pairPooled === null
      ? {}
      : {
          substrate: {
            left: pairPooled.left,
            right: pairPooled.right,
            shared: pairPooled.shared,
            leftExclusive: pairPooled.leftExclusive,
            rightExclusive: pairPooled.rightExclusive,
            holes: pairPooled.holes,
            both: pairPooled.both,
            onlyLeft: pairPooled.onlyLeft,
            onlyRight: pairPooled.onlyRight,
            neither: pairPooled.neither,
            paired: pairPooled.paired,
            leftRate: pairPooled.leftRate,
            rightRate: pairPooled.rightRate,
            deltaPp: pairPooled.deltaPp,
            p: pairPooled.p,
            verdict: pairPooled.verdict,
          },
        }),
    // The transfer measurement's own bookkeeping, when it ran.
    ...(ruleTransfer === null ? {} : { transfer: transferGateInput(ruleTransfer) }),
    // The pool's own bookkeeping. A gate rather than a comment because instrumentation that
    // silently drops questions makes every number derived from it a number about the survivor set.
    ...(folds.every((fold) => fold.pool.length === 0)
      ? {}
      : (() => {
          const questions = folds.flatMap((fold) => fold.pool);
          const summary = poolSummary(questions);
          return {
            pool: {
              questions: questions.length,
              expected: cases.length,
              candidates: summary.candidates,
              signed: summary.signed,
              unsigned: summary.unsigned,
              consistent: questions.every(
                (question) =>
                  question.candidates.length > 0 &&
                  question.candidates.every((candidate) => candidate.resultKey >= -1),
              ),
            },
          };
        })()),
    callFailureRate,
    calls: llm.stats.prompts,
    callFailures: llm.stats.failures,
    // The S2b protocol fixes the floor at a hundred questions before the result is
    // read; below it the run is a direction and the artefact says so.
    ...(ACTIVE === undefined ? {} : { subset: { qualifying: rows.length, minimum: 100 } }),
    ...(conventionExecRate === undefined ? {} : { conventionExecRate }),
    ...(injected.rules === 0
      ? {}
      : { packConditions: { injected: injected.rules, withCondition: injected.conditions } }),
    // Only when an arm actually declares a framing: a gate that always passes is a comment, and
    // this one exists because a table entry that silently misses makes two arms one condition.
    ...(framing.every((entry) => !entry.expected) ? {} : { framing }),
    // Where the domain-free items came from. Emitted whenever a store exists, because the number is
    // the ceiling on every transfer reading and a run that reports the ceiling without its causes
    // cannot say whether to fix the interpreter or the widening policy.
    ...(domainOrigin.storedWithDomain + domainOrigin.storedWithoutDomain === 0
      ? {}
      : { domainOrigin }),
    // Emitted only when a verbatim arm ran, and it carries the whole of that arm's validity: a block
    // that was rewritten makes the arm a third distiller under a new name.
    ...(ARMS.has('full-raw')
      ? {
          raw: {
            arm: 'full-raw',
            cells: folds.reduce((sum, fold) => sum + fold.raw.cells, 0),
            verbatim: folds.reduce((sum, fold) => sum + fold.raw.verbatim, 0),
            skipped: folds.reduce((sum, fold) => sum + fold.raw.skipped, 0),
            ...(rawMismatch === undefined ? {} : { sample: rawMismatch }),
          },
        }
      : {}),
    // Emitted only when both halves of the pair were scored, because a dose-matching claim about one
    // arm is a claim about nothing. The counts are post-budget and per question: two sums that agree
    // do not make any single question dose-matched, and the gate is about the questions.
    ...(ARMS.has('full-cleared') && ARMS.has('full-cleared-sampled')
      ? {
          clearance: {
            arm: 'full-cleared',
            control: 'full-cleared-sampled',
            questions: clearanceCells.length,
            mismatched: clearanceCells.filter((cell) => cell.cleared !== cell.control).length,
            identical: clearanceCells.filter((cell) => cell.identical).length,
            dropped: clearanceCells.reduce((sum, cell) => sum + cell.dropped, 0),
            meanCleared:
              clearanceCells.length === 0
                ? 0
                : clearanceCells.reduce((sum, cell) => sum + cell.cleared, 0) / clearanceCells.length,
            meanControl:
              clearanceCells.length === 0
                ? 0
                : clearanceCells.reduce((sum, cell) => sum + cell.control, 0) / clearanceCells.length,
          },
        }
      : {}),
    // The protocol's oracle ceiling applies to the convention lane, where the
    // accepted answer has a form the model must reproduce.
    ...(ACTIVE === undefined || channelBest === undefined ? {} : { channelCeiling: channelBest.accuracy }),
  });
  // R9's family, appended rather than folded into `buildValidityGates`: its bars are about whether
  // the *workload* can decide the question, and a family that cannot is a reason to rebuild the
  // family, not a reason to disbelieve the accuracy above.
  gates.push(...(density === null ? [] : densityGates(density.report)));

  const assertions = {
    /**
     * Not a gate: a violation throws inside the fold, because a pack that changed
     * while being measured makes the number it produced meaningless rather than
     * merely doubtful. The digest is recorded here so the claim is auditable.
     */
    pack_frozen_during_eval: folds.map((fold) => `fold ${fold.fold}: ${fold.digest}`).join(', '),
    /**
     * Where the store changed between learning and scoring, when an arm changed it.
     *
     * The validated arm retires rules before the first question, so its fold has two
     * digests. Recording both keeps the guard above honest: it still compares against a
     * single value, and a reader can see that the value it compares against was taken
     * after the one mutation the run intended rather than before it.
     */
    store_changes_before_scoring: folds
      .filter((fold) => fold.digest !== fold.digestBeforeValidation)
      .map(
        (fold) =>
          `fold ${fold.fold}: ${fold.activeRulesBeforeValidation} -> ${fold.activeRules} active rules, ` +
          `${fold.digestBeforeValidation} -> ${fold.digest}`,
      ),
    evaluation_writes_no_feedback: true,
    /**
     * The host every call went to, or `default` when the lane was not redirected.
     *
     * A rehearsal against a stand-in produces numbers of exactly the shape a real run
     * produces, so the artefact has to say which one it is.
     */
    model_endpoint: ENDPOINT === '' ? 'default' : hostOf(ENDPOINT),
  };

  const items = folds.flatMap((fold) =>
    fold.items.map((item) => ({ fold: fold.fold, ...item })),
  );
  const artifact = {
    id: ARTEFACT_ID,
    protocol: 'cross-fitted-kfold/3',
    dataset: SPLIT_NAME,
    source: dataset.source,
    model: MODEL,
    prompt_version: PROMPT_VERSION,
    config: {
      // Which split these numbers were measured on. A reader comparing against a
      // published cell needs it before anything else: 53.71 on 350 questions and
      // 53.71 on 1,534 are not the same claim.
      split: SPLIT,
      learn_sample: LEARN_SAMPLE,
      folds: FOLDS,
      seed: SEED,
      limit: LIMIT,
      generalize: GENERALIZE,
      resamples: RESAMPLES,
      budget_chars: 1200,
      duplicate_multiplier: 2,
      min_coverage: MIN_COVERAGE,
      arms: [...ARMS],
      // The pre-registration this run is evidence for, or null when it was run by hand.
      //
      // The workflow refuses a dispatch that names no file, but until now the file's name stopped
      // at the workflow: the artefact did not carry it, so a reader holding the numbers could not
      // find the prediction they were supposed to test. A prediction that is not attached to its
      // measurement is a prediction the next reader has to take on trust.
      prereg: PREREG === '' ? null : `prereg/${PREREG}.md`,
      convention: ACTIVE?.sentence ?? null,
      task: TASK,
      distill_prompt: 'distill-prompt/3',
      // The repair form is a second distiller over the same events. Recorded separately
      // because a number produced under it is not comparable to one produced under the
      // rule form, and a single `distill_prompt` field would let a reader assume it was.
      distill_prompt_repair: folds.some((fold) => fold.repairActive !== null) ? 'distill-prompt/3+repair' : null,
      distill_max_tokens: 2000,
      concurrency: CONCURRENCY,
      breaker_threshold: BREAKER_THRESHOLD,
      generation_cache: generations.stats,
      // True only when this run built a second, unwidened memory. When the run is
      // itself unwidened, `full-narrow` is the same pack under a second name, and a
      // reader must not read the two arms as a comparison.
      narrow_distinct: folds.some((fold) => fold.narrowActive !== null),
      // The corroboration threshold this run applied, or null when the arm was off.
      // A filter is a condition of the result: a number produced at a different
      // threshold is a different number.
      corroboration_min: ARMS.has('full-corroborated') ? CORROBORATION : null,
      // The family's shape, so a reader can say which one produced the numbers above.
      density:
        DENSITY_PANEL === 0
          ? null
          : { panel: DENSITY_PANEL, rules_per_db: DENSITY_RULES_PER_DB, transfer_panel: TRANSFER_PANEL },
    },
    n: {
      total: rows.length,
      eval: cases.length,
      learn_mean: folds.reduce((sum, fold) => sum + fold.learn, 0) / Math.max(1, folds.length),
      databases: new Set(rows.map((row) => row.db_id)).size,
      qualifying: rows.length,
      reported: rows.length === 0 ? 0 : expected.size,
    },
    // `calls` counts HTTP attempts; `prompts` counts logical calls, which is the
    // denominator of the reliability gate.
    calls: llm.stats.calls,
    retries: llm.stats.retries,
    prompts: llm.stats.prompts,
    call_failures: llm.stats.failures,
    // What the wall clock went on. A retry after a 429 is the provider asking for patience; a
    // timeout is this client having asked for more than it was willing to wait for, and the second
    // count is the one that explains a fold whose evaluation took two minutes and whose learning
    // took forty-three.
    timeouts: llm.stats.timeouts,
    deadline_min: DEADLINE_MIN,
    distill_concurrency: DISTILL_CONCURRENCY,
    metrics: {
      accuracy_without_memory: paired.baselineAccuracy,
      accuracy_with_memory: paired.treatmentAccuracy,
      delta_pp: paired.delta * 100,
      parse_rate: parseRate,
      exec_rate: execRate,
      gold_exec_rate: goldExecRate,
      mean_pack_ids: meanPackIds,
      // R9's family: one rule at a time, a fixed rule set, and a panel of questions per database.
      // Absent rather than null when the stage did not run, because a null would read as a
      // measurement that came back empty.
      ...(density === null
        ? {}
        : {
            density: density.report,
            density_ledger: density.trials,
            density_floor_ledger: density.floorTrials,
            density_transfer_ledger: density.crossTrials,
            density_excluded: density.excluded,
            density_unplaced: density.unplaced,
            density_unmeasured: density.unmeasured,
            density_calls: density.calls,
            // R10: which form the foreign arm showed. Carried at the top level as well as inside the
            // report, because a reader comparing two artefacts needs to know what they are comparing
            // before reading forty fields of it.
            density_injection_form: INJECTION_FORM,
          }),
      latency_p50_ms: percentile(cases.map((item) => item.latencyMs), 0.5),
      latency_p95_ms: percentile(cases.map((item) => item.latencyMs), 0.95),
      knowledge_active_mean: activeMean,
      // What the raw arm actually put in front of the model: events shown, events skipped as too long
      // for the budget, and the payload lines that came from somewhere other than the event.
      ...(ARMS.has('full-raw')
        ? {
            raw_events: folds.reduce((sum, fold) => sum + fold.raw.events, 0),
            raw_skipped: folds.reduce((sum, fold) => sum + fold.raw.skipped, 0),
            raw_cells: folds.reduce((sum, fold) => sum + fold.raw.cells, 0),
            // Characters per question are in the arm table's `mean_pack_chars`, which the artefact
            // computes for every arm; a second copy here would be a number that could drift from it.
          }
        : {}),
      // What the clearance removed and what each half of the pair then carried. Reported beside
      // `mean_pack_ids` because that number describes `full`, and the whole point of the pair is
      // that it is scored at a smaller dose than the arm it is compared against.
      ...(clearanceCells.length === 0
        ? {}
        : {
            clearance_questions: clearanceCells.length,
            clearance_dropped: clearanceCells.reduce((sum, cell) => sum + cell.dropped, 0),
            clearance_mean_cleared:
              clearanceCells.reduce((sum, cell) => sum + cell.cleared, 0) / clearanceCells.length,
            clearance_mean_control:
              clearanceCells.reduce((sum, cell) => sum + cell.control, 0) / clearanceCells.length,
            clearance_identical: clearanceCells.filter((cell) => cell.identical).length,
            clearance_rules_scored: validations.reduce((sum, entry) => sum + entry.credit.size, 0),
            // Summed over folds because each fold has its own store and its own learn rows: a rule
            // removed twice was learned twice, which is the same convention `domainOrigin` uses.
            clearance_rules_removed: validations.reduce(
              (sum, entry) => sum + clearanceFromDecisive(entry.credit).length,
              0,
            ),
          }),
      // The shape experiment's two denominators: rules injected, and how many of
      // them said when they apply. `active_with_condition` counts the store, which
      // is where a reader looks to see whether the distiller changed behaviour.
      injected_rules: injected.rules,
      injected_with_condition: injected.conditions,
      active_with_condition: folds.reduce(
        (sum, fold) => sum + fold.items.filter((item) => item.status === 'active' && item.when !== null).length,
        0,
      ),
      // The workload's recurrence, as the product would measure it: the share of active
      // rules with more than one observation. Zero here is the finding of iteration 65,
      // and it is now a number every run reports rather than one a reader has to derive.
      ...(() => {
        const counts = folds.flatMap((fold) =>
          fold.items.map((item) => ({ status: item.status, observations: item.evidence })),
        );
        const summary = corroborationShare(counts);
        return {
          active_corroborated: summary.corroborated,
          active_total: summary.active,
          corroboration_share: summary.share,
        };
      })(),
      knowledge_active_last: folds.at(-1)?.activeRules ?? 0,
      // The deletion arm's own accounting: how many rules were seen in validation, how
      // many questions injected one, and how many rules the failures retired. A run that
      // retires nothing reports the same accuracy as `full` for a reason a reader can see.
      validation_folds: validations.length,
      validation_rules_seen: validations.reduce((sum, entry) => sum + entry.rules, 0),
      validation_rules_retired: validations.reduce((sum, entry) => sum + entry.retired, 0),
      validation_injected_questions: validations.reduce((sum, entry) => sum + entry.injected, 0),
      validation_trials: validations.reduce((sum, entry) => sum + entry.trials, 0),
      /**
       * Rules by observed failure share, merged across folds, in `failures/trials` form.
       *
       * Without it a run that retires nothing is ambiguous: the policy may have refused
       * to act, or no rule may ever have been injected twice. Both produce an empty
       * deletion list and the same accuracy, and only this distinguishes them.
       */
      validation_histogram: JSON.stringify(
        validations.reduce<Record<string, number>>((merged, entry) => {
          for (const [share, count] of Object.entries(entry.histogram)) {
            merged[share] = (merged[share] ?? 0) + count;
          }
          return merged;
        }, {}),
      ),
      validation_policy:
        validationMode === 'absolute'
          ? `absolute share>=${RETIREMENT.failureRate} over >=${RETIREMENT.minTrials} trials`
          : `counterfactual harmShare>=${DECISIVE.harmShare.toFixed(4)} over >=${DECISIVE.minDecisive} decisive`,
      /** Which score decided the deletions, and what it saw. */
      validation_credit: validationMode,
      validation_decisive_questions: validations.reduce((sum, entry) => sum + entry.decisive, 0),
      validation_helped: validations.reduce((sum, entry) => sum + entry.helped, 0),
      /**
       * Rules dropped from a validation row because the row itself produced them.
       *
       * The first counterfactual run had no way to drop them, and 132 of its 213 credited
       * rules showed exactly one help and no harm — the signature of a rule being asked
       * about its own source question.
       */
      validation_self_excluded: validations.reduce((sum, entry) => sum + entry.excluded, 0),
      /**
       * The distillation cache, because a replayed run is a different kind of evidence.
       *
       * A run with zero hits learnt its own store; one with a thousand hits replayed a store
       * an earlier dispatch learnt. Both are valid, and they answer different questions, so
       * the counts travel with the numbers they produced.
       */
      distill_cache_hits: distillations.stats.hits,
      distill_cache_misses: distillations.stats.misses,
      distill_cache_entries: distillations.stats.size,
      validation_harmed: validations.reduce((sum, entry) => sum + entry.harmed, 0),
      /**
       * Questions the anchored arm could not revise, because the first round never answered.
       *
       * The arm needs a draft. A question without one is not a wrong revision, it is no
       * revision, and the count is what keeps the two apart in the arm summary.
       */
      anchored_skipped_questions: folds.reduce((sum, fold) => sum + fold.anchoredSkipped, 0),
      // The arm's own evidence that the deletion reached the questions it scored.
      /**
       * How often the retry arm actually spent its pack.
       *
       * The arm's whole claim is that it shows guidance only where an answer failed, so a run
       * in which almost nothing failed would be measuring the no-memory arm under a different
       * name. Both counts travel so that is visible instead of inferred.
       */
      retried_questions: folds.reduce((sum, fold) => sum + fold.retried, 0),
      not_retried_questions: folds.reduce((sum, fold) => sum + fold.notRetried, 0),
      /**
       * The retry arms measured on the questions they were allowed to touch.
       *
       * A population delta divides a conditional effect by the whole benchmark — 41
       * eligible questions out of 350 — so a repair loop that recovers a third of its
       * failures reads as +2pp with an interval that includes zero. This block answers the
       * question the arm was built to ask, and it is reported next to the population delta
       * rather than instead of it: conditioning on the first answer's failure is exactly
       * what makes it informative and exactly what stops it from being a headline.
       */
      retry_subset: retrySubset(cases),
      /**
       * What the selectors did across the whole run, and what they had to work with.
       *
       * The four arms this block describes are one experimental design: the draws are shared, so
       * `sample-5-first - none` is the price of a non-zero temperature, `sample-5-random -
       * sample-5-first` is what alternatives are worth before anyone judges them, and `sample-5 -
       * sample-5-random` is the selector. A single `sample-5 - none` number cannot separate those.
       */
      /**
       * How much of the schema the linker removed, and how often it declined to remove anything.
       *
       * Reported beside the arm's delta because a pruner that abstains on most questions produces a
       * delta that describes its abstentions, not its effect.
       */
      schema_link: folds.every((fold) => fold.link === null)
        ? null
        : {
            reasons: folds.reduce<Record<string, number>>((all, fold) => {
              for (const [reason, count] of Object.entries(fold.link?.reasons ?? {})) {
                all[reason] = (all[reason] ?? 0) + count;
              }
              return all;
            }, {}),
            dropped: folds.reduce((sum, fold) => sum + (fold.link?.dropped ?? 0), 0),
            total: folds.reduce((sum, fold) => sum + (fold.link?.total ?? 0), 0),
            /**
             * The same delta, split by whether the linker shortened the prompt.
             *
             * The population figure is an average over questions the linker changed and questions
             * it left byte-identical, and the second group outnumbers the first five to one. Without
             * this split the arm's delta describes the run; with it, the `unchanged` group is a
             * noise floor measured on the same questions in the same fold.
             */
            split: schemaLinkSplit(cases),
          },
      /**
       * Whether the store can reproduce the corrections it was built from.
       *
       * The question the memory line needed and never asked. Every previous arm measured what the
       * extraction is worth on held-out questions, which confounds a rule that is wrong with a rule
       * that does not transfer; this one asks the rule to reproduce its own case, with a paired
       * blank so the retry's own repair rate is subtracted rather than credited.
       *
       * `kept` and the three drop buckets have to sum to `rules`, and `packDiffers` has to be
       * non-zero for `full-verified` to be a treatment rather than a second name for `full`.
       */
      rule_probe: probeArtefact(folds, (fold) => fold.probe),
      /**
       * The same instrument over the other substrate.
       *
       * Reported separately rather than merged, because a number produced by the `repair`
       * distiller is not comparable to one produced by the `rule` distiller, and a single block
       * would let a reader assume the two stores were the same store under two names.
       */
      rule_probe_repair: probeArtefact(folds, (fold) => fold.probeRepair),
      /**
       * The two substrates paired on the questions they share.
       *
       * The per-fold rows are the reading and the pooled row is a summary of them: folds are
       * disjoint and each is learned from the others, so the counts add, but a pooled p assumes
       * the folds agree on the direction. Both are here so neither can be quoted alone.
       */
      rule_probe_pair: (() => {
        if (pairPooled === null) return null;
        // The fold number travels with the comparison rather than being recovered from its index: a
        // run where one fold could not pair would otherwise label the rest with the wrong fold.
        const rows = folds.flatMap((fold) =>
          fold.substrate === null ? [] : [{ fold: fold.fold, entry: fold.substrate }],
        );
        return {
          // The same object the gates read, so the file and the gate cannot disagree.
          ...pairPooled,
          by_fold: rows.map(({ fold, entry }) => ({
            fold,
            shared: entry.shared,
            paired: entry.paired,
            both: entry.both,
            only_left: entry.onlyLeft,
            only_right: entry.onlyRight,
            neither: entry.neither,
            holes: entry.holes,
            left_rate: Number(entry.leftRate.toFixed(4)),
            right_rate: Number(entry.rightRate.toFixed(4)),
            delta_pp: Number(entry.deltaPp.toFixed(2)),
            p: Number(entry.p.toFixed(6)),
            ci: entry.deltaCI,
            verdict: entry.verdict,
          })),
        };
      })(),
      /**
       * What the generators together could have scored.
       *
       * R7.1's criterion, computed from arms the run already measured: the union over generators is
       * the score of a chooser that always picked right, and `ceilingPp` is what a selector would
       * have to work with. A `dominant` generator means the pool is one procedure with two extra
       * calls per question, which is a cost rather than a diversity.
       */
      union: (() => {
        const measured = folds.flatMap((fold) => fold.cases);
        // Every arm that changes how the statement is produced, which is what a generator is here.
        // `m-schema` belongs in the list even though its effect is published as a single-cell delta:
        // it is a second representation of the same question, so on the questions where the DDL
        // prompt misreads a table it can be the only arm that answers, and a chooser would have it
        // to pick. Criterion 6 guards the case where it is the whole pool on its own.
        const generators = ['gen-plan', 'gen-decompose', 'm-schema'].filter((arm) =>
          measured.some((item) => arm in item.arms),
        );
        if (generators.length === 0) return null;
        const outcome = unionCeiling(
          measured.map((item) => ({
            id: item.id,
            correct: { none: item.withoutMemoryCorrect, ...item.arms },
            keys: item.arm_result_digests,
          })),
          'none',
          ['none', ...generators],
        );
        return {
          arms: outcome.arms,
          questions: outcome.questions,
          per_arm: outcome.perArm,
          union: outcome.union,
          control: outcome.control,
          ceiling_pp: Number(outcome.ceilingPp.toFixed(2)),
          disagreement_share: Number(outcome.disagreementShare.toFixed(4)),
          dominant: outcome.dominant,
          // The pool the ceiling was computed over, in the same terms the sampling pool is described
          // in: distinct execution results per question, and the same bar deciding whether that is a
          // pool with a choice in it or one answer with several spellings.
          distinct: {
            measured: outcome.distinct.measured,
            arms: outcome.distinct.arms,
            mean: Number(outcome.distinct.mean.toFixed(3)),
            median: outcome.distinct.median,
            share: Number(outcome.distinct.share.toFixed(4)),
            verdict: outcome.distinct.verdict,
            histogram: outcome.distinct.histogram,
          },
        };
      })(),
      /**
       * The candidate pool, described.
       *
       * R7.0: before a selector is built, the pool it would select from has to be described, and
       * the number that decides the stage is how many *distinct execution results* a question's
       * draws contained. Five draws that collapse to one answer are one candidate with five
       * spellings, and not even an oracle can gain on them.
       *
       * `signals` prices each execution signal alone, at candidate level, against the base rate of
       * taking the first draw. It is computed here rather than in a separate run because it reads
       * candidates the sampling pass already produced: the analysis of a pool costs no calls, and
       * a signal that does not separate answers from non-answers is reported as inert before it is
       * allowed to rank anything.
       */
      pool: (() => {
        const questions = folds.flatMap((fold) => fold.pool);
        if (questions.length === 0) return null;
        const summary = poolSummary(questions);
        const readings = signalReadings(questions);
        // The gate is computed here as well as printed by `eval:signals`, and the artefact is the
        // primary copy: a reader who has the file should not have to re-run a command to learn
        // whether any signal was allowed to rank anything.
        const gate = readComposite(questions, readings);
        // A lookup rather than a map: six verdicts and seven readings is forty-two comparisons, and
        // the map needed a cast to key by a name that includes the baseline.
        const verdictOfSignal = (signal: string) =>
          gate.verdicts.find((verdict) => verdict.signal === signal);
        return {
          ...summary,
          distinct_histogram: summary.distinctHistogram,
          signals: readings.map((reading) => {
            const verdict = verdictOfSignal(reading.signal);
            return {
              signal: reading.signal,
              eligible: reading.eligible,
              top_pick: reading.topPick,
              accuracy: Number(reading.accuracy.toFixed(4)),
              auc: Number(reading.auc.toFixed(4)),
              auc_low: Number(reading.aucLow.toFixed(4)),
              auc_high: Number(reading.aucHigh.toFixed(4)),
              // The standard error the gate divides by, after the floor: a reader who cannot see it
              // cannot check the verdict.
              auc_se: Number(reading.aucSe.toFixed(4)),
              positive: reading.positive,
              negative: reading.negative,
              pairs: reading.pairs,
              z: verdict === undefined ? null : Number(verdict.z.toFixed(4)),
              holm: verdict === undefined ? null : Number(verdict.holm.toPrecision(4)),
              survives: verdict === undefined ? null : verdict.survives,
            };
          }),
          gate: {
            kept: gate.kept,
            inert: gate.inert,
            eligible: gate.eligible,
            composite_top_pick: gate.compositeTopPick,
            composite_accuracy: Number(gate.compositeAccuracy.toFixed(4)),
            baseline_accuracy: Number(gate.baselineAccuracy.toFixed(4)),
            delta_pp: Number(gate.deltaPp.toFixed(2)),
            gained: gate.gained,
            lost: gate.lost,
            verdict: gate.verdict,
          },
        };
      })(),
      /**
       * Whether the admitted rules are knowledge or demonstrations.
       *
       * The own-case probe says whether a correction is in the store; this says whether what is in
       * the store can repair anything else. `rate` is repairs over informative trials — targets a
       * bare retry could not repair — and it converts directly into the expected number of repairs
       * per question: `rate × mean_pack_ids`. Without it, a store that is too small and a store
       * that is useless are indistinguishable.
       */
      rule_transfer: ruleTransfer,
      /**
       * The same measurement over the second substrate.
       *
       * A number produced by the `repair` distiller is not comparable to one produced by the `rule`
       * distiller, so the two blocks are never merged and the ledger of each is kept apart.
       */
      rule_transfer_repair: repairTransfer,
      /**
       * What the shuffled arm drew from, so a fallback to the question's own pack is visible.
       */
      shuffled: folds.every((fold) => fold.shuffled === null)
        ? null
        : {
            donors: folds.reduce((sum, fold) => sum + (fold.shuffled?.donors ?? 0), 0),
            identical: folds.reduce((sum, fold) => sum + (fold.shuffled?.identical ?? 0), 0),
          },
      /**
       * What the value annotator produced, so an arm that annotated nothing cannot look like one
       * that annotated everything.
       *
       * The published gain for value samples is +4.8pp with an index that links question tokens to
       * cell values. This arm annotates every column uniformly, which is a different and weaker
       * treatment, and these counts are what say how much text the model was actually given.
       */
      value_samples:
        valuesCache.size === 0
          ? null
          : {
              databases: valuesCache.size,
              tables: [...valuesCache.values()].reduce((sum, entry) => sum + entry.stats.tables, 0),
              columns: [...valuesCache.values()].reduce((sum, entry) => sum + entry.stats.columns, 0),
              annotated: [...valuesCache.values()].reduce(
                (sum, entry) => sum + entry.stats.annotated,
                0,
              ),
            },
      sampling:
        folds.every((fold) => fold.sampling === null)
          ? null
          : {
              draws: folds[0]?.sampling?.draws ?? 0,
              temperature: folds[0]?.sampling?.temperature ?? 0,
              correct_draws: folds.reduce<number[]>((all, fold) => {
                const counts = fold.sampling?.correctDraws ?? [];
                for (const [right, count] of counts.entries()) {
                  while (all.length <= right) all.push(0);
                  all[right] = (all[right] ?? 0) + count;
                }
                return all;
              }, []),
              by_arm: Object.fromEntries(
                [...new Set(folds.flatMap((fold) => Object.keys(fold.sampling?.byArm ?? {})))].map(
                  (arm) => {
                    const parts = folds
                      .map((fold) => fold.sampling?.byArm[arm])
                      .filter((item): item is SelectionStats => item !== undefined);
                    const questions = parts.reduce((sum, item) => sum + item.questions, 0);
                    const votes = parts.reduce((sum, item) => sum + item.meanVotes * item.questions, 0);
                    return [
                      arm,
                      {
                        questions,
                        agreed: parts.reduce((sum, item) => sum + item.agreed, 0),
                        chose_empty: parts.reduce((sum, item) => sum + item.choseEmpty, 0),
                        nothing_ran: parts.reduce((sum, item) => sum + item.nothingRan, 0),
                        mean_votes: questions === 0 ? 0 : votes / questions,
                      },
                    ];
                  },
                ),
              ),
              selectors: folds.every((fold) => (fold.sampling?.selectors ?? null) === null)
                ? null
                : folds.reduce<Record<string, { asked: number; unparsed: number }>>((all, fold) => {
                    for (const [arm, account] of Object.entries(fold.sampling?.selectors ?? {})) {
                      const total = all[arm] ?? { asked: 0, unparsed: 0 };
                      all[arm] = {
                        asked: total.asked + account.asked,
                        unparsed: total.unparsed + account.unparsed,
                      };
                    }
                    return all;
                  }, {}),
            },
      /**
       * Whether the failure key found anything.
       *
       * A keyed arm that retrieves nothing on every question is a no-memory arm with a nicer
       * name; this number is what distinguishes "the key is wrong" from "the store had nothing to
       * say about this kind of failure".
       */
      failure_key: {
        asked: folds.reduce((sum, fold) => sum + fold.failureKey.asked, 0),
        hit: folds.reduce((sum, fold) => sum + fold.failureKey.hit, 0),
        /**
         * The two vocabularies, side by side.
         *
         * A key is only a key if the store and the retry speak the same language. The first run of
         * this arm asked 22 times and hit nothing, and the artefact could not say whether the
         * store lacked the code or the recall refused it; these two histograms answer that in one
         * look.
         */
        stored: folds.reduce<Record<string, number>>((all, fold) => {
          for (const [code, count] of Object.entries(fold.failureKey.stored)) {
            all[code] = (all[code] ?? 0) + count;
          }
          return all;
        }, {}),
        observed: folds.reduce<Record<string, number>>((all, fold) => {
          for (const [code, count] of Object.entries(fold.failureKey.observed)) {
            all[code] = (all[code] ?? 0) + count;
          }
          return all;
        }, {}),
      },
      /**
       * Whether the pack was about the question, and what accuracy did in each half.
       *
       * The number the whole line of work depended on and never had. A retrieval pipeline is
       * judged by what it retrieves, and this lane judged its own by accuracy alone — which
       * cannot tell "the memory is wrong" from "the memory never arrived".
       */
      retrieval_relevance: relevanceFor('full'),
      retrieval_relevance_repair: relevanceFor('full-repair'),
      retrieval_relevance_procedural: relevanceFor('full-procedural'),
      /**
       * What the repair memory actually contained, sampled from the first fold.
       *
       * The first run of this arm reported one active repair per fold and the artefact
       * could not say why: a store holding nothing and a store holding one generic item
       * look the same from the outside. The sample travels with the counts so a reader can
       * see the notes, and `distill_drops` says whether there were notes to see.
       */
      items_repair: (folds[0]?.repairItems ?? []).slice(0, 30),
      /**
       * What the grounding filter removed, because a pack of a quarter the size is a
       * different experiment if the reader cannot see that it is.
       */
      grounded_pack_share: (() => {
        const all = folds.reduce((sum, fold) => sum + fold.grounded.all, 0);
        const kept = folds.reduce((sum, fold) => sum + fold.grounded.kept, 0);
        return all === 0 ? 0 : Number((kept / all).toFixed(4));
      })(),
      validated_pack_differences: folds.reduce((sum, fold) => sum + fold.validatedPackDiffers, 0),
      validated_positions: folds.reduce((sum, fold) => sum + fold.validatedPositions, 0),
      distill_failed: folds.reduce((sum, fold) => sum + fold.failedDistill, 0),
      distill_created: folds.reduce((sum, fold) => sum + fold.created, 0),
      corrections_learned: folds.reduce((sum, fold) => sum + fold.learning.edited, 0),
      duplicate_questions_dropped: dataset.duplicates,
      // The preregistered floor, reported next to the number it qualifies.
      qualifying_questions: rows.length,
      direction_only: gates.some((gate) => gate.id === 'V9-subset-size' && !gate.pass),
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
    // The criterion that scored every number above, and the reading it was compared
    // against. Two names, because "accuracy" without one is not a number.
    scored_by: SEMANTICS,
    shadow_by: SHADOW_SEMANTICS,
    scored_disagreements: scoredDisagreements,
    paired_shadow: {
      n: pairedShadow.n,
      lost: pairedShadow.lost,
      gained: pairedShadow.gained,
      discordance: pairedShadow.discordance,
      p_value: pairedShadow.p,
      delta_pp: pairedShadow.delta * 100,
      ci_low_pp: pairedShadow.deltaCI.low * 100,
      ci_high_pp: pairedShadow.deltaCI.high * 100,
    },
    arms,
    contrasts,
    ...(priors === undefined ? {} : { prior: priors }),
    arm_pairs: armPairs,
    arm_pairs_shadow: armPairsShadow,
    gates,
    assertions,
    per_fold: folds.map((fold) => ({
      fold: fold.fold,
      eval: fold.eval,
      learn: fold.learn,
      edited: fold.learning.edited,
      unanswered: fold.learning.unanswered,
      distill_failed: fold.failedDistill,
      active: fold.activeRules,
      active_narrow: fold.narrowActive,
      active_repair: fold.repairActive,
      active_procedural: fold.proceduralActive,
      distill_drops: fold.distillDrops,
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
  await writeJson(ARTEFACT_ID, artifact);
  process.stdout.write(
    `[sota] n=${cases.length} without=${(paired.baselineAccuracy * 100).toFixed(2)}% ` +
      `with=${(paired.treatmentAccuracy * 100).toFixed(2)}% delta=${(paired.delta * 100).toFixed(2)}pp ` +
      `ci=[${(paired.deltaCI.low * 100).toFixed(2)}, ${(paired.deltaCI.high * 100).toFixed(2)}] ` +
      `p=${paired.p.toFixed(4)} min-detectable=${(detectable * 100).toFixed(2)}pp calls=${llm.stats.calls}\n`,
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
    const detail = failed.map((gate) => `${gate.id}: ${gate.actual}`).join('; ');
    throw new MicrogliaError('MG_E_CONFIG', `The benchmark ran but cannot support a claim (${detail})`, {
      failed: failed.map((gate) => ({ id: gate.id, actual: gate.actual, criterion: gate.criterion })),
    });
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[sota] failed: ${message}\n`);
  process.exitCode = 1;
});
