import { describe, expect, it } from 'vitest';
import { createKnowledgeItem, defaultPolicy, fixedClock } from '@agentix-e/microglia-core';
import type { KnowledgeItem } from '@agentix-e/microglia-core';
import {
  domainByName,
  validateChartSpec,
  type ChartConstraint,
} from '../workload/index.js';
import { applyKnowledge, baselineMark, buildCorpus, goldMark } from '../scenario.js';
import { comparePaired } from '../stats.js';
import {
  DEFAULT_CONFIG,
  L0_CASES,
  L0_CONFIG,
  knowledgePrecision,
  runStudy,
  scoreByDomain,
} from '../study.js';
import { renderMarkdown } from '../report.js';

describe('paired statistics', () => {
  it('counts discordant pairs and reports an exact p-value', () => {
    const baseline = Array.from({ length: 100 }, (_, i) => i < 40);
    const treatment = Array.from({ length: 100 }, (_, i) => i < 70);
    const result = comparePaired(baseline, treatment);
    expect(result.gained).toBe(30);
    expect(result.lost).toBe(0);
    expect(result.delta).toBeCloseTo(0.3, 6);
    expect(result.p).toBeLessThan(0.001);
    expect(result.deltaCI.low).toBeLessThanOrEqual(result.delta);
    expect(result.deltaCI.high).toBeGreaterThanOrEqual(result.delta);
  });

  it('rejects unpaired inputs', () => {
    expect(() => comparePaired([true], [true, false])).toThrow();
  });

  it('reports no difference when the arms agree', () => {
    const same = [true, false, true, false];
    expect(comparePaired(same, same).p).toBe(1);
    expect(comparePaired(same, same).delta).toBe(0);
  });
});

describe('corpus', () => {
  const train = buildCorpus(1, 140, 'train');

  it('produces a legal specification for every gold and baseline chart', () => {
    for (const item of train) {
      const domain = domainByName(item.query.domain);
      expect(domain).toBeDefined();
      expect(validateChartSpec(item.gold, domain!)).toEqual([]);
      expect(validateChartSpec(item.baseline, domain!)).toEqual([]);
    }
  });

  it('changes only the mark between gold and baseline', () => {
    for (const item of train) {
      expect(item.gold.x).toBe(item.baseline.x);
      expect(item.gold.y).toBe(item.baseline.y);
      expect(item.gold.aggregate).toBe(item.baseline.aggregate);
    }
  });

  it('has a documented defect for every intent except ranking', () => {
    expect(goldMark('ranking', 4)).toBe(baselineMark('ranking', 'sales'));
    expect(goldMark('trend', 4)).not.toBe(baselineMark('trend', 'sales'));
    expect(goldMark('composition', 8)).not.toBe(baselineMark('composition', 'sales'));
    expect(goldMark('composition', 4)).toBe(baselineMark('composition', 'sales'));
    expect(goldMark('comparison', 4)).not.toBe(baselineMark('comparison', 'finance'));
    expect(goldMark('comparison', 4)).toBe(baselineMark('comparison', 'hr'));
  });

  it('uses different measure and category fields for the holdout', () => {
    const holdout = buildCorpus(2, 14, 'holdout');
    const trainTrend = train.find((item) => item.query.intent === 'trend');
    const holdTrend = holdout.find((item) => item.query.intent === 'trend');
    expect(trainTrend?.query.field).not.toBe(holdTrend?.query.field);
  });
});

describe('knowledge application', () => {
  const corpus = buildCorpus(3, 28, 'holdout');
  const trend = corpus.find((item) => item.query.intent === 'trend')!;

  function item(statement: string, payload: ChartConstraint, domain?: string): KnowledgeItem {
    return createKnowledgeItem(
      {
        namespace: 'acme',
        kind: 'constraint',
        scope: { task: 'chart.recommend', ...(domain === undefined ? {} : { domain }), intent: 'trend' },
        statement,
        payload: payload as never,
        evidence: { feedbackId: statement, runId: 'r', at: 1, weight: 0.9 },
        trust: 0.9,
        dedupeKey: statement,
      },
      defaultPolicy,
      1,
      `k_${statement.length}_${domain ?? 'global'}`,
    );
  }

  function pack(items: KnowledgeItem[]) {
    return {
      items,
      ids: items.map((entry) => entry.id),
      rendered: '',
      tokens: 0,
      hash: 'h',
      budget: 0,
      truncated: 0,
    };
  }

  it('returns the baseline when nothing matches', () => {
    expect(applyKnowledge(pack([]), trend).mark).toBe(trend.baseline.mark);
  });

  it('applies a matching constraint', () => {
    const constraint = item('global trend', { when: { intent: 'trend' }, then: { mark: 'line' } });
    expect(applyKnowledge(pack([constraint]), trend).mark).toBe('line');
  });

  it('prefers the more specific scope when both match', () => {
    const global = item('global', { when: { intent: 'trend' }, then: { mark: 'line' } });
    const local = item('local', { when: { intent: 'trend' }, then: { mark: 'scatter' } }, trend.query.domain);
    expect(applyKnowledge(pack([global, local]), trend).mark).toBe('scatter');
  });

  it('ignores a rule that is not active', () => {
    const quarantined = { ...item('q', { when: { intent: 'trend' }, then: { mark: 'line' } }), status: 'quarantined' as const };
    expect(applyKnowledge(pack([quarantined]), trend).mark).toBe(trend.baseline.mark);
  });
});

describe('knowledge precision', () => {
  it('scores a correct rule at 1 and a wrong rule at 0', () => {
    const correct = createKnowledgeItem(
      {
        namespace: 'acme',
        kind: 'constraint',
        scope: { task: 'chart.recommend', intent: 'trend' },
        statement: 'trend line',
        payload: { when: { intent: 'trend' }, then: { mark: 'line' } } as never,
        evidence: { feedbackId: 'a', runId: 'r', at: 1, weight: 0.9 },
        trust: 0.9,
        dedupeKey: 'a',
      },
      defaultPolicy,
      1,
      'k_ok',
    );
    expect(knowledgePrecision([correct]).value).toBe(1);

    const wrong = {
      ...correct,
      id: 'k_bad',
      payload: { when: { intent: 'trend' }, then: { mark: 'pie' } } as never,
    };
    expect(knowledgePrecision([wrong]).value).toBe(0);
  });

  it('buckets correctness by domain', () => {
    const holdout = buildCorpus(4, 8, 'holdout');
    const scores = scoreByDomain(holdout, holdout.map(() => true));
    expect(scores.every((entry) => entry.accuracy === 1)).toBe(true);
    expect(scores.reduce((sum, entry) => sum + entry.total, 0)).toBe(holdout.length);
  });
});

describe('study', () => {
  it('runs a small study end to end and leaves the baseline flat', async () => {
    const result = await runStudy({
      seed: 7,
      trainSize: 140,
      holdoutSize: 56,
      rounds: 2,
      batchSize: 8,
      budget: 800,
      heldOutDomain: 'ops',
    });
    // Every arm in the schedule ran, and each names a distinct knob.
    expect(result.arms.length).toBeGreaterThanOrEqual(6);
    expect(new Set(result.arms.map((arm) => arm.name)).size).toBe(result.arms.length);
    const baseline = result.arms.find((arm) => arm.name === 'baseline')!;
    const full = result.arms.find((arm) => arm.name === 'full')!;
    expect(baseline.rounds[0]?.accuracy).toBe(baseline.finalAccuracy);
    expect(full.finalAccuracy).toBeGreaterThan(baseline.finalAccuracy);
    expect(result.leakage).toBe(0);
    expect(result.gates.length).toBeGreaterThanOrEqual(11);

    const markdown = renderMarkdown(result);
    expect(markdown).toContain('# Microglia mechanism study');
    expect(markdown).toContain('## Gates');
  }, 60_000);
});

describe('the L0 preregistration', () => {
  it('is 1,300 cases, and the training split is the only thing it changes', () => {
    expect(L0_CASES).toBe(1300);
    expect(L0_CONFIG.trainSize + L0_CONFIG.holdoutSize).toBe(L0_CASES);
    // A lane that also changed the teaching budget could not say which change
    // moved the number, so everything else is frozen against the default study.
    expect({ ...L0_CONFIG, trainSize: DEFAULT_CONFIG.trainSize, holdoutSize: DEFAULT_CONFIG.holdoutSize })
      .toEqual(DEFAULT_CONFIG);
  });

  it('evaluates four fifths of the corpus, and holds one domain out entirely', () => {
    expect(L0_CONFIG.holdoutSize / L0_CASES).toBeGreaterThan(0.75);
    expect(L0_CONFIG.heldOutDomain).toBe(DEFAULT_CONFIG.heldOutDomain);
  });
});
