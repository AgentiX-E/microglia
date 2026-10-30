/**
 * Published cells, and the arithmetic that decides whether a comparison is admissible.
 *
 * Every competitor number this project quotes was measured on a split, at a sample size,
 * with a schema representation and a sample count. Those four facts travel with the number
 * or the number is not comparable — and until this module existed they travelled in prose,
 * which is how a Mini-Dev estimate (n=352) came to be reported as 0.09pp away from a
 * published BIRD-*dev* cell (n=1,534) as though the two were the same measurement.
 *
 * They are not. Two estimates of the same quantity on different samples differ by sampling
 * error alone, and the smaller sample has the larger error. The rule this module encodes:
 * **a comparison across splits is `indicative`, never `reproduced`**, and a claim of
 * `reproduced` requires the same split name *and* a difference inside the combined band.
 *
 * Nothing here calls a model: a cell is a published constant, an estimate is a pair of
 * numbers, and the verdict is closed-form. That is deliberate — the admissibility rule has
 * to be checkable from an artefact, by someone who does not trust our prose.
 */
import { MicrogliaError } from '@agentix-e/microglia-core';

/** A split, by the name the number was published under, and how many questions it holds. */
export type CellSplit = {
  readonly name: string;
  readonly n: number;
};

/**
 * One published measurement, with the four facts that make it comparable.
 *
 * `accuracy` is a percentage, the unit every competitor in this space publishes in. The
 * interval is not stored: it is computed from the split size, because a published cell
 * never comes with one (GradeSQL's own reviewer flagged the omission) and inventing a
 * stated interval for another team's number would be worse than computing the obvious one.
 */
export type PublishedCell = {
  readonly id: string;
  readonly system: string;
  readonly model: string;
  readonly representation: 'ddl' | 'm-schema';
  readonly samples: number;
  readonly split: CellSplit;
  readonly accuracy: number;
  readonly source: string;
};

/** `z` for a two-sided 95% interval. */
const Z95 = 1.959963984540054;

/**
 * The cells this project compares itself against.
 *
 * Only cells whose protocol we can name are listed: a number with no model, no schema
 * representation and no sample count is a headline, not a measurement, and adding one here
 * would make the gate below unable to refuse anything. `split.n` is the count the paper's
 * own protocol implies — BIRD dev is 1,534 questions — so the sampling band of the
 * published number can be computed rather than assumed to be zero.
 */
export const PUBLISHED_CELLS: readonly PublishedCell[] = [
  {
    id: 'xiyan-deepseek-ddl',
    system: 'XiYan-SQL baseline',
    model: 'DeepSeek',
    representation: 'ddl',
    samples: 1,
    split: { name: 'BIRD dev', n: 1534 },
    accuracy: 53.52,
    source: 'arXiv 2411.08599 v2, Table 6',
  },
  {
    id: 'xiyan-deepseek-mschema',
    system: 'XiYan-SQL + M-Schema',
    model: 'DeepSeek',
    representation: 'm-schema',
    samples: 1,
    split: { name: 'BIRD dev', n: 1534 },
    accuracy: 55.15,
    source: 'arXiv 2411.08599 v2, Table 6',
  },
];

/** A cell by id, or `undefined` — the caller decides whether that is an error. */
export function publishedCell(id: string): PublishedCell | undefined {
  return PUBLISHED_CELLS.find((cell) => cell.id === id);
}

/** A cell by id, or a configuration error naming the catalogue. */
export function requireCell(id: string): PublishedCell {
  const cell = publishedCell(id);
  if (cell === undefined) {
    throw new MicrogliaError('MG_E_CONFIG', `Unknown published cell '${id}'`, {
      known: PUBLISHED_CELLS.map((entry) => entry.id).join(', '),
    });
  }
  return cell;
}

/** An accuracy estimate: a fraction in [0, 1] over a sample of known size. */
export type Estimate = {
  readonly accuracy: number;
  readonly n: number;
};

function checkEstimate(estimate: Estimate): void {
  if (!Number.isFinite(estimate.accuracy) || estimate.accuracy < 0 || estimate.accuracy > 1) {
    throw new MicrogliaError('MG_E_CONFIG', 'accuracy must be a fraction in [0, 1]', {
      accuracy: estimate.accuracy,
    });
  }
  if (!Number.isInteger(estimate.n) || estimate.n < 1) {
    throw new MicrogliaError('MG_E_CONFIG', 'n must be a positive integer', { n: estimate.n });
  }
}

/**
 * The Wilson score interval for a proportion.
 *
 * Chosen over the Wald interval for one reason that matters here: at 53% and n=350 the two
 * agree, but at the edges — a cell at 0% or 100%, an arm that never answered — Wald
 * collapses to a point and reports certainty that the data does not contain. Wilson stays
 * inside [0, 1] and stays honest at the boundary, which is where a gated run most often is.
 */
export function wilsonInterval(
  estimate: Estimate,
  z: number = Z95,
): { readonly low: number; readonly high: number } {
  checkEstimate(estimate);
  const { accuracy, n } = estimate;
  const denominator = 1 + (z * z) / n;
  const centre = (accuracy + (z * z) / (2 * n)) / denominator;
  const spread = (z / denominator) * Math.sqrt((accuracy * (1 - accuracy)) / n + (z * z) / (4 * n * n));
  return { low: Math.max(0, centre - spread), high: Math.min(1, centre + spread) };
}

/**
 * The standard deviation, in percentage points, of an accuracy measured at `n`.
 *
 * This is the noise floor a published cell carries whether or not it is printed. A paper
 * that reports 53.52 on 1,534 questions is reporting 53.52 ± 2.53, so treating the fourth
 * significant figure as a target to hit is a category error: it is inside the published
 * number's own error bar.
 */
export function samplingSdPp(accuracy: number, n: number): number {
  if (!Number.isFinite(accuracy) || accuracy < 0 || accuracy > 1) {
    throw new MicrogliaError('MG_E_CONFIG', 'accuracy must be a fraction in [0, 1]', { accuracy });
  }
  if (!Number.isInteger(n) || n < 1) {
    throw new MicrogliaError('MG_E_CONFIG', 'n must be a positive integer', { n });
  }
  return 100 * Math.sqrt((accuracy * (1 - accuracy)) / n);
}

/**
 * What a comparison is allowed to say.
 *
 * `reproduced` — same split, and the published value falls inside our interval.
 * `indicative` — different splits, and the published value falls inside the band formed by
 * both estimates' error. The honest reading is "consistent with", never "we matched them".
 * `outside` — the published value is further away than either error bar explains.
 */
export type CellVerdict = 'reproduced' | 'indicative' | 'outside';

export type CellComparison = {
  readonly cell: string;
  /** Our estimate, in percentage points, so it reads beside the published number. */
  readonly oursPp: number;
  readonly publishedPp: number;
  readonly diffPp: number;
  readonly ourSplit: string;
  readonly publishedSplit: string;
  readonly sameSplit: boolean;
  /** Our 95% interval, in percentage points. */
  readonly ourLowPp: number;
  readonly ourHighPp: number;
  /** The published estimate's own 95% band, in percentage points. */
  readonly publishedLowPp: number;
  readonly publishedHighPp: number;
  /** The band a difference has to fall inside: 1.96 standard errors of each estimate, added. */
  readonly tolerancePp: number;
  readonly verdict: CellVerdict;
};

/**
 * Compare our estimate against a published cell, and say only what the numbers support.
 *
 * The gate that consumes this refuses an artefact whose recorded verdict disagrees with
 * what this function returns from the same numbers, so a report cannot upgrade a comparison
 * after the fact.
 */
export function compareCell(input: {
  readonly cell: string;
  readonly estimate: Estimate;
  readonly split: CellSplit;
}): CellComparison {
  const cell = requireCell(input.cell);
  const { estimate, split } = input;
  const interval = wilsonInterval(estimate);
  const publishedSd = samplingSdPp(cell.accuracy / 100, cell.split.n);
  const oursPp = 100 * estimate.accuracy;
  const ourLowPp = 100 * interval.low;
  const ourHighPp = 100 * interval.high;
  const publishedLowPp = cell.accuracy - Z95 * publishedSd;
  const publishedHighPp = cell.accuracy + Z95 * publishedSd;
  const sameSplit = split.name === cell.split.name;
  // The two errors add: a difference between two estimates is explained when it is inside
  // 1.96 standard errors of each. Testing membership in a single interval would let a
  // difference of twenty points pass whenever the two intervals happened to bracket it, and
  // taking the union of the two intervals does exactly that.
  const ourSePp = samplingSdPp(estimate.accuracy, estimate.n);
  const combinedPp = Z95 * (ourSePp + publishedSd);
  const within = Math.abs(oursPp - cell.accuracy) <= combinedPp;
  const verdict: CellVerdict = !within ? 'outside' : sameSplit ? 'reproduced' : 'indicative';
  return {
    cell: cell.id,
    oursPp: Number(oursPp.toFixed(2)),
    publishedPp: cell.accuracy,
    diffPp: Number((oursPp - cell.accuracy).toFixed(2)),
    ourSplit: split.name,
    publishedSplit: cell.split.name,
    sameSplit,
    ourLowPp: Number(ourLowPp.toFixed(2)),
    ourHighPp: Number(ourHighPp.toFixed(2)),
    publishedLowPp: Number(publishedLowPp.toFixed(2)),
    publishedHighPp: Number(publishedHighPp.toFixed(2)),
    tolerancePp: Number(combinedPp.toFixed(2)),
    verdict,
  };
}

/** What a recorded comparison has to satisfy to be admissible evidence. */
export type CellGate = {
  readonly code: 'V31';
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
};

/**
 * Re-derive a recorded comparison and refuse it if the record disagrees with the arithmetic.
 *
 * Two failure modes are worth naming, because both happened in this project's prose before
 * this gate existed: a cross-split difference reported as a match, and a difference inside
 * the noise floor read as a win. The gate is stated as "the record must equal the
 * computation", which catches both without knowing which one was intended. It also holds the
 * cross-split rule without a second check: `compareCell` cannot return `reproduced` when the
 * split names differ, so a record that says otherwise already disagrees on the verdict.
 */
export function cellGate(recorded: CellComparison | undefined, estimate: Estimate, split: CellSplit): CellGate {
  if (recorded === undefined) {
    return { code: 'V31', name: 'cell-comparison', ok: true, detail: 'no cell comparison was recorded' };
  }
  const recomputed = compareCell({ cell: recorded.cell, estimate, split });
  const fields = ['verdict', 'diffPp', 'sameSplit'] as const;
  const disagreements = fields.filter((field) => recomputed[field] !== recorded[field]);
  if (disagreements.length > 0) {
    return {
      code: 'V31',
      name: 'cell-comparison',
      ok: false,
      detail:
        `recorded ${recorded.cell} ${recorded.verdict} (${recorded.diffPp}pp) disagrees with the ` +
        `arithmetic: ${recomputed.verdict} (${recomputed.diffPp}pp); fields: ${disagreements.join(', ')}`,
    };
  }
  return {
    code: 'V31',
    name: 'cell-comparison',
    ok: true,
    detail: `${recorded.cell}: ${recorded.verdict} at ${recorded.diffPp}pp`,
  };
}
