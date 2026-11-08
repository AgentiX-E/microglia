/**
 * The store sweep: the floor over an artefact's own sample, agreeing with the in-driver sweep.
 *
 * The tests that matter here are the agreement ones. A diagnostic that grouped a store differently
 * from the pass that wrote it would let a readback "discover" a defect that is an artefact of the
 * diagnostic, which is worse than no diagnostic.
 */
import { describe, expect, it } from "vitest";
import {
  createKnowledgeItem,
  defaultPolicy,
  type DistillCandidate,
  type KnowledgeItem,
} from "@agentix-e/microglia-core";
import { consolidateKnowledge } from "@agentix-e/microglia-core/distill";
import { sweepStoreItems, type SweepableItem } from "../store-sweep.js";
import { sweepConsolidation } from "../consolidation-sweep.js";

const AT = 1_700_000_000_000;

function item(
  statement: string,
  id: string,
  taskId?: string,
  when?: string,
  kind: "procedure" | "constraint" = "procedure",
): KnowledgeItem {
  const spec: DistillCandidate = {
    namespace: "tau2",
    kind,
    scope: { task: "retail" },
    statement,
    ...(when === undefined ? {} : { when }),
    evidence: {
      feedbackId: `fb_${id}`,
      runId: `run_${id}`,
      at: AT,
      weight: 0.9,
      ...(taskId === undefined ? {} : { taskId }),
    },
    trust: 0.9,
    dedupeKey: `key_${id}`,
  };
  return createKnowledgeItem(spec, defaultPolicy, AT, id);
}

/** What the artefact ships: the same item without its evidence rows. */
const sampled = (entry: KnowledgeItem): SweepableItem => ({
  id: entry.id,
  kind: entry.kind,
  status: entry.status,
  statement: entry.statement,
  ...(entry.when === undefined ? {} : { when: entry.when }),
  scope: entry.scope as Readonly<Record<string, string>>,
  supportTasks: new Set(
    entry.evidence.map((row) => row.taskId ?? `run:${row.runId}`),
  ).size,
});

const CHAIN: readonly KnowledgeItem[] = [
  item("confirmation identity pending reservation booking", "k1", "t1"),
  item("confirmation identity pending refund flight", "k2", "t2"),
  item("refund flight pending waiver fee", "k3", "t3"),
];

describe("sweepStoreItems", () => {
  it("agrees with the pass on which items group, at every floor", () => {
    // The agreement is the whole point: two implementations of one definition, one over full items
    // and one over the projection, must not disagree about how many groups a store forms.
    const pass = sweepConsolidation(
      CHAIN,
      { now: AT, policy: defaultPolicy, conditionMinShared: 0, threshold: 0.6 },
      [0.2, 0.6],
      [0],
    );
    const store = sweepStoreItems(CHAIN.map(sampled), [0.2, 0.6]);
    for (const threshold of [0.2, 0.6]) {
      const fromPass = pass.points.find(
        (point) => point.threshold === threshold,
      );
      const fromStore = store.find((point) => point.threshold === threshold);
      expect(fromStore?.groups.length, `threshold ${String(threshold)}`).toBe(
        fromPass?.groups,
      );
      expect(fromStore?.largestGroup).toBe(fromPass?.largestGroup);
      expect(fromStore?.groups[0]?.weakestPair).toBeCloseTo(
        fromPass?.weakestPair ?? -1,
        10,
      );
    }
  });

  it("reports support as an interval, because a sample cannot know which tasks a group covers", () => {
    const store = sweepStoreItems(CHAIN.map(sampled), [0.2]);
    const group = store[0]?.groups[0];
    // Three members at one task each: four if all three tasks are distinct, one if they are the same.
    expect(group).toMatchObject({ supportCeil: 3, supportFloor: 1 });
    expect(group?.ids).toHaveLength(3);
  });

  it("refuses a chain and counts it, so a group of three is three members agreeing", () => {
    const store = sweepStoreItems(CHAIN.map(sampled), [0.6]);
    expect(store[0]).toMatchObject({ largestGroup: 2, refusedLinkage: 1 });
    expect(store[0]?.groups).toHaveLength(1);
  });

  it("leaves retired items out, because the pass that wrote the store already absorbed them", () => {
    const absorbed: SweepableItem[] = [
      { ...sampled(CHAIN[0] as KnowledgeItem), supportTasks: 2 },
      {
        ...sampled(CHAIN[1] as KnowledgeItem),
        status: "retired",
        supportTasks: 1,
      },
    ];
    const store = sweepStoreItems(absorbed, [0.6]);
    // One live item is no group: grouping a survivor with the item it absorbed would report a
    // corroboration the store does not hold.
    expect(store[0]?.groups).toHaveLength(0);
  });

  it("keeps two kinds apart even when their text is identical", () => {
    const mixed = [
      item(
        "Confirm the customer identity before changing a pending reservation",
        "k1",
        "t1",
        undefined,
        "procedure",
      ),
      item(
        "Confirm the customer identity before changing a pending reservation",
        "k2",
        "t2",
        undefined,
        "constraint",
      ),
    ];
    expect(sweepStoreItems(mixed.map(sampled), [0.6])[0]?.groups).toHaveLength(
      0,
    );
  });

  it("keeps two scopes apart even when their text is identical", () => {
    const scoped = [
      {
        ...sampled(
          item(
            "Confirm the customer identity before changing a pending reservation",
            "k1",
            "t1",
          ),
        ),
        scope: { task: "retail" },
      },
      {
        ...sampled(
          item(
            "Confirm the customer identity before changing a pending reservation",
            "k2",
            "t2",
          ),
        ),
        scope: { task: "airline" },
      },
    ];
    expect(sweepStoreItems(scoped, [0.6])[0]?.groups).toHaveLength(0);
  });

  it("honours a condition floor when one is asked for, so the veto stays measurable", () => {
    const pairs = [
      item(
        "Confirm the customer identity before changing a pending reservation",
        "k1",
        "t1",
        "the customer asks to change a booking",
      ),
      item(
        "Confirm the customer identity before you change a pending reservation",
        "k2",
        "t2",
        "the customer asks for a refund on a flight",
      ),
    ];
    expect(
      sweepStoreItems(pairs.map(sampled), [0.6], 0)[0]?.groups,
    ).toHaveLength(1);
    expect(
      sweepStoreItems(pairs.map(sampled), [0.6], 3)[0]?.groups,
    ).toHaveLength(0);
  });

  it("orders groups by size, so the largest is the one a reader sees first", () => {
    const store = sweepStoreItems(CHAIN.map(sampled), [0.4]);
    const sizes = store[0]?.groups.map((group) => group.ids.length) ?? [];
    expect(sizes).toEqual([...sizes].sort((left, right) => right - left));
  });
});
