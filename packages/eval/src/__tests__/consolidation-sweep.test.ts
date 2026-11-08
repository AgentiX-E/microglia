/**
 * The sweep: what each consolidation floor would have produced, measured rather than argued.
 *
 * The claim these tests defend is not "a grid is produced". It is that the sweep and the pass agree
 * — the operating point is the pass the store was written from, not a recomputation of it — and
 * that the two readings which exposed the defects are visible in it: the pair the condition veto
 * refused, and the chain single linkage used to fold.
 */
import { describe, expect, it } from "vitest";
import {
  createKnowledgeItem,
  defaultPolicy,
  type DistillCandidate,
  type KnowledgeItem,
} from "@agentix-e/microglia-core";
import {
  SWEEP_CONDITIONS,
  SWEEP_THRESHOLDS,
  sweepConsolidation,
  sweepSummary,
} from "../consolidation-sweep.js";

const AT = 1_700_000_000_000;

function item(
  statement: string,
  id: string,
  taskId?: string,
  when?: string,
): KnowledgeItem {
  const spec: DistillCandidate = {
    namespace: "tau2",
    kind: "procedure",
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

/** Two paraphrases of one claim, from two tasks: the population a threshold is read on. */
const PAIR: readonly KnowledgeItem[] = [
  item(
    "Confirm the customer identity before changing a pending reservation",
    "k1",
    "t1",
  ),
  item(
    "Confirm the customer identity before you change a pending reservation",
    "k2",
    "t2",
  ),
];

/** The chain: A~B and B~C at 0.60, A~C at 0.20. */
const CHAIN: readonly KnowledgeItem[] = [
  item("confirmation identity pending reservation booking", "k1", "t1"),
  item("confirmation identity pending refund flight", "k2", "t2"),
  item("refund flight pending waiver fee", "k3", "t3"),
];

const AT_ZERO = {
  now: AT,
  policy: defaultPolicy,
  conditionMinShared: 0,
} as const;

describe("sweepConsolidation", () => {
  it("reports the operating point the pass itself produced, not a recomputation of it", () => {
    const sweep = sweepConsolidation(
      PAIR,
      { ...AT_ZERO, threshold: 0.6 },
      [0.6],
      [0],
    );
    expect(sweep.operating).toMatchObject({
      threshold: 0.6,
      conditionMinShared: 0,
      groups: 1,
      merged: 1,
    });
    // The operating point appears exactly once, even though it is inside the grid.
    expect(
      sweep.points.filter(
        (point) => point.threshold === 0.6 && point.conditionMinShared === 0,
      ),
    ).toHaveLength(1);
    expect(sweep.groups).toHaveLength(1);
    expect(sweep.groups[0]?.supportTasks).toBe(2);
  });

  it("carries the pairs the condition veto would have refused, and the order is monotone in it", () => {
    // One claim, one task each, two triggers that share only their subject. At no veto the pair
    // merges; at a floor of three it does not. This is the ablation the artefact has to carry.
    const items = [
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
    const sweep = sweepConsolidation(items, { ...AT_ZERO, threshold: 0.6 });
    const at = (conditionMinShared: number): number =>
      sweep.points.find(
        (point) =>
          point.threshold === 0.6 &&
          point.conditionMinShared === conditionMinShared,
      )?.groups ?? -1;
    expect(at(0)).toBe(1);
    expect(at(1)).toBe(1);
    expect(at(3)).toBe(0);
    expect(sweep.operating.conditionMinShared).toBe(0);
  });

  it("separates the chain from the group, which is the reading the linkage change bought", () => {
    const sweep = sweepConsolidation(
      CHAIN,
      { ...AT_ZERO, threshold: 0.6 },
      [0.19, 0.6],
      [0],
    );
    const at = (threshold: number) =>
      sweep.points.find(
        (point) =>
          point.threshold === threshold && point.conditionMinShared === 0,
      );
    expect(at(0.6)).toMatchObject({
      groups: 1,
      largestGroup: 2,
      maxSupport: 2,
      weakestPair: 0.6,
    });
    // At a floor the extreme pair clears, the same three items are one group — and the sweep says
    // so, including the 0.20 that group rests on.
    expect(at(0.19)).toMatchObject({
      groups: 1,
      largestGroup: 3,
      maxSupport: 3,
      weakestPair: 0.2,
    });
  });

  it("never reports a group whose weakest pair is below the floor it was produced at", () => {
    // The invariant complete linkage exists to make checkable. Asserted over every point rather
    // than the operating one, because a linkage change would show up at one floor before another.
    const sweep = sweepConsolidation(CHAIN, { ...AT_ZERO, threshold: 0.6 });
    for (const point of sweep.points) {
      if (point.groups === 0) continue;
      expect(
        point.weakestPair,
        `threshold ${String(point.threshold)}`,
      ).toBeGreaterThanOrEqual(point.threshold);
    }
  });

  it("leaves the grid unaltered when it is handed no overrides", () => {
    const sweep = sweepConsolidation(PAIR, { ...AT_ZERO, threshold: 0.6 });
    expect(sweep.points).toHaveLength(
      SWEEP_THRESHOLDS.length * SWEEP_CONDITIONS.length,
    );
    // Sorted by threshold then condition floor, so a reader can scan a row without sorting.
    for (let index = 1; index < sweep.points.length; index += 1) {
      const previous = sweep.points[index - 1] as {
        threshold: number;
        conditionMinShared: number;
      };
      const current = sweep.points[index] as {
        threshold: number;
        conditionMinShared: number;
      };
      const ordered =
        current.threshold > previous.threshold ||
        (current.threshold === previous.threshold &&
          current.conditionMinShared > previous.conditionMinShared);
      expect(ordered, `points ${String(index - 1)} and ${String(index)}`).toBe(
        true,
      );
    }
  });

  it("reports support as a distribution, so a single maximum cannot hide a collapse", () => {
    const sweep = sweepConsolidation(
      CHAIN,
      { ...AT_ZERO, threshold: 0.6 },
      [0.6],
      [0],
    );
    // Two items survive at 0.60: the group of two, and the item the chain left behind.
    expect(sweep.operating.support).toEqual({ 2: 1, 1: 1 });
  });
});

describe("sweepSummary", () => {
  it("prints one line per threshold at the operating condition floor, and no others", () => {
    const sweep = sweepConsolidation(
      CHAIN,
      { ...AT_ZERO, threshold: 0.6 },
      [0.5, 0.6],
      [0, 3],
    );
    const lines = sweepSummary(sweep);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("threshold 0.50:");
    expect(lines[1]).toContain("threshold 0.60:");
    // The condition floor is the operating one, so the ablation columns are not mixed in.
    for (const line of lines)
      expect(line).toMatch(
        /groups=\d+ merged=\d+ maxSupport=\d+ crossTask=\d+ largest=\d+ weakest=\d\.\d\d/,
      );
  });

  it("prints a line for a threshold whose floor merged nothing", () => {
    const sweep = sweepConsolidation(
      CHAIN,
      { ...AT_ZERO, threshold: 0.6 },
      [0.9],
      [0],
    );
    expect(sweepSummary(sweep)).toEqual([
      "threshold 0.60: groups=1 merged=1 maxSupport=2 crossTask=1 largest=2 weakest=0.60",
      "threshold 0.90: groups=0 merged=0 maxSupport=1 crossTask=0 largest=1 weakest=1.00",
    ]);
  });
});
