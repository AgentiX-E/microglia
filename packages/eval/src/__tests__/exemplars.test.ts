import { describe, expect, it } from 'vitest';
import {
  exemplarGate,
  exemplarIndexOf,
  nearestExemplars,
  renderExemplars,
  summariseExemplars,
  type ExemplarRow,
  type RenderedExemplars,
} from '../exemplars.js';

const rows: readonly ExemplarRow[] = [
  { db: 'a', question: 'How many schools are in Alameda county', sql: 'SELECT count(*) FROM schools' },
  { db: 'a', question: 'How many schools are in Fresno county', sql: 'SELECT count(*) FROM schools WHERE county = "Fresno"' },
  { db: 'a', question: 'List the drivers who finished first', sql: 'SELECT driverId FROM results ORDER BY position' },
  { db: 'b', question: 'How many schools are in Alameda county', sql: 'SELECT 1' },
];

describe('exemplarIndexOf', () => {
  it('groups the pool by database and keeps the caller order', () => {
    const index = exemplarIndexOf(rows);
    expect([...index.keys()].sort()).toEqual(['a', 'b']);
    expect(index.get('a')?.map((entry) => entry.question)).toEqual([
      'How many schools are in Alameda county',
      'How many schools are in Fresno county',
      'List the drivers who finished first',
    ]);
  });

  it('keeps an empty pool out of the index rather than storing an empty bucket', () => {
    // Absence is the state the arm records: a database with no training rows is a question the arm
    // cannot fire on, and the summary counts it instead of hiding it behind an empty array.
    expect(exemplarIndexOf([]).size).toBe(0);
  });
});

describe('nearestExemplars', () => {
  const index = exemplarIndexOf(rows);

  it('never offers a question from another database, however well it matches', () => {
    // `db = c` has no training rows at all, and the perfect lexical match lives in `b`. Offering it
    // would teach the model a query whose tables do not exist in this schema.
    expect(nearestExemplars(index, 'c', 'How many schools are in Alameda county', 3)).toEqual([]);
  });

  it('ranks by lexical overlap, not by pool order', () => {
    const picked = nearestExemplars(index, 'a', 'How many schools are in Fresno county', 2);
    expect(picked[0]?.question).toBe('How many schools are in Fresno county');
    expect(picked[1]?.question).toBe('How many schools are in Alameda county');
  });

  it('stops at k and at the pool, whichever is smaller', () => {
    expect(nearestExemplars(index, 'a', 'schools in Fresno county', 1)).toHaveLength(1);
    // Two of the three rows in `a` share a word with this query; the third (`drivers`) does not and
    // is not offered, so the pool bound is only visible on an index where every row overlaps.
    expect(nearestExemplars(index, 'a', 'schools in Fresno county', 99)).toHaveLength(2);
    const overlap = exemplarIndexOf([
      { db: 'y', question: 'alpha one', sql: 'SELECT 1' },
      { db: 'y', question: 'alpha two', sql: 'SELECT 2' },
      { db: 'y', question: 'alpha three', sql: 'SELECT 3' },
    ]);
    expect(nearestExemplars(overlap, 'y', 'alpha', 99)).toHaveLength(3);
  });

  it('offers nothing when no training question shares a word with this one', () => {
    // "the three nearest" when nothing is near is three unrelated queries, which is noise wearing
    // the name of guidance.
    expect(nearestExemplars(index, 'a', 'zzz qqq', 3)).toEqual([]);
  });

  it('breaks ties by the pool order, so a replay shows the same examples', () => {
    const tied = exemplarIndexOf([
      { db: 'x', question: 'alpha beta', sql: 'SELECT 1' },
      { db: 'x', question: 'alpha beta', sql: 'SELECT 2' },
    ]);
    // Both score identically against the query; the first wins both times, which is what a
    // deterministic prompt requires.
    expect(nearestExemplars(tied, 'x', 'alpha beta', 1)[0]?.sql).toBe('SELECT 1');
    expect(nearestExemplars(tied, 'x', 'alpha beta', 1)[0]?.sql).toBe('SELECT 1');
  });

  it('treats a non-positive k as no request', () => {
    expect(nearestExemplars(index, 'a', 'schools in Fresno county', 0)).toEqual([]);
    expect(nearestExemplars(index, 'a', 'schools in Fresno county', -3)).toEqual([]);
  });
});

describe('renderExemplars', () => {
  const two = [
    { question: 'How many schools', sql: 'SELECT count(*) FROM schools' },
    { question: 'Which county', sql: 'SELECT county FROM schools' },
  ];

  it('renders the question and its query, separated so the model can tell them apart', () => {
    expect(renderExemplars(two.slice(0, 1), 400).text).toBe(
      'Question: How many schools\nSQL: SELECT count(*) FROM schools',
    );
  });

  it('keeps every exemplar when the budget is not a constraint', () => {
    const rendered = renderExemplars(two, 400);
    expect(rendered.kept).toBe(2);
    expect(rendered.dropped).toBe(0);
    expect(rendered.text).toContain('Which county');
  });

  it('drops the tail rather than truncating a statement', () => {
    // The cap is 60: the first block is 58 characters, the second would cost 60 more. A renderer
    // that clipped the second would ship `SELECT county FROM` and invite the model to copy it.
    const rendered = renderExemplars(two, 70);
    expect(rendered.kept).toBe(1);
    expect(rendered.dropped).toBe(1);
    expect(rendered.text).toBe('Question: How many schools\nSQL: SELECT count(*) FROM schools');
    expect(rendered.text).not.toContain('SELECT county');
  });

  it('counts the separator in the budget, so the block cannot exceed it after joining', () => {
    const rendered = renderExemplars(two, 10_000);
    expect(rendered.chars).toBe(rendered.text.length);
    const tight = renderExemplars(two, rendered.chars);
    expect(tight.kept).toBe(2);
    expect(tight.chars).toBeLessThanOrEqual(rendered.chars);
  });

  it('reports an empty block when the budget cannot hold even one exemplar', () => {
    const rendered = renderExemplars(two, 5);
    expect(rendered).toEqual({ text: '', kept: 0, dropped: 2, chars: 0 });
  });

  it('trims the ends of a question and a query the corpus stored with whitespace', () => {
    const rendered = renderExemplars([{ question: ' q \n', sql: ' SELECT 1\n' }], 400);
    expect(rendered.text).toBe('Question: q\nSQL: SELECT 1');
  });
});

describe('summariseExemplars', () => {
  it('reports the share that fired and the mean size of what fired', () => {
    const summary = summariseExemplars(
      [
        { text: 'a'.repeat(100), kept: 3, dropped: 0, chars: 100 },
        { text: '', kept: 0, dropped: 3, chars: 0 },
        { text: 'b'.repeat(200), kept: 2, dropped: 1, chars: 200 },
      ],
      3,
      1200,
    );
    expect(summary.asked).toBe(3);
    expect(summary.fired).toBe(2);
    expect(summary.firedShare).toBe(0.6667);
    expect(summary.meanChars).toBe(100);
    expect(summary.droppedQuestions).toBe(2);
    expect(summary.droppedShare).toBe(0.6667);
    expect(summary).toMatchObject({ k: 3, budget: 1200 });
  });

  it('reports zeros rather than NaN for an arm that was never planned', () => {
    // A dispatch whose arm list omitted `examples` must not poison every downstream average with a
    // NaN; it must say the arm was not run, which is what a zero share over zero questions is.
    const summary = summariseExemplars([], 3, 1200);
    expect(summary).toMatchObject({ asked: 0, fired: 0, firedShare: 0, meanChars: 0, droppedShare: 0 });
  });
});

describe('exemplarGate', () => {
  const render = (fired: boolean, dropped = 0): RenderedExemplars =>
    fired
      ? { text: 'Question: q\nSQL: SELECT 1', kept: 1, dropped, chars: 25 }
      : // Nothing was found for this question: no neighbour shared a word with it, so the block is
        // empty because the corpus had nothing, not because the budget refused it.
        { text: '', kept: 0, dropped: 0, chars: 0 };

  it('passes when the arm fired everywhere and never hit the cap', () => {
    const gate = exemplarGate(summariseExemplars([render(true), render(true)], 3, 1200));
    expect(gate).toMatchObject({ id: 'V75-exemplars-delivered', pass: true, blocking: true });
    expect(gate.actual).toContain('fired=2');
  });

  it('fails when the arm was configured and planned nothing', () => {
    // A vacuous pass would be the worst outcome here: an arm silently dropped by the fold would
    // publish a delta as `none` under a second name, and the gate would have signed it.
    const gate = exemplarGate(summariseExemplars([], 3, 1200));
    expect(gate.pass).toBe(false);
    expect(gate.actual).toContain('asked=0');
  });

  it('fails one question below the registered firing floor', () => {
    // 4 of 5 is the floor exactly; 3 of 5 is below it.
    const atFloor = exemplarGate(summariseExemplars([render(true), render(true), render(true), render(true), render(false)], 3, 1200));
    expect(atFloor.pass).toBe(true);
    const below = exemplarGate(summariseExemplars([render(true), render(true), render(true), render(false), render(false)], 3, 1200));
    expect(below.pass).toBe(false);
    expect(below.actual).toContain('(60.00%)');
  });

  it('fails when the cap is hit on more than 5% of questions', () => {
    // One question in twenty is the floor exactly; two is above it.
    const atFloor = Array.from({ length: 20 }, (_, index) => render(true, index === 0 ? 1 : 0));
    expect(exemplarGate(summariseExemplars(atFloor, 3, 1200)).pass).toBe(true);
    const over = atFloor.map((entry, index) => (index === 1 ? render(true, 1) : entry));
    expect(exemplarGate(summariseExemplars(over, 3, 1200)).pass).toBe(false);
  });

  it('names the budget and the k it was measured at, so a later reader can tell which arm ran', () => {
    const gate = exemplarGate(summariseExemplars([render(true)], 3, 1200));
    expect(gate.actual).toContain('k=3');
    expect(gate.actual).toContain('budget=1200');
  });
});
