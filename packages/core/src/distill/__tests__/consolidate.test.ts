/**
 * Consolidation: the same claim, said twice by two tasks, becomes one item with two tasks of support.
 *
 * R58. Every mechanism in this package up to here works on *one* incoming claim against the store.
 * The exact key absorbs a repeat inside one scope, generalisation absorbs a recurrence across
 * domains, and write admission absorbs a paraphrase — but all three are asked per write, at the
 * moment when the store holds one episode of the claim and the second one has just arrived. What
 * none of them can do is look at the finished store and ask *which items are one claim*, which is
 * the question a recurrence threshold is really asking: an item's `supportTasks` cannot be raised
 * after the fact by a rule that ran before the evidence existed.
 *
 * These tests state the mechanism, its refusals and the census it reports. They are written against
 * `consolidateKnowledge` and the report rather than against the store, because the report is what a
 * lane reads and the store is what a lane serves.
 */
import { describe, expect, it } from "vitest";
import {
  createKnowledgeItem,
  defaultPolicy,
  type DistillCandidate,
  type Json,
  type KnowledgeItem,
  type KnowledgeKind,
} from "../../kernel/index.js";
import {
  claimContainment,
  claimTokens,
  consolidateKnowledge,
  sharedTerms,
} from "../consolidate.js";

const AT = 1_700_000_000_000;

function candidate(
  statement: string,
  overrides: {
    readonly id?: string;
    readonly task?: string;
    readonly taskId?: string;
    readonly when?: string;
    readonly kind?: KnowledgeKind;
    readonly payload?: Json;
    readonly weight?: number;
    readonly domain?: string;
  } = {},
): DistillCandidate {
  return {
    namespace: "tau2",
    kind: overrides.kind ?? "procedure",
    scope: {
      task: overrides.task ?? "retail",
      ...(overrides.domain === undefined ? {} : { domain: overrides.domain }),
    },
    statement,
    ...(overrides.when === undefined ? {} : { when: overrides.when }),
    ...(overrides.payload === undefined ? {} : { payload: overrides.payload }),
    evidence: {
      feedbackId: `fb_${overrides.id ?? statement}`,
      runId: `run_${overrides.id ?? statement}`,
      at: AT,
      weight: overrides.weight ?? 0.9,
      ...(overrides.taskId === undefined ? {} : { taskId: overrides.taskId }),
    },
    trust: 0.9,
    dedupeKey: `key_${overrides.id ?? statement}`,
  };
}

function item(candidateSpec: DistillCandidate, id: string): KnowledgeItem {
  return createKnowledgeItem(candidateSpec, defaultPolicy, AT, id);
}

const ONE =
  "Confirm the customer identity before changing a pending reservation";
const ONE_AGAIN =
  "Confirm the customer identity before you change a pending reservation";

describe("consolidateKnowledge", () => {
  it("merges one claim stated by two tasks into one item with two tasks of support", () => {
    const items = [
      item(candidate(ONE, { id: "a", taskId: "task-1" }), "k1"),
      item(candidate(ONE_AGAIN, { id: "b", taskId: "task-2" }), "k2"),
    ];
    const { items: after, report } = consolidateKnowledge(items, {
      now: AT,
      policy: defaultPolicy,
    });

    const live = after.filter((entry) => entry.status !== "retired");
    expect(live).toHaveLength(1);
    // The survivor carries both tasks, which is the whole point: a recurrence reading is taken
    // from `evidence`, and an item that merged evidence but not tasks would report support 1.
    expect(new Set(live[0]?.evidence.map((entry) => entry.taskId))).toEqual(
      new Set(["task-1", "task-2"]),
    );
    expect(live[0]?.evidence).toHaveLength(2);
    // Support is a sum of evidence weights, and the union's weights are the ones that remain.
    expect(live[0]?.support).toBeCloseTo(1.8, 10);
    expect(report).toMatchObject({
      considered: 2,
      groups: 1,
      merged: 1,
      retained: 1,
    });
  });

  it("retires the member it did not keep, naming the item that absorbed it", () => {
    const items = [
      item(candidate(ONE, { id: "a", taskId: "task-1" }), "k1"),
      item(candidate(ONE_AGAIN, { id: "b", taskId: "task-2" }), "k2"),
    ];
    const { items: after } = consolidateKnowledge(items, {
      now: AT,
      policy: defaultPolicy,
    });

    const retired = after.filter((entry) => entry.status === "retired");
    expect(retired).toHaveLength(1);
    const survivor = after.find((entry) => entry.status !== "retired");
    expect(retired[0]?.statusReason).toBe(`consolidated:${survivor?.id ?? ""}`);
    // A retirement is a system-time fact like every other status change: the item stops being
    // current when it is retired, and a store that left `systemUntil` at infinity would keep
    // serving it through any reader that filters on validity rather than on status.
    expect(retired[0]?.systemUntil).toBe(AT);
  });

  it("keeps the member with the most tasks, so the survivor is the best-attested one", () => {
    const three = item(candidate(ONE, { id: "a", taskId: "task-1" }), "k1");
    const two = item(candidate(ONE_AGAIN, { id: "b", taskId: "task-2" }), "k2");
    const withTwoTasks: KnowledgeItem = {
      ...two,
      evidence: [
        ...two.evidence,
        {
          feedbackId: "fb_c",
          runId: "run_c",
          at: AT,
          weight: 0.9,
          taskId: "task-3",
        },
      ],
      support: 1.8,
    };
    const { items: after } = consolidateKnowledge([three, withTwoTasks], {
      now: AT,
      policy: defaultPolicy,
    });

    const live = after.filter((entry) => entry.status !== "retired");
    expect(live).toHaveLength(1);
    expect(live[0]?.id).toBe("k2");
    expect(live[0]?.evidence).toHaveLength(3);
  });

  it("breaks a tie on the id, so two runs over one store produce one store", () => {
    const left = item(candidate(ONE, { id: "a", taskId: "task-1" }), "k9");
    const right = item(
      candidate(ONE_AGAIN, { id: "b", taskId: "task-2" }),
      "k3",
    );
    const { items: after } = consolidateKnowledge([left, right], {
      now: AT,
      policy: defaultPolicy,
    });
    const live = after.filter((entry) => entry.status !== "retired");
    expect(live.map((entry) => entry.id)).toEqual(["k3"]);
  });

  it("leaves two different claims apart, however similar their conditions are", () => {
    const items = [
      item(
        candidate(
          "Confirm the customer identity before changing a pending reservation",
          {
            id: "a",
            taskId: "task-1",
            when: "the customer asks to change a booking",
          },
        ),
        "k1",
      ),
      item(
        candidate(
          "Quote the order total before applying a discount code to an order",
          {
            id: "b",
            taskId: "task-2",
            when: "the customer asks to change a booking",
          },
        ),
        "k2",
      ),
    ];
    const { report } = consolidateKnowledge(items, {
      now: AT,
      policy: defaultPolicy,
    });
    expect(report).toMatchObject({ merged: 0, retained: 2, groups: 0 });
  });

  it("merges one claim stated under two triggers, and records that the triggers were disjoint", () => {
    // The condition gate used to refuse this pair. Measured over the 37-item store R60 produced,
    // the shared condition count has median 1 both among pairs whose statements match and among
    // pairs whose statements are unrelated (75% and 82% share at least one term), so it does not
    // separate; applied after the statement gate it kept 1 of the 4 pairs above 0.60 containment,
    // all four of which state the same lesson. The merge is now decided by the statement and the
    // condition is reported, because a group resting on disjoint triggers is weaker corroboration
    // and a readback should be able to see that rather than have it decided for it.
    const items = [
      item(
        candidate(ONE, {
          id: "a",
          taskId: "task-1",
          when: "the customer asks to change a booking",
        }),
        "k1",
      ),
      item(
        candidate(ONE, {
          id: "b",
          taskId: "task-2",
          when: "the customer asks for a refund on a flight",
        }),
        "k2",
      ),
    ];
    const { items: after, report } = consolidateKnowledge(items, {
      now: AT,
      policy: defaultPolicy,
    });
    expect(report).toMatchObject({
      merged: 1,
      retained: 1,
      refusedCondition: 0,
    });
    expect(report.groupDetail).toHaveLength(1);
    // Two shared terms — "customer" and "asks" — and nothing else: the two triggers name the same
    // subject and disagree about everything that makes them triggers, which is exactly the pair the
    // old floor of 3 refused.
    expect(report.groupDetail[0]).toMatchObject({
      conditionShared: 2,
      supportTasks: 2,
      crossTask: true,
    });
    // Nothing is lost by the merge: the trigger that was not adopted is still readable on the
    // retired row, which is the answer to "the first one wins by arrival order".
    const retired = after.find((entry) => entry.status === "retired");
    expect(retired?.when).toBe("the customer asks for a refund on a flight");
  });

  it("adopts a condition when only one member states one", () => {
    const items = [
      item(candidate(ONE, { id: "a", taskId: "task-1" }), "k1"),
      item(
        candidate(ONE_AGAIN, {
          id: "b",
          taskId: "task-2",
          when: "the customer asks to change a booking",
        }),
        "k2",
      ),
    ];
    const { items: after } = consolidateKnowledge(items, {
      now: AT,
      policy: defaultPolicy,
    });
    const live = after.filter((entry) => entry.status !== "retired");
    expect(live).toHaveLength(1);
    expect(live[0]?.when).toBe("the customer asks to change a booking");
  });

  it("refuses to merge two claims with different payloads, because one item would carry both", () => {
    const items = [
      item(
        candidate(ONE, {
          id: "a",
          taskId: "task-1",
          payload: { mark: "line" },
        }),
        "k1",
      ),
      item(
        candidate(ONE_AGAIN, {
          id: "b",
          taskId: "task-2",
          payload: { mark: "bar" },
        }),
        "k2",
      ),
    ];
    const { report } = consolidateKnowledge(items, {
      now: AT,
      policy: defaultPolicy,
    });
    expect(report).toMatchObject({ merged: 0, retained: 2, refusedPayload: 1 });
  });

  it("never merges across two scopes, because a scope is half of a claim’s identity", () => {
    const items = [
      item(candidate(ONE, { id: "a", taskId: "task-1", task: "retail" }), "k1"),
      item(
        candidate(ONE_AGAIN, { id: "b", taskId: "task-2", task: "airline" }),
        "k2",
      ),
    ];
    const { report } = consolidateKnowledge(items, {
      now: AT,
      policy: defaultPolicy,
    });
    expect(report).toMatchObject({ merged: 0, retained: 2 });
  });

  it("never merges across two kinds, because a procedure and a constraint are not one claim", () => {
    const items = [
      item(
        candidate(ONE, { id: "a", taskId: "task-1", kind: "procedure" }),
        "k1",
      ),
      item(
        candidate(ONE_AGAIN, { id: "b", taskId: "task-2", kind: "constraint" }),
        "k2",
      ),
    ];
    const { report } = consolidateKnowledge(items, {
      now: AT,
      policy: defaultPolicy,
    });
    expect(report).toMatchObject({ merged: 0, retained: 2 });
  });

  it("reports the support distribution before and after, which is what a recurrence gate reads", () => {
    const items = [
      item(candidate(ONE, { id: "a", taskId: "task-1" }), "k1"),
      item(candidate(ONE_AGAIN, { id: "b", taskId: "task-2" }), "k2"),
      item(
        candidate(
          "Quote the order total before applying a discount code to an order",
          { id: "c", taskId: "task-3" },
        ),
        "k3",
      ),
    ];
    const { report } = consolidateKnowledge(items, {
      now: AT,
      policy: defaultPolicy,
    });
    expect(report.supportBefore).toEqual({ 1: 3 });
    expect(report.supportAfter).toEqual({ 1: 1, 2: 1 });
    expect(report.maxSupportBefore).toBe(1);
    expect(report.maxSupportAfter).toBe(2);
  });

  it("is idempotent: a second pass over its own output moves nothing", () => {
    const items = [
      item(candidate(ONE, { id: "a", taskId: "task-1" }), "k1"),
      item(candidate(ONE_AGAIN, { id: "b", taskId: "task-2" }), "k2"),
    ];
    const first = consolidateKnowledge(items, {
      now: AT,
      policy: defaultPolicy,
    });
    const second = consolidateKnowledge(first.items, {
      now: AT + 1,
      policy: defaultPolicy,
    });
    expect(second.report).toMatchObject({ groups: 0, merged: 0, retained: 1 });
    // Not merely "no new merge": the item must not move at all. A pass that rewrote `updatedAt`
    // on every run would make the delivery log see a rule rewritten at every distillation.
    const live = second.items.filter((entry) => entry.status !== "retired");
    const before = first.items.filter((entry) => entry.status !== "retired");
    expect(live[0]?.updatedAt).toBe(before[0]?.updatedAt);
  });

  it("leaves a retired item retired, and never re-merges it", () => {
    const retired: KnowledgeItem = {
      ...item(candidate(ONE, { id: "a", taskId: "task-1" }), "k1"),
      status: "retired",
      statusReason: "superseded",
      systemUntil: AT,
    };
    const live = item(
      candidate(ONE_AGAIN, { id: "b", taskId: "task-2" }),
      "k2",
    );
    const { items: after, report } = consolidateKnowledge([retired, live], {
      now: AT,
      policy: defaultPolicy,
    });
    expect(report).toMatchObject({ considered: 1, merged: 0, retained: 1 });
    expect(after.find((entry) => entry.id === "k1")?.statusReason).toBe(
      "superseded",
    );
  });

  it("refuses a merge whose two members hold the same evidence, because it buys no support", () => {
    // Two items distilled from one event: the same `(feedbackId, runId)` on both sides. Merging
    // them would produce one item with one task and a doubled support sum, which reads as
    // corroboration and is a duplicate.
    const items = [
      item(candidate(ONE, { id: "same", taskId: "task-1" }), "k1"),
      item(candidate(ONE_AGAIN, { id: "same", taskId: "task-1" }), "k2"),
    ];
    const { report } = consolidateKnowledge(items, {
      now: AT,
      policy: defaultPolicy,
    });
    expect(report).toMatchObject({
      merged: 0,
      retained: 2,
      refusedDuplicateEvidence: 1,
    });
  });

  it("re-scores the survivor, because two tasks of support are not one task of confidence", () => {
    const items = [
      item(candidate(ONE, { id: "a", taskId: "task-1" }), "k1"),
      item(candidate(ONE_AGAIN, { id: "b", taskId: "task-2" }), "k2"),
    ];
    const { items: after } = consolidateKnowledge(items, {
      now: AT,
      policy: defaultPolicy,
    });
    const live = after.filter((entry) => entry.status !== "retired");
    expect(live[0]?.confidence).toBeGreaterThan(items[0]?.confidence ?? 0);
    expect(live[0]?.status).toBe("active");
  });

  it("does not resurrect a quarantined member by merging a trusted one into it", () => {
    const quarantined: KnowledgeItem = {
      ...item(candidate(ONE, { id: "a", taskId: "task-1", weight: 0.1 }), "k1"),
      trust: 0.1,
      status: "quarantined",
      statusReason: "low-trust",
    };
    const trusted = item(
      candidate(ONE_AGAIN, { id: "b", taskId: "task-2" }),
      "k2",
    );
    const { items: after } = consolidateKnowledge([quarantined, trusted], {
      now: AT,
      policy: defaultPolicy,
    });
    const live = after.filter((entry) => entry.status !== "retired");
    expect(live).toHaveLength(1);
    // The survivor is the trusted one, so the quarantine stays on the retired member and does not
    // become a status the trusted item inherited.
    expect(live[0]?.id).toBe("k2");
    expect(live[0]?.status).toBe("active");
  });

  it("accepts a store with nothing in it, and a store with one item", () => {
    const empty = consolidateKnowledge([], { now: AT, policy: defaultPolicy });
    expect(empty.report).toMatchObject({
      considered: 0,
      groups: 0,
      merged: 0,
      retained: 0,
    });
    expect(empty.report.supportBefore).toEqual({});
    const single = consolidateKnowledge(
      [item(candidate(ONE, { id: "a" }), "k1")],
      {
        now: AT,
        policy: defaultPolicy,
      },
    );
    expect(single.report).toMatchObject({
      considered: 1,
      merged: 0,
      retained: 1,
    });
  });

  it("merges exactly at the threshold and not below it", () => {
    // Six content terms on the shorter side and four of them shared: containment 4/6 = 0.667, so a
    // 0.6 floor merges and a 0.7 floor does not. The same pair scores 4/11 = 0.36 as Jaccard,
    // which no floor this lane ever used would have merged — the reading that made R58's pass
    // inert.
    const at = [
      item(
        candidate("confirm identity before changing pending reservation", {
          id: "a",
          taskId: "t1",
        }),
        "k1",
      ),
      item(
        candidate(
          "confirm identity before changing the payment method used for each order",
          {
            id: "b",
            taskId: "t2",
          },
        ),
        "k2",
      ),
    ];
    const atThreshold = consolidateKnowledge(at, {
      now: AT,
      policy: defaultPolicy,
      threshold: 0.6,
    });
    expect(atThreshold.report.merged).toBe(1);
    const underStricter = consolidateKnowledge(at, {
      now: AT,
      policy: defaultPolicy,
      threshold: 0.7,
    });
    expect(underStricter.report.merged).toBe(0);

    const below = [
      item(
        candidate("confirm identity before changing pending reservation", {
          id: "c",
          taskId: "t3",
        }),
        "k3",
      ),
      item(
        candidate("quote total before applying discount code to order", {
          id: "d",
          taskId: "t4",
        }),
        "k4",
      ),
    ];
    const tooDifferent = consolidateKnowledge(below, {
      now: AT,
      policy: defaultPolicy,
      threshold: 0.6,
    });
    expect(tooDifferent.report.merged).toBe(0);
  });

  it("reads the smaller claim, so a trailing caveat does not cost a repeat its merge", () => {
    // The shape R58's store actually holds: one claim, then the same claim with a different closing
    // clause. Shared terms 14, smaller claim 20, so containment is 0.700 — and the union's extra
    // terms are exactly what Jaccard charged twice, putting the pair at 0.483.
    const shared =
      "When a request bundles several changes carry out every requested change in the order the requester " +
      "stated them and do not stop after the first one succeeds";
    const restated =
      "When a request bundles several changes carry out every requested change in the order the requester " +
      "stated them and stop once all are applied rather than adding extra lookups or calculations";
    const items = [
      item(candidate(shared, { id: "a", taskId: "t1" }), "k1"),
      item(candidate(restated, { id: "b", taskId: "t2" }), "k2"),
    ];
    const { report } = consolidateKnowledge(items, {
      now: AT,
      policy: defaultPolicy,
    });
    expect(report).toMatchObject({ groups: 1, merged: 1, maxSupportAfter: 2 });
  });

  it("scores a pair the same whichever side of the store it sits on", () => {
    // Containment chooses its denominator by size and not by argument order, so a measure that
    // picked the left-hand set would merge in one order and not the other — a pass whose result
    // depends on arrival order is the defect consolidation exists to remove.
    const short =
      "Confirm the customer identity before changing a pending reservation";
    const long = `${short}, and quote the new total back to the customer before the change is applied`;
    const one = consolidateKnowledge(
      [
        item(candidate(short, { id: "a", taskId: "t1" }), "k1"),
        item(candidate(long, { id: "b", taskId: "t2" }), "k2"),
      ],
      { now: AT, policy: defaultPolicy },
    );
    const other = consolidateKnowledge(
      [
        item(candidate(long, { id: "b", taskId: "t2" }), "k2"),
        item(candidate(short, { id: "a", taskId: "t1" }), "k1"),
      ],
      { now: AT, policy: defaultPolicy },
    );
    expect(one.report.merged).toBe(1);
    expect(other.report.merged).toBe(1);
  });

  it("separates a paraphrased trigger from a subject-only one by the count, and still merges both", () => {
    // Two facts, kept apart because they used to be one. The *measurement*: both pairs read 0.400
    // condition containment, and only the first is a restatement of the same trigger — so the
    // count separates where the ratio does not, on constructed pairs. The *policy*: on the store
    // the pass actually runs over, the count does not separate (median 1 in both bands), and
    // applying it kept 1 of the 4 pairs above the statement floor. It is therefore reported and
    // not applied, and both pairs merge.
    const paraphrased = [
      item(
        candidate(ONE, {
          id: "a",
          taskId: "t1",
          when: "the user asks for multiple distinct changes in one request and names the order",
        }),
        "k1",
      ),
      item(
        candidate(ONE_AGAIN, {
          id: "b",
          taskId: "t2",
          when: "the user asks for multiple distinct modifications and specifies the sequence",
        }),
        "k2",
      ),
    ];
    const agreed = consolidateKnowledge(paraphrased, {
      now: AT,
      policy: defaultPolicy,
    });
    expect(agreed.report).toMatchObject({ merged: 1, refusedCondition: 0 });
    expect(
      agreed.report.groupDetail[0]?.conditionShared,
    ).toBeGreaterThanOrEqual(3);

    const conflicting = [
      item(
        candidate(ONE, {
          id: "c",
          taskId: "t3",
          when: "the customer asks to change a booking",
        }),
        "k3",
      ),
      item(
        candidate(ONE_AGAIN, {
          id: "d",
          taskId: "t4",
          when: "the customer asks for a refund on a flight",
        }),
        "k4",
      ),
    ];
    const merged = consolidateKnowledge(conflicting, {
      now: AT,
      policy: defaultPolicy,
    });
    expect(merged.report).toMatchObject({ merged: 1, refusedCondition: 0 });
    // The reading that tells the two groups apart is the one that survives: four shared condition
    // terms against two, in the same field, without a decision hanging on it.
    expect(merged.report.groupDetail[0]?.conditionShared).toBe(2);
    // And the old policy is still dispatchable, because an ablation that cannot reproduce the
    // setting it replaced is not an ablation.
    const strict = consolidateKnowledge(conflicting, {
      now: AT,
      policy: defaultPolicy,
      conditionMinShared: 3,
    });
    expect(strict.report).toMatchObject({ merged: 0, refusedCondition: 1 });
  });

  it("refuses a chain, so a group of three is three tasks agreeing and not two hops", () => {
    // The shape single linkage mis-reported: A resembles B, B resembles C, and A and C share one
    // term of five. Under single linkage the third item joined through the second and the census
    // read one group of three — a corroboration no pair of extreme members supports. Complete
    // linkage asks every member of one group against every member of the other, so the chain stays
    // two groups and the refusal is counted.
    const items = [
      item(
        candidate("confirmation identity pending reservation booking", {
          id: "a",
          taskId: "t1",
        }),
        "k1",
      ),
      item(
        candidate("confirmation identity pending refund flight", {
          id: "b",
          taskId: "t2",
        }),
        "k2",
      ),
      item(
        candidate("refund flight pending waiver fee", {
          id: "c",
          taskId: "t3",
        }),
        "k3",
      ),
    ];
    // The arithmetic the test rests on, stated so a change to the measure shows up here: 0.60 for
    // the two hops, 0.20 for the pair that would have to agree for the group of three to be real.
    const tokens = items.map((entry) => claimTokens(entry.statement));
    expect(
      claimContainment(
        tokens[0] as ReadonlySet<string>,
        tokens[1] as ReadonlySet<string>,
      ),
    ).toBeCloseTo(0.6, 10);
    expect(
      claimContainment(
        tokens[1] as ReadonlySet<string>,
        tokens[2] as ReadonlySet<string>,
      ),
    ).toBeCloseTo(0.6, 10);
    expect(
      claimContainment(
        tokens[0] as ReadonlySet<string>,
        tokens[2] as ReadonlySet<string>,
      ),
    ).toBeCloseTo(0.2, 10);

    const { report } = consolidateKnowledge(items, {
      now: AT,
      policy: defaultPolicy,
    });
    expect(report).toMatchObject({
      groups: 1,
      merged: 1,
      retained: 2,
      refusedLinkage: 1,
    });
    expect(report.largestGroup).toBe(2);
    // The invariant complete linkage exists to make checkable rather than hoped for.
    expect(report.weakestPair).toBeGreaterThanOrEqual(report.threshold);

    // And the chain is not refused for ever: at a floor the extreme pair clears, all three group,
    // with the weakest pair still reported rather than averaged away.
    const loose = consolidateKnowledge(items, {
      now: AT,
      policy: defaultPolicy,
      threshold: 0.19,
    });
    expect(loose.report).toMatchObject({
      groups: 1,
      merged: 2,
      retained: 1,
      refusedLinkage: 0,
      largestGroup: 3,
    });
    expect(loose.report.weakestPair).toBeCloseTo(0.2, 10);
  });

  it("counts a merge of two rows from one task as a group that bought no support", () => {
    // `sameEvidence` refuses a pair holding the same rows, but two rows from one task are two rows:
    // the merge is legitimate and the support it adds is zero. Recorded, because a corroboration
    // count that treated this as corroboration would report a recurrence no second task witnessed.
    const items = [
      item(candidate(ONE, { id: "a", taskId: "t1" }), "k1"),
      item(candidate(ONE_AGAIN, { id: "b", taskId: "t1" }), "k2"),
    ];
    const { report } = consolidateKnowledge(items, {
      now: AT,
      policy: defaultPolicy,
    });
    expect(report).toMatchObject({
      groups: 1,
      merged: 1,
      crossTaskGroups: 0,
      maxSupportBefore: 1,
    });
    expect(report.groupDetail[0]).toMatchObject({
      supportTasks: 1,
      crossTask: false,
    });
    expect(report.maxSupportAfter).toBe(1);
  });

  it("counts a row with no task id by its run, so a store without tasks still reports support", () => {
    // The lane in this repository always carries task ids, and a store that does not is not
    // therefore a store with one task. Counting only task ids would report every merge as support
    // 1 and read as "nothing corroborates" — which is the conclusion, not an artefact of a
    // missing field.
    const items = [
      item(candidate(ONE, { id: "a" }), "k1"),
      item(candidate(ONE_AGAIN, { id: "b" }), "k2"),
    ];
    const { report } = consolidateKnowledge(items, {
      now: AT,
      policy: defaultPolicy,
    });
    expect(report.groupDetail[0]).toMatchObject({
      supportTasks: 2,
      crossTask: true,
    });
    expect(report.maxSupportAfter).toBe(2);
  });

  it("names the survivor first in the group it reports", () => {
    // The order is a reading: a group listed in store order would leave a readback to re-derive
    // which id the survivor is from `statusReason`, and the survivor is the item the store serves.
    const items = [
      item(candidate(ONE, { id: "a", taskId: "t1" }), "k1"),
      item(candidate(ONE_AGAIN, { id: "b", taskId: "t2" }), "k2"),
    ];
    const { items: after, report } = consolidateKnowledge(items, {
      now: AT,
      policy: defaultPolicy,
    });
    const live = after.find((entry) => entry.status !== "retired");
    expect(report.groupDetail[0]?.ids[0]).toBe(live?.id);
    expect(report.groupDetail[0]?.ids).toHaveLength(2);
  });

  it("folds three paraphrases from three tasks into one item with three tasks of support", () => {
    // The chain that exercises the grouping: each pair overlaps, and the third arrives after the
    // first two are one component. A union-find without path compression still answers, which is
    // why the reading below is the *evidence* and not the internal structure.
    const items = [
      item(
        candidate(
          "Confirm the customer identity before changing a pending reservation",
          { id: "a", taskId: "t1" },
        ),
        "k1",
      ),
      item(
        candidate(
          "Confirm the customer identity before you change a pending reservation",
          { id: "b", taskId: "t2" },
        ),
        "k2",
      ),
      item(
        candidate(
          "Confirm the customer identity before changing any pending reservation",
          { id: "c", taskId: "t3" },
        ),
        "k3",
      ),
    ];
    const { items: after, report } = consolidateKnowledge(items, {
      now: AT,
      policy: defaultPolicy,
    });
    const live = after.filter((entry) => entry.status !== "retired");
    expect(live).toHaveLength(1);
    expect(live[0]?.evidence).toHaveLength(3);
    expect(report).toMatchObject({
      groups: 1,
      merged: 2,
      retained: 1,
      maxSupportAfter: 3,
    });
    expect(report.supportAfter).toEqual({ 3: 1 });
  });

  it("adopts a payload from a member when the survivor carries none", () => {
    const items = [
      item(candidate(ONE, { id: "a", taskId: "t1" }), "k1"),
      item(
        candidate(ONE_AGAIN, {
          id: "b",
          taskId: "t2",
          payload: { mark: "line" },
        }),
        "k2",
      ),
    ];
    const { items: after } = consolidateKnowledge(items, {
      now: AT,
      policy: defaultPolicy,
    });
    const live = after.filter((entry) => entry.status !== "retired");
    expect(live).toHaveLength(1);
    expect(live[0]?.payload).toEqual({ mark: "line" });
  });

  it("carries the strongest tier of the group, because a merge cannot demote evidence", () => {
    const weak = {
      ...item(candidate(ONE, { id: "a", taskId: "t1" }), "k1"),
      tier: "user-text" as const,
    };
    const strong = {
      ...item(candidate(ONE_AGAIN, { id: "b", taskId: "t2" }), "k2"),
      tier: "outcome" as const,
    };
    const { items: after } = consolidateKnowledge([weak, strong], {
      now: AT,
      policy: defaultPolicy,
    });
    const live = after.filter((entry) => entry.status !== "retired");
    expect(live[0]?.tier).toBe("outcome");
  });

  it("sums the contradictions the group already carried", () => {
    const first = {
      ...item(candidate(ONE, { id: "a", taskId: "t1" }), "k1"),
      contradictions: 1,
    };
    const second = {
      ...item(candidate(ONE_AGAIN, { id: "b", taskId: "t2" }), "k2"),
      contradictions: 1,
    };
    const { items: after } = consolidateKnowledge([first, second], {
      now: AT,
      policy: defaultPolicy,
    });
    const live = after.filter((entry) => entry.status !== "retired");
    expect(live[0]?.contradictions).toBe(2);
  });

  it("keeps a live member over a quarantined one whatever the order they were stored in", () => {
    const quarantined: KnowledgeItem = {
      ...item(candidate(ONE, { id: "a", taskId: "task-1", weight: 0.1 }), "k9"),
      trust: 0.1,
      status: "quarantined",
      statusReason: "low-trust",
    };
    const trusted = item(
      candidate(ONE_AGAIN, { id: "b", taskId: "task-2" }),
      "k1",
    );
    const { items: after } = consolidateKnowledge([trusted, quarantined], {
      now: AT,
      policy: defaultPolicy,
    });
    const live = after.filter((entry) => entry.status !== "retired");
    expect(live.map((entry) => entry.id)).toEqual(["k1"]);
  });

  it("keeps the better-attested member whichever side of the store it sits on", () => {
    // The ranking has to be a property of the items and not of their order: the pairs are examined
    // `(i, j)` with `i < j`, so every rule has a direction that only a reversed fixture exercises.
    const twoTasks: KnowledgeItem = {
      ...item(candidate(ONE, { id: "a", taskId: "task-1" }), "k1"),
      evidence: [
        {
          feedbackId: "fb_a",
          runId: "run_a",
          at: AT,
          weight: 0.9,
          taskId: "task-1",
        },
        {
          feedbackId: "fb_b",
          runId: "run_b",
          at: AT,
          weight: 0.9,
          taskId: "task-2",
        },
      ],
      support: 1.8,
    };
    const oneTask = item(
      candidate(ONE_AGAIN, { id: "c", taskId: "task-3" }),
      "k9",
    );
    const { items: after } = consolidateKnowledge([twoTasks, oneTask], {
      now: AT,
      policy: defaultPolicy,
    });
    expect(
      after
        .filter((entry) => entry.status !== "retired")
        .map((entry) => entry.id),
    ).toEqual(["k1"]);
  });

  it("keeps the member with more evidence when both stand on the same number of tasks", () => {
    // One task, two corrections of it: a task contributes once to support, so the task count ties
    // and the evidence count is the next thing that separates two candidates for the survivor.
    const thin = item(candidate(ONE, { id: "a", taskId: "task-1" }), "k7");
    const thick: KnowledgeItem = {
      ...item(candidate(ONE_AGAIN, { id: "b", taskId: "task-1" }), "k1"),
      evidence: [
        ...item(candidate(ONE_AGAIN, { id: "b", taskId: "task-1" }), "k1")
          .evidence,
        {
          feedbackId: "fb_extra",
          runId: "run_extra",
          at: AT,
          weight: 0.9,
          taskId: "task-1",
        },
      ],
    };
    // Both orders, because a ranking that depends on which item was written first is the defect
    // this function exists to avoid and the fixture is the only place it is visible.
    for (const order of [
      [thick, thin],
      [thin, thick],
    ] as const) {
      const { items: after } = consolidateKnowledge(order, {
        now: AT,
        policy: defaultPolicy,
      });
      const live = after.filter((entry) => entry.status !== "retired");
      expect(live.map((entry) => entry.id)).toEqual(["k1"]);
    }
  });

  it("folds a shared evidence row once, so a merge never counts one task twice", () => {
    const left = item(candidate(ONE, { id: "a", taskId: "task-1" }), "k1");
    const withOverlap: KnowledgeItem = {
      ...item(candidate(ONE_AGAIN, { id: "b", taskId: "task-2" }), "k2"),
      evidence: [
        ...left.evidence,
        {
          feedbackId: "fb_b",
          runId: "run_b",
          at: AT,
          weight: 0.9,
          taskId: "task-2",
        },
      ],
    };
    const { items: after } = consolidateKnowledge([left, withOverlap], {
      now: AT,
      policy: defaultPolicy,
    });
    const live = after.filter((entry) => entry.status !== "retired");
    expect(live[0]?.evidence).toHaveLength(2);
    expect(live[0]?.support).toBeCloseTo(1.8, 10);
  });

  it("does not merge a claim whose text carries no content terms at all", () => {
    // Two statements of nothing but stopwords reduce to the empty token set, and an empty set is
    // not evidence that two claims are the same claim: merging them would fold an unreadable item
    // into a readable one and call the result a corroboration.
    const items = [
      item(candidate("the a of the", { id: "a", taskId: "t1" }), "k1"),
      item(candidate("and or to in", { id: "b", taskId: "t2" }), "k2"),
    ];
    const { report } = consolidateKnowledge(items, {
      now: AT,
      policy: defaultPolicy,
    });
    expect(report).toMatchObject({ merged: 0, retained: 2 });
  });

  it("carries the floors it used, so a reader can tell a strict pass from a loose one", () => {
    const { report } = consolidateKnowledge([], {
      now: AT,
      policy: defaultPolicy,
      threshold: 0.55,
    });
    expect(report.threshold).toBeCloseTo(0.55, 10);
    // The defaults are the ones the registration names; a reading without them is a number with no
    // setting attached.
    const { report: byDefault } = consolidateKnowledge([], {
      now: AT,
      policy: defaultPolicy,
    });
    expect(byDefault.threshold).toBeCloseTo(0.6, 10);
    // Zero is "no veto", and it is the default because the veto was measured not to separate:
    // see the option's documentation for the 666-pair reading that retired it.
    expect(byDefault.conditionMinShared).toBe(0);
  });

  it("honours an overridden condition floor, because a stricter pass must be dispatchable", () => {
    const items = [
      item(
        candidate(ONE, {
          id: "a",
          taskId: "t1",
          when: "the user asks for multiple distinct changes in one request and names the order",
        }),
        "k1",
      ),
      item(
        candidate(ONE_AGAIN, {
          id: "b",
          taskId: "t2",
          when: "the user asks for multiple distinct modifications and specifies the sequence",
        }),
        "k2",
      ),
    ];
    // Four shared terms: below a floor of five, and the pair is refused rather than merged.
    const strict = consolidateKnowledge(items, {
      now: AT,
      policy: defaultPolicy,
      conditionMinShared: 5,
    });
    expect(strict.report).toMatchObject({
      merged: 0,
      refusedCondition: 1,
      conditionMinShared: 5,
    });
  });
});

describe("the measure itself", () => {
  it("reports shared terms and containment as two readings of one comparison", () => {
    // Stated directly because both sides of the pass are written in these terms and a reader of the
    // census needs the arithmetic in one place.
    const short = claimTokens(
      "confirm identity before changing a pending reservation",
    );
    const long = claimTokens(
      "confirm identity before changing a pending reservation and quote the new total",
    );
    expect(short.size).toBe(6);
    expect(long.size).toBe(9);
    expect(sharedTerms(short, long)).toBe(6);
    // Everything the shorter claim says is in the longer one, so it is contained; the union would
    // have scored 6/9, which is the penalty R58 measured.
    expect(claimContainment(short, long)).toBeCloseTo(1, 10);
    expect(claimContainment(long, short)).toBeCloseTo(1, 10);
  });

  it("treats two empty claims as no evidence rather than as a match", () => {
    const empty = claimTokens("the a of the");
    expect(empty.size).toBe(0);
    expect(claimContainment(empty, empty)).toBe(0);
    expect(sharedTerms(empty, empty)).toBe(0);
  });
});
