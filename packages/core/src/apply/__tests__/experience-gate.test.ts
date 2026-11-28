/**
 * R254 — behaviour of the experience gate: the strictest effective stage disposition wins.
 */
import { describe, expect, it } from 'vitest';

import {
  EXPERIENCE_GATE_SOURCES,
  EXPERIENCE_VERDICTS,
  GATE_DISPOSITIONS,
  GATE_REASONS,
  experienceGate,
  type ExperienceGateInput,
  type GateStage,
} from '../experience-gate.js';

const stage = (
  id: string,
  source: GateStage['source'],
  disposition: GateStage['disposition'],
  scoreMilli: number,
  reason = 'unit-reason',
): GateStage => ({ id, source, disposition, reason, scoreMilli });

const base = (stages: readonly GateStage[], over: Partial<ExperienceGateInput> = {}): ExperienceGateInput => ({
  id: 'ep',
  stages,
  ...over,
});

describe('experienceGate — closed vocabularies', () => {
  it('declares exactly the ten criteria as gate sources', () => {
    expect([...EXPERIENCE_GATE_SOURCES]).toEqual([
      'view-consistency',
      'abstraction-lifecycle',
      'revision-integrity',
      'stale-revocation',
      'memory-admission',
      'memory-confidence',
      'memory-gain-ledger',
      'state-role',
      'competition-domain',
      'cost-429',
    ]);
  });

  it('declares the four verdicts and reasons in one order', () => {
    expect([...EXPERIENCE_VERDICTS]).toEqual(['admit', 'reweight', 'abstain', 'reject']);
    expect([...GATE_DISPOSITIONS]).toEqual(['admit', 'reweight', 'abstain', 'reject']);
    expect([...GATE_REASONS]).toEqual([
      'all-admitted',
      'reweight-required',
      'abstention-required',
      'hard-gate-rejected',
    ]);
  });
});

describe('experienceGate — decision ladder', () => {
  it('admits when every stage admits', () => {
    const result = experienceGate(base([stage('a', 'memory-confidence', 'admit', 828)]));
    expect(result.verdict).toBe('admit');
    expect(result.reason).toBe('all-admitted');
    expect(result.decidingStageId).toBe('a');
    expect(result.decidingScoreMilli).toBe(828);
    expect(result.admitCount).toBe(1);
  });

  it('reweights when the strictest effective stage reweights', () => {
    const result = experienceGate(base([
      stage('a', 'memory-confidence', 'admit', 828),
      stage('b', 'state-role', 'reweight', 600),
    ]));
    expect(result.verdict).toBe('reweight');
    expect(result.reason).toBe('reweight-required');
    expect(result.decidingStageId).toBe('b');
  });

  it('abstains when the strictest effective stage abstains', () => {
    const result = experienceGate(base([
      stage('a', 'state-role', 'reweight', 600),
      stage('b', 'memory-admission', 'abstain', 400),
      stage('c', 'revision-integrity', 'reweight', 700),
    ]));
    expect(result.verdict).toBe('abstain');
    expect(result.reason).toBe('abstention-required');
    expect(result.decidingStageId).toBe('b');
  });

  it('rejects on a hard safety reject', () => {
    const result = experienceGate(base([
      stage('a', 'memory-confidence', 'admit', 828),
      stage('b', 'memory-gain-ledger', 'reject', 120),
      stage('c', 'state-role', 'reweight', 600),
    ]));
    expect(result.verdict).toBe('reject');
    expect(result.reason).toBe('hard-gate-rejected');
    expect(result.decidingStageId).toBe('b');
    expect(result.decidingReason).toBe('unit-reason');
    expect(result.decidingScoreMilli).toBe(120);
  });

  it('lets the first stage win a severity tie', () => {
    const result = experienceGate(base([
      stage('first', 'stale-revocation', 'reject', 200, 'polluted'),
      stage('second', 'view-consistency', 'reject', 150, 'inconsistent'),
    ]));
    expect(result.decidingStageId).toBe('first');
    expect(result.decidingReason).toBe('polluted');
    expect(result.decidingScoreMilli).toBe(200);
  });

  it('partitions every stage into exactly one count', () => {
    const result = experienceGate(base([
      stage('a', 'memory-confidence', 'admit', 900),
      stage('b', 'state-role', 'reweight', 650),
      stage('c', 'memory-admission', 'abstain', 450),
      stage('d', 'abstraction-lifecycle', 'reject', 80),
    ]));
    expect(result.stageCount).toBe(4);
    expect(result.admitCount).toBe(1);
    expect(result.reweightCount).toBe(1);
    expect(result.abstainCount).toBe(1);
    expect(result.rejectCount).toBe(1);
    expect(result.admitCount + result.reweightCount + result.abstainCount + result.rejectCount).toBe(
      result.stageCount,
    );
  });
});

describe('experienceGate — advisory sources', () => {
  it('downgrades a declared advisory reject to a reweight', () => {
    const result = experienceGate(base([
      stage('a', 'memory-confidence', 'admit', 828),
      stage('b', 'competition-domain', 'reject', 100, 'out-of-domain'),
    ], { advisorySources: ['competition-domain'] }));
    expect(result.verdict).toBe('reweight');
    expect(result.reason).toBe('reweight-required');
    expect(result.decidingStageId).toBe('b');
    expect(result.decidingReason).toBe('out-of-domain');
    expect(result.rejectCount).toBe(0);
    expect(result.reweightCount).toBe(1);
  });

  it('keeps an undeclared reject hard', () => {
    const result = experienceGate(base([
      stage('b', 'competition-domain', 'reject', 100),
    ], { advisorySources: ['cost-429'] }));
    expect(result.verdict).toBe('reject');
  });
});

describe('experienceGate — ablation attribution', () => {
  it('flags the removal that flips the verdict and not the one that does not', () => {
    const result = experienceGate(base([
      stage('a', 'memory-confidence', 'admit', 828),
      stage('b', 'memory-gain-ledger', 'reject', 100),
    ], {
      ablations: [
        { id: 'a1', removedStageId: 'b' },
        { id: 'a2', removedStageId: 'a' },
      ],
    }));
    expect(result.verdict).toBe('reject');
    expect(result.ablations).toHaveLength(2);
    expect(result.ablations[0]).toMatchObject({
      id: 'a1', removedStageId: 'b', beforeVerdict: 'reject', afterVerdict: 'admit', changed: true,
    });
    expect(result.ablations[1]).toMatchObject({
      id: 'a2', removedStageId: 'a', beforeVerdict: 'reject', afterVerdict: 'reject', changed: false,
    });
  });
});

describe('experienceGate — guards refuse rather than default', () => {
  it('refuses a blank episode id', () => {
    expect(() => experienceGate(base([stage('a', 'state-role', 'admit', 1)], { id: '  ' }))).toThrow();
  });

  it('refuses an empty stage list', () => {
    expect(() => experienceGate(base([]))).toThrow();
  });

  it('refuses a non-array stage list', () => {
    expect(() => experienceGate({ id: 'ep', stages: 'nope' as never })).toThrow();
  });

  it('refuses a non-object stage', () => {
    expect(() => experienceGate({ id: 'ep', stages: [42 as never] })).toThrow();
    expect(() => experienceGate({ id: 'ep', stages: [null as never] })).toThrow();
    expect(() => experienceGate({ id: 'ep', stages: [[] as never] })).toThrow();
  });

  it('refuses a blank stage id', () => {
    expect(() => experienceGate(base([stage(' ', 'state-role', 'admit', 1)]))).toThrow();
  });

  it('refuses a duplicate stage id', () => {
    expect(() => experienceGate(base([
      stage('a', 'state-role', 'admit', 1),
      stage('a', 'memory-confidence', 'admit', 2),
    ]))).toThrow();
  });

  it('refuses an unknown source', () => {
    expect(() => experienceGate(base([stage('a', 'made-up' as never, 'admit', 1)]))).toThrow();
  });

  it('refuses an unknown disposition', () => {
    expect(() => experienceGate(base([stage('a', 'state-role', 'maybe' as never, 1)]))).toThrow();
  });

  it('refuses a non-integer or out-of-range score', () => {
    expect(() => experienceGate(base([stage('a', 'state-role', 'admit', 1001)]))).toThrow();
    expect(() => experienceGate(base([stage('a', 'state-role', 'admit', -1)]))).toThrow();
    expect(() => experienceGate(base([stage('a', 'state-role', 'admit', 1.5)]))).toThrow();
  });

  it('refuses a blank stage reason', () => {
    expect(() => experienceGate(base([stage('a', 'state-role', 'admit', 1, '')]))).toThrow();
  });

  it('refuses a non-array advisorySources', () => {
    expect(() => experienceGate(base([stage('a', 'state-role', 'admit', 1)], {
      advisorySources: 'nope' as never,
    }))).toThrow();
  });

  it('refuses an unknown advisory source', () => {
    expect(() => experienceGate(base([stage('a', 'state-role', 'admit', 1)], {
      advisorySources: ['made-up' as never],
    }))).toThrow();
  });

  it('refuses a non-array ablations', () => {
    expect(() => experienceGate(base([stage('a', 'state-role', 'admit', 1)], {
      ablations: 'nope' as never,
    }))).toThrow();
  });

  it('refuses a non-object ablation', () => {
    expect(() => experienceGate(base([stage('a', 'state-role', 'admit', 1)], {
      ablations: [42 as never],
    }))).toThrow();
    expect(() => experienceGate(base([stage('a', 'state-role', 'admit', 1)], {
      ablations: [null as never],
    }))).toThrow();
    expect(() => experienceGate(base([stage('a', 'state-role', 'admit', 1)], {
      ablations: [[] as never],
    }))).toThrow();
  });

  it('refuses a blank ablation id', () => {
    expect(() => experienceGate(base([stage('a', 'state-role', 'admit', 1)], {
      ablations: [{ id: ' ', removedStageId: 'a' }],
    }))).toThrow();
  });

  it('refuses a non-string removedStageId', () => {
    expect(() => experienceGate(base([stage('a', 'state-role', 'admit', 1)], {
      ablations: [{ id: 'x', removedStageId: 7 as never }],
    }))).toThrow();
  });

  it('refuses an ablation pointing to a missing stage', () => {
    expect(() => experienceGate(base([stage('a', 'state-role', 'admit', 1)], {
      ablations: [{ id: 'x', removedStageId: 'missing' }],
    }))).toThrow();
  });

  it('refuses a duplicate ablation id before touching stage contents', () => {
    expect(() => experienceGate(base([stage('a', 'state-role', 'admit', 1)], {
      ablations: [
        { id: 'x', removedStageId: 'a' },
        { id: 'x', removedStageId: 'a' },
      ],
    }))).toThrow(/duplicate ablation id/);
  });
});

describe('experienceGate — ablation boundary', () => {
  it('reports admit when an ablation removes the only stage', () => {
    // A single-stage set whose gate is a hard reject: removing it leaves no gate, so the after verdict is admit.
    const result = experienceGate(base([stage('only', 'memory-gain-ledger', 'reject', 100)], {
      ablations: [{ id: 'x', removedStageId: 'only' }],
    }));
    expect(result.verdict).toBe('reject');
    expect(result.ablations[0]).toMatchObject({
      removedStageId: 'only', beforeVerdict: 'reject', afterVerdict: 'admit', changed: true,
    });
  });

  it('keeps duplicate-id detection independent of removed-stage validity', () => {
    // Two ablations with the same id must be refused as duplicates even when their removed stage is valid.
    expect(() => experienceGate(base([
      stage('a', 'state-role', 'admit', 1),
      stage('b', 'state-role', 'admit', 2),
    ], {
      ablations: [
        { id: 'dup', removedStageId: 'a' },
        { id: 'dup', removedStageId: 'b' },
      ],
    }))).toThrow(/duplicate ablation id/);
  });
});
