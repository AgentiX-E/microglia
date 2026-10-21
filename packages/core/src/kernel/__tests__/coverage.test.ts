import { describe, expect, it } from 'vitest';
import { queryCoverage } from '../similarity.js';

describe('query coverage', () => {
  it('is the share of the query terms the document mentions', () => {
    expect(queryCoverage('revenue by region', 'region revenue is summed per month')).toBe(1);
    expect(queryCoverage('revenue by region', 'unrelated text about weather')).toBe(0);
    expect(queryCoverage('revenue', 'total revenue')).toBe(1);
  });

  it('ignores stopwords and one-letter terms on both sides', () => {
    expect(queryCoverage('what is the revenue of a company', 'revenue')).toBeCloseTo(0.5, 6);
    expect(queryCoverage('the of and', 'anything')).toBe(0);
  });

  it('is zero for an empty or punctuation-only query', () => {
    expect(queryCoverage('', 'revenue')).toBe(0);
    expect(queryCoverage('   ...   ', 'revenue')).toBe(0);
  });

  it('counts each query term once, so repetition does not inflate it', () => {
    expect(queryCoverage('revenue revenue revenue', 'revenue by month')).toBe(1);
  });
});
