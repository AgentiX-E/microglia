import { describe, expect, it } from 'vitest';
import { MicrogliaError } from '../errors.js';
import { createKnowledgeItem } from '../knowledge.js';
import { defaultPolicy } from '../policy.js';
import type { DistillCandidate, KnowledgeItem } from '../types.js';
import {
  WRITE_ADMISSION_THRESHOLD,
  WRITE_ADMISSION_TOP_S,
  admitWrite,
  neighbourhood,
  type WriteNeighbour,
} from '../write-admission.js';

const AT = 1_700_000_000_000;
const RULE = 'Revenue questions use a line chart rather than a bar chart.';
/** One word different: a paraphrase a human would call the same rule. */
const PARAPHRASE = 'Revenue questions use a line chart rather than a bar chart';

function item(id: string, statement: string, overrides: Partial<DistillCandidate> = {}): KnowledgeItem {
  const candidate: DistillCandidate = {
    namespace: 'acme',
    kind: 'constraint',
    scope: { task: 'chart.recommend', domain: 'sales' },
    statement,
    evidence: { feedbackId: `fb_${id}`, runId: `run_${id}`, at: AT, weight: 0.9 },
    trust: 0.9,
    dedupeKey: `k_${id}`,
    ...overrides,
  };
  return createKnowledgeItem(candidate, defaultPolicy, AT, id);
}

function candidate(statement: string, overrides: Partial<DistillCandidate> = {}): DistillCandidate {
  return {
    namespace: 'acme',
    kind: 'constraint',
    scope: { task: 'chart.recommend', domain: 'sales' },
    statement,
    evidence: { feedbackId: 'fb_new', runId: 'run_new', at: AT + 1, weight: 0.9 },
    trust: 0.9,
    dedupeKey: 'k_new',
    ...overrides,
  };
}

function near(entry: KnowledgeItem, similarity: number): WriteNeighbour {
  return { item: entry, similarity };
}

describe('admission decides against neighbours, not against the store', () => {
  it('adds when there is nothing to compare against', () => {
    expect(admitWrite(candidate(RULE), [], defaultPolicy)).toEqual({
      op: 'add',
      reason: 'no-neighbour',
      nearest: null,
    });
  });

  it('adds when the nearest neighbour is below the threshold, and reports how near', () => {
    const decision = admitWrite(candidate('Totals are summed after the null check.'), [near(item('k_1', RULE), 0.3)], defaultPolicy);
    expect(decision).toEqual({ op: 'add', reason: 'below-threshold', nearest: 0.3 });
  });

  it('adds when the neighbour sits in another namespace', () => {
    // Tenancy is a hard gate: retrieval never crosses it, so neither may a merge.
    const decision = admitWrite(candidate(RULE), [near(item('k_1', RULE, { namespace: 'other' }), 1)], defaultPolicy);
    expect(decision).toEqual({ op: 'add', reason: 'no-neighbour', nearest: null });
  });

  it('adds when the neighbour is a different kind of knowledge', () => {
    const decision = admitWrite(candidate(RULE), [near(item('k_1', RULE, { kind: 'anti-pattern' }), 1)], defaultPolicy);
    expect(decision.op).toBe('add');
  });

  it('adds when the words agree but the payloads do not', () => {
    // Same sentence, different rule. Merging would overwrite the survivor's
    // payload with the candidate's, which is the selection route.
    const stored = item('k_1', RULE, { payload: { mark: 'line' } });
    const decision = admitWrite(candidate(RULE, { payload: { mark: 'pie' } }), [near(stored, 1)], defaultPolicy);
    expect(decision).toEqual({ op: 'add', reason: 'different-payload', nearest: 1 });
  });

  it('updates the neighbour when the observation brings evidence it does not have', () => {
    const stored = item('k_1', RULE);
    expect(admitWrite(candidate(PARAPHRASE), [near(stored, 0.97)], defaultPolicy)).toEqual({
      op: 'update',
      target: stored,
      similarity: 0.97,
    });
  });

  it('suppresses a paraphrase that brings evidence the neighbour already cites', () => {
    // The write would change nothing: same claim, same observation, same tier.
    // Refusing it is what keeps the store from growing a second copy of a rule
    // that is already there under different words.
    const stored = item('k_1', RULE);
    const repeat = candidate(PARAPHRASE, {
      evidence: { feedbackId: 'fb_k_1', runId: 'run_k_1', at: AT, weight: 0.9 },
    });
    expect(admitWrite(repeat, [near(stored, 0.97)], defaultPolicy)).toEqual({
      op: 'noop',
      target: stored,
      similarity: 0.97,
    });
  });

  it('updates when the candidate names a condition the neighbour lacks', () => {
    const stored = item('k_1', RULE);
    const withWhen = candidate(PARAPHRASE, {
      evidence: { feedbackId: 'fb_k_1', runId: 'run_k_1', at: AT, weight: 0.9 },
      when: 'the question asks for a trend over time',
    });
    expect(admitWrite(withWhen, [near(stored, 0.92)], defaultPolicy).op).toBe('update');
  });

  it('updates when the candidate is a stronger tier and nothing else changed', () => {
    const stored = item('k_1', RULE, { tier: 'user-text' });
    const measured = candidate(PARAPHRASE, {
      evidence: { feedbackId: 'fb_k_1', runId: 'run_k_1', at: AT, weight: 0.9 },
      tier: 'outcome',
    });
    expect(admitWrite(measured, [near(stored, 0.9)], defaultPolicy).op).toBe('update');
  });

  it('updates a retired neighbour when the observation is trusted enough to revive it', () => {
    const retired = { ...item('k_1', RULE), status: 'retired' as const, statusReason: 'observed-failure-rate' };
    const trusted = candidate(PARAPHRASE, {
      evidence: { feedbackId: 'fb_k_1', runId: 'run_k_1', at: AT, weight: 0.9 },
      trust: defaultPolicy.singleObservationTrust,
    });
    expect(admitWrite(trusted, [near(retired, 0.95)], defaultPolicy).op).toBe('update');
  });

  it('does not let an untrusted restatement revive a retired neighbour', () => {
    const retired = { ...item('k_1', RULE), status: 'retired' as const };
    const weak = candidate(PARAPHRASE, {
      evidence: { feedbackId: 'fb_k_1', runId: 'run_k_1', at: AT, weight: 0.9 },
      trust: Math.max(0, defaultPolicy.singleObservationTrust - 0.01),
    });
    expect(admitWrite(weak, [near(retired, 0.95)], defaultPolicy).op).toBe('noop');
  });
});

describe('the window is bounded and the choice inside it is total', () => {
  it('keeps a same-task paraphrase from becoming a second item', () => {
    // The exact dedupe key carries the scope, so this pair can never meet there:
    // one lesson, two tasks, two items, and each corroborates nothing.
    const learnedOnA = item('k_1', RULE, { scope: { task: 'chart.recommend', domain: 'sales' } });
    const learnedOnB = candidate(PARAPHRASE, { scope: { task: 'chart.explain', domain: 'sales' } });
    expect(admitWrite(learnedOnB, [near(learnedOnA, 0.96)], defaultPolicy)).toEqual({
      op: 'update',
      target: learnedOnA,
      similarity: 0.96,
    });
  });

  it('only sees the top-s neighbours', () => {
    const disagreeing = item('k_1', RULE, { payload: { mark: 'line' } });
    const agreeing = item('k_2', RULE, { payload: { mark: 'pie' } });
    const ask = candidate(RULE, { payload: { mark: 'pie' } });
    const pool = [near(disagreeing, 0.99), near(agreeing, 0.9)];

    // With one slot the stricter neighbour wins and the candidate is added; with
    // two, the agreeing neighbour is inside the window and it is merged. The
    // bound is therefore a real setting, not a formality.
    expect(admitWrite(ask, pool, defaultPolicy, { topS: 1 })).toEqual({
      op: 'add',
      reason: 'different-payload',
      nearest: 0.99,
    });
    expect(admitWrite(ask, pool, defaultPolicy, { topS: 2 }).op).toBe('update');
  });

  it('does not depend on the order the store returned', () => {
    const first = near(item('k_1', RULE), 0.9);
    const second = near(item('k_2', RULE), 0.9);
    const ask = candidate(PARAPHRASE);
    expect(admitWrite(ask, [first, second], defaultPolicy)).toEqual(
      admitWrite(ask, [second, first], defaultPolicy),
    );
  });

  it('breaks a tie on id, so one store cannot yield two decisions', () => {
    const holdsEvidence = item('k_1', RULE);
    const holdsOther = item('k_2', RULE);
    const ask = candidate(PARAPHRASE, {
      evidence: { feedbackId: 'fb_k_1', runId: 'run_k_1', at: AT, weight: 0.9 },
    });
    const decision = admitWrite(ask, [near(holdsOther, 0.93), near(holdsEvidence, 0.93)], defaultPolicy);
    expect(decision).toEqual({ op: 'noop', target: holdsEvidence, similarity: 0.93 });
  });

  it('defaults are the published ones', () => {
    expect(WRITE_ADMISSION_THRESHOLD).toBe(0.85);
    expect(WRITE_ADMISSION_TOP_S).toBe(10);
  });

  it('honours a caller threshold at the boundary', () => {
    const stored = item('k_1', RULE);
    const ask = candidate(PARAPHRASE);
    expect(admitWrite(ask, [near(stored, 0.7)], defaultPolicy, { threshold: 0.7 }).op).toBe('update');
    expect(admitWrite(ask, [near(stored, 0.699)], defaultPolicy, { threshold: 0.7 }).reason).toBe(
      'below-threshold',
    );
  });
});

describe('refusals are configuration errors, not silent defaults', () => {
  const stored = near(item('k_1', RULE), 0.9);

  it('refuses a threshold outside (0, 1]', () => {
    for (const threshold of [0, -0.2, 1.01]) {
      expect(() => admitWrite(candidate(RULE), [stored], defaultPolicy, { threshold })).toThrow(
        MicrogliaError,
      );
    }
  });

  it('refuses a window that is not a positive integer', () => {
    for (const topS of [0, -1, 1.5]) {
      expect(() => admitWrite(candidate(RULE), [stored], defaultPolicy, { topS })).toThrow(
        /topS/,
      );
    }
  });

  it('refuses a similarity that is not a probability', () => {
    for (const similarity of [Number.NaN, Number.POSITIVE_INFINITY, -0.1, 1.1]) {
      expect(() => admitWrite(candidate(RULE), [near(stored.item, similarity)], defaultPolicy)).toThrow(
        /similarity/,
      );
    }
  });

  it('refuses the same neighbour twice', () => {
    expect(() => admitWrite(candidate(RULE), [stored, stored], defaultPolicy)).toThrow(/twice/);
  });
});

describe('lexical neighbourhood', () => {
  it('scores every item against the candidate and keeps the store order', () => {
    const pool = [item('k_1', RULE), item('k_2', 'Totals are summed after the null check.')];
    const scored = neighbourhood(candidate(RULE), pool);
    expect(scored.map((entry) => entry.item.id)).toEqual(['k_1', 'k_2']);
    expect(scored[0]?.similarity).toBe(1);
    expect(scored[1]?.similarity).toBeLessThan(WRITE_ADMISSION_THRESHOLD);
  });

  it('scores an empty store as nothing', () => {
    expect(neighbourhood(candidate(RULE), [])).toEqual([]);
  });

  it('feeds the decision end to end', () => {
    const pool = [item('k_1', RULE)];
    const decision = admitWrite(candidate(RULE), neighbourhood(candidate(RULE), pool), defaultPolicy);
    expect(decision).toMatchObject({ op: 'update', similarity: 1 });
    expect(decision.op === 'update' ? decision.target.id : undefined).toBe('k_1');
  });
});
