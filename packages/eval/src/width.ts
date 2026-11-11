/**
 * How much of a sample's ceiling a selector actually captures.
 *
 * A pack of draws has two numbers that matter and neither is the score. The **first draw** is what one
 * call buys. The **oracle** is what a perfect chooser would extract from the same draws — the ceiling the
 * pool makes available, which is larger than the best single draw whenever the draws disagree. A
 * selector's worth is therefore not its accuracy but its position between the two:
 *
 *     share = (selected − first) / (oracle − first)
 *
 * Zero is a selector that adds nothing to taking the first answer; one is a selector that captures the
 * whole ceiling. It is a *ratio of two paired differences on the same questions*, which is why the
 * interval cannot come from the accuracies' own intervals: the denominator is a measurement too, and a
 * pool whose ceiling is 1pp wide makes the share explode on noise. The bootstrap below resamples
 * questions, recomputes all three accuracies and the ratio together, and keeps the resamples whose
 * ceiling is positive — because `(a − b) / 0` is not a share, it is a statement that the pool had no
 * ceiling to capture.
 *
 * R67 priced seven shape signals at chance and reported the ceiling; R68 dispatches three real selectors
 * against it. The number this module computes is the one that decides whether breadth is worth its calls:
 * a ceiling that no cheap selector captures is a ceiling about a chooser nobody has written.
 */

/** One question's outcome under each of the three ways of reading the same draws. */
export type WidthCase = {
  readonly id: string;
  /** Taking draw one. */
  readonly first: boolean;
  /** Taking the selector's pick. */
  readonly selected: boolean;
  /** Taking whichever draw was correct, when one was. */
  readonly oracle: boolean;
};

export type WidthShare = {
  readonly n: number;
  /** Accuracy of the first draw, the selector, and the oracle, on the same questions. */
  readonly first: number;
  readonly selected: number;
  readonly oracle: number;
  /** `(selected − first) / (oracle − first)`; `null` when the pool has no ceiling to capture. */
  readonly share: number | null;
  /** 95% interval for `share`, or `null` when too few resamples had a positive ceiling. */
  readonly interval: { readonly low: number; readonly high: number } | null;
  /** What breadth is worth at all: `(oracle − first)` in percentage points. */
  readonly ceilingPp: number;
  /** What the selector bought: `(selected − first)` in percentage points. */
  readonly capturedPp: number;
  /**
   * Resamples whose denominator was positive.
   *
   * Fewer than `samples` means the pool's ceiling is small enough that some resamples had none at all,
   * which is information about the pool rather than about the selector. The interval, when reported, is
   * over these resamples.
   */
  readonly usableResamples: number;
};

/**
 * A deterministic stream, so a replay of the same artefact returns the same interval.
 *
 * The project's rule everywhere else: a number that moves between two readings of one file is not a
 * measurement of the file.
 */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ratio = (selected: number, first: number, oracle: number): number | null =>
  oracle - first > 0 ? (selected - first) / (oracle - first) : null;

function rate(cases: readonly WidthCase[], pick: (row: WidthCase) => boolean): number {
  if (cases.length === 0) return 0;
  return cases.filter(pick).length / cases.length;
}

/**
 * The share a selector captures, with a paired bootstrap over questions.
 *
 * `samples` is 10,000 by default because the quantity is a ratio of two differences on the same
 * questions and a thousand resamples puts a visible wobble in the second decimal. `seed` is fixed so two
 * readings of one artefact agree.
 *
 * A resample whose ceiling is not positive is **dropped and counted**, not clamped: treating it as a
 * share of zero would report a selector that captured a ceiling which did not exist, and clamping it to
 * one would report the opposite. Reporting `usableResamples` is how a reader sees that the interval rests
 * on fewer than all of them.
 */
export function widthShare(
  cases: readonly WidthCase[],
  options: { readonly samples?: number; readonly seed?: number } = {},
): WidthShare {
  const first = rate(cases, (row) => row.first);
  const selected = rate(cases, (row) => row.selected);
  const oracle = rate(cases, (row) => row.oracle);
  const share = ratio(selected, first, oracle);
  const base: Omit<WidthShare, 'interval' | 'usableResamples'> = {
    n: cases.length,
    first,
    selected,
    oracle,
    share,
    ceilingPp: (oracle - first) * 100,
    capturedPp: (selected - first) * 100,
  };
  if (cases.length === 0) return { ...base, interval: null, usableResamples: 0 };

  const samples = Math.max(1, Math.floor(options.samples ?? 10_000));
  const random = mulberry32(options.seed ?? 20_260_111);
  const shares: number[] = [];
  for (let at = 0; at < samples; at += 1) {
    const drawn: WidthCase[] = [];
    for (let picked = 0; picked < cases.length; picked += 1) {
      drawn.push(cases[Math.floor(random() * cases.length)] as WidthCase);
    }
    const resampled = ratio(
      rate(drawn, (row) => row.selected),
      rate(drawn, (row) => row.first),
      rate(drawn, (row) => row.oracle),
    );
    if (resampled !== null) shares.push(resampled);
  }
  // The share and its interval are reported together or not at all. When the pool's own ceiling is zero
  // the point estimate is already `null`, and an interval around a quantity that does not exist would be
  // the one number in this package carrying a confidence it cannot have. A pool with a *small* ceiling
  // needs no special case: the bootstrap returns a correspondingly wide interval, which is the honest
  // description of a ratio whose denominator is nearly nothing.
  if (share === null || shares.length === 0) {
    return { ...base, interval: null, usableResamples: shares.length };
  }
  const sorted = [...shares].sort((left, right) => left - right);
  const at = (quantile: number): number =>
    sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(quantile * (sorted.length - 1))))] as number;
  return { ...base, interval: { low: at(0.025), high: at(0.975) }, usableResamples: shares.length };
}

/**
 * The questions two artefacts share, kept in the first artefact's order.
 *
 * R68's readback has to intersect its question ids with R67's before computing anything: the two
 * dispatches scored the same 350-question slice, but a sampling run can lose a question to a provider
 * failure, and a share computed over two different populations would compare a selector on one set of
 * questions against a ceiling on another.
 */
export function sharedCases(
  primary: readonly WidthCase[],
  other: readonly WidthCase[],
): readonly WidthCase[] {
  const seen = new Set(other.map((row) => row.id));
  return primary.filter((row) => seen.has(row.id));
}
