/**
 * What the pack served, and — for the first time in this lane — what it refused.
 *
 * `meanPackIds` has been in every L4 artefact since R45 and it cannot tell two states apart: a request
 * whose store had nothing relevant, and a request whose best item was recalled and then dropped by the
 * renderer because it did not fit the character budget. The second state is not hypothetical. R88 wrote
 * records under a 2,000-character ceiling while the pack stayed at 1,200, and at 1,200 a record in this
 * arm's shape can state 810 characters: `maxStatementChars` measures it, and
 * `eval/tools/record_length_census.py` puts 41.2% of the retail corpus above 810. Every one of those is
 * retrieved, ranked, dropped, and then read as "nothing was relevant".
 *
 * So the census splits the empty case and counts the drops beside the serves. Nothing here changes what
 * is served — a loss that is counted is still a loss — it makes the loss a number a registration can be
 * graded on rather than a property of a reader's imagination.
 *
 * Three decisions worth stating:
 *
 * **The mean is `null`, not zero, over no request.** The same defect as the four absences already
 * repaired in this lane: `0 of 0` prints as a rate and reads as a failure, when what happened is that
 * the question was never asked.
 *
 * **The budget and the capacity travel with the counts.** `droppedForSize` is only interpretable
 * against them: three drops at `budget 2400 / capacity 2010` are a different finding from three at
 * `budget 1200 / capacity 810`, and an artefact that carried the count without the pair would leave the
 * reader to reconstruct which pack produced it.
 *
 * **A drop is not an error.** A ceiling above the capacity is a legitimate choice — the write side may
 * prefer complete records for the tasks that can carry them — and it is the census's job to price that
 * choice rather than to refuse it.
 */
import type { FoldSupport, KnowledgePack } from '@agentix-e/microglia-core';

/**
 * The pack budget every published arm ran with, and the default an arm that states none inherits.
 *
 * Named here rather than written twice: the driver reads it as the fallback for `TAU_PACK_BUDGET` and
 * `prereg-caps` quotes the capacity it implies, and a registration check that assumed a different
 * default from the lane would grade a pack nobody ran.
 */
export const DEFAULT_PACK_BUDGET = 1200;

/**
 * The fields the census reads. Narrowed so a synthetic pack in a test is a pack.
 *
 * `fold` is optional because most packs do not carry one: only a host that declared a shape extractor
 * produces it, and a reading without it is a pack whose unit nobody varied rather than a pack that
 * folded nothing.
 */
export type PackReading = Pick<KnowledgePack, 'ids' | 'truncated' | 'rendered'> &
  Pick<Partial<KnowledgePack>, 'fold'>;

export type PackCensus = {
  /** Characters of knowledge the pack was allowed, as it rendered them. */
  readonly budget: number;
  /**
   * The longest statement one item in this arm's shape can state and still render, or absent.
   *
   * Absent rather than zero for the arms whose item shape is the distiller's: a claim's line is as long
   * as the model's payload made it, so there is no single capacity to quote — and quoting the record
   * arm's would be a number about a different item, which is the defect `maxStatementChars` exists to
   * stop one level up.
   */
  readonly capacity: number | null;
  readonly requests: number;
  readonly filled: number;
  readonly empty: number;
  /** Packs that had at least one candidate and rendered none of them: empty because of the budget. */
  readonly emptiedBySize: number;
  /** Items the renderer refused for length, whether or not the pack still served another. */
  readonly droppedForSize: number;
  /**
   * The means, or absent when no request was made.
   *
   * One field rather than two nullable numbers, so the absence has one representation and the reader
   * cannot print a mean over nothing: `0 of 0` reads as a rate and is the failure mode this lane has
   * repaired four times already.
   */
  readonly summary: { readonly meanIds: number; readonly meanChars: number } | null;
  /**
   * What the fold did, over the packs that carried one.
   *
   * R109's readback channel. The counts are sums over requests and the support figure is a distribution
   * over the *units actually rendered*, because that is the object the competitor's `sup2`/`sup3` cells
   * are counted in and the one number this arm can move.
   */
  readonly fold: FoldCensus | null;
};

/** The fold, aggregated over a run's requests. `null` when no pack carried one. */
export type FoldCensus = {
  /** Packs that carried a shape census. */
  readonly packs: number;
  /** Units the fold removed across the run. */
  readonly folded: number;
  /** Groups that folded. */
  readonly groups: number;
  /** Groups of ≥2 members that did not fold because their distinct tasks fell short. */
  readonly refused: number;
  /** Rendered units across those packs, the denominator of the two shares below. */
  readonly units: number;
  /** Units taught by ≥2 and ≥3 tasks, summed over packs. */
  readonly atLeastTwo: number;
  readonly atLeastThree: number;
  /** The largest support any single rendered unit carried. */
  readonly max: number;
};

/**
 * The fold, summed over the packs that reported one.
 *
 * Sums rather than means: a mean over requests would make a store's recurrence depend on how many times
 * it was asked, and the question here is what the store could express, not how often it was consulted.
 */
export function foldCensus(readings: readonly PackReading[]): FoldCensus | null {
  const folded = readings.filter((pack) => pack.fold !== undefined);
  if (folded.length === 0) return null;
  let foldedItems = 0;
  let groups = 0;
  let refused = 0;
  let units = 0;
  let atLeastTwo = 0;
  let atLeastThree = 0;
  let max = 0;
  for (const pack of folded) {
    const fold = pack.fold as { readonly folded: number; readonly groups: readonly unknown[]; readonly refused: number; readonly support: FoldSupport };
    foldedItems += fold.folded;
    groups += fold.groups.length;
    refused += fold.refused;
    units += pack.ids.length;
    atLeastTwo += fold.support.atLeastTwo;
    atLeastThree += fold.support.atLeastThree;
    if (fold.support.max > max) max = fold.support.max;
  }
  return { packs: folded.length, folded: foldedItems, groups, refused, units, atLeastTwo, atLeastThree, max };
}

export function packCensus(
  readings: readonly PackReading[],
  options: { readonly budget: number; readonly capacity: number | null },
): PackCensus {
  const requests = readings.length;
  const empty = readings.filter((pack) => pack.ids.length === 0).length;
  const total = readings.reduce((sum, pack) => sum + pack.ids.length, 0);
  const chars = readings.reduce((sum, pack) => sum + pack.rendered.length, 0);
  return {
    budget: options.budget,
    capacity: options.capacity,
    requests,
    filled: requests - empty,
    empty,
    // The state `meanPackIds` cannot see: candidates existed and every one of them was too long.
    emptiedBySize: readings.filter((pack) => pack.ids.length === 0 && pack.truncated > 0).length,
    droppedForSize: readings.reduce((sum, pack) => sum + pack.truncated, 0),
    summary: requests === 0 ? null : { meanIds: total / requests, meanChars: chars / requests },
    fold: foldCensus(readings),
  };
}

/**
 * One line for the run log.
 *
 * The share comes first and the drop second, in that order, because a line that led with the drop would
 * be read as a fault report on a run that may be serving everything it can — and a line that omitted it
 * would be read as a pack with nothing to report, which is the state this census was built to end.
 */
export function packLineOf(census: PackCensus): string {
  const capacity =
    census.capacity === null
      ? 'capacity absent (the arm\'s item shape is the distiller\'s)'
      : `capacity ${String(census.capacity)} chars/record`;
  const head = `pack: budget ${String(census.budget)}, ${capacity}`;
  const summary = census.summary;
  if (summary === null) return `${head}; absent (no recall request)`;
  // R109's line, printed only when a pack carried the census: a run whose host cannot name a shape has
  // nothing to say about units, and printing `folded 0` there would be the reading this arm exists to
  // separate from a fold that ran and found nothing.
  const fold = census.fold;
  const foldLine =
    fold === null
      ? ''
      : `; fold ${String(fold.folded)} of ${String(fold.folded + fold.units)} units ` +
        `(${String(fold.groups)} groups, ${String(fold.refused)} refused for want of a second task), ` +
        `support ≥2 ${String(fold.atLeastTwo)}, ≥3 ${String(fold.atLeastThree)}, max ${String(fold.max)}`;
  return (
    `${head}; served ${String(census.filled)} of ${String(census.requests)} ` +
    `(mean ${summary.meanIds.toFixed(1)} items, ${summary.meanChars.toFixed(0)} chars); ` +
    `dropped for size ${String(census.droppedForSize)}, of which ${String(census.emptiedBySize)} emptied a pack` +
    foldLine
  );
}

/**
 * The ceiling against the pack, stated at the write rather than discovered at the read.
 *
 * This is the one sentence the two numbers needed and neither lane had. A ceiling above the pack's
 * capacity is a decision to write records that will be dropped at render, and it is a decision a
 * registration is allowed to make — the cost of raising the budget instead is context on every request.
 * What is not allowed is making it silently: the run says which of the two regimes it is in before the
 * first episode is paid for.
 */
export const CEILING_FITS = 'fits';
export const CEILING_ABOVE_PACK = 'above-pack';
export const CEILING_ABSENT = 'absent';

export type CeilingVerdict = typeof CEILING_FITS | typeof CEILING_ABOVE_PACK | typeof CEILING_ABSENT;

export function ceilingVerdictOf(input: {
  readonly ceiling: number | undefined;
  readonly capacity: number;
}): CeilingVerdict {
  if (input.ceiling === undefined) return CEILING_ABSENT;
  return input.ceiling <= input.capacity ? CEILING_FITS : CEILING_ABOVE_PACK;
}

export function ceilingLineOf(input: {
  readonly ceiling: number | undefined;
  readonly budget: number;
  readonly capacity: number;
}): string {
  const { ceiling } = input;
  if (ceiling === undefined) {
    return `ceiling absent (the module default stands; capacity ${String(input.capacity)} at budget ${String(input.budget)})`;
  }
  // Narrowed before the verdict rather than after it: the verdict distinguishes three states, and the
  // line for the third needs the ceiling as a number. Deciding the same question twice — once to pick a
  // line, once to unwrap a value — is how the two answers drift.
  if (ceilingVerdictOf(input) === CEILING_FITS) {
    return `ceiling ${String(ceiling)} fits budget ${String(input.budget)} (capacity ${String(input.capacity)} chars/record)`;
  }
  return (
    `ceiling ${String(ceiling)} is above budget ${String(input.budget)}: capacity is ` +
    `${String(input.capacity)} chars/record, so up to ${String(ceiling - input.capacity)} characters of a record are ` +
    'written and never rendered — raise the budget or lower the ceiling'
  );
}
