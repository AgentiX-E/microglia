/**
 * Every arm this project ever published, beside the difference its own sample could resolve.
 *
 * `power.ts` audits *artefacts*: one row per committed run, its memory contrast, and the smallest
 * delta the run could have detected. That audit has a hole with a name — an arm inside an artefact
 * is not a row (`AUDIT` §25.7) — and the hole is where most of this project's claims live. `values`
 * at +1.17pp, `linked` at −9.26pp, `full-one` at −0.20pp, `full-lexicon` at −0.59pp, the four
 * `full-verified` readings: every one of them is an arm, none of them is an artefact, and none of
 * them was ever put beside its own resolution. A reader could therefore not tell a finding from a
 * number that a 350-question design was always going to produce.
 *
 * The answer to §25.7's open question — *is an arm an artefact?* — is **no, and it does not need to
 * be**. An artefact is the unit the validity gates certify: one dataset, one fold partition, one
 * call budget, one set of vetted outcomes. An arm is a column of that same run. It inherits the
 * gates and contributes one number the gates never read: how many questions changed hands between
 * it and its control. So the arm does not need a validity schema of its own. It needs the two
 * arithmetic columns the artefact rows already carry, read as a row.
 *
 * What that produces is a price list rather than a verdict. Every undecided row has a *cost*: how
 * many questions it would take to decide an effect of the size it found. Some of those costs are
 * affordable and some are absurd, and until they are printed side by side the record cannot tell
 * which of its disagreements are disagreements and which are two samples too small to have met.
 *
 * Every number here is arithmetic over a committed artefact. Nothing re-runs.
 */
import { pairedWidths } from './power.js';

/** `z` for α = 0.05 two-sided at 80% power, the constant the paired resolution uses everywhere. */
const Z_80 = 2.802;

/** What a published arm row looks like, before anything is recomputed. */
export type PublishedArm = {
  /** The arm's own name, as the artefact spells it: `full`, `full-one`, `values`, `linked`. */
  readonly arm: string;
  /** The arm it was compared against. `none` for a treatment effect, `full` for a control. */
  readonly control: string;
  readonly n: number;
  readonly helped: number;
  readonly harmed: number;
  /** The delta the artefact printed, in percentage points. */
  readonly foundPp: number;
};

/** One arm, recomputed and set beside the difference its own sample could resolve. */
export type ArmReading = {
  readonly artefact: string;
  readonly dataset: string;
  readonly arm: string;
  readonly control: string;
  readonly n: number;
  readonly helped: number;
  readonly harmed: number;
  /** The delta recomputed from the discordant counts. */
  readonly deltaPp: number;
  /** `1.96 · SE` of that delta, in percentage points. */
  readonly halfWidthPp: number;
  /** The smallest delta this sample could detect at 80% power, in percentage points. */
  readonly minDetectablePp: number;
  /**
   * Whether the delta beats the 80%-power bar, which is `V5-resolution`'s bar and stricter than a
   * 95% interval. Called *decided* rather than *significant* because the question this column
   * answers is "could this design have seen an effect this size", not "is it there".
   */
  readonly decided: boolean;
  /** Whether the delta beats its own 95% half-width. The looser bar, shown beside the stricter one. */
  readonly significant95: boolean;
  /**
   * Questions this contrast would need to decide an effect of the size it found, at the
   * discordance it observed. `null` when the effect is exactly zero, which is an infinite price and
   * not a large one.
   */
  readonly requiredN: number | null;
  /** Whether the artefact's printed delta is the one its own discordant counts imply. */
  readonly reconciles: boolean;
};

/**
 * Read one published row as an arm.
 *
 * The reconciliation is not a formality. A row whose printed delta is not `(helped − harmed) / n`
 * is a row whose two halves came from different questions, which this record has produced before
 * (`AUDIT` §34.9) and which no gate downstream would catch — the delta would simply be a number
 * about a population nobody ran. The check is exact to a thousandth of a point because all three
 * inputs are integers and the quotient is the only source of rounding.
 */
export function armReadingOf(artefact: string, dataset: string, row: PublishedArm): ArmReading {
  const widths = pairedWidths(row.helped, row.harmed, row.n);
  if (widths === null) {
    throw new Error(`${artefact}/${row.arm} has no cases, so it has no resolution`);
  }
  return {
    artefact,
    dataset,
    arm: row.arm,
    control: row.control,
    n: row.n,
    helped: row.helped,
    harmed: row.harmed,
    deltaPp: round4(widths.deltaPp),
    halfWidthPp: round4(widths.halfWidthPp),
    minDetectablePp: round4(widths.minDetectablePp),
    // Both bars are read off the same two numbers, and both are strictly greater: a delta equal to
    // the minimum detectable difference is at the edge of what 80% power buys, and calling that a
    // detection is how a 5%-power result gets published.
    decided: Math.abs(widths.deltaPp) > widths.minDetectablePp,
    significant95: Math.abs(widths.deltaPp) > widths.halfWidthPp,
    requiredN: requiredSampleSize(widths.deltaPp, row.helped + row.harmed, row.n),
    reconciles: Math.abs(widths.deltaPp - row.foundPp) <= 0.0005,
  };
}

/**
 * How many questions it would take to decide an effect of a given size.
 *
 * The inversion of the same formula `detectableDelta` uses: `n = z²·d / δ²`, with `d` the share of
 * discordant pairs and `δ` the difference as a share of questions. Both are taken from the run that
 * is being priced, which is the only honest source available before the larger run exists — and it
 * carries the same caveat the minimum detectable difference carries: the discordance a larger run
 * would show is not necessarily the discordance this one showed. The column is a *price*, quoted to
 * decide whether a question is worth buying, not a promise about what buying it would find.
 *
 * `null` for a zero effect: dividing by it would print an enormous integer that reads like an
 * estimate, and "we would need infinitely many questions to decide whether this changed nothing"
 * is the true statement.
 */
export function requiredSampleSize(deltaPp: number, discordant: number, n: number): number | null {
  if (deltaPp === 0) return null;
  if (n <= 0 || discordant <= 0) return null;
  const share = deltaPp / 100;
  const discordance = Math.min(1, discordant / n);
  return Math.ceil((Z_80 * Z_80 * discordance) / (share * share));
}

/** One contrast name's appearances across runs, in publication order. */
export type ContrastReplication = {
  /** `${arm} − ${control}`: the string a reader can grep the artefacts for. */
  readonly contrast: string;
  readonly readings: readonly ArmReading[];
  /** Rows whose delta beat their own 80%-power bar. */
  readonly decided: number;
  readonly positive: number;
  readonly negative: number;
  /**
   * Whether every decided row points the same way.
   *
   * `null` when fewer than two rows were decided: a single decided run has no replication to agree
   * with, and reporting it as agreement would let one run stand for a repeated finding.
   */
  readonly decidedAgree: boolean | null;
  /** Every row of this contrast landed inside its own resolution: nothing was decided either way. */
  readonly allUndecided: boolean;
};

/**
 * Group the ledger by contrast.
 *
 * Runs are **not** pooled. The questionnaire is the same corpus but not the same sample: minidev is
 * a 350-question slice, dev is 1,534, train is 7,000 out of sample, and every one of them has its
 * own fold partition and its own store. A pooled estimate over them would be an average of five
 * different experiments weighted by size, which is the error this record has refused since R13.
 * What can be said across them is what is said here: how many runs there are, how many could
 * decide, and whether the decided ones agree.
 */
export function replicationsOf(readings: readonly ArmReading[]): readonly ContrastReplication[] {
  const groups = new Map<string, ArmReading[]>();
  for (const reading of readings) {
    const contrast = `${reading.arm} − ${reading.control}`;
    const bucket = groups.get(contrast);
    if (bucket === undefined) groups.set(contrast, [reading]);
    else bucket.push(reading);
  }
  return [...groups.entries()]
    .map(([contrast, rows]) => {
      const decidedRows = rows.filter((row) => row.decided);
      const signs = new Set(decidedRows.map((row) => Math.sign(row.deltaPp)));
      return {
        contrast,
        readings: [...rows].sort(
          (left, right) => left.n - right.n || left.artefact.localeCompare(right.artefact),
        ),
        decided: decidedRows.length,
        positive: rows.filter((row) => row.deltaPp > 0).length,
        negative: rows.filter((row) => row.deltaPp < 0).length,
        decidedAgree: decidedRows.length < 2 ? null : signs.size === 1,
        allUndecided: decidedRows.length === 0,
      };
    })
    .sort((left, right) => right.readings.length - left.readings.length || left.contrast.localeCompare(right.contrast));
}

/** The floor a design of a given size imposes, computed from the rows that used that size. */
export type DesignFloor = {
  readonly n: number;
  readonly rows: number;
  /** The smallest and largest minimum detectable difference among the rows at this `n`. */
  readonly bestPp: number;
  readonly worstPp: number;
  /** The middle row's floor: one poor row cannot make a design look blind, and one sharp row cannot
   * make it look sharp. The median is what the size buys when nothing else is chosen. */
  readonly medianPp: number;
};

/**
 * What each sample size in the record could resolve, at best and at worst.
 *
 * This is the column that makes the 350-question pilots readable in one line: their discordance is
 * not a choice, so their floor is not either, and a 4.4pp floor cannot adjudicate a 1pp product
 * claim no matter how many times it is run. Publishing the floor beside the count of rows that used
 * it turns "underpowered" from an adjective into a specification.
 */
export function designFloors(readings: readonly ArmReading[]): readonly DesignFloor[] {
  const groups = new Map<number, ArmReading[]>();
  for (const reading of readings) {
    const bucket = groups.get(reading.n);
    if (bucket === undefined) groups.set(reading.n, [reading]);
    else bucket.push(reading);
  }
  return [...groups.entries()]
    .map(([n, rows]) => {
      // A bucket exists only because a row was put in it, so the three reads below are in range by
      // construction. The cast says that; a `?? 0` would invent a floor no design has.
      const sorted = rows.map((row) => row.minDetectablePp).sort((left, right) => left - right);
      const middle = sorted[Math.floor((sorted.length - 1) / 2)] as number;
      return {
        n,
        rows: rows.length,
        bestPp: round4(sorted[0] as number),
        worstPp: round4(sorted[sorted.length - 1] as number),
        medianPp: round4(middle),
      };
    })
    .sort((left, right) => left.n - right.n);
}

/** One contrast's median absolute delta at one sample size. */
export type ShrinkagePoint = {
  readonly n: number;
  readonly rows: number;
  /** The median of `|delta|` over the rows at this `n`. */
  readonly medianAbsPp: number;
  /** The median signed delta, which is a different number whenever the rows disagree in sign. */
  readonly medianPp: number;
};

/** One contrast measured at more than one sample size. */
export type Shrinkage = {
  readonly contrast: string;
  readonly points: readonly ShrinkagePoint[];
  /** Whether the median magnitude at the largest `n` is below, above, or equal to the smallest. */
  readonly direction: 'fell' | 'rose' | 'flat';
};

/**
 * Does the effect survive a bigger sample?
 *
 * This is the second thing a resolution column cannot say. A delta that is undecided at n = 1,534
 * and was +5.43pp at n = 350 has two readings — the effect is real and the design lost it, or the
 * effect was never 5pp and the small sample exaggerated it — and the only way to separate them is
 * to look at the same contrast at more than one size. When the magnitude falls as the sample grows,
 * the second reading is the one the arithmetic supports: a genuine effect does not shrink because
 * more questions were asked.
 *
 * **The confound is disclosed rather than corrected.** Rows at different `n` are different runs —
 * different rounds, stores and fold partitions — so a fall across sizes is a fall across experiment
 * families, not a paired comparison. That is why the direction is published per contrast with the
 * row counts beside it and no pooled estimate: a contrast measured once at each of two sizes
 * (`values − full`, +5.43 then +0.85) is a smaller fact than one measured thirteen times and six
 * times (`full − none`), and the reader can see which is which. Where the direction is "rose", the
 * round reports it: `linked` grows from 7.71 to 9.26 and that is the one contrast here whose effect
 * is large enough that a bigger sample confirmed it rather than dissolving it.
 */
export function shrinkageOf(readings: readonly ArmReading[]): readonly Shrinkage[] {
  const byContrast = new Map<string, Map<number, number[]>>();
  for (const reading of readings) {
    const contrast = `${reading.arm} − ${reading.control}`;
    const sizes = byContrast.get(contrast) ?? new Map<number, number[]>();
    const bucket = sizes.get(reading.n) ?? [];
    bucket.push(reading.deltaPp);
    sizes.set(reading.n, bucket);
    byContrast.set(contrast, sizes);
  }
  const out: Shrinkage[] = [];
  for (const [contrast, sizes] of byContrast) {
    if (sizes.size < 2) continue;
    const points = [...sizes.entries()]
      .map(([n, values]) => ({
        n,
        rows: values.length,
        medianAbsPp: round4(median(values.map((value) => Math.abs(value)))),
        medianPp: round4(median(values)),
      }))
      .sort((left, right) => left.n - right.n);
    const first = points[0] as ShrinkagePoint;
    const last = points[points.length - 1] as ShrinkagePoint;
    out.push({
      contrast,
      points,
      direction: last.medianAbsPp < first.medianAbsPp
        ? 'fell'
        : last.medianAbsPp > first.medianAbsPp ? 'rose' : 'flat',
    });
  }
  return out.sort((left, right) => left.contrast.localeCompare(right.contrast));
}

/** The middle of a non-empty list; the lower middle for an even count, so the value is always one
 * that was observed rather than an average of two that were. */
export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor((sorted.length - 1) / 2)] as number;
}

export type ResolutionLedger = {  readonly readings: readonly ArmReading[];
  readonly rows: number;
  readonly decided: number;
  readonly significant95: number;
  readonly reconciled: number;
  readonly artefacts: number;
  /** Rows that beat neither bar and would need more questions than they had to beat either. */
  readonly undecided: number;
  /** The row with the largest delta, and the row with the smallest resolution. */
  readonly largest: ArmReading | null;
  readonly sharpest: ArmReading | null;
  /** Rows whose effect is smaller than 1pp and which were never decided. */
  readonly quiet: number;
};

/**
 * Summarise the record.
 *
 * `largest` and `sharpest` are separate because they always are: the biggest claim in this record
 * was made on a design that could resolve 8.6pp, and the sharpest design in it resolved 0.82pp.
 * A ledger that reported one number for both would be reporting a coincidence.
 */
export function readResolution(readings: readonly ArmReading[]): ResolutionLedger {
  const empty: ResolutionLedger = {
    readings,
    rows: 0,
    decided: 0,
    significant95: 0,
    reconciled: 0,
    artefacts: 0,
    undecided: 0,
    largest: null,
    sharpest: null,
    quiet: 0,
  };
  if (readings.length === 0) return empty;
  const largest = readings.reduce((left, right) =>
    Math.abs(right.deltaPp) > Math.abs(left.deltaPp) ? right : left);
  const sharpest = readings.reduce((left, right) =>
    (right.minDetectablePp < left.minDetectablePp ? right : left));
  return {
    readings,
    rows: readings.length,
    decided: readings.filter((row) => row.decided).length,
    significant95: readings.filter((row) => row.significant95).length,
    reconciled: readings.filter((row) => row.reconciles).length,
    artefacts: new Set(readings.map((row) => row.artefact)).size,
    undecided: readings.filter((row) => !row.decided).length,
    largest,
    sharpest,
    quiet: readings.filter((row) => !row.decided && Math.abs(row.deltaPp) < 1).length,
  };
}

export type ResolutionGate = {
  readonly id: string;
  readonly pass: boolean;
  readonly blocking: boolean;
  readonly detail: string;
};

/**
 * `V69` — every row that was published is a row here.
 *
 * The failure this refuses is silent omission, which is the one this record has made in four
 * different layers: a filter applied inside a reader that nobody counted, so the table looks
 * complete and is short. The caller passes what it *found* while scanning and what it *emitted*, and
 * the gate is their equality. A reader that drops a row for any reason has to say so, because the
 * count is the only place the drop would be visible.
 */
export function coverageGate(input: {
  readonly published: number;
  readonly emitted: number;
  readonly artefacts: number;
}): ResolutionGate {
  const reasons: string[] = [];
  if (input.published === 0) reasons.push('no published arm rows were found at all');
  if (input.artefacts === 0) reasons.push('no artefact carried an arm block');
  if (input.published !== input.emitted) {
    reasons.push(`${String(input.published - input.emitted)} of ${String(input.published)} published rows were dropped`);
  }
  return {
    id: 'V69-every-arm-is-a-row',
    pass: reasons.length === 0,
    blocking: true,
    detail: reasons.length === 0
      ? `${String(input.emitted)} rows over ${String(input.artefacts)} artefacts, none dropped`
      : reasons.join('; '),
  };
}

/**
 * `V70` — a reconciled ledger is the only kind that can be read.
 *
 * One unreconciled row means at least one printed delta describes a population other than the one
 * its own counts describe, and every column derived from it — resolution, price, decision — would be
 * arithmetic about a sample that does not exist. Blocking, and blocking on a single row.
 */
export function reconcileGate(readings: readonly ArmReading[]): ResolutionGate {
  const broken = readings.filter((row) => !row.reconciles);
  return {
    id: 'V70-the-ledger-reconciles',
    pass: broken.length === 0 && readings.length > 0,
    blocking: true,
    detail: readings.length === 0
      ? 'nothing to reconcile'
      : broken.length === 0
        ? `${String(readings.length)} rows: every printed delta is its own discordant counts`
        : `${String(broken.length)} rows disagree with their counts, first ${(broken[0] as ArmReading).artefact}/${(broken[0] as ArmReading).arm}`,
  };
}

/**
 * `V71` — a price may not be cheaper than the purchase.
 *
 * `decided` and `requiredN` are two spellings of one inequality: a row is decided exactly when the
 * questions it needed are fewer than the questions it had. So a row that is undecided with
 * `requiredN < n` — or decided with `requiredN > n` — is not a hard case, it is a broken one, and it
 * would mean the two formulas had drifted. Advisory rather than blocking because it is an internal
 * consistency check on this module rather than a statement about the corpus; a failure here is a bug
 * in arithmetic, and the gate names which row so the bug has an address.
 */
export function priceGate(readings: readonly ArmReading[]): ResolutionGate {
  const broken = readings.filter((row) => {
    if (row.requiredN === null) return row.decided;
    return row.decided ? row.requiredN > row.n : row.requiredN < row.n;
  });
  return {
    id: 'V71-the-price-is-not-below-its-own-sample',
    pass: broken.length === 0 && readings.length > 0,
    blocking: false,
    detail: readings.length === 0
      ? 'no rows to price'
      : broken.length === 0
        ? `${String(readings.length)} rows: decided ⟺ the price is at or below the sample`
        : `${String(broken.length)} rows break the equivalence, first ${(broken[0] as ArmReading).artefact}/${(broken[0] as ArmReading).arm}`,
  };
}

/** Four decimals, because a percentage point quoted to nine is a number pretending to be precise. */
export function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}
