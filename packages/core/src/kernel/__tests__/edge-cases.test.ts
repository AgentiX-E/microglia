import { describe, expect, it } from 'vitest';
import {
  applyOps,
  canonicalize,
  countLeaves,
  diffJson,
  editDistance,
  isMicrogliaError,
  MicrogliaError,
  redactJson,
  resolvePolicy,
  scopeMatches,
  specificity,
  validityDecay,
  isInlinePayload,
  hasHighSeverity,
  scanForInjection,
  mean as meanOf,
  variance as varianceOf,
  bootstrapCI as bootstrapSingleHelper,
  wilsonLower as wilsonLowerOf,
  logit as logitOf,
  logBinomialPmf as binomialPmf,
  logGamma as logGammaOf,
  steppingClock,
  fixedClock,
  systemClock,
  tokenize as tokenizeOf,
  diceSimilarity as diceOf,
  jaccardSimilarity as jaccardOf,
  bm25Score as bm25Of,
  mmrSelect as mmrOf,
  opCount as opCountOf,
  stddev as stddevOf,
} from '../index.js';

describe('diff edge cases', () => {
  it('replaces the root when the whole value changes type', () => {
    const ops = diffJson({ a: 1 }, [1, 2]);
    expect(ops).toHaveLength(1);
    expect(applyOps({ a: 1 }, ops)).toEqual([1, 2]);
  });

  it('removes a root value', () => {
    const ops = diffJson(1, 2);
    expect(ops[0]?.path).toEqual([]);
    expect(applyOps(1, ops)).toBe(2);
  });

  it('keeps object key insertion and deletion distinct', () => {
    const ops = diffJson({ a: 1, b: 2 }, { a: 1 });
    expect(ops).toEqual([{ op: 'remove', path: ['b'], before: 2 }]);
  });

  it('counts leaves for scalars, empty objects, and arrays', () => {
    expect(countLeaves(null)).toBe(1);
    expect(countLeaves({})).toBe(1);
    expect(countLeaves([1, 2, 3])).toBe(3);
    expect(countLeaves({ a: [1, { b: 2 }] })).toBe(2);
  });

  it('reports a path that cannot resolve', () => {
    expect(() => applyOps({ a: 1 }, [{ op: 'set', path: ['a', 'b'], before: 1, after: 2 }])).toThrow(
      TypeError,
    );
  });

  it('rejects a non-finite value in the canonical form', () => {
    expect(() => canonicalize({ a: Number.POSITIVE_INFINITY })).toThrow(TypeError);
  });

  it('gives identical values zero distance', () => {
    expect(editDistance({ a: 1 }, { a: 1 })).toBe(0);
  });
});

describe('runtime guards', () => {
  it('recognises its own error type', () => {
    expect(isMicrogliaError(new MicrogliaError('MG_E_CONFIG', 'x'))).toBe(true);
    expect(isMicrogliaError(new Error('x'))).toBe(false);
  });

  it('resolves policy overrides without mutating the default', () => {
    const policy = resolvePolicy({ minSupport: 3 });
    expect(policy.minSupport).toBe(3);
    expect(resolvePolicy().minSupport).toBe(0.8);
  });

  it('screens a role marker at high severity', () => {
    expect(hasHighSeverity(scanForInjection('<|im_start|>'))).toBe(true);
    expect(hasHighSeverity(scanForInjection('a normal rule'))).toBe(false);
  });

  it('redacts nested JSON strings and preserves structure', () => {
    const value = redactJson({ a: ['mail a@b.com', 1], b: { c: true } });
    expect(value).toEqual({ a: ['mail [email]', 1], b: { c: true } });
  });
});

describe('scope semantics', () => {
  const query = { task: 't', text: '', namespace: 'n' };

  it('matches when the query has no filter', () => {
    expect(scopeMatches({ task: 't', domain: 'sales' }, query)).toBe(true);
  });

  it('does not let a narrower query widen to another domain', () => {
    expect(scopeMatches({ task: 't', domain: 'sales' }, { ...query, scope: { domain: 'hr' } })).toBe(
      false,
    );
  });

  it('treats an unconstrained item as compatible with any filter', () => {
    expect(scopeMatches({ task: 't', intent: 'trend' }, { ...query, scope: { intent: 'trend' } })).toBe(
      true,
    );
    expect(scopeMatches({ task: 't' }, { ...query, scope: { schemaDigest: 'd' } })).toBe(true);
  });

  it('rejects a different schema digest or reason code when both are present', () => {
    expect(
      scopeMatches({ task: 't', schemaDigest: 'a' }, { ...query, scope: { schemaDigest: 'b' } }),
    ).toBe(false);
    expect(
      scopeMatches({ task: 't', reasonCode: 'a' }, { ...query, scope: { reasonCode: 'b' } }),
    ).toBe(false);
  });

  it('counts every constrained dimension', () => {
    expect(
      specificity({ task: 't', domain: 'd', intent: 'i', field: 'f', reasonCode: 'r', schemaDigest: 's' }),
    ).toBe(6);
  });
});

describe('expiry and payload bounds', () => {
  const base = {
    schema: 'microglia.knowledge/1' as const,
    id: 'k',
    namespace: 'n',
    kind: 'constraint' as const,
    scope: { task: 't' },
    statement: 's',
    evidence: [],
    support: 1,
    contradictions: 0,
    confidence: 1,
    trust: 1,
    validFrom: 0,
    validUntil: 0,
    systemFrom: 0,
    systemUntil: Infinity,
    status: 'active' as const,
    applied: 0,
    succeeded: 0,
    createdAt: 0,
    updatedAt: 0,
  };

  it('decays after expiry but never below the floor', () => {
    expect(validityDecay(base, 0)).toBe(1);
    expect(validityDecay(base, 30 * 86_400_000)).toBeCloseTo(0.5, 5);
    expect(validityDecay(base, 365 * 86_400_000)).toBeCloseTo(0.2, 5);
  });

  it('accepts small payloads and rejects oversized ones', () => {
    expect(isInlinePayload(undefined)).toBe(true);
    expect(isInlinePayload({ a: 1 })).toBe(true);
    expect(isInlinePayload({ a: 'x'.repeat(900) })).toBe(false);
  });
});

describe('degenerate statistics', () => {
  it('handles empty and single-element samples', () => {
    expect(meanOf([])).toBe(0);
    expect(varianceOf([1])).toBe(0);
    expect(bootstrapSingleHelper([0.5])).toEqual({ low: 0.5, high: 0.5, point: 0.5 });
  });

  it('returns zero for an empty Wilson sample and clamps logit', () => {
    expect(wilsonLowerOf(0, 0)).toBe(0);
    expect(logitOf(0)).toBeLessThan(-10);
    expect(logitOf(1)).toBeGreaterThan(10);
  });

  it('handles the boundaries of the binomial pmf', () => {
    expect(binomialPmf(5, 0, 0)).toBe(0);
    expect(binomialPmf(5, 5, 1)).toBe(0);
    expect(binomialPmf(5, 3, 0)).toBe(Number.NEGATIVE_INFINITY);
    expect(binomialPmf(5, 6, 0.5)).toBe(Number.NEGATIVE_INFINITY);
  });

  it('computes logGamma on both sides of one half', () => {
    expect(logGammaOf(0.5)).toBeCloseTo(Math.log(Math.sqrt(Math.PI)), 8);
  });
});

describe('clock', () => {
  it('reads wall time and advances deterministically', () => {
    expect(typeof systemClock.now()).toBe('number');
    const clock = steppingClock(100, 5);
    expect(clock.now()).toBe(100);
    expect(clock.now()).toBe(105);
    expect(fixedClock(7).now()).toBe(7);
  });
});

describe('lexical edge cases', () => {
  it('drops single letters, stopwords, and punctuation-only input', () => {
    expect(tokenizeOf('a I the ???')).toEqual([]);
    expect(tokenizeOf('x1 y2')).toEqual(['x1', 'y2']);
  });

  it('handles empty documents in similarity and index helpers', () => {
    expect(diceOf('', '')).toBe(1);
    expect(diceOf('', 'xx')).toBe(0);
    expect(jaccardOf('', '')).toBe(1);
  });

  it('scores with explicit BM25 options and an unseen token', () => {
    expect(bm25Of(['missing'], ['revenue'], 1, 1, () => 1, 10)).toBe(0);
    expect(bm25Of(['revenue'], ['revenue'], 1, 1, () => 1, 10, { k1: 2, b: 0 })).toBeGreaterThan(0);
  });

  it('returns an empty MMR selection for an empty pool', () => {
    expect(mmrOf([], 3)).toEqual([]);
  });
});

describe('remaining pure branches', () => {
  it('counts operations and computes variance for a real sample', () => {
    expect(opCountOf(diffJson({ a: 1 }, { a: 2 }))).toBe(1);
    expect(varianceOf([1, 2, 3])).toBeCloseTo(1, 10);
    expect(stddevOf([2, 4])).toBeCloseTo(Math.SQRT2, 10);
  });

  it('computes logGamma below one half', () => {
    expect(logGammaOf(0.3)).toBeGreaterThan(0);
  });

  it('skips an array op whose key is a string', () => {
    expect(applyOps([1, 2], [{ op: 'insert', path: ['x' as never], after: 3 }])).toEqual([1, 2]);
  });

  it('throws when an intermediate path element is a scalar', () => {
    expect(() =>
      applyOps({ a: 1 }, [{ op: 'set', path: ['a', 'b', 'c'], before: 1, after: 2 }]),
    ).toThrow(TypeError);
  });
});
