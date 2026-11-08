import { describe, expect, it } from 'vitest';
import {
  countDistinctTasks,
  createKnowledgeItem,
  distinctTasks,
  mergeEvidence,
  scoreKnowledge,
} from '../knowledge.js';
import { defaultPolicy } from '../policy.js';
import type { DistillCandidate, EvidenceRef } from '../types.js';

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

/**
 * The count itself, exported so a census can ask the same question of a sample.
 *
 * R55.0's `supportTasks` is this number read off the artefact's `storeItems`, and a readback that
 * re-implemented the grouping would be free to disagree with the score it is supposed to explain.
 */
describe('the distinct-task count as its own contract', () => {
  it('agrees with the score on what one task is', () => {
    const six = fold(6, () => 'task_a');
    expect(countDistinctTasks(six.evidence)).toBe(1);
    expect(distinctTasks(six)).toBe(countDistinctTasks(six.evidence));
  });

  it('separates tasks and runs, and counts a run only when no task is named', () => {
    const mixed: readonly EvidenceRef[] = [
      { feedbackId: 'f1', runId: 'r1', at: AT, weight: 0.9, taskId: 'task_a' },
      { feedbackId: 'f2', runId: 'r2', at: AT, weight: 0.9, taskId: 'task_a' },
      { feedbackId: 'f3', runId: 'r3', at: AT, weight: 0.9, taskId: 'task_b' },
      { feedbackId: 'f4', runId: 'r4', at: AT, weight: 0.9 },
    ];
    // Two tasks and one unattributed run: four rows, three observations.
    expect(countDistinctTasks(mixed)).toBe(3);
  });

  it('is zero for no evidence, not one', () => {
    // A store item always has at least one row, so zero is reachable only through a caller that
    // passed none. Returning 1 there would let an empty item claim corroboration it does not have.
    expect(countDistinctTasks([])).toBe(0);
  });
});
