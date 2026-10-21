import { describe, expect, it } from 'vitest';
import { LexicalIndex } from '../lexical-index.js';

describe('lexical index edges', () => {
  it('ignores removal of an unknown id and a missing token', () => {
    const index = new LexicalIndex();
    index.remove('missing');
    expect(index.candidates(['x']).size).toBe(0);
    expect(index.documentFrequency('x')).toBe(0);
    expect(index.averageLength()).toBe(0);
    expect(index.documentCount()).toBe(0);
    expect(index.tokensOf('missing')).toEqual([]);
    expect(index.lengthOf('missing')).toBe(0);
  });

  it('removes postings when a document is replaced or dropped', () => {
    const index = new LexicalIndex();
    index.add('a', 'revenue month');
    index.add('a', 'headcount');
    expect(index.documentFrequency('revenue')).toBe(0);
    expect(index.documentFrequency('headcount')).toBe(1);

    index.remove('a');
    expect(index.documentCount()).toBe(0);
    expect(index.averageLength()).toBe(0);
  });

  it('counts documents and average length', () => {
    const index = new LexicalIndex();
    index.add('a', 'one two');
    index.add('b', 'three');
    expect(index.documentCount()).toBe(2);
    expect(index.averageLength()).toBe(1.5);
    expect(index.lengthOf('a')).toBe(2);
  });
});
