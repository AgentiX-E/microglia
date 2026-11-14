import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RETROSPECT_POLICY,
  admissibilityOf,
  contentWords,
  isNegated,
  verdictOf,
  witnessOf,
} from '../witness.js';
import type { GuidelineProposal, RetrospectSource } from '../types.js';

const at = 1_700_000_000_000;

function source(overrides: Partial<RetrospectSource> = {}): RetrospectSource {
  return {
    id: 'k1',
    statement: 'Refund the shipping fee when the item arrived damaged.',
    when: 'when a refund is requested after the item arrived damaged',
    task: 'retail.support',
    taskId: 'task-a',
    outcome: 'repair',
    confidence: 0.8,
    at,
    ...overrides,
  };
}

function proposal(overrides: Partial<GuidelineProposal> = {}): GuidelineProposal {
  return {
    id: 'gp1',
    statement: 'Refund the shipping fee when the item arrived damaged.',
    when: 'when a refund is requested',
    covers: ['k1', 'k2'],
    ...overrides,
  };
}

const corpus: RetrospectSource[] = [
  source({ id: 'k1', taskId: 'task-a' }),
  source({
    id: 'k2',
    when: 'when a refund is requested after the item arrived damaged and the customer called',
    taskId: 'task-b',
  }),
  source({ id: 'k3', when: 'when an exchange is requested for a different size', taskId: 'task-c' }),
  source({ id: 'p1', when: 'when a refund is requested after delivery', outcome: 'pass', taskId: 'task-d' }),
];

describe('content words keep the trigger and drop the grammar', () => {
  it('drops connective words and keeps content', () => {
    expect(contentWords('when a refund is requested')).toEqual(['refund', 'requested']);
  });

  it('folds a negative contraction rather than leaving its tail as a word', () => {
    // "don't" split naively leaves "t", which makes every negated trigger one word longer
    // than its affirmative twin and shifts the overlap every later comparison is built on.
    expect(contentWords("don't refund before shipping")).toEqual(['not', 'refund', 'before', 'shipping']);
  });

  it('keeps numbers, because a threshold is content', () => {
    expect(contentWords('within 30 days')).toEqual(['within', '30', 'days']);
  });

  it('ignores single characters and an empty string', () => {
    expect(contentWords('a b c')).toEqual([]);
    expect(contentWords('')).toEqual([]);
  });
});

describe('a verdict is a direction, not a similarity', () => {
  it('entails a source whose trigger carries at least as much', () => {
    expect(verdictOf('when a refund is requested', 'when a refund is requested after shipping')).toEqual({
      verdict: 'entailed',
      overlap: 1,
    });
  });

  it('refuses the reverse direction, which is a narrowing', () => {
    // The guideline names a word its source does not have, so it describes a situation the
    // source was not in. This is the direction a model-written guideline gets wrong.
    expect(verdictOf('when a damaged item was delivered late', 'when a refund is requested').verdict).toBe(
      'unwitnessed',
    );
  });

  it('reports a synonym as partial rather than as covered', () => {
    const { verdict, overlap } = verdictOf('when the order shipped', 'when a parcel shipped late');
    expect(verdict).toBe('partial');
    expect(overlap).toBeGreaterThanOrEqual(0.5);
  });

  it('treats a trigger naming no condition as unconditional', () => {
    expect(verdictOf('', 'when a refund is requested')).toEqual({ verdict: 'unconditional', overlap: 1 });
    expect(verdictOf('the and of', 'when a refund is requested')).toEqual({ verdict: 'unconditional', overlap: 1 });
  });

  it('cannot witness a source that never declared a condition', () => {
    // Absent is not "always": a correction recorded without a trigger cannot be shown to be
    // an instance of a conditioned rule, so it starts as unsupported and the reviewer sees it.
    expect(verdictOf('when a refund is requested', undefined)).toEqual({ verdict: 'unwitnessed', overlap: 0 });
  });
});

describe('negation is read off the statement, not the condition', () => {
  it('sees the spellings a distiller writes', () => {
    expect(isNegated('Do not refund before the return is received.')).toBe(true);
    expect(isNegated("Don't confirm an address you have not verified.")).toBe(true);
    expect(isNegated('Never write to the database in the same step.')).toBe(true);
    expect(isNegated('Refund without waiting to be asked.')).toBe(true);
  });

  it('does not see a negation inside a word', () => {
    expect(isNegated('Notify the customer once the refund is issued.')).toBe(false);
  });
});

describe('a witness report is about the corpus, not about the claim', () => {
  it('counts a claimed id that is not in the corpus as unwitnessed', () => {
    // Otherwise a proposer inflates support by naming ids that do not exist.
    const report = witnessOf(proposal({ covers: ['k1', 'ghost'] }), corpus);
    expect(report.covered).toBe(1);
    expect(report.unwitnessed).toBe(1);
    expect(report.findings.find((finding) => finding.sourceId === 'ghost')?.verdict).toBe('unwitnessed');
  });

  it('lists what the guideline would also apply to and separates passes', () => {
    const report = witnessOf(proposal({ covers: ['k1', 'k2'] }), corpus);
    expect(report.collateral.map((entry) => entry.sourceId).sort()).toEqual(['p1']);
    expect(report.collateral[0]?.outcome).toBe('pass');
  });

  it('counts support in distinct tasks rather than in records', () => {
    const sameTask = [source({ id: 'k1', taskId: 't1' }), source({ id: 'k2', taskId: 't1' })];
    expect(witnessOf(proposal(), sameTask).distinctTasks).toBe(1);
  });

  it('flags a merge that would invert a rule', () => {
    const mixed = [source({ id: 'k1' }), source({ id: 'k2', statement: 'Do not refund the shipping fee.' })];
    const report = witnessOf(proposal(), mixed);
    expect(report.polarityConflicts).toEqual(['k2']);
  });

  it('marks a trigger that names nothing as unconditional', () => {
    expect(witnessOf(proposal({ when: '' }), corpus).unconditional).toBe(true);
  });
});

describe('admissibility refuses in the order of how bad the defect is', () => {
  const policy = DEFAULT_RETROSPECT_POLICY;

  it('refuses a trigger that names no condition before anything else is discussed', () => {
    const verdict = admissibilityOf(proposal({ when: '', covers: [] }), corpus, policy);
    expect(verdict.state).toBe('unconditional');
    expect(verdict.sentence).toMatch(/would apply to every request/);
  });

  it('refuses a guideline over one correction as a restatement', () => {
    const verdict = admissibilityOf(proposal({ covers: ['k1'] }), corpus, policy);
    expect(verdict.state).toBe('restatement');
    expect(verdict.sentence).toMatch(/not a guideline/);
  });

  it('refuses a claim the trigger does not reach, naming the source and the verdict', () => {
    // k3 shares "requested" and nothing else, which is exactly the boundary the report is
    // supposed to name: a reviewer reading "partial" knows to look, one reading "unwitnessed"
    // would not have.
    const verdict = admissibilityOf(proposal({ covers: ['k1', 'k3'] }), corpus, policy);
    expect(verdict.state).toBe('unwitnessed');
    expect(verdict.sentence).toContain('k3 (partial)');
  });

  it('refuses a merge that would invert a rule', () => {
    const mixed = [source({ id: 'k1' }), source({ id: 'k2', statement: 'Do not refund the shipping fee.' })];
    expect(admissibilityOf(proposal(), mixed, policy).state).toBe('polarity');
  });

  it('refuses a rule wider than the policy allows and says by how much', () => {
    const wide = [1, 2, 3, 4, 5, 6].map((n) =>
      source({ id: `k${n}`, when: 'when a refund is requested for a damaged item', taskId: `t${n}` }),
    );
    const verdict = admissibilityOf(proposal({ covers: ['k1', 'k2'] }), wide, { ...policy, maxCollateral: 1 });
    expect(verdict.state).toBe('over-general');
    expect(verdict.sentence).toMatch(/against a ceiling of 1/);
  });

  it('admits a witnessed, bounded guideline and reports the numbers a reviewer needs', () => {
    const verdict = admissibilityOf(proposal({ covers: ['k1', 'k2'] }), corpus, policy);
    expect(verdict.state).toBe('reviewable');
    expect(verdict.sentence).toBe('2 source(s) over 2 task(s), 1 collateral');
  });

  it('refuses a partial match by default and admits it when the policy says so', () => {
    // The default is the claim: a mode that preserves what it absorbed cannot accept a
    // synonym match on the proposer's word. The option exists so an arm can vary it.
    const synonym = [source({ id: 'k1', when: 'when a parcel shipped late' }), source({ id: 'k2', when: 'when a parcel shipped late and was damaged' })];
    expect(admissibilityOf(proposal({ when: 'when the order shipped', covers: ['k1', 'k2'] }), synonym, policy).state).toBe(
      'unwitnessed',
    );
    expect(
      admissibilityOf(proposal({ when: 'when the order shipped', covers: ['k1', 'k2'] }), synonym, {
        ...policy,
        allowPartial: true,
      }).state,
    ).toBe('reviewable');
  });
});
