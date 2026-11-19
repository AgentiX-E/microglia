import { describe, expect, it } from 'vitest';
import {
  REUSE_EDGES,
  bandLines,
  bandOf,
  censusOf,
  columnReuseOf,
  contentWordsOf,
  overlapOf,
  reuseBandsOf,
  reuseLines,
  reusePairsOf,
  reuseRowsOf,
  verdictOf,
  type ReuseRow,
  type TopBand,
} from '../reuse-ceiling.js';

const row = (
  cluster: string,
  question: string,
  goldSql: string,
  correct: boolean,
  without: boolean,
): ReuseRow => ({ cluster, question, goldSql, correct, withoutMemoryCorrect: without });

describe('contentWordsOf', () => {
  it('drops interrogatives and words shorter than three letters', () => {
    const words = contentWordsOf('What is the highest eligible free rate');
    expect([...words].sort()).toEqual(['eligible', 'free', 'highest', 'rate']);
  });

  it('lower-cases and keeps a repeated word once', () => {
    expect([...contentWordsOf('Cards cards CARDS')]).toEqual(['cards']);
  });

  it('returns nothing for punctuation only', () => {
    expect(contentWordsOf('?! 12 --').size).toBe(0);
  });
});

describe('overlapOf', () => {
  it('scores an empty side as no overlap rather than a perfect one', () => {
    expect(overlapOf(new Set(), new Set(['a']))).toBe(0);
    expect(overlapOf(new Set(['a']), new Set())).toBe(0);
  });

  it('scores identical sets at one and disjoint sets at zero', () => {
    expect(overlapOf(new Set(['a', 'b']), new Set(['b', 'a']))).toBe(1);
    expect(overlapOf(new Set(['a']), new Set(['b']))).toBe(0);
  });

  it('divides by the union, so a contained fragment is not full reuse', () => {
    expect(overlapOf(new Set(['a']), new Set(['a', 'b', 'c']))).toBeCloseTo(1 / 3, 10);
  });
});

describe('columnReuseOf', () => {
  it('reads columns with the tokenizer rather than from backticks', () => {
    // The extractor this replaced saw nothing here, because BIRD does not quote simple columns.
    expect(columnReuseOf('SELECT player_api_id FROM Player_Attributes', 'SELECT player_api_id FROM Player_Attributes')).toBe(1);
  });

  it('reports zero when the two answers share no column', () => {
    expect(columnReuseOf('SELECT a FROM t', 'SELECT b FROM t')).toBe(0);
  });

  it('excludes keywords, tables and aliases from the column sets', () => {
    expect(columnReuseOf('SELECT t.a AS x FROM t LIMIT 1', 'SELECT a FROM t')).toBe(1);
  });
});

describe('reusePairsOf', () => {
  it('counts a database with one case as unpaired rather than as zero reuse', () => {
    const rows = [row('only', 'how many cards', 'SELECT a FROM t', true, true)];
    const { pairs, unpaired } = reusePairsOf(rows);
    expect(pairs).toEqual([]);
    expect(unpaired).toBe(1);
  });

  it('pairs each case with the most similar question in its database', () => {
    const rows = [
      row('db', 'how many cards are there', 'SELECT card_id FROM cards', true, false),
      row('db', 'how many cards were issued', 'SELECT card_id FROM cards', true, true),
      row('db', 'which driver won the race', 'SELECT driver_id FROM results', false, false),
    ];
    const { pairs } = reusePairsOf(rows);
    expect(pairs).toHaveLength(3);
    const cards = pairs.find((pair) => pair.index === 0);
    expect(cards?.source).toBe(1);
    expect(cards?.reuse).toBe(1);
  });

  it('breaks a tie on the source gold query, so the pairing is stable', () => {
    const rows = [
      row('db', 'cards total', 'SELECT a FROM t', true, true),
      row('db', 'cards total', 'SELECT z FROM t', true, true),
      row('db', 'cards total', 'SELECT b FROM t', true, true),
    ];
    const first = reusePairsOf(rows).pairs.map((pair) => pair.source);
    const second = reusePairsOf([...rows].reverse()).pairs.map((pair) => pair.source);
    expect(first).toHaveLength(3);
    expect(second).toHaveLength(3);
    // The case whose own gold text is `SELECT a FROM t` always prefers the `SELECT b` neighbour, because
    // `b` sorts before `z` when everything else ties.
    const aAt = reusePairsOf(rows).pairs.find((pair) => pair.index === 0);
    expect(aAt?.source).toBe(2);
  });

  it('carries the paired gain, not the accuracy', () => {
    const rows = [
      row('db', 'cards total', 'SELECT a FROM t', true, false),
      row('db', 'cards total now', 'SELECT a FROM t', false, false),
    ];
    const { pairs } = reusePairsOf(rows);
    expect(pairs.map((pair) => pair.gain)).toEqual([1, 0]);
  });
});

describe('bandOf', () => {
  it('is closed on the lower edge', () => {
    expect(bandOf(0)).toBe(0);
    expect(bandOf(0.25)).toBe(1);
    expect(bandOf(0.7499)).toBe(2);
    expect(bandOf(0.75)).toBe(3);
    expect(bandOf(1)).toBe(3);
  });
});

describe('reuseBandsOf', () => {
  it('publishes a row for every band even when nothing landed in it', () => {
    const bands = reuseBandsOf([], 50);
    expect(bands).toHaveLength(REUSE_EDGES.length);
    for (const band of bands) {
      expect(band.pairs).toBe(0);
      expect(band.gainPp).toBe(0);
      expect(band.interval).toEqual({ low: 0, high: 0, point: 0, dropped: 0 });
    }
  });

  it('keeps the case count across the bands equal to the pair count', () => {
    const pairs = [
      { cluster: 'a', index: 0, source: 1, reuse: 0.1, gain: 0 },
      { cluster: 'a', index: 1, source: 0, reuse: 0.9, gain: 1 },
      { cluster: 'b', index: 2, source: 3, reuse: 0.9, gain: -1 },
    ];
    const bands = reuseBandsOf(pairs, 100);
    expect(bands.reduce((sum, band) => sum + band.pairs, 0)).toBe(3);
    const top = bands[bands.length - 1];
    expect(top?.pairs).toBe(2);
    expect(top?.gainPp).toBe(0);
    expect(top?.clusters).toBe(2);
  });

  it('gives a single-cluster corpus a zero-width interval at its own value', () => {
    const pairs = [
      { cluster: 'a', index: 0, source: 1, reuse: 0.8, gain: 1 },
      { cluster: 'a', index: 1, source: 0, reuse: 0.8, gain: 1 },
    ];
    const top = reuseBandsOf(pairs, 200)[REUSE_EDGES.length - 1];
    expect(top?.gainPp).toBe(100);
    expect(top?.interval.low).toBe(100);
    expect(top?.interval.high).toBe(100);
  });

  it('is deterministic for a fixed seed', () => {
    const pairs = [
      { cluster: 'a', index: 0, source: 1, reuse: 0.1, gain: 1 },
      { cluster: 'b', index: 2, source: 3, reuse: 0.9, gain: -1 },
      { cluster: 'c', index: 4, source: 5, reuse: 0.9, gain: 1 },
    ];
    expect(reuseBandsOf(pairs, 300, 7)).toEqual(reuseBandsOf(pairs, 300, 7));
  });
});

const corpus = (name: string, gainPp: number, interval: TopBand['interval']): TopBand => ({
  corpus: name,
  cases: 10,
  databases: 2,
  paired: 10,
  unpaired: 0,
  gainPp,
  interval,
  bands: [{ low: 0, high: 0.25, pairs: 5, gainPp: 0 }, { low: 0.75, high: 1, pairs: 5, gainPp }],
});

const clear = (point: number): TopBand['interval'] => ({ low: point - 1, high: point + 1, point, dropped: 0 });
const straddle = (point: number): TopBand['interval'] => ({ low: point - 3, high: point + 3, point, dropped: 0 });

describe('verdictOf', () => {
  it('has nothing to say about no corpus', () => {
    expect(verdictOf([]).label).toBe('null');
  });

  it('says replicates when every corpus keeps a positive sign and clears zero', () => {
    expect(verdictOf([corpus('dev', 2, clear(2)), corpus('train', 3, clear(3))]).label).toBe('replicates');
  });

  it('says replicates when every corpus keeps a negative sign and clears zero', () => {
    expect(verdictOf([corpus('dev', -2, clear(-2)), corpus('train', -3, clear(-3))]).label).toBe('replicates');
  });

  it('says contradicted when the sign flips, even if neither interval clears zero', () => {
    expect(verdictOf([corpus('dev', 2, straddle(2)), corpus('train', -2, straddle(-2))]).label).toBe('contradicted');
  });

  it('says null when the signs agree but the intervals straddle zero', () => {
    expect(verdictOf([corpus('dev', 2, straddle(2)), corpus('train', 2, straddle(2))]).label).toBe('null');
  });

  it('says null when one corpus clears zero and the other does not', () => {
    expect(verdictOf([corpus('dev', 2, clear(2)), corpus('train', 2, straddle(2))]).label).toBe('null');
  });
});

describe('reuseRowsOf', () => {
  const good = { dbId: 'd', question: 'q', goldSql: 'SELECT a FROM t', correct: true, withoutMemoryCorrect: false };

  it('reads a case', () => {
    expect(reuseRowsOf({ per_case: [good] }, 'src')).toEqual([
      { cluster: 'd', question: 'q', goldSql: 'SELECT a FROM t', correct: true, withoutMemoryCorrect: false },
    ]);
  });

  const throws = (artefact: unknown, message: string): void => {
    expect(() => reuseRowsOf(artefact, 'src')).toThrow(message);
  };

  it('refuses an artefact that is not an object', () => {
    throws(null, 'src is not an object, so it has no per_case rows');
  });

  it('refuses an artefact with no per_case array', () => {
    throws({}, 'src carries no per_case array');
  });

  it('refuses a row that is not an object', () => {
    throws({ per_case: [null] }, 'src.per_case[0] is not an object');
  });

  it('refuses a case with no database', () => {
    throws({ per_case: [{ ...good, dbId: '' }] }, 'src.per_case[0] carries no dbId');
  });

  it('refuses a case with no question', () => {
    throws({ per_case: [{ ...good, question: '' }] }, 'src.per_case[0] carries no question');
  });

  it('refuses a case with no gold query', () => {
    throws({ per_case: [{ ...good, goldSql: '' }] }, 'src.per_case[0] carries no goldSql');
  });

  it('refuses a case with one arm missing', () => {
    throws({ per_case: [{ ...good, correct: undefined }] }, "src.per_case[0] does not carry both arms' outcomes");
  });
});

describe('censusOf', () => {
  const rows: ReuseRow[] = [
    row('a', 'how many cards', 'SELECT card_id FROM cards', true, false),
    row('a', 'how many cards issued', 'SELECT card_id FROM cards', true, true),
    row('b', 'which driver won', 'SELECT driver_id FROM results', false, false),
  ];

  it('assembles both corpora with one edge set', () => {
    const census = censusOf(
      [
        { source: 'dev', rows },
        { source: 'train', rows },
      ],
      { resamples: 100 },
    );
    expect(census.id).toBe('reuse');
    expect(census.corpora.map((entry) => entry.corpus)).toEqual(['dev', 'train']);
    expect(census.corpora[0]?.paired).toBe(2);
    expect(census.corpora[0]?.unpaired).toBe(1);
    expect(census.corpora[0]?.databases).toBe(2);
    expect(census.verdict.label).toBeDefined();
  });

  it('defaults its resample count rather than requiring one', () => {
    expect(censusOf([{ source: 'dev', rows }]).corpora).toHaveLength(1);
  });
});

describe('printers', () => {
  it('aligns one band per line under its corpus', () => {
    const lines = bandLines(corpus('dev', 2, clear(2)));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('dev');
    expect(lines[1]).toContain('+2.00pp');
  });

  it('states the verdict on its own line', () => {
    const lines = reuseLines({
      id: 'reuse',
      floor: 5,
      corpora: [corpus('dev', 2, clear(2)), corpus('train', -2, clear(-2))],
      verdict: { label: 'contradicted', reason: 'the sign flipped' },
    });
    expect(lines[0]).toContain('corpus');
    expect(lines[lines.length - 1]).toBe('verdict: contradicted — the sign flipped');
  });

  it('marks a negative reading with a minus sign rather than a hyphen', () => {
    const lines = reuseLines({
      id: 'reuse',
      floor: 5,
      corpora: [corpus('train', -2, clear(-2))],
      verdict: { label: 'null', reason: 'nothing' },
    });
    expect(lines[1]).toContain('−2.00pp');
  });
});
