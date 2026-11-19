/**
 * The most a fold could possibly have shown, and whether that is enough to say anything.
 *
 * ## The number nobody in this record computed
 *
 * Four dispatches have come back `UNRESOLVED`, and each was read as a fact about the item, the floor, the
 * margin, the content or the allocation. None of those readings asked the prior question: **what is the
 * largest delta this fold could have produced?** A memory can only repair a task the control failed, so on a
 * fold where the control passes 34 of 40 tasks, the largest possible delta is +15.00pp — a store that
 * repairs every failure and breaks nothing. Anything above that is not a bigger effect, it is an arithmetic
 * error.
 *
 * Compare that ceiling with the fold's own resolution and the four red rows explain themselves:
 *
 * | fold | n | control `pass^4` | ceiling | minimum detectable | ceiling − MDE |
 * | --- | --- | --- | --- | --- | --- |
 * | `official` (committed) | 40 | 0.900 | **10.00pp** | 18.53pp | −8.53pp |
 * | `official-swapped` (committed) | 74 | 0.8514 | **14.86pp** | 17.76pp | −2.90pp |
 * | R152 `official` | 40 | 0.850 | **15.00pp** | 15.66pp | −0.66pp |
 * | R152c `official` | 40 | 0.850 | **15.00pp** | 23.23pp | −8.23pp |
 *
 * **Every fold this lane has ever run has a ceiling below its own resolution.** An oracle store — one that
 * repairs all six failures and breaks nothing — would still have been reported as an effect this design
 * could not resolve, and `V5-resolution` would still have blocked it for claiming 15pp against a 15.66pp
 * resolution. That is not a statement about any store. It is a statement about the fold.
 *
 * ## Why significance and resolution part company here
 *
 * The ceiling is reachable in the sense that a `p` value can fall: six discordant pairs, all in one
 * direction, give p = 0.0156. So an oracle store would be *significant* and still *unresolved*, because the
 * resolution predicate is about the size of the point estimate, not its p value. Both statements are true of
 * the same reading, which is why the record needed `l4-effect-resolved` to be about `|delta|` rather than
 * about `state` (AUDIT 34.197). A significant 15pp whose 95% interval is [3, 27] has not established a 6pp
 * mechanism; it has established that something happened, on six tasks.
 *
 * ## What it is for
 *
 * A fold is a design, and this is the check a design owes before it is dispatched: **can this fold express
 * the effect I am looking for?** The answer depends on two numbers that are known before the dispatch — the
 * control's pass rate (from an earlier fold of the same split) and the pair's expected discordance — and it
 * is cheaper to compute than to buy. R143's pooled fold is the first in this record whose ceiling clears its
 * resolution (14.0pp against 13.24pp, and only barely), which is why the next reading has to be pooled or
 * on a harder corpus rather than a fifth 40-task draw.
 */

export type FoldHeadroomInput = {
  /** Tasks both arms scored. The denominator of both numbers below. */
  readonly paired: number;
  /** The control arm's `pass^4`: the share of those tasks the memory-free agent already passed. */
  readonly controlPass4: number;
  /** The pair's minimum detectable difference in percentage points, when one was estimated. */
  readonly detectablePp: number | undefined;
};

export type FoldHeadroom = {
  readonly paired: number;
  /** Tasks the control passed, rounded from the share because a task is not divisible. */
  readonly controlPasses: number;
  /** Tasks the control failed: the only population a repair can come from. */
  readonly failures: number;
  /** The largest delta this fold could produce, in percentage points. */
  readonly ceilingPp: number;
  readonly detectablePp: number | undefined;
  /**
   * Whether the ceiling reaches the fold's own resolution.
   *
   * `unknown` when no resolution was estimated: a fold that cannot say how fine it can see cannot be said to
   * see far enough, and guessing either way would be the default this record keeps removing.
   */
  readonly verdict: 'expressible' | 'silent' | 'unknown';
};

export function foldHeadroom(input: FoldHeadroomInput): FoldHeadroom {
  if (!Number.isInteger(input.paired) || input.paired <= 0) {
    throw new Error('paired must be a positive integer: a fold with no tasks is not a fold');
  }
  if (!(input.controlPass4 >= 0 && input.controlPass4 <= 1)) {
    throw new Error('controlPass4 must be a share between 0 and 1');
  }
  const controlPasses = Math.round(input.controlPass4 * input.paired);
  const failures = input.paired - controlPasses;
  const ceilingPp = (failures / input.paired) * 100;
  const verdict =
    input.detectablePp === undefined
      ? 'unknown'
      : ceilingPp >= input.detectablePp
        ? 'expressible'
        : 'silent';
  return { paired: input.paired, controlPasses, failures, ceilingPp, detectablePp: input.detectablePp, verdict };
}

/** The one line a pair prints about what its fold could have shown. */
export function headroomLine(headroom: FoldHeadroom): string {
  const resolution =
    headroom.detectablePp === undefined
      ? 'no resolution estimate'
      : `${headroom.detectablePp.toFixed(2)}pp minimum detectable`;
  const tail =
    headroom.verdict === 'expressible'
      ? 'a perfect store would have cleared it'
      : headroom.verdict === 'silent'
        ? 'a perfect store would still have read as unresolved — the fold, not the store, is the constraint'
        : 'so whether this fold could express an effect is unmeasured rather than answered';
  return (
    `headroom: the control passed ${String(headroom.controlPasses)} of ${String(headroom.paired)}, ` +
    `so the largest possible delta is ${headroom.ceilingPp.toFixed(2)}pp against ${resolution}: ${tail}`
  );
}
