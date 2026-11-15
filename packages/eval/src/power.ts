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
import { detectableDelta } from './detectable.js';

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
  return n <= 0 ? null : widthsAt(helped, harmed, n);
}

/**
 * The same three numbers, over a sample that has pairs — which is the only sample they exist for.
 *
 * Split out because `pairedWidths`'s null case is *exactly* `n <= 0`, and every caller that has already
 * refused an empty sample was carrying an `if (widths === null)` branch no input could reach, with the
 * same message as the guard three lines above it. Two of them were, and the second was found by a
 * coverage row rather than by a reader. A null return is the right shape for a public function that may
 * be handed any sample; it is not the right shape for one that may not.
 */
function widthsAt(helped: number, harmed: number, n: number): PairedWidths {
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

/** The counts a pair artefact carries when it does not carry per-question outcomes. */
export type PairedCounts = {
  /** Pairs the treatment got right and the control got wrong. */
  readonly helped: number;
  /** Pairs the control got right and the treatment got wrong. */
  readonly harmed: number;
  /** Pairs in the comparison, concordant ones included. */
  readonly n: number;
};

/**
 * One row, from a pair artefact's aggregate counts.
 *
 * Two lanes report differently and both are honest: BIRD writes per-question outcomes, because it
 * owns the questions, while the τ² agent reports `lost`/`gained` over the tasks it ran. The audit
 * read only the first shape, so the τ² lane — the one that carries this project's SOTA statement —
 * was the one lane whose delta was never put beside its own resolution. That is a gap of exactly
 * the kind the audit exists to find, and it was in the audit.
 *
 * The three refusals are the arithmetic's own preconditions rather than style: a sample of no pairs
 * has no delta, and counts that are negative or exceed their sample describe a pair that cannot
 * exist. Each would still produce a number, which is why each is refused.
 */
export function powerFromCounts(artefact: string, counts: PairedCounts): PowerRow {
  const { helped, harmed, n } = counts;
  if (n <= 0) {
    throw new Error(`${artefact} has no pairs, so it has no delta to audit`);
  }
  if (helped < 0 || harmed < 0) {
    throw new Error(`${artefact} reports negative counts (${String(helped)}, ${String(harmed)}), which no sample can hold`);
  }
  if (helped + harmed > n) {
    throw new Error(
      `${artefact} reports ${String(helped + harmed)} discordant pairs of ${String(n)}, which exceed its own sample`,
    );
  }
  // No null branch: `n <= 0` is refused above with the same sentence, so this call cannot miss.
  const widths = widthsAt(helped, harmed, n);
  return {
    artefact,
    n,
    helped,
    harmed,
    deltaPp: widths.deltaPp,
    halfWidthPp: widths.halfWidthPp,
    minDetectablePp: widths.minDetectablePp,
    resolvable: Math.abs(widths.deltaPp) > widths.minDetectablePp,
    significant95: Math.abs(widths.deltaPp) > widths.halfWidthPp,
  };
}

/**
 * The `comparison` block a lane writes when it does not own the questions.
 *
 * Every field is optional in the type because this arrives as parsed JSON: a file may carry the
 * block without any of it, and the reader has to be able to see that rather than assume a shape.
 */
export type ComparisonBlock = {
  readonly paired?: number;
  readonly lost?: number;
  readonly gained?: number;
  readonly deltaPp?: number;
};

/**
 * How far a file's own delta may sit from the one its counts produce, in percentage points.
 *
 * A digest of rounding, not of disagreement: an artefact that wrote `1.47` is counting the same
 * pairs as one that wrote `1.4705882352941175`, and failing on formatting would be a check that
 * reports a defect it does not describe.
 */
const DELTA_AGREEMENT_PP = 0.01;

/** The refusal a `comparison` block earns when it names a delta over a sample it does not state. */
function missingField(artefact: string, name: 'paired' | 'lost' | 'gained'): Error {
  return new Error(
    `${artefact} carries a 'comparison' block without '${name}', so this audit cannot tell which ` +
      `sample its delta is over; a file that looks paired and is not must not be skipped`,
  );
}

/**
 * One row, from an artefact's `comparison` block.
 *
 * The direction check is the reason this is a function and not three lines in the command that
 * calls it. `gained` means the treatment won; a file that recorded the two sides the other way
 * round still yields a row, with the opposite sign, and nothing downstream would notice — the audit
 * would publish a sign nobody verified. Written here it is covered by tests; written in the command
 * it is a check that runs once per dispatch and is never exercised on the failure it exists for.
 *
 * A file that states no delta of its own is read from its counts, which is the evidence itself. A
 * file that states one and disagrees is refused, because at that point the counts and the claim are
 * two different measurements and this audit has to know which it is quoting.
 */
export function powerFromComparison(artefact: string, block: ComparisonBlock): PowerRow {
  const { paired, lost, gained, deltaPp } = block;
  // Three explicit guards rather than a loop over the three names, and the reason is the compiler's:
  // a loop throws for the reader but nothing narrows after it, so the version that used one had to
  // keep a second `throw` below to make the types line up — a branch no input can reach, exempted from
  // coverage by a comment instead of deleted. Written out, each guard narrows its own name and the
  // unreachable branch does not exist.
  if (paired === undefined) throw missingField(artefact, 'paired');
  if (lost === undefined) throw missingField(artefact, 'lost');
  if (gained === undefined) throw missingField(artefact, 'gained');
  const row = powerFromCounts(artefact, { helped: gained, harmed: lost, n: paired });
  if (deltaPp !== undefined && Math.abs(deltaPp - row.deltaPp) > DELTA_AGREEMENT_PP) {
    throw new Error(
      `${artefact} reports delta ${deltaPp.toFixed(2)}pp but gained − lost over paired gives ` +
        `${row.deltaPp.toFixed(2)}pp; one of the two has its two sides the wrong way round`,
    );
  }
  return row;
}

/** The two shapes a pair artefact may take, both optional because this arrives as parsed JSON. */
export type PairArtefact = {
  readonly per_case?: readonly (PairedCase & { readonly id?: string })[];
  readonly comparison?: ComparisonBlock;
};

/**
 * The row a scanned artefact contributes, or `null` when it contributes none.
 *
 * A directory of artefacts holds many things and only a paired run has a delta to audit, so the
 * scan needs a selector that can say "not this file" without throwing — but it must also be able to
 * say "this file claims to be paired and is not", which is a defect rather than a category. Those
 * two are different answers and this function returns different things for them: `null` for a file
 * that is not a pair, an error for a comparison block that is missing a count.
 *
 * `per_case` wins when both shapes are present. A file carrying both measured the questions and
 * summarised them, and the summary must not become the evidence.
 */
export function pairRowOf(artefact: string, parsed: PairArtefact): PowerRow | null {
  const cases = parsed.per_case;
  if (cases !== undefined && cases.length > 0 && 'withoutMemoryCorrect' in (cases[0] as object)) {
    return powerOf(artefact, cases);
  }
  if (parsed.comparison !== undefined) return powerFromComparison(artefact, parsed.comparison);
  return null;
}

/**
 * Half-width of an absolute score's 95% interval, in percentage points.
 *
 * A different quantity from every other number in this module, and the record has been reading one
 * while stating the other. `pairedWidths` measures a difference between two arms over the same
 * questions and conditions on the discordance; this measures a score on its own, over the tasks it
 * was computed on, with no pairing to cancel anything. At 40 tasks the two are **15.42pp** and
 * **44.30pp** — a factor of three — and a sentence about "our score is above theirs" needs the
 * first while a sentence about "memory helped" needs the second.
 *
 * A score of exactly 0 or 1 has no variance and therefore a zero width, which reads as certainty
 * and is: on that sample nothing else was observed. `Infinity` for no tasks rather than zero, for
 * the reason every other width here is: a bound over nothing describes nothing.
 */
export function scoreHalfWidthPp(score: number, tasks: number): number {
  if (!(score >= 0 && score <= 1)) {
    throw new Error(`${String(score)} is not a share, so it has no binomial width`);
  }
  // A count of zero is an empty sample and gets `Infinity`, the same answer `detectableDelta` and
  // `pairedWidths` give; a negative count is not a sample at all and is refused, because the two are
  // different statements and a single `<= 0` guard would merge them.
  if (tasks < 0) throw new Error(`${String(tasks)} is not a number of tasks, so it has no binomial width`);
  if (tasks === 0) return Number.POSITIVE_INFINITY;
  return HALF_WIDTH_Z * Math.sqrt((score * (1 - score)) / tasks) * 100;
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
  /**
   * The artefact whose design could resolve the least, or `null` for an empty record.
   *
   * `sharpest` is the instrument the record is proudest of; this is the one it leans on hardest,
   * and until the τ² pair artefact reached this audit they were never the same lane. A summary
   * that reports only the best design is a summary that hides which design a published claim
   * rested on — and the coarsest row here is the one that decides this project's SOTA statement.
   */
  readonly coarsest: PowerRow | null;
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
 * `largest`, `sharpest` and `coarsest` are separate fields because they answer different questions:
 * the first is the biggest claim anyone made, the second the best instrument anyone pointed at the
 * question, the third the instrument a published claim most likely rested on. A record where the
 * first and the second are different rows is a record whose best measurement was not the one it was
 * most confident about; a record where the third is not the second has a claim standing on its
 * weakest design, and no summary that omits it can say so.
 */
export function readPower(rows: readonly PowerRow[]): PowerSummary {
  if (rows.length === 0) {
    return { rows, resolvable: 0, significant95: 0, total: 0, largest: null, sharpest: null, coarsest: null };
  }
  const largest = rows.reduce((left, right) => (Math.abs(right.deltaPp) > Math.abs(left.deltaPp) ? right : left));
  const sharpest = rows.reduce((left, right) => (right.minDetectablePp < left.minDetectablePp ? right : left));
  const coarsest = rows.reduce((left, right) => (right.minDetectablePp > left.minDetectablePp ? right : left));
  return {
    rows,
    resolvable: rows.filter((row) => row.resolvable).length,
    significant95: rows.filter((row) => row.significant95).length,
    total: rows.length,
    largest,
    sharpest,
    coarsest,
  };
}
