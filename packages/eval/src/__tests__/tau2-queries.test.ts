/**
 * R92's instrument: the recall query is a draw, and nothing was recording it.
 *
 * R91 pinned the store and the store replayed exactly — fifteen statements, character for character —
 * and the pack still came back different: `meanChars` 1,812.1 against R90's 1,825.3, coverage p50
 * 0.2857 against 0.28. The registration had predicted both as equalities, which means it believed the
 * store was the only input to a pack. It is not. `buildPack` ranks on BM25 over the *query*, and the
 * query is the user simulator's first turn, which τ² samples from `user_scenario.instructions`. R89,
 * R90 and R91 recorded 1,717.2, 1,825.3 and 1,812.1 for the same reason.
 *
 * The tests are written against the three ways the census and the pin could lie:
 *
 *  - **A digest that is a property of arrival order.** Two arms that asked the same 228 questions in a
 *    different order asked the same questions, and a digest that said otherwise would send a readback
 *    looking for a defect that is not there.
 *  - **A pin that silently covers less than the run asks.** A short list is not a warning: the episode
 *    it does not cover would fall back to the sampled text, and a pack that is pinned on 200 of 228
 *    requests reads as a pinned pack.
 *  - **A pin nobody can tell was applied.** `replaced` and `askedDigest` exist because R91's artefact
 *    carried no field saying whether its store had been replayed, and a readback had to infer it.
 */
import { describe, expect, it } from 'vitest';
import { L4ParseError } from '../l4.js';
import {
  assertQueryPinCovers,
  parseQueryPin,
  pinnedQueryText,
  queryCensusOf,
  type RecallInput,
} from '../tau2-queries.js';

function asked(index: number, text: string): RecallInput {
  return { index, asked: text, used: text };
}

function reason(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    return error instanceof L4ParseError ? error.reason : `not an L4ParseError: ${String(error)}`;
  }
  return 'no error';
}

describe('the query census', () => {
  it('counts requests and distinct texts', () => {
    const census = queryCensusOf([asked(0, 'change my order'), asked(1, 'change my order'), asked(2, 'cancel the laptop')]);
    expect(census.requests).toBe(3);
    expect(census.distinct).toBe(2);
  });

  it('reports no mean over no request rather than zero', () => {
    const census = queryCensusOf([]);
    expect(census.requests).toBe(0);
    expect(census.meanChars).toBeNull();
    expect(census.p50Chars).toBeNull();
  });

  it('takes the lower median, so an even count has an answer rather than an average of two', () => {
    const census = queryCensusOf([
      asked(0, 'abcdefghij'),
      asked(1, 'abcdefghijklmnopqrst'),
      asked(2, 'abc'),
      asked(3, 'abcdefghijklmn'),
    ]);
    // Sorted lengths are 3, 10, 14, 20; the lower median is the second of four.
    expect(census.p50Chars).toBe(10);
    expect(census.meanChars).toBeCloseTo(47 / 4, 10);
  });

  it('hashes the mapping and not the order the episodes arrived in', () => {
    const one = queryCensusOf([asked(0, 'a'), asked(1, 'b'), asked(2, 'c')]);
    const other = queryCensusOf([asked(2, 'c'), asked(1, 'b'), asked(0, 'a')]);
    expect(one.digest).toBe(other.digest);
  });

  it('changes the digest when one question changes, and when one moves', () => {
    const base = queryCensusOf([asked(0, 'change my order')]);
    const same = queryCensusOf([asked(0, 'change my order')]);
    const other = queryCensusOf([asked(0, 'change my order, please')]);
    // The same text at a different position is a different draw, and a digest that ignored the position
    // would call two arms identical after they had run the same questions in a different order.
    const moved = queryCensusOf([asked(1, 'change my order')]);
    expect(same.digest).toBe(base.digest);
    expect(other.digest).not.toBe(base.digest);
    expect(moved.digest).not.toBe(base.digest);
  });

  it('counts what a pin replaced and separates it from what the agent asked', () => {
    const unpinned = queryCensusOf([asked(0, 'change my order')]);
    expect(unpinned.replaced).toBe(0);
    expect(unpinned.askedDigest).toBe(unpinned.digest);
    expect(unpinned.pin).toBeNull();

    const pinned = queryCensusOf([{ index: 0, asked: 'can u swap the colour', used: 'change my order' }], {
      pin: 'eval/pins/r92-retail-queries.json',
    });
    expect(pinned.replaced).toBe(1);
    expect(pinned.askedDigest).not.toBe(pinned.digest);
    expect(pinned.pin).toBe('eval/pins/r92-retail-queries.json');
  });

  it('carries the texts, which is the only thing a pin can be derived from', () => {
    const census = queryCensusOf([asked(3, 'change my order')]);
    expect(census.texts).toEqual([{ index: 3, text: 'change my order' }]);
  });

  it('carries the texts in position order, whatever order they arrived in', () => {
    const census = queryCensusOf([asked(7, 'c'), asked(1, 'b'), asked(0, 'a')]);
    expect(census.texts.map((entry) => entry.index)).toEqual([0, 1, 7]);
  });
});

describe('the query pin', () => {
  const document = { source: 'R92', queries: ['change my order', 'swap the colour', 'cancel it'] };

  it('reads one text per episode, in the order the phase ran them', () => {
    const pin = parseQueryPin(document);
    expect(pin.source).toBe('R92');
    expect(pinnedQueryText(pin, 0)).toBe('change my order');
    expect(pinnedQueryText(pin, 1)).toBe('swap the colour');
    expect(pinnedQueryText(pin, 2)).toBe('cancel it');
  });

  it('refuses a document that is not an object', () => {
    expect(reason(() => parseQueryPin([]))).toBe('unreadable-json');
    expect(reason(() => parseQueryPin(null))).toBe('unreadable-json');
  });

  it('refuses a document with no `queries` list', () => {
    expect(reason(() => parseQueryPin({ source: 'R92' }))).toBe('missing-tasks');
    expect(reason(() => parseQueryPin({ queries: {} }))).toBe('missing-tasks');
  });

  it('refuses an empty list: a pin that covers nothing is not a pin', () => {
    expect(reason(() => parseQueryPin({ queries: [] }))).toBe('bad-entry');
  });

  it('refuses an entry that is not a question', () => {
    expect(reason(() => parseQueryPin({ queries: [42] }))).toBe('bad-entry');
    expect(reason(() => parseQueryPin({ queries: ['a', ''] }))).toBe('bad-entry');
    // A hand edit that kept its brackets: one list nested inside the list.
    expect(reason(() => parseQueryPin({ queries: [['a']] }))).toBe('bad-entry');
  });

  it('names the arm it came from, or says it does not know', () => {
    expect(parseQueryPin({ queries: ['x'] }).source).toBe('an arm this pin does not name');
  });

  it('refuses an episode past the end of the list, rather than serving the sampled text', () => {
    const pin = parseQueryPin(document);
    expect(reason(() => pinnedQueryText(pin, 3))).toBe('short-grid');
  });
});

describe('the coverage check a run makes before it spends an episode', () => {
  const pin = parseQueryPin({ queries: ['a', 'b'] });

  it('passes when the pin holds one text per episode', () => {
    expect(() => assertQueryPinCovers(pin, 2)).not.toThrow();
  });

  it('accepts a pin with more texts than the run asks for: a longer pin is a wider pin', () => {
    expect(() => assertQueryPinCovers(pin, 1)).not.toThrow();
  });

  it('refuses a pin that is shorter than the phase it must cover', () => {
    expect(reason(() => assertQueryPinCovers(pin, 3))).toBe('short-grid');
  });
});
