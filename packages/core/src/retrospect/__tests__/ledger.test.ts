import { describe, expect, it } from 'vitest';
import {
  applyDecision,
  applyDecisions,
  buildBatch,
  summaryOf,
  toDistillCandidate,
  type ReviewBatch,
  type ReviewDecision,
} from '../ledger.js';
import { DEFAULT_RETROSPECT_POLICY } from '../witness.js';
import type { GuidelineProposal, RetrospectSource } from '../types.js';

const at = 1_700_000_000_000;

function source(overrides: Partial<RetrospectSource> = {}): RetrospectSource {
  return {
    id: 'k1',
    statement: 'Refund the shipping fee when the item arrived damaged.',
    when: 'when a refund is requested for a damaged item',
    task: 'retail.support',
    taskId: 'task-a',
    outcome: 'repair',
    confidence: 0.8,
    at,
    ...overrides,
  };
}

const corpus: RetrospectSource[] = [
  source({ id: 'k1', taskId: 'task-a' }),
  source({ id: 'k2', when: 'when a refund is requested for a damaged item and the box was open', taskId: 'task-b' }),
  source({ id: 'k3', when: 'when an exchange is requested for a different size', taskId: 'task-c' }),
];

function proposal(overrides: Partial<GuidelineProposal> = {}): GuidelineProposal {
  return {
    id: 'gp1',
    statement: 'Refund the shipping fee when the item arrived damaged.',
    when: 'when a refund is requested for a damaged item',
    covers: ['k1', 'k2'],
    ...overrides,
  };
}

function batch(proposals: readonly GuidelineProposal[] = [proposal()]): ReviewBatch {
  return buildBatch({
    id: 'batch-1',
    createdAt: at,
    namespace: 'acme',
    policy: DEFAULT_RETROSPECT_POLICY,
    corpus,
    proposals,
  });
}

function decision(overrides: Partial<ReviewDecision> = {}): ReviewDecision {
  return {
    candidateId: 'gp1',
    action: 'accept',
    textBefore: 'Refund the shipping fee when the item arrived damaged.',
    reviewer: 'lambertyan',
    at: at + 1,
    elapsedMs: 4_200,
    ...overrides,
  };
}

function refusal(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return (error as Error).message;
  }
  return 'no refusal';
}

describe('a batch is a queue of proposals, each with its own verdict', () => {
  it('starts every card pending and carries the admissibility with it', () => {
    const built = batch([proposal(), proposal({ id: 'gp2', covers: ['k1'] })]);
    expect(built.items.map((item) => item.state)).toEqual(['pending', 'pending']);
    expect(built.items[0]?.admissibility.state).toBe('reviewable');
    // The card a reviewer must not be allowed to accept still reaches the queue: the reason
    // it is there is the reason the reviewer needs to see it.
    expect(built.items[1]?.admissibility.state).toBe('restatement');
  });

  it('starts the admitted text as the proposer’s text', () => {
    expect(batch().items[0]?.text).toBe('Refund the shipping fee when the item arrived damaged.');
  });
});

describe('a decision is a refusal when it cannot be attributed or replayed', () => {
  it('refuses a candidate that is not in the batch', () => {
    expect(refusal(() => applyDecision(batch(), decision({ candidateId: 'gp9' })))).toMatch(/not in this batch/);
  });

  it('refuses a decision without a reviewer', () => {
    expect(refusal(() => applyDecision(batch(), decision({ reviewer: '  ' })))).toMatch(/cannot be attributed/);
  });

  it('refuses a duration that was not measured', () => {
    // HITL's cost is the number this field carries; a placeholder makes the cost fiction.
    expect(refusal(() => applyDecision(batch(), decision({ elapsedMs: -1 })))).toMatch(/measured duration/);
    expect(refusal(() => applyDecision(batch(), decision({ elapsedMs: Number.NaN })))).toMatch(/measured duration/);
  });

  it('refuses a decision about a text the batch no longer carries', () => {
    // Deferred rather than accepted, because an accepted card is refused as a duplicate
    // first and the ordering would hide this check behind the other one.
    const moved = applyDecision(batch(), decision({ action: 'defer' }));
    expect(refusal(() => applyDecision(moved, { ...decision(), textBefore: 'the older text' }))).toMatch(
      /different text/,
    );
  });

  it('refuses a second decision on a card that is already decided', () => {
    const decided = applyDecision(batch(), decision());
    expect(refusal(() => applyDecision(decided, decision({ action: 'reject', reason: 'changed my mind' })))).toMatch(
      /append-only/,
    );
  });

  it('refuses an action it does not know', () => {
    expect(
      refusal(() => applyDecision(batch(), decision({ action: 'approve' as unknown as ReviewDecision['action'] }))),
    ).toMatch(/unknown action/);
  });
});

describe('accept and edit', () => {
  it('accepts as written and keeps the decision', () => {
    const decided = applyDecision(batch(), decision());
    expect(decided.items[0]?.state).toBe('accepted');
    expect(decided.items[0]?.decision?.reviewer).toBe('lambertyan');
  });

  it('refuses an edit that would invert the claim its sources make', () => {
    // The one edit that survives every other check: the wording changes, the condition does
    // not, and the rule now says the opposite of the corrections behind it.
    expect(
      refusal(() =>
        applyDecision(
          batch(),
          decision({ action: 'edit', textAfter: 'Never refund the shipping fee for a damaged item.' }),
        ),
      ),
    ).toMatch(/edited card is not admissible: polarity/);
  });

  it('replaces the text on an edit', () => {
    const decided = applyDecision(
      batch(),
      decision({ action: 'edit', textAfter: 'Refund the shipping fee for an item that arrived damaged.' }),
    );
    expect(decided.items[0]?.text).toBe('Refund the shipping fee for an item that arrived damaged.');
  });

  it('refuses an edit that carries no text', () => {
    expect(refusal(() => applyDecision(batch(), decision({ action: 'edit', textAfter: '   ' })))).toMatch(
      /replacement text/,
    );
    // No replacement and no condition change is a no-op, and the sentence says so: a
    // reviewer who forgot to type is told what happened, not what to type.
    expect(refusal(() => applyDecision(batch(), decision({ action: 'edit' })))).toMatch(/changes nothing/);
  });

  it('refuses an edit that changes nothing, because it is an accept', () => {
    // Counting it as an edit would inflate the edit rate, which is the number that says how
    // often the proposer's wording survived contact with a reader.
    expect(
      refusal(() =>
        applyDecision(
          batch(),
          decision({ action: 'edit', textAfter: 'Refund the shipping fee when the item arrived damaged.  ' }),
        ),
      ),
    ).toMatch(/changes nothing/);
  });
});

describe('reject and defer', () => {
  it('refuses a rejection with no reason', () => {
    expect(refusal(() => applyDecision(batch(), decision({ action: 'reject' })))).toMatch(/carries a reason/);
  });

  it('rejects with a reason recorded', () => {
    const decided = applyDecision(batch(), decision({ action: 'reject', reason: 'two situations, not one' }));
    expect(decided.items[0]?.state).toBe('rejected');
    expect(decided.items[0]?.decision?.reason).toBe('two situations, not one');
  });

  it('lets a deferred card be decided later, and only a deferred one', () => {
    const deferred = applyDecision(batch(), decision({ action: 'defer' }));
    expect(deferred.items[0]?.state).toBe('deferred');
    expect(applyDecision(deferred, decision()).items[0]?.state).toBe('accepted');
  });
});

describe('a split is re-witnessed rather than inherited', () => {
  it('refuses a split into one part, which is an edit', () => {
    expect(refusal(() => applyDecision(batch(), decision({ action: 'split', splitInto: ['only one'] })))).toMatch(
      /at least two parts/,
    );
    expect(refusal(() => applyDecision(batch(), decision({ action: 'split', splitInto: ['one', '  '] })))).toMatch(
      /at least two parts/,
    );
    expect(refusal(() => applyDecision(batch(), decision({ action: 'split' })))).toMatch(/at least two parts/);
  });

  it('gives each part only the members its own trigger reaches', () => {
    // The reviewer is asserting that the members divide along the new conditions. A part that
    // keeps the parent's coverage would claim a member it no longer describes.
    const decided = applyDecision(
      batch(),
      decision({ action: 'split', splitInto: ['Refund the shipping fee for a damaged item.', 'Refund the shipping fee when the box was open.'] }),
    );
    const children = decided.items[0]?.children ?? [];
    expect(children).toHaveLength(2);
    expect(children[0]?.covers).toEqual(['k1', 'k2']);
    expect(decided.items[0]?.state).toBe('split');
  });

  it('numbers the children so a decision on one is addressable', () => {
    const decided = applyDecision(
      batch(),
      decision({ action: 'split', splitInto: ['Refund the shipping fee for a damaged item.', 'Refund the shipping fee when the box was open.'] }),
    );
    expect(decided.items[0]?.children?.map((child) => child.id)).toEqual(['gp1_s1', 'gp1_s2']);
  });
});

describe('replaying a ledger is a fold, and it must land in the same place', () => {
  it('produces the same batch from the same decisions in the same order', () => {
    const decisions = [decision({ action: 'edit', textAfter: 'Refund the shipping fee for a damaged item.' })];
    const once = applyDecisions(batch(), decisions);
    const twice = applyDecisions(batch(), decisions);
    expect(twice.items[0]?.text).toBe(once.items[0]?.text);
    expect(twice.items[0]?.state).toBe(once.items[0]?.state);
  });

  it('does not mutate the batch it was given', () => {
    const original = batch();
    applyDecision(original, decision());
    expect(original.items[0]?.state).toBe('pending');
  });
});

describe('the summary is what the human cost', () => {
  it('counts states and computes the rates over what was decided', () => {
    const decided = applyDecisions(batch([proposal(), proposal({ id: 'gp2' }), proposal({ id: 'gp3' })]), [
      decision(),
      decision({ candidateId: 'gp2', action: 'edit', textAfter: 'Refund the shipping fee for a damaged item.', textBefore: 'Refund the shipping fee when the item arrived damaged.' }),
      decision({ candidateId: 'gp3', action: 'reject', reason: 'not a rule' }),
    ]);
    const summary = summaryOf(decided);
    expect(summary).toMatchObject({ total: 3, accepted: 2, edited: 1, rejected: 1, pending: 0, acceptRate: 0.6667 });
    expect(summary.editRate).toBe(0.5);
  });

  it('reports an accept rate of zero rather than dividing by zero before anything is decided', () => {
    const summary = summaryOf(batch());
    expect(summary.acceptRate).toBe(0);
    expect(summary.editRate).toBe(0);
    expect(summary.medianElapsedMs).toBe(0);
  });

  it('takes the middle decision time, and the mean of the middle two when there is no middle', () => {
    const odd = applyDecisions(batch([proposal(), proposal({ id: 'gp2' }), proposal({ id: 'gp3' })]), [
      decision({ elapsedMs: 1_000 }),
      decision({ candidateId: 'gp2', elapsedMs: 3_000 }),
      decision({ candidateId: 'gp3', elapsedMs: 2_000 }),
    ]);
    expect(summaryOf(odd).medianElapsedMs).toBe(2_000);
    const even = applyDecisions(batch([proposal(), proposal({ id: 'gp2' })]), [
      decision({ elapsedMs: 1_000 }),
      decision({ candidateId: 'gp2', elapsedMs: 2_000 }),
    ]);
    expect(summaryOf(even).medianElapsedMs).toBe(1_500);
  });
});

describe('an admitted guideline enters the store through the ordinary write path', () => {
  const accepted = (): ReviewBatch => applyDecision(batch(), decision());

  it('refuses an accepted card that carries no decision, which is a corrupted ledger', () => {
    const corrupted: ReviewBatch = {
      ...batch(),
      items: batch().items.map((item) => ({ ...item, state: 'accepted' as const })),
    };
    expect(refusal(() => toDistillCandidate(corrupted, corrupted.items[0]!, { decisionId: 'd1' }))).toMatch(
      /carries a decision/,
    );
  });

  it('refuses to accept a card the gate rejected', () => {
    // The console cannot wave a restatement through, or the admissibility gate is decoration
    // and the pipeline is a hand-written prompt with extra steps.
    const thin = buildBatch({
      id: 'batch-3',
      createdAt: at,
      namespace: 'acme',
      policy: DEFAULT_RETROSPECT_POLICY,
      corpus,
      proposals: [proposal({ covers: ['k1'] })],
    });
    expect(refusal(() => applyDecision(thin, decision({ textBefore: thin.items[0]!.text })))).toMatch(
      /not admissible as it stands: restatement/,
    );
  });

  it('admits against the gate only through a recorded override', () => {
    const thin = buildBatch({
      id: 'batch-3',
      createdAt: at,
      namespace: 'acme',
      policy: DEFAULT_RETROSPECT_POLICY,
      corpus,
      proposals: [proposal({ covers: ['k1'] })],
    });
    const before = thin.items[0]!.text;
    expect(refusal(() => applyDecision(thin, decision({ action: 'override', textBefore: before })))).toMatch(
      /carries a reason/,
    );
    const accepted = applyDecision(thin, decision({ action: 'override', textBefore: before, reason: 'two tasks will arrive next week' }));
    const candidate = toDistillCandidate(accepted, accepted.items[0]!, { decisionId: 'd3' });
    expect(candidate.payload).toMatchObject({ reviewAction: 'override' });
  });

  it('refuses an accepted card whose text nobody would have admitted', () => {
    // Reachable only from a hand-built or tampered ledger, which is exactly the case the
    // check is for: the write path must not be reachable by a card the gate never saw.
    const tampered: ReviewBatch = {
      ...batch(),
      items: batch().items.map((item) => ({
        ...item,
        state: 'accepted' as const,
        text: 'Never refund the shipping fee for a damaged item.',
        decision: { ...decision(), textBefore: 'Never refund the shipping fee for a damaged item.' },
      })),
    };
    expect(refusal(() => toDistillCandidate(tampered, tampered.items[0]!, { decisionId: 'd9' }))).toMatch(
      /not admissible: polarity/,
    );
  });

  it('admits an override that covers nothing, and says so in the payload', () => {
    // The reviewer can be wrong in a way the corpus cannot corroborate; the item then carries
    // a support of zero rather than an invented one, which is what a later audit reads.
    const ghost = buildBatch({
      id: 'batch-4',
      createdAt: at,
      namespace: 'acme',
      policy: DEFAULT_RETROSPECT_POLICY,
      corpus,
      proposals: [proposal({ covers: ['ghost-a', 'ghost-b'] })],
    });
    const acceptedGhost = applyDecision(
      ghost,
      decision({ action: 'override', textBefore: ghost.items[0]!.text, reason: 'the corpus is incomplete' }),
    );
    const candidate = toDistillCandidate(acceptedGhost, acceptedGhost.items[0]!, { decisionId: 'd4' });
    expect(candidate.payload).toMatchObject({ support: 0, distinctTasks: 0 });
    expect(candidate.scope.task).toBe('unknown');
    expect(candidate.evidence.weight).toBe(0);
  });

  it('refuses a card that is not accepted', () => {
    expect(refusal(() => toDistillCandidate(batch(), batch().items[0]!, { decisionId: 'd1' }))).toMatch(
      /only an accepted guideline/,
    );
  });

  it('names the sources it subsumes, so lineage survives the merge', () => {
    const candidate = toDistillCandidate(accepted(), accepted().items[0]!, { decisionId: 'd1' });
    expect((candidate.payload as { mergedFrom: string[] }).mergedFrom).toEqual(['k1', 'k2']);
    expect((candidate.payload as { support: number }).support).toBe(2);
  });

  it('inherits the evidence strength of what it subsumes rather than inventing one', () => {
    const candidate = toDistillCandidate(accepted(), accepted().items[0]!, { decisionId: 'd1' });
    expect(candidate.evidence.weight).toBe(0.8);
    expect(candidate.trust).toBe(0.7);
  });

  it('is written as a procedure, which is the kind a condition-bearing rule already is', () => {
    const candidate = toDistillCandidate(accepted(), accepted().items[0]!, { decisionId: 'd1' });
    expect(candidate.kind).toBe('procedure');
    expect(candidate.when).toBe('when a refund is requested for a damaged item');
  });

  it('counts distinct tasks rather than records', () => {
    const candidate = toDistillCandidate(accepted(), accepted().items[0]!, { decisionId: 'd1' });
    expect((candidate.payload as { distinctTasks: number }).distinctTasks).toBe(2);
  });

  it('carries the reviewer and the batch, so the item can be traced to a decision', () => {
    const candidate = toDistillCandidate(accepted(), accepted().items[0]!, { decisionId: 'd1' });
    expect(candidate.payload).toMatchObject({ reviewedBy: 'lambertyan', reviewAction: 'accept', batch: 'batch-1' });
    expect(candidate.evidence.feedbackId).toBe('d1');
  });

  it('gives two guidelines with one statement and different conditions two identities', () => {
    // Merging them would silently widen both rules, and the store would never show it.
    const first = toDistillCandidate(accepted(), accepted().items[0]!, { decisionId: 'd1' });
    const other = buildBatch({
      id: 'batch-2',
      createdAt: at,
      namespace: 'acme',
      policy: DEFAULT_RETROSPECT_POLICY,
      corpus,
      proposals: [proposal({ when: 'when a refund is requested' })],
    });
    const second = toDistillCandidate(
      applyDecision(other, decision()),
      applyDecision(other, decision()).items[0]!,
      { decisionId: 'd2' },
    );
    expect(second.dedupeKey).not.toBe(first.dedupeKey);
  });

  it('carries a domain only when the caller named one', () => {
    const withDomain = toDistillCandidate(accepted(), accepted().items[0]!, { domain: 'retail', decisionId: 'd1' });
    expect(withDomain.scope.domain).toBe('retail');
    expect(toDistillCandidate(accepted(), accepted().items[0]!, { decisionId: 'd1' }).scope.domain).toBeUndefined();
  });
});
