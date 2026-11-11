import { describe, expect, it } from 'vitest';
import {
  DECLINE,
  parseGuidance,
  reconstructPrompt,
  reconstructReading,
} from '../reconstruct.js';

describe('reconstructPrompt', () => {
  const items = [
    { statement: 'filter on the payment status column, not the invoice status' },
    { statement: 'count distinct customers, not rows', when: 'the question says customers' },
    { statement: 'dates are stored as text in YYYY-MM-DD' },
  ];

  it('quotes the notes and the question verbatim', () => {
    // The only thing the writer may add is advice. If the notes were paraphrased here, a difference
    // between the reconstruction and the pack would be partly this function's.
    const prompt = reconstructPrompt('How many customers paid?', 'two tables', items, 240);
    expect(prompt).toContain('1. filter on the payment status column, not the invoice status');
    expect(prompt).toContain('2. count distinct customers, not rows (when the question says customers)');
    expect(prompt).toContain('Question: How many customers paid?');
    expect(prompt).toContain('Evidence:');
  });

  it('omits an evidence block when there is no evidence', () => {
    const prompt = reconstructPrompt('q', '   ', items, 240);
    expect(prompt).not.toContain('Evidence:');
  });

  it('names the budget and the decline word', () => {
    const prompt = reconstructPrompt('q', '', items, 137);
    expect(prompt).toContain('at most 137 characters');
    expect(prompt).toContain(DECLINE);
  });

  it('forbids the three substitutions that would make the arm something else', () => {
    // Restating the notes is the persisted pack under another name; describing the schema is the arm's
    // own input; writing SQL makes it a second answer rather than guidance.
    const prompt = reconstructPrompt('q', '', items, 200);
    expect(prompt).toContain('Do not restate the notes');
    expect(prompt).toContain('do not describe the tables or columns');
    expect(prompt).toContain('do not write');
  });

  it('renders a rule with no condition without an empty parenthesis', () => {
    const prompt = reconstructPrompt('q', '', [{ statement: 'a' }], 100);
    expect(prompt).not.toContain('()');
  });
});

describe('parseGuidance', () => {
  it('keeps advice that fits', () => {
    expect(parseGuidance('  use COUNT(DISTINCT) here  ', 100)).toEqual({
      text: 'use COUNT(DISTINCT) here',
      declined: false,
    });
  });

  it('reads NONE as a decline rather than as advice', () => {
    // Injected verbatim it would be a one-word block that the model is asked to apply, which is not what
    // "declined" means.
    expect(parseGuidance('NONE', 100)).toEqual({ text: '', declined: true });
    expect(parseGuidance('none.', 100)).toEqual({ text: '', declined: true });
    expect(parseGuidance('   ', 100)).toEqual({ text: '', declined: true });
  });

  it('cuts an overshoot at a word boundary rather than mid-token', () => {
    const reply = 'filter on payment status and never on invoice status';
    const parsed = parseGuidance(reply, 20);
    expect(parsed.text).toBe('filter on payment');
    expect(parsed.declined).toBe(false);
  });

  it('cuts at the budget when a single word is longer than it', () => {
    // `lastIndexOf(' ')` is -1 and slicing at -1 would keep the whole reply while reporting a cut.
    expect(parseGuidance('supercalifragilistic', 5).text).toBe('super');
  });

  it('does not treat a reply that starts with the decline word as advice', () => {
    // The writer is asked for one word; "NONE of these apply, but..." is a writer that ignored the
    // instruction, and taking the clause after it would be reading advice out of a refusal.
    expect(parseGuidance('NONE of the notes apply; use DISTINCT', 200).declined).toBe(true);
  });
});

describe('reconstructReading', () => {
  it('splits the population into advice and declines', () => {
    const reading = reconstructReading(
      [
        { text: 'abc', declined: false },
        { text: '', declined: true },
        { text: '', declined: true },
        { text: 'abcdefg', declined: false },
      ],
      240,
    );
    expect(reading).toEqual({ questions: 4, written: 2, declined: 2, meanChars: 5, budget: 240 });
  });

  it('reports a null mean when nothing was written, rather than zero', () => {
    expect(reconstructReading([{ text: '', declined: true }], 240).meanChars).toBeNull();
  });

  it('reports a null mean for an empty pass', () => {
    expect(reconstructReading([], 240)).toEqual({
      questions: 0,
      written: 0,
      declined: 0,
      meanChars: null,
      budget: 240,
    });
  });
});
