import { describe, expect, it } from 'vitest';
import {
  CEILING_ABOVE_PACK,
  CEILING_ABSENT,
  CEILING_FITS,
  ceilingLineOf,
  ceilingVerdictOf,
  packCensus,
  packLineOf,
} from '../tau2-pack.js';

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
