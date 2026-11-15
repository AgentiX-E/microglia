import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  CEILING_ABOVE_PACK,
  CEILING_ABSENT,
  CEILING_FITS,
  ceilingLineOf,
  ceilingVerdictOf,
  foldCensus,
  ledgerDiff,
  ledgerLineOf,
  MARGIN_RUNGS,
  packCensus,
  packLineOf,
} from '../tau2-pack.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

/**
 * The pack's own refusals, counted.
 *
 * Every lane reports what it served and nothing reports what it declined to serve. A record that the
 * renderer dropped for size is indistinguishable, in `meanPackIds`, from a record that was never
 * relevant — and the two call for opposite fixes: one is a budget, the other is a retrieval function.
 * These tests hold the split, and the absence that has to stay an absence: a mean over no request is
 * not zero.
 */

const pack = (ids: readonly string[], truncated = 0, chars = 100) => ({
  ids,
  truncated,
  rendered: 'x'.repeat(ids.length === 0 ? 0 : chars),
});

describe('packCensus', () => {
  it('separates a pack emptied by relevance from one emptied by size', () => {
    const census = packCensus([pack([]), pack([], 3), pack(['a']), pack(['a', 'b'])], {
      budget: 1200,
      capacity: 810,
    });
    expect(census.requests).toBe(4);
    expect(census.filled).toBe(2);
    expect(census.empty).toBe(2);
    // The reading this exists for: one of the two empties had candidates and refused all of them.
    expect(census.emptiedBySize).toBe(1);
    expect(census.droppedForSize).toBe(3);
  });

  it('counts an item dropped beside a served one, not only a dropped pack', () => {
    // R88's case: twelve records, one served, some refused. A census that counted only emptied packs
    // would report zero loss on the run where the loss is largest.
    const census = packCensus([pack(['a'], 4), pack(['b'], 1)], { budget: 1200, capacity: 810 });
    expect(census.droppedForSize).toBe(5);
    expect(census.emptiedBySize).toBe(0);
  });

  it('reports a mean over requests, and no summary at all when there was no request', () => {
    // One field, so the absence has one representation: two nullable numbers invite a reader to print a
    // mean over nothing, which is the `0 of 0 (0.0%)` defect this lane has repaired four times.
    expect(packCensus([], { budget: 1200, capacity: 810 }).summary).toBeNull();
    const census = packCensus([pack(['a', 'b'], 0, 900), pack([], 0, 0)], {
      budget: 1200,
      capacity: 810,
    });
    expect(census.summary).toEqual({ meanIds: 1, meanChars: 450 });
  });

  it('carries the budget and the capacity, so the loss is divisible by its cause', () => {
    const census = packCensus([pack(['a'], 1)], { budget: 2400, capacity: 2010 });
    expect(census.budget).toBe(2400);
    expect(census.capacity).toBe(2010);
    expect(census.droppedForSize).toBe(1);
  });

  it('keeps the capacity absent for an arm whose item shape is the distiller\'s', () => {
    // A claim's line is as long as the model made it, so there is no capacity to quote. Zero would be
    // a capacity of zero characters, which is a different and false statement.
    const census = packCensus([pack(['a'])], { budget: 1200, capacity: null });
    expect(census.capacity).toBeNull();
    expect(packLineOf(census)).toContain('capacity absent');
  });

  it('reads a request count of zero as zero requests, not as a zero rate', () => {
    const census = packCensus([], { budget: 1200, capacity: 810 });
    expect(census.requests).toBe(0);
    expect(census.filled).toBe(0);
    expect(census.droppedForSize).toBe(0);
  });
});

describe('packLineOf', () => {
  it('states the served share before the dropped count, so a loss cannot hide behind a mean', () => {
    const line = packLineOf(
      packCensus([pack(['a'], 2), pack([], 1)], { budget: 1200, capacity: 810 }),
    );
    expect(line).toBe(
      'pack: budget 1200, capacity 810 chars/record; served 1 of 2 (mean 0.5 items, 50 chars); ' +
        'dropped for size 3, of which 1 emptied a pack',
    );
  });

  it('says absent rather than zero when no request was made', () => {
    expect(packLineOf(packCensus([], { budget: 1200, capacity: 810 }))).toBe(
      'pack: budget 1200, capacity 810 chars/record; absent (no recall request)',
    );
  });
});

describe('ceilingVerdictOf', () => {
  it('names the two regimes a ceiling can be in, and the third state of not stating one', () => {
    expect(ceilingVerdictOf({ ceiling: undefined, capacity: 810 })).toBe(CEILING_ABSENT);
    expect(ceilingVerdictOf({ ceiling: 700, capacity: 810 })).toBe(CEILING_FITS);
    // The boundary is inclusive: a record exactly as long as the capacity renders.
    expect(ceilingVerdictOf({ ceiling: 810, capacity: 810 })).toBe(CEILING_FITS);
    expect(ceilingVerdictOf({ ceiling: 2000, capacity: 810 })).toBe(CEILING_ABOVE_PACK);
  });
});

describe('ceilingLineOf', () => {
  it('says what a ceiling above the pack costs, in characters rather than in adjectives', () => {
    const line = ceilingLineOf({ ceiling: 2000, budget: 1200, capacity: 810 });
    expect(line).toContain('ceiling 2000 is above budget 1200');
    expect(line).toContain('capacity is 810 chars/record');
    expect(line).toContain('up to 1190 characters');
    expect(line).toContain('raise the budget or lower the ceiling');
  });

  it('says nothing to fix when the ceiling fits, and names the capacity anyway', () => {
    // The capacity is printed in the good case too: a reader comparing two artefacts needs the number
    // that decided, not only the one that complained.
    const line = ceilingLineOf({ ceiling: 700, budget: 1200, capacity: 810 });
    expect(line).toBe('ceiling 700 fits budget 1200 (capacity 810 chars/record)');
  });

  it('reports the module default as absent rather than as a number it did not read', () => {
    expect(ceilingLineOf({ ceiling: undefined, budget: 1200, capacity: 810 })).toBe(
      'ceiling absent (the module default stands; capacity 810 at budget 1200)',
    );
  });
});

/**
 * R109's readback channel: what the fold did to the packs a run served.
 *
 * The counts are sums and not means, because a mean over requests would make a store's recurrence depend
 * on how often it was consulted. The one figure that is not a sum is `max`, the largest support any
 * rendered unit carried — the quantity the competitor's `sup2`/`sup3` cells are counted in.
 */
describe('foldCensus', () => {
  const folded = (foldedItems: number, support: { max: number; atLeastTwo: number; atLeastThree: number }) => ({
    folded: foldedItems,
    groups: Array.from({ length: foldedItems }, () => ({})),
    refused: 0,
    unnamed: 0,
    unnamedIds: [],
    suppressed: 0,
    support,
    items: [],
  });

  it('sums what the fold removed and what the units it kept carry', () => {
    const census = foldCensus([
      { ids: ['a', 'b'], truncated: 0, rendered: 'x', fold: folded(2, { max: 3, atLeastTwo: 2, atLeastThree: 1 }) },
      { ids: ['c'], truncated: 0, rendered: 'y', fold: folded(1, { max: 2, atLeastTwo: 1, atLeastThree: 0 }) },
    ]);
    expect(census).toEqual({
      packs: 2,
      folded: 3,
      groups: 3,
      refused: 0,
      unnamed: 0,
      unnamedItems: 0,
      suppressed: 0,
      units: 3,
      atLeastTwo: 3,
      atLeastThree: 1,
      max: 3,
    });
  });

  it('reports nothing when no pack carried a census, which is not a pack that folded nothing', () => {
    // A host that never declared a shape extractor produces no `fold` field, and a zero here would read
    // as "the fold ran and changed nothing" — the state this whole arm is measured to distinguish.
    expect(foldCensus([{ ids: ['a'], truncated: 0, rendered: 'x' }])).toBeNull();
    expect(foldCensus([])).toBeNull();
  });

  it('counts a pack that carried a census and folded nothing as a reading', () => {
    const census = foldCensus([
      { ids: ['a', 'b'], truncated: 0, rendered: 'x', fold: folded(0, { max: 1, atLeastTwo: 0, atLeastThree: 0 }) },
    ]);
    expect(census).toMatchObject({ packs: 1, folded: 0, units: 2, atLeastTwo: 0, max: 1 });
  });

  it('prints what the fold did, and prints nothing at all when no pack carried one', () => {
    const withFold = packCensus(
      [{ ids: ['a'], truncated: 0, rendered: 'x', fold: folded(3, { max: 3, atLeastTwo: 4, atLeastThree: 1 }) }],
      { budget: 2400, capacity: 810 },
    );
    expect(packLineOf(withFold)).toContain(
      'fold 3 of 4 units (3 groups, 0 refused for want of a second task), support ≥2 4, ≥3 1, max 3',
    );
    const without = packCensus([{ ids: ['a'], truncated: 0, rendered: 'x' }], { budget: 2400, capacity: 810 });
    expect(packLineOf(without)).not.toContain('fold');
  });

  it('separates a store with nothing to fold from a control that folds nothing', () => {
    // R120's registration asked for a non-zero `fold.groups` on the primary arm and could not have got
    // one: the field counts groups that *folded*, and the primary arm's unit never folds. The census
    // printed `0 groups` beside a collapse arm that removed 58 items in one dispatch, and the two
    // numbers were read as contradictory because neither of them was about the same population.
    const control = packCensus(
      [
        {
          ids: ['a', 'b'],
          truncated: 0,
          rendered: 'x',
          fold: {
            items: [],
            folded: 0,
            groups: [],
            refused: 0,
            unnamed: 0,
            suppressed: 2,
            support: { max: 1, atLeastTwo: 0, atLeastThree: 0 },
          },
        },
      ],
      { budget: 2400, capacity: null },
    );
    expect(packLineOf(control)).toContain('0 groups, 2 suppressed by the unit, 0 refused');
    expect(control.fold?.suppressed).toBe(2);
    // A store of one record per routine keeps the old line: the suffix is only printed when it can
    // distinguish two findings, so an artefact written before this count existed still compares.
    const unique = packCensus(
      [{ ids: ['a'], truncated: 0, rendered: 'x', fold: folded(0, { max: 1, atLeastTwo: 0, atLeastThree: 0 }) }],
      { budget: 2400, capacity: null },
    );
    expect(packLineOf(unique)).not.toContain('suppressed');
    // An artefact written before R120 carries no field at all, and a missing count is not a measured
    // zero: it is summed as zero without inventing a reading for a run that never had one.
    const older = foldCensus([
      {
        ids: ['a'],
        truncated: 0,
        rendered: 'x',
        fold: { items: [], folded: 0, groups: [], refused: 0, unnamed: 0, unnamedIds: [], support: { max: 1, atLeastTwo: 0, atLeastThree: 0 } },
      },
    ]);
    expect(older?.suppressed).toBe(0);
  });

  it('names the population the fold could not key, so a zero fold is a finding and not a silence', () => {

    // R120's line is the one this test is about. A run on a distilled store printed `fold 0 of 631 units
    // (0 groups, 0 refused for want of a second task)` and nothing else, and every reader of it — this
    // record included — took it as a property of the store. The count below is what makes the next
    // occurrence self-reporting: `unnamed 79` says the extractor named nothing, which is a defect, while
    // `unnamed 0` with `folded 0` says the store holds one record per routine, which is a finding.
    const blind = packCensus(
      [
        { ids: ['a', 'b', 'c'], truncated: 0, rendered: 'x', fold: { items: [], folded: 0, groups: [], refused: 0, unnamed: 3, suppressed: 0, support: { max: 1, atLeastTwo: 0, atLeastThree: 0 } } },
      ],
      { budget: 2400, capacity: null },
    );
    // R126. An artefact that predates the ids keeps the old wording and says so: `unnamedItems` is `null`
    // and not `0`, because a zero there would claim a store whose records all carry a shape on evidence
    // that only ever counted serves.
    expect(packLineOf(blind)).toContain('0 refused for want of a second task, 3 unnamed');
    expect(blind.fold?.unnamed).toBe(3);
    expect(blind.fold?.unnamedItems).toBeNull();
    // And it is not printed when it is zero, so a store the fold could read keeps the old line byte for
    // byte: an artefact written before this count existed must still compare.
    const readable = packCensus(
      [{ ids: ['a'], truncated: 0, rendered: 'x', fold: folded(0, { max: 1, atLeastTwo: 0, atLeastThree: 0 }) }],
      { budget: 2400, capacity: null },
    );
    expect(packLineOf(readable)).not.toContain('unnamed');
  });

  it('travels on the pack census, so an artefact cannot report one without the other', () => {
    const census = packCensus(
      [{ ids: ['a'], truncated: 0, rendered: 'x', fold: folded(1, { max: 2, atLeastTwo: 1, atLeastThree: 0 }) }],
      { budget: 2400, capacity: 810 },
    );
    expect(census.fold).toMatchObject({ packs: 1, folded: 1, max: 2 });
  });
});

/**
 * The ledger, and the diff two runs of one lane need.
 *
 * R119 and R120 run one lane, one split, one seed, one model, and their scores are 0.600 and 0.750. Neither
 * artefact can say *which packs* differed, because the census kept counts and dropped the ids — so a
 * fifteen-point difference that is larger than every effect this record has reported could not be
 * attributed to a claim even in principle. The ledger is the input that makes the next such pair legible,
 * and the diff is the reading: positions where the two packs are the same, positions where they are not,
 * and how many records entered or left.
 */
describe('the pack ledger', () => {
  it('carries the ids each request was served, in request order', () => {
    const census = packCensus([pack(['a', 'b']), pack(['c'])], { budget: 2400, capacity: null });
    expect(census.ledger).toEqual([['a', 'b'], ['c']]);
  });

  it('counts positions rather than ids, because a repack is not a rewrite', () => {
    const diff = ledgerDiff([['a', 'b'], ['c']], [['a', 'b'], ['d']]);
    expect(diff).toEqual({ requests: 2, identical: 1, differ: 1, entered: 1, left: 1, unpaired: 0 });
  });

  it('reports an unpaired tail rather than treating two phases of different lengths as equal', () => {
    // A stopped run writes fewer requests. Comparing the prefix and calling the rest identical would
    // read a truncated phase as a faithful repeat — the same defect `stoppedRun` exists to make visible.
    const diff = ledgerDiff([['a'], ['b'], ['c']], [['a']]);
    expect(diff).toEqual({ requests: 1, identical: 1, differ: 0, entered: 0, left: 0, unpaired: 2 });
  });

  it('says nothing rather than zero when the artefact predates the ledger', () => {
    // A missing ledger is not an empty one: `identical: 0` on a run that never recorded its packs would be
    // a measurement of the instrument, which is the class of defect R120 found in `fold.groups`.
    expect(ledgerDiff([], [])).toMatchObject({ requests: 0, unpaired: 0 });
    expect(ledgerLineOf(undefined)).toContain('no ledger');
    expect(ledgerLineOf(ledgerDiff([['a']], [['a']]))).toContain('1 of 1 request(s) identical');
    // A repack with nothing left unpaired prints no clause at all rather than `0 unpaired`: the counter's
    // denominator is the requests the two ledgers share, and a zero there is the normal case, not a reading.
    const repacked = ledgerLineOf(ledgerDiff([['a', 'b']], [['a']]));
    expect(repacked).toContain('1 repacked');
    expect(repacked).not.toContain('unpaired');
  });
  // R126. R124 printed `52 unnamed of 697 units` from three records and the reader had no way to see it:
  // `unnamed` sums a per-pack unit count, so it counts serves. Two denominators, printed together, is
  // the whole fix — and the case is written from the run that produced it rather than from a fixture.
  it('reports the items behind a summed render count, which is the number a store is about', () => {
    const keyless = (renders: number) =>
      Array.from({ length: renders }, () => ({
        ids: ['k_1'],
        truncated: 0,
        rendered: 'x',
        fold: {
          items: [],
          folded: 0,
          groups: [],
          refused: 0,
          unnamed: 1,
          unnamedIds: ['k_1'],
          suppressed: 0,
          support: { max: 1, atLeastTwo: 0, atLeastThree: 0 },
        },
      }));
    const census = foldCensus([...keyless(8), ...keyless(17)]);
    expect(census?.unnamed).toBe(25);
    expect(census?.unnamedItems).toBe(1);
    const pack = packCensus(keyless(8), { budget: 2400, capacity: null });
    expect(packLineOf(pack)).toContain('1 item(s) / 8 render(s) unnamed');
  });

  // R127. The ladder is priced on the far side of a socket, and R123a is the run where that side received
  // nothing and reported seven zeros. Two counts of one quantity is the only check that can tell a wire
  // that dropped a field from a store that had nothing to say.
  it('counts the ranking census in this process, beside the count of what was served', () => {
    const pack = (margin: number | null) => ({
      ids: ['k_1'],
      truncated: 0,
      rendered: 'x',
      decision: {
        candidates: 2,
        afterCoverage: 2,
        afterEvidence: 2,
        belowCoverage: 0,
        belowEvidence: 0,
        overLimit: 0,
        topScore: 0.9,
        runnerUpScore: margin === null ? null : 0.9 - margin,
        margin,
        spoke: true,
        silentBecause: null,
      },
    });
    const census = packCensus([pack(0.5), pack(null), { ids: ['k_2'], truncated: 0, rendered: 'y' }], {
      budget: 2400,
      capacity: null,
    });
    expect(census.margins).toMatchObject({
      censused: 2,
      rivaled: 1,
      // R123a's readback needed this and the artefact did not carry it: the ladder was printed to a job log
      // and dropped, so choosing a rung meant downloading 103 KB of log. One rivaled request at 0.5 is
      // withheld by no rung on the ladder, and the three quantiles are that one value.
      ladder: { '0.01': 0, '0.02': 0, '0.05': 0, '0.10': 0, '0.15': 0, '0.20': 0, '0.30': 0 },
      p10: 0.5,
      p50: 0.5,
      p90: 0.5,
    });
    expect(packLineOf(census)).toContain('margins 1 rivaled of 2 censused');
    expect(packLineOf(census)).toContain('p50 0.5000');
    // A phase whose host asked for no census prints nothing rather than a zero: the reader of a `0 rivaled`
    // cannot tell it from the absence R123a mistook for one.
    const silent = packCensus([{ ids: ['k_2'], truncated: 0, rendered: 'y' }], { budget: 2400, capacity: null });
    expect(silent.margins).toMatchObject({ censused: 0, rivaled: 0, p50: null });
    expect(packLineOf(silent)).not.toContain('margins');
    // A census that ran and found **no contest**: one candidate in every pack. The population is printed and
    // the ladder is not, because seven zeros over an empty population would price a rung at nothing when the
    // truth is that no rung applies — the store had no second candidate for a rung to separate.
    const uncontested = packCensus([pack(null), pack(null)], { budget: 2400, capacity: null });
    expect(uncontested.margins).toMatchObject({ censused: 2, rivaled: 0, p50: null });
    expect(packLineOf(uncontested)).toContain('margins 0 rivaled of 2 censused');
    expect(packLineOf(uncontested)).not.toContain('ladder');
  });

  // R123a measured 163 rivaled requests with a median margin of 0.0993 and a rung at 0.05 withholding 49 of
  // them. The three facts have to agree, or the rung a registration names is not the rung the pack runs:
  // `buildPack` withholds on `margin < speakMargin`, so the rung equal to the median withholds exactly the
  // half below it, and a `<=` in either half would move 49 to 50 without failing anything else.
  it('prices each rung with the comparison the pack actually runs', () => {
    const pack = (margin: number) => ({
      ids: ['k_1'],
      truncated: 0,
      rendered: 'x',
      decision: { margin, spoke: true, silentBecause: null },
    });
    const census = packCensus([pack(0.05), pack(0.049), pack(0.2), pack(0.3)], {
      budget: 2400,
      capacity: null,
    });
    // Strict: a margin equal to the rung is served, so the 0.05 request is not withheld at 0.05.
    expect(census.margins.ladder['0.05']).toBe(1);
    expect(census.margins.ladder['0.10']).toBe(2);
    expect(census.margins.ladder['0.30']).toBe(3);
    expect(census.margins.rivaled).toBe(4);
    // Nearest rank over four values: the 10th percentile is the first, the median the second.
    expect(census.margins.p10).toBeCloseTo(0.049, 6);
    expect(census.margins.p50).toBeCloseTo(0.05, 6);
    expect(census.margins.p90).toBeCloseTo(0.3, 6);
  });

  // The ladder is counted on both sides of the socket now (R127 counted `rivaled` there), and two lists that
  // drift are worse than one list: the artefact would price seven rungs the Python half never prices, and the
  // difference would show up as two unequal ladders in one artefact rather than as a failure.
  it('prices the same seven rungs the Python half prices', () => {
    const read = spawnSync(
      'python3',
      ['-c', 'import sys; sys.path.insert(0, "eval/drivers/tau2"); import microglia_agent; print(",".join(str(r) for r in microglia_agent.MARGIN_RUNGS))'],
      { cwd: REPO_ROOT, encoding: 'utf8' },
    );
    if (read.status !== 0 || read.stdout.trim() === '') return;
    expect(MARGIN_RUNGS.map((rung) => rung.toFixed(2)).join(',')).toBe(read.stdout.trim().split(',').map((v) => Number(v).toFixed(2)).join(','));
  });
});
