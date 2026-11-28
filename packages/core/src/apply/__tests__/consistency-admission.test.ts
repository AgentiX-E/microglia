/**
 * R255 — ConsistencyGate-style write-time admission (arXiv 2607.22962).
 *
 * RED-first: these tests specify the self-consistency gate before the module exists.
 * All arithmetic is integer thousandths so the product and the independent Python
 * reader compare integers, never floats.
 */
import { describe, expect, it } from 'vitest';

import {
  consistencyAdmission,
  type ConsistencyAdmissionInput,
  type ConsistencyCandidate,
} from '../consistency-admission.js';

const samples = (...values: number[]) => ({ kind: 'samples' as const, supportsMilli: values });
const fixed = (tauMilli: number) => ({ mode: 'fixed' as const, tauMilli });
const candidate = (id: string, evidence: ConsistencyCandidate['evidence']): ConsistencyCandidate => ({ id, evidence });
const base = (
  candidates: ConsistencyCandidate[],
  over: Partial<ConsistencyAdmissionInput> = {},
): ConsistencyAdmissionInput => ({ id: 'ep', threshold: fixed(700), candidates, ...over });

describe('R255 consistency admission — behaviour', () => {
  it('admits a fully supported candidate', () => {
    const r = consistencyAdmission(base([candidate('c1', samples(1000, 1000, 1000, 1000, 1000))]));
    expect(r.verdict).toBe('admit');
    expect(r.reason).toBe('supported');
    expect(r.decidingId).toBe('c1');
    expect(r.decidingSupportMilli).toBe(1000);
    expect(r.thresholdMilli).toBe(700);
    expect(r.admitCount).toBe(1);
    expect(r.rejectCount).toBe(0);
    expect(r.candidateCount).toBe(1);
  });

  it('rejects a contradicted candidate (all samples zero)', () => {
    const r = consistencyAdmission(base([candidate('c1', samples(0, 0, 0, 0, 0))]));
    expect(r.verdict).toBe('reject');
    expect(r.reason).toBe('contradicted');
    expect(r.decidingSupportMilli).toBe(0);
  });

  it('admits exactly at the threshold (>= not >)', () => {
    const r = consistencyAdmission(base([candidate('c1', samples(700, 700, 700, 700, 700))]));
    expect(r.verdict).toBe('admit');
    expect(r.decidingSupportMilli).toBe(700);
  });

  it('rejects one thousandth below the threshold as insufficient-support', () => {
    const r = consistencyAdmission(base([candidate('c1', samples(699, 699, 699, 699, 699))]));
    expect(r.verdict).toBe('reject');
    expect(r.reason).toBe('insufficient-support');
    expect(r.decidingSupportMilli).toBe(699);
  });

  it('rounds the mean half-up and rejects the ambiguous case', () => {
    const r = consistencyAdmission(base([candidate('c1', samples(300, 400, 500, 600, 700))]));
    expect(r.decidingSupportMilli).toBe(500);
    expect(r.reason).toBe('insufficient-support');
  });

  it('rounds .5 up like JS Math.round', () => {
    const r = consistencyAdmission(base([candidate('c1', samples(0, 1000))]));
    expect(r.decidingSupportMilli).toBe(500);
  });

  it('a single contradiction dominates the set and counts partition', () => {
    const r = consistencyAdmission(
      base([
        candidate('good', samples(1000, 1000)),
        candidate('bad', samples(0, 0)),
        candidate('mid', samples(700, 700)),
      ]),
    );
    expect(r.verdict).toBe('reject');
    expect(r.decidingId).toBe('bad');
    expect(r.decidingReason).toBe('contradicted');
    expect(r.candidateCount).toBe(3);
    expect(r.admitCount).toBe(2);
    expect(r.rejectCount).toBe(1);
  });

  it('ties go to the first candidate of equal severity', () => {
    const r = consistencyAdmission(
      base([candidate('first', samples(0, 0)), candidate('second', samples(0, 0))]),
    );
    expect(r.decidingId).toBe('first');
  });

  it('reports ablation: dropping the decisive gate flips the verdict', () => {
    const r = consistencyAdmission(
      base(
        [
          candidate('good', samples(1000, 1000)),
          candidate('bad', samples(0, 0)),
          candidate('mid', samples(700, 700)),
        ],
        {
          ablations: [
            { id: 'drop-bad', removedCandidateId: 'bad' },
            { id: 'drop-good', removedCandidateId: 'good' },
          ],
        },
      ),
    );
    expect(r.ablations).toHaveLength(2);
    expect(r.ablations[0]).toMatchObject({ id: 'drop-bad', beforeVerdict: 'reject', afterVerdict: 'admit', changed: true });
    expect(r.ablations[1]).toMatchObject({ id: 'drop-good', beforeVerdict: 'reject', afterVerdict: 'reject', changed: false });
  });

  it('adaptive threshold is permissive when memory is sparse', () => {
    const r = consistencyAdmission(
      base([candidate('c1', samples(500, 500, 500, 500, 500))], {
        threshold: { mode: 'adaptive', tauMinMilli: 400, tauMaxMilli: 800, memorySize: 0, capacity: 500 },
      }),
    );
    expect(r.thresholdMilli).toBe(400);
    expect(r.verdict).toBe('admit');
  });

  it('adaptive threshold is strict when memory is full — occupancy alone flips the write', () => {
    const r = consistencyAdmission(
      base([candidate('c1', samples(500, 500, 500, 500, 500))], {
        threshold: { mode: 'adaptive', tauMinMilli: 400, tauMaxMilli: 800, memorySize: 500, capacity: 500 },
      }),
    );
    expect(r.thresholdMilli).toBe(800);
    expect(r.verdict).toBe('reject');
  });

  it('adaptive threshold rounds to the nearest thousandth', () => {
    const r = consistencyAdmission(
      base([candidate('c1', samples(500, 500))], {
        threshold: { mode: 'adaptive', tauMinMilli: 400, tauMaxMilli: 800, memorySize: 250, capacity: 500 },
      }),
    );
    expect(r.thresholdMilli).toBe(600);
  });

  it('computes single-pass logprob support (yes dominates)', () => {
    const r = consistencyAdmission(base([candidate('c1', { kind: 'logprob', yesLog: -0.1, noLog: -2.3 })]));
    expect(r.decidingSupportMilli).toBe(900);
    expect(r.verdict).toBe('admit');
  });

  it('computes single-pass logprob support (no dominates)', () => {
    const r = consistencyAdmission(base([candidate('c1', { kind: 'logprob', yesLog: -2.3, noLog: -0.1 })]));
    expect(r.decidingSupportMilli).toBe(100);
    expect(r.verdict).toBe('reject');
    expect(r.reason).toBe('insufficient-support');
  });

  it('is deterministic', () => {
    const input = base([candidate('c1', samples(300, 700, 500))]);
    expect(consistencyAdmission(input)).toEqual(consistencyAdmission(input));
  });

  it('accepts a single candidate', () => {
    expect(consistencyAdmission(base([candidate('only', samples(1000))])).candidateCount).toBe(1);
  });
});

describe('R255 consistency admission — guards refuse rather than default', () => {
  it('refuses a blank episode id', () => {
    expect(() => consistencyAdmission(base([candidate('c1', samples(1000))], { id: ' ' }))).toThrow();
  });

  it('refuses a non-array candidate list', () => {
    expect(() => consistencyAdmission(base('nope' as never))).toThrow();
  });

  it('refuses an empty candidate list', () => {
    expect(() => consistencyAdmission(base([]))).toThrow();
  });

  it('refuses a non-object candidate', () => {
    expect(() => consistencyAdmission(base([null as never]))).toThrow();
  });

  it('refuses a blank candidate id', () => {
    expect(() => consistencyAdmission(base([candidate(' ', samples(1000))]))).toThrow();
  });

  it('refuses a duplicate candidate id', () => {
    expect(() =>
      consistencyAdmission(base([candidate('d', samples(1000)), candidate('d', samples(1000))])),
    ).toThrow();
  });

  it('refuses a non-object threshold', () => {
    expect(() => consistencyAdmission(base([candidate('c1', samples(1000))], { threshold: 'fixed' as never }))).toThrow();
  });

  it('refuses an unknown threshold mode', () => {
    expect(() =>
      consistencyAdmission(base([candidate('c1', samples(1000))], { threshold: { mode: 'dynamic' } as never })),
    ).toThrow();
  });

  it('refuses a non-integer fixed tau', () => {
    expect(() => consistencyAdmission(base([candidate('c1', samples(1000))], { threshold: fixed(700.5) }))).toThrow();
  });

  it('refuses a fixed tau above 1000', () => {
    expect(() => consistencyAdmission(base([candidate('c1', samples(1000))], { threshold: fixed(1001) }))).toThrow();
  });

  it('refuses an adaptive tauMin above tauMax', () => {
    expect(() =>
      consistencyAdmission(base([candidate('c1', samples(1000))], {
        threshold: { mode: 'adaptive', tauMinMilli: 800, tauMaxMilli: 400, memorySize: 0, capacity: 500 },
      })),
    ).toThrow();
  });

  it('refuses non-integer adaptive taus', () => {
    expect(() =>
      consistencyAdmission(base([candidate('c1', samples(1000))], {
        threshold: { mode: 'adaptive', tauMinMilli: 400.5, tauMaxMilli: 800, memorySize: 0, capacity: 500 },
      })),
    ).toThrow();
  });

  it('refuses a negative memorySize', () => {
    expect(() =>
      consistencyAdmission(base([candidate('c1', samples(1000))], {
        threshold: { mode: 'adaptive', tauMinMilli: 400, tauMaxMilli: 800, memorySize: -1, capacity: 500 },
      })),
    ).toThrow();
  });

  it('refuses a zero capacity', () => {
    expect(() =>
      consistencyAdmission(base([candidate('c1', samples(1000))], {
        threshold: { mode: 'adaptive', tauMinMilli: 400, tauMaxMilli: 800, memorySize: 0, capacity: 0 },
      })),
    ).toThrow();
  });

  it('clamps occupancy above capacity to the max threshold', () => {
    const r = consistencyAdmission(base([candidate('c1', samples(1000))], {
      threshold: { mode: 'adaptive', tauMinMilli: 400, tauMaxMilli: 800, memorySize: 900, capacity: 500 },
    }));
    expect(r.thresholdMilli).toBe(800);
  });

  it('refuses a non-object evidence', () => {
    expect(() => consistencyAdmission(base([candidate('c1', 'bad' as never)]))).toThrow();
  });

  it('refuses an unknown evidence kind', () => {
    expect(() => consistencyAdmission(base([candidate('c1', { kind: 'gossip' } as never)]))).toThrow();
  });

  it('refuses an empty sample list', () => {
    expect(() => consistencyAdmission(base([candidate('c1', samples())]))).toThrow();
  });

  it('refuses a non-array sample list', () => {
    expect(() => consistencyAdmission(base([candidate('c1', { kind: 'samples', supportsMilli: 'x' } as never)]))).toThrow();
  });

  it('refuses a non-integer sample', () => {
    expect(() => consistencyAdmission(base([candidate('c1', samples(500.5))]))).toThrow();
  });

  it('refuses a sample above 1000', () => {
    expect(() => consistencyAdmission(base([candidate('c1', samples(1001))]))).toThrow();
  });

  it('refuses a negative sample', () => {
    expect(() => consistencyAdmission(base([candidate('c1', samples(-1))]))).toThrow();
  });

  it('refuses a non-finite logprob', () => {
    expect(() => consistencyAdmission(base([candidate('c1', { kind: 'logprob', yesLog: NaN, noLog: 0 })]))).toThrow();
  });

  it('refuses a non-numeric logprob', () => {
    expect(() =>
      consistencyAdmission(base([candidate('c1', { kind: 'logprob', yesLog: 'x' as never, noLog: 0 })])),
    ).toThrow();
  });

  it('refuses a non-array ablation list', () => {
    expect(() => consistencyAdmission(base([candidate('c1', samples(1000))], { ablations: 'x' as never }))).toThrow();
  });

  it('refuses a non-object ablation', () => {
    expect(() => consistencyAdmission(base([candidate('c1', samples(1000))], { ablations: [null as never] }))).toThrow();
  });

  it('refuses a duplicate ablation id', () => {
    expect(() =>
      consistencyAdmission(base([candidate('c1', samples(1000))], {
        ablations: [
          { id: 'x', removedCandidateId: 'c1' },
          { id: 'x', removedCandidateId: 'c1' },
        ],
      })),
    ).toThrow();
  });

  it('refuses an ablation pointing to a missing candidate', () => {
    expect(() =>
      consistencyAdmission(base([candidate('c1', samples(1000))], {
        ablations: [{ id: 'x', removedCandidateId: 'missing' }],
      })),
    ).toThrow();
  });

  it('refuses a blank ablation id', () => {
    expect(() =>
      consistencyAdmission(base([candidate('c1', samples(1000))], {
        ablations: [{ id: ' ', removedCandidateId: 'c1' }],
      })),
    ).toThrow();
  });

  it('handles the boundary: ablating the only candidate leaves an empty set that admits', () => {
    const r = consistencyAdmission(base([candidate('c1', samples(0, 0))], {
      ablations: [{ id: 'drop-only', removedCandidateId: 'c1' }],
    }));
    expect(r.ablations[0]?.afterVerdict).toBe('admit');
    expect(r.ablations[0]?.changed).toBe(true);
  });
});
