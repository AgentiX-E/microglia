/**
 * The L4 driver: run τ²-bench, with and without the memory, and return pass^k inputs.
 *
 * `bin/l4.ts` accepts a module exporting `run()` when `TAU_DRIVER` is set. This is
 * that module. It exists because the lane's reader is finished and tested, and the
 * only thing missing between "a run happened" and "a number exists" was something
 * that makes one happen.
 *
 * ## The protocol, and why each part of it is here
 *
 *  1. **Split the task set deterministically.** Sorted ids, half to train and half to
 *     hold out (`splitTaskIds`), so two dispatches learn from the same half.
 *  2. **Learn from the training half without memory.** Failures are read from
 *     upstream's own result document — `evaluation_criteria.actions` says which tool
 *     calls should have happened — and written into a fresh store as corrections.
 *  3. **Distil, then freeze.** The held-out half is answered by a memory that never
 *     saw it, which is the only arrangement in which the number means anything.
 *  4. **Evaluate with `microglia_agent`**, which recalls from a local facade over
 *     HTTP because the agent runs in another process. The facade serves exactly one
 *     endpoint: `GET /v1/recall`.
 *
 * With `TAU_MEMORY=false` the same driver runs the reference arm: the same tasks,
 * the same model, no store. That is the comparison pass^4 is computed against.
 *
 * Nothing here scores anything. τ²'s evaluator decides every reward; this file only
 * decides which tasks, which agent, and what the memory was told.
 */
import { execFile } from "node:child_process";
import { createServer, type Server } from "node:http";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  EmbeddedMemory,
  MemoryJournal,
} from "@agentix-e/microglia-core/memory";
import { openMicroglia } from "@agentix-e/microglia-core/capture";
import {
  createLlmInterpreter,
  parseCandidates,
  ruleInterpreter,
} from "@agentix-e/microglia-core/distill";
import {
  recallQueryOf,
  recallText,
  steppingClock,
  mulberry32,
  type RecallQuery,
} from "@agentix-e/microglia-core";
import {
  AS_IS_FLOOR,
  LlmClient,
  attestPairScope,
  ProviderNoMeasurementError,
  classifyProviderProbe,
  driverArgs,
  facadeArmTasks,
  facadePairSummary,
  facadePairVerdict,
  facadeScope,
  inactionCensusOf,
  redundancyOfSample,
  storeItemSample,
  inactionContrastOrNull,
  meanPassAtK,
  probeGate,
  resolveFacadePairPlan,
  treatmentDelivered,
  armRecordFromDriver,
  correctionEdit,
  heldOutPlan,
  learnableCorrections,
  parseStorePin,
  parseTauResults,
  parseTauTasks,
  pinnedLearn,
  assertQueryPinCovers,
  parseQueryPin,
  pinnedQueryText,
  queryCensusOf,
  qualifiedId,
  resilientInterpreter,
  resolveInjectionNotePlan,
  resolveWriteAdmissionPlan,
  resolveRecallFloor,
  stampDomain,
  directedSplit,
  splitFromOfficial,
  stoppedRun,
  storeCensus,
  funnelReading,
  funnelVerdict,
  declaredEmptyVerdict,
  resolveArmKind,
  declaresEmptyStore,
  noMeasurementRefusal,
  guardAgainstToolNames,
  noteFacadeReading,
  noteFacadeSummary,
  resolveDistillForm,
  resolveDistillScope,
  resolveConsolidation,
  resolveConsolidationKey,
  resolveConsolidationLinkage,
  resolveServeSupport,
  resolveSpeakCensus,
  resolveSpeakMargin,
  resolveDistillUnit,
  provenanceCensus,
  entitiesOf,
  faithfulnessLine,
  faithfulnessOf,
  guardReplaces,
  rawLogCensus,
  rawLogInterpreter,
  rawLogInterpreterFor,
  rawLogItemShape,
  DEFAULT_PACK_BUDGET,
  ceilingLineOf,
  packCensus,
  packLineOf,
  servedCensus,
  servedLineOf,
  resolveTraceClaims,
  tracesOf,
  yieldCensus,
  mergeCensusOf,
  claimsPerCorrection,
  traceOf,
  actionSentence,
  resolveFacadeNotePlan,
  armServeLine,
  armServeOf,
  tau2EditSemantics,
  toPassAtK,
  toolInventoryOf,
  trialRowsOf,
  unansweredTasks,
  type Correction,
  type CorrectionProvenance,
  type PassAtKInput,
  type TaskTrace,
  type Tau2ArmRecord,
  type Tau2Raw,
  type TauTask,
  type TauTrialRow,
  type UseObservation,
  type PairedFacadeReading,
  type InactionCensus,
  type NoteArmReading,
  type NotedFacadeReading,
  type PackReading,
  type ProbeAttempt,
  type ResilientInterpreter,
  type QueryCensus,
  type QueryPin,
  type Tau2EpisodeFailure,
  judgeOf,
  rehearsalLine,
  rehearsalRecordOf,
  resolveRehearsal,
  type RehearsalHalf,
  type RehearsalRecord,
  resolveRehearsalControl,
  type RecallInput,
} from "@agentix-e/microglia-eval";
import {
  maxStatementChars,
  type NoteMode,
  type ShapeMode,
} from "@agentix-e/microglia-core/apply";
import {
  PLANT_ENV,
  plantCensus,
  plantedDigest,
  plantSummary,
  plantedFor,
  plantedRendered,
  resolvePlantArm,
  validatePlanted,
  type PlantCensus,
  type PlantedDocument,
  type PlantedItem,
} from "../plant.js";
import { consolidateKnowledge } from "@agentix-e/microglia-core/distill";
import { consolidationLineOf, sweepConsolidation, sweepSummary } from "../consolidation-sweep.js";
import { retireBelowSupport, supportFloorLine, type SupportFloorResult } from "../tau2-support-floor.js";
import {
  resolveServeRotationPlan,
  rotationCapOf,
  rotationLine,
  rotationsOf,
  ServeRotationLedger,
  type ServeRotationReport,
} from "../serve-rotation.js";
import { speakLineOf } from "../tau2-speak.js";
import { turnCensusLine, turnCensusOf, type TurnCensus } from "../tau2-turn.js";
import type { Tau2PhaseUsage } from "../tau2-instrument.js";
import { cacheCensusVerdict } from "../cache-census.js";
import { shapeByTaskOf, tau2ShapeWithFallback } from "../tau2-shape.js";
import { runDistillPreflight, type PreflightReading } from "../distill-preflight.js";
import { replyCensus, replyCensusLine } from "../distill-replies.js";
import { writerOf } from "../distill-writer.js";
import { learnOnlyReason, silenceOf } from "../learn-only.js";
import { DISTILL_THINKING } from "../writer-probe.js";
import { startRecallFacade } from "../tau2-facade.js";
import {
  resolveShapeArmPlan,
  shapeArmReading,
  shapeArmSummary,
  shapeObservationOf,
  type ShapeArmReading,
  type ShapeArmRecord,
  type ShapeObservation,
} from "../shape-pair.js";
import { defaultPolicy } from "@agentix-e/microglia-core";
import type { ArmServe } from "@agentix-e/microglia-eval";

const runFile = promisify(execFile);

/** `packages/eval/{src,dist}/bin` → the repository root. */
const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const SCRIPT = join(REPO, "eval", "drivers", "tau2", "run_split.py");

/**
 * The three scenario names a run has.
 *
 * A within-scenario run has one name three times over, which is why one variable was enough until
 * R29 stage 2. A cross-domain arm needs all three to differ in exactly one combination: it learns
 * from `TAU_TRAIN_DOMAIN`, answers `TAU_TEST_DOMAIN`, and recalls under `TAU_RECALL_DOMAIN`, which
 * defaults to the learned scenario because that is the scope the items were stored with.
 *
 * The recall scope is the treatment. τ² items written by this driver carry `scope.domain` of the
 * scenario they were learned in, and recall filters by it, so a `retail` store answers an `airline`
 * question with nothing unless the facade asks in the store's own terms. Asking in the store's terms
 * is what a transfer arm *is*; the alternative — leaving the filter at the question's scenario —
 * would measure an empty pack and call it a null.
 */
const TEST_DOMAIN =
  process.env["TAU_TEST_DOMAIN"] ?? process.env["TAU_DOMAIN"] ?? "retail";
const LEARN_DOMAIN =
  process.env["TAU_TRAIN_DOMAIN"] ?? process.env["TAU_DOMAIN"] ?? "retail";
const RECALL_DOMAIN = process.env["TAU_RECALL_DOMAIN"] ?? LEARN_DOMAIN;
/**
 * Which of the three arms this process is running.
 *
 * `memory` and `reference` are the two `TAU_MEMORY` already named, resolved through one function so a
 * conflicting pair of variables is a refusal rather than a precedence. `scaffold` is R101: the wrapper
 * over a store that is empty by construction, which is the only arm that separates R93's −2.50pp into
 * a wrapper term and a pack term — the stock agent has no facade, no recall call and no `<rules>`
 * block, so the two arms R93 compared differ in two things at once. See `tau2-arm-kind.ts`.
 */
const ARM = resolveArmKind(process.env);
const MEMORY = ARM !== "reference";
/** Whether this arm declared its store empty before it ran, which two gates invert on. */
const DECLARED_EMPTY = declaresEmptyStore(ARM);
/**
 * R132: whether this dispatch also replays the learn half's own cases with the store.
 *
 * A second paid phase, so it is off unless a registration buys it. Refused here, at module load, when the arm
 * has no store: a reference arm has nothing to replay, and the alternative — running it and reporting "nothing
 * paired" — would spend an hour to say that the arm it was not meant for ran.
 */
const REHEARSAL = resolveRehearsal();
/** R133: whether this dispatch also bought the no-memory control the replay is compared with. */
const REHEARSAL_CONTROL = resolveRehearsalControl();
if (REHEARSAL && !MEMORY) {
  throw new RangeError(
    `a rehearsal replays a store and this arm is '${ARM}': there is nothing to replay, and the phase would ` +
      "buy a reading about a memory the arm does not have",
  );
}
/**
 * U3's only treatment knob. Unset (every dispatch before U3) resolves to zero,
 * so the facade keeps every hit and the as-is artefact stays comparable. A
 * non-zero value must be a registered grid rung declared by the dispatch's own
 * pre-registration; `resolveRecallFloor` refuses anything else rather than
 * silently clamping a floor that was chosen after the readout.
 */
const MIN_COVERAGE = resolveRecallFloor(process.env);
/**
 * R49's paired-facade switch, resolved once at module load. An unset variable
 * keeps the single-facade path verbatim, so every committed artefact before R49
 * stays comparable. The floored rung comes from `TAU_MIN_COVERAGE`, which the
 * workflow reads from the dispatch's own pre-registration.
 */
const PAIR_PLAN = resolveFacadePairPlan(process.env);
/**
 * R152's serving policy: how far one item may travel inside a phase.
 *
 * Resolved at module load like every other switch, and undeclared means the driver excludes nothing — the
 * request is byte-identical to every committed artefact's, which is what keeps a rotation arm comparable to
 * the arms it is measured against. The cap is *not* in the header: it is `ceil(requests / servable)`, computed
 * from the store this run actually built, because a constant would be a guess about a store the distiller has
 * not written yet, and a guess that does not bind is an arm that silently runs the identity.
 */
const ROTATION = resolveServeRotationPlan(process.env);
/**
 * The seed both facades must share. `run_split.py --seed` defaults to 300; in a
 * paired dispatch we pass it explicitly so common random numbers are an
 * attested property of the run rather than an accident of a Python default.
 * `Var(A - B) = 2 * sigma^2 * (1 - rho)` is why two dispatches of one
 * configuration are never a paired comparison (AUDIT 34.36).
 */
const PAIR_SEED = Number(process.env["TAU_EVAL_SEED"] ?? 300) || 300;
const DISPATCH_ID = process.env["GITHUB_RUN_ID"] ?? "";
const PREREG_ID = process.env["TAU_PREREG"] ?? "";
/**
 * Defect 27's pre-flight gate. Opt-in and registered by the R49 dispatch:
 * turning it on by default would change the call sequence of every earlier
 * dispatch, and an infrastructure failure must not be confused with a result.
 */
const PROVIDER_PROBE =
  (process.env["TAU_PROVIDER_PROBE"] ?? "").trim() === "true";
/**
 * U6's write-side switch, resolved at module load and off unless a dispatch names
 * it. Off is the store every earlier artefact was produced by: an upgrade must
 * not change the meaning of a committed number.
 */
const WRITE_ADMISSION_PLAN = resolveWriteAdmissionPlan(process.env);
/**
 * R53's pack-note switch, resolved at module load. Unset is today's note, so every
 * artefact committed before this module produced the same prompt it always did; `declared`
 * separates "this run is the standard arm" from "nobody set the switch", which a readback
 * that wants to compare three levels needs and a bare default cannot give it.
 */
const NOTE_PLAN = resolveInjectionNotePlan(process.env);
/**
 * R53's three-level arm, resolved at module load.
 *
 * Off by default, so every artefact committed before it is still produced by the path that
 * wrote it. Enabled is not "one more facade": it is the only arrangement in which three note
 * levels can be compared at all, because a dispatch's corrections are produced by the model
 * at run time and two dispatches of one configuration distil different stores. The plan also
 * refuses a dispatch that varies the floor and the note together, and one that names a single
 * note level beside a three-level arm -- both would publish a record that contradicts its own
 * treatment.
 */
const NOTE_ARMS = resolveFacadeNotePlan(process.env, PAIR_PLAN);
/**
 * R109a's two-unit arm, resolved at module load and after the note plan.
 *
 * Off by default, so every artefact committed before it is produced by the path that wrote it. Enabled
 * is the only arrangement in which the two units can be compared at all: R109 shipped a per-request
 * switch (`RecallQuery.shape`), and a switch renders one dispatch's packs one way — two dispatches
 * distil two stores, because a dispatch's corrections are produced by the model at run time.
 *
 * It is resolved after `NOTE_ARMS` because it refuses the combination: the note varies the sentence and
 * this varies the unit, and a dispatch carrying both could not say which one its delta belonged to.
 */
const SHAPE_ARMS = resolveShapeArmPlan(process.env, { pair: PAIR_PLAN, notes: NOTE_ARMS });
/**
 * R57's controlled distractor, resolved at module load.
 *
 * Unset is the control arm and no rule is planted, so every artefact committed before this module
 * produced the packs it always did. The rules are read from the committed file rather than authored
 * here: a rule written in this process could be written after seeing which episodes failed, and the
 * file's digest is what travels into the artefact to show that it was not.
 */
const PLANT_PLAN = resolvePlantArm(process.env);
/**
 * The committed rules, at one path and no other.
 *
 * Deliberately not an environment variable: a dispatch that could point at rules it did not commit
 * would make the digest in the artefact a digest of a file nobody can inspect, which is the one
 * property that stops an arm being authored after seeing which episodes it broke.
 */
const PLANTED_PATH = join(REPO, "eval", "planted", "retail.json");
const PLANTED: PlantedDocument | undefined =
  PLANT_PLAN.arm === "none"
    ? undefined
    : validatePlanted(
        JSON.parse(readFileSync(PLANTED_PATH, "utf8")) as PlantedDocument,
      );
const TRIALS = Math.max(1, Number(process.env["TAU_TRIALS"] ?? 4) || 4);
/**
 * Whether a phase may start inside a peak-rate window.
 *
 * The rate card doubles there, and the window is 09:00-18:00 in UTC+8, so an unguarded long run
 * is a doubled bill chosen by the operator's time zone. Off by default, because a ten-task smoke
 * run is cheap at any hour; on for every dispatch whose result will be quoted.
 */
const REQUIRE_OFF_PEAK = process.env["TAU_REQUIRE_OFF_PEAK"] === "1";
const TRAIN_SHARE = Number(process.env["TAU_TRAIN_SHARE"] ?? 0.5) || 0.5;
/**
 * How many tasks to draw before splitting; `0` means the whole set.
 *
 * A smoke run has to be affordable: the retail set is over a hundred tasks, and
 * four trials on both halves is hours. A cap changes the sample, not the protocol,
 * and the artefact records `n` so a small run cannot be read as a large one.
 */
const MAX_TASKS = Math.max(0, Number(process.env["TAU_MAX_TASKS"] ?? 0) || 0);
/**
 * Tasks each half keeps, after whatever split produced it; `0` means all of them.
 *
 * Separate from `MAX_TASKS` because the two caps answer different questions and a cross-domain arm
 * needs both at once: how large an evaluated sample the dispatch affords, and how many corrections
 * the store is built from. One cap for both would have made the foreign pack's size a function of
 * the evaluation budget.
 */
const TRAIN_TASKS = Math.max(
  0,
  Number(process.env["TAU_TRAIN_TASKS"] ?? 0) || 0,
);
const TEST_TASKS = Math.max(0, Number(process.env["TAU_TEST_TASKS"] ?? 0) || 0);
/**
 * The ceiling on one stored record, in characters; `0` means the module default.
 *
 * R85 ran with the default of 700 and clipped twelve of twelve records. 700 is R84's *trace*
 * statement ceiling minus the marker, and a trace statement is a summary of one call while a record is
 * a question plus an answer: the retail corpus puts the record at p50 744, p95 1260, max 1532
 * characters. The value comes from the registration header (`rawCeiling`) rather than a repository
 * variable for the reason every other switch does: a ceiling that lived in a variable would be decided
 * by whichever dispatch ran last, and this one changes what the arm measures.
 */
const RAWLOG_CEILING = Math.max(0, Number(process.env["TAU_RAWLOG_CEILING"] ?? 0) || 0);
/**
 * The learn half, frozen to the failures an earlier arm read; empty means learn as usual.
 *
 * R90's readback showed why this exists. The store is built from whichever learn tasks failed, the
 * learn half is one trial per task, and one trial of a sampled model is a draw: R89 wrote 12 corrections
 * and R90 wrote 15 from the same 57 tasks at the same one trial, with 8 ids in common. Two runs whose
 * registrations said "one variable" therefore differed by two, and no arithmetic could untangle them.
 * A pinned list makes the store a function of the corpus and the list, which is what lets the *next*
 * arm differ by one thing, and it costs 57 episodes less than rebuilding the half that produced it.
 *
 * The corpus is read rather than the previous run's document: a correction is written from
 * `evaluation_criteria.actions`, so the only thing the learn half decides is *which* tasks taught, and
 * that is a list small enough to review in a diff. The trace unit is refused with the pin, because a
 * trace arm's correction is written from an attempt this lane would no longer hold.
 */
const PIN_FILE = (process.env["TAU_PIN_FILE"] ?? "").trim();
/**
 * The corpus a pinned list is priced against: the pinned τ² checkout, and nothing else.
 *
 * Not a variable. A pin is only reproducible against the corpus it was drawn from, and a corpus chosen by
 * whichever dispatch ran last would be the same class of defect the pin exists to remove -- the treatment
 * decided by history rather than by the registration.
 */
function pinCorpusPath(domain: string): string {
  return join(REPO, ".tau2-bench", "data", "tau2", "domains", domain, "tasks.json");
}

/**
 * Whether this arm runs the benchmark's own halves rather than this lane's cut; empty means the cut.
 *
 * R92. τ² publishes `split_tasks.json` per domain — 74 train and 40 test for retail — and this lane has
 * always cut the 114 itself, so its held-out numbers were measured on a set the benchmark does not define
 * and no competitor's number was ever produced on them. The value is `official` or nothing: a share by
 * another name would be the same defect the key exists to remove.
 */
const TASK_SPLIT = (process.env["TAU_TASK_SPLIT"] ?? "").trim();
/**
 * R143: and the other direction of it.
 *
 * `official-swapped` runs the same document with the halves exchanged — the store learns from the 40 tasks
 * the benchmark holds out and answers the 74 it publishes as training. Alone that arm is a curiosity; beside
 * an `official` arm it is the second fold of a cross-fit over all 114 tasks, and the reason it is a value of
 * this key rather than a new header is that the boundary is still the benchmark's: no number decides it.
 */
if (TASK_SPLIT !== "" && TASK_SPLIT !== "official" && TASK_SPLIT !== "official-swapped") {
  throw new Error(
    `TAU_TASK_SPLIT is '${TASK_SPLIT}'; a document states 'official', and 'official-swapped' runs it backwards`,
  );
}

/**
 * The published halves for one scenario, read from the pinned τ² checkout.
 *
 * The existence check is R92's first dispatch, which died here: the file ships from τ² **v1.0.0**, the
 * lane had pinned v0.2.0, and the failure surfaced as a bare ENOENT inside a paid dispatch. A
 * registration that asks for the benchmark's halves against a release that has none is a registration
 * whose premise is false, and the refusal says which release fixes it rather than which file was
 * missing.
 *
 * The checkout and the release are parameters, not ambient state: the refusal is the whole point of the
 * function and a refusal nobody can call is a refusal nobody has tested. `splitPathIn` is that callable
 * form; the driver passes its own checkout and the release the workflow pinned.
 */
export function splitPathIn(checkout: string, domain: string, release: string): string {
  const path = join(checkout, "data", "tau2", "domains", domain, "split_tasks.json");
  if (!existsSync(path)) {
    throw new Error(
      `TAU_TASK_SPLIT is 'official' and ${domain}'s split file is not in this checkout: ` +
        `the benchmark's halves ship from tau2 v1.0.0, and this run pinned ${release === "" ? "unpinned" : release}`,
    );
  }
  return path;
}

function splitPathOf(domain: string): string {
  return splitPathIn(
    join(REPO, ".tau2-bench"),
    domain,
    (process.env["TAU_VERSION"] ?? "").trim(),
  );
}
/**
 * Read the query pin, or nothing when the dispatch declared none.
 *
 * Two refusals rather than a warning, both before the first episode is paid for: a file that is not there,
 * and a file too short for the phase. The second is the one that would otherwise be invisible — the facade
 * answers a failed recall by telling the agent to continue without memory, so an uncovered episode is an
 * episode that served no pack *and* an artefact that still calls itself pinned.
 *
 * The line it prints is the declaration, and `queries.pin` in the artefact is the record. R91 wrote the
 * first and not the second, and its central claim had to be graded by inference.
 */
function readQueryPin(file: string, episodes: number): QueryPin | undefined {
  if (file === "") return undefined;
  // A registration names a path in the checkout, and the artefact records that name rather than the
  // runner's absolute prefix: an artefact whose provenance changes with the machine that produced it
  // cannot be compared against one from another dispatch.
  const path = isAbsolute(file) ? file : join(REPO, file);
  if (!existsSync(path)) {
    throw new Error(`TAU_QUERY_PIN names ${file}, which is not in this checkout`);
  }
  const pin = parseQueryPin(JSON.parse(readFileSync(path, "utf8")) as unknown);
  assertQueryPinCovers(pin, episodes);
  process.stdout.write(
    `[tau2] queries pinned: ${String(pin.texts.length)} text(s) from ${pin.source}\n`,
  );
  return pin;
}
/**
 * The characters of knowledge one recall may carry; `0` means the module default of 1,200.
 *
 * It is a switch now for the reason the ceiling is: the two numbers are coupled and neither lane could
 * see the coupling. At 1,200 a record in this arm's shape can state 810 characters —
 * `maxStatementChars` measures it — so a registration that writes 2,000-character records is writing
 * text the pack drops at render, where it reads as a request with nothing relevant. A registration
 * states the budget in its header (`packBudget`) so the ceiling it writes can be checked against what
 * the pack can carry, and the census (`tau2-pack.ts`) prices any loss that remains.
 *
 * The default is the number every published arm ran with, so an arm that does not state one keeps the
 * reading it was published with.
 */
const PACK_BUDGET =
  Math.max(0, Number(process.env["TAU_PACK_BUDGET"] ?? 0) || 0) || DEFAULT_PACK_BUDGET;
/**
 * How many items the pack may serve, when the registration states a count.
 *
 * R134. `PACK_BUDGET` bounds a pack in characters and therefore leaves the *count* to how long the
 * distiller happened to write its records: R133's readback served 3.975 items and 2,239 of a 2,400
 * character budget on every request, and the census counted 161 items dropped for size over 40 requests.
 * An arm whose treatment is "one procedure instead of four" cannot state that with a length, so the count
 * is its own switch. Absent (`0`) keeps the host's room, which is what every earlier arm ran with.
 */
const PACK_LIMIT =
  Math.max(0, Number(process.env["TAU_PACK_LIMIT"] ?? 0) || 0);
/**
 * The interpreter that can import `tau2`.
 *
 * `uv sync` puts the benchmark in `.tau2-bench/.venv`, so the system `python3` on a
 * runner cannot import it — which is how the first smoke run failed: the driver was
 * found, the phase ran, and the import failed one layer below the orchestration.
 * The environment variable still wins, because a caller with a different layout
 * knows better than a guess.
 */
function pythonPath(): string {
  const explicit = process.env["TAU_PYTHON"];
  if (explicit !== undefined && explicit.trim() !== "") return explicit;
  const venv = join(REPO, ".tau2-bench", ".venv", "bin", "python");
  return existsSync(venv) ? venv : "python3";
}

const PYTHON = pythonPath();
const TASK = "tau2.act";
/**
 * The recall queries frozen to a list an earlier arm recorded; empty means ask the ones the simulator writes.
 *
 * R92. R91 held the store fixed and the pack still moved — `meanChars` 1,812.1 against 1,825.3, coverage
 * p50 0.2857 against 0.28 — because a pack is ranked on BM25 over the query and the query is the user
 * simulator's sampled first turn. The census below records those queries; this replays them, which is what
 * a pack experiment (one store, two floors, two diversities) needs and what an absolute benchmark number
 * does not: a fixed phrasing is a retrieval stimulus no user typed.
 *
 * The pin is keyed by the episode's position in the phase, because nothing upstream names the episode:
 * the agent sends `task=tau2.act` on every request and `generate_next_message` receives no task id.
 */
/**
 * The release this registration's number is about; empty means the registration makes no claim.
 *
 * R92. Two places can choose a benchmark release — the registration's header and `vars.TAU_VERSION` — and
 * before this the only thing comparing them was a failed dispatch. The header is the decision and the
 * variable is the machine, so a disagreement is refused here, before the first episode, rather than
 * discovered in an artefact whose number is about a corpus nobody named.
 */
const REGISTERED_RELEASE = (process.env["TAU_RELEASE"] ?? "").trim();

/**
 * The release the workflow pinned, which the identity record also carries.
 *
 * Read once so the refusal below and the artefact cannot disagree about what this run was.
 */
const PINNED_RELEASE = (process.env["TAU_VERSION"] ?? "").trim();

const QUERY_PIN_FILE = (process.env["TAU_QUERY_PIN"] ?? "").trim();

/**
 * Which τ² generation this arm ran, because a number is only comparable to one from the same release.
 *
 * R92's first dispatch died on `split_tasks.json`, which does not exist in the release the lane had
 * pinned: `data/tau2/domains/<domain>/split_tasks.json` arrived in v1.0.0, and v1.0.0 also rewrote
 * every retail task body (0 of 114 identical to v0.2.0's). The published held-out figure this lane
 * ranks itself against was produced on **v1.0.1**. So the release is part of the treatment, and an
 * artefact that does not carry it cannot say which benchmark its `pass^4` is about.
 *
 * The tag comes from the workflow's own pin and the commit from the checkout, because a tag can be
 * moved and a commit cannot: an arm that quotes a tag and no commit is an arm quoting a belief.
 */
export async function benchmarkIdentityOf(
  checkout: string,
  version: string,
): Promise<{ version: string; commit: string } | undefined> {
  if (!existsSync(checkout)) return undefined;
  try {
    const commit = await runFile("git", ["-C", checkout, "rev-parse", "HEAD"], {
      cwd: REPO,
    });
    return {
      version: version === "" ? "unpinned" : version,
      commit: commit.stdout.trim(),
    };
  } catch {
    // No git in the checkout is not a measurement failure: the version the workflow pinned is still
    // an answer, and a run that refused here would price an artefact above the episodes it paid for.
    return version === "" ? undefined : { version, commit: "unknown" };
  }
}

async function benchmarkIdentity(): Promise<
  { version: string; commit: string; judge?: string } | undefined
> {
  const identity = await benchmarkIdentityOf(join(REPO, ".tau2-bench"), PINNED_RELEASE);
  if (identity === undefined) return undefined;
  const judge = judgeOf(process.env);
  return judge === undefined ? identity : { ...identity, judge };
}

/**
 * The form this dispatch asks the distiller for.
 *
 * Read once, at module load, and recorded in the artefact from the same value: R56's `procedure` is
 * reverted to `lesson` (see `resolveDistillForm`), and a dispatch that overrides it must say so in
 * the record rather than in a comment.
 */
const DISTILL_FORM = resolveDistillForm();

/**
 * Whether this dispatch asks the distiller one fixture correction before buying the learn half.
 *
 * R111. Off unless a dispatch turns it on, because an extra call is an extra call in a sequence a
 * published arm's number was produced under. R104 is the arm that pays for it: it lost a learn half
 * to a distiller that answered fifteen corrections with fifteen empty replies.
 */
const DISTILL_PREFLIGHT = /^(1|true|yes)$/i.test(
  (process.env["TAU_DISTILL_PREFLIGHT"] ?? "").trim(),
);

/**
 * Whether this dispatch stops after the learning half, because the census is the reading.
 *
 * R118. R104 paid $1.21 for a `pass^4` that no design on this board can order — 40 tasks resolve
 * ±10pp, and two facades of the same dispatch differed by 17.5pp with no treatment. What that run
 * did establish was a census: 63 of 73 replies carried no visible character. R112 then excluded form
 * and model (8 of 8 pairs answer, `lesson` best), which leaves the regime the 73 calls ran under.
 *
 * Off unless a dispatch turns it on, for the reason every switch here is off by default: a published
 * arm's call sequence is part of what it measured, and a stop is the most visible change to it.
 */
const LEARN_ONLY = /^(1|true|yes)$/i.test((process.env["TAU_LEARN_ONLY"] ?? "").trim());

/**
 * The unit this dispatch distils, resolved once and recorded from the same value.
 *
 * R58. `correction` is the unit every published arm measured — one failed task, one sentence, one
 * rule — and it is the default because an upgrade must not change what a published number measured.
 * `trace` puts the attempt beside the reference trajectory and asks for up to three claims, which is
 * the only arrangement in which one claim can be derived by three tasks and `supportTasks` can reach
 * a recurrence threshold at all.
 *
 * Read at module load so a misspelt value refuses the run before the first model call, and recorded
 * so a reader of the artefact never has to infer which of the two produced the store.
 */
const DISTILL_UNIT = resolveDistillUnit();

/**
 * Whether the store's recurrence pass runs, R121's one variable.
 *
 * The pass has run only on the trace unit since R58, so the published unit has held one item per
 * correction with `supportTasks: 1` on every one of them while the merge census priced a third of the
 * store as recurrence. The switch is the registration's (R56's rule: a global would let a dispatch
 * publish the control under the treatment's name), and it is read here so a misspelt value refuses the
 * run before the first model call.
 *
 * `raw` is excluded whatever the header says: its "store" is one verbatim event per episode, and a
 * claim-merging pass over records that are not claims produces a third record no episode wrote — the
 * abstraction this arm is the control for.
 */
const CONSOLIDATE = resolveConsolidation() && DISTILL_UNIT !== "raw";

/**
 * Which key the pass uses, R124's one variable.
 *
 * Read here rather than at the call site so a misspelt value refuses the run before the first model call.
 * `scope` is the default and reproduces R121 exactly; `routine` is the arm.
 */
const CONSOLIDATE_KEY = resolveConsolidationKey();

/**
 * Whether that key filters pairs or only describes them, R139's one variable.
 *
 * Read here for the same reason as the key: an unrecognised value must refuse the run before the first
 * model call rather than fall back to the control under the treatment's name. `key` is what every
 * committed artefact measured; `all` is the arm, and the census carries the hidden-candidate count in
 * both so the pair of them is one measurement of one store.
 */
const CONSOLIDATE_LINKAGE = resolveConsolidationLinkage();

/**
 * How many distinct tasks must stand behind an item before it may be served, R141's one variable.
 *
 * Read here for the reason every resolver in this file is: a misspelt value must refuse the run before the
 * first model call rather than fall back to the control under the treatment's name.
 */
const SERVE_SUPPORT = resolveServeSupport();

/** Where the pass runs: the unit it has always run on, plus any unit a registration asked for. */
const CONSOLIDATION_RUNS = CONSOLIDATE || DISTILL_UNIT === "trace";

/**
 * How far ahead of its runner-up the best candidate must be for a pack to be served, R123's one variable.
 *
 * Read here rather than at the host so a misspelt value refuses the run before the first model call.
 * Unset is 0, which serves every non-empty pack and is the behaviour every committed artefact measured.
 */
const SPEAK_MARGIN = resolveSpeakMargin();

/**
 * R123a: record the margin census without gating on it.
 *
 * One switch, and it is not the same question as the margin: this arm spends nothing extra and produces
 * the ladder that decides the *next* arm's rung. Declaring a positive margin implies it.
 */
const SPEAK_CENSUS = resolveSpeakCensus();

/**
 * R199 — this arm, stated as the product's profile plus what the dispatch named.
 *
 * The host argument list used to write its own `budget`, `note`, `budgetBasis` and `speakMargin`, so the arm and
 * the shipped product agreed by convention. Two of those fields are set by a dispatch on every run, and a
 * treatment that moved a third was indistinguishable in the artefact from one that did not — which is exactly the
 * split R197a closed on the product side and left open here. The list below is the whole delta: an unset variable
 * is not listed, so the baseline arm *is* the product, and the line it prints says so.
 *
 * Values rather than the plan objects, because a plan carries three levels inside one run (R53's note arm); the
 * host argument is the one the run starts from.
 */
const ARM_SERVE = armServeOf([
  ...(PACK_BUDGET === DEFAULT_PACK_BUDGET
    ? []
    : [{ field: 'budget' as const, value: PACK_BUDGET, reason: 'TAU_PACK_BUDGET' }]),
  ...(NOTE_PLAN.mode === 'standard'
    ? []
    : [{ field: 'note' as const, value: NOTE_PLAN.mode, reason: 'TAU_INJECTION_NOTE' }]),
  // Declared with the note arm rather than alone: the hardened sentence is longer, so the accounting that pays for
  // it has to move with it or the three levels are not the same budget. See R53 in the prereg directory.
  ...(NOTE_ARMS.enabled
    ? [
        {
          field: 'budgetBasis' as const,
          value: NOTE_ARMS.budgetBasis,
          reason: "R53's note arm, whose hardened sentence needs the accounting to move with it",
        },
      ]
    : []),
  ...(SPEAK_MARGIN === 0
    ? []
    : [{ field: 'speakMargin' as const, value: SPEAK_MARGIN, reason: 'TAU_SPEAK_MARGIN (R123)' }]),
]);

/**
 * The longest statement the pack can carry under this arm, measured on the shape it writes.
 *
 * Absent for every unit but `raw`, and the absence is the honest reading: a claim's line is as long as
 * the model made its payload, so there is no single capacity to quote for it. For a record there is,
 * because the record's shape is the interpreter's — nineteen-character id, task-and-domain scope, the
 * provenance payload — and `maxStatementChars` renders one to find out. This is the number the ceiling
 * has to fit, and until R89 nothing anywhere compared the two.
 */
const RECORD_CAPACITY =
  DISTILL_UNIT === "raw" ? maxStatementChars({ budget: PACK_BUDGET }, rawLogItemShape) : null;

// R60: how many claims one trace may teach. Declared readback in the artefact, because two runs at
// two ceilings are two experiments and a store cannot say which one built it.
const TRACE_CLAIMS = resolveTraceClaims();

/**
 * The completion budget a distillation call is given in this lane.
 *
 * R84's defect, in the other lane, was a distiller whose ceiling was a literal at a call site while
 * the artefact published a different number — and R56's re-dispatch was read without knowing this
 * number at all. It is a named value for the same reason `distillBudget` is: a budget that no field
 * carries cannot be compared with the next run's, and a budget that is shared by two forms cannot be
 * the repair form's.
 *
 * τ²'s ceiling is its own rather than `distillBudget`'s because the unit is a sentence, not a
 * trajectory: the longest statement the parser accepts is 640 characters and the form asks for 240,
 * so 1,200 tokens is roughly four times the reply the schema can keep.
 *
 * **The regime is no longer inherited.** The first version of this comment said "the coupling to a
 * thinking regime is not wired here because this lane's distiller never thinks — this process's own
 * client sends no reasoning parameter", and the second half of that sentence is true while the first
 * half does not follow from it: a client that sends no parameter gets the **provider's default**,
 * which is not a statement about this lane. R104 is what it cost: 73 distillation calls, **63 replies
 * with no visible character**, six claims from ten answers, and an artefact that could not say
 * whether the model had spent its budget thinking. `thinking: 'off'` is now sent, which is what the
 * lane always claimed to run, and `distillClient` records the reasoning tokens the provider
 * attributes, so the next arm can price the difference instead of arguing about it.
 */
const DISTILL_TOKENS = 1_200;

/**
 * The client every distillation call in this lane goes through.
 *
 * One factory rather than two constructor calls, because the pre-flight and the arm must ask the same
 * provider under the same regime — a pre-flight that passed under one regime and an arm that ran
 * under another would certify a writer that never wrote. The regime is `DISTILL_THINKING`, a constant
 * this file no longer owns: the writer grid (`eval:writer-probe`) asks the same backend about the
 * same fixture, and two literals for one regime is how R104's `thinking` was inherited from an
 * endpoint default instead of being stated.
 */
function distillClient(maxCalls: number): LlmClient {
  return new LlmClient({
    apiKey: process.env["DEEPSEEK_API_KEY"] ?? "",
    model:
      process.env["TAU_DISTILL_MODEL"]?.trim() ||
      process.env["TAU_MODEL"] ||
      "deepseek-chat",
    maxCalls,
    thinking: DISTILL_THINKING,
  });
}

/**
 * Which trajectories teach this dispatch (R62).
 *
 * `edited` is every published arm; `all` also asks each task that passed what its successful
 * trajectory does. Read at module load so a misspelt value refuses the run before the first model
 * call, and recorded in the artefact from the same value, because a store cannot say which population
 * built it.
 */
const DISTILL_SCOPE = resolveDistillScope();

/** One `run_split.py` invocation, with its stdout surfaced on failure. */
async function phase(args: readonly string[]): Promise<string> {
  try {
    const finished = await runFile(PYTHON, args as string[], {
      cwd: REPO,
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env },
    });
    // The phase writes one summary line; the benchmark writes thousands of its own.
    // Printing the tail keeps a run's shape visible without turning the job log
    // into a transcript, and it is the only evidence that a phase ran at all when
    // the lane is green.
    //
    // The per-line prefix is stripped first: `run_split.py` tags the lines it wants seen with `[tau2]`
    // because a run read straight from a terminal has no one to add it, and re-emitting those verbatim
    // produced `[tau2] [tau2] …` in every dispatch log — which reads as two lines from two layers
    // instead of one line from one.
    const tail = [finished.stdout, finished.stderr]
      .filter((text) => text.trim() !== "")
      .map((text) =>
        text
          .trim()
          .split("\n")
          .slice(-2)
          .map((line) => line.replace(/^\[tau2\]\s*/, ""))
          .join("\n"),
      )
      .join("\n");
    if (tail !== "") process.stdout.write(`[tau2] ${tail}\n`);
    // The stdout is returned because the summary line is also the only channel on which the
    // in-process diagnostics of a phase can reach this process: `results.json` is upstream's
    // document and writing our own fields into it would make the reader parse a format nobody
    // specified.
    return finished.stdout;
  } catch (error) {
    const failure = error as {
      stdout?: string;
      stderr?: string;
      message: string;
    };
    const detail = [failure.stderr, failure.stdout]
      .filter(Boolean)
      .join("\n")
      .slice(-2000);
    throw new Error(`tau2 phase failed: ${failure.message}\n${detail}`);
  }
}

/** The best reward each task reached, which is what a correction is learned from. */
function bestRewards(text: string): Map<string, number> {
  const rewards = new Map<string, number>();
  for (const trial of parseTauResults(text).trials) {
    if (trial.reward === null) continue;
    const prior = rewards.get(trial.taskId);
    if (prior === undefined || trial.reward > prior)
      rewards.set(trial.taskId, trial.reward);
  }
  return rewards;
}

/**
 * One evaluated arm's document, read once and used for three things.
 *
 * The per-trial rows, the pass^k inputs and the unscored count all come from the same parse, so a
 * run cannot report a denominator from one reading and a ledger from another. Task ids are
 * qualified here, at the boundary, so everything downstream — the pair, the split, the ledger —
 * speaks the same names.
 */
function scoredArm(path: string): {
  readonly tasks: readonly PassAtKInput[];
  readonly unscored: number;
  readonly rows: readonly TauTrialRow[];
} {
  const run = parseTauResults(readFileSync(path, "utf8"));
  const scored = toPassAtK(run, TRIALS);
  const rows = trialRowsOf(run.trials, TEST_DOMAIN);
  observedTrials = rows;
  // The tasks that left the denominator, named the way the scored ones are.
  //
  // R92 published a pass^4 over 29 of 40 tasks with `unscored_tasks: 0` because this count had no
  // channel out of the process: `instrument().unscored` carried it and `l4.ts` did not read that
  // field on the driver path. The ids matter as much as the number — a gate can fail on a count, and
  // only a list says which tasks a reader has to look at before quoting the mean.
  observedUnscored = scored.unscored.map((id) => qualifiedId(TEST_DOMAIN, id));
  return {
    // A task the reader could not name is left unnamed rather than renamed into a name it does not
    // have: `PassAtKInput.taskId` is optional, and qualifying `undefined` would invent a task.
    tasks: scored.tasks.map((task) =>
      task.taskId === undefined
        ? task
        : { ...task, taskId: qualifiedId(TEST_DOMAIN, task.taskId) },
    ),
    unscored: scored.unscored.length,
    rows,
  };
}

/**
 * What `run()` saw, and the shape the protocol's gates read it in.
 *
 * Two functions rather than one return value because `l4.ts` was written against
 * `run(): Promise<readonly PassAtKInput[]>` and a driver that changed that signature would be a
 * driver the lane can no longer load. `instrument()` is additive: a caller that does not ask for it
 * gets exactly the behaviour it had before, and a driver that does not export it (every driver before
 * this one) is not a failure.
 */
let observed: Tau2Raw | undefined;

/** The last JSON line a phase printed, which is the channel its in-process diagnostics arrive on. */
function diagnosticsOf(stdout: string): Tau2PhaseDiagnostics | undefined {
  for (const line of stdout.trim().split("\n").reverse()) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(trimmed) as {
        diagnostics?: Tau2PhaseDiagnostics;
      };
      if (parsed.diagnostics !== undefined) return parsed.diagnostics;
    } catch {
      // A line that starts with `{` and is not JSON belongs to the benchmark's own output.
      continue;
    }
  }
  return undefined;
}

type Tau2PhaseDiagnostics = {
  readonly agent_turns?: number | null;
  readonly simulations?: number | null;
  readonly terminated?: Readonly<Record<string, number>> | null;
  /**
   * The episodes behind the census, with the reason τ² recorded for each.
   *
   * `terminated` says forty-four episodes ended in `INFRASTRUCTURE_ERROR`; it cannot say whether the
   * provider refused, the sandbox threw or a deadline expired, and R92 paid for a dispatch that
   * produced exactly that sentence and nothing a reader could act on.
   */
  readonly failures?: readonly Tau2EpisodeFailure[] | null;
  /** Per-episode action record; absent on every run before the abstention instrument. */
  readonly inaction?: unknown;
  /** Absent on every run before the counter existed, which is not the same as zero. */
  readonly usage?: Tau2PhaseUsage | null;
  /**
   * R123: what the recall facade was asked, served and withheld.
   *
   * Absent on a phase that ran no sidecar, and on every artefact before the counters reached the driver.
   * The speak line reads it, and a missing block makes that line say it cannot say rather than print a
   * zero — an arm at margin 0.05 that reports `withheld 0` is either a gate that never fired or a
   * counter that never ran, and only the presence of this block tells them apart.
   */
  readonly memory?: {
    readonly recall_url: string;
    readonly recalls: number;
    readonly recall_failures: number;
    readonly recall_empty: number;
    readonly silent_because: Readonly<Record<string, number>>;
    /**
     * R123a: the requests whose store returned at least two candidates, and what each rung of a margin
     * gate would withhold of them. `null` on a phase before the ladder existed, which is why these are
     * optional rather than defaulted: a `0` would read as a store with nothing contested.
     */
    readonly rivaled?: number | null;
    /**
     * R127: how many requests carried a census, which is the denominator `rivaled` is a zero over.
     *
     * R123a printed `0 rivaled request(s)` from a phase where the census never left the facade's process,
     * so a missing measurement and a measured zero were the same string in the log. The counter makes them
     * two, and it is read by `speakLineOf`.
     */
    readonly census?: number;
    readonly margin_p10?: number | null;
    readonly margin_p50?: number | null;
    readonly margin_p90?: number | null;
    readonly margin_ladder?: Readonly<Record<string, number>>;
    /**
     * R128: the request index at which each episode opened.
     *
     * One request per episode is an assumption, not a fact: `recall` fires once per episode but a retried
     * turn asks again, and R123a's phase spent **163 requests on 160 episodes**. A join that pairs the
     * ledger to trials by position therefore drifts at exactly the episodes that asked twice.
     */
    readonly episodeStarts?: readonly number[];
    /** R130: recalls inside an episode, which the boundary count is short by. */
    readonly recallRepeats?: number;
  } | null;
  /**
   * R125: the per-turn census, written by the half of the driver that holds the messages.
   *
   * Absent on every artefact before this instrument existed, and read as "cannot say" rather than as "no
   * wrong actions" — the distinction the whole module is built around.
   */
  readonly turnCensus?: unknown;
};

/**
 * R125: the census block for the artefact, or nothing when the phase wrote none.
 *
 * A helper rather than an inline spread so the census is read once: `turnCensusOf` sorts and copies rows,
 * and an artefact built from two calls could carry a block whose `measurable` disagrees with its own rows.
 */
function turnCensusBlock(
  diagnostics: Tau2PhaseDiagnostics | undefined,
): { readonly turnCensus?: TurnCensus } {
  const census = turnCensusOf(diagnostics);
  return census === undefined ? {} : { turnCensus: census };
}

/** The admission reasons, most frequent first, for the one line a run prints about its own store. */
function reasonsLine(reasons: Readonly<Record<string, number>>): string {
  const ranked = Object.entries(reasons).sort(
    (left, right) => right[1] - left[1],
  );
  return ranked.length === 0
    ? "none recorded"
    : ranked.map(([reason, count]) => `${reason}=${String(count)}`).join(", ");
}

/** How many of the run's episodes ended in something that is not a task outcome. */
function episodeFailures(
  diagnostics: Tau2PhaseDiagnostics | undefined,
): number {
  const terminated = diagnostics?.terminated ?? {};
  let failed = 0;
  for (const [reason, count] of Object.entries(terminated)) {
    if (/error|fail|timeout|max_steps|too_many/i.test(reason)) failed += count;
  }
  return failed;
}

/** Every episode the evaluated half produced, with its task named the way the record names it. */
let observedTrials: readonly TauTrialRow[] | undefined;

/**
 * The tasks of the evaluated half that have no verdict, named.
 *
 * Additive in the same way `trials()` is, and it exists because its absence was silent: the count
 * lived in `instrument().unscored` and the lane's driver path did not read it, so a run missing a
 * quarter of its sample published `unscored_tasks: 0` and certified the grid it had not seen.
 */
let observedUnscored: readonly string[] | undefined;

/** Additive export, so a lane written before this field keeps reading `run()` exactly as it did. */
export function unscoredTasks(): readonly string[] | undefined {
  return observedUnscored;
}

/** The one summary line a phase writes, found among the benchmark's thousands. */
export function phaseSummary(stdout: string): Record<string, unknown> | undefined {
  const lines = stdout.split("\n");
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = (lines[index] ?? "").trim();
    if (!line.startsWith("{")) continue;
    try {
      const parsed: unknown = JSON.parse(line);
      if (parsed !== null && typeof parsed === "object" && "phase" in parsed) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // A line that starts with `{` and is not JSON is the benchmark's, not ours.
    }
  }
  return undefined;
}

/**
 * The record a control arm can produce, which until R130 it produced none of.
 *
 * The reference path returned before `observed` was assigned, so **no control artefact has ever carried a
 * `tau2` block**: no usage, no cost, no turn census, no scenario. The pair then reported
 * `cache first (unstated): unmeasured`, and R125's paired turn reading could not fire on any run because the
 * half it is differenced against was absent — an instrument with a reader and a writer that only ever ran for
 * one of the two arms.
 *
 * The values come from the phase's own summary line, which is the only channel its diagnostics travel on: the
 * episodes run in a child process and `eval.json` is upstream's document. `train` is empty because this arm
 * learned nothing — the store it serves is empty by construction — and that absence is recorded rather than
 * filled with a zero that would read as a learning phase which produced nothing.
 */
export function controlRaw(
  summary: Record<string, unknown> | undefined,
  test: readonly string[],
  unscored: number,
): Tau2Raw {
  const diagnostics = (summary?.["diagnostics"] ?? {}) as Record<string, unknown>;
  const usage = diagnostics["usage"] as Tau2PhaseUsage | undefined;
  const failures = diagnostics["failures"] as readonly Tau2EpisodeFailure[] | undefined;
  const simulations =
    typeof summary?.["simulations"] === "number" ? (summary["simulations"] as number) : 0;
  // The phase's own bill, rebuilt from the two fields it always reports. `Tau2PhaseUsage.cost` is the
  // provider's partial view — a `usd` and a `band` — while an arm's cost block names the conversations it
  // divided by, so the divisor comes from the phase's simulation count rather than from a field that may not
  // be there. Absent when any part is: a bill with an invented denominator is not a reading.
  const bill =
    usage?.cost != null &&
    typeof usage.cost.usd === "number" &&
    typeof usage.cost.band === "string" &&
    simulations > 0
      ? {
          usd: usage.cost.usd,
          band: usage.cost.band,
          conversations: simulations,
          perConversation: usage.cost.usd / simulations,
        }
      : undefined;
  return {
    train: [],
    test,
    trials: TRIALS,
    unscored,
    servedPackSizes: [],
    learning: { rows: 0, unanswered: 0, edited: 0, distilled: 0, distillFailed: 0 },
    turns: {
      total: typeof diagnostics["agent_turns"] === "number" ? (diagnostics["agent_turns"] as number) : 0,
      failed: failures === undefined || failures === null ? 0 : failures.length,
      scope: "run",
    },
    scenario: { learn: LEARN_DOMAIN, test: TEST_DOMAIN, recall: RECALL_DOMAIN },
    domains: { stored: 0, withoutDomain: 0, unscopedIn: 0, widenedIn: 0 },
    declaredEmptyStore: DECLARED_EMPTY,
    ...(usage === undefined ? {} : { usage }),
    ...(bill === undefined ? {} : { cost: bill }),
    ...(failures === undefined || failures === null ? {} : { failures }),
    ...(diagnostics["turnCensus"] === undefined || diagnostics["turnCensus"] === null
      ? {}
      : { turnCensus: diagnostics["turnCensus"] }),
    ...(diagnostics["inaction"] === undefined || diagnostics["inaction"] === null
      ? {}
      : { inaction: diagnostics["inaction"] as InactionCensus }),
  };
}

/**
 * R199: what this arm is, relative to the product's profile.
 *
 * Exported because the acceptance is a *type* and a diff, not a paragraph: a test sets the dispatch's variables,
 * imports this module and asserts that the arm moved exactly the fields the dispatch named — and that the
 * baseline run (no variables) moved none at all.
 */
export function serveArm(): ArmServe {
  return ARM_SERVE;
}

/** The arm record the protocol's gates read, or `undefined` before a run has happened. */
export function instrument(): Tau2ArmRecord | undefined {
  if (observed === undefined) return undefined;
  // `ARM` rather than the default: the record's own `arm` field names which half of the pair it is, and a
  // control arm labelled `memory` is the kind of mislabelling a cache comparison then quotes.
  const record = armRecordFromDriver(observed, ARM);
  // Loud rather than silent: a key the projection table has no decision for is a field this run computed and
  // the artefact will not carry. R123 lost the sidecar's census this way — two printed lines, no field — so
  // the refusal is announced where the run ends rather than discovered by a reader who cannot tell a missing
  // reading from a reading of zero.
  if (record.unprojected !== undefined) {
    process.stderr.write(
      `[tau2] projection: ${record.unprojected.join(', ')} reached the driver and no decision in PROJECTION, so this arm carries none of them\n`,
    );
  }
  return record;
}

/** The one paired-facade record, when this dispatch registered a pair. */
let observedPair: PairedFacadeReading | undefined;

/** The three-level note record, when this dispatch registered one. */
let observedNotes: NotedFacadeReading | undefined;

/** The two-unit record, when this dispatch registered one. */
let observedShapes: ShapeArmRecord | undefined;

/**
 * Additive, like `instrument()`: `l4.ts` was written against a driver exporting
 * `run()`, and a driver that does not export this (every driver before R49) is
 * not a failure. A caller that asks for it gets the graded three-terminal
 * verdict, never a mean that still needs interpreting.
 */
export function pairedFacades(): PairedFacadeReading | undefined {
  return observedPair;
}

/**
 * R53's three-level note record, when this dispatch registered one.
 *
 * Additive in the same way: a driver that does not export this (every driver before R53) is
 * a single-note or paired-facade run, and its absence is not a failure.
 */
export function notedFacades(): NotedFacadeReading | undefined {
  return observedNotes;
}

/** R109a's two-unit record, when this dispatch registered one. Additive in the same way. */
export function shapeArms(): ShapeArmRecord | undefined {
  return observedShapes;
}

/**
 * The evaluated half's episodes, one row per trial.
 *
 * Separate from `instrument()` because it is a different size of thing: the record is a summary the
 * gates read, and this is the ledger the transfer measurement is paired over. A driver that returned
 * only the summary would make the cross-domain reading impossible without buying the run again.
 */
export function trials(): readonly TauTrialRow[] | undefined {
  return observedTrials;
}

/** The task ids one scenario holds, as τ² names them. */
async function listTasks(
  domain: string,
  out: string,
): Promise<readonly string[]> {
  // The listing is its own call: `driverArgs` models the two *running* phases, and
  // "what is in this task set" is a different question with a different answer.
  await phase([SCRIPT, "--domain", domain, "--phase", "list", "--out", out]);
  const listed = JSON.parse(readFileSync(out, "utf8")) as { tasks?: string[] };
  const ids = listed.tasks ?? [];
  if (ids.length === 0) throw new Error(`tau2 returned no tasks in ${domain}`);
  return ids;
}

/** A qualified id back to the scenario's own name, which is what τ² is asked to run. */
function unqualified(domain: string): (id: string) => string {
  const prefix = `${domain}/`;
  return (id) => (id.startsWith(prefix) ? id.slice(prefix.length) : id);
}

/** What the learn half produced, whether it was run or pinned. */
type LearnHalf = {
  readonly tasks: readonly TauTask[];
  readonly rewards: ReadonlyMap<string, number>;
  readonly traces: ReadonlyMap<string, TaskTrace>;
  /** Present only when the half was pinned, and written into the artefact so a reader can see it. */
  readonly pin?: { readonly source: string; readonly failures: number; readonly tasks: number; readonly corpus: string };
};

/**
 * Build the learn half: run it, or rebuild it from a pinned list of failures.
 *
 * Two branches and one return shape, because everything downstream -- the corrections, the trace map,
 * the unanswered count -- must read the same whether or not a model was asked. The pinned branch reads
 * the corpus the pin is priced against and refuses a trace unit: a trace correction is written from the
 * attempt a run observed, and a pinned list records no attempt.
 */
async function learnHalf(learnPath: string, train: readonly string[]): Promise<LearnHalf> {
  if (PIN_FILE === "") {
    await phase(
      driverArgs({
        script: SCRIPT,
        domain: LEARN_DOMAIN,
        phase: "learn",
        agent: "llm_agent",
        taskIds: train,
        trials: 1,
        out: learnPath,
        requireOffPeak: REQUIRE_OFF_PEAK,
      }),
    );
    const learned = readFileSync(learnPath, "utf8");
    // Parsed once: two readers of one document is two chances to describe two different documents,
    // and the trace arm's honesty depends on both halves coming from the same run.
    const learnedDocument = JSON.parse(learned) as unknown;
    const learnedTasks = parseTauTasks(learnedDocument);
    // The traces, only for the arm that reads them: `tracesOf` walks every message of every
    // simulation, and paying that on a correction arm would be work whose result the arm never uses.
    const traces: ReadonlyMap<string, TaskTrace> =
      DISTILL_UNIT === "trace" ? tracesOf(learnedDocument) : new Map<string, TaskTrace>();
    return { tasks: learnedTasks, rewards: bestRewards(learned), traces };
  }

  if (DISTILL_UNIT === "trace") {
    throw new Error(
      "a pinned store cannot serve the trace unit: its corrections are written from an attempt a pin does not carry",
    );
  }
  const corpus = pinCorpusPath(LEARN_DOMAIN);
  const pinned = pinnedLearn(
    JSON.parse(readFileSync(corpus, "utf8")) as unknown,
    parseStorePin(JSON.parse(readFileSync(PIN_FILE, "utf8")) as unknown),
    train,
    LEARN_DOMAIN,
  );
  process.stdout.write(
    `[tau2] learn half pinned: ${String(pinned.failures)} of ${String(pinned.tasks.length)} task(s) ` +
      `failed in ${pinned.pin.source}\n`,
  );
  return {
    tasks: pinned.tasks,
    rewards: pinned.rewards,
    traces: new Map<string, TaskTrace>(),
    pin: {
      source: pinned.pin.source,
      failures: pinned.failures,
      tasks: pinned.tasks.length,
      corpus,
    },
  };
}

export async function run(): Promise<readonly PassAtKInput[]> {
  const workdir =
    process.env["TAU_WORKDIR"] ??
    mkdtempSync(join(tmpdir(), "microglia-tau2-"));
  // R92: which τ² this is, asked before anything is paid for. The probe is an import plus a look at
  // the signatures the phases call, because v1.0.0 moved `run_tasks` to `(config, tasks)` and put
  // `get_tasks` in `tau2.runner.helpers` -- a mismatch costs two seconds here instead of an
  // installed environment, a built store and a phase that dies on its first task.
  // Before the probe and before anything is paid for: a registration whose number is about one release and a
  // dispatch pinned to another is not a run whose result means what its header says. R92 discovered this by
  // installing v0.2.0 against a registration asking for a file v0.2.0 does not ship, and the discovery cost
  // an environment, a corpus and an aborted phase; the comparison is one line and it is here now.
  if (REGISTERED_RELEASE !== "" && PINNED_RELEASE !== REGISTERED_RELEASE) {
    throw new Error(
      `the registration is about tau2 ${REGISTERED_RELEASE} and this dispatch pinned ` +
        `${PINNED_RELEASE === "" ? "no release" : PINNED_RELEASE}: the release is part of what the ` +
        `number means, and these two cannot both be true`,
    );
  }
  await phase([SCRIPT, "--phase", "selftest"]);
  const benchmark = await benchmarkIdentity();
  if (benchmark !== undefined) {
    process.stdout.write(
      `[tau2] benchmark: ${benchmark.version} at ${benchmark.commit.slice(0, 8)}\n`,
    );
  }
  const evaluated = await listTasks(
    TEST_DOMAIN,
    join(workdir, "test-tasks.json"),
  );
  const drawn = MAX_TASKS > 0 ? evaluated.slice(0, MAX_TASKS) : evaluated;
  // One listing serves both halves on one scenario; a cross-domain arm needs the second, and pays
  // for it with a call that returns ids it will never evaluate.
  const learnable =
    LEARN_DOMAIN === TEST_DOMAIN
      ? drawn
      : await listTasks(LEARN_DOMAIN, join(workdir, "learn-tasks.json"));

  const official =
    TASK_SPLIT === ""
      ? undefined
      : directedSplit(
          splitFromOfficial(
            JSON.parse(
              readFileSync(splitPathOf(TEST_DOMAIN), "utf8"),
            ) as unknown,
          ),
          TASK_SPLIT === "official-swapped",
        );
  const plan = heldOutPlan({
    learnIds: learnable,
    evalIds: drawn,
    learnScenario: LEARN_DOMAIN,
    testScenario: TEST_DOMAIN,
    trainShare: TRAIN_SHARE,
    trainCap: TRAIN_TASKS,
    evalCap: TEST_TASKS,
    ...(official === undefined ? {} : { official }),
  });
  if (official !== undefined) {
    // R143: which direction, because a swapped arm and a published-direction arm have the same file and
    // opposite halves, and a log that named only the file would make the two runs indistinguishable.
    const direction = TASK_SPLIT === "official-swapped" ? " (halves exchanged)" : "";
    process.stdout.write(
      `[tau2] split: the benchmark's own${direction} — ${String(plan.train.length)} learn / ` +
        `${String(plan.test.length)} held out\n`,
    );
  }
  if (plan.test.length === 0)
    throw new Error("tau2 split left no held-out task");
  // The plan's first invariant, re-checked where it is about to be paid for: a leak is the one
  // defect in this lane that produces a number rather than an error, so the run stops instead.
  const trained = new Set(plan.train);
  const leaked = plan.test.filter((id) => trained.has(id));
  if (leaked.length > 0)
    throw new Error(
      `tau2 plan leaked ${String(leaked.length)} task(s) into learning`,
    );

  // The record speaks in qualified ids and the benchmark in its own: both lists are kept because
  // neither naming is right for the other's job.
  const train = plan.train.map(unqualified(LEARN_DOMAIN));
  const test = plan.test.map(unqualified(TEST_DOMAIN));
  // R92: read the query pin before the first episode is paid for, not at the first recall. A pin that
  // cannot cover the phase would otherwise surface as a 500 inside an episode, and the agent treats a
  // failed recall by continuing without memory -- one episode silently served no pack while the artefact
  // would still call itself pinned.
  const queryPin = readQueryPin(QUERY_PIN_FILE, test.length * TRIALS);
  const scenario = {
    learn: LEARN_DOMAIN,
    test: TEST_DOMAIN,
    recall: RECALL_DOMAIN,
  };

  // Defect 27: the provider that distils the corrections and serves the agent
  // must answer before an hour of evaluation is spent on a store that was
  // never built. The probe is opt-in and registered by the R49 dispatch:
  // turning it on by default would change the call sequence of every earlier
  // dispatch, and an infrastructure failure must never become a zero. A
  // refusal throws `ProviderNoMeasurementError`, which `l4.ts` records as an
  // explicit artefact instead of a result.
  if (PROVIDER_PROBE) {
    const probeLlm = new LlmClient({
      apiKey: process.env["DEEPSEEK_API_KEY"] ?? "",
      model:
        process.env["TAU_DISTILL_MODEL"]?.trim() ||
        process.env["TAU_MODEL"] ||
        "deepseek-chat",
      maxCalls: 3,
    });
    const attempts: ProbeAttempt[] = [];
    for (let index = 0; index < 3; index += 1) {
      const started = Date.now();
      try {
        await probeLlm.chat("Reply with the single word ready.", 8);
        attempts.push({
          ok: true,
          status: 200,
          latencyMs: Date.now() - started,
        });
      } catch (error) {
        const matched = /\((\d{3})\)/.exec((error as Error).message);
        attempts.push({
          ok: false,
          ...(matched === null ? {} : { status: Number(matched[1]) }),
          latencyMs: Date.now() - started,
        });
      }
    }
    const verdict = classifyProviderProbe(attempts);
    const gate = probeGate(verdict);
    if (!gate.proceed) throw new ProviderNoMeasurementError(gate.marker);
    process.stdout.write(
      `[tau2] provider probe: ${verdict.state} over ${attempts.length} calls\n`,
    );
  }

  const evalPath = join(workdir, "eval.json");
  if (!MEMORY) {
    const summaryText = await phase(
      driverArgs({
        script: SCRIPT,
        domain: TEST_DOMAIN,
        phase: "eval",
        agent: "llm_agent",
        taskIds: test,
        trials: TRIALS,
        out: evalPath,
        requireOffPeak: REQUIRE_OFF_PEAK,
      }),
    );
    // The reference arm's episodes are as much a part of the transfer ledger as the memory arm's:
    // they are the control half of every pair, so they are recorded here rather than left in a
    // temporary file the job deletes.
    const scored = scoredArm(evalPath);
    // R130: and so is its bookkeeping. Until this line the control arm returned no instrument at all, which
    // is why the pair has reported `cache first (unstated)` on every dispatch and why R125's paired turn
    // reading could not fire: the half it differences against carried nothing to difference.
    const summary = phaseSummary(summaryText);
    observed = controlRaw(
      summary,
      scored.tasks.flatMap((task) => (task.taskId === undefined ? [] : [task.taskId])),
      scored.unscored,
    );
    return scored.tasks;
  }

  const learnPath = join(workdir, "learn.json");
  // R111: the distiller is asked one correction before the learn half is bought.
  //
  // R104 spent 74 episodes to obtain fifteen corrections and fifteen empty replies. The provider
  // probe would have passed that run: the endpoint answered, twice, in three hundred milliseconds.
  // What failed was the distiller, and the cheapest place to observe that is one call against a
  // fixture correction — this arm's form, this arm's population, no ban (the ban's inventory is
  // built from corrections that do not exist yet).
  //
  // Off by default, for the reason every added call is off by default here: a published arm's call
  // sequence is part of what it measured.
  let distillPreflight: PreflightReading | undefined;
  if (DISTILL_PREFLIGHT && !DECLARED_EMPTY && DISTILL_UNIT !== "raw") {
    const preflightLlm = distillClient(2);
    const preflightReplies: string[] = [];
    const preflightInterpreter = createLlmInterpreter({
      llm: {
        complete: async (prompt) => {
          const reply = (await preflightLlm.chat(prompt, DISTILL_TOKENS)).text;
          preflightReplies.push(reply);
          return reply;
        },
      },
      form: DISTILL_UNIT === "trace" ? "trace" : DISTILL_FORM,
      ...(DISTILL_SCOPE === "all" ? { passScope: true } : {}),
    });
    const reading = await runDistillPreflight(
      stampDomain(preflightInterpreter, LEARN_DOMAIN),
      { replyOf: () => preflightReplies.join("") },
    );
    distillPreflight = reading;
    process.stdout.write(
      `[tau2] distill pre-flight: ${reading.state} — ${reading.reason}\n`,
    );
    if (reading.state !== "answered") {
      throw noMeasurementRefusal(reading.reason, {
        preflight: reading,
        distill: {
          scope: DISTILL_SCOPE,
          form: DISTILL_UNIT === "trace" ? "trace" : DISTILL_FORM,
          unit: DISTILL_UNIT,
          model: preflightLlm.model,
          replies: preflightReplies.length,
        },
      });
    }
  }
  // R91: the learn half is either run or pinned, and the rest of this function cannot tell which --
  // that is the property that makes a pinned arm comparable to a rebuild rather than a parallel lane.
  //
  // R101 adds the third state and it is not a rewrite of either: a scaffold arm learns from nothing,
  // so the half it would have run is the empty one. The rest of this function reads `learned` the same
  // way it always did and the store that follows is empty by construction rather than by accident.
  // Paying for 74 learn episodes to obtain a store nobody reads would have cost the arm its own reason
  // for existing — it is the decomposition leg, and the decomposition is one held-out half wide.
  const learned: Awaited<ReturnType<typeof learnHalf>> = DECLARED_EMPTY
    ? { tasks: [], rewards: new Map<string, number>(), traces: new Map<string, TaskTrace>() }
    : await learnHalf(learnPath, train);
  const learnedTasks = learned.tasks;
  const traces = learned.traces;
  const rewards = learned.rewards;
  const corrections: Correction[] = learnableCorrections(learnedTasks, rewards, 1, DISTILL_SCOPE);
  // The two ways a training task can leave the store without a correction are not the same fact, and
  // V32 grades the difference: a task the model *passed* needed nothing, so a store built from every
  // failure is the store the arm was defined as; a task that *failed* and still taught nothing is a
  // question the record lost. The arithmetic here used to be `train.length - corrections.length`,
  // which counted every pass as a gap and would have failed a blocking gate on a run whose store was
  // exactly right; `unansweredTasks` is the same decision `learnableCorrections` makes, read the
  // other way round.
  const unanswered = unansweredTasks(learnedTasks, rewards).length;

  const store = await EmbeddedMemory.open(new MemoryJournal());
  // The distillation client speaks the endpoint's own REST shape, and `TAU_MODEL` names the model
  // the way litellm does because τ²'s Python half is a litellm caller. `LlmClient` translates the
  // alias, and `TAU_DISTILL_MODEL` exists for a caller that wants to say the REST id outright.
  // Empty is read as unset: a workflow variable that is not configured renders as `''`, and `??`
  // would have kept it.
  const llm = distillClient(Number(process.env["TAU_MAX_CALLS"] ?? 400) || 400);
  // The model first, the rules when the model fails on this event, and the run stopped when the
  // model fails on every event. See `tau2-distill.ts` for why this is the host's decision rather
  // than the combinator's.
  //
  // The parser's own count, taken at the only place that sees a claim the reply contained and the
  // store never will. `distillReport.candidates` is counted *after* this filter, so a run that reads
  // `0 candidate(s)` could not tell whether the model wrote nothing or the schema threw it away —
  // which is exactly the number R56's re-dispatch stopped on, and exactly the sentence it printed.
  const drops: Record<string, number> = {};
  const noteDrop = (reason: string): void => {
    drops[reason] = (drops[reason] ?? 0) + 1;
  };
  // R111: what came back, not only what survived.
  //
  // `drops` counts claims the parser threw away, and `candidates` counts what it kept, so the one
  // reply shape neither counter can see is a reply with *nothing in it*: fifteen empty arrays read
  // exactly like a model that was never asked. R104 stopped on that sentence — "nothing was thrown
  // away after the reply, so the model is what carried nothing" — and could not say whether the
  // reply was `[]`, `{"candidates":[]}`, or a sentence in prose, because the reply itself was
  // discarded before anything could record it. Kept here, at the only seam that sees the text.
  const replies = replyCensus();
  // R85: a raw arm asks the model nothing, so there is no primary interpreter that can fail and no
  // rule fallback to answer for it. The slot keeps the resilient pair's shape rather than becoming a
  // second code path, because every line below -- the fault counts, the form record, the ban -- reads
  // the same on all three units, and `faults()` is a constant zero the artefact still writes: an arm
  // that had no faults and an arm that never counted them are different records, and R58 is the
  // reason this project stopped conflating the two.
  const distiller: ResilientInterpreter =
    DISTILL_UNIT === "raw"
      ? {
          // The ceiling the registration stated, or the module default when it stated none. The
          // interpreter refuses a ceiling no record fits, so a mis-stated header fails at the arm
          // rather than after the episode is paid for.
          interpreter:
            RAWLOG_CEILING > 0 ? rawLogInterpreterFor(RAWLOG_CEILING) : rawLogInterpreter,
          // A raw arm asks nothing, so it has no faults and no claims from either side. The zero
          // is still a measurement: the fields are written rather than omitted, which is how an arm
          // that had no faults stays distinguishable from one that never counted them.
          faults: () => ({
            events: 0,
            answered: 0,
            primaryClaims: 0,
            fallbackClaims: 0,
            reasons: [],
            samples: {},
          }),
        }
      : resilientInterpreter(
          createLlmInterpreter({
            llm: {
              complete: async (prompt) => replies.note((await llm.chat(prompt, DISTILL_TOKENS)).text),
            },
            audit: noteDrop,
            // R56: the one variable. The `lesson` form asks `when` to name a property "the reader can
            // check on a different input: which tables or columns it involves" — an instruction written
            // for a database, which in a lane whose input is a customer asking to cancel an order can
            // only be satisfied by naming the tools. `procedure` asks for the trigger in the question's
            // own terms, and it is the form this lane has never run.
            // R58: the unit decides the form. A trace arm that kept the `lesson` guidance would ask a
            // model to name "which tables or columns it involves" of a conversation, which is the
            // measurement R54 made and R56 reverted; a correction arm that took the trace guidance would
            // be asked to compare an attempt it was never shown.
            form: DISTILL_UNIT === "trace" ? "trace" : DISTILL_FORM,
            // R62: the prompt names the shape a record without `expected` has, but only for a dispatch that
            // can produce one. A repair-only run reads exactly the prompt it read in R61, which is the
            // property that keeps a published arm's numbers comparable across the change.
            ...(DISTILL_SCOPE === "all" ? { passScope: true } : {}),
            // Three claims from one trace: the unit is richer, and a single sentence about a whole
            // episode is the object this registration exists to replace.
            ...(DISTILL_UNIT === "trace"
              ? { maxCandidates: TRACE_CLAIMS.ceiling }
              : {}),
          }),
          ruleInterpreter,
        );
  // The ban that makes the form real. A prompt cannot enforce itself, so a candidate whose statement
  // or condition names one of the tools this split learned from is refused at the host boundary and
  // counted. The inventory is built from the corrections themselves rather than from a constant: a
  // hand-written list would go stale the moment the scenario renames an action, and a stale ban is a
  // green reading on a store nobody constrained.
  // R120: the routine behind every correction, joined to the items it wrote. Built once, used by the
  // fold's key and by the store sample, so the census in the artefact and the unit the pack folded on
  // are the same function of the same corrections — a second derivation would let the two disagree
  // about the number that explains a null contrast.
  const shapeByTask = shapeByTaskOf(corrections);
  const shapeOf = tau2ShapeWithFallback(shapeByTask);
  const toolInventory = toolInventoryOf(corrections);
  const toolGuard = guardAgainstToolNames(toolInventory);
  // The domain on every claim is the host's, not the interpreter's: `parseScope` takes it from the
  // model's JSON, recall filters on it, and an item stored under a spelling no question asks in is
  // stored, counted, and unreachable. Both branches of the fallback are stamped, because the rules
  // write a scope of their own and a store half-keyed by the model and half by nobody is worse than
  // either. See `stampDomain` for why this is an override rather than a default.
  const interpreter = stampDomain(distiller.interpreter, LEARN_DOMAIN);
  const host = await openMicroglia({
    app: "microglia-l4",
    namespace: "tau2",
    store,
    interpreter,
    // R199: the product's profile plus the fields this dispatch named, instead of a hand-written argument list.
    // Every knob below that the profile owns arrives through this spread; a caller cannot set one outside it.
    ...ARM_SERVE.options,
    clock: steppingClock(1_700_000_000_000, 1),
    random: mulberry32(Number(process.env["TAU_SEED"] ?? 7) || 7),
    // A τ² correction is gold-verified by `evaluation_criteria.actions`, not judged
    // by a reviewer. `editDistance` would price it by how many arguments the tool
    // takes, which is what held all of R44's items as candidates. See
    // `tau2-admission.ts` for the measurement and the guarded condition.
    editSemantics: tau2EditSemantics,
    // R53: the three levels must serve the same items for the same request, and at a fixed
    // budget the hardened sentence is longer than the standard one and used to buy that room
    // by dropping the last rule. Carried by `ARM_SERVE` above, for the arm that needs it, because an
    // upgrade must not change what a published number measured.
    // R109: the host's half of the shape fold. The lane's records state their calls on an `A:` line and
    // nothing else knows that, so the vocabulary is declared here and the request only says which unit it
    // wants. A dispatch that declares `shape=per-failure` gets the same census over the same pack, which
    // is what makes the two arms one experiment.
    shapeOf,
    // R123: the gate on whether the pack speaks. Carried by `ARM_SERVE` above, only when the dispatch named
    // one, because a host that never heard of the option must serve the pack it always served.
    ...(SPEAK_CENSUS ? { speakCensus: true } : {}),
  });

  let withTrace = 0;
  // R60: one row per correction, so the yield can be attributed rather than averaged. The run id is
  // what an item's evidence cites, and it is known only here. R62 adds the provenance to the same row,
  // because the join an item's evidence makes is the only route from a stored claim back to the task
  // that taught it -- and without it the round cannot say which of the two populations a claim's
  // support came from.
  const captured: {
    taskId: string;
    runId: string;
    assertions: number;
    provenance: CorrectionProvenance;
    // R85: the entities this correction itself stated, carried on the capture row because the join
    // back to the store is the evidence's own run id and nothing else about the correction survives
    // into the item it produced.
    entities: readonly string[];
  }[] = [];
  for (const correction of corrections) {
    const trace = traces.get(correction.taskId);
    if (trace !== undefined) withTrace += 1;
    const handle = host.begin({
      task: TASK,
      // R55.0's instrument. `EvidenceRef.taskId` is what makes the store's support countable per
      // task, and this call never set it: every item's evidence therefore fell back to its run id,
      // one run per correction, and `distinctTasks` was 1 for every item by construction. That is
      // not a store with no recurrence, it is a store whose recurrence could not be recorded — the
      // distinction R55's own refutation turns on. The id is the correction's, so a claim derived
      // from one task twice counts once and a claim derived from two tasks counts twice.
      taskId: correction.taskId,
      // R51: the question, not its id. The distiller's prompt asks for a trigger
      // "in the question's own terms" and reads `run.input.question` to find them;
      // this field carried `correction.taskId`, so the model was asked to write in
      // the terms of a number. The id stays beside it, because a task id is what a
      // ledger, a split and a pair join on, and it must not be mistaken for a
      // question by anything downstream.
      input: {
        question:
          correction.instruction === ""
            ? correction.taskId
            : correction.instruction,
        taskId: correction.taskId,
        domain: LEARN_DOMAIN,
        schemaDigest: LEARN_DOMAIN,
        // R58: the attempt beside the reference trajectory. Absent when the learning document
        // recorded no simulation for this task, which the artefact counts as `untraced` rather than
        // as a trace with no calls in it — the two read the same in a store and are different runs.
        ...(trace === undefined
          ? {}
          : traceOf(trace, {
              // R62: a record made from a passing trajectory has no reference to differ from, and the
              // payload says so rather than offering it the gold path as though the attempt had missed
              // it. Two shapes, one decision, made here because this is the only place that knows
              // which population the record came from.
              ...(correction.provenance === "passed"
                ? { met: true }
                : {
                    expected: correction.actions.map((action) =>
                      actionSentence(action),
                    ),
                  }),
              ...(correction.assertions.length === 0
                ? {}
                : { rubric: correction.assertions }),
            })),
      },
      model: llm.model,
      promptVersion: "tau2/1",
      domainPack: "tau2",
    });
    captured.push({
      taskId: correction.taskId,
      runId: handle.id,
      assertions: correction.assertions.length,
      provenance: correction.provenance,
      entities: entitiesOf(correction.actions),
    });
    await handle.complete({
      actions: correction.actions.map((action) => action.name),
    });
    // The corrected output differs from the completion by construction -- an edit that changes
    // nothing is refused by the capture layer, and a rubric-only correction would be refused for
    // every such task. See `correctionEdit`.
    await handle.edit(correctionEdit(correction), {
      note: correction.statement,
    });
  }
  // The report, not just the store: `failed` is the count that explains an empty store, and
  // discarding it is what made the first cross-domain dispatch unreadable. `fatal` is passed so a
  // provider that has stopped answering stops the run here — before an hour of evaluation is spent
  // on a pack the store never built.
  const distillReport = await host.distill({
    generalize: false,
    fatal: stoppedRun,
    // R85: the ban exists to force a claim past the tool names, and a record *is* the call that
    // names them. Applying it to a raw arm would refuse every candidate and evaluate an empty store
    // under the arm's name -- which is the failure mode this repository has already paid for once,
    // in R41. The ban is therefore not installed for this unit, and the census below records that it
    // was off rather than leaving a reader to infer it from `refused: 0`.
    ...(DISTILL_UNIT === "raw" ? {} : { accept: toolGuard.accept }),
    ...(WRITE_ADMISSION_PLAN.mode === "off"
      ? {}
      : { admission: WRITE_ADMISSION_PLAN.options }),
  });
  // R58: the recurrence pass, over the store the distiller just wrote.
  //
  // Only for the trace arm, and only after the write: the pass answers a question about a *finished*
  // store ("which of these items are one claim, and how many tasks stand behind each?"), which is a
  // question no write-side rule can ask — R55.0's store of seven items with one task each and a store
  // of three items with two or three tasks each are identical from the write path's point of view.
  //
  // Recorded even when it changes nothing, because "the pass ran and found no recurrence" and "the
  // pass did not run" are different findings, and the artefact has to be able to tell them apart.
  //
  // The store as the distiller wrote it, read once and used twice: as the pass's input, and as the
  // population the yield is counted over. The two must be the same read, because a pass that folded
  // two claims into one leaves the survivor citing both runs and the retired item citing its own,
  // and a yield counted after it would report one claim twice. See `claimsPerCorrection`.
  const written = await store.listKnowledge({});
  // R85: the other half of the memory tax, measured where it is decided -- at the write. Nothing here
  // calls a model: the entities are the corrections' own argument values and the text is what the
  // store kept, so the number is a property of the writer and can be recomputed from any artefact
  // that carries both. `Memory Tax` reports the same quantity as "detail survival at write", and it
  // is the one failure mode six nulls on this lane could not be told apart from.
  // The form travels with the number, because `0 of 667 kept` means a writer that destroyed detail under a
  // form that permits the case and a form that was *instructed* to abstract it, and three rounds read the
  // second as the first. The trace unit asks for `trace` whatever the header says, so the label follows the
  // unit rather than the registration.
  const faithfulness = faithfulnessOf(
    captured,
    written,
    guardReplaces,
    DISTILL_UNIT === "trace" ? "trace" : DISTILL_FORM,
  );
  process.stdout.write(`[tau2] ${faithfulnessLine(faithfulness)}\n`);
  // R89: the ceiling against the pack, said at the write rather than discovered at the read. A ceiling
  // above the capacity writes records the renderer drops, and a dropped record has read as "nothing was
  // relevant" in every artefact this lane produced. Printing it here prices the decision before the
  // first episode is paid for.
  if (RECORD_CAPACITY !== null) {
    process.stdout.write(
      `[tau2] ${ceilingLineOf({
        ceiling: RAWLOG_CEILING > 0 ? RAWLOG_CEILING : undefined,
        budget: PACK_BUDGET,
        capacity: RECORD_CAPACITY,
      })}\n`,
    );
  }
  // R62: which population each claim came from, joined through the evidence's own run id. Taken here,
  // from the store as the distiller wrote it, for the same reason the sweep is: the pass below folds
  // items together, and a census over the folded store would attribute a merged claim to whichever of
  // its two records the survivor happened to cite first.
  const provenance = provenanceCensus(captured, written);
  // R124: the linkage key. `scope` is the pass's own default and reproduces R121; `routine` supplies the
  // routine each correction taught — the same function the fold's key and the merge census share — so a
  // store whose items spell one routine eight ways is bucketed by the routine rather than by the spelling.
  const consolidationOptions = {
    now: Date.now(),
    policy: defaultPolicy,
    ...(CONSOLIDATE_KEY === "routine"
      ? { keyOf: (entry: Parameters<typeof shapeOf>[0]) => shapeOf(entry) }
      : {}),
    // R139: the key the block above chooses is a prior, not a verdict. `all` stops it removing pairs;
    // the guards below still decide whether two items state one claim, so the arm is "look everywhere"
    // rather than "merge everything".
    ...(CONSOLIDATE_LINKAGE === "all" ? { linkage: "all" as const } : {}),
  } as const;
  // Not for the raw unit, and the reason is the arm rather than the pass: a record is one event, and
  // merging two records by statement similarity produces a third record neither episode wrote --
  // which is exactly the abstraction this arm is the control for. The pass is a claim-merging pass;
  // `written` on this unit is not a set of claims. `CONSOLIDATION_RUNS` carries that exclusion, and it
  // is the only gate left: R121 asked for the pass on the correction unit and got it by stating so.
  const consolidation = CONSOLIDATION_RUNS
    ? consolidateKnowledge(written, consolidationOptions)
    : undefined;
  // R61: what every floor in the grid would have done with this store, at the setting the pass just
  // ran at and at the ones it did not. Computed before any evaluation so the reading is a property
  // of the store rather than of the episodes, and from `written` rather than from the pass's output,
  // because a sweep over already-consolidated items would report the last pass's answer for ever.
  const consolidationSweep = CONSOLIDATION_RUNS
    ? sweepConsolidation(written, {
        ...consolidationOptions,
        threshold: consolidation?.report.threshold ?? 0.6,
        conditionMinShared: consolidation?.report.conditionMinShared ?? 0,
      })
    : undefined;
  if (consolidationSweep !== undefined) {
    for (const line of sweepSummary(consolidationSweep)) {
      process.stdout.write(`[tau2] sweep: ${line}\n`);
    }
  }
  if (consolidation !== undefined) {
    // R121: the point the pass actually ran at, before the grid that prices the alternatives. The sweep
    // printed nine rows and not this one, so a refutation arrived as one row among nine.
    process.stdout.write(`[tau2] consolidation: ${consolidationLineOf(consolidation.report)}\n`);
    for (const item of consolidation.items) await store.putKnowledge(item);
  }
  // R141: the support floor, applied after the recurrence pass and before anything is served. It runs here
  // rather than in the recall path because the recall path is a different process and a filter there would be
  // a second implementation of a rule the store's own vocabulary already states (`statusReason`).
  let supportFloor: SupportFloorResult | undefined;
  if (SERVE_SUPPORT > 1) {
    // A second read, because the pass above wrote its survivors back: the floor has to price the store the
    // recall path will open, not the one the distiller wrote.
    const stored = await store.listKnowledge({});
    supportFloor = retireBelowSupport(stored, SERVE_SUPPORT, Date.now());
    for (const item of supportFloor.items) {
      if (item.statusReason === "support-floor") await store.putKnowledge(item);
    }
    process.stdout.write(`[tau2] ${supportFloorLine(supportFloor)}\n`);
  }
  const faults = distiller.faults();
  // The reasons, not only the count: eleven of fifteen events answered by the fallback is a fact,
  // and *which* error they threw is the fact that names the fix. Counted here because `faults()`
  // lives in this process and the artefact is the only thing that outlives it.
  const faultReasons = faults.reasons.reduce<Record<string, number>>((counts, code) => {
    counts[code] = (counts[code] ?? 0) + 1;
    return counts;
  }, {});
  // The store's census, taken here rather than after the evaluation, because the funnel's last stage
  // is what decides whether there is anything to evaluate. R42 paid an hour of pack-free evaluation to
  // learn that the store was empty; the predicate that answers it exists and is tested, and this is
  // its second call site (the gate is the first, the readback the third).
  // One read of the store, shared by the census, the funnel and the domain ledger: three reads of
  // one store in a row would be three chances to describe three slightly different stores.
  const knowledge = await store.listKnowledge({});
  // R120: one projection of the store, used by both diagnostics blocks. Two calls would be two samples of
  // one store, and a reader comparing the learn-only census with the evaluator's could not tell that from a
  // store that changed between them.
  const storeItems = storeItemSample(knowledge, { shapeOf });
  const census = storeCensus(knowledge, RECALL_DOMAIN);
  const funnel = {
    corrections: corrections.length,
    // The count that sits between the batch and the reply, recorded because `candidates` cannot see
    // it: `events` is what the distiller was asked about, and `drops` is what the parser did with the
    // answers. Without both, a zero at the candidate stage is three different facts wearing one
    // sentence -- an event that never arrived, a reply that was emptied, and a reply that was empty.
    asked: distillReport.events,
    dropped: { ...drops },
    candidates: distillReport.candidates,
    admitted: distillReport.created + distillReport.merged,
    stored: knowledge.length,
    servable: census.servable,
    refused:
      distillReport.rejectedUnsafe +
      distillReport.rejectedBorrowed +
      distillReport.rejectedByHost,
    failed: distillReport.failed,
  };
  const distillDiagnostics = (): Readonly<Record<string, unknown>> => ({
    funnel,
    // R118 wrote a store and did not carry it. The artefact from that dispatch held a complete
    // census — 73 of 73 answered, 143 candidates, 86 stored — and not one word of what the 86 said,
    // because `storeItems` was written only on the path that goes on to evaluate. The next question
    // after "how many" is always "which ones", and answering it then cost another dispatch.
    //
    // The sample carries its own `omitted` count rather than pretending to be the store, and the
    // census beside it is whole: a reader can see the six kinds, the status split and the reasons
    // without a second run, and a store larger than the sample says so.
    store: census,
    storeItems,
    // R120: how many distinct claims the store contains, by the consolidator's own key. Taken from the
    // sample that ships beside it, so the number and the text it was read from travel together — and it
    // costs nothing, because it is arithmetic over statements the run already paid for.
    redundancy: redundancyOfSample(storeItems),
    yield: yieldCensus(claimsPerCorrection(captured, knowledge)),
    // R141: the floor the recall path was left with, when this dispatch applied one. A refusal that says
    // `0 servable` over a store of seventy items is unexplained without it, and the two causes it separates
    // — a floor that retired everything, and a distiller that wrote nothing — have different fixes.
    ...(supportFloor === undefined ? {} : { supportFloor }),
    distill: {
      scope: DISTILL_SCOPE,
      unit: DISTILL_UNIT,
      form: DISTILL_UNIT === "trace" ? "trace" : DISTILL_FORM,
      model: llm.model,
      replies: { ...replies.reading() },
      // The client's own count, beside the replies the seam saw. Two numbers that must agree: a
      // distiller that answered fifteen events and a client that made fifteen calls is a model
      // choosing silence, and a client that made none is a pipeline that never asked.
      client: { calls: llm.stats.calls, failures: llm.stats.failures },
      faults: { events: faults.events, reasons: faultReasons, samples: faults.samples },
      report: {
        created: distillReport.created,
        merged: distillReport.merged,
        superseded: distillReport.superseded,
        contradicted: distillReport.contradicted,
        quarantined: distillReport.quarantined,
        suppressed: distillReport.suppressed,
        rephrased: distillReport.rephrased,
      },
    },
    // The population question, priced at nothing: a fold needs two tasks behind one routine, and
    // this is the count of routines that have them. An arm whose treatment is the fold and whose
    // census reads `atLeastTwo: 0` could not have measured its claim whatever the distiller did.
    merge: mergeCensusOf(corrections),
    learn: {
      tasks: train.length,
      corrections: corrections.length,
      unanswered,
      traces: traces.size,
      traced: withTrace,
    },
    // The corrections themselves, bounded: five is enough to recognise a population, and an
    // artefact is a document rather than a dump.
    corrections: corrections.slice(0, 5).map((correction) => ({
      taskId: correction.taskId,
      provenance: correction.provenance,
      actions: correction.actions.length,
      assertions: correction.assertions.length,
      instructionChars: correction.instruction.length,
      statementChars: correction.statement.length,
      traced: traces.has(correction.taskId),
    })),
  });
  // The arm is defined by reading traces. A learning document that carried none — an older τ²
  // whose writer did not persist simulations, or a parse that met a different shape — would distil
  // the correction arm's object under the trace arm's name, and report the control's store as the
  // treatment's. Refused before the expensive half of the dispatch, like every other empty store.
  if (DISTILL_UNIT === "trace" && withTrace === 0) {
    throw noMeasurementRefusal(
      `the trace arm read 0 traces from ${String(corrections.length)} correction(s): the learning document carries no simulate messages, so the unit under test did not run`,
    );
  }
  const funnelState = DECLARED_EMPTY ? declaredEmptyVerdict(funnel) : funnelVerdict(funnel);
  if (!funnelState.ready) {
    // A run whose pipeline did not carry anything has no reading to publish, and evaluating it would
    // spend the expensive half of the dispatch producing a number about an empty store. Recorded as
    // no-measurement rather than as a failure: the provider answered, the distiller ran, and what
    // broke is the chain between them.
    //
    // The declared-empty arm reaches this line with the other predicate rather than with an exemption:
    // `declaredEmptyVerdict` passes only when every stage carried nothing, so a scaffold arm that
    // quietly distilled an item is refused here instead of being graded as the control.
    //
    // R111: the stop carries the census it was drawn from. This is the artefact class with no result
    // in it, so its whole value is diagnostic — and it kept one sentence. R104's stop printed
    // "0 candidates" and could not say whether the store had any routines to fold (which decides
    // whether the arm could have measured anything even with a distiller that worked), what the
    // replies looked like, or how the corrections were shaped. All of it was in this process.
    throw noMeasurementRefusal(funnelReading(funnel, funnelState), distillDiagnostics());
  }
  // R118: the stop when the census is the reading.
  //
  // The score a full dispatch produces cannot be ordered against anything on this board: forty tasks
  // resolve ±10pp on the difference, and two facades of R104's one dispatch differed by 17.5pp with no
  // treatment at all. The census is the informative half, and it is complete by this line — the store
  // is written, the replies are counted, and the four states are separated. What the stop keeps is
  // `distillDiagnostics()` unchanged, so a learn-only artefact and a refused one describe the same run
  // in the same keys; what it adds is the one sentence that says which state the silence was in.
  if (LEARN_ONLY) {
    const silence = silenceOf(replies.reading());
    process.stdout.write(`[tau2] learn-only: ${silence.state} — ${silence.sentence}\n`);
    throw noMeasurementRefusal(learnOnlyReason(silence), {
      ...distillDiagnostics(),
      silence: {
        state: silence.state,
        blankShare: silence.blankShare,
        emptyShare: silence.emptyShare,
      },
    });
  }
  // The domain ledger, from the store rather than from the driver's intentions: an item that lost its
  // domain somewhere nobody instrumented is exactly what V44 exists to catch.
  const withoutDomain = knowledge.filter(
    (item) => item.scope.domain === undefined,
  ).length;
  process.stdout.write(
    `[tau2] learn: ${String(corrections.length)} correction(s) from ${String(train.length)} task(s), ` +
      `${String(unanswered)} unreadable, ${String(distillReport.events)} asked, ` +
      `${String(distillReport.candidates)} candidate(s) ` +
      `(${String(Object.values(drops).reduce((sum, count) => sum + count, 0))} dropped: ` +
      `${reasonsLine(drops)}), ${String(distillReport.created)} created, ` +
      `${String(distillReport.failed)} failed, ${String(census.stored)} item(s) in the store ` +
      `(${String(census.active)} active, ${String(census.servable)} servable in ${RECALL_DOMAIN}), ` +
      `${String(faults.events)} fell back to the rule interpreter ` +
      `(${String(faults.answered)} answered, ${String(faults.fallbackClaims)} claim(s)), reasons ` +
      `${faults.events === 0 ? 'none' : reasonsLine(faultReasons)}\n`,
  );
  // The specimen beside the category: a code says how many and this says what. One line per code,
  // because eleven samples of one failure say no more than the first.
  if (faults.events > 0) {
    for (const [code, sample] of Object.entries(faults.samples)) {
      process.stdout.write(`[tau2] distill fault ${code}: ${sample}\n`);
    }
  }
  const replyReading = replies.reading();
  // R114: which writer wrote the store, which the two lines above state but nothing joins. The pair
  // is a model and a rule interpreter, and `63 answered by the rule fallback` beside `6 created` is
  // the whole finding: the arm evaluates the fallback's store. Derived rather than left to a reader,
  // because a reader has to know both lines to see it and three iterations did not.
  const writer = writerOf({
    asked: distillReport.events,
    faults: faults.events,
    primaryClaims: faults.primaryClaims,
    fallbackClaims: faults.fallbackClaims,
  });
  process.stdout.write(`[tau2] distill writer: ${writer.state.toUpperCase()} — ${writer.sentence}\n`);
  // R111: the replies, on one line, because "0 candidates" has four causes and only three of them
  // were countable before this. R114 adds the fourth: a reply with no visible character, which the
  // first version counted as healthy and left to the interpreter's preview — and the interpreter's
  // preview was empty, so the run printed `0 empty` beside 63 faults with nothing to quote.
  process.stdout.write(`[tau2] distill replies: ${replyCensusLine(replyReading)}\n`);
  process.stdout.write(
    `[tau2] admission: measured=${String(census.admission.measured)} ` +
      `trust=${census.admission.trustMean.toFixed(4)} ` +
      `support=${census.admission.supportMean.toFixed(4)} ` +
      `confidence=${census.admission.confidenceMean.toFixed(4)} ` +
      `supportOnly=${String(census.admission.supportOnly)}\n`,
  );
  // What the write path decided, on the same line as what it produced: a store of N items
  // built from M claims is only interpretable beside the count that was refused. Off prints
  // zeros, because 'not measured' and 'measured zero' are different facts everywhere else in
  // this lane and must be here too.
  process.stdout.write(
    `[tau2] write-admission: mode=${WRITE_ADMISSION_PLAN.mode} ` +
      `rephrased=${String(distillReport.rephrased)} ` +
      `suppressed=${String(distillReport.suppressed)}\n`,
  );
  // R199: what this arm is, relative to the product, printed before the first episode is paid for. The line
  // beside it in the artefact is the same object; this one is what a reader of a workflow log sees.
  process.stdout.write(`[tau2] serve: ${armServeLine(ARM_SERVE)}\n`);
  process.stdout.write(
    `[tau2] injection-note: mode=${NOTE_PLAN.mode} declared=${String(NOTE_PLAN.declared)}\n`,
  );
  // R57: the arm, its digest, and how often the band was reached. Printed before the run rather
  // than only recorded in the artefact, because a band that collapsed is worth knowing about before
  // an hour of evaluation is spent on it.
  if (PLANTED !== undefined) {
    process.stdout.write(
      `[tau2] plant: arm=${PLANT_PLAN.arm} env=${PLANT_ENV} digest=${plantedDigest(PLANTED)} ` +
        `rules=${PLANTED.rules.length}\n`,
    );
  }
  // R54: three conditions, verbatim, on the run's own page. A count of conditions cannot be
  // read for register, and register is the whole question the next arm asks of this store.
  for (const item of knowledge.slice(0, 3)) {
    process.stdout.write(`[tau2] store condition: ${item.when ?? "(none)"}\n`);
  }
  process.stdout.write(
    `[tau2] distill model: configured=${llm.configuredModel} sent=${llm.model}\n`,
  );

  /**
   * What a facade serves, as the three values a second facade has to reproduce to serve the same memory.
   *
   * R132 reads it: a rehearsal of a memory the run does not ship would answer a question about an arm nobody
   * dispatched, and the alternative — restating the floor, the note and the unit at the call site — is a copy
   * that drifts the first time an arm is refined.
   */
  type FacadeTreatment = {
    readonly floor: number;
    readonly note?: NoteMode;
    readonly shape?: ShapeMode;
  };

  /**
   * One facade's evaluation over the same held-out split, against the ONE
   * distilled store.
   *
   * Every counter belongs to this facade alone. R48's defect was that two
   * readings came from different dispatches; mixing their counters here would
   * recreate the same defect one layer down. In paired mode the seed is passed
   * explicitly to `driverArgs`, so common random numbers are an attested
   * property rather than an accident of `run_split.py`'s default of 300.
   */
  type FacadeEvaluation = {
    readonly treatment: FacadeTreatment;
    readonly scored: ReturnType<typeof scoredArm>;
    readonly diagnostics: Tau2PhaseDiagnostics | undefined;
    readonly servedPackSizes: number[];
    /**
     * One reading per served pack, for the census that separates "nothing was relevant" from
     * "everything relevant was too long to render".
     *
     * Kept as the packs themselves rather than as counts so the split is derived in `packCensus` from
     * what the renderer did, not reconstructed here from two numbers that could disagree with it.
     */
    readonly packReadings: PackReading[];
    readonly recallRequests: number;
    readonly recallServed: number;
    /**
     * R92: what retrieval was asked, which no arm recorded before this one.
     *
     * Taken from THIS facade's phase for the same reason every counter above is: R48's defect was two
     * readings from different dispatches.
     */
    readonly queryCensus: QueryCensus;
    readonly useObservations: UseObservation[];
    /**
     * R109a: one row per served pack, in the terms a unit comparison is read in.
     *
     * Taken at the same boundary and in the same loop as `packReadings`, because it describes the same
     * object: the control's assertion is about the ids and the size of the pack the model actually read,
     * and a second reading taken anywhere else would let the two disagree.
     */
    readonly shapeObservations: ShapeObservation[];
    /**
     * The observations the coverage curve is built from.
     *
     * The same as `useObservations` unless this facade ran behind another one: a
     * paired dispatch grades the gated facade, and its observations have already
     * passed the floor, so a histogram over them prices every floor at or below it
     * as free. R49 is the case in point — 0 and 0.01 both retain 1164 pairs in the
     * floored facade, while the as-is facade of the same run served 1435 packs
     * against 949.
     */
    readonly coverageObservations?: UseObservation[];
    /** Whether the agent acted at all in each episode, reduced to per-task counts. */
    readonly inaction: InactionCensus;
    /**
     * R57: the level the distractor was planted at, and whether it landed in its band.
     *
     * Absent on the control arm, which planted nothing — the absence is the reading that says this
     * dispatch was the control rather than an arm whose census came back empty.
     */
    readonly plant?: PlantCensus;
    /**
     * R152: the serving policy this arm declared, and what it did.
     *
     * Absent on every arm before the switch. A declared identity (`off`) carries the mode and no reading, so an
     * artefact can tell "this dispatch named the control" from "this dispatch never heard of the switch" — the
     * distinction the pool needs to refuse pooling the two as one experiment.
     */
    readonly rotation?: ServeRotationReport;
  };

  const evaluateFacade = async (
    floor: number,
    out: string,
    note?: NoteMode,
    shape?: ShapeMode,
  ): Promise<FacadeEvaluation> => {
    // What V1 grades: the pack is rendered in this process and read in another,
    // so its size is counted at the boundary rather than reconstructed from the
    // agent's transcript. A mean over no request and a mean over two hundred
    // empty answers are both 0, which is why the served tally is kept too.
    const servedPackSizes: number[] = [];
    const packReadings: PackReading[] = [];
    let recallRequests = 0;
    let recallServed = 0;
    // What each served pack actually contained, at the facade boundary. The
    // recall scope, the floor and the pack are exactly as R45 ran them.
    const useObservations: UseObservation[] = [];
    // R109a: the pack in the terms a unit comparison is read in. Pushed at both serving sites, beside
    // `packReadings`, because it describes the same object at the same instant.
    const shapeObservations: ShapeObservation[] = [];
    // R57: one reading per request that received the planted rule. The rule is appended to the
    // rendered block rather than added to the store, because the registration asks for exactly one
    // rule in every pack — an item the store merely held would be retrieved on the requests that
    // resemble it, which is the confound the arm exists to remove.
    const plantReadings: PlantedItem[] = [];
    let plantCreatedBlock = 0;
    // R92: every question retrieval was asked, in the order the phase asked it. The position is the key
    // because the facade is never told which task an episode belongs to -- the agent sends
    // `task=tau2.act` on all 228 requests -- so an episode IS its position here.
    const recallInputs: RecallInput[] = [];
    // R152: the travel budget for THIS phase, computed from the store this run built rather than written in a
    // header. A fair share of the requests the phase will make over the items the floor left servable — forty
    // requests and eleven servable items is a cap of four, which still covers the phase, so the arm differs
    // from its control in *allocation* and not in how often the memory speaks. Where the arithmetic cannot
    // cover the phase (three items against seventy-five requests) the ledger is the identity, and the reading
    // prints that rather than the registration's intention.
    const rotationCap =
      ROTATION.mode === "fair-share"
        ? rotationCapOf({ requests: test.length * TRIALS, servable: census.servable })
        : undefined;
    const rotation = rotationCap === undefined ? undefined : new ServeRotationLedger(rotationCap);
    if (rotationCap !== undefined) {
      process.stdout.write(
        `[tau2] serve rotation: fair share declared, cap ${String(rotationCap.cap)} per item ` +
          `(${String(rotationCap.requests)} request(s), ${String(rotationCap.servable)} servable item(s))\n`,
      );
    }
    const facade = await startRecallFacade(async ({ text, query }) => {
      const index = recallInputs.length;
      // The pin replaces the *retrieval* query and not the user's message: the episode still reads the
      // phrasing the simulator wrote, and only what the pack is ranked on is held fixed.
      const used = queryPin === undefined ? text : pinnedQueryText(queryPin, index);
      recallInputs.push({ index, asked: text, used });
      // The request's knobs first, then the two this file owns: the task label the store is scoped to,
      // and the scope itself. The registration's floor is the fallback and not the value, so an arm that
      // asks for `minCoverage=0` is served the pack it declared instead of the one the header rescued.
      //
      // R152: the ids this request may not be served, from the ledger and from the request itself. The two
      // are concatenated rather than one winning, because they answer different questions — the wire's list
      // is the caller's, the ledger's is this phase's — and a rule that let one override the other would be
      // a policy about precedence that no registration asked for.
      const rotated = rotation?.next();
      const withheld = [...(query.exclude ?? []), ...(rotated?.exclude ?? [])];
      const pack = await host.recall({
        ...query,
        task: TASK,
        text: used,
        scope: { domain: RECALL_DOMAIN },
        minCoverage: query.minCoverage ?? floor,
        // R134: the count the registration declared, when it declared one. The request's own `limit`
        // still wins, for the reason the floor's does: an arm that asks for a count is served the pack it
        // asked for, and the header is the fallback rather than the value.
        ...(query.limit === undefined && PACK_LIMIT > 0 ? { limit: PACK_LIMIT } : {}),
        // R53: the level is a rendering option of THIS recall. `undefined` keeps the host's,
        // which is what every single-facade and paired dispatch does.
        ...(note === undefined ? {} : { note }),
        // R109a: the unit, for the same reason and with the same default. The host declares how to
        // recognise a routine (`shapeOf`, below); the request says which unit this arm wants.
        ...(shape === undefined ? {} : { shape }),
        ...(withheld.length === 0 ? {} : { exclude: withheld }),
      });
      // Charged before the pack is used and after it is built: what the ledger counts is the store's answer,
      // so an empty pack charges nothing and a folded pack charges the items behind its one line.
      rotation?.record(rotationsOf(pack));
      const planted =
        PLANTED === undefined
          ? undefined
          : plantedFor(PLANT_PLAN.arm, used, PLANTED);
      if (planted === undefined || PLANTED === undefined) {
        recallRequests += 1;
        if (pack.items.length > 0) recallServed += 1;
        servedPackSizes.push(pack.items.length);
        packReadings.push({
          ids: pack.ids,
          truncated: pack.truncated,
          rendered: pack.rendered,
          ...(pack.fold === undefined ? {} : { fold: pack.fold }),
          // R127: the in-process half of the margin census, so the ladder the Python half prices from the
          // wire has a second count on the side that measured it. Absent when the host asked for neither.
          ...(pack.decision === undefined ? {} : { decision: pack.decision }),
        });
        shapeObservations.push(shapeObservationOf(used, pack));
        useObservations.push({
          // The query the pack was ranked on, which is the only text a coverage reading is about.
          query: used,
          statements: pack.items.map((item) => item.statement),
          // R51 made condition + statement the document the floor is applied to; this is the
          // same document, so the histogram cannot score a pack by text the floor never saw.
          documents: pack.items.map(recallText),
          // R93: which record, not only how many. The ids were already in this process and the
          // artefact could only ever report their count, so no readback could say which of fifteen
          // records a 162-request run actually used.
          ids: pack.ids,
        });
        return pack;
      }
      const injection = plantedRendered(pack.rendered, planted.rule, {
        // The host's own budget, so a pack that had room keeps it: the appended line is the only
        // difference between this pack and the control's.
        budget: pack.budget,
        scope: { task: TASK, domain: RECALL_DOMAIN },
        ...(note === undefined ? {} : { note }),
      });
      if (injection.created) plantCreatedBlock += 1;
      plantReadings.push(planted);
      // Counted as served, and counted as one item larger: the planted rule is in the prompt, and a
      // served tally that omitted it would describe a pack the agent did not read.
      recallRequests += 1;
      recallServed += 1;
      servedPackSizes.push(pack.items.length + 1);
      // The host's pack, before the planted line: the census prices the budget the store's items
      // competed for, and the appended rule is not one of them.
      packReadings.push({
        ids: pack.ids,
        truncated: pack.truncated,
        rendered: pack.rendered,
        ...(pack.fold === undefined ? {} : { fold: pack.fold }),
      });
      // The host's pack again: the planted line is not a store item and the containment control is about
      // what the store's units were, so an arm that added a line would otherwise be read as a fold that
      // invented one.
      shapeObservations.push(shapeObservationOf(used, pack));
      useObservations.push({
        query: used,
        statements: [
          ...pack.items.map((item) => item.statement),
          planted.rule.statement,
        ],
        documents: [...pack.items.map(recallText), recallText(planted.rule)],
        // The planted rule is not a store item and has no id, so it is absent here: an id invented
        // for it would join to nothing in `storeItems` and read as a record the store does not hold.
        ids: pack.ids,
      });
      return { ...pack, rendered: injection.rendered };
    }, { task: TASK });
    let evalStdout = "";
    try {
      evalStdout = await phase(
        driverArgs({
          script: SCRIPT,
          domain: TEST_DOMAIN,
          phase: "eval",
          agent: "microglia_agent",
          taskIds: test,
          trials: TRIALS,
          out,
          memoryUrl: facade.url,
          requireOffPeak: REQUIRE_OFF_PEAK,
          ...(PAIR_PLAN.enabled ? { seed: PAIR_SEED } : {}),
        }),
      );
    } finally {
      await facade.close();
    }
    const diagnostics = diagnosticsOf(evalStdout);
    // Printed after the phase, so the line reports what the rotation did rather than what it intended: the
    // reading carries the renders each item actually took, and a cap the ranking never reached is visible as
    // `max 3` under `cap 4` — the check that the arm bound anything at all.
    //
    // One read, used twice. The report was first built beside the ledger — before the loop — which is the
    // natural place for the mode and the wrong place for the reading: it shipped `requests: 0`, `renders: 0`,
    // `exhausted: []` and `maxRenders: 0` beside a log line that said forty renders over fourteen items. The
    // artefact would have been the only file in the lane that disagreed with its own run, and the test that
    // caught it asserted the request count against the requests the phase made.
    const rotationReading = rotation?.reading();
    if (rotationReading !== undefined) {
      process.stdout.write(`[tau2] ${rotationLine(rotationReading)}\n`);
    }
    // The report and the ledger are two objects on purpose: the mode is what the dispatch declared and belongs in
    // the artefact whether or not a ledger ran, while the reading only exists for a policy that acted. `off`
    // therefore ships `{ mode: 'off' }` and is distinguishable from an arm that never mentioned the switch.
    const rotationReport: ServeRotationReport | undefined =
      ROTATION.mode === undefined
        ? undefined
        : { mode: ROTATION.mode, ...(rotationReading ?? {}) };
    return {
      // The three arguments this facade was asked for, so a second phase can serve the same memory without
      // restating them. Recorded from the parameters rather than from the branch that called them.
      treatment: {
        floor,
        ...(note === undefined ? {} : { note }),
        ...(shape === undefined ? {} : { shape }),
      },
      scored: scoredArm(out),
      diagnostics,
      servedPackSizes,
      packReadings,
      recallRequests,
      recallServed,
      queryCensus: queryCensusOf(
        recallInputs,
        queryPin === undefined ? {} : { pin: QUERY_PIN_FILE },
      ),
      useObservations,
      shapeObservations,
      // The census is taken from THIS facade's phase, for the same reason every counter above is:
      // R48's defect was two readings from different dispatches, and sharing one census between two
      // facades would recreate it one layer down.
      inaction: inactionCensusOf(diagnostics, TEST_DOMAIN),
      ...(PLANTED === undefined
        ? {}
        : {
            plant: plantCensus(
              PLANT_PLAN,
              plantReadings,
              PLANTED,
              plantCreatedBlock,
            ),
          }),
      ...(rotationReport === undefined ? {} : { rotation: rotationReport }),
    };
  };

  /**
   * R132: the store on the cases it was written from.
   *
   * The learn half ran every training task with **no** memory and its rewards are already in `rewards`. This
   * phase runs the same tasks again through a facade over the same store, so the two reward sets pair by task
   * and answer the question no held-out number can: whether an item repairs the failure it was distilled from.
   *
   * Four decisions here, each of which is a way the reading could have been about something else:
   *
   *  - **Its own facade, and no collector behind it.** The packs this phase serves are the store answering its
   *    own cases, so counting them in `recall.requests`, `useObservations` or the query census would price a
   *    second experiment into the first arm's retrieval numbers — R48's defect one layer down. The two counters
   *    kept are the ones the reading needs: how many requests the facade answered, and how many carried an item.
   *  - **The treatment of the arm being graded.** Floor, note and unit come from `primary.treatment`, because a
   *    rehearsal of a memory the run does not ship answers a question about an arm nobody dispatched.
   *  - **One trial, and the same reduction on both sides.** The learn half ran one trial per task; the replay
   *    runs one, and both are reduced with `bestRewards`, so a task is one cell on each side. A replay at four
   *    trials against a learn half at one would compare episodes to cases and report the store on a population
   *    its own learning never saw.
   *  - **No query pin.** `TAU_QUERY_PIN` holds *the eval's* phrasings fixed so two arms are asked the same
   *    question; a replay of the learn half's questions is not that population, and pinning it would rank the
   *    store on a query no learn episode ever wrote.
   */
  const rehearsalHalf = async (
    treatment: FacadeTreatment,
    out: string,
  ): Promise<RehearsalHalf> => {
    let requests = 0;
    let served = 0;
    const facade = await startRecallFacade(async ({ text, query }) => {
      const pack = await host.recall({
        ...query,
        task: TASK,
        text,
        scope: { domain: RECALL_DOMAIN },
        minCoverage: query.minCoverage ?? treatment.floor,
        // R134: the rehearsal must be served the pack the graded half was served, or its four cells
        // describe an arm nobody dispatched.
        ...(query.limit === undefined && PACK_LIMIT > 0 ? { limit: PACK_LIMIT } : {}),
        ...(treatment.note === undefined ? {} : { note: treatment.note }),
        ...(treatment.shape === undefined ? {} : { shape: treatment.shape }),
      });
      requests += 1;
      if (pack.items.length > 0) served += 1;
      return pack;
    }, { task: TASK });
    let stdout = "";
    try {
      stdout = await phase(
        driverArgs({
          script: SCRIPT,
          domain: LEARN_DOMAIN,
          phase: "eval",
          agent: "microglia_agent",
          taskIds: train,
          trials: 1,
          out,
          memoryUrl: facade.url,
          requireOffPeak: REQUIRE_OFF_PEAK,
        }),
      );
    } catch (error) {
      // The window can close between the graded facade and this phase — two hours is plenty of episode for a
      // boundary to be crossed — and a second phase that refuses must not take the primary measurement with it:
      // the store and the held-out half are already paid for. So the one refusal `run_split.py` produces before
      // its first call is recorded as a reading. Every other failure is thrown, because a rehearsal that crashed
      // mid-phase did spend money and its loss is not a scheduling fact.
      if (!(error as Error).message.includes("tau2-peak-window")) throw error;
      return { requests: 0, served: 0, rewards: [], refused: "peak-window" as const };
    } finally {
      await facade.close();
    }
    const usage = diagnosticsOf(stdout)?.usage;
    return {
      requests,
      served,
      ...(usage === undefined || usage === null ? {} : { usage }),
      rewards: [...bestRewards(readFileSync(out, "utf8"))].map(([task, reward]) => ({ task, reward })),
    };
  };

  /**
   * R133: the same replay with the store off.
   *
   * R132's four cells divide by the population the store was selected on, and its `inert` cell is "failed
   * without memory, then failed again". A task that fails two thirds of the time produces that cell whether or
   * not the store did anything — so the raw reading cannot tell a store that is inert on its own cases from a
   * population that is simply hard. This phase is the denominator that fixes it: the same tasks, the same one
   * trial, the same reduction, and no facade at all.
   *
   * No facade is the point. A facade started and never asked would still be a facade, and the agent would be
   * `microglia_agent` reaching a store the run means to hold out. `llm_agent` is what the learn half ran, so the
   * control differs from the learn half in one respect only: it is a second draw.
   */
  const rehearsalControlHalf = async (out: string): Promise<RehearsalHalf> => {
    let stdout = "";
    try {
      stdout = await phase(
        driverArgs({
          script: SCRIPT,
          domain: LEARN_DOMAIN,
          phase: "eval",
          agent: "llm_agent",
          taskIds: train,
          trials: 1,
          out,
          requireOffPeak: REQUIRE_OFF_PEAK,
        }),
      );
    } catch (error) {
      if (!(error as Error).message.includes("tau2-peak-window")) throw error;
      return { requests: 0, served: 0, rewards: [], refused: "peak-window" as const };
    }
    const usage = diagnosticsOf(stdout)?.usage;
    return {
      requests: 0,
      served: 0,
      ...(usage === undefined || usage === null ? {} : { usage }),
      rewards: [...bestRewards(readFileSync(out, "utf8"))].map(([task, reward]) => ({ task, reward })),
    };
  };

  // Attest the single store before either facade recalls. A second learning
  // phase would produce a second fingerprint and be refused by the invariant.
  const sharedScope =
    PAIR_PLAN.enabled || NOTE_ARMS.enabled || SHAPE_ARMS.enabled
      ? attestPairScope({
          dispatchId: DISPATCH_ID,
          preregId: PREREG_ID,
          storeStatements: knowledge.map((item) => item.statement),
          learnSplit: plan.train,
          testSplit: plan.test,
          seed: PAIR_SEED,
          trials: TRIALS,
          model: llm.model,
        })
      : undefined;

  let primary: FacadeEvaluation;
  /**
   * R132's reading, absent on every arm whose registration did not buy the replay.
   *
   * `undefined` is "not bought" and is written nowhere; the block's presence says the phase ran, and inside it
   * `reading` is the field that may be absent when nothing paired. Two absences, two sentences.
   */
  let rehearsalReading: RehearsalRecord | undefined;
  try {
    if (PAIR_PLAN.enabled && sharedScope !== undefined) {
      const asIs = await evaluateFacade(
        AS_IS_FLOOR,
        join(workdir, "eval-as-is.json"),
      );
      const floored = await evaluateFacade(PAIR_PLAN.flooredFloor, evalPath);
      const verdict = facadePairVerdict({
        plan: PAIR_PLAN,
        asIs: {
          scope: sharedScope,
          tasks: asIs.scored.tasks,
          servedPacks: asIs.recallServed,
        },
        floored: {
          scope: sharedScope,
          tasks: floored.scored.tasks,
          servedPacks: floored.recallServed,
        },
      });
      observedPair = {
        dispatchId: DISPATCH_ID,
        preregId: PREREG_ID,
        floors: { asIs: AS_IS_FLOOR, floored: PAIR_PLAN.flooredFloor },
        scope: sharedScope,
        servedPacks: { asIs: asIs.recallServed, floored: floored.recallServed },
        pass4: {
          asIs: meanPassAtK(asIs.scored.tasks),
          floored: meanPassAtK(floored.scored.tasks),
        },
        verdict,
        treatmentDelivered: treatmentDelivered(verdict),
        seed: PAIR_SEED,
        model: llm.model,
        // The mechanism beside the delta: a floor that changes pass^4 by making the agent stop
        // acting is a different finding from one that changes it by making the agent act wrongly,
        // and only this field tells them apart. `inactionContrast` refuses two censuses over
        // different populations, which is the right contract for a pure function and the wrong way
        // to lose an hour of evaluation here: the refusal becomes a `null` contrast while both
        // censuses stay in the artefact for a reader to compare.
        inaction: {
          asIs: asIs.inaction,
          floored: floored.inaction,
          contrast: inactionContrastOrNull(asIs.inaction, floored.inaction),
        },
      };
      // The registered (floored) facade is the memory arm the rest of the lane
      // grades, so `l4-paired` against the reference stays exactly as R48 had it.
      // Its coverage curve, however, comes from the ungated facade: the floor under
      // test must be priced against the population it was applied to, not against
      // the population that already survived it.
      primary = { ...floored, coverageObservations: asIs.useObservations };
      process.stdout.write(
        `[tau2] paired facades: ${facadePairSummary(observedPair)}\n`,
      );
    } else if (NOTE_ARMS.enabled && sharedScope !== undefined) {
      // R53: three facades of ONE run over ONE store. The floor is the dispatch's registered
      // one for every arm -- the note is the variable, so anything else that could differ
      // between the arms must not.
      const evaluations = new Map<NoteMode, FacadeEvaluation>();
      const arms: NoteArmReading[] = [];
      for (const note of NOTE_ARMS.arms) {
        const evaluation = await evaluateFacade(
          MIN_COVERAGE,
          join(workdir, `eval-note-${note}.json`),
          note,
        );
        evaluations.set(note, evaluation);
        let tasks;
        try {
          tasks = facadeArmTasks(evaluation.scored.tasks);
        } catch (error) {
          // A facade whose task rows cannot be paired is an instrument that did not measure,
          // not a run that crashed: the lane gets the labelled refusal it gets for an outage.
          throw noMeasurementRefusal((error as Error).message);
        }
        arms.push({
          note,
          servedPacks: evaluation.recallServed,
          recallRequests: evaluation.recallRequests,
          unscored: evaluation.scored.unscored,
          tasks,
          inaction: evaluation.inaction,
          observations: evaluation.useObservations,
        });
      }
      observedNotes = noteFacadeReading({
        dispatchId: DISPATCH_ID,
        preregId: PREREG_ID,
        scope: sharedScope,
        arms,
        seed: PAIR_SEED,
        model: llm.model,
      });
      const graded = evaluations.get(NOTE_ARMS.primary);
      if (graded === undefined) {
        throw noMeasurementRefusal(
          `the primary note arm '${NOTE_ARMS.primary}' did not run`,
        );
      }
      primary = graded;
      process.stdout.write(
        `[tau2] note arms: ${noteFacadeSummary(observedNotes)}\n`,
      );
    } else if (SHAPE_ARMS.enabled && sharedScope !== undefined) {
      // R109a: two facades of ONE run over ONE store, one line different. The floor is the dispatch's
      // registered one for both arms: the unit is the variable, so anything else that could differ
      // between them must not.
      const evaluations = new Map<ShapeMode, FacadeEvaluation>();
      const arms: ShapeArmReading[] = [];
      for (const shape of SHAPE_ARMS.arms) {
        const evaluation = await evaluateFacade(
          MIN_COVERAGE,
          join(workdir, `eval-shape-${shape}.json`),
          undefined,
          shape,
        );
        evaluations.set(shape, evaluation);
        let tasks;
        try {
          tasks = facadeArmTasks(evaluation.scored.tasks);
        } catch (error) {
          // Same rule as the note arms: a facade whose task rows cannot be paired is an instrument that
          // did not measure, not a run that crashed, and the lane gets the labelled refusal it gets for
          // an outage rather than a partial artefact.
          throw noMeasurementRefusal((error as Error).message);
        }
        arms.push({
          shape,
          servedPacks: evaluation.recallServed,
          recallRequests: evaluation.recallRequests,
          unscored: evaluation.scored.unscored,
          tasks,
          inaction: evaluation.inaction,
          observations: evaluation.shapeObservations,
        });
      }
      observedShapes = shapeArmReading({
        dispatchId: DISPATCH_ID,
        preregId: PREREG_ID,
        scope: sharedScope,
        arms,
        seed: PAIR_SEED,
        model: llm.model,
      });
      const graded = evaluations.get(SHAPE_ARMS.primary);
      if (graded === undefined) {
        throw noMeasurementRefusal(`the primary unit '${SHAPE_ARMS.primary}' did not run`);
      }
      primary = graded;
      process.stdout.write(`[tau2] shape arms: ${shapeArmSummary(observedShapes)}\n`);
    } else {
      primary = await evaluateFacade(MIN_COVERAGE, evalPath);
    }
    // R132: the replay of the learn half, after the graded facade so the treatment is known and before
    // `host.close()` so the store can still be asked. A dispatch that did not buy it prints nothing at all:
    // this is a phase, not an instrument every run carries, and a line saying "not measured" on every arm
    // that never asked would be the noise that makes a missing reading hard to see.
    if (REHEARSAL) {
      const replay = await rehearsalHalf(primary.treatment, join(workdir, "rehearsal.json"));
      // R133: the control runs after the replay and before the close, so the two phases share one workdir, one
      // window and one task list. A refusal here is a field rather than a throw, for the reason the replay's is:
      // the arm is paid for, and a comparison that did not happen must not take the measurement with it.
      const control = REHEARSAL_CONTROL
        ? await rehearsalControlHalf(join(workdir, "rehearsal-control.json"))
        : undefined;
      rehearsalReading = rehearsalRecordOf({
        tasks: train.length,
        requests: replay.requests,
        served: replay.served,
        learnRewards: rewards,
        rehearsalRewards: replay.rewards,
        ...(replay.usage === undefined ? {} : { usage: replay.usage }),
        ...(control === undefined
          ? {}
          : {
              control: {
                rewards: control.rewards,
                ...(control.refused === undefined ? {} : { refused: control.refused }),
                ...(control.usage === undefined ? {} : { usage: control.usage }),
              },
            }),
        ...(replay.refused === undefined ? {} : { refused: replay.refused }),
      });
      process.stdout.write(`[tau2] ${rehearsalLine(rehearsalReading)}\n`);
    }
  } finally {
    await host.close();
  }

  if (primary.plant !== undefined) {
    process.stdout.write(`[tau2] planted: ${plantSummary(primary.plant)}\n`);
  }

  // R89: what the pack served and what it refused, in one line, next to the bill. `recall.empty`
  // counts both "nothing relevant" and "the relevant record did not fit" as one number; this is the
  // line that separates them, and it is printed unconditionally so a run with no drop still says so.
  process.stdout.write(
    `[tau2] ${packLineOf(
      packCensus(primary.packReadings, { budget: PACK_BUDGET, capacity: RECORD_CAPACITY }),
    )}\n`,
  );

  // R120: the pack line says how many, and this one says which and how concentrated. The census has been
  // in the artefact since R93 and no log ever printed it, so `served 162 of 162 (mean 4.0 items)` was read
  // as a store at work when one record was taking 54% of the renders. Printed unconditionally, because a
  // run that served nothing is the reading this line exists to make legible.
  // A facade that kept no id list says so rather than printing `0 of 0`: an uninstrumented reading and a
  // run whose packs were empty are different facts, and only one of them is about the store.
  const servedCensusOfPrimary = servedCensus(primary.useObservations);
  process.stdout.write(
    `[tau2] served: ${
      servedCensusOfPrimary.identified === 0
        ? 'not measured — this facade kept no id list, so the run cannot say which records its packs carried'
        : servedLineOf(servedCensusOfPrimary)
    }\n`,
  );

  // R123: the gate's own line, printed unconditionally and beside the served census, because the two
  // numbers are only readable together: `served 161 of 168` is a gate at work and `served 168 of 168` at
  // a margin above zero is a gate that never fired. See `tau2-speak.ts` for the partition it prints.
  process.stdout.write(
    `[tau2] ${speakLineOf(SPEAK_MARGIN, primary.diagnostics?.memory)}
`,
  );

  // R125: the per-turn census, printed for the same reason the serve and speak lines are — it is the only
  // reading on this lane whose denominator is large enough to resolve a 5-10pp effect, and a number that
  // only ever existed inside an uploaded artefact is a number nobody checks while the run is still cheap to
  // repeat. `undefined` prints as "no census reached this phase", never as a zero.
  process.stdout.write(`[tau2] ${turnCensusLine(turnCensusOf(primary.diagnostics))}\n`);

  const agentTurns = primary.diagnostics?.agent_turns ?? null;
  // One line, unconditional, so that a run's bill is in its own log next to its score.
  // `null` rather than an omitted line: a dispatch that could not count is a different
  // fact from a dispatch that spent nothing, and the reader has to be able to tell.
  process.stdout.write(
    `[tau2] usage: ${JSON.stringify(primary.diagnostics?.usage ?? null)}\n`,
  );
  // And the sentence a reader would otherwise have to write themselves: whether the arm's uncached
  // tokens were the memory or the turn. Printed even when the census is absent, because "this phase
  // could not attribute its bill" is the reading that makes the next arm worth paying for.
  const cacheVerdict = cacheCensusVerdict(primary.diagnostics?.usage?.cache);
  process.stdout.write(`[tau2] cache: ${cacheVerdict.state} — ${cacheVerdict.sentence}\n`);
  // R92: the number the competitor prints beside its score and this lane never has — cost per
  // conversation, on the same run that produced the pass^4. `primary` is the *evaluation* phase's own
  // document, and the two phases are separate processes, so this is inference spend and not the
  // distillation's: a figure that mixed them would not be comparable to a published one. The
  // competitor's retail 0.084 → 0.139 USD is the same quantity, which is what makes "cheaper at the
  // same score" a claim rather than a hope.
  const spend = primary.diagnostics?.usage?.cost;
  const conversations = test.length * TRIALS;
  const cost =
    spend === undefined || spend === null || typeof spend.usd !== "number"
      ? undefined
      : {
          usd: spend.usd,
          band: spend.band ?? "unknown",
          conversations,
          // No zero guard: `run()` refuses a plan with an empty held-out half before it pays for
          // anything, so the divisor is a count of conversations that were bought. A guard here would
          // be a branch no run can reach, which is the shape of code this repository deletes.
          perConversation: Math.round((spend.usd / conversations) * 1e4) / 1e4,
        };
  if (cost !== undefined) {
    process.stdout.write(
      `[tau2] cost: $${cost.usd.toFixed(4)} over ${String(cost.conversations)} conversation(s) = ` +
        `$${cost.perConversation.toFixed(4)} each ` +
        `(${cost.band})\n`,
    );
  }
  const scored = primary.scored;
  const llmStats = llm.stats;
  observed = {
    train: plan.train,
    test: plan.test,
    trials: TRIALS,
    unscored: scored.unscored,
    // The rows behind that count. `primary` is this arm's own evaluation phase for the same reason
    // every counter above is: R48's defect was two readings from different dispatches.
    ...(primary.diagnostics?.failures === undefined ||
    primary.diagnostics.failures === null
      ? {}
      : { failures: primary.diagnostics.failures }),
    ...(cost === undefined ? {} : { cost }),
    servedPackSizes: primary.servedPackSizes,
    learning: {
      // Zero on a declared-empty arm, because zero rows were read: the split still has `train.length`
      // tasks in it, but nothing was learned from any of them, and a `74` here would be read as a learn
      // half that ran and produced nothing — the defect this arm is not.
      rows: DECLARED_EMPTY ? 0 : train.length,
      unanswered,
      // R91: whether this store was rebuilt or replayed. A pin is the treatment that makes two arms
      // differ by one variable, so the record states its source, its size and the corpus it was priced
      // against -- an artefact that says "pinned" and not what to cannot be audited.
      ...(learned.pin === undefined ? {} : { pin: learned.pin }),
      // R62: corrections *from a repair*. Under `scope: all` the store also holds records made from a
      // pass, and folding those into this count would make a widened store and a repaired one report
      // the same number -- the field's name and its value finally agree, and the population is read
      // from `provenance` instead.
      edited: provenance.edited,
      distilled: knowledge.length,
      // Every count here is the distiller's own, including the one that explains an empty store.
      distillFailed: distillReport.failed,
      candidates: distillReport.candidates,
      events: distillReport.events,
      // What the parser did with the replies, by reason. `candidates` cannot see this population and
      // `failed` counts only throws: a claim the schema refused is neither, and a store built from
      // the survivors of a filter nobody counted is a store whose size has no explanation.
      dropped: { ...drops },
      llmFailed: faults.events,
      ...(faults.events === 0 ? {} : { llmFailedReasons: faultReasons }),
      ...(faults.events === 0 ? {} : { llmFailedSamples: faults.samples }),
    },
    // Whose tally this is, stated in the record: the episodes' calls belong to the agent process and
    // arrive as a turn count, the distillation calls are this process's own. A rate over a subset is
    // a rate over a subset, and the alternative — reporting nothing — is how a run whose every
    // distillation call was refused reached a reader as a store that had nothing to say.
    turns:
      agentTurns === null
        ? {
            total: llmStats.prompts,
            failed: llmStats.failures,
            scope: "distillation" as const,
          }
        : {
            total: agentTurns,
            failed: episodeFailures(primary.diagnostics),
            scope: "run" as const,
          },
    // The provider's own account of the phase, carried so a bill can be divided from the artefact
    // alone. §179 divided one by a number it had read out of a workflow log, and §181 found the
    // artefact's `calls` field was a turn count; a reader with this block never has to leave the file.
    ...(primary.diagnostics?.usage == null ? {} : { usage: primary.diagnostics.usage }),
    domains: {
      stored: knowledge.length,
      withoutDomain,
      unscopedIn: 0,
      widenedIn: 0,
    },
    // R54: what the store said, not only how many items said it. R51 could count conditions
    // and read none of them, so its readback could not tell a trigger in the user's register
    // from one in the procedure's — and those two predict opposite coverage.
    storeItems,
    redundancy: redundancyOfSample(storeItems),
    // R56: the treatment and the subject it acted on, recorded beside the store it produced. The
    // form is what the prompt asked for; the inventory is what the ban refused names from; the
    // count is how often it fired. An artefact that carried the form alone would read the same
    // whether the ban ran or was vacuous, and R56's first refutation is that the ban is too strict —
    // a claim that needs the count to be graded.
    distillForm: {
      // `record` is the form of a unit that asks the model nothing: the field answers "what did the
      // prompt ask for", and on this unit there was no prompt to ask.
      form: DISTILL_UNIT === "trace" ? "trace" : DISTILL_UNIT === "raw" ? "record" : DISTILL_FORM,
      toolInventory,
      refused: toolGuard.refused(),
      // R84's other half: the ceiling the calls were given, from the same value the calls use.
      maxTokens: DISTILL_TOKENS,
    },
    // R58: the unit, the traces it read, and what the recurrence pass did with them. Absent
    // consolidation on a trace arm would be a pass that did not run; absent `distillUnit` on any
    // artefact before this field is "not recorded", which a readback must not read as `correction`.
    distillUnit: {
      unit: DISTILL_UNIT,
      traces: traces.size,
      traced: withTrace,
      claims: distillReport.candidates,
      ...(consolidation === undefined
        ? {}
        : { consolidation: consolidation.report }),
    },
    // R85: the arm's own accounting, from the store. Absent on the two abstracting units, where the
    // record it counts was never written; present, it says how many records survived the ceiling and
    // that the ban was not installed.
    ...(DISTILL_UNIT === "raw"
      ? { rawlog: rawLogCensus(written, RAWLOG_CEILING > 0 ? RAWLOG_CEILING : undefined) }
      : {}),
    ...(faithfulness === undefined ? {} : { faithfulness }),
    // R62: which trajectories taught, and what the store looks like split by that. `scope` is the
    // switch the dispatch read; `provenance` is the measurement of what it produced, and the two are
    // recorded separately because a dispatch that asked for `all` and produced only repairs has to be
    // distinguishable from one that asked for `edited`.
    distillScope: DISTILL_SCOPE,
    // R111: what the distiller's model put in its replies. `drops` counts claims thrown away and
    // `candidates` counts what was kept, so the gap between them and `asked` is the only place an
    // empty reply can be seen — and on the arm that failed it was fifteen of fifteen.
    distillReplies: { ...replyReading, clientCalls: llm.stats.calls },
    // R114: which writer produced the store this arm evaluated. The resilient pair answers a faulting
    // event with the rule interpreter, so `stored` alone cannot say whether the store is the model's
    // or the fallback's — and on the arm that prompted this field it was the fallback's, 63 events
    // out of 73. Recorded on every arm, because a store written by nobody (`raw`) and a store written
    // by a model both reach this line.
    distillWriter: writer,
    // R114: the pair's own counts, which the artefact did not carry at all. R104's 63 fallbacks
    // existed only in the log line, so no reader of the document could see that 63 of 73 events had
    // no model answer — and the arm's score was read as a measurement of a store the model wrote.
    // R114: the distiller's own bill and regime. R104's 73 calls carried no token census anywhere in
    // the document, so "the replies were blank" could not be priced and "the model spent the budget
    // thinking" could not be checked. `reasoningTokens` is the field that settles it on the next arm.
    distillClient: { ...llm.stats },
    distillFaults: {
      events: faults.events,
      answered: faults.answered,
      primaryClaims: faults.primaryClaims,
      fallbackClaims: faults.fallbackClaims,
      // The ordered codes, not the histogram: `faultReasons` is what the learn line renders and a
      // reader of the artefact wants the sequence a run actually met.
      reasons: [...faults.reasons],
      samples: faults.samples,
    },
    // R111: the model that wrote the memory, which is not the arm's own unless a dispatch says so.
    distillModel: llm.model,
    // R111: the pre-flight, when this dispatch ran one. Absence is every arm before this field, and
    // an arm that ran with a passing pre-flight is distinguishable from one that ran without — the
    // distinction matters because the pre-flight is a claim that the instrument was working.
    ...(distillPreflight === undefined ? {} : { distillPreflight }),
    provenance,
    // R57: the controlled distractor, when this dispatch armed one. Absent is the control arm.
    ...(primary.plant === undefined ? {} : { plant: primary.plant }),
    // R60: the ceiling this dispatch ran at, and whether it was chosen or inherited.
    traceClaims: TRACE_CLAIMS,
    // R60: claims per correction, counted from the store rather than from the interpreter's report —
    // a candidate the host refused is not yield, it is a claim that never reached a pack. Retired
    // items still count: a claim written and later folded into a paraphrase was written.
    yieldCensus: yieldCensus(claimsPerCorrection(captured, written)),
    // R99: what a shape-keyed store would hold, computed from the corrections this learn half already
    // produced. Cheap and free of model calls; it prices the merge arm before one is bought.
    merge: mergeCensusOf(corrections),
    ...(consolidationSweep === undefined ? {} : { consolidationSweep }),
    // R141: the floor and what it removed, beside the pass whose support it reads. Absent is floor 1.
    ...(supportFloor === undefined ? {} : { supportFloor }),
    // The treatment, recorded beside its result: an artefact cannot otherwise tell an arm
    // that switched write admission on from one that never asked, and the counters are the
    // only place the mechanism's own population appears.
    // R53: the sentence every pack in this arm opened with, recorded beside the store that
    // produced the packs. A readback that cannot recover the level cannot tell an arm from a
    // control, and two runs of one level would read as three.
    injectionNote: { mode: NOTE_PLAN.mode, declared: NOTE_PLAN.declared },
    writeAdmission: {
      mode: WRITE_ADMISSION_PLAN.mode,
      rephrased: distillReport.rephrased,
      suppressed: distillReport.suppressed,
    },
    store: census,
    // R55's audit: the five counts that locate a zero. Every gate in the protocol graded a number
    // and none asked whether the machine that produced it carried anything — three rounds were read
    // as "the mechanism does not work" when the failing stage was upstream of every gate the report
    // carried. The counts are the driver's own, taken at the boundaries it can see, and they must
    // reconcile or `V0` says the two populations differ rather than reporting the last one.
    funnel,
    // R101: the declaration, beside the counts it makes interpretable rather than instead of them.
    // Written only when the arm is the declared-empty one: absence is every arm before this field, and
    // a `false` written everywhere would be a measured statement about arms that never declared.
    ...(DECLARED_EMPTY ? { declaredEmptyStore: true } : {}),
    recall: {
      requests: primary.recallRequests,
      served: primary.recallServed,
      empty: primary.recallRequests - primary.recallServed,
    },
    // R152: what the travel budget did, beside the recall it acted on. Absent on every arm that declared no
    // rotation, so an artefact cannot mistake the identity for a policy that bound nothing.
    ...(primary.rotation === undefined ? {} : { serveRotation: primary.rotation }),
    // R92: the questions the packs were ranked on. Recorded beside the store because the two are the
    // function's arguments: R91 replayed one exactly and the other moved by 13 characters a pack, and
    // nothing in the artefact could say so.
    queries: primary.queryCensus,
    // R89: what the pack refused, which `recall.isEmpty` cannot say. A request whose best record was
    // too long to render is counted as `empty` there and as `emptiedBySize` here, and the two call for
    // a budget change and a retrieval change respectively.
    pack: packCensus(primary.packReadings, {
      budget: PACK_BUDGET,
      capacity: RECORD_CAPACITY,
      // R150: the filter the request carried. The workflow sets it for the Python agent, and this is the same
      // string: one variable, read where the request is made and recorded where the arm is written.
      knobs: process.env['MICROGLIA_PACK_KNOBS'] ?? '',
    }),
    // R123a's readback had to download a 103 KB job log to find the ladder, because the driver read
    // `diagnostics.memory` to print one line and dropped the block: `margin_ladder`, `census` and
    // `episodeStarts` were computed, printed, and then lost. A reading that survives only in a log cannot be
    // re-examined, and both of the joins this artefact feeds — the attribution's episode boundary and the
    // rung's population — are in this block. Absent rather than `null`, so an arm without a sidecar keeps
    // saying that it had none.
    ...(primary.diagnostics?.memory == null ? {} : { memory: primary.diagnostics.memory }),
    // R125: the per-turn census, with one row per episode so the pair can join it. Absent on an arm whose
    // phase wrote no census — the artefact then says the instrument never reached it.
    ...turnCensusBlock(primary.diagnostics),
    // R132: the store on the cases it was built from, and the requests that replay cost. Absent on every arm
    // that did not buy it: the block's presence is the statement that the phase ran, and `reading` inside it
    // is the field that may be absent when the two reward sets paired nothing.
    ...(rehearsalReading === undefined ? {} : { rehearsal: rehearsalReading }),
    // What the served packs contained. `withoutDomain` is the store's count of
    // `domain === undefined` items, from the same domain ledger V44 reads.
    useObservations: primary.useObservations,
    // The curve from the ungated facade when there is one: the graded facade's
    // observations are already filtered at the floor under test, and a histogram
    // built from them prices that floor as free.
    coverageObservations:
      primary.coverageObservations ?? primary.useObservations,
    // R53's fourth prediction, recorded rather than discarded: `evaluateFacade` builds one census per
    // facade, and the paired path kept its copy in `observedPair` while this path dropped it on the
    // floor. A prediction whose subject the artefact does not carry cannot be graded, and this one
    // was written before the field existed -- so the field goes in before the dispatch, not after.
    inaction: primary.inaction,
    widenedItems: withoutDomain,
    scenario,
    // R92: which benchmark generation this is. A `pass^4` is comparable only to one from the same
    // release, and the release changed every retail task body between v0.2.0 and v1.0.1.
    ...(benchmark === undefined ? {} : { benchmark }),
    // The scenario's own size, not the split's: a dispatch cap hides it, and it is what bounds the
    // resolution any split of this scenario can reach.
    scenarioTasks: { learn: learnable.length, test: evaluated.length },
  };

  return scored.tasks;
}
