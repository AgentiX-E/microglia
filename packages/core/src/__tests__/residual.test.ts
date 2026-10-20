/**
 * Behavioural tests for the branches a happy-path suite never reaches.
 *
 * Each case below names a contract rather than a line: a hash that must
 * distinguish `true` from `"true"`, a decayed rule that must retire itself, a
 * diff applied to an array. They exist because the alternative — an ignore
 * comment — would have hidden a real question about what the code promises.
 */
import { describe, expect, it } from 'vitest';
import {
  applyOps,
  createKnowledgeItem,
  decideStatus,
  defaultPolicy,
  diffJson,
  diceSimilarity,
  hashJson,
  jaccardSimilarity,
  logBinomialPmf,
  mcnemarExact,
  scopeMatches,
  scoreKnowledge,
  tokenize,
  bm25Score,
  type DistillCandidate,
} from '../index.js';

const AT = 1_700_000_000_000;

describe('hashing', () => {
  it('distinguishes booleans from their string spelling', () => {
    expect(hashJson(true)).toBe(hashJson(true));
    expect(hashJson(true)).not.toBe(hashJson(false));
    // A store that hashed `true` and `"true"` alike would dedupe two different
    // corrections into one, so the type tag has to be part of the digest.
    expect(hashJson(true)).not.toBe(hashJson('true'));
  });
});

describe('similarity', () => {
  it('returns Dice overlap for two non-empty token sets', () => {
    expect(diceSimilarity('revenue month', 'revenue units')).toBeCloseTo(0.5, 10);
    expect(jaccardSimilarity('revenue month', 'revenue units')).toBeCloseTo(1 / 3, 10);
  });

  it('scores a repeated query token once', () => {
    const once = bm25Score(['revenue'], ['revenue'], 1, 1, () => 1, 10);
    const twice = bm25Score(['revenue', 'revenue'], ['revenue'], 1, 1, () => 1, 10);
    expect(twice).toBeCloseTo(once, 12);
  });

  it('drops tokens shorter than two characters', () => {
    expect(tokenize('a b revenue')).toEqual(['revenue']);
  });
});

describe('binomial and McNemar boundaries', () => {
  it('handles a degenerate probability', () => {
    expect(logBinomialPmf(4, 4, 1)).toBe(0);
    expect(logBinomialPmf(4, 3, 1)).toBe(Number.NEGATIVE_INFINITY);
  });

  it('returns p = 1 when there is no discordant pair', () => {
    // Without a special case, the log-sum over an empty set would be -Infinity
    // and the test would report p = NaN.
    expect(mcnemarExact(0, 0)).toBe(1);
  });
});

describe('scope filtering', () => {
  it('rejects an item whose field disagrees with the filter', () => {
    expect(
      scopeMatches(
        { task: 'chart.recommend', domain: 'sales', field: 'revenue' },
        { task: 'chart.recommend', text: '', namespace: 'acme', scope: { field: 'units' } },
      ),
    ).toBe(false);
  });

  it('treats an unstated scope dimension as a wildcard', () => {
    expect(
      scopeMatches(
        { task: 'chart.recommend', field: 'revenue' },
        { task: 'chart.recommend', text: '', namespace: 'acme', scope: { domain: 'sales' } },
      ),
    ).toBe(true);
  });
});

function candidate(overrides: Partial<DistillCandidate> = {}): DistillCandidate {
  return {
    namespace: 'acme',
    kind: 'constraint',
    scope: { task: 'chart.recommend', domain: 'sales', intent: 'trend' },
    statement: 'For a trend question over revenue. Use a line chart.',
    payload: { when: { intent: 'trend' }, then: { mark: 'line' } },
    evidence: { feedbackId: 'fb_1', runId: 'run_1', at: AT, weight: 0.9 },
    trust: 0.9,
    dedupeKey: 'k',
    ...overrides,
  };
}

describe('admission decisions', () => {
  it('reports a reason for a quarantined item that was persisted without one', () => {
    const item = createKnowledgeItem(candidate({ trust: 0.2 }), defaultPolicy, AT, 'k_q');
    const legacy = { ...item, status: 'quarantined' as const, statusReason: undefined };
    const decision = decideStatus(legacy as typeof item, defaultPolicy, AT);
    expect(decision.status).toBe('quarantined');
    expect(decision.reason).toBe('awaiting-review');
  });

  it('retires an active rule once its validity has decayed', () => {
    // A rule that was written for a schema or a policy that has since expired:
    // the item stays in the store, but it must stop steering answers.
    const expiring = {
      ...createKnowledgeItem(candidate(), defaultPolicy, AT, 'k_a'),
      status: 'active' as const,
      validUntil: AT,
    };
    expect(decideStatus(expiring, defaultPolicy, AT).status).toBe('active');

    const muchLater = AT + 180 * 86_400_000;
    expect(scoreKnowledge(expiring, defaultPolicy, muchLater)).toBeLessThan(
      defaultPolicy.retirementThreshold,
    );
    expect(decideStatus(expiring, defaultPolicy, muchLater)).toMatchObject({
      status: 'retired',
      reason: 'confidence-below-retirement',
    });
  });

  it('keeps a young rule active', () => {
    const item = { ...createKnowledgeItem(candidate(), defaultPolicy, AT, 'k_y'), status: 'active' as const };
    expect(decideStatus(item, defaultPolicy, AT + 1000).status).toBe('active');
  });
});

describe('array diffs', () => {
  it('removes, inserts, and replaces array elements', () => {
    expect(applyOps([1, 2, 3], [{ op: 'remove', path: [1], before: 2 }])).toEqual([1, 3]);
    expect(applyOps([1, 3], [{ op: 'insert', path: [1], after: 2 }])).toEqual([1, 2, 3]);
    expect(applyOps([1, 2], [{ op: 'set', path: [1], before: 2, after: 9 }])).toEqual([1, 9]);
  });

  it('walks through an array when resolving a nested path', () => {
    expect(
      applyOps({ a: [[1, 2]] }, [{ op: 'set', path: ['a', 0, 1], before: 2, after: 5 }]),
    ).toEqual({ a: [[1, 5]] });
  });

  it('addresses an object member with a numeric path segment', () => {
    // A diff produced by another producer may address `{"0": ...}` by index; the
    // applier normalises the key rather than silently dropping the operation.
    expect(applyOps({ a: { 0: 1 } }, [{ op: 'set', path: ['a', 0], before: 1, after: 2 }])).toEqual({
      a: { 0: 2 },
    });
  });

  it('round-trips a removal inside an object member', () => {
    const before = { a: { b: 1, c: 2 } };
    const after = { a: { b: 1 } };
    expect(applyOps(before, diffJson(before, after))).toEqual(after);
  });
});
