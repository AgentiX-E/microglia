import { describe, expect, it } from 'vitest';
import { comparePaired } from '../stats.js';
import { buildGates, knowledgePrecision, type ArmResult, type StudyResult } from '../study.js';
import { applyKnowledge, buildCorpus, specFor } from '../scenario.js';
import { renderJson, renderMarkdown, summarise } from '../report.js';

describe('degenerate comparisons', () => {
  it('handles an empty paired sample', () => {
    const result = comparePaired([], []);
    expect(result).toMatchObject({ n: 0, delta: 0, baselineAccuracy: 0, treatmentAccuracy: 0 });
  });

  it('handles two all-wrong arms', () => {
    const result = comparePaired([false, false], [false, false]);
    expect(result.gained).toBe(0);
    expect(result.lost).toBe(0);
    expect(result.p).toBe(1);
  });
});

describe('gates with missing arms', () => {
  it('fails closed without throwing when no arm exists', () => {
    const gates = buildGates([], {}, 3, 'ops');
    expect(gates.map((gate) => gate.id)).toEqual(
      expect.arrayContaining(['G1', 'G11', 'G15']),
    );
    expect(gates.some((gate) => !gate.pass)).toBe(true);
    expect(gates.find((gate) => gate.id === 'G7')?.pass).toBe(false);
  });
});

describe('report with sparse arms', () => {
  const arm: ArmResult = {
    name: 'full',
    config: {
      name: 'full',
      useMemory: true,
      noiseRate: 0,
      poisonEvery: 0,
      generalize: true,
      poisonTrust: 0,
    },
    rounds: [],
    holdout: [],
    byDomain: [],
    finalAccuracy: 0,
    precision: { value: 0, evaluated: 0 },
    untrustedActive: 0,
    active: 0,
    quarantined: 0,
    conflicted: 0,
    knowledge: 0,
  };

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
    arms: [arm],
    comparisons: {},
    leakage: 1,
    diagnosis: undefined,
    ablations: {
      credit: { failures: 4, injectedWith: false, injectedWithout: true, statusWith: 'candidate', statusWithout: 'active' },
      contradiction: { activeWith: 1, activeWithout: 2, charsWith: 400, charsWithout: 700 },
      diversity: { distinctWith: 4, distinctWithout: 1, size: 4 },
    },
    competitors: {
      factStore: { name: 'fact-store', accuracy: 0.5, delta: 0.18, p: 0.01, facts: 8, untrustedFacts: 0 },
      factStorePoisoned: { name: 'fact-store-poisoned', accuracy: 0.25, delta: -0.07, p: 0.02, facts: 8, untrustedFacts: 4 },
    },
    gates: [
      { id: 'G1', criterion: 'blocking', actual: '0', pass: false, blocking: true },
      { id: 'G2', criterion: 'advisory', actual: '0', pass: false, blocking: false },
    ],
  };

  it('renders placeholders rather than throwing on missing data', () => {
    const markdown = renderMarkdown(result);
    expect(markdown).toContain('—');
    expect(markdown).toContain('WARN');
    expect(markdown).toContain('FAIL');
    expect(markdown).toContain('Blocking gates failing: G1');
  });

  it('summarises a failing run without a comparison', () => {
    const line = summarise(result);
    expect(line).toContain('full=0.00% (—)');
    expect(line).toContain('blocking-gates=G1');
  });

  it('serialises the sparse result', () => {
    expect(() => JSON.parse(renderJson(result))).not.toThrow();
  });
});

describe('scenario specification branches', () => {
  it('builds a spec for every intent', () => {
    const corpus = buildCorpus(5, 28, 'train');
    const intents = new Set(corpus.map((item) => item.query.intent));
    expect(intents.size).toBe(7);

    for (const item of corpus) {
      const spec = specFor(item.query, 'bar');
      expect(spec.mark).toBe('bar');
      expect(typeof spec.x).toBe('string');
    }
  });

  it('uses a series only for a matrix', () => {
    const corpus = buildCorpus(6, 28, 'train');
    const matrix = corpus.find((item) => item.query.intent === 'matrix')!;
    expect(specFor(matrix.query, 'bar')).toHaveProperty('series');
    const trend = corpus.find((item) => item.query.intent === 'trend')!;
    expect(specFor(trend.query, 'bar')).not.toHaveProperty('series');
  });
});

describe('application tie-breaks and domain precision', () => {
  it('falls back to id order when specificity and confidence tie', async () => {
    const { createKnowledgeItem, defaultPolicy } = await import('@agentix-e/microglia-core');
    const make = (id: string) =>
      createKnowledgeItem(
        {
          namespace: 'acme',
          kind: 'constraint',
          scope: { task: 'chart.recommend', intent: 'trend' },
          statement: `rule ${id}`,
          payload: { when: { intent: 'trend' }, then: { mark: 'line' } } as never,
          evidence: { feedbackId: id, runId: 'r', at: 1, weight: 0.9 },
          trust: 0.9,
          dedupeKey: id,
        },
        defaultPolicy,
        1,
        id,
      );
    const pack = { items: [make('b'), make('a')], ids: ['b', 'a'], rendered: '', tokens: 0, hash: 'h', budget: 0, truncated: 0 };
    const item = buildCorpus(9, 7, 'holdout').find((entry) => entry.query.intent === 'trend')!;
    const chosen = applyKnowledge(pack, item);
    expect(chosen.mark).toBe('line');
  });

  it('counts a field dimension in scope size', async () => {
    const { createKnowledgeItem, defaultPolicy } = await import('@agentix-e/microglia-core');
    const global = createKnowledgeItem(
      {
        namespace: 'acme', kind: 'constraint',
        scope: { task: 'chart.recommend', intent: 'trend' },
        statement: 'global',
        payload: { when: { intent: 'trend' }, then: { mark: 'line' } } as never,
        evidence: { feedbackId: 'g', runId: 'r', at: 1, weight: 0.9 }, trust: 0.9, dedupeKey: 'g',
      }, defaultPolicy, 1, 'g',
    );
    const scoped = { ...global, id: 's', scope: { ...global.scope, field: 'revenue' } };
    const item = buildCorpus(10, 7, 'holdout').find((entry) => entry.query.intent === 'trend')!;
    const pack = { items: [global, scoped], ids: ['g', 's'], rendered: '', tokens: 0, hash: 'h', budget: 0, truncated: 0 };
    expect(applyKnowledge(pack, item).mark).toBe('line');
  });

  it('scores a domain-scoped rule across its domain only', async () => {
    const { createKnowledgeItem, defaultPolicy } = await import('@agentix-e/microglia-core');
    const scoped = createKnowledgeItem(
      {
        namespace: 'acme', kind: 'constraint',
        scope: { task: 'chart.recommend', domain: 'finance', intent: 'comparison' },
        statement: 'finance comparison bar',
        payload: { when: { intent: 'comparison', domain: 'finance' }, then: { mark: 'bar' } } as never,
        evidence: { feedbackId: 'f', runId: 'r', at: 1, weight: 0.9 }, trust: 0.9, dedupeKey: 'f',
      }, defaultPolicy, 1, 'f',
    );
    const result = knowledgePrecision([scoped]);
    expect(result.evaluated).toBe(2);
    expect(result.value).toBe(1);
  });
});

describe('confidence tie-break', () => {
  it('prefers the higher-confidence rule at equal specificity', async () => {
    const { createKnowledgeItem, defaultPolicy } = await import('@agentix-e/microglia-core');
    const make = (id: string, weight: number, mark: 'line' | 'scatter') =>
      createKnowledgeItem(
        {
          namespace: 'acme', kind: 'constraint',
          scope: { task: 'chart.recommend', intent: 'trend' },
          statement: `rule ${id}`,
          payload: { when: { intent: 'trend' }, then: { mark } } as never,
          evidence: { feedbackId: id, runId: 'r', at: 1, weight }, trust: 0.9, dedupeKey: id,
        }, defaultPolicy, 1, id,
      );
    const item = buildCorpus(12, 7, 'holdout').find((entry) => entry.query.intent === 'trend')!;
    const pack = {
      items: [make('low', 0.2, 'scatter'), make('high', 0.9, 'line')],
      ids: ['low', 'high'], rendered: '', tokens: 0, hash: 'h', budget: 0, truncated: 0,
    };
    expect(applyKnowledge(pack, item).mark).toBe('line');
  });
});

describe('gates with a single arm', () => {
  it('uses fallbacks for every missing comparison', () => {
    const arm: ArmResult = {
      name: 'baseline',
      config: { name: 'baseline', useMemory: false, noiseRate: 0, poisonEvery: 0, generalize: true, poisonTrust: 0 },
      rounds: [],
      holdout: [],
      byDomain: [],
      finalAccuracy: 0,
      precision: { value: 0, evaluated: 0 },
      untrustedActive: 0,
      active: 0,
      quarantined: 0,
      conflicted: 0,
      knowledge: 0,
    };
    const gates = buildGates([arm], {}, 0, 'ops');
    expect(gates.map((gate) => gate.id)).toEqual(
      expect.arrayContaining(['G1', 'G11', 'G15']),
    );
    expect(gates.find((gate) => gate.id === 'G1')?.pass).toBe(false);
    expect(gates.find((gate) => gate.id === 'G7')?.pass).toBe(true);
  });
});

describe('ablation rendering when the guard fails', () => {
  const failing = {
    credit: { failures: 4, injectedWith: true, injectedWithout: true, statusWith: 'active', statusWithout: 'active' },
    contradiction: { activeWith: 2, activeWithout: 2, charsWith: 700, charsWithout: 700 },
    diversity: { distinctWith: 1, distinctWithout: 1, size: 4 },
  };

  it('renders the pessimistic side of every ablation sentence', () => {
    // A store where credit did *not* withdraw the failing rule still has to
    // render, and the sentence it prints is the one an operator needs to see.
    const markdown = renderMarkdown({
      config: { seed: 1, trainSize: 0, holdoutSize: 0, rounds: 0, batchSize: 0, budget: 0, heldOutDomain: 'ops' },
      corpus: { train: 0, holdout: 0 },
      arms: [],
      comparisons: {},
      leakage: 0,
      diagnosis: undefined,
      ablations: failing,
      competitors: {
        factStore: { name: 'fact-store', accuracy: 0.5, delta: 0.18, p: 0.01, facts: 8, untrustedFacts: 0 },
        factStorePoisoned: { name: 'fact-store-poisoned', accuracy: 0.25, delta: -0.07, p: 0.02, facts: 8, untrustedFacts: 4 },
      },
      gates: [],
    });
    expect(markdown).toContain('still injected after 4 failures');
    expect(markdown).toContain('2 active, 700 chars');
    expect(markdown).toContain('1 distinct of 4');
  });

  it('fails the credit gate when the failing rule survives', () => {
    const gates = buildGates([], {}, 0, 'ops', failing);
    expect(gates.find((gate) => gate.id === 'G12')?.pass).toBe(false);
    expect(gates.find((gate) => gate.id === 'G12')?.actual).toContain('injected');
  });
});
