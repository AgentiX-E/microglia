import { describe, expect, it } from 'vitest';
import { createKnowledgeItem, mergeEvidence, scoreKnowledge } from '../knowledge.js';
import { defaultPolicy } from '../policy.js';
import type { DistillCandidate } from '../types.js';

const AT = 1_700_000_000_000;

function candidate(index: number, taskId?: string): DistillCandidate {
  return {
    namespace: 'acme',
    kind: 'constraint',
    scope: { task: 'chart.recommend' },
    statement: 'Revenue questions are answered with a line chart.',
    evidence: {
      feedbackId: `fb_${index}`,
      runId: `run_${index}`,
      at: AT,
      weight: 0.95,
      ...(taskId === undefined ? {} : { taskId }),
    },
    trust: 0.95,
    dedupeKey: 'acme|constraint|k',
  };
}

function fold(
  count: number,
  task: (index: number) => string | undefined,
): ReturnType<typeof createKnowledgeItem> {
  let item = createKnowledgeItem(candidate(1, task(1)), defaultPolicy, AT, 'k_1');
  for (let index = 2; index <= count; index += 1) {
    item = mergeEvidence(item, candidate(index, task(index)), defaultPolicy, AT);
  }
  return item;
}

describe('evidence independence', () => {
  it('counts a task once however many attempts it contributes', () => {
    const one = fold(1, () => 'task_a');
    const six = fold(6, () => 'task_a');
    expect(six.evidence).toHaveLength(6);
    // The same task insisting six times is one observation, not six: the score
    // must not move. This is the defect that let a single user admit a rule.
    expect(scoreKnowledge(six, defaultPolicy)).toBeCloseTo(scoreKnowledge(one, defaultPolicy), 9);
  });

  it('counts distinct tasks separately', () => {
    const one = fold(1, () => 'task_a');
    const three = fold(3, (index) => `task_${index}`);
    expect(scoreKnowledge(three, defaultPolicy)).toBeGreaterThan(
      scoreKnowledge(one, defaultPolicy) + 0.05,
    );
  });

  it('keeps the strongest observation of a task, not the sum', () => {
    const strong = createKnowledgeItem(candidate(1, 'task_a'), defaultPolicy, AT, 'k_1');
    const weak: DistillCandidate = {
      ...candidate(2, 'task_a'),
      trust: 0.5,
    };
    const merged = mergeEvidence(strong, weak, defaultPolicy, AT);
    // A weak second try from the same task cannot raise the claim's support.
    expect(scoreKnowledge(merged, defaultPolicy)).toBeCloseTo(
      scoreKnowledge(strong, defaultPolicy),
      9,
    );
  });

  it('falls back to the run identity when no task is declared', () => {
    // Backwards compatibility: callers that never opened a task keep the old
    // behaviour, because one run is one attempt is one observation.
    const two = fold(2, () => undefined);
    const one = fold(1, () => undefined);
    expect(two.evidence).toHaveLength(2);
    expect(scoreKnowledge(two, defaultPolicy)).toBeGreaterThan(
      scoreKnowledge(one, defaultPolicy) + 0.05,
    );
  });
});
