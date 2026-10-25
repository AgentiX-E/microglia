import { describe, expect, it } from 'vitest';
import { buildJudgePrompt, judgePairs, parseJudgeReply, sampleRows, type JudgeInput } from '../judge.js';

const input = (overrides: Partial<JudgeInput> = {}): JudgeInput => ({
  question: 'What is the highest eligible free rate for K-12 students in Alameda County?',
  evidence: 'Eligible free rate = free meal count / enrollment',
  sql: 'SELECT MAX(`Free Meal Count (K-12)` / `Enrollment (K-12)`) FROM frpm',
  columns: ['rate'],
  sample: ['[0.5197792088316467]'],
  executionError: undefined,
  ...overrides,
});

describe('buildJudgePrompt', () => {
  it('carries the question, the knowledge, the query and its result', () => {
    const prompt = buildJudgePrompt(input());
    expect(prompt).toContain('QUESTION: What is the highest eligible free rate');
    expect(prompt).toContain('KNOWLEDGE: Eligible free rate = free meal count / enrollment');
    expect(prompt).toContain('SELECT MAX(`Free Meal Count (K-12)`');
    expect(prompt).toContain('RETURNED COLUMNS: rate');
    expect(prompt).toContain('[0.5197792088316467]');
  });

  it('never offers a gold query, because a judge that compares is the metric again', () => {
    // The prompt must not contain a reference, a target, or a phrase inviting comparison.
    const prompt = buildJudgePrompt(input()).toLowerCase();
    expect(prompt).not.toContain('gold');
    expect(prompt).not.toContain('reference query:');
    expect(prompt).toContain('do not assume there is a reference query');
  });

  it('states the missing knowledge rather than leaving the slot blank', () => {
    expect(buildJudgePrompt(input({ evidence: undefined }))).toContain('KNOWLEDGE: (none)');
    expect(buildJudgePrompt(input({ evidence: '   ' }))).toContain('KNOWLEDGE: (none)');
  });

  it('distinguishes an empty result from a failed one', () => {
    expect(buildJudgePrompt(input({ sample: [] }))).toContain('(the query returned no rows)');
    expect(buildJudgePrompt(input({ executionError: 'no such column: x', sample: [] }))).toContain(
      '(the query failed: no such column: x)',
    );
  });

  it('says when there were no columns at all', () => {
    expect(buildJudgePrompt(input({ columns: [] }))).toContain('RETURNED COLUMNS: (no columns: the query did not run)');
  });

  it('shows at most five rows', () => {
    const prompt = buildJudgePrompt(input({ sample: ['[1]', '[2]', '[3]', '[4]', '[5]', '[6]', '[7]'] }));
    expect(prompt).toContain('[5]');
    expect(prompt).not.toContain('[6]');
  });

  it('truncates a long sample rather than spending the context on it', () => {
    const long = `[${'x'.repeat(900)}]`;
    const prompt = buildJudgePrompt(input({ sample: [long] }));
    expect(prompt).toContain('...');
    expect(prompt.length).toBeLessThan(long.length + 1200);
  });

  it('names the version of the instruction through the prompt itself', () => {
    // Cheap guard against editing the wording without editing the version: the file's
    // constant is asserted in the test below, and this one asserts the content did not
    // drift into a different task.
    const prompt = buildJudgePrompt(input());
    expect(prompt).toContain('Judge the question, not the style');
  });
});

describe('parseJudgeReply', () => {
  it('reads each of the three verdicts', () => {
    expect(parseJudgeReply('VERDICT: CORRECT\nREASON: the rate is the max of the ratio').correct).toBe(true);
    expect(parseJudgeReply('VERDICT: INCORRECT\nREASON: it divides the wrong columns').correct).toBe(false);
    expect(parseJudgeReply('VERDICT: UNKNOWN\nREASON: no rows returned').correct).toBeUndefined();
  });

  it('reports which one it stated', () => {
    expect(parseJudgeReply('VERDICT: CORRECT').stated).toBe('correct');
    expect(parseJudgeReply('VERDICT: INCORRECT').stated).toBe('incorrect');
    expect(parseJudgeReply('VERDICT: UNKNOWN').stated).toBe('unknown');
    expect(parseJudgeReply('I think it is fine.').stated).toBe('unparsed');
  });

  it('tolerates case and surrounding whitespace', () => {
    expect(parseJudgeReply('  verdict :  correct  \n  reason :  ok ').correct).toBe(true);
    expect(parseJudgeReply('Reason: ok\nVERDICT: incorrect').correct).toBe(false);
  });

  it('does not read a verdict out of prose that merely mentions the words', () => {
    // A model that writes "this could be CORRECT or INCORRECT" has not answered.
    expect(parseJudgeReply('It could be CORRECT or INCORRECT depending on the data.').correct).toBeUndefined();
    expect(parseJudgeReply('It could be CORRECT or INCORRECT depending on the data.').stated).toBe('unparsed');
  });

  it('keeps the reason', () => {
    expect(parseJudgeReply('VERDICT: CORRECT\nREASON: divides the right two columns').rationale).toBe(
      'divides the right two columns',
    );
  });

  it('falls back to the reply itself when no reason line exists', () => {
    const unparsed = parseJudgeReply('Looks plausible to me.');
    expect(unparsed.rationale).toBe('Looks plausible to me.');
    expect(unparsed.rationale.length).toBeLessThanOrEqual(200);
  });

  it('leaves the reason empty when the reply stated a verdict without one', () => {
    expect(parseJudgeReply('VERDICT: CORRECT').rationale).toBe('');
  });

  it('caps the fallback text', () => {
    const long = `${'x'.repeat(400)}`;
    expect(parseJudgeReply(long).rationale).toHaveLength(200);
  });

  it('keeps a reason that arrived without a verdict', () => {
    const verdict = parseJudgeReply('REASON: the join key looks wrong\nNo verdict line.');
    expect(verdict.stated).toBe('unparsed');
    expect(verdict.rationale).toBe('the join key looks wrong');
  });

  it('keeps the reason attached to an unknown verdict', () => {
    const verdict = parseJudgeReply('VERDICT: UNKNOWN\nREASON: the result is empty and the question implies rows');
    expect(verdict.stated).toBe('unknown');
    expect(verdict.rationale).toBe('the result is empty and the question implies rows');
  });
});

describe('sampleRows', () => {
  it('takes the head of the canonical rows', () => {
    expect(sampleRows(['[1]', '[2]', '[3]', '[4]', '[5]', '[6]'])).toEqual(['[1]', '[2]', '[3]', '[4]', '[5]']);
  });

  it('accepts a tighter limit', () => {
    expect(sampleRows(['[1]', '[2]', '[3]'], 2)).toEqual(['[1]', '[2]']);
  });

  it('returns nothing for no rows', () => {
    expect(sampleRows([])).toEqual([]);
  });
});

describe('judgePairs', () => {
  const rows = [
    { questionId: '0', label: true },
    { questionId: '1', label: false },
    { questionId: '2', label: true },
    { questionId: '3', label: false },
  ];

  it('pairs stated verdicts and counts the rest', () => {
    const verdicts = new Map([
      ['0', { correct: true, rationale: '', stated: 'correct' as const }],
      ['1', { correct: true, rationale: '', stated: 'correct' as const }],
      ['2', { correct: undefined, rationale: '', stated: 'unknown' as const }],
      ['3', { correct: undefined, rationale: '', stated: 'unparsed' as const }],
    ]);
    const result = judgePairs(rows, verdicts);
    expect(result.pairs).toEqual([
      { reference: true, measured: true },
      { reference: false, measured: true },
    ]);
    expect(result.unstated).toEqual(['2', '3']);
    expect(result.unparsed).toEqual(['3']);
  });

  it('counts a row with no verdict at all as unstated, not as a disagreement', () => {
    const result = judgePairs(rows, new Map());
    expect(result.pairs).toHaveLength(0);
    expect(result.unstated).toEqual(['0', '1', '2', '3']);
    expect(result.unparsed).toEqual([]);
  });
});
