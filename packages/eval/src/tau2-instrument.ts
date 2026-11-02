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
 */
import type { Tau2ArmRecord } from './tau2-gates.js';

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
    readonly scope?: 'run' | 'distillation';
  };
  /**
   * Which scenario each half ran in, and the scope the facade recalled under.
   *
   * Three names rather than one because a cross-domain arm has three: it learns in one scenario,
   * answers in another, and asks the store for items under the scope the items were stored with. The
   * third is what makes a foreign pack possible at all — recall is scoped, and a store scoped to
   * `retail` serves nothing to an `airline` question unless the caller asks in the store's own terms.
   */
  readonly scenario: { readonly learn: string; readonly test: string; readonly recall: string };
  /** The domain ledger: what the store holds, and the two paths by which an item loses its domain. */
  readonly domains: {
    readonly stored: number;
    readonly withoutDomain: number;
    readonly unscopedIn: number;
    readonly widenedIn: number;
  };
};

export function armRecordFromDriver(raw: Tau2Raw, arm = 'memory'): Tau2ArmRecord {
  const served = raw.servedPackSizes;
  const meanPackIds = served.length === 0 ? 0 : served.reduce((sum, size) => sum + size, 0) / served.length;
  const distinct = new Set(raw.test);

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
            ...(raw.calls.scope === undefined ? {} : { scope: raw.calls.scope }),
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
      ...(raw.learning.candidates === undefined ? {} : { candidates: raw.learning.candidates }),
      ...(raw.learning.events === undefined ? {} : { events: raw.learning.events }),
      ...(raw.learning.llmFailed === undefined ? {} : { llmFailed: raw.learning.llmFailed }),
    },
    domainOrigin: {
      storedWithDomain: Math.max(0, raw.domains.stored - raw.domains.withoutDomain),
      storedWithoutDomain: raw.domains.withoutDomain,
      unscopedIn: raw.domains.unscopedIn,
      widenedIn: raw.domains.widenedIn,
    },
    // Repeats kept: see decision 4.
    split: { train: raw.train, test: raw.test },
    scenario: raw.scenario,
    // Absent when the driver did not list the scenario it was capped against; the pair then reports
    // no ceiling rather than a ceiling built on a guess.
    ...(raw.scenarioTasks === undefined ? {} : { scenarioTasks: raw.scenarioTasks }),
  };
}
