import { describe, expect, it } from 'vitest';
import type { KnowledgeItem } from '@agentix-e/microglia-core';
import {
  conditionText,
  creditedWith,
  embeddingText,
  pairsOf,
  separationOf,
  type CaseRecord,
} from '../embed-probe.js';

const item = (overrides: Partial<KnowledgeItem> = {}): KnowledgeItem =>
  ({
    schema: 'microglia.knowledge/1',
    id: 'k1',
    namespace: 'acme',
    kind: 'constraint',
    scope: { task: 'sql.generate', domain: 'formula_1' },
    statement: 'Races are identified by name.',
    evidence: [],
    support: 1,
    contradictions: 0,
    confidence: 0.9,
    trust: 0.9,
    validFrom: 0,
    validUntil: Infinity,
    systemFrom: 0,
    systemUntil: Infinity,
    status: 'active',
    applied: 0,
    succeeded: 0,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  }) as KnowledgeItem;

const question = (overrides: Partial<CaseRecord> = {}): CaseRecord => ({
  question: 'how many students are there',
  correct: true,
  withoutMemoryCorrect: true,
  packIdList: ['k1'],
  ...overrides,
});

describe('creditedWith', () => {
  it('credits a loss to every rule that was in context', () => {
    const cases = [
      question({ correct: false, withoutMemoryCorrect: true, packIdList: ['k1', 'k2'] }),
      question({ correct: false, withoutMemoryCorrect: true, packIdList: ['k1'] }),
    ];
    const credited = creditedWith(cases);
    expect(credited.hurt.sort()).toEqual(['k1', 'k2']);
    expect(credited.helped).toEqual([]);
  });

  it('credits a gain, and ignores a question whose verdict did not change', () => {
    const cases = [
      question({ correct: true, withoutMemoryCorrect: false, packIdList: ['k3'] }),
      question({ correct: true, withoutMemoryCorrect: true, packIdList: ['k4'] }),
      question({ correct: false, withoutMemoryCorrect: false, packIdList: ['k5'] }),
    ];
    const credited = creditedWith(cases);
    expect(credited.helped).toEqual(['k3']);
    expect(credited.hurt).toEqual([]);
    // k4 and k5 were injected but changed nothing: neither credited nor blamed.
    expect(credited.neutral).toEqual([]);
  });

  it('nets a rule that helped once and hurt once to neutral', () => {
    const cases = [
      question({ correct: true, withoutMemoryCorrect: false, packIdList: ['k6'] }),
      question({ correct: false, withoutMemoryCorrect: true, packIdList: ['k6'] }),
    ];
    expect(creditedWith(cases).neutral).toEqual(['k6']);
  });
});

describe('pairsOf', () => {
  it('emits one pair per question a credited rule travelled with', () => {
    const cases = [
      question({ correct: false, withoutMemoryCorrect: true, packIdList: ['k1', 'k2'] }),
      question({ correct: false, withoutMemoryCorrect: true, packIdList: ['k1'] }),
    ];
    const credited = creditedWith(cases);
    const pairs = pairsOf(cases, credited, () => 0.5);
    expect(pairs).toHaveLength(3);
    expect(pairs.every((pair) => pair.kind === 'hurt')).toBe(true);
  });

  it('carries a helped rule as a helped pair', () => {
    const cases = [question({ correct: true, withoutMemoryCorrect: false, packIdList: ['k7'] })];
    const pairs = pairsOf(cases, creditedWith(cases), () => 0.9);
    expect(pairs).toEqual([{ kind: 'helped', similarity: 0.9 }]);
  });

  it('skips rules that are neither credited nor blamed', () => {
    const cases = [question({ correct: true, withoutMemoryCorrect: true, packIdList: ['k9'] })];
    expect(pairsOf(cases, creditedWith(cases), () => 1)).toEqual([]);
  });
});

describe('separationOf', () => {
  const pairs = (hurtValues: readonly number[], helpedValues: readonly number[]): { kind: 'hurt' | 'helped'; similarity: number }[] => [
    ...hurtValues.map((similarity) => ({ kind: 'hurt' as const, similarity })),
    ...helpedValues.map((similarity) => ({ kind: 'helped' as const, similarity })),
  ];

  it('reports a signal that points the right way', () => {
    const result = separationOf(pairs([0.1, 0.12, 0.11, 0.13, 0.09, 0.1], [0.8, 0.82, 0.79, 0.81, 0.83, 0.8]), {
      resamples: 400,
    });
    expect(result.gap).toBeGreaterThan(0.6);
    expect(result.separated).toBe(true);
    expect(result.hurt.n).toBe(6);
    expect(result.helped.n).toBe(6);
  });

  it('reports no separation when the two groups are the same distribution', () => {
    const overlapping = [0.4, 0.5, 0.6, 0.45, 0.55, 0.5];
    const result = separationOf(pairs(overlapping, overlapping), { resamples: 400 });
    expect(Math.abs(result.gap)).toBeLessThan(0.05);
    expect(result.separated).toBe(false);
  });

  it('detects a signal that points the wrong way', () => {
    const result = separationOf(pairs([0.8, 0.81, 0.79], [0.1, 0.11, 0.09]), { resamples: 400 });
    expect(result.gap).toBeLessThan(0);
    expect(result.separated).toBe(false);
  });

  it('is deterministic for one input', () => {
    const input = pairs([0.1, 0.2, 0.15], [0.3, 0.35, 0.32]);
    expect(separationOf(input, { resamples: 300 }).p).toBe(separationOf(input, { resamples: 300 }).p);
  });

  it('survives an empty group without inventing a result', () => {
    const result = separationOf([]);
    expect(result.p).toBe(1);
    expect(result.separated).toBe(false);
    expect(Number.isNaN(result.gap)).toBe(true);
  });
});

describe('embeddingText', () => {
  it('carries the statement, the scope and the payload, because a retriever sees all three', () => {
    const text = embeddingText({
      id: 'k',
      namespace: 'n',
      kind: 'constraint',
      statement: 'report in thousands',
      scope: { task: 'sql.generate', domain: 'finance' },
      payload: { unit: 'thousands' },
    } as never);
    expect(text).toContain('report in thousands');
    expect(text).toContain('finance');
    expect(text).toContain('thousands');
  });

  it('omits the payload line when there is no payload', () => {
    const text = embeddingText({
      id: 'k',
      namespace: 'n',
      kind: 'constraint',
      statement: 's',
      scope: { task: 't' },
    } as never);
    expect(text.split('\n')).toHaveLength(2);
  });
});

describe('the condition is the text a filter would score', () => {
  it('returns the condition alone, not the claim', () => {
    // `separation` in the probe scores what a retriever ranks on; a filter compares
    // the question with the condition, and mixing the claim into that text would
    // measure the wrong thing.
    expect(conditionText(item({ when: '  when the question names a race  ' }))).toBe(
      'when the question names a race',
    );
    expect(conditionText(item({ when: 'when the question names a race' }))).not.toContain('Races are identified');
  });

  it('is undefined when the item carries no condition', () => {
    expect(conditionText(item())).toBeUndefined();
    expect(conditionText(item({ when: '   ' }))).toBeUndefined();
  });
});
