import { describe, expect, it } from 'vitest';
import {
  buildJudgePrompt,
  buildRefuterPrompt,
  cascadeVerdict,
  evidencedVerdict,
  judgePairs,
  parseJudgeReply,
  parseRefuterReply,
  sampleRows,
  type JudgeInput,
} from '../judge.js';

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

describe('buildRefuterPrompt', () => {
  const refuterInput = {
    question: 'What is the highest eligible free rate for K-12 students in Alameda County?',
    evidence: undefined,
    sql: 'SELECT MAX(rate) FROM frpm',
    columns: ['rate'],
    sample: ['[0.9]'],
    goldSql: 'SELECT rate FROM frpm ORDER BY rate DESC LIMIT 1',
    goldColumns: ['rate'],
    goldSample: ['[0.9]'],
  };

  it('shows both queries and both results', () => {
    const prompt = buildRefuterPrompt(refuterInput);
    expect(prompt).toContain('SELECT MAX(rate) FROM frpm');
    expect(prompt).toContain('SELECT rate FROM frpm ORDER BY rate DESC LIMIT 1');
    expect(prompt).toContain('ITS COLUMNS: rate');
    expect(prompt).toContain('[0.9]');
  });

  it('frames the reference as evidence that can be wrong, which is the whole cascade', () => {
    const prompt = buildRefuterPrompt(refuterInput);
    expect(prompt).toContain('EVIDENCE, NOT A STANDARD ANSWER');
    expect(prompt).toContain('it can itself be wrong');
    expect(prompt).toContain('Do not overturn the query merely because it differs from the');
  });

  it('states what each diagnosis means, so the label is not left to the model to invent', () => {
    const prompt = buildRefuterPrompt(refuterInput);
    expect(prompt).toContain('GOLD_ERROR when the reference is the wrong one');
    expect(prompt).toContain('AMBIGUOUS when both');
    expect(prompt).toContain('COINCIDENTAL when the two queries differ in logic');
  });

  it('marks absent knowledge and absent rows rather than leaving gaps', () => {
    const prompt = buildRefuterPrompt({
      ...refuterInput,
      evidence: '  ',
      columns: [],
      sample: [],
      goldSample: [],
      goldColumns: [],
    });
    expect(prompt).toContain('KNOWLEDGE: (none)');
    expect(prompt).toContain('ITS ROWS:\n(no rows)');
    expect(prompt).toContain('ITS COLUMNS: (none)');
  });

  it('carries the benchmark knowledge when the question has some', () => {
    const prompt = buildRefuterPrompt({ ...refuterInput, evidence: 'rate = free meal count / enrollment' });
    expect(prompt).toContain('KNOWLEDGE: rate = free meal count / enrollment');
  });

  it('truncates long result samples on both sides', () => {
    const long = `[${'y'.repeat(900)}]`;
    const prompt = buildRefuterPrompt({ ...refuterInput, sample: [long], goldSample: [long] });
    expect(prompt.match(/\.\.\./g)?.length).toBe(2);
  });
});

describe('parseRefuterReply', () => {
  it('reads an uphold and an overturn', () => {
    expect(parseRefuterReply('VERDICT: UPHOLD\nDIAGNOSIS: NONE\nREASON: same intent').overturned).toBe(false);
    expect(
      parseRefuterReply('VERDICT: OVERTURN\nDIAGNOSIS: COINCIDENTAL\nREASON: different filter, same rows here')
        .overturned,
    ).toBe(true);
  });

  it('maps each diagnosis spelling', () => {
    expect(parseRefuterReply('VERDICT: OVERTURN\nDIAGNOSIS: GOLD_ERROR').diagnosis).toBe('gold-error');
    expect(parseRefuterReply('VERDICT: OVERTURN\nDIAGNOSIS: AMBIGUOUS').diagnosis).toBe('ambiguous');
    expect(parseRefuterReply('VERDICT: UPHOLD\nDIAGNOSIS: COINCIDENTAL').diagnosis).toBe('coincidental');
  });

  it('defaults the diagnosis to none when the line is missing', () => {
    expect(parseRefuterReply('VERDICT: UPHOLD\nREASON: fine').diagnosis).toBe('none');
  });

  it('leaves an unclear reply unparsed rather than reading it as an objection', () => {
    // An unclear objection is not an objection: if a parse failure could flip a verdict,
    // the prompt's wording would become a scoring parameter.
    const verdict = parseRefuterReply('I am not sure.');
    expect(verdict.overturned).toBeUndefined();
    expect(verdict.stated).toBe('unparsed');
    expect(verdict.rationale).toBe('I am not sure.');
  });

  it('keeps the reason, and caps the fallback text', () => {
    expect(parseRefuterReply('VERDICT: OVERTURN\nREASON: wrong join key').rationale).toBe('wrong join key');
    expect(parseRefuterReply('z'.repeat(400)).rationale).toHaveLength(200);
  });

  it('does not read a verdict out of prose that names both options', () => {
    expect(parseRefuterReply('Could be UPHOLD or OVERTURN.').overturned).toBeUndefined();
  });
});

describe('cascadeVerdict', () => {
  const approved = { correct: true, rationale: '', stated: 'correct' as const };
  const rejected = { correct: false, rationale: '', stated: 'incorrect' as const };
  const unknown = { correct: undefined, rationale: '', stated: 'unknown' as const };
  const uphold = { overturned: false, diagnosis: 'none' as const, rationale: '', stated: 'uphold' as const };
  const overturn = { overturned: true, diagnosis: 'coincidental' as const, rationale: '', stated: 'overturn' as const };
  const unclear = { overturned: undefined, diagnosis: 'none' as const, rationale: '', stated: 'unparsed' as const };

  it('credits a query the prover approved and the refuter could not overturn', () => {
    expect(cascadeVerdict(approved, uphold)).toBe(true);
  });

  it('refuses a query the refuter overturned', () => {
    expect(cascadeVerdict(approved, overturn)).toBe(false);
  });

  it('keeps a prover rejection without asking the refuter', () => {
    expect(cascadeVerdict(rejected, undefined)).toBe(false);
    expect(cascadeVerdict(rejected, uphold)).toBe(false);
  });

  it('has no verdict when the prover stated none, whatever the refuter said', () => {
    expect(cascadeVerdict(unknown, uphold)).toBeUndefined();
    expect(cascadeVerdict(unknown, overturn)).toBeUndefined();
  });

  it('treats an unclear refutation as no refutation', () => {
    expect(cascadeVerdict(approved, unclear)).toBe(true);
  });

  it('returns the prover verdict when the refuter never ran', () => {
    expect(cascadeVerdict(approved, undefined)).toBe(true);
  });
});

describe('evidencedVerdict', () => {
  const approved = { correct: true, rationale: '', stated: 'correct' as const };
  const rejected = { correct: false, rationale: '', stated: 'incorrect' as const };
  const unknown = { correct: undefined, rationale: '', stated: 'unknown' as const };
  const goldError = { overturned: true, diagnosis: 'gold-error' as const, rationale: '', stated: 'overturn' as const };
  const coincidental = { overturned: true, diagnosis: 'coincidental' as const, rationale: '', stated: 'overturn' as const };
  const uphold = { overturned: false, diagnosis: 'none' as const, rationale: '', stated: 'uphold' as const };

  it('vetoes a GOLD_ERROR overturn when the rows agree, because the claim has no evidence', () => {
    expect(evidencedVerdict(approved, goldError, false)).toBe(true);
  });

  it('accepts the same overturn when the rows differ, because then it has evidence', () => {
    expect(evidencedVerdict(approved, goldError, true)).toBe(false);
  });

  it('does not need execution agreement to accept an overturn that is not about the reference', () => {
    // COINCIDENTAL says the two queries return the same rows here by accident, so its
    // claim is the opposite of the one being vetoed and the veto does not apply.
    expect(evidencedVerdict(approved, coincidental, false)).toBe(false);
    expect(evidencedVerdict(approved, coincidental, true)).toBe(false);
  });

  it('leaves everything the plain cascade decides untouched', () => {
    expect(evidencedVerdict(approved, uphold, true)).toBe(true);
    expect(evidencedVerdict(approved, undefined, false)).toBe(true);
    expect(evidencedVerdict(rejected, goldError, false)).toBe(false);
    expect(evidencedVerdict(unknown, goldError, true)).toBeUndefined();
  });
});
