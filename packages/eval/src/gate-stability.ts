/**
 * Whether the gate's estimate survives being taken apart: one database, one random subset, one half.
 *
 * §140 estimated that a read-time filter discarding every memory query which imports an ungrounded
 * name would move the dev delta from +0.33pp to +1.30pp. The estimate is exact — the fallback
 * query is a column, not a prediction — and it is in-sample, which the round said out loud. What
 * it did not say is how *fragile* it is, and there are three ways a number computed on 1,534
 * questions over eleven databases can be an artefact of its corpus:
 *
 *  - **one database carries it.** Questions are not independent: a rule injected on one question
 *    of `california_schools` is injected on forty. If the improvement disappears when one database
 *    is removed, the gate is a story about that database and a 6,600-question rerun would measure
 *    a different mixture rather than confirm it.
 *  - **the placement does not matter.** The gate discards 10.1% of the corpus, and discarding
 *    questions at random already changes the delta slightly. If +1.30pp sits inside the spread of
 *    random subsets of the same size, the gate is not finding damaged questions; it is paying for
 *    the variance of dropping any ten percent.
 *  - **the two halves disagree.** A split by database, balanced so that neither half is small,
 *    says whether the effect exists at a sample size the current instrument can only just see.
 *
 * All three are read from the same committed artefact, and the third is deliberately labelled: it
 * cannot undo the fact that the hypothesis came from the whole corpus, because both halves were in
 * it. What it can say is whether the effect is *stable across sub-samples*, which is a weaker and
 * still useful statement — and the difference between the two is stated in the artefact rather
 * than left for a reader to assume.
 */
import { mulberry32 } from '@agentix-e/microglia-core';
import { cellOf, discardSetOf, improvementOf, type DiffCase } from './query-diff.js';
import type { GroundingMode } from './sql-diff.js';

/** One database removed, and what the gate is still worth without it. */
export type JackknifeRow = {
  readonly dropped: string;
  readonly n: number;
  readonly discarded: number;
  readonly improvementPp: number;
};

/** One half of the database split. */
export type HalfReading = {
  readonly half: string;
  readonly databases: readonly string[];
  readonly n: number;
  readonly discarded: number;
  readonly gatedDeltaPp: number | null;
  readonly improvementPp: number;
  readonly minDetectablePp: number | null;
};

/** Where the observed improvement sits inside the distribution of random subsets of its own size. */
export type PermutationReading = {
  readonly resamples: number;
  readonly observedPp: number;
  readonly nullMeanPp: number;
  readonly nullLowPp: number;
  readonly nullHighPp: number;
  /**
   * Share of random subsets at least as good as the gate, with the observed draw counted.
   *
   * The `+1` in both parts is the standard correction: the observed arrangement is one of the
   * arrangements the null distribution could have produced, and leaving it out understates `p` by
   * one draw — which at 5,000 resamples is the difference between 0 and 0.0002.
   */
  readonly p: number;
};

export type StabilityCriterion = {
  readonly code: string;
  readonly criterion: string;
  readonly actual: string;
  readonly ok: boolean;
};

export type GateStability = {
  readonly mode: GroundingMode;
  readonly n: number;
  readonly discarded: number;
  readonly observedPp: number;
  readonly jackknife: readonly JackknifeRow[];
  readonly jackknifeMinPp: number | null;
  readonly jackknifeMaxPp: number | null;
  readonly halves: readonly HalfReading[];
  readonly permutation: PermutationReading;
  readonly criteria: readonly StabilityCriterion[];
  /** Whether any of the three readings failed, in which case the estimate is not a property of the gate. */
  readonly unstable: boolean;
};

export type StabilityOptions = {
  readonly mode?: GroundingMode;
  readonly resamples?: number;
  readonly seed?: number;
  /** How many random subsets the permutation test draws. */
  readonly permutations?: number;
};

/** The share of the improvement the weakest half must keep before the effect is called stable. */
export const HALF_FLOOR_PP = 0;

/**
 * Split the databases into two halves, balanced by question count.
 *
 * Greedy rather than half-by-hash: `dev` has eleven databases and their sizes are not close —
 * `california_schools` alone is a fifth of the corpus — so an arbitrary partition can produce a
 * half whose own resolution is too wide to say anything. Largest first into the lighter half is
 * deterministic, needs no seed, and keeps the two halves within one database of each other.
 */
export function halvesOf(entries: readonly DiffCase[]): { readonly half: string; readonly databases: readonly string[]; readonly rows: readonly DiffCase[] }[] {
  const counts = new Map<string, number>();
  for (const entry of entries) counts.set(entry.dbId, (counts.get(entry.dbId) ?? 0) + 1);
  const ordered = [...counts.entries()].sort((left, right) =>
    right[1] === left[1] ? (left[0] < right[0] ? -1 : 1) : right[1] - left[1],
  );
  const first: { databases: string[]; size: number } = { databases: [], size: 0 };
  const second: { databases: string[]; size: number } = { databases: [], size: 0 };
  for (const [dbId, size] of ordered) {
    // Ties go to the first side, which is what makes the split a function of the counts alone.
    const target = first.size <= second.size ? first : second;
    target.databases.push(dbId);
    target.size += size;
  }
  // The rows are partitioned by which side their database landed on, in one pass over the corpus,
  // rather than looked up per database afterwards: a lookup can miss, and a `?? []` for a miss that
  // cannot happen is a branch no input can reach.
  return [first, second].map((side, at) => ({
    half: at === 0 ? 'A' : 'B',
    databases: side.databases,
    rows: entries.filter((entry) => side.databases.includes(entry.dbId)),
  }));
}

/**
 * Draw `count` of `size` indices without replacement, from a seeded generator.
 *
 * A partial Fisher–Yates over an index array. Sampling with replacement would let one question be
 * picked twice, which would make the null distribution the spread of a *smaller* subset than the
 * gate actually discards — a wider null, and a p-value that flatters the gate.
 */
function drawIndices(size: number, count: number, random: () => number): readonly number[] {
  const pool = Array.from({ length: size }, (_, at) => at);
  for (let at = 0; at < count; at += 1) {
    const swap = at + Math.floor(random() * (size - at));
    const held = pool[at] as number;
    pool[at] = pool[swap] as number;
    pool[swap] = held;
  }
  return pool.slice(0, count);
}

/** Read all three stabilities. */
export function stabilityOf(entries: readonly DiffCase[], options: StabilityOptions = {}): GateStability {
  const mode = options.mode ?? 'strict';
  const resamples = options.resamples ?? 2_000;
  const seed = options.seed ?? 12345;
  const permutations = options.permutations ?? 5_000;
  const discarded = discardSetOf(entries, mode);
  const observedPp = improvementOf(entries, discarded);

  const databases = [...new Set(entries.map((entry) => entry.dbId))].sort();
  const jackknife: JackknifeRow[] = databases.map((dropped) => {
    const rows = entries.filter((entry) => entry.dbId !== dropped);
    const inner = discardSetOf(rows, mode);
    return {
      dropped,
      n: rows.length,
      discarded: inner.size,
      improvementPp: improvementOf(rows, inner),
    };
  });
  const improvements = jackknife.map((row) => row.improvementPp);

  const halves: HalfReading[] = halvesOf(entries).map((side) => {
    const inner = discardSetOf(side.rows, mode);
    const gated = side.rows.map((entry) =>
      inner.has(entry.id) ? { ...entry, correct: entry.withoutMemoryCorrect } : entry,
    );
    const cell = cellOf(gated, resamples);
    return {
      half: side.half,
      databases: side.databases,
      n: side.rows.length,
      discarded: inner.size,
      gatedDeltaPp: cell.deltaPp,
      improvementPp: improvementOf(side.rows, inner),
      minDetectablePp: cell.minDetectablePp,
    };
  });

  const random = mulberry32(seed);
  const nullSamples: number[] = [];
  const ids = entries.map((entry) => entry.id);
  // A permutation test with no permutations has no p-value to report, and reporting one anyway
  // would put a 0.05-shaped number beside a distribution that was never drawn. One draw is the
  // floor, and it is the same computation at a size a test can afford.
  const draws = Math.max(1, permutations);
  for (let at = 0; at < draws; at += 1) {
    const picked = drawIndices(ids.length, discarded.size, random);
    const subset = new Set<string>();
    for (const index of picked) subset.add(ids[index] as string);
    nullSamples.push(improvementOf(entries, subset));
  }
  nullSamples.sort((left, right) => left - right);
  const atLeast = nullSamples.filter((value) => value >= observedPp).length;
  const mean = nullSamples.reduce((sum, value) => sum + value, 0) / nullSamples.length;
  const permutation: PermutationReading = {
    resamples: nullSamples.length,
    observedPp,
    nullMeanPp: mean,
    nullLowPp: nullSamples[Math.floor(0.025 * (nullSamples.length - 1))] as number,
    nullHighPp: nullSamples[Math.floor(0.975 * (nullSamples.length - 1))] as number,
    p: (atLeast + 1) / (nullSamples.length + 1),
  };

  const jackknifeMinPp = improvements.length === 0 ? null : Math.min(...improvements);
  const jackknifeMaxPp = improvements.length === 0 ? null : Math.max(...improvements);
  const weakestHalf = Math.min(...halves.map((row) => row.improvementPp));
  // One expression for the spread, so the empty case cannot be handled twice with two different
  // answers: `Math.min` of nothing is `Infinity`, and a report of "infinity to −infinity over zero
  // databases" is exactly the reading this project keeps removing.
  const spread =
    improvements.length === 0
      ? 'unmeasured: no database to remove'
      : `leave-one-out ${Math.min(...improvements).toFixed(2)}pp to ${Math.max(...improvements).toFixed(2)}pp over ${improvements.length} databases`;
  const criteria: StabilityCriterion[] = [
    {
      code: 'S1',
      criterion: 'No single database carries the estimate: the improvement stays above zero with each one removed',
      actual: spread,
      ok: jackknifeMinPp !== null && jackknifeMinPp > 0,
    },
    {
      code: 'S2',
      criterion: 'The placement matters: the observed improvement beats random subsets of its own size at p < 0.05',
      actual: `${observedPp.toFixed(2)}pp against a null of ${permutation.nullMeanPp.toFixed(2)}pp [${permutation.nullLowPp.toFixed(2)}, ${permutation.nullHighPp.toFixed(2)}], p=${permutation.p.toFixed(4)}`,
      ok: permutation.p < 0.05,
    },
    {
      code: 'S3',
      criterion: `Both halves of the database split keep an improvement above ${HALF_FLOOR_PP.toFixed(1)}pp`,
      // `halvesOf` always returns two halves, so `weakestHalf` is a number even for an empty
      // corpus — both halves are then worth nothing, which is the reading S3 should give.
      actual: halves
        .map((row) => `${row.half} ${row.improvementPp.toFixed(2)}pp (n=${row.n}, ${row.discarded} discarded)`)
        .join('; '),
      ok: weakestHalf > HALF_FLOOR_PP,
    },
  ];

  return {
    mode,
    n: entries.length,
    discarded: discarded.size,
    observedPp,
    jackknife,
    jackknifeMinPp,
    jackknifeMaxPp,
    halves,
    permutation,
    criteria,
    unstable: criteria.some((entry) => !entry.ok),
  };
}
