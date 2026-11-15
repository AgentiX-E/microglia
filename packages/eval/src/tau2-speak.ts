/**
 * The line a run's log carries about whether its memory chose to speak.
 *
 * R121 taught the shape of this failure twice in one dispatch. The consolidation census printed
 * `merged: 0` without the pair population it was zero over, and `served 162 of 162` printed a default as
 * a coverage figure because at floor 0 no request could be refused. Both are the same defect: a number
 * whose denominator was never asked to be anything, printed where every reader treats it as a result.
 *
 * So this line states the point the gate ran at, then partitions the requests the facade saw:
 *
 *   `recalls` = served + withheld + failed
 *
 * with the withheld ones bucketed by the reason the facade reported (`no-leader`,
 * `uncorroborated-store`, `unattributed`). A run at margin 0 that reports `withheld 0` is a **finding**
 * — the gate was open and nothing was contested — while a run at margin 0.05 that reports the same is a
 * wiring defect, and the two are indistinguishable without this line.
 *
 * ## Why `unattributed` is a bucket rather than a remainder
 *
 * A facade that answered with no pack and no reason is one this driver cannot explain. Folding those
 * into `no-leader` would credit the gate with silences it did not choose; folding them into a remainder
 * would let them vanish from a total that is supposed to partition. The bucket is named for the fact a
 * reader has to act on.
 */

/** What the driver's own counters said about one phase's recall traffic. */
export type RecallTraffic = {
  readonly recalls: number;
  readonly recall_failures: number;
  readonly recall_empty: number;
  readonly silent_because: Readonly<Record<string, number>>;
};

/** One line, computed from two numbers the artefact already carries. */
export function speakLineOf(margin: number, traffic: RecallTraffic | null | undefined): string {
  const point =
    margin === 0
      ? 'margin 0 (the default: every non-empty pack is served)'
      : `margin ${String(margin)} (a pack is withheld when its top two candidates are closer than this)`;

  // `null` and `undefined` are the same fact here -- the phase reported no counters -- and both are
  // distinct from a phase that reported zeroes, which is why the check is on presence and not on
  // emptiness.
  if (traffic === undefined || traffic === null) {
    return `speak: ${point}; the phase kept no request count, so this run cannot say how many packs the gate withheld`;
  }

  const failed = traffic.recall_failures;
  const empty = traffic.recall_empty;
  const served = traffic.recalls - empty - failed;
  const reasons = traffic.silent_because;
  const named = Object.keys(reasons)
    .sort()
    // The key came from `Object.keys(reasons)`, so the lookup cannot miss: a `?? 0` here would be a
    // branch no input can reach, which is the shape this record deletes rather than exempts.
    .map((reason) => `${reason} ${String(reasons[reason])}`)
    .join(', ');

  // The partition is printed as arithmetic rather than as prose, so a reader can check it against the
  // artefact's own fields: `served + withheld + failed` must equal `recalls`, and a line that does not
  // add up is a counter that counted something twice.
  return `speak: ${point}; ${String(traffic.recalls)} request(s) reached the facade, ${String(served)} served, ${String(empty)} withheld${named === '' ? '' : ` (${named})`}, ${String(failed)} failed`;
}
