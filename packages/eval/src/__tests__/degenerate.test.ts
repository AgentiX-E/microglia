/**
 * Degenerate inputs for the evaluation package.
 *
 * The study is the instrument behind every published number, so it must be
 * honest at the edges: an empty corpus, a lost case, a rule with no payload. A
 * metric that throws on an empty holdout would make a failed run look like a
 * crash instead of a zero.
 */
import { describe, expect, it } from 'vitest';
import { createKnowledgeItem, defaultPolicy } from '@agentix-e/microglia-core';
import type { KnowledgeItem } from '@agentix-e/microglia-core';
import { comparePaired } from '../stats.js';
import { knowledgePrecision, runStudy, type ArmResult, type StudyResult } from '../study.js';
import { renderMarkdown, summarise } from '../report.js';
import { buildCorpus, resolveDomain, resolveRegistry } from '../scenario.js';

const AT = 1_700_000_000_000;

/** A frozen ablation block, so a report can be rendered without running one. */
const ABLATIONS = {
  credit: { failures: 4, injectedWith: false, injectedWithout: true, statusWith: 'candidate', statusWithout: 'active' },
  contradiction: { activeWith: 1, activeWithout: 2, charsWith: 400, charsWithout: 700 },
  diversity: { distinctWith: 4, distinctWithout: 1, size: 4 },
} as const;

describe('paired comparison with a loss', () => {
  it('counts a case the treatment broke', () => {
    const result = comparePaired([true, true, false], [true, false, false]);
    expect(result).toMatchObject({ n: 3, lost: 1, gained: 0 });
    expect(result.delta).toBeLessThan(0);
  });
});

describe('a study over an empty corpus', () => {
  it('returns zeros instead of throwing', async () => {
    const result = await runStudy({
      seed: 7,
      trainSize: 0,
      holdoutSize: 0,
      rounds: 0,
      batchSize: 0,
      budget: 400,
      heldOutDomain: 'ops',
    });
    const full = result.arms.find((arm) => arm.name === 'full');
    expect(full?.finalAccuracy).toBe(0);
    expect(full?.holdout).toEqual([]);
    expect(full?.byDomain).toEqual([]);
    expect(full?.rounds).toHaveLength(1);
    expect(full?.rounds[0]?.meanTokens).toBe(0);
    expect(full?.rounds[0]?.p95Ms).toBe(0);
    expect(result.corpus).toEqual({ train: 0, holdout: 0 });
    // A gate that cannot pass must fail, not disappear.
    expect(result.gates.length).toBeGreaterThanOrEqual(11);
    expect(result.gates.some((gate) => !gate.pass)).toBe(true);
  }, 60_000);
});

describe('knowledge precision probe grid', () => {
  function active(payload: unknown): KnowledgeItem {
    return createKnowledgeItem(
      {
        namespace: 'acme',
        kind: 'constraint',
        scope: { task: 'chart.recommend', intent: 'trend' },
        statement: 'probe',
        payload: payload as never,
        evidence: { feedbackId: 'fb', runId: 'r', at: AT, weight: 0.9 },
        trust: 0.9,
        dedupeKey: 'k',
      },
      defaultPolicy,
      AT,
      'k',
    );
  }

  it('counts nothing for an item without a payload', () => {
    const item = { ...active(undefined), payload: undefined };
    expect(knowledgePrecision([item])).toEqual({ value: 0, evaluated: 0 });
  });

  it('skips a payload that is missing its condition or its conclusion', () => {
    expect(knowledgePrecision([active({ then: { mark: 'line' } })])).toEqual({
      value: 0,
      evaluated: 0,
    });
    expect(knowledgePrecision([active({ when: { intent: 'trend' } })])).toEqual({
      value: 0,
      evaluated: 0,
    });
  });

  it('probes every intent and domain when the rule is global', () => {
    // One global rule is evaluated against 7 intents x 4 domains x 2 cardinalities.
    const result = knowledgePrecision([active({ when: {}, then: { mark: 'line' } })]);
    expect(result.evaluated).toBe(56);
    // Only `trend` is a line: 4 domains x 2 cardinalities = 8 of the 56 probes.
    expect(result.value).toBeCloseTo(8 / 56, 10);
  });
});

describe('report rendering of a regression', () => {
  const arm = (name: ArmResult['name'], accuracy: number): ArmResult => ({
    // The first arm has a round, the second does not: the learning curve must
    // render a dash for the missing cell instead of shifting the table.

    name,
    config: {
      name,
      useMemory: name !== 'baseline',
      noiseRate: 0,
      poisonEvery: 0,
      generalize: true,
      poisonTrust: 0,
    },
    rounds:
      name === 'baseline'
        ? [
            {
              round: 0,
              accuracy,
              correct: [true, false],
              active: 1,
              candidates: 0,
              quarantined: 0,
              conflicted: 0,
              retired: 0,
              meanTokens: 90,
              p50Ms: 0.1,
              p95Ms: 0.2,
            },
          ]
        : [],
    holdout: [],
    byDomain: [],
    finalAccuracy: accuracy,
    precision: { value: 1, evaluated: 10 },
    untrustedActive: 0,
    active: 3,
    quarantined: 0,
    conflicted: 0,
    knowledge: 3,
  });

  it('prints a negative delta without a leading plus and a missing domain as a dash', () => {
    const result: StudyResult = {
      config: {
        seed: 1,
        trainSize: 10,
        holdoutSize: 4,
        rounds: 1,
        batchSize: 2,
        budget: 600,
        heldOutDomain: 'ops',
      },
      corpus: { train: 10, holdout: 4 },
      arms: [arm('baseline', 0.5), arm('full', 0.25)],
      comparisons: {
        full: {
          n: 4,
          delta: -0.25,
          baselineAccuracy: 0.5,
          treatmentAccuracy: 0.25,
          gained: 0,
          lost: 1,
          p: 1,
          ci: { low: -0.5, high: 0, point: -0.25 },
        },
      },
      leakage: 0,
      diagnosis: undefined,
      competitors: {
        factStore: { name: 'fact-store', accuracy: 0.56, delta: 0.24, p: 0.001, facts: 16, untrustedFacts: 0 },
        factStorePoisoned: { name: 'fact-store-poisoned', accuracy: 0.2, delta: -0.12, p: 0.003, facts: 16, untrustedFacts: 8 },
      },
      ablations: ABLATIONS,
      gates: [{ id: 'G1', criterion: 'lift', actual: '-25.00pp', pass: false, blocking: true }],
    };
    const markdown = renderMarkdown(result);
    expect(markdown).toContain('-25.00pp');
    expect(markdown).not.toContain('+-25.00pp');
    // No domain rows at all: the header still renders and the body is empty
    // rather than claiming coverage the arms do not have.
    expect(markdown).toContain('## Held-out domain');
    // The second arm has no round 0, so its learning-curve cell is a dash.
    expect(markdown).toMatch(/\| 0 \| 50\.00% \| — \|/);
  });
});

describe('domain registry validation', () => {
  const fields = [
    { name: 'when', role: 'temporal' as const },
    { name: 'a', role: 'category' as const },
    { name: 'b', role: 'category' as const },
    { name: 'm', role: 'measure' as const },
    { name: 'n', role: 'measure' as const },
  ];

  it('rejects a domain that cannot support train and holdout columns', () => {
    // A single category (or measure) would make the holdout question identical
    // to the training question, so the registry is refused rather than sampled.
    expect(() =>
      resolveDomain({ name: 'one-cat', fields: fields.filter((f) => f.name !== 'b') }),
    ).toThrow(/MG_E_SCHEMA_INVALID/);
    expect(() =>
      resolveDomain({ name: 'one-measure', fields: fields.filter((f) => f.name !== 'n') }),
    ).toThrow(/MG_E_SCHEMA_INVALID/);
  });

  it('rejects a domain with no temporal field', () => {
    expect(() =>
      resolveDomain({ name: 'timeless', fields: fields.filter((f) => f.name !== 'when') }),
    ).toThrow(/MG_E_SCHEMA_INVALID/);
  });

  it('rejects an empty registry', () => {
    expect(() => resolveRegistry([])).toThrow(/MG_E_SCHEMA_INVALID/);
  });

  it('samples a well-formed custom registry', () => {
    const items = buildCorpus(1, 3, 'train', [{ name: 'custom', fields }]);
    expect(items).toHaveLength(3);
    expect(items.every((item) => item.query.domain === 'custom')).toBe(true);
    // Train and holdout must use different columns of the same schema.
    const holdout = buildCorpus(1, 3, 'holdout', [{ name: 'custom', fields }]);
    expect(holdout[0]?.query.field).not.toBe(items[0]?.query.field);
    expect(holdout[0]?.query.category).not.toBe(items[0]?.query.category);
  });

  it('stops exactly at the requested count when it is not a multiple of the registry', () => {
    const items = buildCorpus(2, 5, 'train');
    expect(items).toHaveLength(5);
    expect(new Set(items.map((item) => item.query.domain)).size).toBe(4);
  });
});

describe('gate summary', () => {
  it('prints PASS when every blocking gate passes', () => {
    const result: StudyResult = {
      config: {
        seed: 1,
        trainSize: 0,
        holdoutSize: 0,
        rounds: 0,
        batchSize: 0,
        budget: 0,
        heldOutDomain: 'ops',
      },
      corpus: { train: 0, holdout: 0 },
      arms: [],
      comparisons: {},
      leakage: 0,
      diagnosis: undefined,
      competitors: {
        factStore: { name: 'fact-store', accuracy: 0.56, delta: 0.24, p: 0.001, facts: 16, untrustedFacts: 0 },
        factStorePoisoned: { name: 'fact-store-poisoned', accuracy: 0.2, delta: -0.12, p: 0.003, facts: 16, untrustedFacts: 8 },
      },
      ablations: ABLATIONS,
      gates: [{ id: 'G1', criterion: 'c', actual: '0', pass: true, blocking: true }],
    };
    expect(summarise(result)).toContain('blocking-gates=PASS');
  });
});

describe('poison construction', () => {
  it('asserts a chart type that is neither the gold nor the model output', async () => {
    const { poisonMark } = await import('../study.js');
    const { INTENTS, baselineMark, goldMark } = await import('../scenario.js');
    for (const intent of INTENTS) {
      for (const count of [4, 8]) {
        const gold = goldMark(intent, count);
        const baseline = baselineMark(intent, 'sales');
        const poison = poisonMark(intent);
        // An equal-to-gold poison would be a correct correction and an
        // equal-to-baseline poison would produce an empty edit; either would
        // make the arm measure nothing.
        expect(poison).not.toBe(gold);
        expect(poison).not.toBe(baseline);
      }
    }
  });
});
