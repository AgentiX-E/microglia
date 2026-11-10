/**
 * How much of a question a pack actually talks about.
 *
 * R72's hypothesis is that memory's *sign* is a routing property: a pack that shares the question's
 * vocabulary helps, and a pack that does not costs a question that would otherwise have been right.
 * The quantity it routes on is this file, and the reason it is a module rather than four lines in a
 * script is that the number it produced has to be re-derivable after the registration is written.
 *
 * Two choices here are load-bearing and both were found the hard way.
 *
 * **The pack is the text that was injected, not the items it came from.** The artefact records the
 * rendered pack per question (`injected`), and it also records a store of items keyed by id. Reading
 * the store instead looks equivalent and is not: a store item's `statement` is whatever that item's
 * content was in the fold that wrote the snapshot, and the text actually injected under that id came
 * from a different fold. Reconstructing the pack from `packIdList` scores questions against text
 * nobody was shown, and it does not merely add noise — on R66's dev artefact it reverses the gradient
 * (+0 / +5 / −7 flips instead of −9 / −1 / +8), because an unrelated statement has no overlap with the
 * question, so the "low overlap" tercile fills up with questions whose pack was in fact on topic.
 *
 * **Function words and one-character tokens are dropped; longer content words are not stemmed.**
 * Overlap is measured against the question *and* its evidence: BIRD's evidence is a hint written in
 * the corpus's own vocabulary (`Free Meal Count (K-12)`), and a pack that repeats it is on topic
 * whether or not it repeats the question's phrasing.
 */
const FUNCTION_WORDS = new Set(
  `a an the of in on at to for from by with without into over under and or but if then than that this
   these those is are was were be been being does do did not no it its as about per what which who whom
   whose how many much more most less least all any each other such same so can could should would will
   may might must have has had there their them they we you i he she his her our your`
    .split(/\s+/)
    .filter((word) => word !== ''),
);

/**
 * The words an overlap is computed over.
 *
 * Two characters rather than `contentWordsOf`'s four: this is the estimator R72's registered numbers
 * were measured with, and a stricter tokenizer would silently re-score the gradient the file quotes.
 * `content-signal.ts` is deliberately different — it matches question words against *column names*, a
 * domain where `id` and `day` are exactly the tokens that must not match.
 */
export function overlapWordsOf(text: string): readonly string[] {
  const words: string[] = [];
  for (const token of text.toLowerCase().split(/[^a-z0-9_]+/)) {
    if (token.length < 2) continue;
    if (FUNCTION_WORDS.has(token)) continue;
    if (/^[0-9]+$/.test(token)) continue;
    words.push(token);
  }
  return words;
}

/**
 * The share of the question's vocabulary the pack's text accounts for.
 *
 * `0` for a question with no content words and for an empty pack, which are the same answer to a
 * router that only injects above a threshold: nothing was said about it.
 */
export function packOverlapOf(
  pack: readonly string[],
  question: string,
  evidence: string | null | undefined,
): number {
  const base = new Set([...overlapWordsOf(question), ...overlapWordsOf(evidence ?? '')]);
  if (base.size === 0) return 0;
  const said = new Set(overlapWordsOf(pack.join(' ')));
  let shared = 0;
  for (const word of base) if (said.has(word)) shared += 1;
  return shared / base.size;
}

/**
 * The threshold the arm injects above, from the cross-fitted choices on R66's dev artefact.
 *
 * Registered as **0.38** rather than the 0.34 the file froze, and the difference is not a rounding:
 * 0.34 was a median taken with an estimator that read the item store, and re-derived with the committed
 * estimator above the five cross-fitted choices are 0.38, 0.38, 0.39, 0.39, 0.38. The region replicates
 * (inside the registered 0.32–0.43) and its median moves by 0.04, which is enough to change the share
 * of questions a gate withholds from 67% to **70.4%** — outside the registration's own 30–70%
 * instrument band.
 */
export const OVERLAP_THRESHOLD = 0.38;

/**
 * The second registered threshold, chosen inside the instrument band rather than at the optimum.
 *
 * 0.30 withholds about a third of the questions. It exists because at 0.38 the gate withholds seven in
 * ten, and a router that withholds seven in ten is nearly "do not inject memory" — a different
 * experiment from the one the registration describes. Measuring both is how the file stops having to
 * choose between its own optimum and its own instrument band.
 */
export const OVERLAP_ROUTED_THRESHOLD = 0.3;

/** One question's contribution to the routing table. */
export type OverlapRow = {
  readonly overlap: number;
  readonly gained: boolean;
  readonly lost: boolean;
};

/**
 * The tercile table R72 quoted, computed from rows rather than from a notebook.
 *
 * Returns the three terciles in order plus the whole-population net, because the registration's claim is
 * about the low tercile and the whole-split number is the thing that has repeatedly been mistaken for
 * it.
 */
export function overlapTerciles(rows: readonly OverlapRow[]): {
  readonly all: { readonly n: number; readonly net: number; readonly per100: number };
  readonly terciles: readonly {
    readonly name: 'low' | 'middle' | 'high';
    readonly mean: number;
    readonly n: number;
    readonly net: number;
    readonly per100: number;
  }[];
  readonly withheldShare: readonly { readonly threshold: number; readonly share: number }[];
} {
  const sorted = [...rows].sort((left, right) => left.overlap - right.overlap);
  const third = Math.floor(sorted.length / 3);
  const bounds: readonly (readonly ['low' | 'middle' | 'high', number, number])[] = [
    ['low', 0, third],
    ['middle', third, 2 * third],
    ['high', 2 * third, sorted.length],
  ];
  const netOf = (segment: readonly OverlapRow[]): number =>
    segment.reduce((sum, row) => sum + (row.gained ? 1 : 0) - (row.lost ? 1 : 0), 0);
  return {
    all: {
      n: sorted.length,
      net: netOf(sorted),
      per100: sorted.length === 0 ? 0 : (netOf(sorted) / sorted.length) * 100,
    },
    terciles: bounds.map(([name, low, high]) => {
      const segment = sorted.slice(low, high);
      const mean =
        segment.length === 0 ? 0 : segment.reduce((sum, row) => sum + row.overlap, 0) / segment.length;
      const net = netOf(segment);
      return {
        name,
        mean,
        n: segment.length,
        net,
        per100: segment.length === 0 ? 0 : (net / segment.length) * 100,
      };
    }),
    withheldShare: [OVERLAP_ROUTED_THRESHOLD, OVERLAP_THRESHOLD].map((threshold) => ({
      threshold,
      share:
        sorted.length === 0
          ? 0
          : sorted.filter((row) => row.overlap < threshold).length / sorted.length,
    })),
  };
}

/**
 * The cross-fitted threshold: choose on four folds, apply to the fifth, one choice per fold.
 *
 * Written here rather than in the registration's prose because "the region replicates" is a claim about
 * arithmetic, and the arithmetic is the part that has to survive a change of estimator. The grid is
 * every hundredth from 0 to 0.80 and ties go to the *higher* threshold, so a gate that withholds less at
 * equal net is preferred — the file's own preference, since a gate that withholds everything is not a
 * router.
 */
export function crossFittedThresholds(
  rows: readonly (OverlapRow & { readonly fold: number })[],
  options: { readonly step?: number; readonly ceiling?: number } = {},
): readonly { readonly fold: number; readonly threshold: number; readonly trainNet: number; readonly testNet: number; readonly baselineTestNet: number }[] {
  const step = options.step ?? 0.01;
  const ceiling = options.ceiling ?? 0.8;
  const grid: number[] = [];
  for (let value = 0; value <= ceiling + step / 2; value += step) grid.push(Number(value.toFixed(2)));
  const netOf = (segment: readonly OverlapRow[], threshold: number): number => {
    let net = 0;
    for (const row of segment) {
      if (row.overlap < threshold) continue;
      net += (row.gained ? 1 : 0) - (row.lost ? 1 : 0);
    }
    return net;
  };
  const folds = [...new Set(rows.map((row) => row.fold))].sort((left, right) => left - right);
  return folds.map((fold) => {
    const train = rows.filter((row) => row.fold !== fold);
    const test = rows.filter((row) => row.fold === fold);
    let threshold = 0;
    let trainNet = Number.NEGATIVE_INFINITY;
    for (const candidate of grid) {
      const net = netOf(train, candidate);
      if (net > trainNet || (net === trainNet && candidate > threshold)) {
        threshold = candidate;
        trainNet = net;
      }
    }
    return {
      fold,
      threshold,
      trainNet,
      testNet: netOf(test, threshold),
      baselineTestNet: netOf(test, 0),
    };
  });
}
