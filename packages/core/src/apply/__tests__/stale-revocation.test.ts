import { describe, expect, it } from 'vitest';
import { MicrogliaError } from '../../kernel/index.js';
import {
  EVIDENCE_RELATIONS,
  ITEM_DISPOSITIONS,
  REVOCATION_REASONS,
  REVOCATION_VERDICTS,
  staleRevocation,
  type RevocationEvidence,
  type RevocationItem,
  type StaleRevocationInput,
} from '../stale-revocation.js';

describe('staleRevocation — current only if stale peers are gone (R250)', () => {
  const item = (
    id: string,
    key: string,
    serial: number,
    disposition: RevocationItem['disposition'],
  ): RevocationItem => ({ id, key, serial, disposition });

  const evidence = (over: Partial<RevocationEvidence> = {}): RevocationEvidence => ({
    id: 'ev-1',
    key: 'lang',
    relation: 'co-reference',
    serial: 10,
    ...over,
  });

  const input = (over: Partial<StaleRevocationInput> = {}): StaleRevocationInput => ({
    id: 'episode-1',
    evidence: evidence(),
    items: [item('cur', 'lang', 10, 'active'), item('old', 'lang', 3, 'revoked')],
    ...over,
  });

  it('exposes the closed, ordered vocabularies', () => {
    expect(EVIDENCE_RELATIONS).toEqual(['extend', 'co-reference', 'propagation']);
    expect(ITEM_DISPOSITIONS).toEqual(['active', 'revoked', 'superseded']);
    expect(REVOCATION_VERDICTS).toEqual(['clean', 'polluted', 'over-revoked', 'unresolved']);
    expect(REVOCATION_REASONS).toEqual([
      'extend-safe',
      'co-reference-resolved',
      'propagation-resolved',
      'stale-still-active',
      'propagated-still-active',
      'current-removed',
      'no-current-evidence',
    ]);
  });

  describe('clean: stale revoked, current kept active', () => {
    it('an extend relation never turns an older value stale', () => {
      const r = staleRevocation(
        input({
          evidence: evidence({ relation: 'extend' }),
          items: [item('cur', 'lang', 10, 'active'), item('old', 'lang', 3, 'active')],
        }),
      );
      expect(r.verdict).toBe('clean');
      expect(r.reason).toBe('extend-safe');
      expect(r.staleCount).toBe(0);
      expect(r.currentActive).toBe(true);
    });

    it('a co-reference conflict with the old value revoked is resolved', () => {
      const r = staleRevocation(
        input({
          items: [item('cur', 'lang', 10, 'active'), item('old', 'lang', 3, 'revoked')],
        }),
      );
      expect(r.verdict).toBe('clean');
      expect(r.reason).toBe('co-reference-resolved');
      expect(r.staleCount).toBe(1);
      expect(r.activeStaleCount).toBe(0);
    });

    it('a superseded stale item also counts as handled', () => {
      const r = staleRevocation(input({ items: [item('cur', 'lang', 10, 'active'), item('old', 'lang', 3, 'superseded')] }));
      expect(r.verdict).toBe('clean');
      expect(r.staleCount).toBe(1);
      expect(r.activeStaleCount).toBe(0);
    });

    it('a fully handled propagation cascade is resolved', () => {
      const r = staleRevocation(
        input({
          evidence: evidence({ relation: 'propagation', invalidates: ['commute', 'health'] }),
          items: [
            item('cur', 'lang', 10, 'active'),
            item('old', 'lang', 3, 'revoked'),
            item('bike', 'commute', 6, 'revoked'),
            item('fracture', 'health', 7, 'superseded'),
          ],
        }),
      );
      expect(r.verdict).toBe('clean');
      expect(r.reason).toBe('propagation-resolved');
      expect(r.staleCount).toBe(3);
      expect(r.propagationKeys).toBe(2);
    });
  });

  describe('polluted: a stale value is still exposed to retrieval', () => {
    it('an active stale co-reference item is pollution (TEPA append-only)', () => {
      const r = staleRevocation(
        input({ items: [item('cur', 'lang', 10, 'active'), item('old', 'lang', 3, 'active')] }),
      );
      expect(r.verdict).toBe('polluted');
      expect(r.reason).toBe('stale-still-active');
      expect(r.activeStaleCount).toBe(1);
    });

    it('an active invalidated key in a propagation cascade is pollution', () => {
      const r = staleRevocation(
        input({
          evidence: evidence({ relation: 'propagation', invalidates: ['commute'] }),
          items: [item('cur', 'lang', 10, 'active'), item('bike', 'commute', 6, 'active')],
        }),
      );
      expect(r.verdict).toBe('polluted');
      expect(r.reason).toBe('propagated-still-active');
      expect(r.activeStaleCount).toBe(1);
    });

    it('counts every exposed stale item, not just the first', () => {
      const r = staleRevocation(
        input({
          evidence: evidence({ invalidates: [] }),
          items: [
            item('cur', 'lang', 10, 'active'),
            item('a', 'lang', 2, 'active'),
            item('b', 'lang', 4, 'active'),
            item('c', 'lang', 6, 'active'),
          ],
        }),
      );
      expect(r.reason).toBe('stale-still-active');
      expect(r.activeStaleCount).toBe(3);
      expect(r.staleCount).toBe(3);
    });

    it('a propagation active stale wins over the generic stale reason', () => {
      const r = staleRevocation(
        input({
          evidence: evidence({ relation: 'propagation', invalidates: ['commute'] }),
          items: [
            item('cur', 'lang', 10, 'active'),
            item('old', 'lang', 3, 'active'),
            item('bike', 'commute', 6, 'active'),
          ],
        }),
      );
      expect(r.reason).toBe('propagated-still-active');
      expect(r.activeStaleCount).toBe(2);
    });
  });

  describe('over-revoked and unresolved', () => {
    it('revoking the current value is over-revocation (TEPA key-current)', () => {
      const r = staleRevocation(
        input({ items: [item('cur', 'lang', 10, 'revoked'), item('old', 'lang', 3, 'revoked')] }),
      );
      expect(r.verdict).toBe('over-revoked');
      expect(r.reason).toBe('current-removed');
      expect(r.currentActive).toBe(false);
    });

    it('a superseded current value is also over-revocation', () => {
      const r = staleRevocation(input({ items: [item('cur', 'lang', 10, 'superseded')] }));
      expect(r.verdict).toBe('over-revoked');
    });

    it('no current item for the evidence key is unresolved', () => {
      const r = staleRevocation(input({ items: [item('old', 'lang', 3, 'revoked')] }));
      expect(r.verdict).toBe('unresolved');
      expect(r.reason).toBe('no-current-evidence');
      expect(r.currentCount).toBe(0);
    });

    it('pollution dominates over-revocation', () => {
      const r = staleRevocation(
        input({ items: [item('cur', 'lang', 10, 'revoked'), item('old', 'lang', 3, 'active')] }),
      );
      expect(r.verdict).toBe('polluted');
      expect(r.reason).toBe('stale-still-active');
    });

    it('pollution dominates a missing current value', () => {
      const r = staleRevocation(input({ items: [item('old', 'lang', 3, 'active')] }));
      expect(r.verdict).toBe('polluted');
    });

    it('an extend relation with no current item is unresolved', () => {
      const r = staleRevocation(
        input({ evidence: evidence({ relation: 'extend' }), items: [item('old', 'lang', 3, 'active')] }),
      );
      expect(r.verdict).toBe('unresolved');
      expect(r.reason).toBe('no-current-evidence');
    });
  });

  describe('guards refuse rather than default', () => {
    it('refuses a blank id', () => {
      expect(() => staleRevocation(input({ id: '  ' }))).toThrow(MicrogliaError);
    });

    it('names the episode in an unknown-relation refusal', () => {
      try {
        staleRevocation(
          input({ id: 'bad-ep', evidence: evidence({ relation: 'merge' as never }) }),
        );
        throw new Error('should have thrown');
      } catch (error) {
        expect((error as Error).message).toContain('bad-ep');
      }
    });

    it('refuses an unknown relation', () => {
      expect(() => staleRevocation(input({ evidence: evidence({ relation: 'merge' as never }) }))).toThrow(
        MicrogliaError,
      );
    });

    it('refuses a non-object evidence', () => {
      expect(() => staleRevocation(input({ evidence: 'x' as never }))).toThrow(MicrogliaError);
    });

    it('refuses a blank evidence id', () => {
      expect(() => staleRevocation(input({ evidence: evidence({ id: ' ' }) }))).toThrow(MicrogliaError);
    });

    it('refuses a blank evidence key', () => {
      expect(() => staleRevocation(input({ evidence: evidence({ key: ' ' }) }))).toThrow(MicrogliaError);
    });

    it('refuses a negative evidence serial', () => {
      expect(() => staleRevocation(input({ evidence: evidence({ serial: -1 }) }))).toThrow(MicrogliaError);
    });

    it('refuses a non-finite evidence serial', () => {
      expect(() => staleRevocation(input({ evidence: evidence({ serial: Number.POSITIVE_INFINITY }) }))).toThrow(
        MicrogliaError,
      );
    });

    it('refuses a non-array items', () => {
      expect(() => staleRevocation(input({ items: 'x' as never }))).toThrow(MicrogliaError);
    });

    it('refuses empty items', () => {
      expect(() => staleRevocation(input({ items: [] }))).toThrow(MicrogliaError);
    });

    it('refuses a non-object item', () => {
      expect(() => staleRevocation(input({ items: [1 as never] }))).toThrow(MicrogliaError);
    });

    it('refuses a blank item id', () => {
      expect(() => staleRevocation(input({ items: [item(' ', 'lang', 10, 'active')] }))).toThrow(MicrogliaError);
    });

    it('names the duplicate item id in the refusal', () => {
      try {
        staleRevocation(
          input({ items: [item('dup-id', 'lang', 10, 'active'), item('dup-id', 'lang', 3, 'revoked')] }),
        );
        throw new Error('should have thrown');
      } catch (error) {
        expect((error as Error).message).toContain('dup-id');
      }
    });

    it('refuses a duplicate item id', () => {
      expect(() =>
        staleRevocation(input({ items: [item('d', 'lang', 10, 'active'), item('d', 'lang', 3, 'revoked')] })),
      ).toThrow(MicrogliaError);
    });

    it('refuses a blank item key', () => {
      expect(() => staleRevocation(input({ items: [item('a', ' ', 10, 'active')] }))).toThrow(MicrogliaError);
    });

    it('refuses a non-finite item serial', () => {
      expect(() => staleRevocation(input({ items: [item('a', 'lang', Number.NaN, 'active')] }))).toThrow(
        MicrogliaError,
      );
    });

    it('refuses a negative item serial', () => {
      expect(() => staleRevocation(input({ items: [item('a', 'lang', -2, 'active')] }))).toThrow(MicrogliaError);
    });

    it('refuses an unknown disposition', () => {
      expect(() => staleRevocation(input({ items: [item('a', 'lang', 10, 'archived' as never)] }))).toThrow(
        MicrogliaError,
      );
    });

    it('refuses a non-array invalidates', () => {
      expect(() => staleRevocation(input({ evidence: evidence({ invalidates: 'x' as never }) }))).toThrow(
        MicrogliaError,
      );
    });

    it('refuses a blank invalidated key', () => {
      expect(() => staleRevocation(input({ evidence: evidence({ invalidates: [' '] }) }))).toThrow(MicrogliaError);
    });

    it('refuses invalidates that name the evidence key', () => {
      expect(() => staleRevocation(input({ evidence: evidence({ invalidates: ['lang'] }) }))).toThrow(
        MicrogliaError,
      );
    });

    it('refuses invalidates on a non-propagation relation', () => {
      expect(() => staleRevocation(input({ evidence: evidence({ relation: 'extend', invalidates: ['x'] }) }))).toThrow(
        MicrogliaError,
      );
    });
  });

  describe('determinism, purity and invariants', () => {
    it('returns the same readback for the same input', () => {
      const value = input({ items: [item('a', 'lang', 10, 'active'), item('b', 'lang', 3, 'active')] });
      expect(staleRevocation(value)).toEqual(staleRevocation(value));
    });

    it('does not mutate its input', () => {
      const items = Object.freeze([
        Object.freeze(item('a', 'lang', 10, 'active')),
        Object.freeze(item('b', 'lang', 3, 'revoked')),
      ]);
      const value = Object.freeze(input({ items, evidence: Object.freeze(evidence({ invalidates: Object.freeze([]) })) }));
      expect(() => staleRevocation(value)).not.toThrow();
      expect(items[1]?.disposition).toBe('revoked');
    });

    it('active stale items never exceed the stale count', () => {
      const r = staleRevocation(
        input({
          evidence: evidence({ relation: 'propagation', invalidates: ['commute'] }),
          items: [
            item('cur', 'lang', 10, 'active'),
            item('a', 'lang', 2, 'active'),
            item('b', 'lang', 4, 'revoked'),
            item('c', 'commute', 6, 'active'),
          ],
        }),
      );
      expect(r.activeStaleCount).toBeLessThanOrEqual(r.staleCount);
      expect(r.staleCount).toBe(r.activeStaleCount + 1);
    });

    it('an active stale count above zero always means polluted', () => {
      const r = staleRevocation(input({ items: [item('a', 'lang', 3, 'active')] }));
      expect(r.activeStaleCount).toBeGreaterThan(0);
      expect(r.verdict).toBe('polluted');
    });
  });
});
