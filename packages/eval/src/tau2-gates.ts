/**
 * The τ² lane's projection onto the protocol: which of the forty gates it can fire, and why
 * the other thirty cannot fire at all.
 *
 * ## The question this file answers, and the one it does not
 *
 * Stage 1 of R27 counted portability by asking one question of each gate's signature: *does it
 * mention a scenario type?* Thirty-seven of thirty-nine said no, and the claim written from that
 * count was "a second scenario is measured without editing a gate". Stage 2 put the claim in front
 * of the second scenario and got a different answer, because the question was about the wrong
 * noun. A gate's **signature** being scenario-free does not make the gate **evaluable**: a gate is
 * evaluable when the lane ran the arm whose bookkeeping the gate reads. `V45-clearance-dose-matched`
 * names no scenario type and is still unreachable for τ², because τ² ran no clearance arm.
 *
 * So portability is indexical, and this file is the index. It is deliberately a table rather than a
 * predicate: prose that argues a gate is inapplicable can drift from the gate, while a table that
 * must sum to `GATE_ORDER` cannot.
 *
 * ## The three buckets
 *
 * | bucket | meaning | today |
 * |---|---|---|
 * | **supplyable** | the lane's record type can carry the enabling field | 13 |
 * | **arm-indexed** | the field exists, but only an arm this lane never ran produces it | 26 |
 * | **informative** | supplied *and* present in the record that exists | 2 |
 *
 * The fourth bucket is the uncomfortable one and it is kept separate on purpose: **vacuous**.
 * `V6-controls-inject` and `V7-channel` — two of the fourteen in the table above — fire with an
 * empty control list and an `undefined` channel, print "no pack-based controls configured" and
 * pass. They are counted as evaluable by any honest reading of "did the gate run", and they
 * certify nothing. All
 * seventeen published BIRD artefacts carry `V6` with that exact sentence, and sixteen of seventeen
 * carry `V7` the same way. A count that folded them into the two informative gates would report
 * four gates where two do work.
 *
 * ## What is not decided here
 *
 * Whether two informative gates out of forty is a failure of the protocol or of this lane's
 * instrumentation. The registration said the former if fewer than fifteen fired; the refutation is
 * recorded, and the arm-index table is what makes the difference visible enough to argue about.
 */
import type { FaithfulnessCensus } from "./tau2-faithfulness.js";
import {
  GATE_ORDER,
  buildProtocolGatesWithScope,
  type FunnelInput,
  type OmittedGate,
  type ProtocolGateInput,
  type ScenarioGateInput,
  type TransferGateInput,
  type ValidityGate,
} from '@agentix-e/microglia-protocol';
import { detectableDelta } from './protocol.js';
import type { CoverageHistogram, ServedCensus, UseCensus } from './tau2-use-census.js';
import type { InactionCensus } from './inaction.js';
import type {
  DistillFormRecord,
  DistillUnitRecord,
  InjectionNoteRecord,
  Tau2PhaseUsage,
} from './tau2-instrument.js';
import type { StoreItemSample } from './store-items.js';
import type { QueryCensus } from './tau2-queries.js';

/**
 * One arm's records, as far as the protocol is concerned.
 *
 * Every field beside `arm` and the grid counts is optional because an artefact written before this
 * file existed carries none of them, and a projection that required them would refuse to read the
 * only τ² runs this repository has.
 */
/**
 * The three numbers behind `insufficient-evidence`, at item level.
 *
 * R44's reason histogram named the decision but not the half that fired:
 * confidence below `activationThreshold` and support below `minSupport` write
 * the same string. A record without these numbers makes the next round dispatch
 * again just to separate them. `supportOnly` is the population a `minSupport`
 * repair cannot reach. Optional because artefacts written before R45 have none.
 */
export type AdmissionCensus = {
  /** Items that reported all three numbers. */
  readonly measured: number;
  readonly trustMin: number;
  readonly trustMax: number;
  readonly trustMean: number;
  readonly supportMin: number;
  readonly supportMax: number;
  readonly supportMean: number;
  readonly confidenceMin: number;
  readonly confidenceMax: number;
  readonly confidenceMean: number;
  /** `support >= minSupport` and `confidence < activationThreshold`. */
  readonly supportOnly: number;
};

/**
 * One episode that produced no verdict, and why.
 *
 * τ² wraps an episode that failed on every retry as a `SimulationRun` whose `termination_reason` is
 * `INFRASTRUCTURE_ERROR` and whose `info` block carries `error`, `error_type`, `error_traceback` and
 * `failed_after_attempts` (`tau2/runner/progress.py` at v1.0.1, `max_retries = 3`). R92 dropped
 * eleven of forty tasks that way and the artefact recorded only the count — enough to fail a gate,
 * not enough to fix anything, because the three causes it collapses (provider, sandbox, deadline)
 * have three different repairs.
 *
 * `tracebackTail` is the last frames rather than the whole stack: the line that raised is at the
 * bottom, and a 40-line traceback times forty-four episodes is a megabyte of artefact nothing reads.
 */
export type Tau2EpisodeFailure = {
  readonly task: string;
  readonly trial: number;
  readonly termination: string;
  readonly errorType?: string;
  readonly error?: string;
  readonly tracebackTail?: string;
  readonly attempts?: number;
};

export type Tau2ArmRecord = {
  readonly arm: string;
  /** Tasks the arm was scored on. */
  readonly tasks: number;
  /** Trials per task; a task with fewer than `k` is refused upstream, not here. */
  readonly trials: number;
  /** Tasks dropped from the denominator because a trial carried no verdict. */
  readonly unscored: number;
  /**
   * Episodes that produced no verdict, with the reason upstream recorded.
   *
   * R92 lost eleven of forty held-out tasks to forty-four `INFRASTRUCTURE_ERROR` episodes and the
   * artefact said `unscored: 11` and nothing else. A count fails a gate; it does not say whether the
   * provider refused, the sandbox threw, or a deadline expired — three causes with three different
   * fixes. τ² already knows: `run_with_retry` stores `error`, `error_type`, `error_traceback` and
   * `failed_after_attempts` on the placeholder simulation, and this field is that block, carried.
   */
  readonly failures?: readonly Tau2EpisodeFailure[];
  /** Mean items the recall facade put in front of the agent, when the driver counted them. */
  readonly meanPackIds?: number;
  /**
   * The agent's turns this arm ran, and how many episodes failed.
   *
   * `scope` names the population the tally covers. On τ² the episodes' calls happen in the agent
   * process and are visible only as a turn count, so the tally the driver can always produce is its
   * own distillation client's — a subset, stated as one, rather than a rate over everything with a
   * numerator nobody counted.
   *
   * This key was called `calls` and held turns, which is how §179 divided a bill by the wrong
   * population. The provider's call count is `usage.calls`, and the two are different numbers about
   * the same run: R93's memory arm was 1,803 turns and 2,667 calls.
   */
  readonly turns?: {
    readonly total: number;
    readonly failures: number;
    readonly scope?: 'run' | 'distillation';
  };
  /**
   * What the provider said the phase was sent and charged for, with the composition of what was sent.
   *
   * Absent on every arm written before the census; `usage.cache` is absent on every arm written
   * before R103. Both are read as "not measured", never as zero.
   */
  readonly usage?: Tau2PhaseUsage;
  /**
   * The learning half's bookkeeping: corrections written, unanswered, edited, failed to distil.
   *
   * The four counts the protocol reconciles are required; the three after them are the lane's own
   * detail, recorded because a store with no knowledge in it is otherwise indistinguishable from a
   * store whose distillation was answered by the fallback interpreter.
   */
  /**
   * What the store's write path was allowed to decide, and what it refused.
   *
   * Absent on every artefact written before the switch existed. `mode: 'off'` is
   * the store those artefacts measured, so a reader needs the field to tell an arm
   * that turned admission on from an arm that never asked — and `suppressed` is the
   * mechanism's own census, without which a null result cannot be told apart from a
   * run that had nothing to refuse.
   */
  readonly writeAdmission?: {
    readonly mode: 'off' | 'neighbours';
    readonly rephrased: number;
    readonly suppressed: number;
  };
  readonly learning?: {
    readonly rows: number;
    readonly unanswered: number;
    readonly edited: number;
    readonly distillFailed: number;
    readonly distilled?: number;
    readonly candidates?: number;
    readonly events?: number;
    readonly llmFailed?: number;
  };
  /**
   * R53: whether the agent acted at all in each episode, per task.
   *
   * Carried rather than graded: no gate reads it, and the prediction it answers — that a licence to
   * disregard a rule must not become a licence to stop acting — is a readback subject. It travels
   * because an artefact that dropped it made the prediction unanswerable, which is the R56 defect.
   */
  readonly inaction?: InactionCensus;
  /** R54/R56: the store's own words, bounded, and the form the distiller was asked for. */
  readonly storeItems?: StoreItemSample;
  /**
   * R92: what retrieval was asked, and whether a pin replaced it.
   *
   * The subject of R91's second refutation. A pack is a function of the store and the query, and every
   * artefact before this one recorded only the first — so a pack that changed under a pinned store read as
   * a nondeterministic renderer, which is a defect in the wrong module.
   */
  readonly queries?: QueryCensus;
  /** R92: the τ² release and commit this arm ran. See `Tau2Raw.benchmark`. */
  readonly benchmark?: {
    readonly version: string;
    readonly commit: string;
    /** The model that graded `nl_assertions`, when it is not the release's own default. */
    readonly judge?: string;
  };
  /** R92: the bill and the per-conversation cost of the evaluated phase. See `Tau2Raw.cost`. */
  readonly cost?: {
    readonly usd: number;
    readonly band: string;
    readonly conversations: number;
    readonly perConversation: number;
  };
  readonly distillForm?: DistillFormRecord;
  /** R58: the unit distilled, the traces read, and the recurrence pass's census. */
  readonly distillUnit?: DistillUnitRecord;
  /** R85: what the write preserved of the corrections' own entities. See `tau2-faithfulness.ts`. */
  readonly faithfulness?: FaithfulnessCensus;
  readonly injectionNote?: InjectionNoteRecord;
  /**
   * How far the pipeline from a correction to a servable rule got, when the driver counted it.
   *
   * R55's audit: eight gates graded a number and none asked whether the machine that produced it
   * carried anything. This is `V0`'s subject, carried on the arm because the arm is where the store
   * and its learning half meet. Absent on every artefact written before it existed, which leaves
   * `V0` absent rather than green.
   */
  readonly funnel?: FunnelInput;
  /**
   * Whether the store was empty because the arm declared it before it ran.
   *
   * R101's flag, carried on the arm for the same reason `funnel` is: the arm is where the store and
   * its learning half meet, and `V0`/`V1` invert on it. Absent on every artefact written before it,
   * which reads as "not a declared-empty arm" and leaves every committed gate row unchanged.
   */
  readonly declaredEmptyStore?: boolean;
  /** Provenance of the stored items' `scope.domain`, which is the ceiling on every transfer claim. */
  readonly domainOrigin?: {
    readonly storedWithDomain: number;
    readonly storedWithoutDomain: number;
    readonly unscopedIn: number;
    readonly widenedIn: number;
  };
  /**
   * The split the arm was scored on.
   *
   * Present only when the driver recorded it. `leaked` — the number of evaluated tasks the store
   * could have learned from — is a property of the intersection of these two lists, so a projection
   * without them has no `partition` to state and `V2` is absent rather than green.
   */
  readonly split?: { readonly train: readonly string[]; readonly test: readonly string[] };
  /**
   * Which scenario each half came from.
   *
   * Absent on every artefact written before R29 stage 2, and those runs learned and answered in one
   * scenario, so absence reads as "one scenario" rather than as an unknown. A cross-domain arm is
   * the case where the two names differ, and it is the case in which `split`'s qualification is
   * load-bearing rather than cosmetic.
   */
  readonly scenario?: { readonly learn: string; readonly test: string; readonly recall: string };
  /**
   * How many tasks each scenario holds, when the driver listed it.
   *
   * The arm is scored on a *split*, and a split of fifty says nothing about whether the scenario had
   * fifty tasks or a thousand. The pair reads this to state the smallest difference the whole
   * scenario could decide — the ceiling a dispatch cannot lift by drawing a different sample.
   */
  readonly scenarioTasks?: { readonly learn: number; readonly test: number };
  /**
   * What the store held, by status and by reachability.
   *
   * The population behind `meanPackIds`: without it a zero rate cannot say whether the agent never
   * asked, the store had nothing active, or the items were stored under a key the recall path does
   * not ask in. Absent on artefacts written before R42's reading exposed that silence.
   */
  readonly store?: {
    readonly stored: number;
    readonly active: number;
    readonly servable: number;
    readonly statuses: {
      readonly active: number;
      readonly candidate: number;
      readonly quarantined: number;
      readonly retired: number;
      readonly other: number;
    };
    /** Present on artefacts written from R44 onward; absent on older ones. */
    readonly reasons?: Readonly<Record<string, number>>;
    /** Present on artefacts written from R45 onward; absent on older ones. */
    readonly admission?: AdmissionCensus;
    /**
     * R51: how many servable items state a condition, and how many do not. Absent
     * on every artefact written before the census, which reads as "not measured"
     * rather than as zero — the R49 store was ten items with no condition at all,
     * and a zero written by a run that never counted would be indistinguishable.
     */
    readonly conditioned?: number;
    readonly unconditioned?: number;
  };
  /** What the recall facade was asked for, and how many answers carried an item. */
  readonly recall?: {
    readonly requests: number;
    readonly served: number;
    readonly empty: number;
  };
  /**
   * The use-side census: what the delivered packs actually contained, and how
   * much of it was lexically reachable from the question. `V1` grades only the
   * pack's size; a served pack of unrelated rules passes it. R45 (run
   * 42131391874) was the first dispatch to serve a pack, and its artefact could
   * not distinguish an underpowered effect from an unrelated pack. Absent on
   * every artefact written before this instrument existed, so old runs read as
   * "not measured" rather than as a zero. Registered in TECH-DESIGN §17.89.
   */
  readonly use?: UseCensus;
  /**
   * The committed coverage histogram behind the census, reduced from the same
   * facade observations. Additive and optional: an artefact written before
   * this instrument (R45, R46) carries none and reads as "not measured", never
   * as a zero. U3's registered floor is computed from this population before
   * its own dispatch, as AUDIT 34.22 requires; a scalar cannot support it.
   */
  readonly coverage?: CoverageHistogram;
  /**
   * R93: which of the store's records were actually served, and how often.
   *
   * `use` says how many items a pack carried and `coverage` says how much of the question they
   * reached; neither says *which* record, so a store experiment could not tell a record that is
   * load-bearing from one that has never been rendered. This is the use-side join to `storeItems`,
   * and it is what makes "the store serves one record per request on average" a distribution rather
   * than a mean. Absent on every artefact before R93, which reads as "not measured".
   */
  readonly served?: ServedCensus;
};

/** The paired comparison, reduced to the three numbers a gate reads. */
export type Tau2ComparisonRecord = {
  readonly paired: number;
  readonly onlyFirst: number;
  readonly onlySecond: number;
  readonly lost: number;
  readonly gained: number;
  readonly deltaPp: number;
};

/** Everything a τ² run can tell the protocol. */
export type Tau2Evidence = {
  readonly domain: string;
  /** Trials per task the run used; the `k` the grid was scored at. */
  readonly trialCount: number;
  readonly memory?: Tau2ArmRecord;
  readonly reference?: Tau2ArmRecord;
  readonly comparison?: Tau2ComparisonRecord;
  /**
   * The direction this pair publishes, when it publishes one.
   *
   * R52. `V5-resolution` grades the claim rather than the sample: a run that concludes nothing says
   * so with `null` and passes, a run that concludes must have resolved what it concluded, and a run
   * that never mentions the question falls back to the 6pp bar it has always been graded by. The
   * three states are the protocol's, not this lane's — see `ProtocolGateInput.claimPp` — and the
   * value comes from `pairedVerdict`, so the two half-answers cannot disagree.
   */
  readonly claimPp?: number | null;
  /**
   * The transfer measurement, when the run answered a scenario it did not learn from.
   *
   * One reading supplies four gates: the reconciliation, the floor, the ledger and the net. It is
   * absent on a within-scenario run, and absent is the honest value there — a store answering
   * questions from the corpus it learned on has not transferred anything.
   */
  readonly transfer?: TransferGateInput;
};

/**
 * The fourteen gates this lane's record type can feed, and the field that feeds each.
 *
 * Written as data so the audit and the tests read the same list. An entry here is a promise that
 * `tau2ProtocolInput` can produce the field; a field the projection never sets is a lie the
 * `supplied` set would expose on the first run.
 */
const SUPPLYABLE: readonly { readonly id: string; readonly field: Tau2Field }[] = [
  { id: 'V0-instrument-ready', field: 'funnel' },
  { id: 'V1-pack-not-empty', field: 'meanPackIds' },
  { id: 'V2-fold-partition', field: 'partition' },
  { id: 'V3-parse-rate', field: 'parseRate' },
  { id: 'V5-resolution', field: 'detectablePp' },
  { id: 'V6-controls-inject', field: 'controls' },
  { id: 'V7-channel', field: 'channel' },
  { id: 'V8-call-reliability', field: 'callFailureRate' },
  { id: 'V32-fold-learning-intact', field: 'learning' },
  { id: 'V44-domain-accounted', field: 'domainOrigin' },
  // R29 stage 2: one cross-domain arm makes the transfer family reachable, and the four ids are
  // supplied by one reading rather than by four arms. `V16` is expected to *fail* on a foreign
  // domain — a hundred informative episodes is a floor this sample cannot clear — so the entry here
  // is a promise that the gate can be graded, not that it passes.
  { id: 'V15-transfer-reconciles', field: 'transfer' },
  { id: 'V16-transfer-resolvable', field: 'transfer' },
  { id: 'V33-transfer-ledger', field: 'transfer' },
  { id: 'V17-transfer-net-reported', field: 'transfer' },
];

/**
 * The twenty-six gates this lane cannot fire, and the arm each would need.
 *
 * This is the conformance checklist the second scenario produced: read it as the work plan for
 * making τ² a lane the protocol can measure properly, and as the reason the protocol's portability
 * is a property of the arm inventory rather than of the type signature.
 */
const ARM_INDEXED: readonly { readonly id: string; readonly needs: string }[] = [
  {
    id: 'V4-gold-executable',
    needs: 'an oracle arm replaying each reference trajectory to reward 1, which no τ² agent provides',
  },
  {
    id: 'V9-subset-size',
    needs: 'a qualifying subset whose floor is fixed before the result is read',
  },
  {
    id: 'V10-convention-executable',
    needs: 'a house convention the gold answer can be rewritten to and re-executed under',
  },
  {
    id: 'V11-channel-ceiling',
    needs: 'an oracle control that states the accepted answer, to separate format from knowledge',
  },
  {
    id: 'V12-shape-present',
    needs: 'a distiller that can say when a rule applies, and a plain twin to compare it against',
  },
  {
    id: 'V13-probe-reconciles',
    needs: 'a reproducibility probe over the stored action plans, with its four buckets',
  },
  { id: 'V14-probe-applied', needs: 'the same probe, reporting how many held-out packs it changed' },
  { id: 'V18-pool-complete', needs: 'a sampling arm that records more than one candidate per task' },
  { id: 'V19-pool-reconciles', needs: 'the same arm, signing or explicitly refusing each candidate' },
  { id: 'V34-substrate-paired', needs: 'two stores built over one corpus, so the cells can be paired' },
  { id: 'V35-substrate-resolvable', needs: 'the same comparison, reaching a hundred paired tasks' },
  { id: 'V36-substrate-coverage', needs: 'the same comparison, reporting its exclusive sets' },
  {
    id: 'V37-repair-probe-reconciles',
    needs: 'a reproducibility probe over the second substrate, with its four buckets',
  },
  { id: 'V38-repair-probe-applied', needs: 'the same probe, reporting how many packs it changed' },
  {
    id: 'V39-repair-transfer-reconciles',
    needs: 'a transfer measurement over the second substrate',
  },
  { id: 'V40-repair-transfer-resolvable', needs: 'the same measurement, reaching a hundred trials' },
  { id: 'V41-repair-transfer-ledger', needs: 'the same measurement, carrying one row per trial' },
  { id: 'V42-repair-transfer-net-reported', needs: 'the same measurement, with its net marginal effect' },
  {
    id: 'V43-framing-delivered',
    needs: 'a framing arm that declares a sentence per arm, and its ablation',
  },
  {
    id: 'V45-clearance-dose-matched',
    needs: 'a clearance arm paired with a dose-matched control that drops as many items',
  },
  { id: 'V46-raw-is-verbatim', needs: 'a raw arm injecting the correction events unchanged' },
  { id: 'V47-evidence-ablated', needs: 'an arm that removes the evidence block, and its twin' },
  {
    id: 'V48-statements-answered',
    needs: 'a statement executor with a deadline, which τ² delegates to its own environment',
  },
  { id: 'V49-dose-truncated', needs: 'a one-slot arm whose every pack carries at most one item' },
  { id: 'V50-admission-engaged', needs: 'a per-question admission arm with a floor fitted per fold' },
  { id: 'V51-channel-applied', needs: 'a channel arm that rewrites the prompt, and its share floor' },
];

/** The enabling fields, named as the audit reports them. */
export type Tau2Field =
  | 'funnel'
  | 'meanPackIds'
  | 'partition'
  | 'parseRate'
  | 'detectablePp'
  | 'controls'
  | 'channel'
  | 'callFailureRate'
  | 'learning'
  | 'domainOrigin'
  | 'transfer';

/**
 * The fields behind each gate, so an absence can name the fact rather than the gate.
 *
 * A record rather than a map with a fallback: adding a member to `Tau2Field` without saying what it
 * is becomes a type error, and an absence that could fall back to its own field name would read
 * `the lane's own record: partition` in a published report.
 */
const FIELD_OF: Readonly<Record<Tau2Field, string>> = {
  funnel: 'the counts from a correction to a servable rule, so a zero can be located',
  meanPackIds: 'the mean number of recalled items per prompt',
  partition: 'the split, so leaking and duplication can be counted',
  parseRate: 'the share of trials that carried a verdict',
  detectablePp: 'the paired comparison, from which the minimum detectable difference follows',
  controls: 'the list of pack-based controls, which this lane states as empty',
  channel: 'the strongest channel control, which this lane states as absent',
  callFailureRate: 'the agent call tally, which a separate process owns',
  learning: 'the correction bookkeeping: rows, unanswered, edited, failed to distil',
  domainOrigin: "the provenance of each stored item's scope domain",
  transfer: 'a cross-domain arm: the store answering a scenario it never learned, with its pairs',
};

/**
 * The projection, plus what it could not say.
 *
 * `input` is a legal `ProtocolGateInput` on every path — that is the point of making the eight
 * mandatory fields optional in stage 2. `supplied` is what the record actually contained, so a
 * caller can tell a gate that fired from a gate that was skipped over a field the lane never wrote.
 */
export type Tau2Projection = {
  readonly input: ProtocolGateInput & ScenarioGateInput;
  readonly supplied: readonly Tau2Field[];
};

function partitionOf(
  memory: Tau2ArmRecord | undefined,
  comparison: Tau2ComparisonRecord | undefined,
): ProtocolGateInput['partition'] {
  const split = memory?.split;
  if (split === undefined || comparison === undefined) return undefined;
  // The leak count is a property of the two lists, not of the comparison: an evaluated task the
  // store could have learned from is the one failure the whole split exists to prevent, and it is
  // invisible in the arm's own totals.
  const trained = new Set(split.train);
  const leaked = split.test.filter((id) => trained.has(id)).length;
  const duplicated = split.test.length - new Set(split.test).size;
  return {
    evaluated: comparison.paired,
    total: comparison.paired + comparison.onlyFirst + comparison.onlySecond,
    duplicated,
    leaked,
  };
}

function parseRateOf(arm: Tau2ArmRecord | undefined): number | undefined {
  if (arm === undefined || arm.tasks <= 0) return undefined;
  return (arm.tasks - arm.unscored) / arm.tasks;
}

/**
 * The minimum detectable difference the comparison could have resolved.
 *
 * In percentage points, through the same `detectableDelta` the BIRD lane uses: `z = 2.802` is α at
 * 0.05 two-sided with 80% power, and the discordance is what both arms actually disagreed on. The
 * number a τ² run produces this way is not the 95% half-width the lane has been quoting — that is
 * `1.96·SE`, and 2.802/1.96 = 1.43, so the two differ by nearly half again. Both are in the
 * artefact; the gate reads this one because it is the one the gate's own criterion names.
 */
export function tau2DetectablePp(comparison: Tau2ComparisonRecord | undefined): number | undefined {
  if (comparison === undefined || comparison.paired <= 0) return undefined;
  const discordance = (comparison.lost + comparison.gained) / comparison.paired;
  const value = detectableDelta(comparison.paired, discordance);
  return Number.isFinite(value) ? value * 100 : undefined;
}

/**
 * Everything the evidence can put into a `ProtocolGateInput`, and nothing it cannot.
 *
 * The two statements that are always made — an empty control list and an absent channel control —
 * are not defaults: τ² ran no pack-based control and no channel control, and saying so is what lets
 * `V6` and `V7` fire and be recognised as vacuous rather than be silently omitted.
 */
export function tau2ProtocolInput(evidence: Tau2Evidence): Tau2Projection {
  const memory = evidence.memory;
  const supplied: Tau2Field[] = ['controls', 'channel'];
  // A mutable bag rather than a cast per field: the gate input's properties are `readonly` for
  // every consumer, and a projection that reassigned through a cast on the finished object would
  // be able to overwrite a field after `supplied` had already been computed from it.
  const extra: {
    funnel?: FunnelInput;
    declaredEmptyStore?: boolean;
    meanPackIds?: number;
    packPopulation?: NonNullable<ProtocolGateInput['packPopulation']>;
    partition?: NonNullable<ProtocolGateInput['partition']>;
    parseRate?: number;
    detectablePp?: number;
    claimPp?: number | null;
    callFailureRate?: number;
    calls?: number;
    callFailures?: number;
    callPopulation?: NonNullable<ProtocolGateInput['callPopulation']>;
    learning?: NonNullable<ProtocolGateInput['learning']>;
    domainOrigin?: NonNullable<ProtocolGateInput['domainOrigin']>;
    transfer?: TransferGateInput;
  } = {};

  if (memory?.funnel !== undefined) {
    // Recorded by the driver rather than derived here. A projection that recomputed the counts from
    // the arm's other fields would be able to disagree with the store it is describing, and the one
    // thing `V0` exists to catch is two counts taken over different populations.
    extra.funnel = memory.funnel;
    supplied.push('funnel');
  }
  // Read beside the funnel rather than instead of it: the declaration changes what a zero *means*,
  // and it is only meaningful on the same record that carries the counts.
  if (memory?.declaredEmptyStore !== undefined) {
    extra.declaredEmptyStore = memory.declaredEmptyStore;
  }
  if (memory?.meanPackIds !== undefined) {
    extra.meanPackIds = memory.meanPackIds;
    supplied.push('meanPackIds');
    // The same field supplies the population behind the rate: a rate over no requests is not a rate.
    // Both halves of the census travel together or neither does, because one of them alone is the
    // number that could not explain R42's empty pack.
    if (memory.store !== undefined && memory.recall !== undefined) {
      extra.packPopulation = {
        stored: memory.store.stored,
        active: memory.store.active,
        servable: memory.store.servable,
        requests: memory.recall.requests,
        served: memory.recall.served,
      };
    }
  }
  const partition = partitionOf(memory, evidence.comparison);
  if (partition !== undefined) {
    extra.partition = partition;
    supplied.push('partition');
  }
  const parseRate = parseRateOf(memory);
  if (parseRate !== undefined) {
    extra.parseRate = parseRate;
    supplied.push('parseRate');
  }
  const detectablePp = tau2DetectablePp(evidence.comparison);
  if (detectablePp !== undefined) {
    extra.detectablePp = detectablePp;
    supplied.push('detectablePp');
  }
  // `undefined` is not a claim of "nothing claimed": it is a lane that does not report claims, and
  // the protocol reads it as such. Only the pair step can say `null`, because only it has a verdict.
  if (evidence.claimPp !== undefined) {
    extra.claimPp = evidence.claimPp;
  }
  // A call tally of zero is not perfect reliability, it is a counter nobody incremented: the arm
  // artefacts written before this field existed carry `calls: 0` beside sixty-eight scored tasks,
  // which is impossible. Reading that as a rate would report the best possible score for the least
  // possible evidence, so the guard is on the count rather than on the ratio.
  if (memory?.turns !== undefined && memory.turns.total > 0) {
    extra.callFailureRate = memory.turns.failures / memory.turns.total;
    extra.calls = memory.turns.total;
    extra.callFailures = memory.turns.failures;
    // Named, because this lane's counter counts turns: the model calls happen in the agent process.
    extra.callPopulation = memory.turns.scope === 'distillation' ? 'calls' : 'turns';
    supplied.push('callFailureRate');
  }
  if (memory?.learning !== undefined) {
    extra.learning = memory.learning;
    supplied.push('learning');
  }
  if (memory?.domainOrigin !== undefined) {
    extra.domainOrigin = memory.domainOrigin;
    supplied.push('domainOrigin');
  }
  // The transfer reading is the pair's, not the arm's: it holds two verdicts per episode and neither
  // artefact can produce it alone. Supplying it from `evidence` rather than from `memory` is what
  // makes the absence of a cross-domain arm an absent gate instead of a fabricated one.
  if (evidence.transfer !== undefined) {
    extra.transfer = evidence.transfer;
    supplied.push('transfer');
  }
  return { input: { packControls: [], channelBest: undefined, ...extra }, supplied };
}

/** What the audit found, in the four buckets the header describes. */
export type Tau2GateAudit = {
  /** The protocol's gates that fired, in publication order. */
  readonly gates: readonly ValidityGate[];
  /** Gates whose enabled field was present. */
  readonly evaluable: readonly string[];
  /** Gate ids that fired with an empty arm behind them: they pass and certify nothing. */
  readonly vacuous: readonly string[];
  /** Gates this lane cannot fire, each naming the arm that would make it fire. */
  readonly absent: readonly { readonly id: string; readonly needs: string }[];
  /** Gates the lane's record type can feed, present or not. */
  readonly supplyable: number;
  /** Gates that need an arm this lane never ran. */
  readonly armIndexed: number;
  /**
   * Gates this arm has no subject for, because it declared its store empty.
   *
   * Absent on every arm that declared nothing, which is every committed artefact: a field that said
   * "omitted nothing" on every normal run would be a column nobody reads. Present, it is the record
   * §34.128 asks for — the omission is a statement in the report rather than a silence.
   */
  readonly omitted?: readonly OmittedGate[];
};

/**
 * Run the protocol over the evidence and account for every gate.
 *
 * The accounting is the deliverable: `evaluable + absent` must equal `GATE_ORDER` exactly, in both
 * directions, and a gate that appears in neither is a gate the tables forgot. That invariant is
 * enforced by a test rather than by the type system, because the tables are data.
 */
export function tau2GateAudit(evidence: Tau2Evidence): Tau2GateAudit {
  const projection = tau2ProtocolInput(evidence);
  const { gates, omitted } = buildProtocolGatesWithScope(projection.input);
  const evaluable = gates.map((gate) => gate.id);
  const present = new Set(evaluable);
  // A gate the declaration removed is not an absent gate: `absent` means "this lane has no arm that
  // could fire it", and this one had an arm — the arm said it had nothing for the gate to read.
  const declaredAway = new Set(omitted.map((entry) => entry.id));

  // Two gates fire on an empty list by construction — `every` over nothing is true — so they are
  // separated from the ones that read a measurement. The test is on the input rather than on the
  // gate's sentence, because a report that sniffed its own prose would break the day the prose did.
  const vacuous: string[] = [];
  if (projection.input.packControls.length === 0) vacuous.push('V6-controls-inject');
  if (projection.input.channelBest === undefined) vacuous.push('V7-channel');

  const absent = ARM_INDEXED.filter((entry) => !present.has(entry.id) && !declaredAway.has(entry.id));
  const unrecorded = SUPPLYABLE.filter(
    (entry) => !projection.supplied.includes(entry.field) && !present.has(entry.id),
  )
    .filter((entry) => !declaredAway.has(entry.id))
    .map((entry) => ({
      id: entry.id,
      needs: `the lane's own record, which this run did not carry: ${FIELD_OF[entry.field]}`,
    }));

  return {
    gates,
    ...(omitted.length === 0 ? {} : { omitted }),
    evaluable,
    vacuous: vacuous.filter((id) => present.has(id)),
    absent: [...absent, ...unrecorded].sort(
      (left, right) => GATE_ORDER.indexOf(left.id) - GATE_ORDER.indexOf(right.id),
    ),
    supplyable: SUPPLYABLE.length,
    armIndexed: ARM_INDEXED.length,
  };
}

/** The tables, for the test that holds them to `GATE_ORDER`. */
export const TAU2_GATE_INDEX: {
  readonly supplyable: typeof SUPPLYABLE;
  readonly armIndexed: typeof ARM_INDEXED;
} = { supplyable: SUPPLYABLE, armIndexed: ARM_INDEXED };

/**
 * An arm artefact, as much of it as the projection reads.
 *
 * Loose on purpose. The committed τ² arms were written before this module existed, so the required
 * half is exactly the three numbers every version of `bin/l4.ts` has emitted, and everything the
 * stage-2 instrumentation adds lives under `tau2`, which no committed artefact carries yet.
 */
export type Tau2ArmArtefact = {
  readonly n?: number;
  readonly metrics?: Readonly<Record<string, unknown>>;
  readonly tau2?: {
    readonly arm?: string;
    readonly meanPackIds?: number;
    readonly turns?: { readonly total: number; readonly failures: number };
    /** The provider's own account of the phase; absent on every artefact written before R103. */
    readonly usage?: Tau2ArmRecord['usage'];
    readonly learning?: Tau2ArmRecord['learning'];
    readonly domainOrigin?: Tau2ArmRecord['domainOrigin'];
    readonly split?: { readonly train: readonly string[]; readonly test: readonly string[] };
    readonly scenario?: Tau2ArmRecord['scenario'];
    readonly store?: Tau2ArmRecord['store'];
    readonly recall?: Tau2ArmRecord['recall'];
    readonly use?: Tau2ArmRecord['use'];
    readonly coverage?: Tau2ArmRecord['coverage'];
    /**
     * R54/R56: the pipeline from a correction to a servable rule.
     *
     * This type is the second hand-written projection in the lane, and it dropped this field -- so
     * `V0-instrument-ready`, whose only subject it is, was absent on every pair artefact ever
     * written, including the one R56 published. A gate cannot fire on a field the bridge to it does
     * not carry, and nothing in the failing artefact said the field was missing.
     */
    readonly funnel?: FunnelInput;
    /** R101: the arm's declaration that its store is empty by construction. */
    readonly declaredEmptyStore?: boolean;
  };
};

function countOf(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * One arm's artefact, read into the record the projection wants.
 *
 * `metrics.k` is the trial count the grid was scored at and `metrics.unscored_tasks` is the
 * denominator the reader dropped; both are written by every version of the lane, and using them
 * rather than re-deriving them keeps the projection from disagreeing with the reader that produced
 * the score.
 */
export function tau2ArmRecordOf(arm: string, artefact: Tau2ArmArtefact): Tau2ArmRecord {
  const metrics = artefact.metrics ?? {};
  const tasks = countOf(metrics['tasks'], countOf(artefact.n, 0));
  return {
    arm,
    tasks,
    trials: countOf(metrics['k'], 0),
    unscored: countOf(metrics['unscored_tasks'], 0),
    ...(artefact.tau2?.meanPackIds === undefined ? {} : { meanPackIds: artefact.tau2.meanPackIds }),
    ...(artefact.tau2?.turns === undefined ? {} : { turns: artefact.tau2.turns }),
    ...(artefact.tau2?.learning === undefined ? {} : { learning: artefact.tau2.learning }),
    ...(artefact.tau2?.domainOrigin === undefined
      ? {}
      : { domainOrigin: artefact.tau2.domainOrigin }),
    ...(artefact.tau2?.split === undefined ? {} : { split: artefact.tau2.split }),
    ...(artefact.tau2?.scenario === undefined ? {} : { scenario: artefact.tau2.scenario }),
    // The census travels with the rate, because `V1`'s sentence is built from these two and a record
    // that dropped them printed `0.00 rules/question` with no population -- the reading this round
    // added to distinguish "never asked" from "asked 1,518 times and was served nothing".
    ...(artefact.tau2?.store === undefined ? {} : { store: artefact.tau2.store }),
    ...(artefact.tau2?.recall === undefined ? {} : { recall: artefact.tau2.recall }),
    // The use census travels with V1's rate: a record that kept the pack size
    // but dropped what was in the pack would still be unable to say whether a
    // served pack was relevant. The coverage histogram travels beside it: a
    // scalar cannot say what a floor would empty. Older artefacts carry neither
    // and stay silent.
    ...(artefact.tau2?.use === undefined ? {} : { use: artefact.tau2.use }),
    ...(artefact.tau2?.coverage === undefined ? {} : { coverage: artefact.tau2.coverage }),
    // The pipeline, which `V0` grades: five stages and two reconciliations, recorded by the driver
    // rather than derived here. A projection that carried the counts but not the chain would let a
    // zero be reported without the stage it happened at.
    ...(artefact.tau2?.funnel === undefined ? {} : { funnel: artefact.tau2.funnel }),
    // The arm's own declaration, read from the arm rather than inferred from the counts above it: a
    // pair whose memory side has an empty funnel is a broken memory arm or a scaffold arm, and only
    // the arm can say which. Inference would have graded R101 by the reading it was built to replace.
    ...(artefact.tau2?.declaredEmptyStore === undefined
      ? {}
      : { declaredEmptyStore: artefact.tau2.declaredEmptyStore }),
  };
}
