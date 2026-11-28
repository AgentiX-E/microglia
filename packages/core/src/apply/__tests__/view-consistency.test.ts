/**
 * R246 — RED-first tests for the cross-view utility-consistency gate (SPLICE replication).
 *
 * The question: one correction, analysed under several views (temperature, prompt, interpreter), yields several
 * utility readings. SPLICE (arXiv 2610.30790) found the utility of knowledge extracted from the same experience
 * varies substantially with how it is analysed, and that keeping only the candidates whose utility gain is
 * consistent across views is the admission rule that separates durable knowledge from a fragile artifact. This
 * is the write-side counterpart of "memory hurts because we stored the wrong thing": a rule that helps under one
 * analysis and hurts under another is an error that will regenerate (Anti-Persistence, arXiv 2610.27406).
 *
 * These tests assert behaviour, not implementation. They were written and confirmed failing before the module
 * existed.
 */
import { describe, expect, it } from 'vitest';

import {
  VIEW_VERDICTS,
  viewConsensus,
  type ViewUtility,
} from '../view-consistency.js';

function view(name: string, injected: number, up: number, down: number): ViewUtility {
  return { view: name, injected, flippedUp: up, flippedDown: down };
}

describe('viewConsensus — verdict vocabulary', () => {
  it('exposes a closed, ordered verdict vocabulary', () => {
    expect(VIEW_VERDICTS).toEqual([
      'consistent-help',
      'consistent-harm',
      'fragile',
      'no-signal',
      'insufficient',
    ]);
  });
});

describe('viewConsensus — sign agreement', () => {
  it('admits when every view gains on net (consistent-help)', () => {
    const r = viewConsensus([
      view('t0.2', 10, 7, 1),
      view('t0.7', 10, 6, 2),
      view('t1.0', 10, 8, 0),
    ]);
    expect(r.verdict).toBe('consistent-help');
    expect(r.admit).toBe(true);
    expect(r.positive).toBe(3);
    expect(r.negative).toBe(0);
    expect(r.zero).toBe(0);
  });

  it('refuses when every view loses on net (consistent-harm)', () => {
    const r = viewConsensus([
      view('a', 10, 1, 7),
      view('b', 10, 2, 6),
    ]);
    expect(r.verdict).toBe('consistent-harm');
    expect(r.admit).toBe(false);
    expect(r.negative).toBe(2);
  });

  it('refuses a fragile candidate: one view helps, another hurts', () => {
    const r = viewConsensus([
      view('t0.2', 10, 8, 1),
      view('t0.7', 10, 1, 8),
    ]);
    expect(r.verdict).toBe('fragile');
    expect(r.admit).toBe(false);
    expect(r.positive).toBe(1);
    expect(r.negative).toBe(1);
  });

  it('treats zero-net views as abstentions, not contradictions', () => {
    // A view with no net flip is non-informative; it must not turn a clear help into fragile.
    const r = viewConsensus([
      view('t0.2', 10, 7, 1),
      view('t0.7', 10, 4, 4),
    ]);
    expect(r.verdict).toBe('consistent-help');
    expect(r.admit).toBe(true);
    expect(r.positive).toBe(1);
    expect(r.zero).toBe(1);
  });

  it('reports no-signal when no view has a net gain in either direction', () => {
    const r = viewConsensus([
      view('a', 10, 0, 0),
      view('b', 10, 3, 3),
    ]);
    expect(r.verdict).toBe('no-signal');
    expect(r.admit).toBe(false);
    expect(r.zero).toBe(2);
  });
});

describe('viewConsensus — evidence floor', () => {
  it('reports insufficient below the default minimum of two views', () => {
    const r = viewConsensus([view('only', 10, 7, 1)]);
    expect(r.verdict).toBe('insufficient');
    expect(r.admit).toBe(false);
    expect(r.views).toBe(1);
  });

  it('reports insufficient for zero views', () => {
    const r = viewConsensus([]);
    expect(r.verdict).toBe('insufficient');
    expect(r.admit).toBe(false);
    expect(r.views).toBe(0);
  });

  it('honours a raised minimum', () => {
    const two = [view('a', 10, 7, 1), view('b', 10, 6, 2)];
    expect(viewConsensus(two, { minViews: 3 }).verdict).toBe('insufficient');
    expect(viewConsensus(two, { minViews: 2 }).verdict).toBe('consistent-help');
  });

  it('honours a minimum of one: a single view can decide', () => {
    expect(viewConsensus([view('only', 10, 7, 1)], { minViews: 1 }).verdict).toBe(
      'consistent-help',
    );
  });
});

describe('viewConsensus — determinism and order independence', () => {
  it('does not depend on the order views arrive', () => {
    const a = [view('x', 10, 8, 1), view('y', 10, 1, 8), view('z', 10, 6, 2)];
    const b = [a[2] as ViewUtility, a[0] as ViewUtility, a[1] as ViewUtility];
    const left = viewConsensus(a);
    const right = viewConsensus(b);
    // The decision and its counts are order-free; `gains` is documented as input-ordered and is reported,
    // never gated. Sorting the two gain lists makes the comparison about the decision, not the report order.
    expect({ ...left, gains: [...left.gains].sort() }).toEqual({
      ...right,
      gains: [...right.gains].sort(),
    });
  });

  it('classifies by net sign, not by ratio magnitude', () => {
    // view x has a large ratio, view y a small one, but both lose on net: still consistent-harm.
    const r = viewConsensus([
      view('x', 100, 10, 40),
      view('y', 4, 0, 1),
    ]);
    expect(r.verdict).toBe('consistent-harm');
  });
});

describe('viewConsensus — reported figures', () => {
  it('reports view count, net flips and per-view gain rates', () => {
    const r = viewConsensus([
      view('a', 10, 7, 1), // gain 6/10 = 0.6
      view('b', 4, 3, 0), // gain 3/4 = 0.75
    ]);
    expect(r.views).toBe(2);
    expect(r.net).toBe(9); // (7-1) + (3-0)
    expect(r.gains).toEqual([0.6, 0.75]);
    expect(r.spread).toBeCloseTo(0.15, 10);
    expect(r.minViews).toBe(2);
  });

  it('reports a zero spread for a single view', () => {
    const r = viewConsensus([view('a', 10, 7, 1)], { minViews: 1 });
    expect(r.spread).toBe(0);
  });

  it('counts a zero-injected view as a zero (abstention), with gain zero', () => {
    const r = viewConsensus([view('a', 10, 7, 1), view('b', 0, 0, 0)]);
    expect(r.zero).toBe(1);
    expect(r.gains[1]).toBe(0);
    expect(r.verdict).toBe('consistent-help');
  });
});

describe('viewConsensus — refusals (config guards)', () => {
  it('refuses a non-integer minimum', () => {
    expect(() => viewConsensus([view('a', 1, 1, 0)], { minViews: 1.5 })).toThrow();
  });

  it('refuses a minimum below one', () => {
    expect(() => viewConsensus([], { minViews: 0 })).toThrow();
  });

  it('refuses negative injected', () => {
    expect(() => viewConsensus([view('a', -1, 0, 0), view('b', 1, 1, 0)])).toThrow();
  });

  it('refuses non-integer counts', () => {
    expect(() => viewConsensus([view('a', 1.5, 0, 0), view('b', 1, 1, 0)])).toThrow();
  });

  it('refuses flippedUp + flippedDown exceeding injected', () => {
    expect(() => viewConsensus([view('a', 2, 2, 1), view('b', 2, 1, 0)])).toThrow();
  });

  it('refuses a duplicate view name', () => {
    expect(() => viewConsensus([view('a', 2, 1, 0), view('a', 2, 1, 0)])).toThrow();
  });

  it('refuses a blank view name', () => {
    expect(() => viewConsensus([view('  ', 2, 1, 0), view('b', 2, 1, 0)])).toThrow();
  });

  it('names the offending view in a refusal', () => {
    try {
      viewConsensus([view('bad-view', 2, 2, 1), view('b', 2, 1, 0)]);
      throw new Error('expected a refusal');
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      expect(message).toContain('bad-view');
    }
  });
});
