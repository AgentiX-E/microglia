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

/**
 * The arm a share divides by when the caller does not name one.
 *
 * `sample-5-exec` is what R67, R68 and R70 all bought, so every published share in this repository is
 * that arm. It is a default and not an assumption: the reading still refuses a question that does not
 * carry the arm (see `widthCases`), so an artefact with no `exec` arm reports "no question carries all
 * three" and lists what it did buy.
 */
export const DEFAULT_SELECTED_ARM = 'sample-5-exec';

/** Where a width reading takes its three answers from. */
export type WidthArguments = {
  /** The artefact to read, or `null` to let the caller fall back to `chooseArtefact`. */
  readonly bird: string | null;
  /** The artefact to intersect the question ids with before computing anything. */
  readonly with: string | null;
  /** The arm whose picks are `selected`, and whether the caller named it or this module defaulted it. */
  readonly selected: { readonly arm: string; readonly explicit: boolean };
};

/**
 * The command line a width reading accepts, parsed strictly and in one place.
 *
 * This lives here rather than in the CLI because the CLI is excluded from coverage by the package's own
 * rule — "the logic they call lives in the package and is covered there" — and an argument parser that
 * nothing tests is how `pool.ts` came to accept `--bird`, ignore it, and describe a different file.
 *
 * Three decisions are worth their lines:
 *
 * - **An unknown flag is an error, not a fallback.** The caller has written something the program does
 *   not understand; guessing which file they meant is the failure this parser exists to prevent.
 * - **A flag with no value is an error even when a later argument exists.** `--bird --with b.json` would
 *   otherwise read a path called `--with`, and then silently ignore `b.json`.
 * - **A repeated flag is an error.** Two `--bird`s are two answers to one question, and picking either
 *   one is picking for the caller.
 */
export function widthArguments(argv: readonly string[]): WidthArguments {
  let bird: string | null = null;
  let withPath: string | null = null;
  let selected: string | null = null;
  const flags = ['--bird', '--with', '--selected'] as const;
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index] as string;
    if (!(flags as readonly string[]).includes(flag)) {
      throw new Error(
        `unrecognised argument ${flag}: this reading takes --bird <artefact>, --with <artefact> and --selected <arm>`,
      );
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(
        flag === '--selected'
          ? '--selected needs an arm name, for example --selected sample-5-assert'
          : `${flag} needs a path, and the next argument is another flag`,
      );
    }
    index += 1;
    if (flag === '--bird') {
      if (bird !== null) throw new Error('--bird given twice, so there is no single artefact to read');
      bird = value;
    } else if (flag === '--with') {
      if (withPath !== null) throw new Error('--with given twice, so there is no single population');
      withPath = value;
    } else {
      if (selected !== null) throw new Error('--selected given twice, so there is no single arm');
      selected = value;
    }
  }
  return {
    bird,
    with: withPath,
    selected: { arm: selected ?? DEFAULT_SELECTED_ARM, explicit: selected !== null },
  };
}

/**
 * Why a named arm cannot be the one this reading divides by, or `null` when it can.
 *
 * Only an **explicitly named** arm is checked. The default is not: a directory scan can land on an
 * artefact that never bought `sample-5-exec`, and that invocation is expected to report "no question
 * carries all three" with the arms it did buy — a second, differently worded error for the same
 * condition would be noise. A caller who typed an arm name has asserted something, and an artefact that
 * does not contain that arm can contradict it.
 */
export function selectedArmProblem(arm: string, bought: readonly string[]): string | null {
  if (bought.includes(arm)) return null;
  return `this artefact did not buy '${arm}'; it bought ${bought.join(', ') || 'nothing recorded'}`;
}

/** The three marks a share needs from one question, keyed by the arm names the artefact uses. */
export type WidthArmNames = {
  readonly first: string;
  readonly selected: string;
  readonly oracle: string;
};

/**
 * The questions that carry all three marks, keyed by the arm names this run actually bought.
 *
 * A question missing any of the three is excluded rather than defaulted: `false` is a scored wrong answer
 * for every arm, so a missing mark that became `false` would depress all three rates equally and shrink
 * the denominator the share divides by — a silent change to the population rather than a refusal.
 */
export function widthCases(
  rows: readonly WidthRow[],
  arms: WidthArmNames,
  options: WidthCaseOptions = {},
): readonly WidthCase[] {
  const cases: WidthCase[] = [];
  for (const row of rows) {
    if (row.id === null || row.id === undefined) continue;
    const marks = row.marks;
    if (marks === undefined) continue;
    const id = String(row.id);
    const first = marks[arms.first];
    const selected = marks[arms.selected];
    // The ceiling comes from the oracle arm when the run bought one, and from the recorded pool when it
    // did not. Both answer "did any draw get this right"; a registration that names no oracle arm is not
    // a run that cannot report its ceiling, and R80 is exactly that case.
    const oracle = marks[arms.oracle] ?? options.oracleFrom?.get(id);
    if (first === undefined || selected === undefined || oracle === undefined) continue;
    cases.push({ id, first, selected, oracle });
  }
  return cases;
}

/** One `per_case` row as the reading needs it: an id, the arm marks, and the candidates if recorded. */
export type WidthRow = {
  readonly id: string | number | null | undefined;
  readonly marks: Readonly<Record<string, boolean>> | undefined;
  readonly candidates?: readonly { readonly correct: boolean }[] | null | undefined;
};

export type WidthCaseOptions = {
  /**
   * The ceiling per question, read from the pool rather than from an oracle arm.
   *
   * A run records every candidate it bought, so the ceiling — "the best of the draws taken" — is a
   * property of the pool and not of an arm. Reading it from the pool means the ceiling of a past run is
   * still available when that run registered no oracle arm, which is what R80 did: it buys a first draw
   * and a written reader, and the arm that exists only to be quoted in a ratio would have been a third
   * purchase for a number the pool already holds.
   */
  readonly oracleFrom?: ReadonlyMap<string, boolean> | undefined;
};

/**
 * The pool's own ceiling, per question: whether any recorded draw was right.
 *
 * An empty or absent pool contributes nothing rather than `false`. A question whose draws were all
 * dropped has no measured ceiling, and recording it as unanswerable would put a provider failure into
 * the denominator of the share.
 */
export function ceilingFromPool(rows: readonly WidthRow[]): ReadonlyMap<string, boolean> {
  const ceiling = new Map<string, boolean>();
  for (const row of rows) {
    if (row.id === null || row.id === undefined) continue;
    const candidates = row.candidates;
    if (candidates === undefined || candidates === null || candidates.length === 0) continue;
    ceiling.set(
      String(row.id),
      candidates.some((candidate) => candidate.correct === true),
    );
  }
  return ceiling;
}
