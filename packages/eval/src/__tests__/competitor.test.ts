/**
 * The competitor baseline is an instrument too.
 *
 * If this store were implemented uncharitably — no dedupe, no retrieval floor, a
 * reader that ignores the fact — the comparison would be a straw man. These tests
 * pin the three behaviours that make it a fair model of a similarity memory, so the
 * gap the study reports is a gap in governance rather than in effort.
 */
import { describe, expect, it } from 'vitest';
import { FactStore, runFactStore } from '../competitor.js';
import { buildBatches } from '../study.js';
import { buildCorpus, specFor } from '../scenario.js';

describe('fact store', () => {
  it('replaces a fact that is similar enough to an existing one', () => {
    const store = new FactStore();
    store.learn({ text: 'for a trend question use a line chart', mark: 'line', trusted: true, at: 1 });
    store.learn({ text: 'for a trend question use a line chart', mark: 'scatter', trusted: true, at: 2 });
    expect(store.summary()).toMatchObject({ facts: 1, merged: 1 });
    expect(store.retrieve('trend question line chart')?.mark).toBe('scatter');
  });

  it('keeps two facts that are not similar', () => {
    const store = new FactStore();
    store.learn({ text: 'for a trend question use a line chart', mark: 'line', trusted: true, at: 1 });
    store.learn({ text: 'for a composition question use a pie chart', mark: 'pie', trusted: true, at: 2 });
    expect(store.summary().facts).toBe(2);
  });

  it('drops untrusted facts when the store is configured to refuse them', () => {
    const store = new FactStore({ ingestUntrusted: false });
    store.learn({ text: 'trend questions want a pie', mark: 'pie', trusted: false, at: 1 });
    expect(store.summary()).toMatchObject({ facts: 0, untrusted: 0 });
  });

  it('returns nothing for a question with no overlap', () => {
    const store = new FactStore();
    store.learn({ text: 'for a trend question use a line chart', mark: 'line', trusted: true, at: 1 });
    expect(store.retrieve('how many warehouses ship parcels')).toBeUndefined();
  });
});

describe('what the fact store is allowed to learn from', () => {
  /** One corpus item, with a baseline that either agrees with gold or does not. */
  function item(id: string, text: string, mark: 'line' | 'pie', baseline: 'line' | 'pie') {
    const query = {
      id,
      text,
      domain: 'sales',
      intent: 'trend' as const,
      field: 'revenue',
      measureB: 'cost',
      category: 'region',
      temporal: 'month',
      categoryCount: 3,
      grain: 'month' as const,
    };
    return { id, query, gold: specFor(query, mark), baseline: specFor(query, baseline) };
  }

  it('skips an episode the baseline already answered, and learns from the one it did not', () => {
    // A store that learns from a correct episode spends a fact on something already known: the fact
    // is retrieved for a question it cannot improve, and its presence inflates the fact count that
    // the comparison against the memory arms is read from. The skip is one line and it is the
    // difference between "taught 57 episodes" and "taught the 43 the baseline got wrong".
    const agreeing = item('q1', 'trend of revenue by region', 'line', 'line');
    const wrong = item('q2', 'composition of revenue by region', 'pie', 'line');
    const result = runFactStore(
      { train: [agreeing, wrong], holdout: [wrong] },
      [[agreeing, wrong]],
    );
    expect(result.facts).toBe(1);
    expect(result.correct).toEqual([true]);
  });
});

describe('fact store on the study corpus', () => {
  const corpus = { train: buildCorpus(3, 140, 'train'), holdout: buildCorpus(4, 56, 'holdout') };
  const batches = buildBatches(corpus.train, 4, 12, 'ops');

  it('learns something but transfers poorly without scope', () => {
    const clean = runFactStore(corpus, batches);
    // Above the no-memory baseline (a fact store does help), and well below what a
    // scoped, admitted rule achieves — that gap is the point of the comparison.
    expect(clean.accuracy).toBeGreaterThan(0.4);
    expect(clean.accuracy).toBeLessThan(0.95);
    expect(clean.facts).toBeGreaterThan(0);
  });

  it('falls below the baseline once untrusted claims are ingested', () => {
    const clean = runFactStore(corpus, batches);
    const poisoned = runFactStore(corpus, batches, { poisonEvery: 2 });
    expect(poisoned.untrustedFacts).toBeGreaterThan(0);
    expect(poisoned.accuracy).toBeLessThan(clean.accuracy);
  });
});
