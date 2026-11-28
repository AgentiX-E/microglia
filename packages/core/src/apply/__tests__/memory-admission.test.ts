/**
 * R251 — evidence-linked admission gate, behaviour tests.
 *
 * The gate decides, for each retrieved lesson, whether it may enter the model context (`admit`), must be
 * checked against its linked evidence first (`escalate`), or must be withheld (`reject`). The rules come from
 * WikiTrace (arXiv 2611.14320) and MemTrapBench (arXiv 2608.20202); see memory-admission.ts.
 */
import { describe, expect, it } from 'vitest';

import { memoryAdmission, type AdmissionCandidate, type MemoryAdmissionInput } from '../memory-admission.js';

const query = (over: Partial<MemoryAdmissionInput['query']> = {}): MemoryAdmissionInput['query'] => ({
  id: 'q1',
  key: 'task',
  boundary: 'current',
  ...over,
});

const candidate = (over: Partial<AdmissionCandidate> = {}): AdmissionCandidate => ({
  id: 'c1',
  key: 'task',
  outcome: 'success',
  detail: 'sufficient',
  conflict: 'none',
  evidence: { linked: true, reachable: true },
  ...over,
});

const run = (candidates: AdmissionCandidate[], over: Partial<MemoryAdmissionInput> = {}) =>
  memoryAdmission({ id: 'ep-1', query: query(), candidates, ...over });

describe('R251 eligibility guards', () => {
  it('rejects a blank episode id', () => {
    expect(() => memoryAdmission({ id: ' ', query: query(), candidates: [candidate()] })).toThrow();
  });
  it('rejects a non-object query', () => {
    expect(() => memoryAdmission({ id: 'x', query: 1 as never, candidates: [candidate()] })).toThrow();
  });
  it('rejects a blank query id', () => {
    expect(() => memoryAdmission({ id: 'x', query: query({ id: '' }), candidates: [candidate()] })).toThrow();
  });
  it('rejects a blank query key', () => {
    expect(() => memoryAdmission({ id: 'x', query: query({ key: ' ' }), candidates: [candidate()] })).toThrow();
  });
  it('rejects a blank query boundary', () => {
    expect(() => memoryAdmission({ id: 'x', query: query({ boundary: ' ' }), candidates: [candidate()] })).toThrow();
  });
  it('rejects a non-array candidates', () => {
    expect(() => memoryAdmission({ id: 'x', query: query(), candidates: 'no' as never })).toThrow();
  });
  it('rejects empty candidates', () => {
    expect(() => run([])).toThrow();
  });
  it('rejects a non-object candidate', () => {
    expect(() => run([null as never])).toThrow();
  });
  it('rejects a blank candidate id', () => {
    expect(() => run([candidate({ id: '' })])).toThrow();
  });
  it('rejects a duplicate candidate id', () => {
    expect(() => run([candidate({ id: 'd' }), candidate({ id: 'd' })])).toThrow();
  });
  it('rejects a blank candidate key', () => {
    expect(() => run([candidate({ key: ' ' })])).toThrow();
  });
  it('rejects an unknown outcome', () => {
    expect(() => run([candidate({ outcome: 'maybe' as never })])).toThrow();
  });
  it('rejects an unknown detail', () => {
    expect(() => run([candidate({ detail: 'partial' as never })])).toThrow();
  });
  it('rejects an unknown conflict', () => {
    expect(() => run([candidate({ conflict: 'trap' as never })])).toThrow();
  });
  it('rejects a non-object evidence', () => {
    expect(() => run([candidate({ evidence: 1 as never })])).toThrow();
  });
  it('rejects non-boolean evidence flags', () => {
    expect(() => run([candidate({ evidence: { linked: 'yes', reachable: true } as never })])).toThrow();
  });
  it('rejects reachable evidence that is not linked', () => {
    expect(() => run([candidate({ evidence: { linked: false, reachable: true } })])).toThrow();
  });
});

describe('R251 single-candidate disposition ladder', () => {
  it('admits a successful, sufficient, non-conflicting lesson with linked evidence', () => {
    const r = run([candidate()]);
    expect(r.verdict).toBe('admit');
    expect(r.reason).toBe('valid-lesson');
    expect(r.admitCount).toBe(1);
  });

  it('admits even when evidence is unlinked if the lesson needs no checking', () => {
    const r = run([candidate({ evidence: { linked: false, reachable: false } })]);
    expect(r.verdict).toBe('admit');
    expect(r.reason).toBe('valid-lesson');
  });

  it('rejects a task-boundary violation before any check (MemTrapBench 31.05)', () => {
    const r = run([candidate({ conflict: 'boundary' })]);
    expect(r.verdict).toBe('reject');
    expect(r.reason).toBe('task-boundary-violation');
    expect(r.rejectCount).toBe(1);
  });

  it('escalates an insufficient-detail lesson whose evidence is reachable', () => {
    const r = run([candidate({ detail: 'insufficient' })]);
    expect(r.verdict).toBe('escalate');
    expect(r.reason).toBe('verify-details');
    expect(r.escalateCount).toBe(1);
  });

  it('rejects an insufficient-detail lesson whose evidence cannot be reached', () => {
    const r = run([candidate({ detail: 'insufficient', evidence: { linked: true, reachable: false } })]);
    expect(r.verdict).toBe('reject');
    expect(r.reason).toBe('unverifiable-detail');
  });

  it('escalates a rule conflict whose evidence is reachable', () => {
    const r = run([candidate({ conflict: 'rule' })]);
    expect(r.verdict).toBe('escalate');
    expect(r.reason).toBe('verify-conflict');
  });

  it('rejects a rule conflict whose evidence cannot be reached', () => {
    const r = run([candidate({ conflict: 'rule', evidence: { linked: true, reachable: false } })]);
    expect(r.verdict).toBe('reject');
    expect(r.reason).toBe('unverifiable-conflict');
  });

  it('escalates a lesson from a failed task whose evidence is reachable', () => {
    const r = run([candidate({ outcome: 'failure' })]);
    expect(r.verdict).toBe('escalate');
    expect(r.reason).toBe('verify-failed-source');
  });

  it('rejects a failed-task lesson whose evidence cannot be reached', () => {
    const r = run([candidate({ outcome: 'failure', evidence: { linked: true, reachable: false } })]);
    expect(r.verdict).toBe('reject');
    expect(r.reason).toBe('unverifiable-failed-source');
  });

  it('reports boundary over a failure even when both apply', () => {
    const r = run([candidate({ conflict: 'boundary', outcome: 'failure' })]);
    expect(r.reason).toBe('task-boundary-violation');
  });

  it('reports insufficient detail over a rule conflict when both apply', () => {
    const r = run([candidate({ detail: 'insufficient', conflict: 'rule' })]);
    expect(r.reason).toBe('verify-details');
  });

  it('reports a rule conflict over a failed source when both apply', () => {
    const r = run([candidate({ conflict: 'rule', outcome: 'failure' })]);
    expect(r.reason).toBe('verify-conflict');
  });
});

describe('R251 aggregation and readback', () => {
  it('a single reject dominates the whole retrieval set', () => {
    const r = run([
      candidate({ id: 'good', key: 'task' }),
      candidate({ id: 'bad', conflict: 'boundary' }),
      candidate({ id: 'check', detail: 'insufficient' }),
    ]);
    expect(r.verdict).toBe('reject');
    expect(r.reason).toBe('task-boundary-violation');
    expect(r.decidingId).toBe('bad');
    expect(r.admitCount).toBe(1);
    expect(r.escalateCount).toBe(1);
    expect(r.rejectCount).toBe(1);
  });

  it('an escalate dominates an all-admit set with no reject', () => {
    const r = run([candidate({ id: 'good' }), candidate({ id: 'check', detail: 'insufficient' })]);
    expect(r.verdict).toBe('escalate');
    expect(r.reason).toBe('verify-details');
    expect(r.decidingId).toBe('check');
  });

  it('the three disposition counts partition the candidate total', () => {
    const r = run([
      candidate({ id: 'a' }),
      candidate({ id: 'b', detail: 'insufficient' }),
      candidate({ id: 'c', conflict: 'boundary' }),
      candidate({ id: 'd', outcome: 'failure' }),
    ]);
    expect(r.candidateCount).toBe(4);
    expect(r.admitCount + r.escalateCount + r.rejectCount).toBe(r.candidateCount);
  });

  it('does not mutate a frozen input', () => {
    const input = Object.freeze({
      id: 'ep-frozen',
      query: Object.freeze(query()),
      candidates: Object.freeze([Object.freeze(candidate())]),
    });
    expect(() => memoryAdmission(input)).not.toThrow();
    expect(input.candidates[0]?.evidence.linked).toBe(true);
  });

  it('echoes the episode id and query key', () => {
    const r = run([candidate()], { id: 'ep-9', query: query({ key: 'deploy' }) });
    expect(r.id).toBe('ep-9');
    expect(r.queryKey).toBe('deploy');
  });
});
