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
 * 3. **An unobservable count omits its gate rather than defaulting.** The distillation failure count
 *    is not knowable from outside the store — "a correction produced no rule" and "the distiller
 *    failed on it" are the same shape — so the whole learning record is omitted rather than handed a
 *    zero that V32 would read as perfect.
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
  /** Tasks dropped from the denominator because a trial carried no verdict. */
  readonly unscored: number;
  /** Items in each pack the recall facade served, one entry per request. */
  readonly servedPackSizes: readonly number[];
  /**
   * The learning half's bookkeeping.
   *
   * `distillFailed` is optional because it is the one count this scenario cannot always observe:
   * reporting zero would hand V32 a perfect score on a quantity nobody measured.
   */
  readonly learning: {
    readonly rows: number;
    readonly unanswered: number;
    readonly edited: number;
    readonly distilled: number;
    readonly distillFailed?: number;
  };
  /** Calls the run made to the model, and how many of them failed after retries. */
  readonly calls: { readonly total: number; readonly failed: number };
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
      : { calls: { calls: raw.calls.total, failures: raw.calls.failed } }),
    ...(raw.learning.distillFailed === undefined
      ? {}
      : {
          learning: {
            rows: raw.learning.rows,
            unanswered: raw.learning.unanswered,
            edited: raw.learning.edited,
            distillFailed: raw.learning.distillFailed,
          },
        }),
    domainOrigin: {
      storedWithDomain: Math.max(0, raw.domains.stored - raw.domains.withoutDomain),
      storedWithoutDomain: raw.domains.withoutDomain,
      unscopedIn: raw.domains.unscopedIn,
      widenedIn: raw.domains.widenedIn,
    },
    // Repeats kept: see decision 4.
    split: { train: raw.train, test: raw.test },
    scenario: raw.scenario,
  };
}
