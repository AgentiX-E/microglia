import { describe, expect, it } from 'vitest';
import {
  TABLE_SIGNALS,
  namedBy,
  orderOf,
  readOrdering,
  recalledTables,
  tableRecallOf,
  type TableQuestion,
} from '../table-recall.js';

const question = (over: Partial<TableQuestion> = {}): TableQuestion => ({
  tables: ['a', 'b', 'c', 'd'],
  gold: ['c'],
  anchors: ['c'],
  recalled: [],
  ...over,
});

describe('namedBy', () => {
  it('takes the anchors for the incumbent signal', () => {
    expect(namedBy('anchors', question({ anchors: ['d', 'b'] }))).toEqual(['d', 'b']);
  });

  it('takes the recalled set for the recall signal, and nothing else', () => {
    expect(namedBy('recalled', question({ anchors: ['a'], recalled: ['d'] }))).toEqual(['d']);
  });

  it('puts recall ahead of anchors, because an anchor is the attempt that already failed', () => {
    expect(namedBy('both', question({ anchors: ['a'], recalled: ['d', 'b'] }))).toEqual(['d', 'b', 'a']);
  });

  it('drops a name the schema does not hold, rather than ordering a table that is not there', () => {
    expect(namedBy('both', question({ anchors: ['a', 'ghost'], recalled: ['phantom'] }))).toEqual(['a']);
  });

  it('de-duplicates a table named by both signals', () => {
    expect(namedBy('both', question({ anchors: ['b'], recalled: ['b'] }))).toEqual(['b']);
  });

  it('is empty when neither signal names anything', () => {
    expect(namedBy('both', question({ anchors: [], recalled: [] }))).toEqual([]);
  });
});

describe('orderOf', () => {
  it('puts the named tables first and keeps the declaration order on both sides of the split', () => {
    expect(orderOf('anchors', question({ anchors: ['d', 'b'] }))).toEqual(['d', 'b', 'a', 'c']);
  });

  it('is the declaration order when nothing is named, which is a real state and not an error', () => {
    expect(orderOf('anchors', question({ anchors: [] }))).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('readOrdering', () => {
  it('is clean when every gold table precedes every non-gold one', () => {
    const reading = readOrdering('anchors', question({ anchors: ['c'] }));
    expect(reading.depth).toBe(1);
    expect(reading.clean).toBe(true);
    expect(reading.hits).toBe(1);
    expect(reading.named).toBe(1);
  });

  it('is not clean when one non-gold table sits in front of a gold one', () => {
    // `a` is named first and the gold table is third: the reader meets two wrong tables first.
    const reading = readOrdering('anchors', question({ anchors: ['a'] }));
    expect(reading.depth).toBe(3);
    expect(reading.clean).toBe(false);
  });

  it('counts depth from the last gold table, which is how much of the schema must be read', () => {
    const reading = readOrdering('both', question({ tables: ['a', 'b', 'c', 'd', 'e'], gold: ['b', 'd'], anchors: ['d'], recalled: ['b'] }));
    expect(reading.depth).toBe(2);
    expect(reading.clean).toBe(true);
  });

  it('matches a name the way SQLite does, case-insensitively', () => {
    // BIRD declares `postHistory` and queries `posthistory`, and does it in 298 of 1,534 dev
    // questions. A case-sensitive instrument reads those as "the gold table is not in the schema",
    // which is a harness defect invented by the measurement.
    const reading = readOrdering('anchors', question({ tables: ['postHistory', 'badges'], gold: ['postHistory'], anchors: ['posthistory'] }));
    expect(reading.gold).toBe(1);
    expect(reading.hits).toBe(1);
    expect(reading.clean).toBe(true);
  });

  it('scores a question whose gold names differ only in case from the schema', () => {
    const reading = tableRecallOf([
      question({ tables: ['postHistory', 'badges'], gold: ['posthistory'], anchors: [] }),
    ]);
    expect(reading.n).toBe(1);
    expect(reading.unscoreable).toBe(0);
  });

  it('cannot be clean when the DDL holds no gold table, and says so rather than scoring zero', () => {
    const reading = readOrdering('anchors', question({ gold: ['elsewhere'] }));
    expect(reading.gold).toBe(0);
    expect(reading.depth).toBe(0);
    expect(reading.clean).toBe(false);
  });

  it('counts a hit only for a named table the gold query reads', () => {
    const reading = readOrdering('anchors', question({ anchors: ['a', 'b'] }));
    expect(reading.named).toBe(2);
    expect(reading.hits).toBe(0);
  });
});

describe('tableRecallOf', () => {
  it('scores only questions with a multi-table schema and a gold table inside it', () => {
    const reading = tableRecallOf([
      question(),
      // One table: clean under every signal, so it would flatter whichever signal it was given.
      question({ tables: ['a'], gold: ['a'], anchors: ['a'] }),
      // The gold table is not in the schema the model was shown, which is a harness defect and not
      // an ordering failure.
      question({ gold: ['elsewhere'] }),
    ]);
    expect(reading.n).toBe(1);
    expect(reading.degenerate).toBe(1);
    expect(reading.unscoreable).toBe(1);
  });

  it('reports every signal against the same questions', () => {
    const reading = tableRecallOf([
      question({ anchors: ['c'], recalled: [] }),
      question({ anchors: ['a'], recalled: ['c'] }),
    ]);
    expect(TABLE_SIGNALS.map((signal) => reading.signals[signal].n)).toEqual([2, 2, 2]);
  });

  it('shows the recall signal winning where the anchor signal names the wrong table', () => {
    const reading = tableRecallOf([
      question({ anchors: ['a'], recalled: ['c'] }),
      question({ anchors: ['b'], recalled: ['c'] }),
    ]);
    expect(reading.signals.anchors.clean).toBe(0);
    expect(reading.signals.recalled.clean).toBe(2);
    expect(reading.signals.both.clean).toBe(2);
    expect(reading.bothVersusAnchors.gained).toBe(2);
    expect(reading.bothVersusAnchors.lost).toBe(0);
  });

  it('computes precision and recall over the tables it moved, not over the questions', () => {
    const reading = tableRecallOf([
      // Two named, one right.
      question({ tables: ['a', 'b', 'c', 'd', 'e'], gold: ['b', 'c'], anchors: ['b', 'a'] }),
    ]);
    expect(reading.signals.anchors.precision).toBe(0.5);
    expect(reading.signals.anchors.recall).toBe(0.5);
    // `b` then `a` then `c`: the last gold table is third of five.
    expect(reading.signals.anchors.meanDepthShare).toBeCloseTo(0.6, 12);
  });

  it('returns zeros rather than NaN for an empty population', () => {
    const reading = tableRecallOf([]);
    expect(reading.n).toBe(0);
    expect(reading.signals.anchors).toEqual({
      n: 0,
      clean: 0,
      cleanShare: 0,
      meanDepthShare: 0,
      precision: 0,
      recall: 0,
    });
  });

  it('reports zero precision when a signal names nothing, which is not the same as being wrong', () => {
    const reading = tableRecallOf([question({ anchors: [] })]);
    expect(reading.signals.anchors.precision).toBe(0);
    expect(reading.signals.anchors.clean).toBe(0);
    expect(reading.signals.anchors.recall).toBe(0);
  });
});

describe('recalledTables', () => {
  const pool = [
    { question: 'how many schools in alameda county', gold: ['frpm', 'schools'] },
    { question: 'how many schools in a county', gold: ['schools'] },
    { question: 'average salary of teachers', gold: ['salaries'] },
  ];

  it('returns nothing when asked for nothing', () => {
    expect(recalledTables('how many schools', pool, 0)).toEqual([]);
  });

  it('unions the gold tables of the nearest neighbours, nearest first', () => {
    expect(recalledTables('how many schools in alameda county', pool, 2)).toEqual(['frpm', 'schools']);
  });

  it('drops a neighbour that shares no token, because a zero similarity is not a weak match', () => {
    expect(recalledTables('teachers salary', pool, 3)).toEqual(['salaries']);
  });

  it('breaks a tie by the pool order, so two runs over the same pool agree', () => {
    const tied = [
      { question: 'aaa bbb', gold: ['x'] },
      { question: 'aaa ccc', gold: ['y'] },
    ];
    // Both share one token with the query; the first in the pool wins.
    expect(recalledTables('aaa zzz', tied, 1)).toEqual(['x']);
  });

  it('never repeats a table two neighbours both read', () => {
    const shared = [
      { question: 'aaa bbb', gold: ['x', 'y'] },
      { question: 'aaa bbb ccc', gold: ['x', 'z'] },
    ];
    expect(recalledTables('aaa bbb', shared, 2)).toEqual(['x', 'y', 'z']);
  });
});
