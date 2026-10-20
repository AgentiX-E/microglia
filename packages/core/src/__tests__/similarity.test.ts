import { describe, expect, it } from 'vitest';
import {
  bm25Score,
  diceSimilarity,
  jaccardSimilarity,
  mmrSelect,
  mulberry32,
  newId,
  tokenize,
} from '../index.js';

describe('tokenisation', () => {
  it('lowercases, strips punctuation, and drops stopwords', () => {
    expect(tokenize('What is the Revenue, by Month?')).toEqual(['revenue', 'month']);
  });

  it('keeps identifiers and numbers', () => {
    expect(tokenize('sum(net_amount) for 2024')).toEqual(['sum', 'net_amount', '2024']);
  });

  it('returns no tokens for punctuation only', () => {
    expect(tokenize('?! ...')).toEqual([]);
  });
});

describe('lexical similarity', () => {
  it('is one for identical sets and zero for disjoint sets', () => {
    expect(diceSimilarity('revenue by month', 'revenue by month')).toBe(1);
    expect(jaccardSimilarity('revenue', 'headcount')).toBe(0);
  });

  it('is symmetric', () => {
    expect(diceSimilarity('revenue month', 'month revenue trend')).toBeCloseTo(
      diceSimilarity('month revenue trend', 'revenue month'),
      12,
    );
  });
});

describe('BM25', () => {
  const df = (token: string): number => (token === 'revenue' ? 2 : 1);

  it('scores a matching document above a non-matching one', () => {
    const hit = bm25Score(['revenue'], ['revenue', 'month'], 2, 4, df, 10);
    const miss = bm25Score(['revenue'], ['headcount', 'month'], 2, 4, df, 10);
    expect(hit).toBeGreaterThan(miss);
    expect(miss).toBe(0);
  });

  it('returns zero for an empty query or document', () => {
    expect(bm25Score([], ['revenue'], 1, 1, df, 10)).toBe(0);
    expect(bm25Score(['revenue'], [], 0, 1, df, 10)).toBe(0);
  });

  it('penalises long documents through length normalisation', () => {
    const short = bm25Score(['revenue'], ['revenue'], 1, 10, df, 10);
    const long = bm25Score(['revenue'], ['revenue', ...Array(20).fill('noise')], 21, 10, df, 10);
    expect(short).toBeGreaterThan(long);
  });
});

describe('MMR', () => {
  it('prefers relevance but suppresses near-duplicates', () => {
    const selected = mmrSelect(
      [
        { item: 'a', relevance: 1, text: 'prefer line for monthly trend' },
        { item: 'b', relevance: 0.99, text: 'prefer line for monthly trends' },
        { item: 'c', relevance: 0.8, text: 'exclude cancelled orders' },
      ],
      2,
      0.6,
    );
    expect(selected).toContain('a');
    expect(selected).toContain('c');
  });

  it('respects the limit', () => {
    const selected = mmrSelect(
      Array.from({ length: 10 }, (_, i) => ({ item: i, relevance: 1 - i / 10, text: `doc ${i}` })),
      3,
    );
    expect(selected).toHaveLength(3);
  });
});

describe('ids', () => {
  it('is deterministic under a seeded random source', () => {
    const a = newId('fb', 1_700_000_000_000, mulberry32(42));
    const b = newId('fb', 1_700_000_000_000, mulberry32(42));
    expect(a).toBe(b);
    expect(a.startsWith('fb_')).toBe(true);
  });

  it('sorts by creation time', () => {
    const random = mulberry32(1);
    const early = newId('fb', 1_000, random);
    const late = newId('fb', 2_000, random);
    expect(early < late).toBe(true);
  });

  it('differs across random draws in the same millisecond', () => {
    const random = mulberry32(9);
    const ids = new Set(Array.from({ length: 50 }, () => newId('fb', 1_000, random)));
    expect(ids.size).toBe(50);
  });
});
