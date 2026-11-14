import { describe, expect, it } from 'vitest';
import { createKnowledgeItem, mergeEvidence, withoutEvidence, wouldChange } from '../knowledge.js';
import { defaultPolicy } from '../policy.js';
import { polarityFor } from '../provenance.js';
import type { DistillCandidate, KnowledgePolarity } from '../types.js';

const AT = 1_700_000_000_000;

function candidate(overrides: Partial<DistillCandidate> = {}): DistillCandidate {
  return {
    namespace: 'acme',
    kind: 'constraint',
    scope: { task: 'chart.recommend' },
    statement: 'For a trend question over revenue. Use a line chart rather than a bar chart.',
    evidence: { feedbackId: 'fb_1', runId: 'run_1', at: AT, weight: 0.9, taskId: 'task_a' },
    trust: 0.9,
    dedupeKey: 'acme|constraint|trend',
    ...overrides,
  };
}

function sided(side: KnowledgePolarity, taskId: string, feedbackId: string): DistillCandidate {
  return candidate({
    evidence: { feedbackId, runId: `run_${taskId}`, at: AT, weight: 0.9, taskId },
    polarity: side,
  });
}

describe('the side a signal sits on', () => {
  it('reads a rating by its value, not by its kind', () => {
    expect(polarityFor({ type: 'rating', value: 'down', reasons: [] })).toBe('repair');
    expect(polarityFor({ type: 'rating', value: 'up', reasons: [] })).toBe('pass');
  });

  it('reads an outcome by whether the artefact worked', () => {
    expect(polarityFor({ type: 'outcome', ok: false, code: 'E_BAD' })).toBe('repair');
    expect(polarityFor({ type: 'outcome', ok: true })).toBe('pass');
  });

  it('reads a correction, a rejection, a question and a refusal as repairs', () => {
    // Each is a record of something that did not stand: an artefact that was replaced, one that
    // lost a comparison, an answer that needed a question asked, and one that was not given.
    expect(
      polarityFor({
        type: 'edit',
        beforeHash: 'a',
        afterHash: 'b',
        ops: [],
        distance: 0.5,
        after: { mark: 'line' },
      }),
    ).toBe('repair');
    expect(
      polarityFor({ type: 'preference', chosenRunId: 'r1', rejectedRunId: 'r2' }),
    ).toBe('repair');
    expect(polarityFor({ type: 'clarification', question: 'which revenue', answer: 'net' })).toBe('repair');
    expect(polarityFor({ type: 'abstain', reason: 'no schema' })).toBe('repair');
  });
});

describe('the item carries the side it was learned from', () => {
  it('keeps the polarity the candidate declared', () => {
    const item = createKnowledgeItem(candidate({ polarity: 'repair' }), defaultPolicy, AT, 'k_1');
    expect(item.polarity).toBe('repair');
  });

  it('stays unclassified when the candidate declared nothing', () => {
    // Absent is "not classified", never "pass": every record written before the field existed
    // carries no side, and reading that silence as a success is the defect the field exists to fix.
    const item = createKnowledgeItem(candidate(), defaultPolicy, AT, 'k_1');
    expect(item.polarity).toBeUndefined();
  });

  it('does not change what the item is worth or whether it activates', () => {
    const plain = createKnowledgeItem(candidate(), defaultPolicy, AT, 'k_1');
    const repair = createKnowledgeItem(candidate({ polarity: 'repair' }), defaultPolicy, AT, 'k_1');
    const pass = createKnowledgeItem(candidate({ polarity: 'pass' }), defaultPolicy, AT, 'k_1');
    expect(repair.confidence).toBe(plain.confidence);
    expect(pass.status).toBe(plain.status);
    expect(repair.support).toBe(plain.support);
  });
});

describe('the side travels through a merge', () => {
  it('adopts a side onto an item that predates the field', () => {
    const legacy = createKnowledgeItem(candidate(), defaultPolicy, AT, 'k_1');
    expect(wouldChange(legacy, sided('repair', 'task_b', 'fb_2'), defaultPolicy)).toBe(true);
    const merged = mergeEvidence(legacy, sided('repair', 'task_b', 'fb_2'), defaultPolicy, AT);
    expect(merged.polarity).toBe('repair');
  });

  it('does not flip a lesson learned from a failure when a success endorses it', () => {
    // The side names what the claim was learned *from*, which is the originating observation's
    // property, exactly as `when` is. A success that repeats the rule is support, not a side.
    const repair = createKnowledgeItem(sided('repair', 'task_a', 'fb_1'), defaultPolicy, AT, 'k_1');
    const endorsed = mergeEvidence(repair, sided('pass', 'task_b', 'fb_2'), defaultPolicy, AT);
    expect(endorsed.polarity).toBe('repair');
    expect(endorsed.evidence).toHaveLength(2);
    expect(endorsed.support).toBeGreaterThan(repair.support);
  });

  it('does not flip the other way either', () => {
    const pass = createKnowledgeItem(sided('pass', 'task_a', 'fb_1'), defaultPolicy, AT, 'k_1');
    const corrected = mergeEvidence(pass, sided('repair', 'task_b', 'fb_2'), defaultPolicy, AT);
    expect(corrected.polarity).toBe('pass');
  });

  it('writes nothing when the only difference is the side, so the store keeps one answer', () => {
    const repair = createKnowledgeItem(sided('repair', 'task_a', 'fb_1'), defaultPolicy, AT, 'k_1');
    const repeat: DistillCandidate = {
      ...sided('pass', 'task_a', 'fb_1'),
      statement: repair.statement,
    };
    // Same evidence id, same claim: the two observations are the same one restated with the other
    // side, which cannot be true of one event, and the merge is a no-op rather than a rewrite.
    expect(wouldChange(repair, repeat, defaultPolicy)).toBe(false);
    expect(mergeEvidence(repair, repeat, defaultPolicy, AT)).toBe(repair);
  });

  it('leaves an unclassified item unclassified through a merge that declares nothing', () => {
    const legacy = createKnowledgeItem(candidate(), defaultPolicy, AT, 'k_1');
    const second = candidate({
      evidence: { feedbackId: 'fb_2', runId: 'run_2', at: AT, weight: 0.9, taskId: 'task_b' },
    });
    const merged = mergeEvidence(legacy, second, defaultPolicy, AT);
    expect(merged.evidence).toHaveLength(2);
    expect(merged.polarity).toBeUndefined();
  });
});

describe('erasure and the side', () => {
  it('keeps the side when its evidence is erased, because a side is not a support mass', () => {
    const item = createKnowledgeItem(sided('repair', 'task_a', 'fb_1'), defaultPolicy, AT, 'k_1');
    const merged = mergeEvidence(item, sided('repair', 'task_b', 'fb_2'), defaultPolicy, AT);
    const tiers = new Map<string, 'outcome'>([
      ['fb_1', 'outcome'],
      ['fb_2', 'outcome'],
    ]);
    const erased = withoutEvidence(merged, new Set(['fb_1']), tiers, defaultPolicy, AT);
    // Support is a mass of surviving observations and is recomputed; the side is a fact about the
    // observation that named the claim, which erasing another observation does not unsay.
    expect(erased.evidence.map((entry) => entry.feedbackId)).toEqual(['fb_2']);
    expect(erased.polarity).toBe('repair');
  });
});
