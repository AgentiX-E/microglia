/**
 * Pair the two L4 arms of one split, task by task, and measure the pair with the shared protocol.
 *
 * Iterations 60-61 measured the memory arm and the reference arm in two dispatches and compared
 * 0.6471 against 0.5882. That is a difference of two means: no interval, no denominator, and no way
 * to tell "the memory costs 5.89 points" from "the two runs disagreed on eight of sixty-eight
 * tasks". This reads both artefacts and pairs them.
 *
 * It reads artefacts rather than runs: the arms cost an hour each, and a pairing step that needed
 * its own run would be a step nobody re-runs.
 *
 * ## What changed in R27 stage 2, and why the three gates became a merge
 *
 * Until this stage the lane wrote three validity conditions of its own — `l4-paired`,
 * `l4-resolution`, `l4-same-split` — while the BIRD lane wrote thirty-nine. `l4-resolution` failed
 * at a 15pp half-width against a 5pp bar and was recorded with `blocking: false`, so the lane
 * published a delta its own instrument had already said it could not resolve. That is the
 * single-customer pathology in miniature: the gate existed, fired, and changed nothing.
 *
 * The lane now supplies the protocol's gates through `tau2GateAudit` and keeps only the two
 * conditions the protocol cannot state, because they are about this pair rather than about the
 * instrument:
 *
 *   - `l4-paired` — the treatment did not cost accuracy, at p < 0.05. That is the **finding**, and
 *     the protocol certifies instruments, not findings.
 *   - `l4-same-split` — both arms scored exactly the same tasks. That is a property of the two
 *     files on disk, which the protocol never sees.
 *
 * `l4-resolution` is gone rather than renamed: the protocol's `V5-resolution` is the same condition
 * computed from the same discordance with the same constant, and it is now blocking.
 *
 * R152 added a third to `pair-gates.ts`: `l4-rotation-reconciles` compares the serving policy's declared reading
 * with the ids this pair's own pack ledger carries. It is computed here because the ledger is a file the pair
 * reads and the gate is a table, and it is recorded in the artefact beside the treatment so a readback can see
 * which fields the ledger could reach — `mode` is a policy, and no ledger holds one.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inGateOrder, mergeGates, type ValidityGate } from '@agentix-e/microglia-protocol';
import { degradationLineOf, degradationOfPair } from '../tau2-degradation.js';
import {
  boundaryJoin,
  boundaryLine,
  boundaryTasksOf,
  copyLedgerLine,
  copyLedgerOf,
  episodeStartsOf,
  itemTransferLine,
  pairAttribution,
  serveSplit,
  serveSplitLine,
} from '../tau2-attribution.js';
import { pairedTurnLine, pairedTurns, turnCensusLine, turnCensusOfBlock } from '../tau2-turn.js';
import {
  PUBLISHED_K,
  PUBLISHED_SCENARIO,
  ceilingOf,
  compareArms,
  resolutionOf,
  tau2ArmRecordOf,
  holdRateOfTrials,
  tau2DetectablePp,
  tau2GateAudit,
  transferReadingOf,
  armBillLine,
  artefactBillOf,
  type Tau2ArmRecord,
  type Tau2ComparisonRecord,
  type Tau2Evidence,
  type TauTrialRow,
} from '@agentix-e/microglia-eval';
import { writeJson } from './lib.js';
import { pairedVerdict } from '../paired-verdict.js';
import { foldHeadroom, headroomLine } from '../headroom.js';
import { serveSupportCensus, serveSupportLine, supportMapOf } from '../serve-support.js';
import { foldSplitOf, treatmentOf } from '../cross-fit.js';
import { serveYieldCensus, serveYieldLine } from '../serve-yield.js';
import { conditionalLine, conditionalReading } from '../conditional.js';
import { metricParityLine, metricParityOf, restateAtLevel } from '../metric-parity.js';
import { reconcileServeRotation, rotationModeOf } from '../serve-rotation.js';
import { serveTaskCensus, serveTaskLine } from '../serve-tasks.js';
import { marginSweep, serveSweepLine } from '../serve-sweep.js';
import { pairGates, plantedBarNote } from '../pair-gates.js';
import { cacheCensusVerdict, premiumSplitOf } from '../cache-census.js';

type TaskRow = { readonly id: string; readonly passed_all: boolean };

type Artefact = {
  readonly n?: number;
  /**
   * The arm's recorded call count, written by every artefact.
   *
   * R198: read only when `tau2.usage` is absent, and only as a *count* rather than a census — a
   * pre-R198 artefact has this field and no token columns, and the pair must not present the difference
   * as a measured vector. Until R198 this file ignored the field entirely and read the census alone, so
   * an arm whose bill lived in `calls` read as "no bill" while the arm artefact beside it said `0`.
   */
  readonly calls?: number;
  readonly metrics?: { readonly pass4?: number; readonly k?: number; readonly tasks?: number };
  /** The model that answered, which a cross-fit compares because two models are two experiments. */
  readonly model?: string;
  readonly tau2?: {
    /**
     * R85's three-level identity of the treatment, carried so a cross-fit can state what it pooled
     * instead of reading it from the dispatch that sent the arm.
     */
    readonly distillUnit?: {
      readonly unit?: string;
      /**
       * The move pass's groups, each naming every member id and the support the merged record carries.
       *
       * R143: the support join needs these because a served id can be a member the store no longer holds under
       * its own name — 6 of R141's 14 served records were — and the group is the only place that says what
       * their support is.
       */
      readonly consolidation?: {
        readonly groupDetail?: readonly { readonly ids: readonly string[]; readonly supportTasks: number }[];
      };
    };
    readonly distillForm?: { readonly form?: string };
    readonly distillScope?: string;
    readonly traceClaims?: { readonly ceiling?: number };
    /**
     * Which arm wrote the file — `memory`, `reference`, or a declared-empty one under either name.
     *
     * Read rather than inferred from the filename, because the pair's readbacks are printed per arm and
     * a directory called `memory` that carries no pack is the scaffold arm this lane has now measured.
     */
    readonly arm?: string;
    readonly meanPackIds?: number;
    /** The agent's turns, and the failed episodes among them. Named for what it counts since R103. */
    readonly turns?: { readonly total: number; readonly failures: number };
    /** The provider's own account of the phase, census included; absent before R103. */
    readonly usage?: Tau2ArmRecord['usage'];
    readonly learning?: {
      readonly rows: number;
      readonly unanswered: number;
      readonly edited: number;
      readonly distillFailed: number;
    };
    readonly domainOrigin?: {
      readonly storedWithDomain: number;
      readonly storedWithoutDomain: number;
      readonly unscopedIn: number;
      readonly widenedIn: number;
    };
    readonly split?: { readonly train: readonly string[]; readonly test: readonly string[] };
    readonly scenario?: { readonly learn: string; readonly test: string; readonly recall: string };
    readonly scenarioTasks?: { readonly learn: number; readonly test: number };
    /** The store's census and the recall tally, when the arm recorded them (R43 onward). */
    readonly store?: Tau2ArmRecord['store'];
    /**
     * R120/R141: the store sample, which is the only population the support behind a served item can be read
     * from, and the floor the arm served at. Absent on every artefact written before the two fields.
     */
    readonly storeItems?: {
      readonly items?: readonly { readonly id: string; readonly supportTasks?: number }[];
      /** Items the store held beyond the sample's cap, which is what makes absence uninformative. */
      readonly omitted?: number;
    };
    readonly supportFloor?: {
      readonly total: number;
      readonly retired: number;
      readonly retained: number;
      readonly floor: number;
    };
    readonly recall?: Tau2ArmRecord['recall'];
    /**
     * R57: the distractor this arm planted. Read from the artefact rather than from the dispatch's
     * environment, because the pair is about the two files: an arm filed under `near` whose artefact
     * carries no plant census planted nothing, and its pair must be graded as the control it was.
     */
    readonly plant?: { readonly arm: string };
    /** The pack the arm served; `summary.meanChars` is what the premium is priced against. */
    readonly pack?: {
      readonly summary: { readonly meanChars: number } | null;
      /** R128: the ids served at each request, in request order — the left side of the attribution join. */
      readonly ledger?: readonly (readonly string[])[];
      /**
       * R151: the gate's margin per request, aligned with `ledger`.
       *
       * Read here rather than from `memory.margin_ladder`, which is the same quantity summarised: a ladder
       * prices a rung in advance and the sweep needs the row, because the question is which requests the
       * rung would have withheld and whether those were the ones that did damage.
       */
      readonly margins?: { readonly perRequest?: readonly (number | null)[] };
      /** R150: the recall knobs the arm's requests carried, verbatim; absent on every artefact before the field. */
      readonly knobs?: string;
    };
    /**
     * R152: the travel budget this arm declared, and what it did.
     *
     * Read at the phase level rather than under `pack` because the policy is the driver's decision and the cap
     * is arithmetic over the whole phase (`ceil(requests / servable)`), which no single pack knows.
     */
    readonly serveRotation?: { readonly mode?: string; readonly cap?: number; readonly servable?: number };
    /**
     * R204: what the pack was made of at serve time — the block the store rendered, or one sentence written for
     * the request. Absent on every artefact before the field, which is the block arm.
     */
    readonly serveBody?: string;
    /**
     * R204: the store counted before and after the phase, which is the no-durable-write reading.
     *
     * `grew` is the driver's own comparison rather than one this file derives: two files compared by a third is
     * how a gate stops meaning what its name says.
     */
    readonly storeGrowth?: { readonly before?: number; readonly after?: number; readonly grew?: boolean };
    /**
     * R128: the request index that opened each episode.
     *
     * Absent on every artefact written before the instrument existed, and the attribution reads absence as
     * "cannot join" rather than as "one request per episode", because the second is the assumption that
     * makes the join wrong exactly at the episodes that recalled twice (164 requests, 160 episodes).
     */
    /**
     * R123a's census, now projected into the artefact rather than printed and dropped: `rivaled` is the
     * population a rung acts on and `margin_ladder` is what each rung withholds of it. Its absence is a
     * phase without a sidecar, not a store with nothing contested.
     */
    readonly memory?: unknown;
    /** R125: the per-turn census this phase wrote, one row per episode, or absent before the instrument. */
    readonly turnCensus?: unknown;
  };
  readonly per_task?: readonly TaskRow[];
  /** One row per evaluated episode; absent on artefacts written before R29 stage 2. */
  readonly per_trial?: readonly TauTrialRow[];
  readonly ranAt?: string;
};

const RESULTS = process.env['POC_RESULT_DIR'] ?? join(process.cwd(), 'eval', 'results');
const FIRST = process.env['L4_FIRST'] ?? join(RESULTS, 'arms', 'reference', 'poc-l4.json');
const SECOND = process.env['L4_SECOND'] ?? join(RESULTS, 'arms', 'memory', 'poc-l4.json');
/** The domain the run was scored in; the protocol's strata never read it, but the artefact names it. */
const DOMAIN = process.env['TAU_DOMAIN'] ?? 'retail';

/**
 * The interval the registration held this pair to, when it registered one.
 *
 * A control pair does not claim an effect: it claims a band, stated before the dispatch, and the
 * reading that matters is whether the delta landed inside it. R101 registered `[−7.5, +2.5]pp`
 * around its reference arm and read −5.00pp; graded by `l4-effect-resolved` it came back
 * `UNRESOLVED: |-5.00pp| against 24.27pp minimum detectable difference`, which is a true sentence
 * about a question the arm never asked (§34.128).
 *
 * The band travels in the environment rather than in the artefact because a run cannot discover the
 * interval it was held to, and a band written by the run that is graded against it is not a
 * registration. Format: `lo,hi` in percentage points, e.g. `-7.5,2.5`.
 */
function bandOf(raw: string | undefined): { loPp: number; hiPp: number } | undefined {
  if (raw === undefined || raw.trim() === '') return undefined;
  const parts = raw.split(',').map((part) => Number(part.trim()));
  if (parts.length !== 2 || parts.some((value) => !Number.isFinite(value))) {
    throw new Error(
      `TAU_BAND must be 'lo,hi' in percentage points, not '${raw}': a band a reader has to guess ` +
        'at is a band that cannot fail',
    );
  }
  const [loPp, hiPp] = parts as [number, number];
  if (loPp > hiPp) {
    throw new Error(`TAU_BAND is inverted: lo ${loPp} is above hi ${hiPp}`);
  }
  return { loPp, hiPp };
}

const registeredBand = bandOf(process.env['TAU_BAND']);

function load(path: string): Artefact {
  if (!existsSync(path)) {
    process.stderr.write(`[l4-pair] missing artefact: ${path}\n`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(path, 'utf8')) as Artefact;
}

const first = load(FIRST);
const second = load(SECOND);

/**
 * R198 — what each arm was billed, read once and used three times (the two log lines, the premium, and
 * the pair artefact's own record). Read here rather than at the point of use because the pair artefact
 * is written above the log lines, and a bill computed below them would be a value the file could not see.
 */
const firstBill = artefactBillOf(first);
const secondBill = artefactBillOf(second);

for (const [label, artefact, path] of [
  ['first', first, FIRST],
  ['second', second, SECOND],
] as const) {
  if (artefact.per_task === undefined || artefact.per_task.length === 0) {
    // Per-task outcomes are what makes a pair possible. An artefact without them is
    // from a run that predates the field, and silently pairing nothing would report
    // "no difference" for two arms that were never compared.
    process.stderr.write(`[l4-pair] ${label} artefact has no per_task rows: ${path}\n`);
    process.exit(1);
  }
}

const comparison = compareArms(
  (first.per_task ?? []).map((row) => ({ id: row.id, passedAll: row.passed_all })),
  (second.per_task ?? []).map((row) => ({ id: row.id, passedAll: row.passed_all })),
);

const splitMatches = comparison.onlyFirst === 0 && comparison.onlySecond === 0;
const resolution = resolutionOf(comparison);
/**
 * The ceiling the scenario imposes, read from whichever arm recorded the listing.
 *
 * Both arms list the same scenarios, so either arm's record answers it; the first one that has it
 * wins rather than the two being compared, because a disagreement would be a defect in the listing
 * and not a question this file can settle.
 */
const scenarioTasks = first.tau2?.scenarioTasks ?? second.tau2?.scenarioTasks;
const ceiling = scenarioTasks === undefined ? undefined : ceilingOf(comparison, scenarioTasks.test);
/**
 * Which scenario the pair ran, read from the arms rather than from the environment.
 *
 * `TAU_DOMAIN` used to supply this, and on the cross-domain dispatch it was unset while both arms
 * were answering `airline`: the pair's own `domain` field said `retail` about a run that never
 * scored a retail task. An artefact that names the wrong scenario is the same defect as a gate that
 * grades one scenario against another's bar, one step earlier.
 */
const scenario = second.tau2?.scenario ?? first.tau2?.scenario;

/**
 * Whether the two arms were scored by one statistic, and whether that statistic is the bar's.
 *
 * R152c is the read that made this a gate rather than a field: its arm carried `metrics.k = 1` beside a
 * metric named `pass4`, the pairing step handed the protocol `trialCount: first.metrics?.k ?? 4` — a
 * default invented for a field no gate reads — and the run's delta was compared to a bar registered at
 * `pass^4`. Nothing in the three files could see the mismatch, because the two arm artefacts were the
 * only places the level was ever written and neither the pair projection nor the protocol copied it.
 *
 * The bar's `k` is passed only on the scenario the bar belongs to, for the reason `l4-scenario.ts`
 * withholds the bar itself elsewhere: a `k` from another scenario's leaderboard grades nothing here.
 */
const metricParity = metricParityOf({
  kFirst: first.metrics?.k ?? null,
  kSecond: second.metrics?.k ?? null,
  barK: (scenario?.test ?? DOMAIN) === PUBLISHED_SCENARIO ? PUBLISHED_K : null,
  firstArm: 'the reference arm',
  secondArm: 'the memory arm',
});
process.stdout.write(`[l4-pair] ${metricParityLine(metricParity)}\n`);

/**
 * The transfer reading, when both artefacts carry their episodes.
 *
 * Absent on a within-scenario pair, and that absence is a statement rather than a gap: a store
 * answering the corpus it learned from has not transferred anything, so the four gates it would
 * supply do not apply. On a cross-domain pair it is the round's whole measurement — how many of the
 * control arm's failures the foreign pack repaired, how many of its successes it broke, and whether
 * either count is large enough to be a rate rather than a direction.
 */
const transfer =
  first.per_trial === undefined || second.per_trial === undefined
    ? undefined
    : transferReadingOf({
        reference: first.per_trial,
        memory: second.per_trial,
        store: second.tau2?.scenario?.learn ?? second.tau2?.scenario?.test ?? DOMAIN,
      });

const comparisonRecord: Tau2ComparisonRecord = {
  paired: comparison.paired,
  onlyFirst: comparison.onlyFirst,
  onlySecond: comparison.onlySecond,
  lost: comparison.lost,
  gained: comparison.gained,
  deltaPp: comparison.deltaPp,
};

const detectablePp = tau2DetectablePp(comparisonRecord);

/**
 * What this pair is allowed to say, decided before the gates are written.
 *
 * R50: `l4-paired` used to pass only on `delta >= 0 && p < 0.05`, a condition the
 * pair's own minimum detectable difference made unreachable. R49 graded it FAIL
 * at -4.00pp against an MDE of 13.73pp — a verdict that says the memory is broken
 * when what it actually says is that 50 paired tasks cannot see an effect that
 * small. The gate now mirrors the R45 revert rule (harm) and the readout carries
 * the resolution it can honestly claim. See `paired-verdict.ts`.
 *
 * R52 moved it above the evidence, because the evidence now carries the claim: the
 * protocol's `V5-resolution` grades whether a run claimed more than its sample can
 * resolve, and the only place that answer exists is here.
 */
/**
 * The distractor the memory arm planted, read from the arm's own artefact.
 *
 * `second` is the memory arm by construction (the order is stated where the two paths are read). An
 * arm that planted one is graded by its plant census and its per-episode ledger rather than by the
 * treatment's harm branch, which for that arm is its registered prediction; see `pair-gates.ts`.
 *
 * Read before the evidence rather than after it, because the claim described below is a statement
 * about this arm and the evidence is where the protocol reads it. The first version of this change
 * read the artefact after the evidence that consumed it, which is a temporal dead zone rather than a
 * wrong answer — `l4-planted-arm.test.ts` caught it on the first run, and the reason it caught it is
 * that it runs the bin instead of the module.
 */
const plantedArm = second.tau2?.plant?.arm;
const served = second.tau2?.recall?.served ?? 0;
const verdict = pairedVerdict({
  deltaPp: comparison.deltaPp,
  p: comparison.p,
  paired: comparison.paired,
  servedPacks: served,
  detectablePp: detectablePp ?? Number.POSITIVE_INFINITY,
});

/**
 * R154: what the fold could have shown, beside what the pair did show.
 *
 * A memory can only repair a task the control failed, so the difference between the control's pass rate and
 * one is a hard ceiling on any delta this fold can express. Comparing it with the pair's own resolution is
 * the check a design owes before it is dispatched, and printing it after the fact is the cheapest way to
 * stop the next fold of the same shape being bought — four reads of this lane came back `UNRESOLVED` and
 * every one of them was a fold whose ceiling was below its own resolution.
 */
const controlPass4 = first.metrics?.pass4;
const headroom =
  typeof controlPass4 !== 'number'
    ? undefined
    : foldHeadroom({ paired: comparison.paired, controlPass4, detectablePp });
if (headroom !== undefined) process.stdout.write(`${headroomLine(headroom)}\n`);

const evidence: Tau2Evidence = {
  domain: scenario?.test ?? DOMAIN,
  trialCount: first.metrics?.k ?? null,
  reference: tau2ArmRecordOf('reference', first),
  memory: tau2ArmRecordOf('memory', second),
  comparison: comparisonRecord,
  // R52: the protocol grades the claim, not the sample. `null` where the pair concluded nothing is
  // the point of the field — without it, `V5` would read this pair's silence as a lane that never
  // reports claims and fall back to the 6pp bar this scenario cannot meet at any n.
  // R57: a planted arm publishes no direction, so `null` here is a statement about the arm rather
  // than a claim it declined to make. The sentence HARM carries — "the memory costs accuracy" — is
  // false of a pair whose loss came from a rule we planted on purpose, and the protocol's resolution
  // gate is right to refuse it: `V5` blocks a published direction the sample cannot resolve, and
  // -7.02pp against a 20.86pp minimum detectable difference is exactly that. Suppressing the claim is
  // what makes the artefact true; suppressing the gate would have left the sentence standing.
  claimPp: plantedArm !== undefined || verdict.state === 'UNRESOLVED' ? null : comparison.deltaPp,
  ...(transfer === undefined ? {} : { transfer: transfer.gate }),
};
const audit = tau2GateAudit(evidence);

// R123: the fields each arm's driver emitted and its artefact did not carry. Read from the arm's own record
// rather than recomputed here, because the record is what the projection wrote.
const unprojectedArms = [first, second]
  .map((arm) => ({
    arm: arm.tau2?.arm ?? 'unstated',
    keys: (arm.tau2 as { readonly unprojected?: readonly string[] } | undefined)?.unprojected ?? [],
  }))
  .filter((entry) => entry.keys.length > 0);

// R152: the memory arm's serving policy, reconciled against the ids its own pack ledger carries. Absent when the
// arm declared no policy or kept no id list, because there is nothing to reconcile in either case — and absence
// is reported as absence rather than as agreement (the gate says which fields it could not reach).
const rotationReconciled =
  second.tau2?.serveRotation === undefined || second.tau2?.pack?.ledger === undefined
    ? undefined
    : reconcileServeRotation(second.tau2.serveRotation, second.tau2.pack.ledger);

const scenarioGates: readonly ValidityGate[] = pairGates({
  state: verdict.state,
  claim: verdict.claim ?? null,
  deltaPp: comparison.deltaPp,
  p: comparison.p,
  paired: comparison.paired,
  served,
  detectablePp,
  splitMatches,
  onlyFirst: comparison.onlyFirst,
  onlySecond: comparison.onlySecond,
  ...(plantedArm === undefined ? {} : { plantedArm }),
  ...(registeredBand === undefined ? {} : { registeredBand }),
  ...(unprojectedArms.length === 0 ? {} : { unprojected: unprojectedArms }),
  ...(rotationReconciled === undefined ? {} : { rotationReconciled }),
  // R156: the fourth condition about the two files rather than about the instrument. Absent when an arm
  // never stated its `k`, which is every pair of artefacts written before R120 — and absence is reported
  // in `protocol.kAbsent` rather than as a green row, because "the metric was never stated" and "the
  // metrics matched" are different facts and only one of them is a measurement.
  ...(metricParity.gate === null ? {} : { metricParity: metricParity.gate }),
});

const gates = mergeGates(audit.gates, scenarioGates, inGateOrder);

// Retention, per arm, from the episode ledger each arm wrote.
//
// `pass^4` says how often a task held on all four trials; this says how often a task that passed a trial
// passed the next one, which is the number the published continual-learning result reports beside it
// (*Learning on the Job*, arXiv 2607.22157; hold rate 0.88 for outcome feedback, 0.65 for verified
// corrections). The two move separately — an arm can hold every pair it opens and still lose a task by
// opening none — so the pair carries both rather than one replacing the other.
//
// It is computed from `per_trial` rather than from `per_task`: the ledger keeps `{id, trial, reward}`,
// which is the order, and every artefact published before `per_task` gained `outcomes` carries the
// ledger and not the order. A run whose artefact carries neither reports `undefined` rather than a zero
// it did not measure.
// R88: the field's own metric, on every pair rather than only on a transfer. `pass^4` calls a task
// lost when one of its four trials fails and hides that three were unharmed; the share of trials the
// reference passed that the memory arm failed is the number `Don't Just Trust Your Memory` reports as
// 52% of memory-induced failures, and this lane has never published it for a within-domain pair.
const degradation =
  first.per_trial === undefined || second.per_trial === undefined
    ? undefined
    : degradationOfPair(first.per_trial, second.per_trial, second.tau2?.scenario?.learn ?? DOMAIN);
process.stdout.write(`${degradationLineOf(degradation)}\n`);

/**
 * R128: which claim was present when the memory lost.
 *
 * The transfer ledger says how many trials the treatment broke; this says which of the four lines served
 * into them was there. It is a **screening** reading and not a cause: a trial is a ten-turn trajectory and
 * the store served four lines into it, so a negative net means "present whenever the memory failed". The
 * verdict is the ablation that withholds exactly that claim, which is why the line prints ids and a count
 * rather than a verdict.
 *
 * Undefined rather than empty when the join cannot be made: an artefact from before the instrument carries
 * no `episodeStarts`, and a zero there would read as "no claim was ever served into a measured trial" —
 * which is the class of defect this round spent its whole dispatch learning to refuse.
 */
function attributionOf(reference: Artefact, memory: Artefact) {
  const margins = memory.tau2?.pack?.margins?.perRequest;
  return pairAttribution({
    ledger: memory.tau2?.pack?.ledger,
    episodeStarts: episodeStartsOf(memory.tau2?.memory),
    // R136: the task each boundary opened for, when the arm names them. Absent on every artefact before the
    // instrument, which leaves the join positional and therefore refusing a 41-versus-40 pair.
    boundaryTasks: boundaryTasksOf(memory.tau2?.memory),
    memoryTrials: memory.per_trial,
    referenceTrials: reference.per_trial,
    // R151: the gate's own decision, so the sweep can price a rung without a second dispatch.
    ...(margins === undefined ? {} : { margins }),
  });
}

/**
 * How many tasks the arm simulated more than once, or `undefined` when every task was simulated once.
 *
 * The sweep's unit is the trial and the render's grain is (record, task), so a repeated task is the one case
 * where the two differ. Counting it here rather than in the sweep keeps `serve-sweep.ts` free of a caller's
 * assumption: it is the artefact reader's job to know that `per_trial` may carry two rows for one id.
 */
function repeatedTask(rows: readonly TauTrialRow[] | undefined): number | undefined {
  if (rows === undefined) return undefined;
  const seen = new Map<string, number>();
  for (const row of rows) seen.set(row.id, (seen.get(row.id) ?? 0) + 1);
  const repeated = [...seen.values()].filter((count) => count > 1).length;
  return repeated === 0 ? undefined : repeated;
}

const attribution = attributionOf(first, second);
if (attribution !== undefined) process.stdout.write(`${itemTransferLine(attribution)}\n`);
// R144: the denominator the outcome counter never had. A memory can only repair a trial the bare agent failed
// and can only break one it passed, so a record rendered nine times inside a corpus whose control passes 82.5%
// of its trials has almost no opportunity — and counting repairs per render measures the corpus's difficulty
// rather than the record. Printed from the same join, at no extra cost.
const yields = attribution === undefined ? undefined : serveYieldCensus(attribution.renders);
if (yields !== undefined) process.stdout.write(`${serveYieldLine(yields)}\n`);
// R155: the same counts divided by the populations they came from. `yields` says four repairs and seven breaks
// on forty trials; this says four of six failed trials repaired against seven of thirty-four passed ones
// broken, which is the reading the delta dilutes — 86% of a retail fold is population where a memory can only
// lose. Its break-even is the number a content axis is measured against, and it is a property of the corpus.
const conditional =
  yields === undefined
    ? undefined
    : conditionalReading({
        trials: yields.renders,
        failedControl: yields.opportunity,
        repairs: yields.repairs,
        breaks: yields.breaks,
      });
if (conditional !== undefined) process.stdout.write(`${conditionalLine(conditional)}\n`);
// R148: the same renders, grouped by the task they were served into. One hundred breaks on one task and one
// hundred breaks across a hundred tasks are the same `breaks` count and different illnesses — reach versus
// interference — and only the second is what a content axis addresses. Nothing counts by this: it is the group
// key of an attribution, and the yield census above is asserted invariant to the id's presence.
const taskYields = attribution === undefined ? undefined : serveTaskCensus(attribution.renders);
if (taskYields !== undefined) process.stdout.write(`${serveTaskLine(taskYields)}\n`);
// R151: the rung, priced against the outcomes the run already bought. `margins.ladder` said how many requests
// each rung would withhold and could not say whether it would withhold the ones that did damage; this joins the
// gate's own decision to the pair's ledger and answers it. Zero model calls, and the answer is the one a rung
// has to be chosen by — the alternative is buying a dispatch per candidate rung.
//
// R151: a sweep prices *trials*, and a render carries the task it was served into rather than the trial
// number, so an arm that simulated one task twice would have its two trials pooled into one. That is the
// positional assumption the episode join exists to remove, and the cheap guard is to price nothing rather
// than to price a population the artefacts cannot separate. Named rather than silent: an arm at `trials: 4`
// is a legal arm, and a readback that printed no sweep would read as an arm with no margin census.
const repeated = repeatedTask(second.per_trial);
const sweep =
  attribution === undefined || second.tau2?.pack?.margins?.perRequest === undefined
    ? undefined
    : repeated === undefined
      ? marginSweep(attribution.renders)
      : undefined;
if (repeated !== undefined) {
  process.stdout.write(
    `serve sweep: not priced, ${String(repeated)} task(s) were simulated more than once and a render does not say which trial it served\n`,
  );
}
if (sweep !== undefined) process.stdout.write(`${serveSweepLine(sweep)}\n`);

// R141: the join the floor's own criterion is written in. The attribution table says which item was served
// and what it did; the store sample says how many tasks stand behind it. Neither alone can say whether the
// items that hurt were the singletons — which is the entire premise of a serve-time floor — and the arm's
// `supportFloor` says whether a floor was in force at all or only predicted. Three readings in one line: the
// buckets, the harm inside each, and either the counterfactual (no floor) or the grade (a floor ran).
const supportBehindServed = supportMapOf(
  second.tau2?.storeItems,
  second.tau2?.distillUnit?.consolidation?.groupDetail,
);
process.stdout.write(
  `${serveSupportLine(
    supportBehindServed === undefined
      ? undefined
      : serveSupportCensus({
          items: attribution?.items ?? [],
          support: supportBehindServed,
          // Absent when the arm wrote no store census, which is a missing denominator rather than a zero one.
          ...(second.tau2?.store?.servable === undefined ? {} : { servable: second.tau2.store.servable }),
          floor: second.tau2?.supportFloor?.floor ?? 1,
          // R143: a capped sample is a prefix of the store, so an id it does not carry is not evidence of a
          // singleton. R141 was 64 of 83, and six of its fourteen served records were in the nineteen it left
          // out — every one of them with two or three tasks behind it.
          truncated: (second.tau2?.storeItems?.omitted ?? 0) > 0,
        }),
  )}\n`,
);

// R123's mechanism check: the arm's own episodes, split by whether the gate let their pack through. This is
// the only within-arm comparison the lane has, and it is free — an empty ledger entry already records a
// refusal, so the split costs no dispatch and no model call.
const split = serveSplit({
  ledger: second.tau2?.pack?.ledger,
  episodeStarts: episodeStartsOf(second.tau2?.memory),
  boundaryTasks: boundaryTasksOf(second.tau2?.memory),
  memoryTrials: second.per_trial,
});
// R136: printed beside the split, because a split that refuses and a split that measures are both readings
// and only this line says whether the boundary could be joined by identity.
const boundary = boundaryJoin({
  episodeStarts: episodeStartsOf(second.tau2?.memory),
  boundaryTasks: boundaryTasksOf(second.tau2?.memory),
  memoryTrials: second.per_trial,
});
process.stdout.write(`${boundaryLine(boundary)}\n`);
// Printed whether or not it could be measured. R123's split returned `undefined`, the caller printed nothing,
// and the arm's registered mechanism check disappeared between a green gate and an artefact with no field.
process.stdout.write(`${serveSplitLine(split)}\n`);
// R137: whether the agent's own copy count reconciles with the injections it made. Free, and the only check
// on this record that fails when the wrapper starts appending to a state the benchmark threads back — the
// defect that lived from R92 to R136 because the fixture asserted the opposite contract.
const copies = copyLedgerOf({
  dropped: (second.tau2?.memory as { packCopiesDropped?: number } | undefined)?.packCopiesDropped,
  injected: (second.tau2?.memory as { injectedMessages?: number } | undefined)?.injectedMessages,
  boundaries: episodeStartsOf(second.tau2?.memory)?.length ?? null,
});
process.stdout.write(`${copyLedgerLine(copies)}\n`);

// R125: the per-turn census, paired across the two arms. Printed here rather than per arm because the
// question it answers is a *difference*: either arm alone reports 1,800 turns of activity, and only the
// pair says whether the memory's turns were more or less likely to come back in error.
const memoryTurns = turnCensusOfBlock(second.tau2?.turnCensus);
const controlTurns = turnCensusOfBlock(first.tau2?.turnCensus);
// Both arms, and both sentences when one is missing. An absent census is "the instrument never reached this
// arm", which is a different fact from a phase in which no tool failed, and the difference is the whole reason
// the census reports `toolErrors: null` rather than zero.
if (memoryTurns === undefined) {
  process.stdout.write('turns: the memory arm carried no census, so nothing about its turns is measured\n');
} else {
  process.stdout.write(`${turnCensusLine(memoryTurns)}\n`);
}
if (controlTurns === undefined) {
  process.stdout.write('turns: the reference arm carried no census, so the pair cannot be differenced\n');
}
const turns = pairedTurns(memoryTurns, controlTurns);
if (turns.length > 0) process.stdout.write(`${pairedTurnLine(turns)}\n`);

const retain = (artefact: Artefact) =>
  artefact.per_trial === undefined ? undefined : holdRateOfTrials(artefact.per_trial);
const firstHeld = retain(first);
const secondHeld = retain(second);
const retention =
  firstHeld === undefined || secondHeld === undefined
    ? undefined
    : // `second` is the memory arm by construction, the same order the comparison uses.
      { reference: firstHeld, memory: secondHeld };

/**
 * R204: the transient arm's own census, from the block the agent wrote into the phase's diagnostics.
 *
 * Read through the type rather than cast at the printing site, because `memory` is `unknown` in this file's
 * artefact type and the census is the one field of it this round publishes. `null` is the honest absence: an arm
 * that injected the block ran no summariser, and a pair that printed `calls: 0` for it would say a call was
 * counted and none was made.
 */
function guidanceCensusOf(memory: unknown): Record<string, unknown> | null {
  if (typeof memory !== 'object' || memory === null) return null;
  const block = (memory as Record<string, unknown>)['guidance'];
  return typeof block === 'object' && block !== null ? (block as Record<string, unknown>) : null;
}

// R143: the two identities a cross-fit cannot do without, read from the arms rather than from the dispatch.
//
// The pair has always said which two files it compared and what the difference between them was. It has never
// said what the stores learned from or what treatment they ran, so the one property a cross-fit rests on — that
// no fold answered a task its own store had learned — could not be checked from the artefact at all, and a
// reader who wanted to check it had to read the workflow. Both are refusals-with-a-reason rather than blanks:
// an arm from before the field existed cannot state its split, and saying so is different from saying nothing.
const foldSplit = foldSplitOf([
  { label: 'reference', train: first.tau2?.split?.train, test: first.tau2?.split?.test },
  { label: 'memory', train: second.tau2?.split?.train, test: second.tau2?.split?.test },
]);
const treatment = treatmentOf([
  {
    label: 'reference',
    unit: first.tau2?.distillUnit?.unit,
    form: first.tau2?.distillForm?.form,
    scope: first.tau2?.distillScope,
    model: first.model,
    traceClaims: first.tau2?.traceClaims?.ceiling,
    // R150: the filter the request carried, verbatim. Two folds served through two filters are two experiments,
    // and the pool refuses them by this string rather than by re-deriving an anchor from a knob nobody printed.
    knobs: first.tau2?.pack?.knobs,
    // Silent: the control arm serves no pack, so it has no policy to declare. `treatmentOf` reads that as the
    // absence of a claim rather than as a disagreement, and R202 makes the treatment total on the memory arm's
    // answer alone.
    rotation: first.tau2?.serveRotation === undefined ? undefined : rotationModeOf(first.tau2.serveRotation),
    // Silent, for the same reason: the control arm serves no pack and therefore has no body to state.
    serveBody: first.tau2?.serveBody,
  },
  {
    label: 'memory',
    unit: second.tau2?.distillUnit?.unit,
    form: second.tau2?.distillForm?.form,
    scope: second.tau2?.distillScope,
    model: second.model,
    traceClaims: second.tau2?.traceClaims?.ceiling,
    knobs: second.tau2?.pack?.knobs,
    // R202: stated unconditionally, and `rotationModeOf(undefined)` is the literal `none` — the memory arm is the
    // only arm that can carry a policy, so its silence is a claim about the treatment rather than about the file.
    // Before this the arm passed `undefined` through, the treatment omitted the field, and the pool key became
    // identical to the one an arm that declared `none` produces.
    rotation: rotationModeOf(second.tau2?.serveRotation),
    // R204: the memory arm's own answer, and its silence means `rendered` — the body every fold before this
    // field was produced under, which `treatmentOf` states rather than infers.
    serveBody: second.tau2?.serveBody,
  },
]);

await writeJson('poc-l4-pair', {
  id: 'poc-l4-pair',
  title: 'L4 — memory arm against the reference arm on one split, paired per task',
  ranAt: new Date().toISOString(),
  // The scenario the arms answered, which is the only domain this pair can be about.
  domain: scenario?.test ?? DOMAIN,
  // R156: each arm's own `k`, beside its `pass4`, so the pair states the level rather than inheriting
  // one. `null` is an artefact that never wrote the field, which is every arm before R120.
  first: {
    path: FIRST,
    ranAt: first.ranAt ?? null,
    pass4: first.metrics?.pass4 ?? null,
    k: first.metrics?.k ?? null,
    // R198: the arm's bill, so a reader with only this file can price both arms. `bill` says which of the
    // three states the number is in, because a pair that published `calls: 0` without it would spell
    // "nobody counted" the same way as "no calls".
    calls: firstBill.calls,
    bill: firstBill.source,
    // R200: the columns the injection price is a difference of. Published per arm rather than as a premium,
    // because the premium is a property of the pair and the tokens are a property of the arm — and because a
    // reader who disagrees with the subtraction should be able to redo it from the file.
    ...(firstBill.promptTokens === undefined ? {} : { promptTokens: firstBill.promptTokens }),
    ...(firstBill.uncachedTokens === undefined ? {} : { uncachedTokens: firstBill.uncachedTokens }),
  },
  second: {
    path: SECOND,
    ranAt: second.ranAt ?? null,
    pass4: second.metrics?.pass4 ?? null,
    k: second.metrics?.k ?? null,
    calls: secondBill.calls,
    bill: secondBill.source,
    ...(secondBill.promptTokens === undefined ? {} : { promptTokens: secondBill.promptTokens }),
    ...(secondBill.uncachedTokens === undefined ? {} : { uncachedTokens: secondBill.uncachedTokens }),
  },
  comparison,
  ...(foldSplit.ok
    ? { foldSplit: { learned: foldSplit.learned, evaluated: foldSplit.evaluated } }
    : { foldSplitAbsent: { reason: foldSplit.reason } }),
  ...(treatment.ok ? { treatment: treatment.treatment } : { treatmentAbsent: { reason: treatment.reason } }),
  // R204: what the transient arm did, in the three readings the registration ordered — before the delta, which
  // this file already carries and which the registration names as a by-product.
  //
  // (1) the summariser's own account: one call per served episode, and the tokens it was shown. (2) the store,
  // counted on both sides of the memory arm's phase, so "nothing durable was written" is a measurement of a file
  // rather than a claim about the code that was supposed to leave it alone. The control's entry is `null` because
  // that arm opens no store — an absence, not a zero, and the pair says which. Both are published whether or not
  // the arm is the transient one, so an arm that ran the block is distinguishable from one whose census went
  // missing.
  transient: {
    serveBody: treatment.ok ? treatment.treatment.serveBody : null,
    guidance: guidanceCensusOf(second.tau2?.memory),
    store: {
      reference: first.tau2?.storeGrowth ?? null,
      memory: second.tau2?.storeGrowth ?? null,
    },
  },
  // R152: what the declared reading was checked against. Recorded rather than only graded, so a reader can see
  // which fields the ledger could reach and which it could not — `mode` is a policy and no ledger holds one.
  ...(rotationReconciled === undefined ? {} : { rotationReconciled }),
  // R144: the render census beside the item table. The table says which records were served and what they did;
  // this says how many of those renders could have changed anything, which is the number that decides whether
  // an outcome counter can act on the table at all.
  ...(yields === undefined
    ? {}
    : {
        serveYield: {
          renders: yields.renders,
          opportunity: yields.opportunity,
          repairs: yields.repairs,
          breaks: yields.breaks,
          inert: yields.inert,
          repairRate: yields.repairRate,
          opportunitiesForEvidence: yields.opportunitiesForEvidence,
          candidates: yields.candidates,
        },
      }),
  // R155: the same counts divided by the population each came from, with the break rate at which they cancel.
  // Beside `serveYield` rather than inside it because it answers a different question on the same numbers: not
  // what a record did per render, but how far a store is from paying for itself on this corpus.
  ...(conditional === undefined ? {} : { conditional }),
  // R148: which tasks the store reached, and how the harm was distributed across them. The rows are the join
  // grain a content axis needs — `(record, task)` — written here because the arm's artefacts carry the record
  // text and the trials carry the outcomes, but neither carries the pair.
  ...(taskYields === undefined
    ? {}
    : {
        serveTasks: {
          rendered: taskYields.rendered,
          unattributed: taskYields.unattributed,
          harmed: taskYields.harmed,
          helped: taskYields.helped,
          neutral: taskYields.neutral,
          contested: taskYields.contested,
          tasks: taskYields.tasks,
        },
      }),
  ...(retention === undefined ? {} : { retention }),
  // R151: what a margin gate would have done, priced at readback rather than at dispatch. The three arrays
  // this needs were already in the two artefacts, so the only cost of the block is the join — and a rung
  // chosen by a dispatch that has not read the sweep is a rung chosen without the number it exists for.
  ...(sweep === undefined
    ? {}
    : {
        serveSweep: {
          trials: sweep.trials,
          unpriced: sweep.unpriced,
          firstClean: sweep.firstClean,
          rows: sweep.rows,
          ranking: sweep.ranking,
        },
      }),
  // The degradation reading, unconditionally: it is the only number in this artefact that says how
  // many trials the treatment broke rather than how many tasks it changed.
  ...(degradation === undefined
    ? {}
    : {
        degradation: {
          broke: degradation.broke,
          repaired: degradation.repaired,
          blankRight: degradation.blankRight,
          measured: degradation.measured,
          breakRate: degradation.breakRate,
          netPp: degradation.netPp,
        },
      }),
  // R128: the per-item transfer table, when the join could be made at all. Absent rather than empty on an
  // artefact whose memory arm carries no episode boundaries, because an empty table reads as "no claim was
  // served into a measured trial" and the truth would be "this run could not say".
  ...(attribution === undefined
    ? {}
    : {
        attribution: {
          items: attribution.items,
          unmatchedRequests: attribution.unmatchedRequests,
        },
      }),
  // R125: the paired per-turn reading. Absent when neither arm carried a census — a pair whose phases both
  // predate the instrument cannot be read as a pair without wrong actions, which is what an empty object
  // would say.
  ...(turns.length === 0 ? {} : { turnCensus: turns }),
  // R123: what the gate did to the trials it withheld from. Measured or absent, and the absent form names the
  // reason — an artefact that simply omitted the field could not be told from one whose split was level.
  ...('measured' in split ? { serveSplit: split.measured } : { serveSplitAbsent: split }),
  // R57: the distractor this pair is about, when the memory arm planted one. Without it a reader sees
  // a pair artefact with no treatment gate and no reason for the omission.
  ...(plantedBarNote(plantedArm) ?? {}),
  // R50: what the pair establishes, in one of three states, decided by the same
  // two numbers the report prints. `claim` is null unless a direction is
  // supported, so a reader cannot concatenate an unsupported sentence into a
  // result.
  verdict: {
    state: verdict.state,
    // The state stays — it is the registered revert rule's answer and a reader needs to see that the
    // rule fired — but the sentence that turns it into a claim about the memory does not, because on
    // a planted arm the loss is the distractor's and saying otherwise misattributes it.
    claim: plantedArm === undefined ? verdict.claim : null,
    reason: verdict.reason,
    excludedAbovePp: verdict.excludedAbovePp,
    servedPacks: served,
  },
  resolution,
  // R154: the largest delta this fold could have produced, beside the finest one it can see. Computed from
  // the control's own pass rate, so it is a statement about the design rather than about the store, and a
  // fold whose ceiling is below its resolution cannot certify an effect however good the memory is.
  ...(headroom === undefined ? {} : { headroom }),
  // What the scenario itself could decide, when the arms listed it. `tasksForFivePp` is a
  // requirement; this is the supply, and on τ² the two do not meet: retail carries 115 tasks and a
  // 5pp half-width at the observed discordance takes several hundred, so no split of it reaches the
  // bar. Absent on artefacts that did not record the listing, which is every run before R42.
  ...(ceiling === undefined ? {} : { ceiling }),
  // The statistic the protocol's resolution gate reads, beside the interval this lane has always
  // quoted. They differ by 2.802/1.96 = 1.43, and reporting only one of them is how a 15pp
  // half-width became a 21pp minimum detectable difference without anybody noticing.
  protocol: {
    detectablePp: detectablePp ?? null,
    // R156: the statistic this pair was scored by, and the one the bar was scored by. Two `null`s and a
    // `null` for `kAbsent` is the state every pair written before this round is in, and it is a fact a
    // reader has to be able to see: R152c published a `k = 1` delta under a field named `pass4` and
    // nothing in the artefact could have told them.
    k: metricParity.k,
    kFirst: metricParity.kFirst,
    kSecond: metricParity.kSecond,
    barK: metricParity.barK,
    barKMismatch: metricParity.barKMismatch,
    ...(metricParity.absent === null ? {} : { kAbsent: metricParity.absent }),
    // R156: what each arm's headline would read at the bar's level, when the pair and the bar disagree on
    // the statistic. An estimate with its assumption named — trials within a task are treated as
    // independent, which flatters a store whose misses cluster — and printed rather than withheld, because
    // the alternative is a rank claim in one metric and a bar in another.
    ...(() => {
      const { k, barK } = metricParity;
      if (k === null || barK === null || k === barK) return {};
      const firstPass = first.metrics?.pass4;
      const secondPass = second.metrics?.pass4;
      if (typeof firstPass !== 'number' || typeof secondPass !== 'number') return {};
      return {
        restatedAtBarK: {
          k: barK,
          first: restateAtLevel(firstPass, k, barK),
          second: restateAtLevel(secondPass, k, barK),
          assumption: 'trials within a task are independent, so pass^k = rate^k; a store whose misses cluster reads lower than this',
        },
      };
    })(),
    evaluable: audit.evaluable,
    vacuous: audit.vacuous,
    absent: audit.absent,
    supplyable: audit.supplyable,
    armIndexed: audit.armIndexed,
    // R106: the gates this arm has no subject for, because it declared its store empty. Present only
    // when there are some — an `omitted: []` on every memory arm would be a column nobody reads — and
    // carried here rather than dropped because "not graded, and here is why" is a statement while a
    // missing gate is a silence.
    ...(audit.omitted === undefined ? {} : { omitted: audit.omitted }),
  },
  gates,
  // Where each half ran, when the arms recorded it. A reader of a cross-domain pair has to be able
  // to see the two scenario names without opening both arm files.
  ...(scenario === undefined ? {} : { scenario }),
  // The transfer measurement with its ledger: the aggregate says how often, the rows say where. The
  // ledger is committed with the artefact because the first version of it lived in a record the
  // artefact never serialised, and a rate was published with no pairs behind it.
  ...(transfer === undefined
    ? {}
    : {
        transfer: {
          store: second.tau2?.scenario?.learn ?? null,
          // What the store held when recall began. A `repaired` count of zero means one thing when
          // the store carried forty items and another when it carried none, and the pair used to
          // leave a reader to open the arm file to tell them apart.
          storeItems:
            (second.tau2?.domainOrigin?.storedWithDomain ?? 0) +
            (second.tau2?.domainOrigin?.storedWithoutDomain ?? 0),
          paired: transfer.paired,
          orphanMemory: transfer.orphanMemory,
          informative: transfer.gate.informative,
          repaired: transfer.gate.repaired,
          broke: transfer.gate.broke,
          blankRight: transfer.gate.blankRight,
          unmeasured: transfer.gate.unmeasured,
          measured: transfer.gate.measured,
          netPp: transfer.gate.netPp,
          verdict: transfer.gate.verdict,
          // The rows, one per episode, which is what `V33` counts.
          ledger: transfer.episodes,
        },
      }),
  notes: [
    '`deltaPp` is second - first, so a negative number means the second arm (memory) did worse.',
    'pass^4 per task is the k=4 reading: a task counts only when all four trials passed.',
    'The level this pair was actually scored at is `protocol.k`, with each arm\'s own statement beside it. When an arm stated none, `protocol.kAbsent` says which one and the gate `l4-same-k` is absent rather than green — a default of four would be a claim about a run nobody asked.',
    'The pair is defined on the intersection of task ids; tasks scored by one arm only are counted, not dropped silently.',
    'Published reference for scale: ALTK-Evolve pass^4 = 0.575 on tau2-retail.',
    'The protocol gates are the shared forty, not a τ² copy of them; `absent` names the arm each of the rest would need.',
    'Call reliability is graded over the population the arm recorded: `turns.scope` is `distillation` when the episodes\u2019 tally came from a process that does not report one, and `turns` holds agent turns rather than model calls — the provider\u2019s own count is `usage.calls`.',
    '`transfer` pairs the two arms episode by episode, so a repair is one episode the control failed and the treatment passed. The treatment is the whole pack: `repaired` says the pack fixed an episode, not which item in it did.',
  ],
});

process.stdout.write(
  `[l4-pair] paired n=${comparison.paired} delta=${comparison.deltaPp.toFixed(2)}pp ` +
    `[${comparison.ciLowPp.toFixed(2)}, ${comparison.ciHighPp.toFixed(2)}] p=${comparison.p.toFixed(4)} ` +
    `lost=${comparison.lost} gained=${comparison.gained}\n`,
);
process.stdout.write(`[l4-pair] verdict ${verdict.state}: ${verdict.claim ?? verdict.reason}\n`);
if (transfer !== undefined) {
  process.stdout.write(
    `[l4-pair] transfer: ${transfer.gate.repaired} repaired, ${transfer.gate.broke} broken of ` +
      `${transfer.gate.measured} measured (${transfer.gate.informative} informative), ` +
      `net ${transfer.gate.netPp.toFixed(2)}pp, verdict \`${transfer.gate.verdict}\`\n`,
  );
}
// The bill, then the bill's mechanism, per arm, read off each artefact's own record.
//
// A pair that reports a delta and a cost but not this has reported that the memory arm paid twice as
// much without saying what it bought, which is the state PROGRESS 179 left the lane in for two rounds
// and the reason R102.1 was nearly dispatched against a placement theory the probe then refused. R198
// put the bill first because the cache sentence explains a number the reader had to assemble by hand
// until the arm artefact carried one.
for (const [name, record] of [
  ['first', first],
  ['second', second],
] as const) {
  const bill = name === 'first' ? firstBill : secondBill;
  process.stdout.write(`[l4-pair] ${armBillLine(bill, `${name} arm's bill`)}\n`);
  const census = cacheCensusVerdict(record.tau2?.usage?.cache);
  process.stdout.write(`[l4-pair] cache ${name} (${record.tau2?.arm ?? 'unstated'}): ${census.state} — ${census.sentence}\n`);
}
// And the premium, split, when both arms carry the columns it is computed from. This is the sentence
// R103 published — and printing it per pair is what keeps it a measurement rather than a paragraph:
// the next arm to serve a different pack re-derives it instead of quoting it.
const servedChars = second.tau2?.pack?.summary?.meanChars ?? 0;
if (
  firstBill.uncachedTokens != null &&
  secondBill.uncachedTokens != null
) {
  const premium = premiumSplitOf({
    control: { calls: firstBill.calls, uncachedTokens: firstBill.uncachedTokens },
    treatment: {
      calls: secondBill.calls,
      uncachedTokens: secondBill.uncachedTokens,
      servedChars,
    },
  });
  process.stdout.write(
    `[l4-pair] premium: ${premium === null ? 'the second arm was not more expensive per call, so there is no premium to attribute' : premium.sentence}\n`,
  );
}
process.stdout.write(
  `[l4-pair] protocol: ${audit.evaluable.length} gate(s) fired, ${audit.vacuous.length} vacuous, ` +
    `${audit.absent.length} absent (${audit.supplyable} supplyable, ${audit.armIndexed} arm-indexed), ` +
    `minimum detectable ${detectablePp === undefined ? 'not estimable' : `${detectablePp.toFixed(2)}pp`}\n`,
);
for (const gate of gates) {
  process.stdout.write(`[l4-pair] ${gate.pass ? 'PASS' : 'FAIL'} ${gate.id}: ${gate.actual}\n`);
}

if (gates.some((gate) => gate.blocking && !gate.pass)) process.exitCode = 1;
