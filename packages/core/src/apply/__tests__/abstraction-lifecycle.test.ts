import { describe, expect, it } from 'vitest';
import { MicrogliaError } from '../../kernel/index.js';
import {
  abstractionLifecycle,
  LIFECYCLE_DISPOSITIONS,
  LIFECYCLE_REASONS,
  type AbstractionLifecycleInput,
} from '../abstraction-lifecycle.js';

describe('abstractionLifecycle — Anti-Persistence experience/abstraction separation (R247)', () => {
  const claim = (over: Partial<AbstractionLifecycleInput> = {}): AbstractionLifecycleInput => ({
    id: 'k1',
    kind: 'constraint',
    ...over,
  });

  it('exposes the closed, ordered vocabulary', () => {
    expect(LIFECYCLE_DISPOSITIONS).toEqual(['retain', 'ephemeral', 'discard']);
    expect(LIFECYCLE_REASONS).toEqual([
      'event-record',
      'stable-help',
      'harmful-abstraction',
      'insufficient-outcomes',
      'no-signal',
    ]);
  });

  describe('event records are accumulated, never discarded', () => {
    it('retains an exemplar with no utility at all', () => {
      const d = abstractionLifecycle(claim({ kind: 'exemplar' }));
      expect(d.disposition).toBe('retain');
      expect(d.reason).toBe('event-record');
    });

    it('retains an exemplar even when its utility is harmful', () => {
      const d = abstractionLifecycle(
        claim({ kind: 'exemplar', utility: { injected: 10, flippedUp: 1, flippedDown: 8 } }),
      );
      expect(d.disposition).toBe('retain');
      expect(d.reason).toBe('event-record');
    });
  });

  describe('abstractions are ephemeral unless proven stable', () => {
    it('makes an abstraction with no utility ephemeral', () => {
      const d = abstractionLifecycle(claim({ kind: 'procedure' }));
      expect(d.disposition).toBe('ephemeral');
      expect(d.reason).toBe('no-signal');
    });

    it('makes an abstraction with zero net flip ephemeral', () => {
      const d = abstractionLifecycle(
        claim({ utility: { injected: 10, flippedUp: 4, flippedDown: 4 } }),
      );
      expect(d.disposition).toBe('ephemeral');
      expect(d.reason).toBe('no-signal');
    });

    it('makes an abstraction with injected=0 ephemeral', () => {
      const d = abstractionLifecycle(
        claim({ utility: { injected: 0, flippedUp: 0, flippedDown: 0 } }),
      );
      expect(d.disposition).toBe('ephemeral');
      expect(d.reason).toBe('no-signal');
    });

    it('discards an abstraction whose net flip is negative', () => {
      const d = abstractionLifecycle(
        claim({ utility: { injected: 10, flippedUp: 2, flippedDown: 7 } }),
      );
      expect(d.disposition).toBe('discard');
      expect(d.reason).toBe('harmful-abstraction');
    });

    it('discards a harmful abstraction even below the injection floor', () => {
      // Error reproduction: a harmful rule regenerates even from one episode, so harm is not gated by volume.
      const d = abstractionLifecycle(
        claim({ utility: { injected: 1, flippedUp: 0, flippedDown: 1 } }),
      );
      expect(d.disposition).toBe('discard');
      expect(d.reason).toBe('harmful-abstraction');
    });

    it('retains a positive abstraction at or above the injection floor', () => {
      const d = abstractionLifecycle(
        claim({ utility: { injected: 3, flippedUp: 3, flippedDown: 0 } }),
      );
      expect(d.disposition).toBe('retain');
      expect(d.reason).toBe('stable-help');
    });

    it('makes a positive abstraction below the injection floor ephemeral', () => {
      const d = abstractionLifecycle(
        claim({ utility: { injected: 2, flippedUp: 2, flippedDown: 0 } }),
      );
      expect(d.disposition).toBe('ephemeral');
      expect(d.reason).toBe('insufficient-outcomes');
    });

    it('honours a custom injection floor', () => {
      const item = claim({ utility: { injected: 5, flippedUp: 5, flippedDown: 0 } });
      expect(abstractionLifecycle(item, { minInjections: 5 }).reason).toBe('stable-help');
      expect(abstractionLifecycle(item, { minInjections: 6 }).reason).toBe('insufficient-outcomes');
    });
  });

  describe('the reported arithmetic is a readback, not a gate', () => {
    it('reports net flip, injected and the floor that was applied', () => {
      const d = abstractionLifecycle(
        claim({ utility: { injected: 10, flippedUp: 6, flippedDown: 2 } }),
      );
      expect(d.injected).toBe(10);
      expect(d.delta).toBe(4);
      expect(d.minInjections).toBe(3);
    });

    it('reports delta 0 and injected 0 when no utility is present', () => {
      const d = abstractionLifecycle(claim());
      expect(d.injected).toBe(0);
      expect(d.delta).toBe(0);
    });

    it('echoes id and kind so a readback can be joined to the source record', () => {
      const d = abstractionLifecycle(claim({ id: 'abc', kind: 'negative' }));
      expect(d.id).toBe('abc');
      expect(d.kind).toBe('negative');
    });
  });

  describe('guards refuse rather than default', () => {
    it('refuses an empty id', () => {
      expect(() => abstractionLifecycle(claim({ id: '  ' }))).toThrow(MicrogliaError);
    });

    it('names the offending id in the refusal', () => {
      try {
        abstractionLifecycle(
          claim({ id: 'bad-id', utility: { injected: -1, flippedUp: 0, flippedDown: 0 } }),
        );
        throw new Error('should have thrown');
      } catch (error) {
        expect((error as Error).message).toContain('bad-id');
      }
    });

    it('refuses an unknown kind', () => {
      expect(() => abstractionLifecycle(claim({ kind: 'mystery' as never }))).toThrow(MicrogliaError);
    });

    it('refuses a non-integer or zero minInjections', () => {
      expect(() => abstractionLifecycle(claim(), { minInjections: 0 })).toThrow(MicrogliaError);
      expect(() => abstractionLifecycle(claim(), { minInjections: 1.5 })).toThrow(MicrogliaError);
    });

    it('refuses negative or non-integer utility counts', () => {
      expect(() =>
        abstractionLifecycle(claim({ utility: { injected: -1, flippedUp: 0, flippedDown: 0 } })),
      ).toThrow(MicrogliaError);
      expect(() =>
        abstractionLifecycle(claim({ utility: { injected: 3, flippedUp: 0.5, flippedDown: 0 } })),
      ).toThrow(MicrogliaError);
    });

    it('refuses flips that exceed injected', () => {
      expect(() =>
        abstractionLifecycle(claim({ utility: { injected: 2, flippedUp: 1, flippedDown: 2 } })),
      ).toThrow(MicrogliaError);
    });
  });

  describe('determinism and purity', () => {
    it('returns the same verdict for the same input', () => {
      const item = claim({ utility: { injected: 8, flippedUp: 5, flippedDown: 1 } });
      expect(abstractionLifecycle(item)).toEqual(abstractionLifecycle(item));
    });

    it('does not mutate its input', () => {
      const utility = Object.freeze({ injected: 8, flippedUp: 5, flippedDown: 1 });
      const item = Object.freeze(claim({ utility }));
      expect(() => abstractionLifecycle(item)).not.toThrow();
      expect(utility).toEqual({ injected: 8, flippedUp: 5, flippedDown: 1 });
    });
  });
});
