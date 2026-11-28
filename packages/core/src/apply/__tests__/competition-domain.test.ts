import { describe, expect, it } from 'vitest';
import { MicrogliaError } from '../../kernel/index.js';
import {
  classifyCompetitionDomain,
  DOMAIN_REASONS,
  DOMAIN_VERDICTS,
  type DomainCandidate,
} from '../competition-domain.js';

describe('classifyCompetitionDomain — keep microglia competition in its own field (R248)', () => {
  const candidate = (over: Partial<DomainCandidate> = {}): DomainCandidate => ({
    name: 'some-system',
    measures: [],
    artifact: 'memory-pack',
    unit: 'unknown',
    ...over,
  });

  it('exposes the closed, ordered vocabularies', () => {
    expect(DOMAIN_VERDICTS).toEqual(['memory', 'host', 'ambiguous', 'other']);
    expect(DOMAIN_REASONS).toEqual([
      'measured-memory-gain',
      'memory-benchmark',
      'host-task-score',
      'host-artifact',
      'mixed-signals',
      'no-signal',
    ]);
  });

  describe('the deciding question is the unit of measurement', () => {
    it('a measured memory gain is microglia territory even on a generic artifact', () => {
      const d = classifyCompetitionDomain(
        candidate({ name: 'mem0', measures: ['longmemeval'], unit: 'memory-gain' }),
      );
      expect(d.verdict).toBe('memory');
      expect(d.reason).toBe('measured-memory-gain');
      expect(d.amplifierRole).toBe(false);
    });

    it('a memory gain measured inside a SQL host makes microglia an amplifier, not a competitor', () => {
      const d = classifyCompetitionDomain(
        candidate({
          name: 'nl2charts-with-memory',
          measures: ['bird-ex'],
          artifact: 'sql-query',
          unit: 'memory-gain',
        }),
      );
      expect(d.verdict).toBe('memory');
      expect(d.amplifierRole).toBe(true);
    });

    it('an absolute NL2SQL score belongs to nl2charts, not microglia', () => {
      const d = classifyCompetitionDomain(
        candidate({ name: 'AskData', measures: ['bird-ex'], artifact: 'sql-query', unit: 'absolute-task-score' }),
      );
      expect(d.verdict).toBe('host');
      expect(d.reason).toBe('host-task-score');
      expect(d.amplifierRole).toBe(false);
    });

    it('an absolute chart score belongs to the host domain', () => {
      const d = classifyCompetitionDomain(
        candidate({ name: 'chart-gen', measures: ['chart-accuracy'], artifact: 'chart', unit: 'absolute-task-score' }),
      );
      expect(d.verdict).toBe('host');
      expect(d.reason).toBe('host-task-score');
    });

    it('an absolute score on a memory benchmark is still microglia territory', () => {
      const d = classifyCompetitionDomain(
        candidate({ name: 'mastra', measures: ['longmemeval'], unit: 'absolute-task-score' }),
      );
      expect(d.verdict).toBe('memory');
      expect(d.reason).toBe('memory-benchmark');
    });

    it('an absolute score with only a host artifact is host-artifact', () => {
      const d = classifyCompetitionDomain(
        candidate({ name: 'viz-only', measures: [], artifact: 'chart', unit: 'absolute-task-score' }),
      );
      expect(d.verdict).toBe('host');
      expect(d.reason).toBe('host-artifact');
    });

    it('an absolute score with no signals at all is other', () => {
      const d = classifyCompetitionDomain(
        candidate({ name: 'unlabeled', measures: ['throughput'], artifact: 'report', unit: 'absolute-task-score' }),
      );
      expect(d.verdict).toBe('other');
      expect(d.reason).toBe('no-signal');
    });
  });

  describe('unknown units fall back to signal counts, refusing to guess on a tie', () => {
    it('only memory signals → memory', () => {
      const d = classifyCompetitionDomain(candidate({ measures: ['locomo', 'memoryagentbench'] }));
      expect(d.verdict).toBe('memory');
    });

    it('only host signals → host (via the host-artifact rule)', () => {
      const d = classifyCompetitionDomain(candidate({ measures: ['spider-ex'], artifact: 'sql-query' }));
      expect(d.verdict).toBe('host');
    });

    it('host signals without a host artifact are still host', () => {
      const d = classifyCompetitionDomain(candidate({ measures: ['text2sql-ex'] }));
      expect(d.verdict).toBe('host');
      expect(d.reason).toBe('host-task-score');
    });

    it('a chart artifact alone marks the host domain', () => {
      const d = classifyCompetitionDomain(candidate({ artifact: 'chart' }));
      expect(d.verdict).toBe('host');
      expect(d.reason).toBe('host-artifact');
    });

    it('memory and host signals together are ambiguous, never auto-assigned', () => {
      const d = classifyCompetitionDomain(
        candidate({ measures: ['longmemeval', 'bird-ex'], artifact: 'memory-pack' }),
      );
      expect(d.verdict).toBe('ambiguous');
      expect(d.reason).toBe('mixed-signals');
    });

    it('no signals at all → other', () => {
      const d = classifyCompetitionDomain(candidate({ measures: ['throughput'] }));
      expect(d.verdict).toBe('other');
      expect(d.reason).toBe('no-signal');
    });
  });

  describe('the reported counts are a readback, not a gate', () => {
    it('counts each signal family and echoes the inputs', () => {
      const d = classifyCompetitionDomain(
        candidate({ name: 'x', measures: ['longmemeval', 'locomo', 'bird-ex', 'other'], artifact: 'memory-pack', unit: 'unknown' }),
      );
      expect(d.memorySignals).toBe(2);
      expect(d.hostSignals).toBe(1);
      expect(d.name).toBe('x');
      expect(d.unit).toBe('unknown');
    });
  });

  describe('guards refuse rather than default', () => {
    it('refuses a blank name', () => {
      expect(() => classifyCompetitionDomain(candidate({ name: '  ' }))).toThrow(MicrogliaError);
    });

    it('names the offending candidate in the refusal', () => {
      try {
        classifyCompetitionDomain(candidate({ name: 'bad-name', measures: 'not-array' as never }));
        throw new Error('should have thrown');
      } catch (error) {
        expect((error as Error).message).toContain('bad-name');
      }
    });

    it('refuses non-string measure labels', () => {
      expect(() => classifyCompetitionDomain(candidate({ measures: [1 as never] }))).toThrow(MicrogliaError);
    });

    it('refuses an unknown artifact', () => {
      expect(() => classifyCompetitionDomain(candidate({ artifact: 'sql-ddl' as never }))).toThrow(MicrogliaError);
    });

    it('refuses an unknown unit', () => {
      expect(() => classifyCompetitionDomain(candidate({ unit: 'maybe' as never }))).toThrow(MicrogliaError);
    });
  });

  describe('determinism and purity', () => {
    it('returns the same verdict for the same input', () => {
      const c = candidate({ measures: ['longmemeval', 'bird-ex'] });
      expect(classifyCompetitionDomain(c)).toEqual(classifyCompetitionDomain(c));
    });

    it('does not mutate its input', () => {
      const measures = Object.freeze(['longmemeval', 'locomo']);
      const c = Object.freeze(candidate({ measures }));
      expect(() => classifyCompetitionDomain(c)).not.toThrow();
      expect(measures).toEqual(['longmemeval', 'locomo']);
    });
  });
});
