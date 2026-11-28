/**
 * R252 — confidence-weighted reliability and calibrated abstention, behaviour tests.
 *
 * The gate scores each retrieved memory item on three signals — source credibility, half-life
 * temporal decay, and conflict-aware signed consensus — then decides whether the item may be
 * admitted, must be reweighted, or must be abstained from. The scoring reproduces MMA's Confidence
 * Module (arXiv 2602.16493, github.com/AIGeeksGroup/MMA confidence_module.py compute_v2) and the
 * abstention ladder encodes its "abstain when support is insufficient" rule as a falsifiable verdict.
 */
import { describe, expect, it } from 'vitest';

import {
  CONFIDENCE_DISPOSITIONS,
  CONFIDENCE_REASONS,
  CONFIDENCE_SOURCES,
  memoryConfidence,
  type ConfidenceItem,
  type MemoryConfidenceInput,
} from '../memory-confidence.js';

const weights = { source: 0.45, time: 0.4, consensus: 0.15 };

const neighbor = (over: Partial<ConfidenceItem['neighbors'][number]> = {}): ConfidenceItem['neighbors'][number] => ({
  weight: 1,
  confidence: 0.8,
  support: 1,
  ...over,
});

const item = (over: Partial<ConfidenceItem> = {}): ConfidenceItem => ({
  id: 'm1',
  source: 'knowledge',
  ageDays: 0,
  neighbors: [],
  ...over,
});

const run = (items: ConfidenceItem[], over: Partial<MemoryConfidenceInput> = {}) =>
  memoryConfidence({
    id: 'ep-1',
    weights,
    halfLifeDays: 30,
    abstainBelow: 0.5,
    reweightBelow: 0.75,
    items,
    ...over,
  });

describe('R252 eligibility guards', () => {
  it('rejects a blank episode id', () => {
    expect(() => run([item()], { id: ' ' })).toThrow();
  });
  it('rejects a non-object weights', () => {
    expect(() => run([item()], { weights: 1 as never })).toThrow();
  });
  it('rejects a negative source weight', () => {
    expect(() => run([item()], { weights: { ...weights, source: -1 } })).toThrow();
  });
  it('rejects a non-finite time weight', () => {
    expect(() => run([item()], { weights: { ...weights, time: Number.NaN } })).toThrow();
  });
  it('rejects weights whose sum is zero', () => {
    expect(() => run([item()], { weights: { source: 0, time: 0, consensus: 0 } })).toThrow();
  });
  it('rejects a non-finite half life', () => {
    expect(() => run([item()], { halfLifeDays: Number.POSITIVE_INFINITY })).toThrow();
  });
  it('rejects a zero half life', () => {
    expect(() => run([item()], { halfLifeDays: 0 })).toThrow();
  });
  it('rejects a negative abstain threshold', () => {
    expect(() => run([item()], { abstainBelow: -0.1 })).toThrow();
  });
  it('rejects an abstain threshold above one', () => {
    expect(() => run([item()], { abstainBelow: 1.1 })).toThrow();
  });
  it('rejects a non-object abstain threshold', () => {
    expect(() => run([item()], { abstainBelow: 'x' as never })).toThrow();
  });
  it('rejects a reweight threshold below abstain', () => {
    expect(() => run([item()], { reweightBelow: 0.4 })).toThrow();
  });
  it('rejects a non-array items', () => {
    expect(() => run('no' as never)).toThrow();
  });
  it('rejects empty items', () => {
    expect(() => run([])).toThrow();
  });
  it('rejects a non-object item', () => {
    expect(() => run([null as never])).toThrow();
  });
  it('rejects a blank item id', () => {
    expect(() => run([item({ id: ' ' })])).toThrow();
  });
  it('rejects a duplicate item id', () => {
    expect(() => run([item({ id: 'd' }), item({ id: 'd' })])).toThrow();
  });
  it('rejects an unknown source', () => {
    expect(() => run([item({ source: 'gossip' as never })])).toThrow();
  });
  it('rejects a non-string source', () => {
    expect(() => run([item({ source: 7 as never })])).toThrow();
  });
  it('rejects a negative age', () => {
    expect(() => run([item({ ageDays: -1 })])).toThrow();
  });
  it('rejects a non-finite age', () => {
    expect(() => run([item({ ageDays: Number.NaN })])).toThrow();
  });
  it('rejects a non-array neighbors', () => {
    expect(() => run([item({ neighbors: 'no' as never })])).toThrow();
  });
  it('rejects a non-object neighbor', () => {
    expect(() => run([item({ neighbors: [null as never] })])).toThrow();
  });
  it('rejects a non-positive neighbor weight', () => {
    expect(() => run([item({ neighbors: [neighbor({ weight: 0 })] })])).toThrow();
  });
  it('rejects a non-finite neighbor weight', () => {
    expect(() => run([item({ neighbors: [neighbor({ weight: Number.NaN })] })])).toThrow();
  });
  it('rejects a neighbor confidence below zero', () => {
    expect(() => run([item({ neighbors: [neighbor({ confidence: -0.1 })] })])).toThrow();
  });
  it('rejects a neighbor confidence above one', () => {
    expect(() => run([item({ neighbors: [neighbor({ confidence: 1.1 })] })])).toThrow();
  });
  it('rejects a neighbor support below minus one', () => {
    expect(() => run([item({ neighbors: [neighbor({ support: -1.1 })] })])).toThrow();
  });
  it('rejects a neighbor support above one', () => {
    expect(() => run([item({ neighbors: [neighbor({ support: 1.1 })] })])).toThrow();
  });
  it('rejects a non-finite neighbor support', () => {
    expect(() => run([item({ neighbors: [neighbor({ support: Number.NaN })] })])).toThrow();
  });
});

describe('R252 closed vocabularies', () => {
  it('exposes the five MMA source kinds', () => {
    expect([...CONFIDENCE_SOURCES]).toEqual(['knowledge', 'semantic', 'procedural', 'resource', 'episodic']);
  });
  it('exposes the disposition and reason families', () => {
    expect([...CONFIDENCE_DISPOSITIONS]).toEqual(['admit', 'reweight', 'abstain']);
    expect([...CONFIDENCE_REASONS]).toEqual([
      'reliable',
      'marginal',
      'below-threshold',
      'conflict-overwhelms',
    ]);
  });
});

describe('R252 disposition ladder', () => {
  it('admits a fresh high-credibility item with no neighbors', () => {
    const r = run([item()]);
    expect(r.verdict).toBe('admit');
    expect(r.reason).toBe('reliable');
    expect(r.admitCount).toBe(1);
    // 0.45*0.95 + 0.40*1 + 0.15*0 = 0.8275 (no consensus to lift it).
    expect(r.decidingScoreMilli).toBeGreaterThanOrEqual(820);
  });

  it('abstains when three signals fall below the abstain threshold', () => {
    // source episodic 0.50, old age (decay ~0), negative consensus -> below 0.5
    const r = run([
      item({ source: 'episodic', ageDays: 500, neighbors: [neighbor({ support: -1 })] }),
    ]);
    expect(r.verdict).toBe('abstain');
    expect(r.reason).toBe('conflict-overwhelms');
  });

  it('marks a below-threshold item without a conflicting neighborhood', () => {
    const r = run([item({ source: 'episodic', ageDays: 500, neighbors: [] })]);
    expect(r.verdict).toBe('abstain');
    expect(r.reason).toBe('below-threshold');
  });

  it('reweights a marginal item between the two thresholds', () => {
    // source resource 0.60, fresh (T=1), no consensus -> 0.45*0.6+0.4*1 = 0.67
    const r = run([item({ source: 'resource', ageDays: 0 })]);
    expect(r.verdict).toBe('reweight');
    expect(r.reason).toBe('marginal');
  });

  it('lets a positive consensus lift a marginal item to admit', () => {
    // 0.67 base + 0.15*1 = 0.82
    const r = run([item({ source: 'resource', ageDays: 0, neighbors: [neighbor()] })]);
    expect(r.verdict).toBe('admit');
    expect(r.reason).toBe('reliable');
  });

  it('lets a confident item absorb a conflicting neighborhood without abstaining', () => {
    // knowledge 0.95 fresh, negative consensus costs w_c=0.15 -> 0.6775; above abstainBelow 0.5,
    // so a conflict alone does not force abstention when the other signals are strong.
    const r = run([
      item({ source: 'knowledge', ageDays: 0, neighbors: [neighbor({ support: -1 })] }),
    ]);
    expect(r.verdict).toBe('reweight');
    expect(r.reason).toBe('marginal');
  });

  it('clamps a catastrophic score at zero rather than emitting a negative', () => {
    // A consensus-dominant weighting drives the numerator negative: 0.1*0.5 + 0.1*0 + 0.8*(-1) < 0.
    const r = run(
      [item({ source: 'episodic', ageDays: 1e6, neighbors: [neighbor({ support: -1 })] })],
      { weights: { source: 0.1, time: 0.1, consensus: 0.8 } },
    );
    expect(r.verdict).toBe('abstain');
    expect(r.decidingScoreMilli).toBe(0);
  });
});

describe('R252 signal monotonicity', () => {
  it('decays confidence monotonically with age', () => {
    const fresh = run([item({ source: 'semantic', ageDays: 0 })]).decidingScoreMilli;
    const oneHalfLife = run([item({ source: 'semantic', ageDays: 30 })]).decidingScoreMilli;
    const twoHalfLives = run([item({ source: 'semantic', ageDays: 60 })]).decidingScoreMilli;
    expect(fresh).toBeGreaterThan(oneHalfLife);
    expect(oneHalfLife).toBeGreaterThan(twoHalfLives);
  });

  it('weights consensus by neighbor weight and confidence', () => {
    // one strong supporting neighbor vs one strong conflicting neighbor
    const support = run([item({ source: 'semantic', ageDays: 0, neighbors: [neighbor({ support: 1 })] })]);
    const conflict = run([item({ source: 'semantic', ageDays: 0, neighbors: [neighbor({ support: -1 })] })]);
    expect(support.decidingScoreMilli).toBeGreaterThan(conflict.decidingScoreMilli);
  });
});

describe('R252 aggregation', () => {
  it('takes the strictest verdict and names the decisive item', () => {
    const r = run([
      item({ id: 'good', source: 'knowledge', ageDays: 0 }),
      item({ id: 'bad', source: 'episodic', ageDays: 500, neighbors: [neighbor({ support: -1 })] }),
    ]);
    expect(r.verdict).toBe('abstain');
    expect(r.decidingId).toBe('bad');
    expect(r.itemCount).toBe(2);
    expect(r.abstainCount).toBe(1);
    expect(r.admitCount).toBe(1);
    expect(r.reweightCount).toBe(0);
  });

  it('keeps the first item on a severity tie', () => {
    const r = run([
      item({ id: 'first', source: 'knowledge', ageDays: 0 }),
      item({ id: 'second', source: 'knowledge', ageDays: 0 }),
    ]);
    expect(r.decidingId).toBe('first');
  });

  it('partitions the item count across all three dispositions', () => {
    const r = run([
      item({ id: 'a', source: 'knowledge', ageDays: 0 }),
      item({ id: 'b', source: 'resource', ageDays: 0 }),
      item({ id: 'c', source: 'episodic', ageDays: 500 }),
    ]);
    expect(r.admitCount + r.reweightCount + r.abstainCount).toBe(r.itemCount);
  });
});
