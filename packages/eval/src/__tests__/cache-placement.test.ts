import { describe, expect, it } from 'vitest';

import {
  CACHE_TOLERANCE_TOKENS,
  PACK_PLACEMENTS,
  cacheLedgerOf,
  movePrice,
  placementVerdict,
  placementPromptFor,
  syntheticText,
  type CacheLedger,
  type CacheReading,
  type PlacementPromptInput,
  type PromptMessage,
} from '../cache-placement.js';

const input = (turns = 2): PlacementPromptInput => ({
  native: 'POLICY',
  block: 'BLOCK',
  turns: Array.from({ length: turns }, (_, index) => ({
    user: `u${index}`,
    assistant: `a${index}`,
  })),
});

/** A ledger of `n` calls with a fixed prompt and a fixed uncached count per call. */
const ledger = (promptPerCall: number, uncachedPerCall: number, calls = 5): CacheLedger =>
  cacheLedgerOf(
    Array.from({ length: calls }, () => ({
      promptTokens: promptPerCall,
      cachedTokens: promptPerCall - uncachedPerCall,
    })),
  );

describe('placementPromptFor', () => {
  it('sends no block at all for the control', () => {
    const messages = placementPromptFor('control', input());
    expect(messages[0]).toEqual({ role: 'system', content: 'POLICY' });
    expect(messages).toHaveLength(5);
    expect(messages.some((message) => message.content.includes('BLOCK'))).toBe(false);
  });

  it('carries the block as a second system message, between the policy and the conversation', () => {
    const messages = placementPromptFor('system-second', input());
    expect(messages.slice(0, 2)).toEqual([
      { role: 'system', content: 'POLICY' },
      { role: 'system', content: 'BLOCK' },
    ]);
    expect(messages[2]).toEqual({ role: 'user', content: 'u0' });
  });

  it('merges the block into the one system message rather than adding a second', () => {
    const messages = placementPromptFor('system-merged', input());
    expect(messages.filter((message) => message.role === 'system')).toHaveLength(1);
    expect(messages[0]?.content).toBe('POLICY\n\nBLOCK');
  });

  it('attaches the block to the first task statement and leaves the later ones alone', () => {
    const messages = placementPromptFor('first-turn', input(3));
    expect(messages[0]).toEqual({ role: 'system', content: 'POLICY' });
    expect(messages[1]).toEqual({ role: 'user', content: 'u0\n\nBLOCK' });
    expect(messages[3]).toEqual({ role: 'user', content: 'u1' });
    expect(messages[5]).toEqual({ role: 'user', content: 'u2' });
  });

  it('refuses the first-turn placement on an episode with no turn to attach to', () => {
    expect(() => placementPromptFor('first-turn', input(0))).toThrow(/needs at least one turn/);
  });
});

describe('cacheLedgerOf', () => {
  it('reports zero for a shape that was never called, rather than a rate over nothing', () => {
    const empty = cacheLedgerOf([]);
    expect(empty).toMatchObject({ calls: 0, promptTokens: 0, cachedTokens: 0, steadyUncached: 0 });
    expect(empty.uncachedSeries).toEqual([]);
  });

  it('keeps the first call out of the steady state, because it can never be a hit', () => {
    const one = cacheLedgerOf([{ promptTokens: 4000, cachedTokens: 0 }]);
    expect(one.firstUncached).toBe(4000);
    expect(one.steadyUncached).toBe(0);
    expect(one.steadyMeanUncached).toBe(0);
  });

  it('reads a bimodal steady state at its median and reports the mean beside it', () => {
    // Three misses and one hit: the median is a miss, and the mean is the blend the bill is made of.
    const readings: CacheReading[] = [
      { promptTokens: 1000, cachedTokens: 0 },
      { promptTokens: 1000, cachedTokens: 0 },
      { promptTokens: 1000, cachedTokens: 900 },
      { promptTokens: 1000, cachedTokens: 0 },
      { promptTokens: 1000, cachedTokens: 0 },
    ];
    const folded = cacheLedgerOf(readings);
    expect(folded.uncachedSeries).toEqual([1000, 1000, 100, 1000, 1000]);
    expect(folded.steadyUncached).toBe(1000);
    expect(folded.steadyMeanUncached).toBe(775);
    expect(folded.uncachedTokens).toBe(4100);
  });

  it('averages the two middles of an even steady state rather than picking one', () => {
    const folded = cacheLedgerOf([
      { promptTokens: 500, cachedTokens: 500 },
      { promptTokens: 500, cachedTokens: 500 },
      { promptTokens: 500, cachedTokens: 400 },
    ]);
    expect(folded.steadyUncached).toBe(50);
  });

  it('reads the middle of an odd steady state directly', () => {
    const folded = cacheLedgerOf([
      { promptTokens: 500, cachedTokens: 0 },
      { promptTokens: 500, cachedTokens: 500 },
      { promptTokens: 500, cachedTokens: 200 },
      { promptTokens: 500, cachedTokens: 100 },
    ]);
    expect(folded.uncachedSeries).toEqual([500, 0, 300, 400]);
    expect(folded.steadyUncached).toBe(300);
  });

  it('refuses a hit count larger than the prompt instead of reporting a negative bill', () => {
    const folded = cacheLedgerOf([{ promptTokens: 100, cachedTokens: 400 }]);
    expect(folded.uncachedSeries).toEqual([0]);
    expect(cacheLedgerOf([{ promptTokens: -5, cachedTokens: 9 }]).promptSeries).toEqual([0]);
    expect(cacheLedgerOf([{ promptTokens: 100, cachedTokens: -9 }]).uncachedSeries).toEqual([100]);
  });
});

describe('placementVerdict', () => {
  it('refuses to read a probe that did not send every shape', () => {
    const verdict = placementVerdict({ control: ledger(4000, 300) });
    expect(verdict.state).toBe('inconclusive');
    expect(verdict.sentence).toMatch(/did not read every shape/);
    expect(verdict.readouts).toHaveLength(1);
  });

  it('reports having read nothing when the probe sent nothing', () => {
    const verdict = placementVerdict({});
    expect(verdict.state).toBe('inconclusive');
    expect(verdict.readouts).toEqual([]);
    expect(verdict.blockTokens).toBe(0);
  });

  it('measures a shape against zero when the control itself is absent', () => {
    // The probe still has to say what it saw: a missing control is why the verdict is inconclusive,
    // not a reason to drop the readings that exist.
    const verdict = placementVerdict({
      'system-second': ledger(5100, 1425),
      'system-merged': ledger(5100, 300),
    });
    expect(verdict.state).toBe('inconclusive');
    expect(verdict.readouts.map((readout) => readout.delta)).toEqual([1425, 300]);
  });

  it('refuses a probe whose block measured no tokens', () => {
    // Every shape sends the same prompt, so no delta can be about a block that is not there.
    const verdict = placementVerdict({
      control: ledger(4000, 300),
      'system-second': ledger(4000, 300),
      'system-merged': ledger(4000, 300),
    });
    expect(verdict.state).toBe('inconclusive');
    expect(verdict.blockTokens).toBe(0);
    expect(verdict.sentence).toMatch(/not a block/);
  });

  it('refuses a control that reported no prompt at all', () => {
    const verdict = placementVerdict({
      control: cacheLedgerOf([{ promptTokens: 0, cachedTokens: 0 }]),
      'system-second': ledger(5000, 1400),
      'system-merged': ledger(5000, 400),
    });
    expect(verdict.state).toBe('inconclusive');
  });

  it('calls placement free when the second system message is cached like the control', () => {
    const verdict = placementVerdict({
      control: ledger(4000, 300),
      'system-second': ledger(5100, 400),
      'system-merged': ledger(5100, 400),
    });
    expect(verdict.state).toBe('placement-is-free');
    expect(verdict.blockTokens).toBe(1100);
    expect(verdict.sentence).toContain(`${100} tokens a call`);
    expect(verdict.sentence).toContain(String(CACHE_TOLERANCE_TOKENS));
  });

  it('names the message boundary when the second message pays and the merged one does not', () => {
    const verdict = placementVerdict({
      control: ledger(4000, 300),
      'system-second': ledger(5100, 1425),
      'system-merged': ledger(5100, 300),
    });
    expect(verdict.state).toBe('placement-is-the-boundary');
    expect(verdict.sentence).toContain('1125 uncached tokens a call');
    expect(verdict.sentence).toContain('costs 0');
  });

  it('refuses placement as the lever when every block-bearing shape pays', () => {
    const verdict = placementVerdict({
      control: ledger(4000, 300),
      'system-second': ledger(5100, 1425),
      'system-merged': ledger(5100, 1425),
    });
    expect(verdict.state).toBe('block-never-cached');
    expect(verdict.sentence).toMatch(/Placement is not the lever/);
  });

  it('prices the first-turn placement beside the verdict without letting it decide', () => {
    const withTurn = placementVerdict({
      control: ledger(4000, 300),
      'system-second': ledger(5100, 1425),
      'system-merged': ledger(5100, 300),
      'first-turn': ledger(5100, 400),
    });
    expect(withTurn.state).toBe('placement-is-the-boundary');
    expect(withTurn.sentence).toContain('first-turn placement reads 100 against it');
    expect(withTurn.readouts.map((readout) => readout.placement)).toEqual([
      'control',
      'system-second',
      'system-merged',
      'first-turn',
    ]);
    const withoutTurn = placementVerdict({
      control: ledger(4000, 300),
      'system-second': ledger(5100, 1425),
      'system-merged': ledger(5100, 300),
    });
    expect(withoutTurn.sentence).not.toContain('first-turn');
  });

  it('reports a delta the other way when a shape billed less than the control', () => {
    const verdict = placementVerdict({
      control: ledger(4000, 500),
      'system-second': ledger(5100, 400),
      'system-merged': ledger(5100, 400),
    });
    const second = verdict.readouts.find((readout) => readout.placement === 'system-second');
    expect(second?.delta).toBe(-100);
  });
});

describe('syntheticText', () => {
  it('is deterministic, seed-sensitive and about four characters per token', () => {
    const text = syntheticText(100);
    expect(text).toBe(syntheticText(100));
    expect(text).not.toBe(syntheticText(100, 1));
    expect(text.length).toBeGreaterThanOrEqual(400);
    expect(syntheticText(0).length).toBeLessThan(20);
  });
});

/**
 * R220b. The probe priced four shapes and not the one this project ships, which is the gap that let
 * `SERVING_DEFAULTS.placement` name a shape no committed reading had ever measured. Two things were
 * missing with it: `tail`'s position is a function of **when the block was written** (a probe that
 * re-sends it at the end of every call prices a shape the arm never sends), and the price of a
 * **change** — which is the quantity R216b's −4% is made of and which no shape without a revision
 * could show.
 */
describe('the tail placement, which is the one this project ships', () => {
  const turns = (count: number): PlacementPromptInput['turns'] =>
    Array.from({ length: count }, (_, index) => ({ user: `u${index}`, assistant: `a${index}` }));

  it('writes the block behind the conversation as it stood when the block was written', () => {
    const messages = placementPromptFor('tail', {
      native: 'POLICY',
      block: 'BLOCK',
      turns: turns(3),
      writtenOnCall: 2,
    });
    expect(messages.map((message) => message.content)).toEqual([
      'POLICY',
      'u0',
      'a0',
      'BLOCK',
      'u1',
      'a1',
      'u2',
      'a2',
    ]);
  });

  it('is the second-system shape on a first call, because there is nothing to be behind yet', () => {
    // Asserted rather than forbidden: an empty conversation is a legal position, and the equality is
    // a fact about prefixes. A `tail` that threw here would refuse the first call of every episode.
    const first = { native: 'POLICY', block: 'BLOCK', turns: turns(1), writtenOnCall: 1 } as const;
    expect(placementPromptFor('tail', first)).toEqual(placementPromptFor('system-second', first));
  });

  it('carries no block on the calls before the write, whichever placement is asked for', () => {
    const early = { native: 'POLICY', block: 'BLOCK', turns: turns(1), writtenOnCall: 3 } as const;
    for (const placement of PACK_PLACEMENTS) {
      if (placement === 'control' || placement === 'first-turn') continue;
      expect(placementPromptFor(placement, early).some((message) => message.content.includes('BLOCK'))).toBe(false);
    }
  });

  it('sends the revision from the call it names and the original before it', () => {
    // The call index is one more than the history's length: zero completed turns is call 1. Written
    // out because getting it wrong is how this test first failed — it asked a two-turn history for
    // call one and read the revision it had just named.
    const shape = (count: number): readonly PromptMessage[] =>
      placementPromptFor('tail', {
        native: 'POLICY',
        block: 'BLOCK',
        turns: turns(count),
        writtenOnCall: 1,
        revision: { fromCall: 2, block: 'REV' },
      });
    expect(shape(0).some((message) => message.content === 'BLOCK')).toBe(true);
    expect(shape(1).some((message) => message.content === 'REV')).toBe(true);
    expect(shape(1).some((message) => message.content === 'BLOCK')).toBe(false);
  });

  it('refuses a revision that predates the write, which is a different treatment', () => {
    expect(() =>
      placementPromptFor('tail', {
        native: 'POLICY',
        block: 'BLOCK',
        turns: turns(2),
        writtenOnCall: 3,
        revision: { fromCall: 2, block: 'REV' },
      }),
    ).toThrow(/before the block was written/);
  });

  it('refuses to give the first-turn placement a write it has no position for', () => {
    expect(() =>
      placementPromptFor('first-turn', { native: 'POLICY', block: 'BLOCK', turns: turns(2), writtenOnCall: 2 }),
    ).toThrow(/write is call 1 by construction/);
  });

  it('refuses a write on a call that does not exist', () => {
    expect(() =>
      placementPromptFor('tail', { native: 'POLICY', block: 'BLOCK', turns: turns(2), writtenOnCall: 0 }),
    ).toThrow(/call 1 is the first/);
  });

  it('is priced beside the verdict without deciding it', () => {
    const verdict = placementVerdict({
      control: ledger(4000, 300),
      'system-second': ledger(5100, 1425),
      'system-merged': ledger(5100, 300),
      tail: ledger(5100, 300),
    });
    expect(verdict.state).toBe('placement-is-the-boundary');
    expect(verdict.readouts.map((readout) => readout.placement)).toEqual([
      'control',
      'system-second',
      'system-merged',
      'tail',
    ]);
    expect(verdict.sentence).toContain('The tail placement reads 0 against it');
  });

  it('says nothing about the tail when the probe did not send it', () => {
    const verdict = placementVerdict({
      control: ledger(4000, 300),
      'system-second': ledger(5100, 1425),
      'system-merged': ledger(5100, 300),
    });
    expect(verdict.sentence).not.toContain('tail');
  });
});

describe('movePrice', () => {
  it('prices one call against the shape’s own steady state', () => {
    const shape = cacheLedgerOf([
      { promptTokens: 4000, cachedTokens: 0 },
      { promptTokens: 4000, cachedTokens: 3900 },
      { promptTokens: 4000, cachedTokens: 3900 },
      { promptTokens: 4000, cachedTokens: 0 },
    ]);
    // The fourth call is the one the block moved on: it re-bought the whole prompt, and the steady
    // state it is read against is the median of the three calls after the first — 3,900 tokens of
    // re-billed prefix rather than 4,000, because a normal call already pays the 100-token tail.
    expect(movePrice(shape, 4)).toBe(3900);
    expect(movePrice(shape, 2)).toBe(0);
  });

  it('reads a call that hit more than the median as a negative excess rather than clamping it', () => {
    const shape = cacheLedgerOf([
      { promptTokens: 1000, cachedTokens: 0 },
      { promptTokens: 1000, cachedTokens: 0 },
      { promptTokens: 1000, cachedTokens: 900 },
      { promptTokens: 1000, cachedTokens: 950 },
    ]);
    expect(movePrice(shape, 4)).toBe(-50);
  });

  it('refuses a call the series does not hold', () => {
    const shape = cacheLedgerOf([{ promptTokens: 1000, cachedTokens: 0 }]);
    expect(() => movePrice(shape, 0)).toThrow(/call 1 is the first/);
    expect(() => movePrice(shape, 2)).toThrow(/1 call/);
  });
});
