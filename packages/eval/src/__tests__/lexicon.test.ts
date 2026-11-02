/**
 * The definitional grain's four predicates, each pinned where it could silently go wrong.
 *
 * The two that matter are the boundaries of `occursIn` and the refusal order of `admitLexicon`.
 * A substring match would let a definition speak on a question that never used its term — the exact
 * failure the grain exists to remove — and a refusal that fires in a different order than the one
 * documented would report a reason the artefact then attributes to the wrong stage. The rendering
 * tests pin the budget arithmetic, because a pack that overruns its budget by one character is a
 * pack whose token count no longer matches the field the study reports.
 */
import { describe, expect, it } from 'vitest';
import type { DistillCandidate } from '@agentix-e/microglia-core';
import {
  admitLexicon,
  lexiconGate,
  lexiconPackOf,
  licensedLines,
  looksLikeQuery,
  MAX_TERM,
  MIN_TERM,
  occursIn,
  questionTextOf,
  termOf,
} from '../lexicon.js';

function candidate(statement: string, payload?: unknown): DistillCandidate {
  return {
    namespace: 'bird',
    kind: 'lexicon',
    scope: { task: 'sql.generate', domain: 'california_schools' },
    statement,
    ...(payload === undefined ? {} : { payload: payload as DistillCandidate['payload'] }),
    evidence: { feedbackId: 'f1', runId: 'r1', at: 1, weight: 0.9 },
    trust: 0.9,
    dedupeKey: 'k1',
  };
}

describe('termOf', () => {
  it('reads a term and normalises its whitespace', () => {
    expect(termOf({ term: '  eligible   free rate ' })).toBe('eligible free rate');
  });

  it('refuses a payload that is not an object, or not a term', () => {
    expect(termOf(undefined)).toBeUndefined();
    expect(termOf(null)).toBeUndefined();
    expect(termOf([1, 2])).toBeUndefined();
    expect(termOf({ term: 42 })).toBeUndefined();
    expect(termOf({})).toBeUndefined();
  });

  it('refuses a term at or beyond the length bounds', () => {
    expect(termOf({ term: 'a'.repeat(MIN_TERM - 1) })).toBeUndefined();
    expect(termOf({ term: 'a'.repeat(MIN_TERM) })).toBe('aaa');
    expect(termOf({ term: 'a'.repeat(MAX_TERM + 1) })).toBeUndefined();
  });

  it('refuses a term that is half a sentence', () => {
    expect(termOf({ term: 'the rate. it is computed' })).toBeUndefined();
  });
});

describe('occursIn', () => {
  it('finds a term as words, ignoring case and plural s', () => {
    expect(occursIn('school', 'Which schools are in Alameda County?')).toBe(true);
    expect(occursIn('eligible free rate', 'What is the highest eligible free rate?')).toBe(true);
  });

  it('does not fire inside a longer word', () => {
    // The failure this pins: a definition of `rate` speaking on `separate`.
    expect(occursIn('rate', 'Separate the two columns.')).toBe(false);
    expect(occursIn('rate', 'The rate is a ratio.')).toBe(true);
  });

  it('admits flexible whitespace and regex metacharacters in the term', () => {
    expect(occursIn('free  meal count', 'the Free Meal Count is stored')).toBe(true);
    expect(occursIn('k-12', 'students in K-12 schools')).toBe(true);
  });

  it('never matches an empty term', () => {
    expect(occursIn('   ', 'anything at all')).toBe(false);
  });
});

describe('looksLikeQuery', () => {
  it('recognises a fenced block and a select-from pair', () => {
    expect(looksLikeQuery('use ```sql\nselect 1```')).toBe(true);
    expect(looksLikeQuery('the query SELECT a FROM t returns one row')).toBe(true);
  });

  it('admits an expression without a statement', () => {
    expect(looksLikeQuery('the rate denotes `Free Meal Count` / `Enrollment`')).toBe(false);
  });
});

describe('admitLexicon', () => {
  const question = 'What is the highest eligible free rate for K-12 students in Alameda County?';

  it('admits a definition whose term the question uses', () => {
    const verdict = admitLexicon(
      candidate('"eligible free rate" denotes free meal count divided by enrollment.', {
        term: 'eligible free rate',
      }),
      question,
    );
    expect(verdict).toEqual({
      admitted: true,
      entry: {
        term: 'eligible free rate',
        statement: '"eligible free rate" denotes free meal count divided by enrollment.',
      },
    });
  });

  it('refuses in the documented order: no term, then the licence, then the query screen', () => {
    expect(admitLexicon(candidate('anything'), question)).toEqual({
      admitted: false,
      reason: 'no-term',
    });
    expect(admitLexicon(candidate('anything', { term: 'absent phrase' }), question)).toEqual({
      admitted: false,
      reason: 'term-not-in-question',
    });
    expect(
      admitLexicon(candidate('select a from t', { term: 'eligible free rate' }), question),
    ).toEqual({ admitted: false, reason: 'looks-like-query' });
  });
});

describe('lexiconPackOf', () => {
  const entries = [
    { term: 'rate', statement: 'a ratio of two counts' },
    { term: 'eligible free rate', statement: 'free meal count over enrollment' },
    { term: 'county', statement: 'a county-level region' },
  ];

  it('orders by term length so the specific entry wins the budget', () => {
    const pack = lexiconPackOf(entries, 'the eligible free rate in each county', 1_000);
    expect(pack.terms).toEqual(['eligible free rate', 'county', 'rate']);
    expect(pack.chars).toBe(pack.lines.join('\n').length);
    expect(pack.dropped).toBe(0);
    expect(pack.unlicensed).toBe(0);
  });

  it('drops without truncating when the budget runs out', () => {
    const first = '- "eligible free rate": free meal count over enrollment';
    const second = '- "county": a county-level region';
    const pack = lexiconPackOf(
      entries,
      'the eligible free rate in each county',
      first.length + 1 + second.length,
    );
    expect(pack.lines).toEqual([first, second]);
    expect(pack.dropped).toBe(1);
    expect(pack.chars).toBe(first.length + 1 + second.length);
  });

  it('breaks a length tie alphabetically, so two runs render the same prompt', () => {
    const tied = [
      { term: 'county', statement: 'a region' },
      { term: 'school', statement: 'a school' },
    ];
    const pack = lexiconPackOf(tied, 'the county and the school', 1_000);
    expect(pack.terms).toEqual(['county', 'school']);
  });

  it('counts the entries the question did not licence', () => {
    const pack = lexiconPackOf(entries, 'the rate', 1_000);
    expect(pack.terms).toEqual(['rate']);
    expect(pack.unlicensed).toBe(2);
  });

  it('returns an empty pack rather than a partial line', () => {
    const pack = lexiconPackOf(entries, 'the eligible free rate', 10);
    expect(pack.lines).toEqual([]);
    expect(pack.terms).toEqual([]);
    expect(pack.chars).toBe(0);
    // Both `rate` and `eligible free rate` are licensed by that question; neither fits.
    expect(pack.dropped).toBe(2);
  });
});

describe('questionTextOf', () => {
  it('accepts the two shapes the lanes send', () => {
    expect(questionTextOf('How many schools are there?')).toBe('How many schools are there?');
    expect(questionTextOf({ question: 'How many schools?' })).toBe('How many schools?');
    expect(questionTextOf({ text: 'by text' })).toBe('by text');
    expect(questionTextOf({ prompt: 'by prompt' })).toBe('by prompt');
  });

  it('returns the empty string rather than undefined', () => {
    expect(questionTextOf(undefined)).toBe('');
    expect(questionTextOf(null)).toBe('');
    expect(questionTextOf(7)).toBe('');
    expect(questionTextOf({ other: 'x' })).toBe('');
  });
});

describe('licensedLines', () => {
  it('checks every rendered term against the question', () => {
    const lines = ['- "county": a region', '- "eligible free rate": a ratio'];
    expect(licensedLines(lines, 'the eligible free rate by county')).toEqual({
      checked: 2,
      unlicensed: [],
    });
    expect(licensedLines(lines, 'the eligible free rate')).toEqual({
      checked: 2,
      unlicensed: ['county'],
    });
  });

  it('ignores a line it cannot read a term from, and counts nothing', () => {
    expect(licensedLines(['a line with no term'], 'anything')).toEqual({
      checked: 0,
      unlicensed: [],
    });
  });
});

describe('lexiconGate', () => {
  it('passes only when the store, the renderer and the licence all held', () => {
    const gate = lexiconGate({ entries: 40, lines: 900, checked: 900, unlicensed: 0, refused: {} });
    expect(gate.id).toBe('V64-lexicon-is-licensed');
    expect(gate.pass).toBe(true);
    expect(gate.blocking).toBe(true);
    expect(gate.actual).toContain('refused(none)');
  });

  it('fails on an empty store, an empty pack, an unreadable line, or an unlicensed term', () => {
    const base = { entries: 40, lines: 900, checked: 900, unlicensed: 0, refused: {} };
    expect(lexiconGate({ ...base, entries: 0 }).pass).toBe(false);
    expect(lexiconGate({ ...base, lines: 0, checked: 0 }).pass).toBe(false);
    expect(lexiconGate({ ...base, checked: 899 }).pass).toBe(false);
    expect(lexiconGate({ ...base, unlicensed: 1 }).pass).toBe(false);
  });

  it('writes the refusal reasons into the gate in a stable order', () => {
    const gate = lexiconGate({
      entries: 3,
      lines: 4,
      checked: 4,
      unlicensed: 0,
      refused: { 'no-term': 2, 'term-not-in-question': 1 },
    });
    expect(gate.actual).toContain('no-term=2, term-not-in-question=1');
    expect(gate.pass).toBe(true);
  });
});
