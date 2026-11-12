/**
 * What the τ² driver can see, reduced to the arm record the protocol's gates read.
 *
 * ## Why this is a module rather than a literal in the driver
 *
 * The BIRD lane reads everything the gates need out of its own process: it renders the prompt, calls
 * the model, parses the reply and executes the statement, so `meanPackIds`, the call tally, the
 * learning bookkeeping and the domain ledger are side effects of work it already did. The τ² lane
 * does none of that — the agent runs in another process and the evaluator hands back a verdict — so
 * the same readings have to be *reconstructed* from what crosses the boundary, and a reconstruction
 * is the kind of arithmetic that is wrong until it is tested.
 *
 * The second reason is that R29's prediction is about how many gates a second scenario can supply.
 * That prediction is only checkable if the mapping from raw counts to an arm record is one named
 * function with its own tests, rather than a block inside a driver that needs a τ² environment to run.
 * A dispatch is then evidence about the environment, not about the arithmetic.
 *
 * ## The four decisions
 *
 * 1. **An empty pack set is `0`, not absent.** V1 asks whether the memory injected anything; a run
 *    that served no items is V1's failure case, and `undefined` would turn "injected nothing" into
 *    "not applicable".
 * 2. **No calls is not perfect reliability.** `calls` is omitted when the run made none, because
 *    `0/0` reported as `0` is the strongest possible reliability claim made on no evidence.
 * 3. **An unobservable count omits its gate rather than defaulting — and nothing here is
 *    unobservable.** The first version of this file argued that the distillation failure count could
 *    not be seen from outside the store, and omitted the whole learning record to avoid handing
 *    `V32` a zero. `host.distill` returns that count; the driver was discarding it. A record that
 *    omits `V32` is a record that cannot say "nothing was distilled", which is exactly what the
 *    first cross-domain dispatch did.
 * 4. **The split is passed through with its repeats.** `tasks` counts distinct held-out tasks, which
 *    is the denominator a rate means; `split.test` keeps the evaluation order *including* repeats, so
 *    a driver that ran a task twice is visible to `V2` instead of being silently de-duplicated.
 * 5. **A zero says which zero it is.** `meanPackIds` is the mean of what the facade served, and both
 *    "the agent never asked" and "the store had nothing to serve" produce `0.00` from it. R42 served
 *    zero items from a store of fourteen and the record could not say which of the two it was, so the
 *    arm's census (`storeCensus`) and the request tally (`recall`) travel beside the rate.
 */
import { defaultPolicy } from "@agentix-e/microglia-core/kernel";
import type { FunnelInput } from "@agentix-e/microglia-protocol";
import type { AdmissionCensus, Tau2ArmRecord } from "./tau2-gates.js";
import type { StoreItemSample } from "./store-items.js";
import type { ConsolidationCensus } from "@agentix-e/microglia-core/distill";
import type { InactionCensus } from "./inaction.js";
import type { YieldCensus } from "./tau2-yield.js";
import type { PlantCensus } from "./plant.js";
import type { ConsolidationSweep } from "./consolidation-sweep.js";
import type { ProvenanceCensus } from "./tau2-provenance.js";
import {
  coverageHistogram,
  useCensus,
  type UseArm,
  type UseObservation,
} from "./tau2-use-census.js";

export type { AdmissionCensus } from "./tau2-gates.js";

const emptyAdmission = (): AdmissionCensus => ({
  measured: 0,
  trustMin: 0,
  trustMax: 0,
  trustMean: 0,
  supportMin: 0,
  supportMax: 0,
  supportMean: 0,
  confidenceMin: 0,
  confidenceMax: 0,
  confidenceMean: 0,
  supportOnly: 0,
});

const spread = (
  values: readonly number[],
): { min: number; max: number; mean: number } =>
  values.length === 0
    ? { min: 0, max: 0, mean: 0 }
    : {
        min: Math.min(...values),
        max: Math.max(...values),
        mean: values.reduce((sum, value) => sum + value, 0) / values.length,
      };

/** The form a distiller was asked for, and the ban's subject and count. See `Tau2Raw.distillForm`. */
export type DistillFormRecord = {
  readonly form: string;
  /** The action names the ban refused, from the corrections this run learned from. */
  readonly toolInventory: readonly string[];
  /** Candidates the host refused for naming one of them. */
  readonly refused: number;
  /**
   * The completion budget this run's distillation calls were given.
   *
   * Absent on every artefact before the field existed, which is what made R56's re-dispatch
   * unreadable on the one number a truncated reply would need: a store built under a 1,200-token
   * ceiling and one built under 2,000 are two experiments, and neither artefact said which it was.
   */
  readonly maxTokens?: number;
};

/**
 * R58: the unit distilled, the traces it read, and what the recurrence pass did with them.
 *
 * Three facts in one record because a trace arm's reading is uninterpretable without all three: the
 * unit says which object the model was shown, `traces`/`traced` say whether the document it was read
 * from carried that object at all (a run that fell back to corrections has the trace arm's name and
 * the control's store), and the census is the only place `supportAfter` exists — the store's items
 * carry `supportTasks` one at a time, and the distribution over them is what a recurrence threshold
 * asks about.
 */
export type DistillUnitRecord = {
  readonly unit: "correction" | "trace";
  /** Traces the learning document carried. */
  readonly traces: number;
  /** Corrections that carried one, and were therefore distilled from a trace. */
  readonly traced: number;
  /** Candidates the interpreter returned before any screening. */
  readonly claims: number;
  /** Absent when the pass did not run, which on a trace arm is a defect rather than a zero. */
  readonly consolidation?: ConsolidationCensus;
};

/** The sentence every pack opened with. See `Tau2Raw.injectionNote`. */
export type InjectionNoteRecord = {
  readonly mode: "none" | "standard" | "hardened";
  readonly declared: boolean;
};

/** What the driver observed, exactly as it observed it. */
export type Tau2Raw = {
  /** Task ids the store learned from. */
  readonly train: readonly string[];
  /** Task ids answered by the frozen store, in evaluation order and with repeats kept. */
  readonly test: readonly string[];
  /** Trials per task the grid was scored at. */
  readonly trials: number;
  /**
   * How many tasks each scenario holds, from the listing.
   *
   * The listing is the one place a run learns the size of the task set it was given a *cap* of, and
   * the cap is what hides it: an artefact that records fifty evaluated tasks says nothing about
   * whether the scenario had fifty or a thousand. The pair needs the difference, because the smallest
   * difference any split of a scenario can decide is a function of how many tasks there are to split —
   * see `ceilingOf`. Absent on artefacts written before this field existed, and the pair then says
   * nothing about the ceiling rather than inventing one.
   */
  readonly scenarioTasks?: { readonly learn: number; readonly test: number };
  /** Tasks dropped from the denominator because a trial carried no verdict. */
  readonly unscored: number;
  /** Items in each pack the recall facade served, one entry per request. */
  readonly servedPackSizes: readonly number[];
  /**
   * The learning half's bookkeeping.
   *
   * Every count here is observed by the driver, so every count here is required. The first version
   * made `distillFailed` optional on the argument that a correction producing no rule and a
   * distiller failing on one are the same shape from outside the store — which was true of the
   * driver that wrote it and false of `host.distill`, whose report says which of the two happened.
   * Omitting the record then made `V32` absent on the one dispatch where it would have fired, and
   * the empty store that `V1` reported had no explanation anywhere in the artefact.
   */
  readonly learning: {
    readonly rows: number;
    /**
     * Training tasks the driver could not read: unscored, or failed with no criteria.
     *
     * Not `rows - corrections`, which is the arithmetic this field had first and which counts every
     * task the model *passed* as a question the record lost. A pass needs no correction, so on a
     * training half where the model solves a third of the tasks a store built from every failure
     * read as 33% unanswered and failed a blocking gate. `unansweredTasks` holds the decision, and
     * it is the same one `learnableCorrections` makes, read the other way round.
     */
    readonly unanswered: number;
    readonly edited: number;
    readonly distilled: number;
    readonly distillFailed: number;
    /** Claims the distiller produced, before the store kept or merged them. */
    readonly candidates?: number;
    /** Feedback events the distiller was asked about. */
    readonly events?: number;
    /**
     * Claims the parser parsed and did not keep, by reason.
     *
     * `candidates` is counted after this filter and `distillFailed` only counts throws, so a claim the
     * schema refused is in neither — and a store built from the survivors of a filter nobody counted
     * is a store whose size has no explanation. R56's re-dispatch read `0 candidate(s)` and the
     * artefact had no field that could say whether the model or the parser was responsible.
     */
    readonly dropped?: Readonly<Record<string, number>>;
    /** Events the model interpreter threw on, answered by the rule interpreter instead. */
    readonly llmFailed?: number;
  };
  /**
   * Calls the run made to the model, and how many of them failed after retries.
   *
   * `scope` says whose tally this is. The episodes' calls belong to the agent process, which reports
   * a turn count rather than a call count and only when it feels like it; the distillation calls are
   * the driver's own. A rate is only a rate over a stated population, and the two are not the same
   * population.
   */
  readonly calls: {
    readonly total: number;
    readonly failed: number;
    readonly scope?: "run" | "distillation";
  };
  /**
   * Which scenario each half ran in, and the scope the facade recalled under.
   *
   * Three names rather than one because a cross-domain arm has three: it learns in one scenario,
   * answers in another, and asks the store for items under the scope the items were stored with. The
   * third is what makes a foreign pack possible at all — recall is scoped, and a store scoped to
   * `retail` serves nothing to an `airline` question unless the caller asks in the store's own terms.
   */
  readonly scenario: {
    readonly learn: string;
    readonly test: string;
    readonly recall: string;
  };
  /** The domain ledger: what the store holds, and the two paths by which an item loses its domain. */
  readonly domains: {
    readonly stored: number;
    readonly withoutDomain: number;
    readonly unscopedIn: number;
    readonly widenedIn: number;
  };
  /** What the store holds by status, and how much of it the recall scope can reach. */
  readonly store?: StoreCensus;
  /** What the facade was asked for, and how often it had an answer. */
  readonly recall?: RecallTally;
  /**
   * What the delivered packs actually contained, one row per recall request.
   *
   * Absent on drivers that did not instrument the use side (every artefact
   * before R46). `armRecordFromDriver` turns these into the `use` census; a raw
   * record without them reports no census rather than a census full of zeros.
   * The driver collects statements at the facade boundary, so this is what the
   * agent was shown, not what the store happens to hold.
   */
  readonly useObservations?: readonly UseObservation[];
  /** The use policy the observations were collected under. Defaults to `as-is`. */
  readonly useArm?: UseArm;
  /** Widened (`domain === undefined`) items in the store, from its domain ledger. */
  readonly widenedItems?: number;
  /**
   * The observations the coverage curve is computed from, when they are not the
   * ones the `use` census describes.
   *
   * A paired dispatch grades the *gated* facade, so `useObservations` is the
   * population after the floor — and a histogram built from a filtered population
   * prices every floor at or below the applied one as free. R49's artefact shows
   * it: floors 0 and 0.01 both retain 1164 pairs, because 0.01 was already
   * applied when the pairs were recorded, while the as-is facade in the same run
   * served 1435 packs against 949. The curve has to come from the ungated facade,
   * or the next floor is chosen from a table that says it costs nothing.
   */
  readonly coverageObservations?: readonly UseObservation[];
  /**
   * Whether the agent acted at all, per task, over the graded facade.
   *
   * R53's fourth prediction is that a licence to disregard a rule must not become a licence to stop
   * acting, and this census is its subject. `evaluateFacade` built one for every facade and the
   * single-facade path -- which is every dispatch since R49 unless the paired facade is switched on
   * -- discarded it, so the prediction had nothing to read while R49's paired path quietly kept its
   * own copy. One caller using a field is what makes the other caller's loss invisible.
   */
  readonly inaction?: InactionCensus;
  /**
   * R53: the sentence every pack in this arm opened with.
   *
   * `declared` separates "this run is the standard arm" from "nobody set the switch", and
   * `mode` is the level. Absent on every artefact written before R53, which reads as "not
   * measured" rather than as `standard`: a readback cannot attribute a sentence the artefact
   * never recorded, and a level nobody declared is not evidence that the default ran.
   */
  /** R54: the store's own words, bounded. See `storeItemSample`. */
  readonly storeItems?: StoreItemSample;
  /**
   * R56: the form the distiller was asked for, and the inventory its ban refused names from.
   *
   * Absent on artefacts written before this field, which reads as "the form was not recorded" rather
   * than as `lesson`: a readback that assumed the old default would attribute a difference between
   * two runs to a treatment one of them never declared. R56 says so itself — *if the artefact cannot
   * say which form ran, the run is `NO_MEASUREMENT`* — and the inventory is recorded beside it
   * because a ban whose subject is unknown cannot be distinguished from a ban that had nothing to do.
   */
  readonly distillForm?: DistillFormRecord;
  /** R58: the unit, the traces, and the consolidation census. See `DistillUnitRecord`. */
  readonly distillUnit?: DistillUnitRecord;
  /**
   * R60: the ceiling one trace ran under, and whether the dispatch chose it.
   *
   * Two runs at two ceilings are two experiments, and a store cannot say which one built it: the
   * ceiling decides the yield and the yield is the thing R60 measures, so a readback that cannot
   * recover it would compare a store of 31 claims against a store of 60 without knowing why.
   */
  readonly traceClaims?: {
    readonly ceiling: number;
    readonly declared: boolean;
  };
  /**
   * R62: which trajectories taught, and the store split by that.
   *
   * Recorded as a plain variant string plus a census rather than folded into `distillUnit`, because
   * the two switches are independent: a run can hold the same unit and distil from a different
   * population, and a reader that inferred the population from the unit would compare two stores that
   * differ in the only way this round moves.
   */
  readonly distillScope?: "edited" | "all";
  readonly provenance?: ProvenanceCensus;
  /**
   * R60: how many claims each correction yielded. See `YieldCensus`.
   *
   * Beside `funnel` rather than inside `distillUnit`, because it is a property of the distiller and
   * not of the unit: the correction arm yields one claim per correction by construction, and a record
   * that could only express the trace arm's yield would make the two arms' stores incomparable on the
   * axis that decides whether either can recur.
   */
  readonly yieldCensus?: YieldCensus;
  /**
   * R57: the controlled distractor this arm planted, and the level it landed at.
   *
   * Absent on every artefact before this field and on every control arm — absence is "nothing was
   * planted", which is a different reading from a census of zero plants, and only the presence of
   * `declared` inside it tells an arm from a dispatch that never heard of the switch.
   */
  readonly plant?: PlantCensus;
  /**
   * R61: every consolidation floor in the grid, and the point the pass actually ran at.
   *
   * Absent on a lane that does not consolidate. Present, it answers the question R60 could not: the
   * ceiling was binding and corroboration still did not move, so the population or the floor is the
   * constraint — and this says which, because a floor that produces three-task groups at 0.55 and
   * none at 0.60 is a floor chosen too high, while a grid that never produces one at any floor is a
   * population that does not corroborate.
   */
  readonly consolidationSweep?: ConsolidationSweep;
  readonly injectionNote?: InjectionNoteRecord;
  /**
   * How far the pipeline from a correction to a servable rule got.
   *
   * Counted by the driver at the boundaries it can see: the learning half's corrections, the
   * interpreter's candidates, the store's admissions, and the census's servable items. Absent on
   * every artefact before R55, which leaves `V0` absent rather than passing.
   */
  readonly funnel?: FunnelInput;
  /** The write path's own census, when the driver ran with admission switched on. */
  readonly writeAdmission?: {
    readonly mode: "off" | "neighbours";
    readonly rephrased: number;
    readonly suppressed: number;
  };
};

/**
 * One store, counted by the question `V1` cannot answer alone.
 *
 * `active` and `servable` are different questions and the difference is the whole point: an item is
 * *active* if the policy has cleared it for injection, and *servable* if it additionally matches the
 * scope `/v1/recall` asks in. A store of fourteen active items of which none is servable is a
 * retrieval-key defect; a store of fourteen items of which none is active is a confidence defect; a
 * store of fourteen servable items that served nothing is a defect in the facade. `0.00
 * rules/question` is the same number for all three.
 */
export type StoreCensus = {
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
  /**
   * Servable items that state a condition, and those that do not.
   *
   * R51. `when` is the half of a rule that says where it applies, and until this
   * census existed nothing counted whether the write path had produced it. On the
   * R49 store every rule was a statement with no condition: ten items, ten
   * servable, and none of them recallable by a question because the only text they
   * carried named tool calls. A pack that arrives often and says nothing about when
   * it applies is the other half of the same defect, and it needs its own number.
   */
  readonly conditioned: number;
  readonly unconditioned: number;
  /** How many items carry each admission reason, keyed by the reason the store wrote. */
  readonly reasons: Readonly<Record<string, number>>;
  /** The three numbers behind the reason, so a dispatch can verify a repair instead of repeating it. */
  readonly admission: AdmissionCensus;
};

/** What the recall endpoint saw: how many requests, and how many of them carried at least one item. */
export type RecallTally = {
  readonly requests: number;
  readonly served: number;
  readonly empty: number;
};

/** The fields `storeCensus` reads, so a caller can pass items from any store implementation. */
type CensusItem = {
  readonly status: string;
  readonly scope: { readonly domain?: string };
  /** The condition the item states, when it states one. Absent on stores written before R51. */
  readonly when?: string;
  /** Why the admission gate left the item where it is. `undefined` on items that record none. */
  readonly statusReason?: string;
  /** Optional on stores written before R45; `admission.measured` says how many reported them. */
  readonly trust?: number;
  readonly support?: number;
  readonly confidence?: number;
};

/**
 * Count a store so that an empty pack has a cause.
 *
 * The scope question is asked the way `MemoryStore.search` asks it — `active`, and the domain the
 * caller recalls under — rather than by inspecting how the item was written. A census that used its
 * own definition of "reachable" would be able to agree with a broken retrieval path and disagree with
 * a working one, which is the failure mode the census exists to rule out.
 */
export function storeCensus(
  items: readonly CensusItem[],
  recallDomain: string,
): StoreCensus {
  const statuses = {
    active: 0,
    candidate: 0,
    quarantined: 0,
    retired: 0,
    other: 0,
  };
  for (const item of items) {
    const key = item.status;
    if (
      key === "active" ||
      key === "candidate" ||
      key === "quarantined" ||
      key === "retired"
    ) {
      statuses[key] += 1;
    } else {
      statuses.other += 1;
    }
  }
  const servable = items.filter(
    (item) => item.status === "active" && item.scope.domain === recallDomain,
  ).length;
  // The reason travels with the status because one status covers several decisions: `candidate` is what
  // an item that missed `minSupport`, an item whose confidence fell short, and a prose claim awaiting a
  // second task all read as, and the three have nothing in common but the word.
  const reasons: Record<string, number> = {};
  for (const item of items) {
    if (item.statusReason !== undefined && item.statusReason !== "") {
      reasons[item.statusReason] = (reasons[item.statusReason] ?? 0) + 1;
    }
  }
  // Only items that reported all three numbers are measured. A legacy store with
  // none of them yields an all-zero admission block, which says "not recorded"
  // rather than inventing a mean over a population that does not exist.
  const measured = items.filter(
    (item) =>
      item.trust !== undefined &&
      item.support !== undefined &&
      item.confidence !== undefined,
  );
  const trust = spread(measured.map((item) => item.trust as number));
  const support = spread(measured.map((item) => item.support as number));
  const confidence = spread(measured.map((item) => item.confidence as number));
  const admission: AdmissionCensus =
    measured.length === 0
      ? emptyAdmission()
      : {
          measured: measured.length,
          trustMin: trust.min,
          trustMax: trust.max,
          trustMean: trust.mean,
          supportMin: support.min,
          supportMax: support.max,
          supportMean: support.mean,
          confidenceMin: confidence.min,
          confidenceMax: confidence.max,
          confidenceMean: confidence.mean,
          supportOnly: measured.filter(
            (item) =>
              (item.support as number) >= defaultPolicy.minSupport &&
              (item.confidence as number) < defaultPolicy.activationThreshold,
          ).length,
        };
  // Counted over the servable population rather than the whole store: an item the
  // recall scope cannot reach is unconditioned for a different reason, and adding
  // the two populations together would let one defect hide behind the other.
  const servableItems = items.filter(
    (item) => item.status === "active" && item.scope.domain === recallDomain,
  );
  const conditioned = servableItems.filter(
    (item) => item.when !== undefined && item.when.trim().length > 0,
  ).length;
  return {
    stored: items.length,
    active: statuses.active,
    servable,
    statuses,
    reasons,
    admission,
    conditioned,
    unconditioned: servable - conditioned,
  };
}

/**
 * Every field of the driver's record, and what the arm record does with it.
 *
 * R56 lost `storeItems`, `distillForm` and `injectionNote` here: the driver wrote all three, the
 * artefact carried none, and nothing failed. The mapping below is a hand-written field list, so a
 * field added to `Tau2Raw` is carried only if somebody remembers to carry it — and a forgotten field
 * is invisible, because the artefact still looks complete.
 *
 * This table is the decision, written down once, typed with `-?` so that `keyof Tau2Raw` is
 * exhaustive: **a field added to the driver's record fails to compile until it is given a
 * decision.** Two values, because there are two ways to carry a field.
 *
 *  - `carried` — the arm record has a key of the same name, and the test asserts it is present
 *    whenever the raw record defines it.
 *  - `reduced` — the field is folded into a different key (`train`/`test` into `split`, `domains`
 *    into `domainOrigin`, `useObservations` into `use` and `coverage`). A `reduced` field must NOT
 *    appear verbatim, which is what stops a decision from being flipped without the mapping moving.
 *
 * It costs nothing at run time and it is not read by the function; `tsc` is the reader. That is
 * deliberate. A check that has to be invoked can be skipped in the one dispatch that matters.
 */
export const PROJECTION: {
  readonly [K in keyof Tau2Raw]-?: "carried" | "reduced";
} = {
  train: "reduced",
  test: "reduced",
  trials: "carried",
  scenarioTasks: "carried",
  unscored: "carried",
  servedPackSizes: "reduced",
  learning: "carried",
  calls: "carried",
  scenario: "carried",
  domains: "reduced",
  store: "carried",
  recall: "carried",
  useObservations: "reduced",
  coverageObservations: "reduced",
  inaction: "carried",
  useArm: "reduced",
  widenedItems: "reduced",
  storeItems: "carried",
  distillForm: "carried",
  distillUnit: "carried",
  distillScope: "carried",
  provenance: "carried",
  traceClaims: "carried",
  yieldCensus: "carried",
  consolidationSweep: "carried",
  plant: "carried",
  injectionNote: "carried",
  funnel: "carried",
  writeAdmission: "carried",
};

export function armRecordFromDriver(
  raw: Tau2Raw,
  arm = "memory",
): Tau2ArmRecord {
  const served = raw.servedPackSizes;
  const meanPackIds =
    served.length === 0
      ? 0
      : served.reduce((sum, size) => sum + size, 0) / served.length;
  const distinct = new Set(raw.test);
  // One observation list for every use-side reading: the census, the retention
  // curve and the two medians. They are three reductions of one population, and
  // building one of them from a different facade than the others would make the
  // artefact disagree with itself rather than report two views of one delivery.
  //
  // A function rather than a local, so the list arrives non-optional and no
  // defensive `?? []` has to stand in for a branch that cannot be taken.
  const useSide = (observations: readonly UseObservation[]) => ({
    use: useCensus(observations, raw.useArm ?? "as-is", raw.widenedItems ?? 0),
    // The seven-field census commits one scalar about coverage. U3's floor must be
    // computed from a committed histogram BEFORE its own dispatch (AUDIT 34.22), so
    // reduce the SAME facade observations to the retention curve here, while they
    // still exist in this process. The medians ride inside that block for the same
    // reason.
    coverage: coverageHistogram(raw.coverageObservations ?? observations),
  });

  return {
    arm,
    tasks: distinct.size,
    trials: raw.trials,
    unscored: raw.unscored,
    meanPackIds,
    ...(raw.calls.total === 0
      ? {}
      : {
          calls: {
            calls: raw.calls.total,
            failures: raw.calls.failed,
            ...(raw.calls.scope === undefined
              ? {}
              : { scope: raw.calls.scope }),
          },
        }),
    // Always present: see the field's own comment. A run that distilled nothing is the reading this
    // record exists to carry, and `undefined` would turn it into a run that did not report.
    learning: {
      rows: raw.learning.rows,
      unanswered: raw.learning.unanswered,
      edited: raw.learning.edited,
      distilled: raw.learning.distilled,
      distillFailed: raw.learning.distillFailed,
      ...(raw.learning.candidates === undefined
        ? {}
        : { candidates: raw.learning.candidates }),
      ...(raw.learning.events === undefined
        ? {}
        : { events: raw.learning.events }),
      ...(raw.learning.llmFailed === undefined
        ? {}
        : { llmFailed: raw.learning.llmFailed }),
    },
    domainOrigin: {
      storedWithDomain: Math.max(
        0,
        raw.domains.stored - raw.domains.withoutDomain,
      ),
      storedWithoutDomain: raw.domains.withoutDomain,
      unscopedIn: raw.domains.unscopedIn,
      widenedIn: raw.domains.widenedIn,
    },
    // Repeats kept: see decision 4.
    split: { train: raw.train, test: raw.test },
    scenario: raw.scenario,
    // Absent when the driver did not list the scenario it was capped against; the pair then reports
    // no ceiling rather than a ceiling built on a guess.
    ...(raw.scenarioTasks === undefined
      ? {}
      : { scenarioTasks: raw.scenarioTasks }),
    // See decision 5: the rate is one field and the population is the other, and a record that
    // carried only the first turned R42's empty pack into a number with no cause.
    ...(raw.writeAdmission === undefined
      ? {}
      : { writeAdmission: raw.writeAdmission }),
    ...(raw.store === undefined ? {} : { store: raw.store }),
    // R56 lost three fields here: the driver wrote the store's text, the form and the note, and this
    // projection dropped all three, so two of the four predictions could not be graded and the third
    // could not be explained. A projection that silently drops a field is worse than one that
    // refuses, because the artefact still looks complete.
    ...(raw.storeItems === undefined ? {} : { storeItems: raw.storeItems }),
    ...(raw.distillForm === undefined ? {} : { distillForm: raw.distillForm }),
    ...(raw.distillUnit === undefined ? {} : { distillUnit: raw.distillUnit }),
    ...(raw.distillScope === undefined ? {} : { distillScope: raw.distillScope }),
    ...(raw.provenance === undefined ? {} : { provenance: raw.provenance }),
    ...(raw.traceClaims === undefined ? {} : { traceClaims: raw.traceClaims }),
    ...(raw.yieldCensus === undefined ? {} : { yieldCensus: raw.yieldCensus }),
    ...(raw.consolidationSweep === undefined
      ? {}
      : { consolidationSweep: raw.consolidationSweep }),
    ...(raw.plant === undefined ? {} : { plant: raw.plant }),
    ...(raw.injectionNote === undefined
      ? {}
      : { injectionNote: raw.injectionNote }),
    ...(raw.funnel === undefined ? {} : { funnel: raw.funnel }),
    ...(raw.recall === undefined ? {} : { recall: raw.recall }),
    ...(raw.inaction === undefined ? {} : { inaction: raw.inaction }),
    // The use census rides beside V1's rate. It is computed here, from the raw
    // observations the driver collected at the facade, so the driver carries
    // only what it saw and the arithmetic stays in one tested function. A raw
    // record with no observations reports no census at all — an older run is
    // "not measured", never a run that served a perfectly relevant empty pack.
    ...(raw.useObservations === undefined ? {} : useSide(raw.useObservations)),
  };
}
