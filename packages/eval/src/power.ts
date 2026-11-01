/**
 * What each published paired delta could have detected, and whether it exceeded that.
 *
 * The project has quoted a per-question memory effect since its first iteration, and the numbers
 * have ranged from +8pp to −9.26pp without either end settling. A range that wide across runs of
 * the same comparison has two possible explanations — the mechanism moves, or the instrument is
 * reading noise — and there is no way to tell them apart without putting each delta beside the
 * difference its own sample could have resolved.
 *
 * That second number already exists. `detectableDelta` is the protocol's minimum detectable
 * difference at 80% power, `V5-resolution` refuses to publish a comparison that cannot resolve
 * 6pp, and the τ² lane was blocked at 21.41pp against a 6pp bar. What was never done is the
 * arithmetic applied to the record *already published*: one row per artefact, its delta, and the
 * smallest delta its sample could have distinguished from zero.
 *
 * Nothing here re-runs anything. Every row is arithmetic over a committed artefact, which is the
 * only reason the audit is cheap enough to be part of the build rather than a paper.
 */
import { detectableDelta } from './protocol.js';

/** `z` for a two-sided 95% interval. */
export const HALF_WIDTH_Z = 1.96;

/** The two numbers a paired design contributes: the difference, and the smallest it could see. */
export type PairedWidths = {
  /** `(helped − harmed) / n`, in percentage points. */
  readonly deltaPp: number;
  /** `1.96 · SE` of that delta, in percentage points. */
  readonly halfWidthPp: number;
  /** The minimum detectable difference at 80% power, in percentage points. */
  readonly minDetectablePp: number;
};

/**
 * Widths of a paired comparison from its discordant counts.
 *
 * `null` for an empty sample rather than a zero: a comparison with no pairs has no difference and
 * no resolution, and a zero would read as "measured, and exactly zero".
 *
 * The standard error counts only the pairs that changed hands, because the concordant ones cancel
 * — that is the whole reason to pair rather than to compare two rates. A design that ignored the
 * pairing would use `sqrt(2p(1−p)/n)` and report a width roughly three times larger at this
 * discordance, which would make every published effect look unresolvable and every future one
 * look expensive.
 */
export function pairedWidths(helped: number, harmed: number, n: number): PairedWidths | null {
  if (n <= 0) return null;
  const discordant = helped + harmed;
  const standardErrorPp = (Math.sqrt(discordant) / n) * 100;
  return {
    deltaPp: ((helped - harmed) / n) * 100,
    halfWidthPp: HALF_WIDTH_Z * standardErrorPp,
    // The same `2.802` the protocol uses, from the same function: a second formula for the minimum
    // detectable difference would be a second answer to a question the record already answers.
    minDetectablePp: detectableDelta(n, discordant / n) * 100,
  };
}

/** One published artefact's paired delta beside the difference its sample could have resolved. */
export type PowerRow = {
  readonly artefact: string;
  readonly n: number;
  readonly helped: number;
  readonly harmed: number;
  readonly deltaPp: number;
  readonly halfWidthPp: number;
  readonly minDetectablePp: number;
  /**
   * Whether `|delta|` exceeds the minimum detectable difference.
   *
   * This is the bar `V5-resolution` applies, which is stricter than a 95% interval: an effect at
   * exactly 80% power is what a design can see four times in five, not what it has shown. The flag
   * is a *resolution* statement and not a second test — it is a monotone function of the same
   * discordant counts as McNemar's, so it can never disagree with the p-value about the direction.
   * What it adds is a scale: the record's deltas sit beside the effect their sample was built to
   * find, which is the comparison the p-values alone never made.
   */
  readonly resolvable: boolean;
  /** Whether `|delta|` exceeds its own 95% half-width. The looser of the two bars, shown so that
   * neither reading of the same row can be quoted without the other one being visible. */
  readonly significant95: boolean;
};

export type PowerSummary = {
  readonly rows: readonly PowerRow[];
  /** Rows whose delta beats the 80%-power bar. */
  readonly resolvable: number;
  /** Rows whose delta beats the 95% half-width. */
  readonly significant95: number;
  readonly total: number;
  /** The artefact with the largest absolute delta, or `null` for an empty record. */
  readonly largest: PowerRow | null;
  /** The artefact whose design could resolve the most, or `null` for an empty record. */
  readonly sharpest: PowerRow | null;
};

export type PairedCase = {
  readonly correct: boolean;
  readonly withoutMemoryCorrect: boolean;
};

/** One row, from an artefact's per-question outcomes. */
export function powerOf(artefact: string, cases: readonly PairedCase[]): PowerRow {
  let helped = 0;
  let harmed = 0;
  for (const entry of cases) {
    if (entry.correct && !entry.withoutMemoryCorrect) helped += 1;
    else if (entry.withoutMemoryCorrect && !entry.correct) harmed += 1;
  }
  const widths = pairedWidths(helped, harmed, cases.length);
  if (widths === null) {
    throw new Error(`${artefact} has no paired cases, so it has no delta to audit`);
  }
  return {
    artefact,
    n: cases.length,
    helped,
    harmed,
    deltaPp: widths.deltaPp,
    halfWidthPp: widths.halfWidthPp,
    minDetectablePp: widths.minDetectablePp,
    // Strictly greater, on both bars. A delta equal to the minimum detectable difference is at the
    // edge of what the design can see, and calling that a detection is how a 5%-power result gets
    // published; a delta equal to its half-width is the same edge one test lower.
    resolvable: Math.abs(widths.deltaPp) > widths.minDetectablePp,
    significant95: Math.abs(widths.deltaPp) > widths.halfWidthPp,
  };
}

/**
 * Summarise the record.
 *
 * `largest` and `sharpest` are separate fields because they answer different questions: the first
 * is the biggest claim anyone made, the second is the best instrument anyone pointed at the
 * question. A record where those are different rows is a record whose best measurement was not the
 * one it was most confident about.
 */
export function readPower(rows: readonly PowerRow[]): PowerSummary {
  if (rows.length === 0) {
    return { rows, resolvable: 0, significant95: 0, total: 0, largest: null, sharpest: null };
  }
  const largest = rows.reduce((left, right) => (Math.abs(right.deltaPp) > Math.abs(left.deltaPp) ? right : left));
  const sharpest = rows.reduce((left, right) => (right.minDetectablePp < left.minDetectablePp ? right : left));
  return {
    rows,
    resolvable: rows.filter((row) => row.resolvable).length,
    significant95: rows.filter((row) => row.significant95).length,
    total: rows.length,
    largest,
    sharpest,
  };
}
