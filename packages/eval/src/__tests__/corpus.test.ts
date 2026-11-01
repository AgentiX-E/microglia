/**
 * The one join from a committed artefact to the offline readings.
 *
 * The tests are written against hand-built artefacts rather than the committed one, because a test
 * that reads `poc-sota-bird-dev-R26-channels.json` and asserts its own output has checked that
 * `JSON.parse` works. What matters here is the pair of decisions the module makes — which of two
 * sources the pack text came from, and what an absent `execOk` means — because both of them change
 * every number downstream while leaving the artefact looking normal.
 */
import { describe, expect, it } from 'vitest';
import { corpusOf, packTextOf, type CommittedCase, type CommittedRule } from '../corpus.js';

const row = (over: Partial<CommittedCase> = {}): CommittedCase => ({
  id: 'db#0',
  dbId: 'db',
  question: 'how many races in 2023',
  evidence: null,
  baselineSql: 'SELECT count(*) FROM race',
  predictedSql: 'SELECT count(*) FROM race',
  correct: true,
  withoutMemoryCorrect: false,
  ...over,
});

const rule = (id: string, statement: string, when: string | null = null): CommittedRule => ({
  id,
  statement,
  when,
});

describe('packTextOf', () => {
  it('prefers the text the lane rendered over the store it was rendered from', () => {
    // `injected` is what the prompt contained; `items` is what the store says now, and an item
    // edited after the run would reconstruct a pack the model never saw.
    const resolved = packTextOf(
      row({ injected: ['the rule as shown'], packIdList: ['k1'] }),
      new Map([['k1', rule('k1', 'the rule as stored')]]),
    );
    expect(resolved).toEqual({ text: 'the rule as shown', source: 'injected' });
  });

  it('joins several injected rules on a newline, so a name cannot straddle two of them', () => {
    const resolved = packTextOf(row({ injected: ['first', 'second'] }), new Map());
    expect(resolved.text).toBe('first\nsecond');
  });

  it('rebuilds from the store when the artefact predates the rendered field', () => {
    const resolved = packTextOf(
      row({ packIdList: ['k1', 'k2'] }),
      new Map([
        ['k1', rule('k1', 'a rule', 'when the column is numeric')],
        ['k2', rule('k2', 'another rule')],
      ]),
    );
    expect(resolved.source).toBe('reconstructed');
    expect(resolved.text).toBe('a rule when the column is numeric\nanother rule');
  });

  it('reports no text when the ids resolve to nothing', () => {
    expect(packTextOf(row({ packIdList: ['missing'] }), new Map())).toEqual({ text: '', source: 'none' });
  });

  it('reports no text when the question carried no pack at all', () => {
    // The common case on this corpus: 45.1% of dev is untouched by the pack.
    expect(packTextOf(row({ injected: [], packIdList: [] }), new Map())).toEqual({ text: '', source: 'none' });
  });

  it('treats a null field the same as an absent one', () => {
    expect(packTextOf(row({ injected: null, packIdList: null }), new Map()).source).toBe('none');
  });
});

describe('corpusOf', () => {
  it('refuses an artefact with no rows rather than manufacturing an empty corpus', () => {
    expect(() => corpusOf({})).toThrow(/no per_case rows/);
    expect(() => corpusOf({ per_case: null })).toThrow(/no per_case rows/);
    expect(() => corpusOf({ per_case: [] })).toThrow(/no per_case rows/);
  });

  it('computes the diff the other readings consume', () => {
    const corpus = corpusOf({
      per_case: [
        row({ id: 'db#0', predictedSql: 'SELECT count(*) FROM race JOIN atom ON race.id = atom.raceid' }),
        row({ id: 'db#1' }),
      ],
    });
    expect(corpus.cases).toHaveLength(2);
    expect(corpus.cases[0]?.delta.relation).toBe('edited');
    expect(corpus.cases[0]?.delta.ungrounded).toContain('atom');
    expect(corpus.cases[1]?.delta.relation).toBe('unchanged');
  });

  it('carries the two extra columns the mediation needs', () => {
    const corpus = corpusOf({
      per_case: [
        row({ id: 'db#0', execOk: true, injected: ['a rule about atom'] }),
        row({ id: 'db#1', execOk: false }),
      ],
    });
    expect(corpus.mediation[0]?.executed).toBe(true);
    expect(corpus.mediation[0]?.packText).toBe('a rule about atom');
    expect(corpus.mediation[1]?.executed).toBe(false);
  });

  it('treats an absent execOk as unverified rather than as success', () => {
    // The difference matters: `executed` is what licenses calling an imported name real, and an
    // artefact without the field must not silently promote every case into the schema bucket.
    const corpus = corpusOf({ per_case: [row({ execOk: null })] });
    expect(corpus.mediation[0]?.executed).toBe(false);
  });

  it('counts the two provenance gaps so a reader can see how much was reconstructed', () => {
    const corpus = corpusOf({
      per_case: [
        row({ id: 'db#0', injected: ['shown'] }),
        row({ id: 'db#1', packIdList: ['k1'] }),
        row({ id: 'db#2' }),
      ],
      items: [rule('k1', 'stored')],
    });
    expect(corpus.reconstructed).toBe(1);
    expect(corpus.withoutPackText).toBe(1);
  });

  it('passes the artefact timestamp through, and null when it has none', () => {
    expect(corpusOf({ per_case: [row()], generated_at: '2026-11-01T00:00:00.000Z' }).generatedAt).toBe(
      '2026-11-01T00:00:00.000Z',
    );
    expect(corpusOf({ per_case: [row()] }).generatedAt).toBeNull();
  });
});
