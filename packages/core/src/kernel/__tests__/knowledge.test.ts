import { describe, expect, it } from 'vitest';
import {
  applyOutcome,
  corroborationShare,
  observationsOf,
  createKnowledgeItem,
  decideStatus,
  dedupeKeyOf,
  defaultPolicy,
  expireKnowledge,
  mergeEvidence,
  recordContradiction,
  reinstate,
  scopeMatches,
  scoreKnowledge,
  specificity,
  statementIdentity,
  type DistillCandidate,
  type KnowledgeScope,
} from '../index.js';

const scope: KnowledgeScope = {
  task: 'chart.recommend',
  domain: 'sales',
  intent: 'trend',
};

function candidate(overrides: Partial<DistillCandidate> = {}): DistillCandidate {
  return {
    namespace: 'acme',
    kind: 'constraint',
    scope,
    statement: 'For a monthly trend in sales, prefer line over bar.',
    evidence: { feedbackId: 'fb_1', runId: 'run_1', at: 1_000, weight: 0.9 },
    trust: 0.9,
    dedupeKey: 'k1',
    ...overrides,
  };
}

describe('knowledge admission', () => {
  it('a single trusted correction becomes active', () => {
    const item = createKnowledgeItem(candidate(), defaultPolicy, 1_000, 'k_1');
    expect(item.status).toBe('active');
    expect(item.confidence).toBeGreaterThanOrEqual(defaultPolicy.activationThreshold);
    expect(item.evidence).toHaveLength(1);
  });

  it('an untrusted correction is quarantined, not admitted', () => {
    const item = createKnowledgeItem(candidate({ trust: 0.2 }), defaultPolicy, 1_000, 'k_2');
    expect(item.status).toBe('quarantined');
    expect(item.statusReason).toBe('source-trust-below-quarantine');
  });

  it('merging evidence raises confidence without duplicating the same event', () => {
    const first = createKnowledgeItem(candidate(), defaultPolicy, 1_000, 'k_3');
    const again = mergeEvidence(
      first,
      candidate({ evidence: { feedbackId: 'fb_1', runId: 'run_1', at: 1_000, weight: 0.9 } }),
      defaultPolicy,
      2_000,
    );
    expect(again.evidence).toHaveLength(1);
    expect(again.support).toBe(first.support);

    const second = mergeEvidence(
      again,
      candidate({ evidence: { feedbackId: 'fb_2', runId: 'run_2', at: 2_000, weight: 0.9 } }),
      defaultPolicy,
      2_000,
    );
    expect(second.evidence).toHaveLength(2);
    expect(second.confidence).toBeGreaterThan(first.confidence);
  });

  it('two contradictions mark the item conflicted', () => {
    const first = createKnowledgeItem(candidate(), defaultPolicy, 1_000, 'k_4');
    const one = recordContradiction(first, 0.9, defaultPolicy, 1_100);
    // One contradiction suspends the rule (candidate = not applied) rather than
    // deleting it; two exhaust the contradiction budget and mark it conflicted.
    expect(one.status).toBe('candidate');
    const two = recordContradiction(one, 0.9, defaultPolicy, 1_200);
    expect(two.status).toBe('conflicted');
    expect(two.statusReason).toBe('contradiction-budget-exceeded');
  });

  it('retires an item whose observed applications keep failing', () => {
    let item = createKnowledgeItem(candidate(), defaultPolicy, 1_000, 'k_5');
    for (let i = 0; i < 4; i += 1) {
      item = applyOutcome(item, false, defaultPolicy, 2_000 + i);
    }
    expect(item.applied).toBe(4);
    expect(item.succeeded).toBe(0);
    expect(item.status).toBe('retired');
  });

  it('resurrects a retired item when fresh evidence arrives', () => {
    let item = createKnowledgeItem(candidate(), defaultPolicy, 1_000, 'k_6');
    item = applyOutcome(item, false, defaultPolicy, 2_000);
    item = applyOutcome(item, false, defaultPolicy, 2_001);
    item = applyOutcome(item, false, defaultPolicy, 2_002);
    expect(item.status).toBe('retired');

    const revived = mergeEvidence(
      item,
      candidate({ evidence: { feedbackId: 'fb_9', runId: 'run_9', at: 3_000, weight: 0.9 } }),
      defaultPolicy,
      3_000,
    );
    expect(revived.status).toBe('active');
  });

  it('lets a successful application keep an item active', () => {
    const item = createKnowledgeItem(candidate(), defaultPolicy, 1_000, 'k_7');
    const after = applyOutcome(item, true, defaultPolicy, 2_000);
    expect(after.status).toBe('active');
    expect(after.succeeded).toBe(1);
    expect(after.confidence).toBeGreaterThan(item.confidence);
  });

  it('a manual reinstate returns a quarantined item to review', () => {
    const item = createKnowledgeItem(candidate({ trust: 0.2 }), defaultPolicy, 1_000, 'k_8');
    const reinstated = reinstate(item, defaultPolicy, 1_500);
    // Low-trust evidence is not laundered by a manual reinstate: it returns to
    // review as a candidate and still needs enough trusted evidence to activate.
    expect(reinstated.status).toBe('candidate');
    expect(reinstated.statusReason).toBe('insufficient-evidence');
  });
});

describe('scope and identity', () => {
  it('only matches queries in the same task and overlapping scope', () => {
    const base = { task: 'chart.recommend', text: 'revenue by month', namespace: 'n' };
    expect(scopeMatches(scope, base)).toBe(true);
    expect(scopeMatches(scope, { ...base, task: 'sql.generate' })).toBe(false);
    expect(scopeMatches(scope, { ...base, scope: { domain: 'hr' } })).toBe(false);
    expect(scopeMatches(scope, { ...base, scope: { domain: 'sales' } })).toBe(true);
  });

  it('counts specificity so a narrower rule wins a tie', () => {
    expect(specificity({ task: 't' })).toBe(1);
    expect(specificity(scope)).toBe(3);
  });

  it('makes identity independent of whitespace, case, and phrasing separators', () => {
    const a = dedupeKeyOf({
      namespace: 'acme',
      kind: 'constraint',
      scope,
      statement: 'Prefer  line for trends.',
    });
    const b = dedupeKeyOf({
      namespace: 'acme',
      kind: 'constraint',
      scope,
      statement: 'prefer line for trends.',
    });
    expect(a).toBe(b);
    expect(statementIdentity('acme', 'constraint', scope, 'Prefer line for trends.')).toBe(
      dedupeKeyOf({ namespace: 'acme', kind: 'constraint', scope, statement: 'Prefer line for trends.' }),
    );
  });

  it('reports a lower score for an unapplied item than one with successes', () => {
    const item = createKnowledgeItem(candidate(), defaultPolicy, 1_000, 'k_9');
    const tested = applyOutcome(applyOutcome(item, true, defaultPolicy, 2_000), true, defaultPolicy, 2_001);
    expect(scoreKnowledge(tested, defaultPolicy, 2_001)).toBeGreaterThan(
      scoreKnowledge(item, defaultPolicy, 2_001),
    );
  });

  it('decays an expired rule rather than deleting it', () => {
    const item = expireKnowledge(
      createKnowledgeItem(candidate(), defaultPolicy, 1_000, 'k_10'),
      2_000,
      'policy-changed',
    );
    expect(item.status).toBe('retired');
    expect(item.validUntil).toBe(2_000);
    expect(item.systemUntil).toBe(2_000);
    const decision = decideStatus(item, defaultPolicy, 2_000 + 90 * 86_400_000);
    expect(decision.status).toBe('retired');
  });
});

describe('corroborationShare', () => {
  const withObservations = (observations: number, status = 'active') => ({ status, observations });

  it('counts the active items observed more than once', () => {
    // The number that decides whether the mechanism can help at all: on BIRD it is zero,
    // on the chart study it is most of the store, and the effect moves with it.
    expect(
      corroborationShare([
        withObservations(1),
        withObservations(2),
        withObservations(3),
      ]),
    ).toEqual({ active: 3, corroborated: 2, share: 2 / 3 });
  });

  it('ignores items that cannot be injected', () => {
    // A retired rule cannot reach a prompt, so it cannot corroborate anything. Counting
    // it would report a store as healthy on the strength of what it withdrew.
    expect(
      corroborationShare([
        withObservations(1),
        withObservations(4, 'retired'),
        withObservations(4, 'quarantined'),
      ]),
    ).toEqual({ active: 1, corroborated: 0, share: 0 });
  });

  it('is zero for an empty store rather than undefined', () => {
    expect(corroborationShare([])).toEqual({ active: 0, corroborated: 0, share: 0 });
  });

  it('reads the observation count off an item the way a caller would', () => {
    expect(observationsOf({ evidence: [{}, {}] as never })).toBe(2);
  });
});
